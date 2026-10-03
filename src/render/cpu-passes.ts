/**
 * The Canvas2D backend's actual render pipeline, and the CPU twin of every
 * kernel in `src/gl/shaders/index.ts`.
 *
 * The fallback used to do three things: fill a matte, `setTransform`, and set
 * `ctx.filter`. Everything else — curves, HSL, the whole background pass, the
 * detail kernels, the effects — was missing, and `renderExportCanvas` caught
 * any GL failure in a bare `catch {}` and shipped that file with no warning.
 * This module is the fix: it runs the *same* `planPasses` output, in the same
 * order, with the same constants, so the two engines produce the same image.
 *
 * Anything this module cannot reproduce exactly is **not** faked. It is listed
 * in `CANVAS2D_SUPPORT` (`src/gl/caps.ts`) as gated and skipped, and
 * `gatedFamilies` reports it so the caller can tell the user.
 */

import type { HslBand, HslMix } from '../model/types'
import { buildChannelLuts } from '../lib/curves'
import { blackPointTransfer, ditherOffsetLsb, filmicShoulder, whiteBalance } from '../lib/tonemap'
import { gradientStop } from '../lib/gradient-angle'
import { hexToRgb } from '../gl/pass-colors'
import { maskValueAt } from '../gl/mask'
import type { Pass, PassFamily } from '../gl/passes'
import {
  BACKGROUND_DIRS,
  backgroundBlurRadiusPx,
  backgroundImageUv,
  backgroundOutsideImage,
  backgroundScale,
} from './background'
import { healAt, redEyeAt, smoothAt } from './retouch'

export type Pixels = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function makePixels(width: number, height: number, fill = 0): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  if (fill !== 0) data.fill(fill)
  return { width, height, data }
}

export type PassContext = {
  /**
   * output px / proxy px (`pixelScale` in `src/gl/pixel-scale.ts`). Every
   * resolution-dependent kernel multiplies its radius by this so one slider
   * means the same thing in the preview and in a 6000 px export.
   */
  pixelScale: number
  /** Top-left of this buffer inside the whole output frame, for tiled renders. */
  origin?: { x: number; y: number }
  /**
   * Size of the *whole* output. A mask and a heal spot are authored in
   * whole-output normalized space, so a tile has to know the frame it sits in.
   * Defaults to the buffer's own size, which is the untiled case.
   */
  frame?: { width: number; height: number }
  /**
   * Pixels of `background.imageAssetId`, decoded. The GL backend uploads the
   * bitmap as a texture; there is no texture to read back here, so the caller
   * decodes it once and hands it over.
   */
  backgroundImage?: Pixels
}

export const DEFAULT_CONTEXT: PassContext = { pixelScale: 1, origin: { x: 0, y: 0 } }

/**
 * A point in whole-output normalized space, y down — the space masks and heal
 * spots are authored in. `pointPass` hands out uv over *this buffer*, so a
 * tiled render has to re-express it in the frame.
 */
function outputPoint(
  uv: { x: number; y: number },
  buffer: Pixels,
  context: PassContext,
): [number, number] {
  const origin = context.origin ?? { x: 0, y: 0 }
  const frame = context.frame ?? buffer
  return [
    (origin.x + uv.x * buffer.width) / Math.max(1, frame.width),
    (origin.y + uv.y * buffer.height) / Math.max(1, frame.height),
  ]
}

function frameAspect(context: PassContext, buffer: Pixels): number {
  const frame = context.frame ?? buffer
  return Math.max(1, frame.width) / Math.max(1, frame.height)
}

export type CpuPassResult = {
  pixels: Pixels
  /** Pass families the plan wanted that this backend deliberately drops. */
  gated: PassFamily[]
}

// --- shared maths, mirrored from the GLSL -------------------------------------

const LUMA = [0.2126, 0.7152, 0.0722] as const

export function luma(r: number, g: number, b: number): number {
  return LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return t * t * (3 - 2 * t)
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * The eight directions `BLUR_FRAG` and `EFFECTS_FRAG` tap, in order, with the
 * y components negated relative to the shader.
 *
 * The shader's `v_uv` is bottom-up; this buffer's rows are top-down. The tap
 * *set* is symmetric, so the only thing the flip changes is which taps clamp at
 * a frame edge — and the weights are not symmetric (they fall off with tap
 * index), so one engine ends up clamping its four heaviest taps at the top edge
 * and the other its four lightest. That is a ~6/255 disagreement along every
 * edge, so the flip is required, not cosmetic.
 */
export const KERNEL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.7071, -0.7071],
  [0, -1],
  [-0.7071, -0.7071],
  [-1, 0],
  [-0.7071, 0.7071],
  [0, 1],
  [0.7071, 0.7071],
]

