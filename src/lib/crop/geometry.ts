/**
 * Pure, DOM-free crop/geometry math. Everything here is deterministic and
 * unit-testable outside a browser, which is why it lives apart from any
 * canvas code.
 *
 * Two laws run through the whole file.
 *
 * 1. A `NormRect` is 0..1 in *some* frame, and that frame is rarely square.
 *    A normalized 1:1 is therefore not a square pixel square, so every aspect
 *    operation is told which frame it is reasoning about (`AspectFit.frame`)
 *    and converts before it measures.
 * 2. An aspect fit pins the edges the gesture did not move. The box grows and
 *    shrinks from its anchor, so a handle can actually change the crop's size
 *    instead of sliding it around the frame.
 */
import type { NormRect, Orientation, Perspective, Point, Size } from '../../model/types'

/**
 * Bounding box of an `srcW x srcH` rectangle after rotating by rotationDeg.
 * This is *the* rect the straighten step produces: both `computeSourceToOutput`
 * and `croppedPixelSize` reference it, because when they disagreed the output
 * canvas measured one rotation and the sampler measured another.
 */
export function getTransformedSize(
  srcWidth: number,
  srcHeight: number,
  rotationDeg: number,
): { width: number; height: number } {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const width = Math.round(srcWidth * cos + srcHeight * sin)
  const height = Math.round(srcWidth * sin + srcHeight * cos)
  return { width, height }
}

/** Source dimensions after the orientation's quarter turns. */
export function orientedSize(source: Size, orientation: Orientation): Size {
  return orientation.quarterTurns % 2 === 1
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height }
}

/**
 * Size of the frame a crop rect is normalized against: oriented, then
 * straightened. This is the frame every aspect lock and every minimum has to
 * be measured in, because it is the one `geometry.crop` is documented to live
 * in.
 */
export function cropFrameSize(source: Size, orientation: Orientation, straightenDeg: number): Size {
  const oriented = orientedSize(source, orientation)
  return getTransformedSize(oriented.width, oriented.height, straightenDeg)
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi
}

export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * 25.4
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Smallest crop edge as a fraction of the frame. `MIN_CROP` is the floor that
 * holds for any frame at all; `MIN_CROP_PX` is the floor that is actually
 * meaningful, because 2% of a 60 MP frame is 1200 px while 2% of a 640 px
 * proxy is 13 px.
 */
export const MIN_CROP = 0.02
export const MIN_CROP_PX = 64

export function minCropFraction(
  frameWidth: number,
  frameHeight: number,
  minPx = MIN_CROP_PX,
): number {
  const width = Math.max(1, frameWidth)
  const height = Math.max(1, frameHeight)
  return Math.min(0.5, Math.max(MIN_CROP, minPx / width, minPx / height))
}

/**
 * Keep a rect inside the unit square, growing it to `minFraction` per side if
 * it is smaller than the minimum. The minimum is enforced here, on the final
 * rect, rather than on the pre-aspect edges, which is the only place it can
 * actually be guaranteed.
 */
export function clampInsideImage(rect: NormRect, minFraction = 0): NormRect {
  const min = Math.max(0, minFraction)
  const width = clamp(rect.width, min, 1)
  const height = clamp(rect.height, min, 1)
  const x = clamp(rect.x, 0, 1 - width)
  const y = clamp(rect.y, 0, 1 - height)
  return { x, y, width, height }
}

/** Edges held in place while an aspect fit resizes the box. */
export type AspectAnchor = {
  x?: 'left' | 'right'
  y?: 'top' | 'bottom'
}

export type AspectFit = {
  /** Frame size in pixels. Fixes the pixel aspect and the min-crop floor. */
  frame?: Size
  /** Frame width/height in pixels, when only the ratio is known. */
  frameAspect?: number
  /** Edges that stay pinned while the box resizes. Omit to re-centre. */
  anchor?: AspectAnchor
  /** Smallest allowed side, as a fraction of the frame. */
  minFraction?: number
}

function frameAspectOf(fit: AspectFit): number {
  if (fit.frame && fit.frame.width > 0 && fit.frame.height > 0) {
    return fit.frame.width / fit.frame.height
  }
  if (fit.frameAspect !== undefined && Number.isFinite(fit.frameAspect) && fit.frameAspect > 0) {
    return fit.frameAspect
  }
  return 1
}

function fitMinFraction(fit: AspectFit): number {
  if (fit.minFraction !== undefined && Number.isFinite(fit.minFraction)) {
    return Math.max(0, fit.minFraction)
  }
  if (fit.frame) return minCropFraction(fit.frame.width, fit.frame.height)
  return MIN_CROP
}

/** Which axis the gesture drove, and therefore which axis sets the size. */
type AspectDrive = 'fit' | 'width' | 'height'

