/**
 * CPU twins of the three retouch shaders in `src/gl/shaders/index.ts`
 * (`RETOUCH_FRAG`, `HEAL_FRAG`, `REDEYE_FRAG`).
 *
 * `doc.retouch` had a model, a default, a migration and a `hasEdits` entry
 * and nothing else: no pass, no producer, no pixels. These are the references
 * the Canvas2D backend runs, and the parity harness runs the *shaders* against
 * them, so the two engines are proven to agree rather than both being wrong in
 * the same way.
 *
 * Every function is a per-pixel operation over an RGBA buffer with the same
 * bilinear sampler and the same 8-tap direction set the shaders use, so a
 * mismatch is a real mismatch and not a sampling difference.
 */

/** The minimum a retouch kernel needs: a straight-alpha RGBA8 buffer. */
export type RetouchSource = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

export type Rgba = [number, number, number, number]

/**
 * Luma tolerance of the skin filter, in 0..1 Rec.709 luma. A neighbour whose
 * luma is further away than this from the centre gets almost no weight, which
 * is the entire reason the filter is edge-preserving: a blemish (well inside
 * the tolerance) is averaged away, an eyebrow or a lip edge (well outside it)
 * is left alone. A box blur has no such term and smears both.
 */
export const SMOOTH_RANGE = 0.08

/**
 * The eight sampling directions, y negated so the set is expressed in the
 * top-down buffer order `RetouchSource` uses. Negating the whole set maps it
 * onto itself, and the weights are per-direction rather than per-position, so
 * the shader's unflipped set and this one sum identically.
 */
export const SMOOTH_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.70710678, -0.70710678],
  [0, -1],
  [-0.70710678, -0.70710678],
  [-1, 0],
  [-0.70710678, 0.70710678],
  [0, 1],
  [0.70710678, 0.70710678],
]

/**
 * The rings each direction samples at, as multiples of the radius. The
 * innermost of the eight is 0.25 and the outermost is `SMOOTH_REACH`; the
 * reach is what a tiled render has to carry in its halo.
 */
export const SMOOTH_REACH = 4

/** Kernel radius in texels for a 0..1 amount, scaled for the render size. */
export function smoothRadius(amount: number, pixelScale: number): number {
  return (1 + amount * 3) * Math.max(1, pixelScale)
}

/** Rec.709 luma, matching `luma()` in the shader header. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** GLSL `smoothstep`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Bilinear sample with clamp-to-edge: the GL sampler's rules exactly. */
export function sampleRgba(src: RetouchSource, u: number, v: number): Rgba {
  const w = src.width
  const h = src.height
  const x = u * w - 0.5
  const y = v * h - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const out: Rgba = [0, 0, 0, 0]
  for (let channel = 0; channel < 4; channel += 1) {
    let acc = 0
    for (let j = 0; j < 2; j += 1) {
      const sy = Math.min(h - 1, Math.max(0, y0 + j))
      for (let i = 0; i < 2; i += 1) {
        const sx = Math.min(w - 1, Math.max(0, x0 + i))
        const weight = (i === 0 ? 1 - fx : fx) * (j === 0 ? 1 - fy : fy)
        acc += weight * (src.data[(sy * w + sx) * 4 + channel] / 255)
      }
    }
    out[channel] = acc
  }
  return out
}

/**
 * Skin smoothing: a bilateral (surface) filter. Each of eight directions is
 * sampled at two radii, `t` and `2t` for `t` in 0.25..2. A neighbour
 * contributes `exp(-ring^2 / 8)` spatially and
 * `exp(-0.5 * (dLuma / SMOOTH_RANGE)^2)` by range. The range term is what
 * makes it edge-preserving — see `SMOOTH_RANGE`; the flat spatial term is what
 * makes it reach past a blemish instead of only averaging its own interior.
 */
export function smoothAt(
  src: RetouchSource,
  u: number,
  v: number,
  amount: number,
  pixelScale: number,
): Rgba {
  const centre = sampleRgba(src, u, v)
  if (!(amount > 0)) return centre
  const radius = smoothRadius(amount, pixelScale)
  const du = radius / src.width
  const dv = radius / src.height
  const lc = luma(centre[0], centre[1], centre[2])
  let sr = centre[0]
  let sg = centre[1]
  let sb = centre[2]
  let total = 1
  for (let i = 0; i < SMOOTH_DIRS.length; i += 1) {
    const [dx, dy] = SMOOTH_DIRS[i]!
    const t = (i + 1) / 4
    for (const ring of [t, t * 2]) {
      const neighbour = sampleRgba(src, u + dx * du * ring, v + dy * dv * ring)
      const d = (luma(neighbour[0], neighbour[1], neighbour[2]) - lc) / SMOOTH_RANGE
      // The spatial term is deliberately flat (`ring^2 / 8`, not `ring^2 / 2`):
      // a Gaussian concentrated on the nearest ring would only ever average a
      // pixel with its own neighbourhood, which is a blur, not a smoother.
      const w = Math.exp(-0.5 * d * d) * Math.exp(-(ring * ring) / 8)
      sr += neighbour[0] * w
      sg += neighbour[1] * w
      sb += neighbour[2] * w
      total += w
    }
  }
  return [
    centre[0] + (sr / total - centre[0]) * amount,
    centre[1] + (sg / total - centre[1]) * amount,
    centre[2] + (sb / total - centre[2]) * amount,
    centre[3],
  ]
}

