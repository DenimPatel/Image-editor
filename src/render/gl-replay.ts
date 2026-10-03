/**
 * Replays a recorded WebGL2 frame on the CPU.
 *
 * The point of this module is that it never re-implements a shader. It takes
 * the `drawFrames` the fake GL recorded while `GlRenderer.render()` ran — the
 * linked fragment source and the exact uniform values the renderer uploaded —
 * and executes them through the GLSL interpreter in `src/gl/glsl-eval.ts`. So
 * the "GL side" of every parity comparison is the real pipeline, and editing a
 * constant in a shader breaks the test instead of drifting away from it.
 *
 * Conventions, all of them forced by the real backend:
 *  - framebuffer row 0 is the *bottom* of the image, so `v_uv.y` runs bottom-up
 *    and a sampler's `v` is measured from the bottom;
 *  - the first pass samples the source texture, whose rows are top-down, through
 *    the geometry matrix rather than through `v_uv`;
 *  - every pass writes to an RGBA8 target, so values are quantised to bytes
 *    between passes exactly as a driver would.
 */
import type { DrawFrame, UniformCall } from '../gl/fakegl'
import {
  compileFragment,
  runFragment,
  type CompiledShader,
  type GlslSampler,
  type GlslValue,
} from '../gl/glsl-eval'
import { buildChannelLuts } from '../lib/curves'
import type { Curves } from '../model/types'
import { makePixels, type Pixels } from './cpu-passes'

const COMPILED = new Map<string, CompiledShader>()