/**
 * Resize `rect` to `target` (width/height, in normalized units) without ever
 * moving a pinned edge. Every constraint in the unit square is a constraint on
 * the width, because the height is just `width / target`, so the fit is a
 * single clamp: the requested width, floored at the minimum and capped at
 * whatever the frame allows. The cap is what lets a handle grow.
 */
function fitAspect(
  rect: NormRect,
  target: number,
  anchor: AspectAnchor,
  drive: AspectDrive,
  minFraction: number,
): NormRect {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const anchorX = anchor.x === 'left' ? rect.x : anchor.x === 'right' ? rect.x + rect.width : null
  const anchorY = anchor.y === 'top' ? rect.y : anchor.y === 'bottom' ? rect.y + rect.height : null

  // A pinned edge measures the room between itself and the far side of the
  // frame; a free edge is centred where it already is.
  const room = (pinned: number | null, center: number, fromStart: boolean): number => {
    if (pinned === null) return 2 * Math.min(center, 1 - center)
    return fromStart ? 1 - pinned : pinned
  }
  const roomWidth = room(anchorX, centerX, anchor.x === 'left')
  const roomHeight = room(anchorY, centerY, anchor.y === 'top')

  const maxWidth = Math.max(0, Math.min(roomWidth, roomHeight * target))
  const minWidth = minFraction * Math.max(1, target)
  const wanted =
    drive === 'width'
      ? rect.width
      : drive === 'height'
        ? rect.height * target
        : Math.min(rect.width, rect.height * target)
  const width = clamp(wanted, Math.min(minWidth, maxWidth), maxWidth)
  const height = width / target
  const x = anchorX === null ? centerX - width / 2 : anchor.x === 'left' ? anchorX : anchorX - width
  const y =
    anchorY === null ? centerY - height / 2 : anchor.y === 'top' ? anchorY : anchorY - height
  return { x, y, width, height }
}

/**
 * Resize a normalized rect to the given *pixel* aspect ratio (w/h) around an
 * anchor, honouring the frame's own pixel aspect: on a 3000x2000 frame a
 * locked "1:1" is a 2000x2000 crop, not the 3000x2000 frame itself. A null
 * aspect clears the lock only at the call site; here it returns the rect
 * unchanged apart from the bounds and the minimum.
 */
export function constrainToAspect(
  rect: NormRect,
  aspect: number | null,
  fit: AspectFit = {},
): NormRect {
  const minFraction = fitMinFraction(fit)
  if (aspect === null || !Number.isFinite(aspect) || aspect <= 0) {
    return clampInsideImage(rect, minFraction)
  }
  const target = aspect / frameAspectOf(fit)
  if (!Number.isFinite(target) || target <= 0) return clampInsideImage(rect, minFraction)
  return clampInsideImage(fitAspect(rect, target, fit.anchor ?? {}, 'fit', minFraction))
}

/**
 * Largest centered axis-aligned rectangle of the given aspect that fits
 * inside a `width x height` rectangle rotated by `angleDeg`. Used to auto-zoom
 * while straightening so the crop keeps covering the image with no empty
 * corners. Implemented by bisection so it stays exact for any aspect and
 * angle rather than relying on a special-cased formula.
 */
export function largestInscribedRect(
  width: number,
  height: number,
  angleDeg: number,
  aspect = 1,
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || aspect <= 0) return { width: 0, height: 0 }

  const theta = (angleDeg * Math.PI) / 180
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const halfW = width / 2
  const halfH = height / 2

  // A point (x, y) lies inside the rotated source rect if, after rotating it
  // back by -theta, its components fit in the source half-extents.
  const inside = (x: number, y: number): boolean => {
    const rx = x * cos + y * sin
    const ry = -x * sin + y * cos
    return Math.abs(rx) <= halfW + 1e-9 && Math.abs(ry) <= halfH + 1e-9
  }

  let lo = 0
  let hi = Math.hypot(width, height)
  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2
    const halfRectW = mid / 2
    const halfRectH = mid / aspect / 2
    const fits =
      inside(-halfRectW, -halfRectH) &&
      inside(halfRectW, -halfRectH) &&
      inside(-halfRectW, halfRectH) &&
      inside(halfRectW, halfRectH)
    if (fits) lo = mid
    else hi = mid
  }

  return { width: lo, height: lo / aspect }
}

/**
 * `largestInscribedRect` answered in the frame the renderer actually rotates:
 * the *oriented* source dimensions, normalized against the rotation's bounding
 * box, which is the space `geometry.crop` is documented to live in.
 */