function tapWeight(index: number): number {
  const fi = index + 1
  return Math.exp(-0.5 * (fi / 3) * (fi / 3))
}

/**
 * `EFFECTS_FRAG` taps the bloom halo `0.004 / u_pixelScale` of the frame in uv.
 * At or above the proxy cap that is a constant `0.004 * PROXY_LONG_EDGE` output
 * pixels, which is the whole point: a 6000 px export gets the same halo the
 * preview does instead of one three times wider.
 */
export const BLOOM_UV_STEP = 0.004

/** `EFFECTS_FRAG`: a grain cell is two output pixels on a side at scale 1. */
export const GRAIN_CELL_PX = 2

/**
 * uv distance of the bloom taps, in output pixels, at a given kernel scale.
 * The offset is authored in uv, so it is one number per axis: on a non-square
 * frame a single pixel radius would drift from the shader.
 */
export function bloomStepPx(
  size: { width: number; height: number },
  pixelScale: number,
): { x: number; y: number } {
  return {
    x: (BLOOM_UV_STEP * size.width) / pixelScale,
    y: (BLOOM_UV_STEP * size.height) / pixelScale,
  }
}

/** `hash` from `EFFECTS_FRAG`, byte-identical so both engines share a field. */
export function grainHash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Bilinear with clamp-to-edge, which is what a LINEAR 2D texture does. */
function sampleBilinear(
  src: Pixels,
  x: number,
  y: number,
  out: [number, number, number, number],
): void {
  const fx = Math.min(src.width - 1, Math.max(0, x))
  const fy = Math.min(src.height - 1, Math.max(0, y))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(src.width - 1, x0 + 1)
  const y1 = Math.min(src.height - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const p00 = (y0 * src.width + x0) * 4
  const p10 = (y0 * src.width + x1) * 4
  const p01 = (y1 * src.width + x0) * 4
  const p11 = (y1 * src.width + x1) * 4
  const d = src.data
  for (let c = 0; c < 4; c += 1) {
    const top = d[p00 + c]! + (d[p10 + c]! - d[p00 + c]!) * tx
    const bottom = d[p01 + c]! + (d[p11 + c]! - d[p01 + c]!) * tx
    out[c] = (top + (bottom - top) * ty) / 255
  }
}

function clone(src: Pixels): Pixels {
  return { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) }
}

/** Write a float rgba back into a byte buffer, quantising like an RGBA8 target. */
function write(target: Pixels, i: number, r: number, g: number, b: number, a: number): void {
  target.data[i] = Math.round(clamp01(r) * 255)
  target.data[i + 1] = Math.round(clamp01(g) * 255)
  target.data[i + 2] = Math.round(clamp01(b) * 255)
  target.data[i + 3] = Math.round(clamp01(a) * 255)
}

// --- per-pass kernels, exported so the GL side can be asserted against them ---

type ToneAdjustments = {
  exposure: number
  brightness: number
  contrast: number
  highlights: number
  shadows: number
  blackPoint: number
  brilliance: number
}

/**
 * The adjustment arithmetic `LOCAL_FRAG` shares verbatim with `TONE_FRAG`:
 * exposure, brightness, contrast, the D4-F07 white balance, black point and
 * brilliance. The filmic shoulder is the one thing `TONE_FRAG` does on top, and
 * it is the output transfer curve of the *global* stage rather than an
 * adjustment, so the masked twin stops here.
 */
function toneAdjustmentsAt(rgb: readonly [number, number, number], pass: ToneAdjustments) {
  let r = rgb[0] * Math.pow(2, pass.exposure)
  let g = rgb[1] * Math.pow(2, pass.exposure)
  let b = rgb[2] * Math.pow(2, pass.exposure)
  r += pass.brightness * 0.25
  g += pass.brightness * 0.25
  b += pass.brightness * 0.25
  r = (r - 0.5) * (1 + pass.contrast) + 0.5
  g = (g - 0.5) * (1 + pass.contrast) + 0.5
  b = (b - 0.5) * (1 + pass.contrast) + 0.5
  const l = luma(r, g, b)
  const shadowed = whiteBalance([r, g, b], l, pass.shadows * 0.5 * (1 - smoothstep(0, 0.5, l)))
  const lifted = whiteBalance(shadowed, l, pass.highlights * 0.5 * smoothstep(0.5, 1, l))
  const bp = pass.blackPoint * 0.2
  const divisor = Math.max(1 - bp, 0.05)
  const mid = smoothstep(0.15, 0.6, l) * (1 - smoothstep(0.6, 0.95, l))
  return [0, 1, 2].map((i) => (lifted[i]! - bp) / divisor + pass.brilliance * 0.25 * mid) as [
    number,
    number,
    number,
  ]
}

