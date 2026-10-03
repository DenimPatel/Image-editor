import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { usePointerDrag } from '../../hooks/usePointerDrag'
import { assetStore } from '../../model/assetsSingleton'
import { effectiveOutputSize } from '../../model/selectors'
import type { Layer, Point, Size } from '../../model/types'
import { setLayerTransformInDoc } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import {
  HANDLE_CORNERS,
  ROTATION_MAX,
  ROTATION_MIN,
  SCALE_MAX,
  SCALE_MIN,
  canTransformInPlace,
  canvasPointFromClient,
  clampScale,
  cornerPosition,
  displayedBox,
  estimateTextWidth,
  normalizeDegrees,
  rotationFromDrag,
  scaleFromCornerDrag,
  transformBasis,
  type HandleCorner,
  type HandleDeps,
  type TextMeasure,
  type TransformBasis,
} from './layerTransform'
import styles from './transformHandles.module.css'

/**
 * Before the container has been measured, the same placeholder the crop overlay
 * uses. Both overlays correct it on the first `ResizeObserver` callback.
 */
const FALLBACK_CONTAINER = { width: 320, height: 320 }

/**
 * The compositor's fit, reproduced rather than re-derived: `applyLayout` in
 * `useRenderLoop` subtracts the same 32px of breathing room and fits the output
 * into what is left. The two must agree or a grip sits beside the layer.
 */
const FIT_PADDING = 32

/** How far the rotate grip sits above the box, in screen pixels. */
const ROTATE_GAP = 18

/**
 * Arrow keys move a grip by a hundredth of the layer's size, or ten times that
 * with Shift — the same 1% / 10% step the crop handles use, so the two keyboard
 * paths over one canvas agree.
 */
const KEY_STEP_PERCENT = 0.01
const ROTATION_KEY_STEP = 1
const ROTATION_KEY_STEP_COARSE = 15

/**
 * Text width, measured the way the compositor measures it: the same font string,
 * the same letter spacing, on a real 2D context. Any engine without a canvas —
 * jsdom above all — falls back to the estimator, which is why this is a lazily
 * built module-level context rather than one per render.
 */
let measuringContext: CanvasRenderingContext2D | null | undefined
function measuring(): CanvasRenderingContext2D | null {
  if (measuringContext === undefined) {
    try {
      measuringContext = document.createElement('canvas').getContext('2d')
    } catch {
      measuringContext = null
    }
  }
  return measuringContext
}