export function fillFrameCrop(
  source: Size,
  orientation: Orientation,
  straighten: number,
  aspect: number | null = null,
): NormRect {
  const oriented = orientedSize(source, orientation)
  const wanted =
    aspect !== null && Number.isFinite(aspect) && aspect > 0
      ? aspect
      : oriented.width / oriented.height
  const size = largestInscribedRect(oriented.width, oriented.height, straighten, wanted)
  if (size.width <= 0 || size.height <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  const box = getTransformedSize(oriented.width, oriented.height, straighten)
  return clampInsideImage(
    {
      x: 0.5 - size.width / (2 * box.width),
      y: 0.5 - size.height / (2 * box.height),
      width: size.width / box.width,
      height: size.height / box.height,
    },
    minCropFraction(box.width, box.height),
  )
}

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

/** The edges a handle does *not* move stay exactly where they were. */
const HANDLE_ANCHORS: Record<Exclude<CropHandle, 'move'>, AspectAnchor> = {
  nw: { x: 'right', y: 'bottom' },
  n: { y: 'bottom' },
  ne: { x: 'left', y: 'bottom' },
  e: { x: 'left' },
  se: { x: 'left', y: 'top' },
  s: { y: 'top' },
  sw: { x: 'right', y: 'top' },
  w: { x: 'right' },
}

/**
 * Apply a handle drag in normalized units. `dx`/`dy` are deltas in normalized
 * image space. When `aspect` is set (in *pixels*, w/h) the opposite edge stays
 * pinned and the dragged axis drives the size while the other axis follows the
 * ratio.
 */
export function rectForHandleDrag(
  rect: NormRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: number | null = null,
  fit: AspectFit = {},
): NormRect {
  const minFraction = fitMinFraction(fit)
  const locked = aspect !== null && Number.isFinite(aspect) && aspect > 0

  if (handle === 'move') {
    return clampInsideImage(
      {
        ...rect,
        x: clamp(rect.x + dx, 0, 1 - rect.width),
        y: clamp(rect.y + dy, 0, 1 - rect.height),
      },
      minFraction,
    )
  }

  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height

  const movesLeft = handle === 'nw' || handle === 'w' || handle === 'sw'
  const movesRight = handle === 'ne' || handle === 'e' || handle === 'se'
  const movesTop = handle === 'nw' || handle === 'n' || handle === 'ne'
  const movesBottom = handle === 'sw' || handle === 's' || handle === 'se'

  if (movesLeft) left = clamp(left + dx, 0, right - minFraction)
  if (movesRight) right = clamp(right + dx, left + minFraction, 1)
  if (movesTop) top = clamp(top + dy, 0, bottom - minFraction)
  if (movesBottom) bottom = clamp(bottom + dy, top + minFraction, 1)

  const dragged: NormRect = { x: left, y: top, width: right - left, height: bottom - top }
  if (!locked) return clampInsideImage(dragged, minFraction)

  const target = aspect / frameAspectOf(fit)
  if (!Number.isFinite(target) || target <= 0) return clampInsideImage(dragged, minFraction)
  // The axis the pointer actually travelled sets the size; a tie goes to the
  // horizontal one, which is what the corner handles have always done.
  const drive: AspectDrive = Math.abs(dx) >= Math.abs(dy) ? 'width' : 'height'
  return clampInsideImage(fitAspect(dragged, target, HANDLE_ANCHORS[handle], drive, minFraction))
}

// --- Orientation transforms -------------------------------------------------

type Affine = [number, number, number, number, number, number]

function multiply(a: Affine, b: Affine): Affine {
  // Returns a ∘ b (apply b first, then a).
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0]
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

export function orientationAffine(orientation: Orientation): Affine {
  const { quarterTurns, flipH, flipV } = orientation
  const flip: Affine = [flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, flipH ? 1 : 0, flipV ? 1 : 0]
  const q = ((quarterTurns % 4) + 4) % 4
  const rotations: Affine[] = [
    [1, 0, 0, 1, 0, 0],
    [0, 1, -1, 0, 1, 0],
    [-1, 0, 0, -1, 1, 1],
    [0, -1, 1, 0, 0, 1],
  ]
  return multiply(rotations[q], flip)
}

/**
 * The straighten step as a map from the *oriented* normalized frame to the
 * *straightened* normalized frame, i.e. rotate about the oriented centre and
 * re-fit the rotation's bounding box onto the unit square. This is the rect
 * `getTransformedSize` measures and the one `computeSourceToOutput` samples
 * through, so a crop authored in either frame means the same thing.
 */
export function straightenNormAffine(oriented: Size, straightenDeg: number): Affine {
  const width = Math.max(0, oriented.width)
  const height = Math.max(0, oriented.height)
  if (width === 0 || height === 0) return [1, 0, 0, 1, 0, 0]

  const rad = (straightenDeg * Math.PI) / 180
  // The bounding box is the same either way round; the rotation is not.
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const boxWidth = width * cos + height * sin
  const boxHeight = width * sin + height * cos
  if (boxWidth <= 0 || boxHeight <= 0) return [1, 0, 0, 1, 0, 0]

  const a = (width / boxWidth) * Math.cos(rad)
  const c = (-height / boxWidth) * Math.sin(rad)
  const b = (width / boxHeight) * Math.sin(rad)
  const d = (height / boxHeight) * Math.cos(rad)
  return [a, b, c, d, 0.5 - (a * 0.5 + c * 0.5), 0.5 - (b * 0.5 + d * 0.5)]
}

export type OrientationRemap = {
  /** Straighten angle, in degrees. The crop lives in the straightened frame. */
  straighten?: number
  /** Source size in pixels. Only needed when `straighten` is non-zero. */
  source?: Size
}

/**
 * The map from one orientation's crop space to another's. It is the dihedral
 * map conjugated by the straighten rotation: the crop is documented to live
 * *after* the straighten, so the dihedral swap only applies once the
 * straighten has been taken back out. Conjugating by a rotation is what makes
 * `rotateBy(90)` keep the same content selected, and because a quarter turn
 * and a flip conjugated by any rotation are still a quarter turn and a flip,
 * the map still sends axis-aligned rects to axis-aligned rects exactly.
 */
function orientationRemapAffine(
  from: Orientation,
  to: Orientation,
  remap: OrientationRemap = {},
): Affine {
  const dihedral = multiply(orientationAffine(to), invert(orientationAffine(from)))
  const straighten = remap.straighten ?? 0
  if (!Number.isFinite(straighten) || straighten === 0) return dihedral
  const source = remap.source ?? { width: 1, height: 1 }
  const out = straightenNormAffine(orientedSize(source, from), straighten)
  const into = straightenNormAffine(orientedSize(source, to), straighten)
  return multiply(into, multiply(dihedral, invert(out)))
}

/**
 * Map a normalized crop rect from one orientation to another so the same
 * content region stays selected across flip/rotate. Because the transform is a
 * dihedral (axis-aligned) map, a rect maps exactly to a rect.
 */
export function transformCropUnderOrientation(
  crop: NormRect,
  from: Orientation,
  to: Orientation,
  remap: OrientationRemap = {},
): NormRect {
  const delta = orientationRemapAffine(from, to, remap)
  const corners = [
    applyAffine(delta, { x: crop.x, y: crop.y }),
    applyAffine(delta, { x: crop.x + crop.width, y: crop.y }),
    applyAffine(delta, { x: crop.x, y: crop.y + crop.height }),
    applyAffine(delta, { x: crop.x + crop.width, y: crop.y + crop.height }),
  ]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return clampInsideImage({ x: minX, y: minY, width: maxX - minX, height: maxY - minY })
}

/** Unit-square corner a quad corner is anchored to, in `computeSourceToOutput` order. */
const QUAD_BASES: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]
const QUAD_KEYS: (keyof Perspective)[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']

/**
 * Carry the four perspective offsets through an orientation change with the
 * same map the crop uses, permuting them into whichever unit-square corner
 * they land on. Exact while `straighten === 0`; today nothing writes
 * `perspective`, so this is a latent bug being made correct before the warp
 * UI inherits it.
 */
export function remapPerspective(
  perspective: Perspective,
  from: Orientation,
  to: Orientation,
  remap: OrientationRemap = {},
): Perspective {
  const delta = orientationRemapAffine(from, to, remap)
  const out: Perspective = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 0, y: 0 },
    bottomRight: { x: 0, y: 0 },
    bottomLeft: { x: 0, y: 0 },
  }
  for (let i = 0; i < QUAD_BASES.length; i += 1) {
    const base = QUAD_BASES[i]
    const offset = perspective[QUAD_KEYS[i]]
    const mappedBase = applyAffine(delta, base)
    const mapped = applyAffine(delta, { x: base.x + offset.x, y: base.y + offset.y })
    let slot = 0
    let best = Infinity
    for (let j = 0; j < QUAD_BASES.length; j += 1) {
      const distance = (mappedBase.x - QUAD_BASES[j].x) ** 2 + (mappedBase.y - QUAD_BASES[j].y) ** 2
      if (distance < best) {
        best = distance
        slot = j
      }
    }
    out[QUAD_KEYS[slot]] = { x: mapped.x - mappedBase.x, y: mapped.y - mappedBase.y }
  }
  return out
}

/** Convert a normalized crop to pixels in a `width x height` image space. */
export function cropToPixels(
  crop: NormRect,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: crop.x * width,
    y: crop.y * height,
    width: crop.width * width,
    height: crop.height * height,
  }
}