/** `TONE_FRAG`: the shared adjustments, then the D3-F23 filmic shoulder. */
export function toneAt(
  rgb: readonly [number, number, number],
  pass: ToneAdjustments,
): [number, number, number] {
  const [r, g, b] = toneAdjustmentsAt(rgb, pass)
  return [filmicShoulder(r), filmicShoulder(g), filmicShoulder(b)]
}

export { blackPointTransfer }

/** `COLOR_FRAG`. */
export function colorAt(
  rgb: readonly [number, number, number],
  pass: { saturation: number; vibrance: number; warmth: number; tint: number },
): [number, number, number] {
  const l = luma(rgb[0], rgb[1], rgb[2])
  let r = mix(l, rgb[0], 1 + pass.saturation)
  let g = mix(l, rgb[1], 1 + pass.saturation)
  let b = mix(l, rgb[2], 1 + pass.saturation)
  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  const vib = pass.vibrance * (1 - (maxC - minC))
  const l2 = luma(r, g, b)
  r = mix(l2, r, 1 + vib)
  g = mix(l2, g, 1 + vib)
  b = mix(l2, b, 1 + vib)
  r += pass.warmth * 0.12
  b -= pass.warmth * 0.12
  g -= pass.tint * 0.1
  r += pass.tint * 0.05
  b += pass.tint * 0.05
  return [r, g, b]
}

/**
 * `CURVES_FRAG`, sampling the 256-entry LUT the way a LINEAR R8 texture does.
 * The half-texel offset is not cosmetic: `texture(lut, vec2(v, 0.5))` resolves
 * to texel coordinate `256v - 0.5`, so sampling at `255v` instead biases every
 * curve by half a step and the two engines stop agreeing.
 */
export function sampleLut(lut: Uint8Array, value: number): number {
  const x = clamp01(value) * 256 - 0.5
  const i = Math.floor(x)
  const t = x - i
  const a = lut[Math.min(255, Math.max(0, i))]! / 255
  const b = lut[Math.min(255, Math.max(0, i + 1))]! / 255
  return a + (b - a) * t
}

/** `VIGNETTE_FRAG`. */
export function vignetteAt(
  rgb: readonly [number, number, number],
  uv: { x: number; y: number },
  amount: number,
): [number, number, number] {
  const dx = uv.x - 0.5
  const dy = uv.y - 0.5
  const dist = Math.sqrt(dx * dx + dy * dy) * 1.4142
  const mask = smoothstep(0.4, 1, dist)
  const k = 1 - amount * mask
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k]
}

// --- the chain ---------------------------------------------------------------

type Rgba = [number, number, number, number]

type PointWriter = (
  rgb: Rgba,
  uv: { x: number; y: number },
  set: (r: number, g: number, b: number, a: number) => void,
) => void

/**
 * A per-pixel pass reading `src` and writing a fresh buffer. The callback gets
 * a setter rather than an index so it cannot accidentally write back into the
 * pixels it is reading from.
 */
function pointPass(src: Pixels, fn: PointWriter): Pixels {
  const out = clone(src)
  const pixel: Rgba = [0, 0, 0, 0]
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4
      pixel[0] = src.data[i]! / 255
      pixel[1] = src.data[i + 1]! / 255
      pixel[2] = src.data[i + 2]! / 255
      pixel[3] = src.data[i + 3]! / 255
      fn(pixel, { x: (x + 0.5) / src.width, y: (y + 0.5) / src.height }, (r, g, b, a) =>
        write(out, i, r, g, b, a),
      )
    }
  }
  return out
}

/** `BLUR_FRAG` — 8 directions, gaussian weights, alpha included. */
function denoisePass(src: Pixels, amount: number, pixelScale: number): Pixels {
  const radius = (1 + amount * 2) * pixelScale
  const out = clone(src)
  const tap: Rgba = [0, 0, 0, 0]
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4
      sampleBilinear(src, x, y, tap)
      let r = tap[0]
      let g = tap[1]
      let b = tap[2]
      let a = tap[3]
      let total = 1
      for (let k = 0; k < 8; k += 1) {
        const fi = k + 1
        const w = tapWeight(k)
        const [dx, dy] = KERNEL_DIRS[k]!
        sampleBilinear(src, x + (dx * radius * fi) / 4, y + (dy * radius * fi) / 4, tap)
        r += tap[0] * w
        g += tap[1] * w
        b += tap[2] * w
        a += tap[3] * w
        total += w
      }
      write(out, i, r / total, g / total, b / total, a / total)
    }
  }
  return out
}

