/**
 * The mask field: `doc.masks[].mask` -> a 0..1 value per pixel.
 *
 * This is the *only* implementation of a mask. Both engines go through it —
 * the Canvas2D backend evaluates it per pixel, and the GL backend rasterises
 * it to an 8-bit field once per view and uploads that as the R8 texture
 * `LOCAL_FRAG` samples. Keeping one implementation is what makes D1-F14's
 * parity claim cheap to hold: the five kinds are geometry plus two per-pixel
 * reads (a `luminance` mask needs the image's brightness, a `subject` mask
 * needs the matte's alpha), and the shader is a transliteration of the
 * expressions below.
 *
 * Space: mask geometry is normalized *output* space, x right and y **down**,
 * which is the frame `doc.geometry.crop` and `BrushStroke.points` are
 * documented in. `LOCAL_FRAG` flips `v_uv` to get there, and the CPU twin's
 * `pointPass` uv is already y-down, so neither engine has to think about it.
 *
 * Radii (`radial.radiusX/Y`, `HealSpot.radius`, `redEye[].radius`,
 * `BrushStroke.radius`) are fractions of the frame **width**: distances are
 * measured as `hypot(dx, dy * height / width)` so a mask is round on screen
 * whatever the frame's aspect.
 */
import type { BrushStroke, Mask } from '../model/types'

/** The per-pixel inputs only two of the five kinds need. */
export type MaskSample = {
  /** Rec.709 luma of the pixel, 0..1. Read by a `luminance` mask. */
  luma: number
  /** Straight alpha of the pixel, 0..1. Read by a `subject` mask. */
  alpha: number
  /** Frame aspect, width / height. */
  aspect: number
}

/**
 * `u_maskKind` in `LOCAL_FRAG`. The order is part of the contract between this
 * file, the shader and the uniform the renderer uploads.
 */
export const MASK_KINDS = ['subject', 'brush', 'linear', 'radial', 'luminance'] as const

/** Never let a ramp collapse: a zero-width band has no defined value. */
const MIN_BAND = 0.001

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Identical to GLSL `smoothstep`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** `smoothstep(a, b, t)` with the degenerate `a === b` case pinned. */
function band(a: number, b: number, t: number): number {
  return smoothstep(a, Math.max(b, a + MIN_BAND), t)
}

function aspectSqueeze(aspect: number): number {
  return Number.isFinite(aspect) && aspect > 0 ? 1 / aspect : 1
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  squeeze: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  let t = 0
  if (lengthSq > 1e-12) t = clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSq)
  const ox = px - (ax + dx * t)
  const oy = py - (ay + dy * t)
  return Math.sqrt(ox * ox + (oy * squeeze) ** 2)
}

function distanceToStroke(px: number, py: number, stroke: BrushStroke, squeeze: number): number {
  const points = stroke.points
  if (points.length === 0) return Infinity
  if (points.length === 1) {
    const dx = px - points[0].x
    const dy = (py - points[0].y) * squeeze
    return Math.sqrt(dx * dx + dy * dy)
  }
  let best = Infinity
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(
      best,
      distanceToSegment(
        px,
        py,
        points[i - 1].x,
        points[i - 1].y,
        points[i].x,
        points[i].y,
        squeeze,
      ),
    )
  }
  return best
}

/** One brush stroke as a coverage term: solid inside `hardness * radius`. */
function strokeCoverage(distance: number, radius: number, hardness: number): number {
  if (!(radius > 0) || !Number.isFinite(distance)) return 0
  const solid = radius * clamp01(hardness)
  return 1 - band(solid, radius, distance)
}

function brushValue(
  mask: Extract<Mask, { kind: 'brush' }>,
  x: number,
  y: number,
  squeeze: number,
): number {
  let paint = 0
  for (const stroke of mask.strokes) {
    const distance = distanceToStroke(x, y, stroke, squeeze)
    const coverage = strokeCoverage(distance, stroke.radius, stroke.hardness)
    if (stroke.erase) paint *= 1 - coverage
    else paint = Math.max(paint, coverage)
  }
  return paint
}

function linearValue(mask: Extract<Mask, { kind: 'linear' }>, x: number, y: number): number {
  const dx = mask.to.x - mask.from.x
  const dy = mask.to.y - mask.from.y
  const lengthSq = dx * dx + dy * dy
  if (!(lengthSq > 1e-12)) return 0
  const along = ((x - mask.from.x) * dx + (y - mask.from.y) * dy) / lengthSq
  const feather = Math.max(0, mask.feather)
  return band(0.5 - feather / 2, 0.5 + feather / 2, along)
}