function compile(source: string): CompiledShader {
  let shader = COMPILED.get(source)
  if (!shader) {
    shader = compileFragment(source)
    COMPILED.set(source, shader)
  }
  return shader
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Bilinear with clamp-to-edge, which is what a LINEAR 2D texture does.
 * `uv * size - 0.5` is the texel coordinate: uv 0 is the left *edge* of the
 * first texel, so a fragment at `uv = (x + 0.5) / size` lands exactly on the
 * centre of texel x. Sampling at `uv * (size - 1)` instead shifts the whole
 * image by half a texel and doubles the effective width.
 *
 * Rows are texture rows. Whether texture row 0 is the top or the bottom of the
 * image is the *producer's* business — the source bitmap is uploaded top-down
 * and the geometry pass writes the framebuffer with the y flip — so a sampler
 * never flips: it reads what it is given.
 */
export function samplerOver(buffer: Pixels): GlslSampler {
  return (uv) => {
    // CLAMP_TO_EDGE clamps the texel coordinate, not the uv, so the half-texel
    // at each edge is included: a tap at coord -0.5 reads texel 0, not a
    // blend with an out-of-range texel.
    const u = Math.min(buffer.width - 1, Math.max(0, clamp01(uv[0] ?? 0) * buffer.width - 0.5))
    const v = Math.min(buffer.height - 1, Math.max(0, clamp01(uv[1] ?? 0) * buffer.height - 0.5))
    const x0 = Math.floor(u)
    const y0 = Math.floor(v)
    const x1 = Math.min(buffer.width - 1, x0 + 1)
    const y1 = Math.min(buffer.height - 1, y0 + 1)
    const tx = u - x0
    const ty = v - y0
    const out = [0, 0, 0, 0]
    for (let c = 0; c < 4; c += 1) {
      const p00 = (y0 * buffer.width + x0) * 4 + c
      const p10 = (y0 * buffer.width + x1) * 4 + c
      const p01 = (y1 * buffer.width + x0) * 4 + c
      const p11 = (y1 * buffer.width + x1) * 4 + c
      const top = buffer.data[p00]! + (buffer.data[p10]! - buffer.data[p00]!) * tx
      const bottom = buffer.data[p01]! + (buffer.data[p11]! - buffer.data[p01]!) * tx
      out[c] = (top + (bottom - top) * ty) / 255
    }
    return out
  }
}

/** The source bitmap as the GL backend uploaded it: rows top-down, no flip. */
export function sourceSampler(source: Pixels): GlslSampler {
  return samplerOver(source)
}

function curveSampler(lut: Uint8Array): GlslSampler {
  return (uv) => {
    const x = clamp01(uv[0] ?? 0) * 256 - 0.5
    const i = Math.floor(x)
    const t = x - i
    const a = lut[Math.min(255, Math.max(0, i))]! / 255
    const b = lut[Math.min(255, Math.max(0, i + 1))]! / 255
    return [a + (b - a) * t, 0, 0, 1]
  }
}

function toUniforms(calls: UniformCall[]): Record<string, GlslValue> {
  const uniforms: Record<string, GlslValue> = {}
  for (const call of calls) {
    switch (call.type) {
      case 'float':
      case 'int':
        uniforms[call.name] = call.value
        break
      case 'vec2':
        uniforms[call.name] = [call.value[0], call.value[1]]
        break
      case 'vec3':
        uniforms[call.name] = [call.value[0], call.value[1], call.value[2]]
        break
      case 'vec3[]': {
        // `uniform3fv` with a vec3 array is interleaved, not planar.
        const flat = call.value
        const bands: number[][] = []
        for (let i = 0; i + 2 < flat.length; i += 3) {
          bands.push([flat[i]!, flat[i + 1]!, flat[i + 2]!])
        }
        uniforms[call.name] = bands
        break
      }
      case 'vec4':
        uniforms[call.name] = [...call.value]
        break
      case 'mat3':
        // `Mat3` is row-major and the renderer uploads it with transpose = true,
        // so the recorded array is already in the order the shader multiplies.
        uniforms[call.name] = [
          call.value.slice(0, 3),
          call.value.slice(3, 6),
          call.value.slice(6, 9),
        ]
        break
      default:
        break
    }
  }
  return uniforms
}

function flatSampler(rgba: readonly [number, number, number, number]): GlslSampler {
  return () => [rgba[0], rgba[1], rgba[2], rgba[3]]
}

export type ReplayOptions = {
  curves: Curves | null
  /**
   * The `background.imageAssetId` bitmap, already decoded. The GL backend
   * uploads it as a texture and there is no texture to read back, so a test
   * hands the replay the same pixels the renderer was given.
   */
  backgroundImage?: Pixels
  /**
   * A brush mask's rasterised stroke field, the R8 texture `MASK_FRAG` samples
   * for the brush kind. `rasterizeMask` in `src/gl/mask.ts` is the only
   * producer of it, so passing it here is a wiring check rather than a second
   * implementation of the maths; the four closed-form kinds need no such help
   * because the shader evaluates them itself.
   */
  brushField?: Pixels
}

export type ReplayResult = { pixels: Pixels; draws: number }

/**
 * Run `frames` over `source` and return the last framebuffer, row-flipped.
 *
 * A frame that carries `u_maskKind` is the mask rasteriser: in the real backend
 * it writes to an R8 target of its own and the `local` pass that follows
 * samples that. Here it renders into a buffer that is neither the chain's
 * current texture nor its result, and becomes the `u_maskTex` sampler.
 */
export function replayGlFrames(
  source: Pixels,
  frames: DrawFrame[],
  options: ReplayOptions,
): ReplayResult {
  const sourceTex = sourceSampler(source)
  const samplers: Record<string, GlslSampler> = {
    u_tex: sourceTex,
    u_brushTex: options.brushField ? samplerOver(options.brushField) : flatSampler([0, 0, 0, 1]),
    u_maskTex: flatSampler([0, 0, 0, 1]),
    u_bgImage: options.backgroundImage
      ? samplerOver(options.backgroundImage)
      : flatSampler([1, 1, 1, 1]),
  }
  if (options.curves) {
    const luts = buildChannelLuts(options.curves)
    samplers.u_lutRgb = curveSampler(luts.rgb)
    samplers.u_lutR = curveSampler(luts.r)
    samplers.u_lutG = curveSampler(luts.g)
    samplers.u_lutB = curveSampler(luts.b)
  }
  let current = source
  let result = makePixels(source.width, source.height)
  let draws = 0

  for (const frame of frames) {
    const shader = compile(frame.fragmentSource)
    const uniforms = toUniforms(frame.uniforms)
    const isGeometry = uniforms.u_matrix !== undefined
    const isMask = uniforms.u_maskKind !== undefined
    // The leading geometry pass samples the source through its own uv; every
    // later pass samples the previous framebuffer through `v_uv`.
    samplers.u_tex = isGeometry ? sourceTex : samplerOver(current)
    if (uniforms.u_lutRgb !== undefined && options.curves) {
      const luts = buildChannelLuts(options.curves)
      samplers.u_lutRgb = curveSampler(luts.rgb)
      samplers.u_lutR = curveSampler(luts.r)
      samplers.u_lutG = curveSampler(luts.g)
      samplers.u_lutB = curveSampler(luts.b)
    }

    const outputSize = uniforms.u_outputSize
    const size = Array.isArray(outputSize) && !Array.isArray(outputSize[0]) ? outputSize : null
    const width = size ? (size[0] as number) : current.width
    const height = size ? (size[1] as number) : current.height
    const next = makePixels(width, height)
    for (let row = 0; row < height; row += 1) {
      // Framebuffer row 0 is the *bottom* of the image, so `gl_FragCoord.y`
      // runs bottom-up over this buffer and the geometry pass's y flip lines
      // the whole chain up with the real backend.
      const fragY = row + 0.5
      for (let col = 0; col < width; col += 1) {
        const fragX = col + 0.5
        const out = runFragment(shader, {
          uniforms,
          samplers,
          fragCoord: [fragX, fragY],
          vUv: [fragX / width, fragY / height],
        })
        const i = (row * width + col) * 4
        next.data[i] = Math.round(clamp01(out[0]!) * 255)
        next.data[i + 1] = Math.round(clamp01(out[1]!) * 255)
        next.data[i + 2] = Math.round(clamp01(out[2]!) * 255)
        next.data[i + 3] = Math.round(clamp01(out[3]!) * 255)
      }
    }
    if (isMask) {
      // A mask field is not part of the chain: it feeds the `local` pass that
      // follows and nothing else sees it.
      samplers.u_maskTex = samplerOver(next)
    } else {
      current = next
      result = next
    }
    draws += 1
  }
  return { pixels: flipVertical(result), draws }
}

/** A GL framebuffer's row 0 is the bottom of the image; the CPU buffer is not. */
export function flipVertical(pixels: Pixels): Pixels {
  const out = makePixels(pixels.width, pixels.height)
  for (let row = 0; row < pixels.height; row += 1) {
    const src = (pixels.height - 1 - row) * pixels.width * 4
    out.data.set(pixels.data.subarray(src, src + pixels.width * 4), row * pixels.width * 4)
  }
  return out
}

/** Mean absolute per-channel difference, in 0..255 units. */
export function meanAbsDiff(a: Pixels, b: Pixels): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  let total = 0
  for (let i = 0; i < a.data.length; i += 1) total += Math.abs(a.data[i]! - b.data[i]!)
  return total / a.data.length
}
