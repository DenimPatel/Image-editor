import type { Background, Curves, Doc, HslMix, Layer, Mask, Point, Size } from '../model/types'
import { DITHER_LSB } from '../lib/tonemap'
import { localAdjustIsNeutral, localAdjustUniforms } from './mask'
import type { Mat3 } from './geometry'

/**
 * The ordered render plan. `planPasses` is pure and deterministic so the plan
 * can be unit-tested and hashed without a GPU: identity passes are skipped,
 * and `planHash` is a sound "did anything change" key — the GL renderer skips
 * a frame whose plan, size and source all hash the same.
 */

export type TonePass = {
  kind: 'tone'
  exposure: number
  brightness: number
  contrast: number
  highlights: number
  shadows: number
  blackPoint: number
  brilliance: number
}

export type ColorPass = {
  kind: 'color'
  saturation: number
  vibrance: number
  warmth: number
  tint: number
}

export type GeometryPass = { kind: 'geometry'; matrix: Mat3; clamp?: boolean }

export type CurvesPass = { kind: 'curves'; curves: Curves }
export type HslPass = { kind: 'hsl'; mix: HslMix }
export type Lut3dPass = { kind: 'lut3d'; id: string; amount: number }
export type DenoisePass = { kind: 'denoise'; amount: number }
export type DefinitionPass = { kind: 'definition'; amount: number }
export type SharpenPass = { kind: 'sharpen'; amount: number }
export type VignettePass = { kind: 'vignette'; amount: number }
export type EffectsPass = { kind: 'effects'; grain: number; bloom: number; fieldBlur: number }
/** The mask a `local` pass weighs by, resolved at plan time. */
export type LocalPass = {
  kind: 'local'
  maskId: string
  mask: Mask
  values: Record<string, number>
}
/** Skin smoothing (D1-F13), a bilateral filter over the whole frame. */
export type RetouchPass = { kind: 'retouch'; smooth: number }
/** One heal spot, so no shader needs an unbounded array of them. */
export type HealPass = { kind: 'heal'; at: Point; radius: number }
/** One red-eye spot, same reasoning as `HealPass`. */
export type RedEyePass = { kind: 'redeye'; at: Point; radius: number }
export type BackgroundPass = {
  kind: 'background'
  background: Background
  /** True for the cut-out mode: keep the subject's alpha instead of flattening. */
  keepAlpha: boolean
}
export type LayersPass = { kind: 'layers'; layers: Layer[] }
export type OutputPass = {
  kind: 'output'
  width: number
  height: number
  matte: string
  flatten: boolean
  alpha: boolean
  /**
   * D3-F23: ordered-dither amplitude in 8-bit levels, applied at the one
   * quantisation step in the chain. `0` disables it, which is what a test
   * comparing the banded ramp against the dithered one runs.
   */
  dither: number
}

export type Pass =
  | GeometryPass
  | TonePass
  | ColorPass
  | CurvesPass
  | HslPass
  | Lut3dPass
  | DenoisePass
  | DefinitionPass
  | SharpenPass
  | VignettePass
  | EffectsPass
  | LocalPass
  | RetouchPass
  | HealPass
  | RedEyePass
  | BackgroundPass
  | LayersPass
  | OutputPass

/**
 * The pass families a capability table is written against. `layers` is
 * deliberately absent: it is not a shader pass at all — layers are composited
 * on the presentation canvas by `src/render/layers.ts`, outside both engines.
 */
export type PassFamily =
  | 'geometry'
  | 'tone'
  | 'color'
  | 'curves'
  | 'hsl'
  | 'lut3d'
  | 'denoise'
  | 'definition'
  | 'sharpen'
  | 'local'
  | 'retouch'
  | 'heal'
  | 'redeye'
  | 'effects'
  | 'vignette'
  | 'background'
  | 'output'

const IDENTITY_CURVE_POINTS = [
  [0, 0],
  [255, 255],
]

export function areCurvesIdentity(curves: Curves): boolean {
  for (const channel of ['rgb', 'r', 'g', 'b'] as const) {
    const points = curves[channel]
    if (points.length !== 2) return false
    if (
      points[0].x !== IDENTITY_CURVE_POINTS[0][0] ||
      points[0].y !== IDENTITY_CURVE_POINTS[0][1]
    ) {
      return false
    }
    if (
      points[1].x !== IDENTITY_CURVE_POINTS[1][0] ||
      points[1].y !== IDENTITY_CURVE_POINTS[1][1]
    ) {
      return false
    }
  }
  return true
}