const measureText: TextMeasure = (font, _fontSize, trackingPx, text) => {
  const ctx = measuring()
  if (!ctx || typeof ctx.measureText !== 'function') return 0
  ctx.font = font
  if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${trackingPx}px`
  const measured = ctx.measureText(text).width
  if (!Number.isFinite(measured) || measured <= 0) return 0
  // Chromium adds the spacing after the final glyph as well, and that trailing
  // gap is not part of the line's box.
  return Math.max(0, measured - [...text].length * trackingPx)
}

/**
 * An uploaded sticker's own aspect, read out of the Asset Vault. The compositor
 * reads the same bitmap for the same reason: an uploaded mark has no SVG path, so
 * its proportions only exist in the decoded pixels.
 */
function stickerAspectOf(layer: Extract<Layer, { kind: 'sticker' }>): number {
  if (!layer.assetId) return 1
  const image = assetStore.get(layer.assetId)
  if (!image || !(image.height > 0)) return 1
  return image.width / image.height
}

const DEPS: HandleDeps = {
  measure: (font, fontSize, trackingPx, text) => {
    const measured = measureText(font, fontSize, trackingPx, text)
    return measured > 0 ? measured : estimateTextWidth(font, fontSize, trackingPx, text)
  },
  stickerAspect: stickerAspectOf,
}

type FrameRef = RefObject<HTMLDivElement | null>

/**
 * The pointer's position in canvas pixels. `boxOf` is read at event time rather
 * than cached, because the frame moves with the viewport and a cached box would
 * be a stale one — the same reason the drag never accumulates its own delta.
 */
function pointerInCanvas(
  event: { clientX: number; clientY: number },
  frame: FrameRef,
  size: Size,
): Point | null {
  const element = frame.current
  const rect = element?.getBoundingClientRect()
  if (!rect) return null
  return canvasPointFromClient(event.clientX, event.clientY, rect, size)
}

function cornerLabel(corner: HandleCorner): string {
  return HANDLE_CORNERS.find((entry) => entry.id === corner)?.label ?? corner
}

function gripStyle(at: Point, zoom: number): CSSProperties {
  return {
    left: at.x,
    top: at.y,
    // The frame carries the viewport's `scale(zoom)`, so the grips cancel it out:
    // this is what makes a grip 28 screen pixels at every zoom level.
    ['--grip-zoom' as string]: 1 / Math.max(0.01, zoom),
  } as CSSProperties
}

/**
 * Which way a key moves a value that runs up and down: 1, -1, or `null` for a key
 * the control does not use. How *far* is each control's own step.
 */
function directionForKey(key: string): number | null {
  if (key === 'ArrowUp' || key === 'ArrowRight') return 1
  if (key === 'ArrowDown' || key === 'ArrowLeft') return -1
  return null
}

/**
 * A corner grip.
 *
 * `role="slider"` over `transform.scale` is the honest model: `scale` is one
 * scalar, so the value a corner drag produces *is* the scale, and the grip is a
 * control whose value happens to be drawn on top of the layer. Arrow keys move
 * it, Shift moves it ten times as far, and one key press is one undo step — the
 * same per-press span the crop handles open, because a nudge that merged into the
 * press before it would make fifty presses a single undo.
 */
function CornerGrip({
  corner,
  at,
  layer,
  size,
  frame,
  zoom,
}: {
  corner: HandleCorner
  at: Point
  layer: Layer
  size: Size
  frame: FrameRef
  zoom: number
}) {
  const basis = useRef<TransformBasis | null>(null)
  const free = useRef(false)

  const { onPointerDown } = usePointerDrag({
    onStart: (event) => {
      const point = pointerInCanvas(event, frame, size)
      if (!point) return
      basis.current = transformBasis(layer, size, DEPS)
      // Read once, at pointerdown. A mode that could change mid-gesture would
      // move the pivot under the pointer, which is the jump this all exists to
      // avoid.
      free.current = event.shiftKey
      useDocStore.getState().beginInteraction(`layer-transform:${layer.id}`)
    },
    onMove: (_dx, _dy, event) => {
      const start = basis.current
      if (!start) return
      const point = pointerInCanvas(event, frame, size)
      if (!point) return
      setLayerTransformInDoc(layer.id, scaleFromCornerDrag(start, corner, point, free.current))
    },
    onEnd: () => {
      basis.current = null
      useDocStore.getState().endInteraction()
    },
  })

  const nudge = (steps: number) => {
    const store = useDocStore.getState()
    const current = store.present.layers.find((candidate) => candidate.id === layer.id)
    if (!current) return
    store.beginInteraction(`layer-transform:${layer.id}:key`)
    setLayerTransformInDoc(layer.id, {
      ...current.transform,
      scale: clampScale(current.transform.scale + steps * KEY_STEP_PERCENT),
    })
    store.endInteraction()
  }

  const percent = Math.round(layer.transform.scale * 100)
  return (
    <span
      className={`${styles.grip} ${
        corner === 'nw'
          ? styles.gripNw
          : corner === 'ne'
            ? styles.gripNe
            : corner === 'se'
              ? styles.gripSe
              : styles.gripSw
      }`}
      style={gripStyle(at, zoom)}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const direction = directionForKey(event.key)
        if (direction === null) return
        event.preventDefault()
        nudge(direction * (event.shiftKey ? 10 : 1))
      }}
      role="slider"
      aria-label={`Scale from the ${cornerLabel(corner)} corner`}
      aria-valuemin={Math.round(SCALE_MIN * 100)}
      aria-valuemax={Math.round(SCALE_MAX * 100)}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% of its size`}
      tabIndex={0}
    />
  )
}