function radialValue(
  mask: Extract<Mask, { kind: 'radial' }>,
  x: number,
  y: number,
  squeeze: number,
): number {
  const rad = (-mask.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - mask.center.x
  const dy = y - mask.center.y
  // Rotate in normalized space first, then squeeze y once: radii are
  // fractions of the frame width, so an ellipse has to be round on screen.
  const rx = dx * cos - dy * sin
  const ry = (dx * sin + dy * cos) * squeeze
  const radiusX = Math.max(1e-4, Math.abs(mask.radiusX))
  const radiusY = Math.max(1e-4, Math.abs(mask.radiusY))
  const d = Math.sqrt((rx / radiusX) ** 2 + (ry / radiusY) ** 2)
  const feather = Math.max(0, mask.feather)
  return 1 - band(1 - feather, 1 + feather, d)
}

function luminanceValue(mask: Extract<Mask, { kind: 'luminance' }>, luma: number): number {
  const feather = Math.max(0, mask.feather)
  return band(mask.low - feather, mask.high + feather, luma)
}

/**
 * The mask's 0..1 weight at a point, before it is ever quantised.
 *
 * `feather` is always the same thing for every kind: the half-width, in that
 * kind's own units, of the ramp the value crosses on its way to 0 or 1. So
 * `feather: 0` is a hard edge and `feather: 1` is the softest the kind allows.
 */
export function maskValueAt(mask: Mask, x: number, y: number, sample: MaskSample): number {
  const squeeze = aspectSqueeze(sample.aspect)
  let value: number
  switch (mask.kind) {
    case 'subject': {
      const feather = Math.max(0, mask.feather)
      value = band(0.5 - feather / 2, 0.5 + feather / 2, sample.alpha)
      break
    }
    case 'brush':
      value = brushValue(mask, x, y, squeeze)
      break
    case 'linear':
      value = linearValue(mask, x, y)
      break
    case 'radial':
      value = radialValue(mask, x, y, squeeze)
      break
    case 'luminance':
      value = luminanceValue(mask, sample.luma)
      break
    default:
      value = 0
  }
  if ((mask.kind === 'radial' || mask.kind === 'luminance') && mask.invert) value = 1 - value
  return clamp01(value)
}

/** `u_maskKind` for the shader. */
export function maskKindIndex(kind: Mask['kind']): number {
  const index = (MASK_KINDS as readonly string[]).indexOf(kind)
  return index < 0 ? 0 : index
}

/**
 * Rasterise a mask to an 8-bit field, row-major, **y down**, one byte per
 * pixel. This is what the GL backend uploads as its R8 `u_maskTex`, and the
 * Canvas2D twin reads the same function directly, so the two engines cannot
 * drift on mask geometry.
 */
export function rasterizeMask(
  mask: Mask,
  width: number,
  height: number,
  sample: (x: number, y: number) => MaskSample,
): Uint8Array {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const field = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    const ny = (y + 0.5) / h
    for (let x = 0; x < w; x += 1) {
      field[y * w + x] = Math.round(maskValueAt(mask, (x + 0.5) / w, ny, sample(x, y)) * 255)
    }
  }
  return field
}

/**
 * Every adjustment a `LocalAdjust` may carry. It is exactly the tone and colour
 * set the GL backend already ships in `TONE_FRAG` and `COLOR_FRAG`: they are
 * the adjustments that are a pure function of one pixel, so a mask can weight
 * them. The neighbourhood kernels (denoise, definition, sharpness), the
 * spatially-varying vignette and the effect stack are not local.
 */
export const LOCAL_ADJUST_KEYS = [
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'blackPoint',
  'brilliance',
  'saturation',
  'vibrance',
  'warmth',
  'tint',
] as const

export type LocalAdjustKey = (typeof LOCAL_ADJUST_KEYS)[number]

const LOCAL_ADJUST_SET: ReadonlySet<string> = new Set<string>(LOCAL_ADJUST_KEYS)

/** True for the adjustments a local adjust can actually carry. */
export function isLocalAdjustKey(key: string): key is LocalAdjustKey {
  return LOCAL_ADJUST_SET.has(key)
}

/**
 * The normalized values a `local` pass uploads, with the non-local keys
 * dropped. `planPasses` uses this so the plan hash and the uniform set are
 * derived from the same list, and so a local adjust of `sharpness` is a
 * documented no-op rather than a silently broken uniform.
 */
export function localAdjustUniforms(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of LOCAL_ADJUST_KEYS) {
    const value = values[key]
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

/** True when a local adjust would not change a single pixel. */
export function localAdjustIsNeutral(values: Record<string, number>): boolean {
  for (const value of Object.values(values)) {
    if (value !== 0 && Number.isFinite(value)) return false
  }
  return true
}