/** `SHARPEN_FRAG` — unsharp mask on a 4-neighbour cross. */
function sharpenPass(src: Pixels, amount: number, radius: number, pixelScale: number): Pixels {
  const r0 = radius * pixelScale
  const out = clone(src)
  const centre: Rgba = [0, 0, 0, 0]
  const tap: Rgba = [0, 0, 0, 0]
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4
      sampleBilinear(src, x, y, centre)
      let br = centre[0] * 2
      let bg = centre[1] * 2
      let bb = centre[2] * 2
      sampleBilinear(src, x + r0, y, tap)
      br += tap[0]
      bg += tap[1]
      bb += tap[2]
      sampleBilinear(src, x - r0, y, tap)
      br += tap[0]
      bg += tap[1]
      bb += tap[2]
      sampleBilinear(src, x, y + r0, tap)
      br += tap[0]
      bg += tap[1]
      bb += tap[2]
      sampleBilinear(src, x, y - r0, tap)
      br += tap[0]
      bg += tap[1]
      bb += tap[2]
      br /= 6
      bg /= 6
      bb /= 6
      write(
        out,
        i,
        centre[0] + (centre[0] - br) * amount * 2,
        centre[1] + (centre[1] - bg) * amount * 2,
        centre[2] + (centre[2] - bb) * amount * 2,
        centre[3],
      )
    }
  }
  return out
}

const RING_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
]

type Rgb3 = { r: number; g: number; b: number }

function ringAverage(src: Pixels, x: number, y: number, radius: number, tap: Rgba): Rgb3 {
  let r = 0
  let g = 0
  let b = 0
  for (const [dx, dy] of RING_OFFSETS) {
    sampleBilinear(src, x + dx * radius, y + dy * radius, tap)
    r += tap[0]
    g += tap[1]
    b += tap[2]
  }
  return { r: r / 8, g: g / 8, b: b / 8 }
}

/** `DEFINITION_FRAG` — local contrast at 1x / 2x / 4x the base radius. */
function definitionPass(src: Pixels, amount: number, radius: number, pixelScale: number): Pixels {
  const base = radius * pixelScale
  const out = clone(src)
  const centre: Rgba = [0, 0, 0, 0]
  const tap: Rgba = [0, 0, 0, 0]
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4
      sampleBilinear(src, x, y, centre)
      const near = ringAverage(src, x, y, base, tap)
      const mid = ringAverage(src, x, y, base * 2, tap)
      const far = ringAverage(src, x, y, base * 4, tap)
      write(
        out,
        i,
        centre[0] +
          amount *
            ((centre[0] - near.r) * 0.2 + (centre[0] - mid.r) * 0.3 + (centre[0] - far.r) * 0.5),
        centre[1] +
          amount *
            ((centre[1] - near.g) * 0.2 + (centre[1] - mid.g) * 0.3 + (centre[1] - far.g) * 0.5),
        centre[2] +
          amount *
            ((centre[2] - near.b) * 0.2 + (centre[2] - mid.b) * 0.3 + (centre[2] - far.b) * 0.5),
        centre[3],
      )
    }
  }
  return out
}

/**
 * `HSL_FRAG`, in floating point.
 *
 * `applyHslMix` in `src/lib/hsl.ts` rounds to 0..255 integers on the way out,
 * which is right for a UI preview and wrong for a render: the GL path never
 * rounds, so a half-level of quantisation per pixel showed up as a ~1/255 mean
 * difference across the whole frame. This mirrors the shader exactly.
 */