function isHslNeutral(mix: HslMix): boolean {
  return Object.values(mix).every((band) => band.hue === 0 && band.sat === 0 && band.lum === 0)
}

function isPerspectiveIdentity(background: Doc['geometry']['perspective']): boolean {
  return Object.values(background).every((point) => point.x === 0 && point.y === 0)
}

function isGeometryIdentity(doc: Doc): boolean {
  const { orientation, straighten, crop, perspective } = doc.geometry
  return (
    orientation.quarterTurns === 0 &&
    !orientation.flipH &&
    !orientation.flipV &&
    straighten === 0 &&
    isPerspectiveIdentity(perspective) &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === 1 &&
    crop.height === 1
  )
}

/** Convert the -100..100 Adjust model into normalized shader values. */
function normalizedAdjust(doc: Doc): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(doc.adjust)) out[key] = value / 100
  // Exposure is authored in EV already.
  out.exposure = doc.adjust.exposure
  return out
}

export function planPasses(doc: Doc, size: Size, geometryMatrix?: Mat3): Pass[] {
  const passes: Pass[] = []
  const adjust = normalizedAdjust(doc)
  const has = (...keys: (keyof Doc['adjust'])[]) => keys.some((key) => doc.adjust[key] !== 0)

  if (!isGeometryIdentity(doc) && geometryMatrix) {
    passes.push({ kind: 'geometry', matrix: geometryMatrix })
  }

  if (
    has('exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'blackPoint', 'brilliance')
  ) {
    passes.push({
      kind: 'tone',
      exposure: adjust.exposure,
      brightness: adjust.brightness,
      contrast: adjust.contrast,
      highlights: adjust.highlights,
      shadows: adjust.shadows,
      blackPoint: adjust.blackPoint,
      brilliance: adjust.brilliance,
    })
  }

  if (has('saturation', 'vibrance', 'warmth', 'tint')) {
    passes.push({
      kind: 'color',
      saturation: adjust.saturation,
      vibrance: adjust.vibrance,
      warmth: adjust.warmth,
      tint: adjust.tint,
    })
  }

  if (!areCurvesIdentity(doc.curves)) {
    passes.push({ kind: 'curves', curves: doc.curves })
  }

  if (!isHslNeutral(doc.hsl)) {
    passes.push({ kind: 'hsl', mix: doc.hsl })
  }

  if (doc.look.id !== null) {
    passes.push({ kind: 'lut3d', id: doc.look.id, amount: doc.look.amount })
  }

  // Retouch runs before the detail stack: smoothing, then healing, then the
  // neighbourhood kernels that put the edge back afterwards.
  if (doc.retouch.smooth > 0) {
    passes.push({ kind: 'retouch', smooth: doc.retouch.smooth / 100 })
  }
  for (const spot of doc.retouch.healSpots) {
    passes.push({ kind: 'heal', at: spot.at, radius: spot.radius })
  }
  for (const spot of doc.retouch.redEye) {
    passes.push({ kind: 'redeye', at: spot.at, radius: spot.radius })
  }

  if (doc.adjust.noiseReduction > 0) {
    passes.push({ kind: 'denoise', amount: doc.adjust.noiseReduction / 100 })
  }
  if (doc.adjust.definition > 0) {
    passes.push({ kind: 'definition', amount: doc.adjust.definition / 100 })
  }
  if (doc.adjust.sharpness > 0) {
    passes.push({ kind: 'sharpen', amount: doc.adjust.sharpness / 100 })
  }

  for (const local of doc.localAdjusts) {
    if (!local.enabled) continue
    const mask = doc.masks.find((candidate) => candidate.id === local.maskId)
    if (!mask || !mask.enabled) continue
    // Only the tone and colour adjustments are per-pixel, so only those can be
    // masked; a local sharpness of 40 is dropped here rather than uploaded to
    // a uniform the pass does not have.
    const authored: Record<string, number> = {}
    for (const [key, value] of Object.entries(local.values)) {
      if (typeof value === 'number' && Number.isFinite(value)) authored[key] = value
    }
    const values = localAdjustUniforms(authored)
    if (localAdjustIsNeutral(values)) continue
    const normalized: Record<string, number> = {}
    for (const [key, value] of Object.entries(values)) {
      normalized[key] = key === 'exposure' ? value : value / 100
    }
    passes.push({ kind: 'local', maskId: mask.id, mask, values: normalized })
  }

  if (doc.background.mode !== 'none' || doc.background.removed) {
    passes.push({
      kind: 'background',
      background: doc.background,
      keepAlpha: doc.background.mode === 'none',
    })
  }

  if (doc.effects.fieldBlur > 0) {
    passes.push({
      kind: 'effects',
      grain: 0,
      bloom: 0,
      fieldBlur: doc.effects.fieldBlur / 100,
    })
  }
  if (doc.effects.bloom > 0) {
    passes.push({ kind: 'effects', grain: 0, bloom: doc.effects.bloom / 100, fieldBlur: 0 })
  }
  if (doc.effects.grain > 0 || doc.adjust.vignette !== 0) {
    passes.push({
      kind: 'effects',
      grain: doc.effects.grain / 100,
      bloom: 0,
      fieldBlur: 0,
    })
    if (doc.adjust.vignette !== 0) {
      passes.push({ kind: 'vignette', amount: doc.adjust.vignette / 100 })
    }
  }

  const visibleLayers = doc.layers.filter((layer) => layer.visible)
  if (visibleLayers.length > 0) {
    passes.push({ kind: 'layers', layers: visibleLayers })
  }

  passes.push({
    kind: 'output',
    width: size.width,
    height: size.height,
    matte: doc.output.matte,
    flatten: doc.output.format === 'jpeg' || doc.output.format === 'pdf',
    alpha:
      (doc.output.format === 'png' ||
        doc.output.format === 'webp' ||
        doc.output.format === 'avif') &&
      doc.background.mode === 'none',
    dither: DITHER_LSB,
  })

  return passes
}

/**
 * Guarantee the render plan starts with a geometry pass.
 *
 * The source texture is uploaded without `UNPACK_FLIP_Y_WEBGL` (Safari and
 * some Chrome builds ignore that flag for `ImageBitmap`), so its rows run
 * top-down while framebuffer textures run bottom-up. Resampling the source
 * once into the framebuffer pipeline — even for a "no-op" edit — keeps every
 * later pass on one consistent axis and fixes the upside-down preview.
 */
export function withLeadingGeometry(passes: Pass[], matrix: Mat3): Pass[] {
  if (passes.some((pass) => pass.kind === 'geometry')) return passes
  return [{ kind: 'geometry', matrix, clamp: true }, ...passes]
}

/**
 * Stable hash of a plan: equal hashes mean the two plans produce identical
 * pixels, so it is safe to skip a render whose size and source are also
 * unchanged.
 *
 * Every branch has to cover *every* field the pass consumes. Hashing
 * `layer.id:layer.kind` looked cheap and was wrong — dragging a text layer or
 * restyling it changed nothing — and the background branch omitted `gradient`,
 * `blur`, `fit` and `removed` outright. Both are now full serialisations of
 * JSON-serializable data, which is exactly what `Doc` guarantees.
 */
export function planHash(passes: Pass[]): string {
  return passes
    .map((pass) => {
      switch (pass.kind) {
        case 'geometry':
          return `geo:${pass.matrix.map((n) => n.toFixed(5)).join(',')}:${pass.clamp ? 1 : 0}`
        case 'curves':
          return `curves:${(['rgb', 'r', 'g', 'b'] as const)
            .map((c) => pass.curves[c].map((p) => `${p.x}:${p.y}`).join('|'))
            .join(';')}`
        case 'hsl':
          return `hsl:${Object.entries(pass.mix)
            .map(([band, value]) => `${band}${value.hue},${value.sat},${value.lum}`)
            .join(';')}`
        case 'layers':
          return `layers:${JSON.stringify(pass.layers)}`
        case 'local':
          // Both the mask and the values, and the mask's id: two local adjusts
          // can share a mask and differ only in id-bound provenance, and a
          // feather edit has to move the hash or the frame is skipped.
          return `local:${pass.maskId}:${JSON.stringify(pass.mask)}:${JSON.stringify(pass.values)}`
        case 'retouch':
          return `retouch:${pass.smooth}`
        case 'heal':
        case 'redeye':
          return `${pass.kind}:${pass.at.x}:${pass.at.y}:${pass.radius}`
        case 'background':
          return `bg:${JSON.stringify(pass.background)}:${pass.keepAlpha ? 1 : 0}`
        case 'output':
          // `dither` is in the hash: a plan that dithered and a plan that did
          // not produce different bytes, so skipping the frame on an unchanged
          // hash would have kept the old image on screen.
          return `out:${pass.width}x${pass.height}:${pass.matte}:${pass.flatten ? 1 : 0}:${
            pass.alpha ? 1 : 0
          }:${pass.dither}`
        default:
          return `${pass.kind}:${JSON.stringify(pass)}`
      }
    })
    .join('>')
}
