/**
 * D6-F14 — the geometry behind the on-canvas transform handles.
 *
 * Every layer kind has a full transform model and `drawLayers` honours all of
 * it, but until this file the only way to change `transform.scale` or
 * `transform.rotation` was a slider in a side panel, on a photo you are looking
 * at the layer of. This module is the arithmetic that lets a handle on the layer
 * itself do the same thing, and it is deliberately free of React and of the DOM
 * so the interesting claims — that a drag cannot jump, that rotation matches the
 * slider, that a watermark's anchor is respected — are unit tests rather than
 * things a user has to notice.
 *
 * Two facts about `drawLayers` drive all of it:
 *
 * 1. `applyTransform` translates to `(x·W, y·H)`, rotates, then scales. So the
 *    pivot is `(x·W, y·H)` and *scale and rotation are uniform* — there is one
 *    scale scalar per layer, and a drag cannot change a layer's aspect because
 *    the model has nowhere to put a second one.
 * 2. `drawWatermarkLayer` applies its own transform: the mark's anchor is the
 *    resting place and `transform.x/y` are a normalized *offset* from it, so the
 *    mark is drawn at `anchor + (x − 0.5)`. The default transform `(0.5, 0.5)`
 *    is therefore the identity, and a handle that treated `x/y` as a position
 *    would put a default bottom-right watermark in the middle of the canvas.
 *    Both are `ANCHORS`/`anchorPoints` below.
 *
 * Everything here is in *canvas pixels* — the compositor's own units — so the
 * answers do not depend on the zoom, and a gesture started at one zoom and
 * continued at another cannot jump.
 */

import { LAYER_TRANSFORM_PARTS } from '../../features/layers/factory'
import { fontFamily } from '../../features/layers/fonts'
import { stickerById } from '../../features/layers/stickers'
import type { Layer, LayerKind, LayerTransform, Point, Size } from '../../model/types'

/**
 * The bounds the inspector's sliders already impose. A handle that could write a
 * value outside them would produce a document the sliders cannot represent — and
 * one the drag clamps (`DRAG_MIN`/`DRAG_MAX` in `EditorCanvas`) cannot either.
 */
export const SCALE_MIN = 0.05
export const SCALE_MAX = 4
export const ROTATION_MIN = -180
export const ROTATION_MAX = 180
/** The X/Y sliders and the canvas drag clamp both run −20%..120%. */
export const POSITION_MIN = -0.2
export const POSITION_MAX = 1.2
/** A watermark's Offset X/Y sliders run ±50%, which is `x`/`y` in 0..1. */
export const WATERMARK_POSITION_MIN = 0
export const WATERMARK_POSITION_MAX = 1

/**
 * `ANCHORS` in `src/render/layers.ts`, rest point *and* the text alignment the
 * mark is drawn with. It is a third copy of a table the compositor owns and does
 * not export, which is drift waiting to happen — so `layerTransform.test.ts`
 * parses the original out of the compositor's source and fails if the two ever
 * disagree. The alignment matters here because it is what says where the mark's
 * box sits relative to the anchor: a top-left watermark is drawn *from* the
 * anchor, not around it.
 */
const ANCHORS: Record<
  string,
  { rest: Point; align: CanvasTextAlign; baseline: CanvasTextBaseline }
> = {
  'top-left': { rest: { x: 0.05, y: 0.08 }, align: 'left', baseline: 'top' },
  'top-center': { rest: { x: 0.5, y: 0.08 }, align: 'center', baseline: 'top' },
  'top-right': { rest: { x: 0.95, y: 0.08 }, align: 'right', baseline: 'top' },
  'middle-left': { rest: { x: 0.05, y: 0.5 }, align: 'left', baseline: 'middle' },
  center: { rest: { x: 0.5, y: 0.5 }, align: 'center', baseline: 'middle' },
  'middle-right': { rest: { x: 0.95, y: 0.5 }, align: 'right', baseline: 'middle' },
  'bottom-left': { rest: { x: 0.05, y: 0.92 }, align: 'left', baseline: 'bottom' },
  'bottom-center': { rest: { x: 0.5, y: 0.92 }, align: 'center', baseline: 'bottom' },
  'bottom-right': { rest: { x: 0.95, y: 0.92 }, align: 'right', baseline: 'bottom' },
}

export const WATERMARK_ANCHOR_KEYS = Object.keys(ANCHORS)

/** The four corners a handle can sit on, and the sign each one takes. */
export type HandleCorner = 'nw' | 'ne' | 'se' | 'sw'