export function hslMixFloat(
  rgb: readonly [number, number, number],
  mix: HslMix,
): [number, number, number] {
  const [r, g, b] = rgb
  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  const l = (maxC + minC) * 0.5
  const d = maxC - minC
  let h = 0
  let sat = 0
  if (d > 1e-5) {
    sat = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC)
    if (maxC === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (maxC === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  const band = hueBandOf(h * 360)
  const shift = mix[band]
  const hue = h + shift.hue / 360
  return hslToRgbFloat([
    hue - Math.floor(hue),
    clamp01(sat * (1 + shift.sat / 100)),
    clamp01(l * (1 + shift.lum / 100)),
  ])
}

function hueBandOf(degrees: number): HslBand {
  const h = ((degrees % 360) + 360) % 360
  if (h >= 345 || h < 15) return 'red'
  if (h < 45) return 'orange'
  if (h < 75) return 'yellow'
  if (h < 165) return 'green'
  if (h < 195) return 'aqua'
  if (h < 265) return 'blue'
  if (h < 315) return 'purple'
  return 'magenta'
}

/** `hue2rgb`/`hsl2rgb` from `HSL_FRAG`, without the 0..255 rounding. */
function hslToRgbFloat(hsl: readonly [number, number, number]): [number, number, number] {
  const [h, s, l] = hsl
  if (s <= 1e-5) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

function hue2rgb(p: number, q: number, t0: number): number {
  let t = t0
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

/** `EFFECTS_FRAG` — field blur, then bloom, then grain, in that order. */
function effectsPass(
  src: Pixels,
  pass: { grain: number; bloom: number; fieldBlur: number },
  context: PassContext,
): Pixels {
  const { pixelScale } = context
  const origin = context.origin ?? { x: 0, y: 0 }
  let current = src
  const tap: Rgba = [0, 0, 0, 0]

  if (pass.fieldBlur > 0.001) {
    const radius = (2 + pass.fieldBlur * 40) * pixelScale
    const out = clone(current)
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        const i = (y * current.width + x) * 4
        // The centre sample has to be kept: the loop below overwrites `tap`,
        // and `EFFECTS_FRAG` blends the halo against texel.rgb, not against
        // whichever ring tap happened to run last.
        sampleBilinear(current, x, y, tap)
        const c = [tap[0], tap[1], tap[2]] as const
        const alpha = tap[3]
        let r = 0
        let g = 0
        let b = 0
        let total = 0
        for (let k = 0; k < 8; k += 1) {
          const fi = k + 1
          const w = tapWeight(k)
          const [dx, dy] = KERNEL_DIRS[k]!
          sampleBilinear(current, x + (dx * radius * fi) / 4, y + (dy * radius * fi) / 4, tap)
          r += tap[0] * w
          g += tap[1] * w
          b += tap[2] * w
          total += w
        }
        r /= total
        g /= total
        b /= total
        write(
          out,
          i,
          mix(c[0], r, pass.fieldBlur),
          mix(c[1], g, pass.fieldBlur),
          mix(c[2], b, pass.fieldBlur),
          alpha,
        )
      }
    }
    current = out
  }

  if (pass.bloom > 0.001) {
    const step = bloomStepPx(current, pixelScale)
    const out = clone(current)
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        const i = (y * current.width + x) * 4
        sampleBilinear(current, x, y, tap)
        // The centre sample's alpha, not the last halo tap's: `EFFECTS_FRAG`
        // writes texel.a, so borrowing a neighbour's alpha erodes every
        // semi-transparent edge.
        const alpha = tap[3]
        const c = [tap[0], tap[1], tap[2]] as const
        let hr = 0
        let hg = 0
        let hb = 0
        sampleBilinear(current, x + step.x, y, tap)
        hr += tap[0]
        hg += tap[1]
        hb += tap[2]
        sampleBilinear(current, x - step.x, y, tap)
        hr += tap[0]
        hg += tap[1]
        hb += tap[2]
        sampleBilinear(current, x, y + step.y, tap)
        hr += tap[0]
        hg += tap[1]
        hb += tap[2]
        sampleBilinear(current, x, y - step.y, tap)
        hr += tap[0]
        hg += tap[1]
        hb += tap[2]
        const bright = [
          Math.max(c[0] - 0.7, 0),
          Math.max(c[1] - 0.7, 0),
          Math.max(c[2] - 0.7, 0),
        ] as const
        const halo = [
          Math.max(hr / 4 - 0.7, 0),
          Math.max(hg / 4 - 0.7, 0),
          Math.max(hb / 4 - 0.7, 0),
        ] as const
        write(
          out,
          i,
          c[0] + (halo[0] + bright[0]) * pass.bloom * 0.8,
          c[1] + (halo[1] + bright[1]) * pass.bloom * 0.8,
          c[2] + (halo[2] + bright[2]) * pass.bloom * 0.8,
          alpha,
        )
      }
    }
    current = out
  }

  if (pass.grain > 0.001) {
    // `EFFECTS_FRAG` hashes `pixel * (0.5 * u_pixelScale)`, where `pixel` is the
    // fragment's own position in the whole frame plus the tile origin. Keeping
    // the cell count fixed across scales is what makes a 6000 px export carry
    // the same grain structure the preview shows.
    const k = pixelScale / GRAIN_CELL_PX
    const out = clone(current)
    for (let y = 0; y < current.height; y += 1) {
      for (let x = 0; x < current.width; x += 1) {
        const i = (y * current.width + x) * 4
        // The framebuffer this buffer mirrors is bottom-up, so the row index
        // `EFFECTS_FRAG` would see for the same image row is `height - y`.
        const n =
          grainHash((x + 0.5 + origin.x) * k, (current.height - y - 0.5 + origin.y) * k) - 0.5
        write(
          out,
          i,
          current.data[i]! / 255 + n * pass.grain * 0.18,
          current.data[i + 1]! / 255 + n * pass.grain * 0.18,
          current.data[i + 2]! / 255 + n * pass.grain * 0.18,
          current.data[i + 3]! / 255,
        )
      }
    }
    current = out
  }

  return current
}