/** How much of a heal/redeye spot covers `(u, v)`: 1 at the centre, 0 outside. */
export function spotWeight(
  u: number,
  v: number,
  at: readonly [number, number],
  radius: number,
  squeeze: number,
  inner: number,
): number {
  if (!(radius > 0)) return 0
  const dx = u - at[0]
  const dy = v - at[1]
  const distance = Math.sqrt(dx * dx + (dy * squeeze) ** 2)
  return 1 - smoothstep(radius * inner, radius, distance)
}

/**
 * A radial clone stamp: the disc is replaced by a feathered average of two
 * rings sampled *around* it.
 *
 * A single-source clone (one mirrored offset) folds that source's structure
 * into the whole disc: place it on a cheek next to a dark eyebrow and it stamps
 * a hard dark wedge the size of the spot. Averaging eight evenly spaced
 * directions over two rings makes the replacement rotationally symmetric, so
 * the patch can only ever be a smooth blend of the skin that surrounds the
 * blemish — which is what "heal this spot" means.
 */
export const HEAL_ANGLES = 8
export const HEAL_RINGS: readonly number[] = [1.4, 1.9]

export function healAt(
  src: RetouchSource,
  u: number,
  v: number,
  at: readonly [number, number],
  radius: number,
  squeeze: number,
): Rgba {
  const centre = sampleRgba(src, u, v)
  const weight = spotWeight(u, v, at, radius, squeeze, 0.75)
  if (weight <= 0) return centre
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  for (let i = 0; i < HEAL_ANGLES; i += 1) {
    const angle = (i * Math.PI) / 4
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    for (const ring of HEAL_RINGS) {
      const reach = radius * ring
      const patch = sampleRgba(
        src,
        at[0] + (dirX * reach) / Math.max(1e-6, squeeze),
        at[1] + dirY * reach,
      )
      r += patch[0]
      g += patch[1]
      b += patch[2]
      total += 1
    }
  }
  if (!(total > 0)) return centre
  return [
    centre[0] + (r / total - centre[0]) * weight,
    centre[1] + (g / total - centre[1]) * weight,
    centre[2] + (b / total - centre[2]) * weight,
    centre[3],
  ]
}

/** Distance, in radius multiples, the red-eye fix samples the sclera at. */
export const RED_EYE_REACH = 1.8

/**
 * Red-eye: desaturate the iris and pull it toward the sclera. The sclera is
 * the average of four taps on a ring just outside the spot, which is exactly
 * the tissue the flash bounced off, so pushing the iris toward it and
 * desaturating the result removes the red cast instead of greying it.
 */
export function redEyeAt(
  src: RetouchSource,
  u: number,
  v: number,
  at: readonly [number, number],
  radius: number,
  squeeze: number,
): Rgba {
  const centre = sampleRgba(src, u, v)
  const weight = spotWeight(u, v, at, radius, squeeze, 0.5)
  if (weight <= 0) return centre
  const reach = radius * RED_EYE_REACH
  const dx = reach
  const dy = reach / Math.max(1e-6, squeeze)
  let r = 0
  let g = 0
  let b = 0
  for (const [ox, oy] of [
    [dx, 0],
    [-dx, 0],
    [0, dy],
    [0, -dy],
  ] as const) {
    const tap = sampleRgba(src, u + ox, v + oy)
    r += tap[0]
    g += tap[1]
    b += tap[2]
  }
  r /= 4
  g /= 4
  b /= 4
  const rl = luma(r, g, b)
  const target: Rgba = [r + (rl - r) * 0.6, g + (rl - g) * 0.6, b + (rl - b) * 0.6, centre[3]]
  return [
    centre[0] + (clamp01(target[0]) - centre[0]) * weight,
    centre[1] + (clamp01(target[1]) - centre[1]) * weight,
    centre[2] + (clamp01(target[2]) - centre[2]) * weight,
    centre[3],
  ]
}

/** Retouch radius in pixels, for `planHalo` and the CPU/CPU passes. */
export function retouchHalo(smooth: number, healRadius: number, pixelScale: number): number {
  return Math.ceil(
    Math.max(
      smooth > 0 ? smoothRadius(Math.min(1, Math.max(0, smooth)), pixelScale) * SMOOTH_REACH : 0,
      healRadius > 0 ? healRadius * Math.max(...HEAL_RINGS) : 0,
    ),
  )
}