export const HANDLE_CORNERS: { id: HandleCorner; label: string; sign: Point }[] = [
  { id: 'nw', label: 'top left', sign: { x: -1, y: -1 } },
  { id: 'ne', label: 'top right', sign: { x: 1, y: -1 } },
  { id: 'se', label: 'bottom right', sign: { x: 1, y: 1 } },
  { id: 'sw', label: 'bottom left', sign: { x: -1, y: 1 } },
]

/**
 * How wide a line of text is, in canvas pixels. Injected rather than measured
 * here so this module stays testable: a browser measures with a real 2D context,
 * and jsdom has none, so the tests hand in the estimator below and assert the
 * arithmetic instead of a font.
 */
export type TextMeasure = (
  font: string,
  fontSize: number,
  trackingPx: number,
  text: string,
) => number

export type HandleDeps = {
  measure: TextMeasure
  /** Intrinsic width/height of an uploaded sticker, 1 when it is unknown. */
  stickerAspect: (layer: Extract<Layer, { kind: 'sticker' }>) => number
}

/**
 * What to fall back to when there is no canvas to measure with. 0.55em is a
 * middling figure for lowercase Latin text at the app's own default tracking; it
 * only decides how big a *selection outline* looks when no font engine exists,
 * and a wrong outline is better than a thrown one.
 */
export function estimateTextWidth(
  _font: string,
  fontSize: number,
  trackingPx: number,
  text: string,
): number {
  const characters = [...text].length
  return Math.max(0, characters * fontSize * 0.55 + characters * trackingPx)
}

/**
 * Whether a kind can usefully be transformed in place, derived from the table
 * that mirrors `drawLayers` rather than maintained here. A handle on a `redact`
 * would be a control that visibly does nothing, which is the same defect as the
 * sliders the table already hides.
 */
export function canTransformInPlace(kind: LayerKind): boolean {
  const parts = LAYER_TRANSFORM_PARTS[kind]
  return parts.position && parts.scale && parts.rotation
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampScale(scale: number): number {
  return clamp(scale, SCALE_MIN, SCALE_MAX)
}

/**
 * Rotation into the slider's own −180..180 window. Wrapping rather than clamping
 * is seamless: `rotate(180°)` and `rotate(−180°)` are the same rendering, so a
 * drag that runs past the end of the range never jumps.
 */
export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0
  const wrapped = ((degrees % 360) + 360) % 360
  return wrapped > ROTATION_MAX ? wrapped - 360 : wrapped
}