/**
 * `GEOMETRY_FRAG` as a per-pixel inverse map. Only used when the matrix is
 * genuinely projective: `ctx.setTransform` takes six scalars and silently
 * discards `m[6]` / `m[7]`, which is what used to make a perspective warp
 * impossible on this backend.
 */
/**
 * Whether the leading geometry pass clamps its sample to the source or leaves
 * everything outside the source transparent. `runCpuPasses` skips the geometry
 * pass, so the caller has to resample with the same flag the shader was given
 * or a rotated or warped frame grows an opaque border on one engine and a
 * transparent one on the other.
 */
export function leadingGeometryClamp(passes: readonly Pass[]): boolean {
  const first = passes[0]
  return first?.kind === 'geometry' && first.clamp === true
}

/**
 * Resample `src` through a projective matrix.
 *
 * The output→source transform is a full 3x3, so this is the exact twin of
 * `GEOMETRY_FRAG`: crop, rotate, straighten, flip and perspective collapse into
 * one inverse-mapped resample. A Canvas2D `setTransform` cannot do it — it
 * takes six scalars and silently discards the projective terms.
 */
export function projectiveResample(
  src: Pixels,
  matrix: readonly number[],
  outWidth: number,
  outHeight: number,
  sourceSize: { width: number; height: number },
  clamp: boolean,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): Pixels {
  const out = makePixels(outWidth, outHeight)
  const tap: Rgba = [0, 0, 0, 0]
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const i = (y * outWidth + x) * 4
      const px = origin.x + x + 0.5
      const py = origin.y + y + 0.5
      const w = matrix[6]! * px + matrix[7]! * py + matrix[8]! || 1
      const sx = (matrix[0]! * px + matrix[1]! * py + matrix[2]!) / w
      const sy = (matrix[3]! * px + matrix[4]! * py + matrix[5]!) / w
      const u = sx / Math.max(1, sourceSize.width)
      const v = sy / Math.max(1, sourceSize.height)
      if (!clamp && (u < 0 || u > 1 || v < 0 || v > 1)) {
        write(out, i, 0, 0, 0, 0)
        continue
      }
      // `uv * size - 0.5` is the texel coordinate a GL sampler would use, so
      // uv `(x + 0.5) / size` lands exactly on texel x. Using `uv * (size - 1)`
      // instead biases the resample half a texel and smears every edge.
      sampleBilinear(src, clamp01(u) * src.width - 0.5, clamp01(v) * src.height - 0.5, tap)
      write(out, i, tap[0], tap[1], tap[2], tap[3])
    }
  }
  return out
}

/**
 * `LOCAL_FRAG`: `TONE_FRAG` then `COLOR_FRAG`, weighted by the mask.
 *
 * The mask comes from `maskValueAt` — the same function `MASK_FRAG` is a
 * transliteration of — quantised to the eight bits the shader's R8 mask target
 * holds, so the two engines weigh by the identical field.
 */
export function localAt(
  rgb: readonly [number, number, number],
  values: Record<string, number>,
  weight: number,
): [number, number, number] {
  const tone = toneAdjustmentsAt(rgb, {
    exposure: values.exposure ?? 0,
    brightness: values.brightness ?? 0,
    contrast: values.contrast ?? 0,
    highlights: values.highlights ?? 0,
    shadows: values.shadows ?? 0,
    blackPoint: values.blackPoint ?? 0,
    brilliance: values.brilliance ?? 0,
  })
  // TONE_FRAG ends in a clamp and COLOR_FRAG reads that clamped value.
  const toned: [number, number, number] = [clamp01(tone[0]), clamp01(tone[1]), clamp01(tone[2])]
  const colour = colorAt(toned, {
    saturation: values.saturation ?? 0,
    vibrance: values.vibrance ?? 0,
    warmth: values.warmth ?? 0,
    tint: values.tint ?? 0,
  })
  return [
    mix(rgb[0], clamp01(colour[0]), weight),
    mix(rgb[1], clamp01(colour[1]), weight),
    mix(rgb[2], clamp01(colour[2]), weight),
  ]
}

function localPass(
  src: Pixels,
  pass: Extract<Pass, { kind: 'local' }>,
  context: PassContext,
): Pixels {
  const aspect = frameAspect(context, src)
  return pointPass(src, (rgb, uv, set) => {
    const [px, py] = outputPoint(uv, src, context)
    const exact = maskValueAt(pass.mask, px, py, {
      luma: luma(rgb[0], rgb[1], rgb[2]),
      alpha: rgb[3],
      aspect,
    })
    // MASK_FRAG writes into an R8 target, so the shader weighs by the same
    // eight-bit field this side has to read. A float mask here would leave a
    // half-code difference amplified by the adjustment.
    const weight = Math.round(clamp01(exact) * 255) / 255
    const c = localAt([rgb[0], rgb[1], rgb[2]], pass.values, weight)
    set(c[0], c[1], c[2], rgb[3])
  })
}