/**
 * The rotate grip, one screen-grip-height above the top edge.
 *
 * Rotation is about the layer's own centre, which is where `applyTransform` puts
 * it and where the rotation slider's number is measured from, so this and the
 * slider write the same field in the same units: a 15° sweep of this grip is the
 * slider at +15°.
 */
function RotateGrip({
  at,
  layer,
  size,
  frame,
  zoom,
}: {
  at: Point
  layer: Layer
  size: Size
  frame: FrameRef
  zoom: number
}) {
  const basis = useRef<TransformBasis | null>(null)
  const grabbed = useRef<Point | null>(null)

  const { onPointerDown } = usePointerDrag({
    onStart: (event) => {
      const point = pointerInCanvas(event, frame, size)
      if (!point) return
      basis.current = transformBasis(layer, size, DEPS)
      grabbed.current = point
      useDocStore.getState().beginInteraction(`layer-transform:${layer.id}`)
    },
    onMove: (_dx, _dy, event) => {
      const start = basis.current
      const from = grabbed.current
      if (!start || !from) return
      const point = pointerInCanvas(event, frame, size)
      if (!point) return
      setLayerTransformInDoc(layer.id, {
        ...start.transform,
        rotation: rotationFromDrag(start, from, point),
      })
    },
    onEnd: () => {
      basis.current = null
      grabbed.current = null
      useDocStore.getState().endInteraction()
    },
  })

  const nudge = (steps: number) => {
    const store = useDocStore.getState()
    const current = store.present.layers.find((candidate) => candidate.id === layer.id)
    if (!current) return
    store.beginInteraction(`layer-transform:${layer.id}:key`)
    setLayerTransformInDoc(current.id, {
      ...current.transform,
      rotation: normalizeDegrees(current.transform.rotation + steps),
    })
    store.endInteraction()
  }

  const degrees = Math.round(layer.transform.rotation * 10) / 10
  return (
    <span
      className={`${styles.grip} ${styles.rotateGrip}`}
      style={gripStyle(at, zoom)}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const direction = directionForKey(event.key)
        if (direction === null) return
        event.preventDefault()
        nudge(direction * (event.shiftKey ? ROTATION_KEY_STEP_COARSE : ROTATION_KEY_STEP))
      }}
      role="slider"
      aria-label="Rotate layer"
      aria-valuemin={ROTATION_MIN}
      aria-valuemax={ROTATION_MAX}
      aria-valuenow={degrees}
      aria-valuetext={`${degrees} degrees`}
      tabIndex={0}
    />
  )
}

/**
 * D6-F14 — the selection outline and the grips for the selected layer.
 *
 * It is drawn in the canvas's own overlay layer and in the compositor's own
 * coordinate transform, so a grip is over the layer's pixel rather than over a
 * re-derivation of it. Two tools suppress it deliberately:
 *
 * - crop, because the render loop ignores the committed crop while it is open and
 *   the crop box owns the frame;
 * - draw, because every pixel of canvas input belongs to the brush, and a grip is
 *   a pixel of canvas input.
 *
 * Comparison hides the layers entirely, so there is nothing left to point at.
 */