function rotate(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

/**
 * The point scale and rotation pivot about, and the point the drawing code
 * measures its own geometry from. They are the same for every kind except a
 * watermark, whose pivot is its anchor plus the offset; that difference is the
 * whole of the anchor semantics, stated once.
 */
export function anchorPoints(layer: Layer, size: Size): { origin: Point; pivot: Point } {
  const { x, y } = layer.transform
  if (layer.kind === 'watermark') {
    const anchor = ANCHORS[layer.anchor] ?? ANCHORS.center
    const rest = { x: anchor.rest.x * size.width, y: anchor.rest.y * size.height }
    return {
      origin: rest,
      pivot: {
        x: rest.x + (x - 0.5) * size.width,
        y: rest.y + (y - 0.5) * size.height,
      },
    }
  }
  const pivot = { x: x * size.width, y: y * size.height }
  return { origin: pivot, pivot }
}

/**
 * Where a pivot has to be written back as, for this kind.
 *
 * The origin is read from the layer **as it was when the gesture began** rather
 * than from the live layer: in free mode each move writes a position, so reading
 * the moving origin would make the second `pointermove` start from the first
 * one's answer and the layer would drift under the finger — the incremental bug
 * the frozen `basis` exists to make impossible.
 */
function positionFromPivot(basis: TransformBasis, pivot: Point): Point {
  const { origin } = anchorPoints({ ...basis.layer, transform: basis.transform }, basis.size)
  const travelX = (pivot.x - origin.x) / Math.max(1, basis.size.width)
  const travelY = (pivot.y - origin.y) / Math.max(1, basis.size.height)
  if (basis.layer.kind === 'watermark') {
    // A watermark's origin is its anchor and its resting position is the 0.5 that
    // makes the offset zero, so the travel *is* the position.
    return {
      x: clamp(travelX + 0.5, WATERMARK_POSITION_MIN, WATERMARK_POSITION_MAX),
      y: clamp(travelY + 0.5, WATERMARK_POSITION_MIN, WATERMARK_POSITION_MAX),
    }
  }
  // For every other kind the origin is the start position itself, so the travel is
  // zero at rest and the position it started from has to be added back.
  return {
    x: clamp(basis.transform.x + travelX, POSITION_MIN, POSITION_MAX),
    y: clamp(basis.transform.y + travelY, POSITION_MIN, POSITION_MAX),
  }
}

/** The sticker budget every sticker gets: a quarter of the frame's height. */
export const STICKER_FRAME_FRACTION = 0.25

/**
 * The layer's own box at scale 1, rotation 0 and the offset as stored, in canvas
 * pixels. `center` is where the compositor draws it, which for a watermark is its
 * anchor displaced by the offset rather than its `transform.x/y`.
 *
 * The extents are what the *compositor* draws, read from `drawTextLayer`,
 * `drawShapeLayer` and the sticker branch of `drawLayers`, so a handle lands on
 * the layer's own corner rather than near it.
 */
export function layerBox(layer: Layer, size: Size, deps: HandleDeps): LayerBox {
  const pivot = anchorPoints(layer, size).pivot
  if (layer.kind === 'shape') {
    return {
      center: pivot,
      halfWidth: (layer.width * size.width) / 2,
      halfHeight: (layer.height * size.height) / 2,
    }
  }
  if (layer.kind === 'sticker') {
    const height = STICKER_FRAME_FRACTION * size.height
    // A built-in mark is a square `viewBox` scaled to that height. An upload has
    // no SVG at all — `svg` is `''` — and is drawn at the aspect of its decoded
    // pixels, which only the Asset Vault knows.
    const builtIn = layer.svg ? stickerById(layer.svg) : undefined
    const aspect = builtIn ? 1 : deps.stickerAspect(layer)
    return { center: pivot, halfWidth: (height * aspect) / 2, halfHeight: height / 2 }
  }
  if (layer.kind === 'text') {
    const style = layer.style
    const fontSize = (style.size / 100) * Math.min(size.width, size.height)
    const font = `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${fontSize}px "${fontFamily(
      style.fontId,
    )}", system-ui, sans-serif`
    const trackingPx = (style.tracking / 100) * fontSize
    const lines = layer.text.split('\n')
    const widest = lines.reduce(
      (max, line) => Math.max(max, deps.measure(font, fontSize, trackingPx, line)),
      0,
    )
    const pill = style.pillBackground ? fontSize * 0.3 : 0
    return {
      center: pivot,
      halfWidth: widest / 2 + pill,
      halfHeight: (lines.length * fontSize * style.lineHeight) / 2,
    }
  }
  if (layer.kind === 'watermark') {
    const anchor = ANCHORS[layer.anchor] ?? ANCHORS.center
    const fontSize = Math.max(12, size.height * 0.05)
    // An uploaded mark is drawn at four font sizes wide, centred; text is drawn at
    // the anchor with the anchor's own alignment, so its box is offset from the
    // anchor by exactly that alignment.
    const width = layer.assetId
      ? fontSize * 4
      : deps.measure(
          `${fontSize}px "${fontFamily(layer.fontId)}", system-ui, sans-serif`,
          fontSize,
          0,
          layer.text,
        )
    const height = layer.assetId ? width : fontSize
    const dx = anchor.align === 'left' ? width / 2 : anchor.align === 'right' ? -width / 2 : 0
    const dy =
      anchor.baseline === 'top' ? height / 2 : anchor.baseline === 'bottom' ? -height / 2 : 0
    return {
      center: { x: pivot.x + dx, y: pivot.y + dy },
      halfWidth: width / 2,
      halfHeight: height / 2,
    }
  }
  return { center: pivot, halfWidth: 0, halfHeight: 0 }
}

export type LayerBox = { center: Point; halfWidth: number; halfHeight: number }

/**
 * Everything a gesture needs, frozen at pointerdown. A drag is a pure function of
 * this and the pointer, never of the previous frame, which is what makes "the
 * layer cannot jump" a property rather than a hope.
 */
export type TransformBasis = {
  layer: Layer
  size: Size
  transform: LayerTransform
  /** Where the compositor draws the box centre right now. */
  center: Point
  /**
   * The box's own extents **before** `transform.scale`, with a floor of one pixel
   * so a one-character line or a zero-width shape is still grabbable rather than
   * a division by zero in the drag. The scale is applied on the way out, by
   * `displayedBox` and by `cornerPosition`, because the drag's factor has to be
   * read off the unscaled ray.
   */
  halfWidth: number
  halfHeight: number
  pivot: Point
}

export function transformBasis(layer: Layer, size: Size, deps: HandleDeps): TransformBasis {
  const { origin, pivot } = anchorPoints(layer, size)
  const box = layerBox(layer, size, deps)
  const transform = layer.transform
  const offset = rotate(
    { x: box.center.x - origin.x, y: box.center.y - origin.y },
    transform.rotation,
  )
  return {
    layer,
    size,
    transform,
    center: {
      x: origin.x + offset.x * transform.scale,
      y: origin.y + offset.y * transform.scale,
    },
    halfWidth: Math.max(1, box.halfWidth),
    halfHeight: Math.max(1, box.halfHeight),
    pivot,
  }
}

/** The box as the user sees it: scaled, and floored so it stays visible at 5%. */
export function displayedBox(basis: TransformBasis): {
  center: Point
  halfWidth: number
  halfHeight: number
} {
  return {
    center: basis.center,
    halfWidth: Math.max(1, basis.halfWidth * basis.transform.scale),
    halfHeight: Math.max(1, basis.halfHeight * basis.transform.scale),
  }
}

/** The rotated, unscaled vector from the box centre out to a corner. */
export function cornerRay(basis: TransformBasis, corner: HandleCorner): Point {
  const sign = HANDLE_CORNERS.find((entry) => entry.id === corner)?.sign ?? { x: 1, y: 1 }
  return rotate(
    { x: sign.x * basis.halfWidth, y: sign.y * basis.halfHeight },
    basis.transform.rotation,
  )
}

/** Where a corner sits on screen right now, in canvas pixels. */
export function cornerPosition(basis: TransformBasis, corner: HandleCorner): Point {
  const ray = cornerRay(basis, corner)
  return {
    x: basis.center.x + ray.x * basis.transform.scale,
    y: basis.center.y + ray.y * basis.transform.scale,
  }
}

/**
 * The transform a corner drag has produced.
 *
 * `LayerTransform.scale` is one scalar, so a drag cannot change a layer's aspect
 * and never does: the factor is read along the ray from the centre out through
 * the grabbed corner, which is the only reading that keeps the box similar to
 * itself. The grab then has two modes, and the difference is the *pivot*, not
 * the scale:
 *
 * - **default** — the pivot is held. The corner moves out along its ray and the
 *   opposite corner swings with it. Nothing writes `x`/`y`, so nothing can jump
 *   and nothing can hit the position clamps.
 * - **free** (`Shift`, chosen once at pointerdown) — the same scale, but the
 *   pivot slides so the grabbed corner lands exactly on the pointer, in both
 *   axes. This is the "the layer follows my finger" mode, and it is the only
 *   path here that writes a position, which is why it is the one the clamps
 *   guard.
 *
 * Both are computed from the frozen basis and the pointer's *current* position,
 * so a pointermove with no movement returns the transform it started with.
 */
export function scaleFromCornerDrag(
  basis: TransformBasis,
  corner: HandleCorner,
  pointer: Point,
  free: boolean,
): LayerTransform {
  const start = basis.transform
  const ray = cornerRay(basis, corner)
  const radius = Math.hypot(ray.x, ray.y)
  if (!(radius > 0)) return start
  const direction = { x: ray.x / radius, y: ray.y / radius }
  const grabbed = cornerPosition(basis, corner)
  const along = (pointer.x - grabbed.x) * direction.x + (pointer.y - grabbed.y) * direction.y
  const reach = start.scale * radius
  const factor = clamp(1 + along / reach, SCALE_MIN / start.scale, SCALE_MAX / start.scale)
  const scale = clampScale(start.scale * factor)
  if (!free) return { ...start, scale }
  const scaled = { x: ray.x * scale, y: ray.y * scale }
  const pivot = { x: pointer.x - scaled.x, y: pointer.y - scaled.y }
  const { x, y } = positionFromPivot(basis, pivot)
  return { ...start, scale, x, y }
}

/**
 * The rotation a rotate-handle drag has produced: the start angle plus however
 * far the pointer has swept about the layer's own centre, wrapped into the
 * slider's range. The rotation slider writes the same field with the same
 * units, so a sweep of 15° here is the slider at +15°.
 */
export function rotationFromDrag(basis: TransformBasis, grabbedAt: Point, pointer: Point): number {
  const start = basis.transform
  const sweep =
    Math.atan2(pointer.y - basis.center.y, pointer.x - basis.center.x) -
    Math.atan2(grabbedAt.y - basis.center.y, grabbedAt.x - basis.center.x)
  return normalizeDegrees(start.rotation + (sweep * 180) / Math.PI)
}

/** A pointer's client coordinates as canvas pixels, through the overlay's box. */
export function canvasPointFromClient(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  size: Size,
): Point | null {
  if (!(box.width > 0) || !(box.height > 0)) return null
  return {
    x: ((clientX - box.left) / box.width) * size.width,
    y: ((clientY - box.top) / box.height) * size.height,
  }
}