/** `RETOUCH_FRAG` — the bilateral skin filter, over the whole buffer. */
function retouchPass(src: Pixels, smooth: number, context: PassContext): Pixels {
  return pointPass(src, (_rgb, uv, set) => {
    const s = smoothAt(src, uv.x, uv.y, smooth, context.pixelScale)
    set(s[0], s[1], s[2], s[3])
  })
}

/** `HEAL_FRAG` / `REDEYE_FRAG` — one spot each, so a pass never grows unbounded. */
function spotPass(
  src: Pixels,
  pass: Extract<Pass, { kind: 'heal' | 'redeye' }>,
  context: PassContext,
): Pixels {
  const squeeze = 1 / frameAspect(context, src)
  const at: [number, number] = [pass.at.x, pass.at.y]
  return pointPass(src, (_rgb, uv, set) => {
    const s =
      pass.kind === 'heal'
        ? healAt(src, uv.x, uv.y, at, pass.radius, squeeze)
        : redEyeAt(src, uv.x, uv.y, at, pass.radius, squeeze)
    set(s[0], s[1], s[2], s[3])
  })
}

/** `BACKGROUND_FRAG`'s `u_mode == 3` branch: the image, fitted and blurred. */
function backgroundImagePass(
  src: Pixels,
  pass: Extract<Pass, { kind: 'background' }>,
  image: Pixels,
  context: PassContext,
): Pixels {
  const origin = context.origin ?? { x: 0, y: 0 }
  const frame = context.frame ?? src
  const scale = backgroundScale(pass.background.fit, frame, image)
  const radiusPx = backgroundBlurRadiusPx(pass.background.blur, context.pixelScale)
  const stepTexels = radiusPx / scale
  const flat = hexToRgb(pass.background.color)
  const tap: Rgba = [0, 0, 0, 0]
  return pointPass(src, (rgb, uv, set) => {
    // `backgroundImageUv` measures from the frame's centre, which is what the
    // shader's `px = (v_uv - 0.5) * u_frameSize` hands it.
    const px = origin.x + uv.x * src.width - frame.width / 2
    const py = origin.y + uv.y * src.height - frame.height / 2
    const at = backgroundImageUv(pass.background.fit, frame, image, px, py)
    let bg: readonly [number, number, number] = flat
    if (!backgroundOutsideImage(at)) {
      // Texel coordinates, exactly what `texture()` resolves a uv to.
      const tx = at.u * image.width - 0.5
      const ty = at.v * image.height - 0.5
      let r = 0
      let g = 0
      let b = 0
      let total = 1
      sampleBilinear(image, tx, ty, tap)
      r += tap[0]
      g += tap[1]
      b += tap[2]
      if (pass.background.blur > 0) {
        for (let i = 0; i < BACKGROUND_DIRS.length; i += 1) {
          const [dx, dy] = BACKGROUND_DIRS[i]!
          const ring = (i + 1) / 4
          const w = Math.exp(-(ring * ring) / 8)
          sampleBilinear(image, tx + dx * stepTexels * ring, ty + dy * stepTexels * ring, tap)
          r += tap[0] * w
          g += tap[1] * w
          b += tap[2] * w
          total += w
        }
      }
      bg = [r / total, g / total, b / total]
    }
    set(
      mix(bg[0], rgb[0], rgb[3]),
      mix(bg[1], rgb[1], rgb[3]),
      mix(bg[2], rgb[2], rgb[3]),
      pass.keepAlpha ? rgb[3] : 1,
    )
  })
}

// --- the driver --------------------------------------------------------------

export type GatedReport = PassFamily[]

/**
 * Run a `planPasses` output over a byte buffer. Families this backend cannot
 * reproduce are skipped and returned in `gated` — never silently approximated.
 */