export function LayerTransformOverlay() {
  const doc = useDocStore((state) => state.present)
  const selectedId = useUiStore((state) => state.selectedLayerId)
  const viewport = useUiStore((state) => state.viewport)
  const activeTool = useUiStore((state) => state.activeTool)
  const compareHeld = useUiStore((state) => state.compareHeld)
  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState(FALLBACK_CONTAINER)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height })
      }
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  // Both memos are here for one reason: the box is measured with a real 2D
  // context, and a pan or a tool change must not pay for it. `size` is stable for
  // as long as the document is, and `layer` changes only when the document does.
  const size = useMemo(() => effectiveOutputSize(doc), [doc])
  const fit = Math.min(
    Math.max(1, containerSize.width - FIT_PADDING) / Math.max(1, size.width),
    Math.max(1, containerSize.height - FIT_PADDING) / Math.max(1, size.height),
  )
  const displayW = Math.max(1, size.width * fit)
  const displayH = Math.max(1, size.height * fit)
  const zoom = Math.max(0.01, viewport.scale)
  const kx = displayW / Math.max(1, size.width)
  const ky = displayH / Math.max(1, size.height)

  const layer = doc.layers.find((candidate) => candidate.id === selectedId)
  const basis = useMemo(
    () => (layer ? transformBasis(layer, size, DEPS) : null),
    // The frozen copy a gesture needs belongs to the gesture; this one only
    // follows the document.
    [layer, size],
  )
  const showable =
    basis !== null &&
    layer !== undefined &&
    layer.visible &&
    canTransformInPlace(layer.kind) &&
    activeTool !== 'crop' &&
    activeTool !== 'draw' &&
    !compareHeld

  const frameStyle = {
    width: displayW,
    height: displayH,
    // `.imageFrame`'s transform in `canvas.module.css`, restated rather than
    // imported: that stylesheet is the crop overlay's, and this overlay has to
    // sit in exactly the same place without depending on it.
    transform: `translate(-50%, -50%) translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
    ['--grip-zoom' as string]: 1 / zoom,
  } as CSSProperties

  const box = basis ? displayedBox(basis) : null
  const center = box ? { x: box.center.x * kx, y: box.center.y * ky } : { x: 0, y: 0 }
  const halfWidth = box ? box.halfWidth * kx : 0
  const halfHeight = box ? box.halfHeight * ky : 0
  const rotateAt = box
    ? { x: box.center.x * kx, y: box.center.y * ky - halfHeight - ROTATE_GAP }
    : { x: 0, y: 0 }

  /*
   * The layer's box as the user sees it, in the frame's own units — which is
   * what the grips are sized in, since `scale(1 / zoom)` below cancels the
   * viewport's scale back out of them.
   *
   * The stylesheet turns these into `--grip-pad-x` / `--grip-pad-y` against
   * `--ie-tap` and moves the grips out by them, so that a layer too small to hold
   * its own grips does not stack four of them on one pixel and leave every one of
   * them unreachable. It is CSS rather than arithmetic here on purpose: the
   * number that decides it is a token this component cannot resolve to pixels,
   * and a second copy of `44` in TypeScript is the kind of thing that is right
   * until `--ie-tap` changes.
   */
  const groupStyle = {
    ['--box-w' as string]: `${halfWidth * 2}px`,
    ['--box-h' as string]: `${halfHeight * 2}px`,
  } as CSSProperties

  return (
    <div className={styles.overlay} ref={rootRef}>
      <div className={styles.transformFrame} ref={frameRef} style={frameStyle}>
        {showable && basis && layer && (
          <div
            className={styles.handleGroup}
            style={groupStyle}
            role="group"
            aria-label="Layer transform handles"
          >
            <svg
              className={styles.outline}
              viewBox={`0 0 ${displayW} ${displayH}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              <g transform={`rotate(${basis.transform.rotation} ${center.x} ${center.y})`}>
                <rect
                  className={styles.outlineHalo}
                  vectorEffect="non-scaling-stroke"
                  x={center.x - halfWidth}
                  y={center.y - halfHeight}
                  width={halfWidth * 2}
                  height={halfHeight * 2}
                />
                <rect
                  className={styles.outlineStroke}
                  vectorEffect="non-scaling-stroke"
                  x={center.x - halfWidth}
                  y={center.y - halfHeight}
                  width={halfWidth * 2}
                  height={halfHeight * 2}
                />
              </g>
            </svg>
            {HANDLE_CORNERS.map(({ id }) => {
              const at = cornerPosition(basis, id)
              return (
                <CornerGrip
                  key={id}
                  corner={id}
                  at={{ x: at.x * kx, y: at.y * ky }}
                  layer={layer}
                  size={size}
                  frame={frameRef}
                  zoom={zoom}
                />
              )
            })}
            <RotateGrip at={rotateAt} layer={layer} size={size} frame={frameRef} zoom={zoom} />
          </div>
        )}
      </div>
    </div>
  )
}