export function runCpuPasses(
  input: Pixels,
  passes: Pass[],
  context: PassContext = DEFAULT_CONTEXT,
): { pixels: Pixels; gated: GatedReport } {
  const gated: GatedReport = []
  let current = input
  const sharpenRadiusAt = (amount: number) => 1 + amount * 1.5
  const definitionRadiusAt = (amount: number) => 1 + amount * 2

  for (const pass of passes) {
    switch (pass.kind) {
      case 'geometry':
      case 'layers':
        // Geometry is the caller's transform; layers are the shared 2D overlay.
        continue
      case 'local':
        current = localPass(current, pass, context)
        break
      case 'retouch':
        current = retouchPass(current, pass.smooth, context)
        break
      case 'heal':
      case 'redeye':
        current = spotPass(current, pass, context)
        break
      case 'tone':
        current = pointPass(current, (rgb, _uv, set) => {
          const c = toneAt([rgb[0], rgb[1], rgb[2]], pass)
          set(c[0], c[1], c[2], rgb[3])
        })
        break
      case 'color':
        current = pointPass(current, (rgb, _uv, set) => {
          const c = colorAt([rgb[0], rgb[1], rgb[2]], pass)
          set(c[0], c[1], c[2], rgb[3])
        })
        break
      case 'curves': {
        const luts = buildChannelLuts(pass.curves)
        current = pointPass(current, (rgb, _uv, set) => {
          const r = sampleLut(luts.r, sampleLut(luts.rgb, rgb[0]))
          const g = sampleLut(luts.g, sampleLut(luts.rgb, rgb[1]))
          const b = sampleLut(luts.b, sampleLut(luts.rgb, rgb[2]))
          set(r, g, b, rgb[3])
        })
        break
      }
      case 'hsl':
        current = pointPass(current, (rgb, _uv, set) => {
          const mixed = hslMixFloat([rgb[0], rgb[1], rgb[2]], pass.mix)
          set(mixed[0], mixed[1], mixed[2], rgb[3])
        })
        break
      case 'lut3d':
        if (!gated.includes('lut3d')) gated.push('lut3d')
        continue
      case 'denoise':
        current = denoisePass(current, pass.amount, context.pixelScale)
        break
      case 'sharpen':
        current = sharpenPass(
          current,
          pass.amount,
          sharpenRadiusAt(pass.amount),
          context.pixelScale,
        )
        break
      case 'definition':
        current = definitionPass(
          current,
          pass.amount,
          definitionRadiusAt(pass.amount),
          context.pixelScale,
        )
        break
      case 'effects':
        current = effectsPass(current, pass, context)
        break
      case 'vignette':
        current = pointPass(current, (rgb, uv, set) => {
          const c = vignetteAt([rgb[0], rgb[1], rgb[2]], uv, pass.amount)
          set(c[0], c[1], c[2], rgb[3])
        })
        break
      case 'background': {
        if (pass.background.mode === 'image' && context.backgroundImage) {
          current = backgroundImagePass(current, pass, context.backgroundImage, context)
          break
        }
        const flat = hexToRgb(pass.background.color)
        const from = hexToRgb(pass.background.gradient.from)
        const to = hexToRgb(pass.background.gradient.to)
        const gradient = pass.background.mode === 'gradient'
        const cutout = pass.keepAlpha
        current = pointPass(current, (rgb, uv, set) => {
          let bg: readonly [number, number, number] = flat
          if (gradient) {
            // gradientStop wants bottom-up v_uv (it flips to top-down itself);
            // this buffer's rows run top-down, the same as v_uv.x.
            const t = gradientStop({ x: uv.x, y: 1 - uv.y }, pass.background.gradient.angle)
            bg = [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)]
          }
          set(
            mix(bg[0], rgb[0], rgb[3]),
            mix(bg[1], rgb[1], rgb[3]),
            mix(bg[2], rgb[2], rgb[3]),
            cutout ? rgb[3] : 1,
          )
        })
        break
      }
      case 'output': {
        const matte = hexToRgb(pass.matte)
        const origin = context.origin ?? { x: 0, y: 0 }
        const { width, height } = current
        current = pointPass(current, (rgb, uv, set) => {
          let r = rgb[0]
          let g = rgb[1]
          let b = rgb[2]
          let a = rgb[3]
          if (pass.flatten) {
            r = mix(matte[0], r, a)
            g = mix(matte[1], g, a)
            b = mix(matte[2], b, a)
            a = 1
          } else if (!pass.alpha) {
            a = 1
          }
          // D3-F23. This pass is the chain's only 8-bit quantisation step, so
          // the dither belongs here and nowhere above. The frame pixel is
          // `origin + uv * size`, which is what `OUTPUT_FRAG` reconstructs from
          // `v_uv`, `u_texel` and `u_origin` - a tiled export has to walk the
          // same whole-frame coordinates the shader does.
          const d = ditherOffsetLsb(origin.x + uv.x * width, origin.y + uv.y * height, pass.dither)
          set(r + d / 255, g + d / 255, b + d / 255, a)
        })
        break
      }
      default:
        break
    }
  }

  return { pixels: current, gated }
}

/** Families the plan wants that `runCpuPasses` will not reproduce. */
export function gatedFamilies(passes: Pass[]): GatedReport {
  return runCpuPasses(makePixels(1, 1), passes).gated
}
