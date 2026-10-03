import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePointerDrag } from '../../hooks/usePointerDrag'
import { nudgePerspectiveCorner, resetPerspective, setCrop } from '../../store/actions'
import { getDoc, useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { effectiveOutputSize } from '../../model/selectors'
import type { Doc, NormRect, Perspective, Point, Size } from '../../model/types'
import {
  MIN_CROP,
  cropFrameSize,
  minCropFraction,
  rectForHandleDrag,
  type CropHandle,
} from '../../lib/crop/geometry'
import { cropPixelReadout } from '../../lib/crop/readout'
import { PassportGuides } from './PassportGuides'
import { SafeAreaOverlay } from './SafeAreaOverlay'
import styles from './canvas.module.css'

const FULL_CROP: NormRect = { x: 0, y: 0, width: 1, height: 1 }

/** Arrow keys move a handle by 1% of the frame, or 10% with Shift held. */
const KEY_STEP = 0.01

/** The four draggable corners, and the frame corner each one is anchored to. */
const PERSPECTIVE_CORNERS: { key: keyof Perspective; label: string; base: Point }[] = [
  { key: 'topLeft', label: 'top left', base: { x: 0, y: 0 } },
  { key: 'topRight', label: 'top right', base: { x: 1, y: 0 } },
  { key: 'bottomRight', label: 'bottom right', base: { x: 1, y: 1 } },
  { key: 'bottomLeft', label: 'bottom left', base: { x: 0, y: 1 } },
]

/**
 * The overlay's own button styling; `canvas.module.css` is another district's.
 *
 * Every element here also carries `overlayButton` / `overlayHint` so the
 * forced-colors block in `canvas.module.css` can reach it. That pairing is not
 * decoration — an inline style outranks every stylesheet rule that does not carry
 * `!important`, so before these class names existed the whole overlay had *no*
 * forced-colors path at all: WebKit composited `rgba(0, 0, 0, 0.6)` over its
 * `Canvas` to `#666666` and painted `--ie-on-scrim` as `#000000` on it, 3.65:1,
 * on "Reset crop" and "Perspective". Chromium happened to paper over that by
 * overriding inline backgrounds with its own palette; WebKit composited it, and
 * the gate has to hold on both.
 */
const OVERLAY_BUTTON: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.6)',
  color: 'var(--ie-on-scrim)',
  border: '1px solid rgba(255, 255, 255, 0.35)',
  borderRadius: 8,
  padding: '5px 12px',
  minHeight: '1.875rem',
  font: 'inherit',
  fontSize: '0.75rem',
  cursor: 'pointer',
}

/**
 * The explanation under a tool toggle, in the same district as `OVERLAY_BUTTON`:
 * inline, because `canvas.module.css` is not this file's to extend. The scrim
 * ground is the button's, so the sentence is a caption on the same surface
 * rather than untext on somebody's photograph.
 */
const OVERLAY_HINT: CSSProperties = {
  margin: 0,
  maxWidth: 'min(420px, 62vw)',
  padding: '6px 10px',
  borderRadius: 8,
  background: 'rgba(0, 0, 0, 0.6)',
  color: 'var(--ie-on-scrim)',
  font: 'inherit',
  fontSize: '0.75rem',
  lineHeight: 1.35,
  textAlign: 'center',
  textWrap: 'balance',
}

/** Whether any corner has been pulled off the frame, for the reset button. */
function perspectiveWarped(perspective: Perspective): boolean {
  return PERSPECTIVE_CORNERS.some(({ key }) => {
    const at = perspective[key]
    return at.x !== 0 || at.y !== 0
  })
}

type HandlePlacement = { id: CropHandle; className?: string; style?: CSSProperties }

/**
 * All nine handles. The four corners carry a class from `canvas.module.css`; the
 * four edges are placed inline because that stylesheet is not ours to extend
 * (D5-F16). `rectForHandleDrag` has implemented the edges all along — only the
 * render list was missing them.
 */
const HANDLES: HandlePlacement[] = [
  { id: 'nw', className: styles.handleNw },
  { id: 'ne', className: styles.handleNe },
  { id: 'sw', className: styles.handleSw },
  { id: 'se', className: styles.handleSe },
  { id: 'n', style: { left: '50%', top: -14, marginLeft: -14, cursor: 'ns-resize' } },
  { id: 's', style: { left: '50%', bottom: -14, marginLeft: -14, cursor: 'ns-resize' } },
  { id: 'e', style: { right: -14, top: '50%', marginTop: -14, cursor: 'ew-resize' } },
  { id: 'w', style: { left: -14, top: '50%', marginTop: -14, cursor: 'ew-resize' } },
]

/** Which axes a handle can move, so arrow keys never fake a gesture. */
const HANDLE_AXES: Record<CropHandle, { x: boolean; y: boolean }> = {
  nw: { x: true, y: true },
  n: { x: false, y: true },
  ne: { x: true, y: true },
  e: { x: true, y: false },
  se: { x: true, y: true },
  s: { x: false, y: true },
  sw: { x: true, y: true },
  w: { x: true, y: false },
  move: { x: true, y: true },
}

/**
 * The frame a crop rect is normalized against: oriented, then straightened.
 * Every aspect decision in this file is a claim about *pixels*, so it has to be
 * told which frame it is reasoning about (D5-F01).
 */
function frameFor(doc: Doc): Size | undefined {
  return doc.source
    ? cropFrameSize(doc.source, doc.geometry.orientation, doc.geometry.straighten)
    : undefined
}

/**
 * `usePointerDrag` reports the movement of *one* event, not of the gesture so
 * far, so a handler that re-applies its result from the gesture's start value
 * throws away everything but the last frame. Every drag in this file needs this
 * accumulator: the gesture's total displacement, in the units the caller
 * normalizes to. The ref is only ever touched inside the callbacks, never
 * while rendering.
 */
function useDragDelta() {
  const delta = useRef({ x: 0, y: 0 })
  return {
    reset: () => {
      delta.current = { x: 0, y: 0 }
    },
    add: (dx: number, dy: number) => {
      const total = { x: delta.current.x + dx, y: delta.current.y + dy }
      delta.current = total
      return total
    },
  }
}

function CropHandleView({
  id,
  className,
  style,
  displayW,
  displayH,
  zoom,
  aspectLock,
}: {
  id: CropHandle
  className?: string
  style?: CSSProperties
  displayW: number
  displayH: number
  zoom: number
  aspectLock: number | null
}) {
  const startRect = useRef<NormRect>(getDoc().geometry.crop)
  const moved = useDragDelta()
  const crop = useDocStore((state) => state.present.geometry.crop)
  const { onPointerDown } = usePointerDrag({
    onStart: () => {
      startRect.current = getDoc().geometry.crop
      moved.reset()
      useDocStore.getState().beginInteraction(`crop:${id}`)
    },
    onMove: (dx, dy) => {
      const total = moved.add(dx / Math.max(1, displayW * zoom), dy / Math.max(1, displayH * zoom))
      const doc = getDoc()
      setCrop(
        rectForHandleDrag(startRect.current, id, total.x, total.y, aspectLock, {
          frame: frameFor(doc),
        }),
      )
    },
    onEnd: () => useDocStore.getState().endInteraction(),
  })

  const axes = HANDLE_AXES[id]
  const nudge = (dx: number, dy: number) => {
    const store = useDocStore.getState()
    // One key press is one undo step: the span is opened and closed per press,
    // so a nudge is undoable on its own rather than merging into the drag
    // before it.
    store.beginInteraction(`crop:${id}:key`)
    setCrop(
      rectForHandleDrag(store.present.geometry.crop, id, dx, dy, aspectLock, {
        frame: frameFor(store.present),
      }),
    )
    store.endInteraction()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const step = (event.shiftKey ? 10 : 1) * KEY_STEP
    let dx = 0
    let dy = 0
    switch (event.key) {
      case 'ArrowLeft':
        if (!axes.x) return
        dx = -step
        break
      case 'ArrowRight':
        if (!axes.x) return
        dx = step
        break
      case 'ArrowUp':
        if (!axes.y) return
        dy = -step
        break
      case 'ArrowDown':
        if (!axes.y) return
        dy = step
        break
      default:
        return
    }
    event.preventDefault()
    nudge(dx, dy)
  }

  // A slider that announces a number it is about to change (D8-F09). The
  // announced value is the crop's extent on the axis this handle owns, as a
  // percentage of the frame; the minimum is the real crop floor for this frame,
  // not a round number.
  const axis = axes.x ? 'width' : 'height'
  const frame = frameFor(getDoc())
  const percent = Math.round((axis === 'width' ? crop.width : crop.height) * 100)
  const minPercent = Math.round(
    (frame ? minCropFraction(frame.width, frame.height) : MIN_CROP) * 100,
  )

  return (
    <span
      className={className ? `${styles.handle} ${className}` : styles.handle}
      style={style}
      onPointerDown={onPointerDown}
      onKeyDown={handleKeyDown}
      role="slider"
      aria-label={`Crop ${id} handle`}
      aria-valuemin={minPercent}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% of the frame ${axis === 'width' ? 'wide' : 'tall'}`}
      tabIndex={0}
    />
  )
}

/**
 * One draggable corner of the perspective quad.
 *
 * `Geometry.perspective` holds an *offset* from the frame's own corner, not an
 * absolute position, so the drag only has to measure the delta from where the
 * gesture started and add it to the offset the corner already had. The ±0.5
 * clamp lives in `nudgePerspectiveCorner`, which is what stops a corner from
 * crossing the opposite side and folding the image away.
 */
function PerspectiveCorner({
  corner,
  label,
  base,
  displayW,
  displayH,
  zoom,
}: {
  corner: keyof Perspective
  label: string
  base: Point
  displayW: number
  displayH: number
  zoom: number
}) {
  const offset = useDocStore((state) => state.present.geometry.perspective[corner])
  const startOffset = useRef<Point>(offset)
  const moved = useDragDelta()

  const move = usePointerDrag({
    onStart: () => {
      startOffset.current = getDoc().geometry.perspective[corner]
      moved.reset()
      useDocStore.getState().beginInteraction('perspective')
    },
    onMove: (dx, dy) => {
      const total = moved.add(dx / Math.max(1, displayW * zoom), dy / Math.max(1, displayH * zoom))
      nudgePerspectiveCorner(corner, {
        x: startOffset.current.x + total.x,
        y: startOffset.current.y + total.y,
      })
    },
    onEnd: () => useDocStore.getState().endInteraction(),
  })

  const nudge = (dx: number, dy: number) => {
    const store = useDocStore.getState()
    // One key press is one undo step, exactly like the crop handles.
    store.beginInteraction('perspective:key')
    nudgePerspectiveCorner(corner, {
      x: store.present.geometry.perspective[corner].x + dx,
      y: store.present.geometry.perspective[corner].y + dy,
    })
    store.endInteraction()
  }

  return (
    <span
      onPointerDown={move.onPointerDown}
      onKeyDown={(event) => {
        const step = (event.shiftKey ? 10 : 1) * KEY_STEP
        const deltas: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        }
        const delta = deltas[event.key]
        if (!delta) return
        event.preventDefault()
        nudge(delta[0], delta[1])
      }}
      role="slider"
      aria-label={`Perspective ${label} corner`}
      aria-valuemin={-50}
      aria-valuemax={50}
      aria-valuenow={Math.round(offset.x * 100)}
      aria-valuetext={`${Math.round(offset.x * 100)}% across, ${Math.round(offset.y * 100)}% down`}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: `${(base.x + offset.x) * 100}%`,
        top: `${(base.y + offset.y) * 100}%`,
        width: 22,
        height: 22,
        marginLeft: -11,
        marginTop: -11,
        borderRadius: '50%',
        /* The same accent token the rotate grip reads, so choosing Cobalt moves
           both dots. It used to be a literal teal, which meant the crop overlay
           ignored the accent setting while every other mark on the canvas honoured
           it. 90% rather than solid, because this mark sits on a photograph and an
           opaque accent would flatten whatever is behind it. */
        background: 'color-mix(in srgb, var(--ie-accent-bright) 90%, transparent)',
        border: '2px solid rgba(0, 0, 0, 0.65)',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
        cursor: 'grab',
        touchAction: 'none',
        pointerEvents: 'auto',
        zIndex: 3,
      }}
    />
  )
}

/**
 * Interactive crop box over the full straightened frame. Rendering during
 * crop deliberately ignores the committed crop (handled by useRenderLoop), so
 * the box can be dragged freely; the committed values are normalized and are
 * the exact numbers the renderer and export consume.
 */
export function CropOverlay() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 320, height: 320 })
  const [perspectiveOn, setPerspectiveOn] = useState(false)
  const crop = useDocStore((state) => state.present.geometry.crop)
  const aspectLock = useDocStore((state) => state.present.geometry.aspectLock)
  const perspective = useDocStore((state) => state.present.geometry.perspective)
  const doc = useDocStore((state) => state.present)
  const viewport = useUiStore((state) => state.viewport)
  const safeArea = useUiStore((state) => state.safeArea)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0) setContainerSize({ width: rect.width, height: rect.height })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const fullDoc = useMemo(() => ({ ...doc, geometry: { ...doc.geometry, crop: FULL_CROP } }), [doc])
  const output = effectiveOutputSize(fullDoc)
  const availableW = Math.max(1, containerSize.width - 32)
  const availableH = Math.max(1, containerSize.height - 32)
  const fitScale = Math.min(availableW / output.width, availableH / output.height)
  const displayW = Math.max(1, output.width * fitScale)
  const displayH = Math.max(1, output.height * fitScale)
  const zoom = viewport.scale
  const box = {
    left: crop.x * displayW,
    top: crop.y * displayH,
    width: crop.width * displayW,
    height: crop.height * displayH,
  }

  const startMove = useRef<NormRect>(crop)
  const moved = useDragDelta()
  const move = usePointerDrag({
    onStart: () => {
      startMove.current = getDoc().geometry.crop
      moved.reset()
      useDocStore.getState().beginInteraction('crop:move')
    },
    onMove: (dx, dy) => {
      const total = moved.add(dx / Math.max(1, displayW * zoom), dy / Math.max(1, displayH * zoom))
      const current = getDoc()
      setCrop(
        rectForHandleDrag(startMove.current, 'move', total.x, total.y, aspectLock, {
          frame: frameFor(current),
        }),
      )
    },
    onEnd: () => useDocStore.getState().endInteraction(),
  })

  // The crop's own size in source pixels, not in post-resize export pixels, and
  // the export size reported separately (D5-F09).
  const readout = cropPixelReadout(doc)

  return (
    <div className={styles.overlay} ref={rootRef}>
      <div
        className={styles.imageFrame}
        style={{
          width: displayW,
          height: displayH,
          transform: `translate(-50%, -50%) translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})`,
          left: '50%',
          top: '50%',
        }}
      >
        <div
          className={styles.cropBox}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          onPointerDown={move.onPointerDown}
        >
          <div className={styles.cropGrid} />
        </div>
        {HANDLES.map(({ id, className, style }) => (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              pointerEvents: 'none',
            }}
          >
            <CropHandleView
              id={id}
              className={className}
              style={style}
              displayW={displayW}
              displayH={displayH}
              zoom={zoom}
              aspectLock={aspectLock}
            />
          </div>
        ))}
        {/* Both overlays are percentages of the frame that gets exported, so
            they are told the crop rect instead of inheriting the whole image
            frame these are positioned against (D5-F10). */}
        <SafeAreaOverlay preset={safeArea} crop={crop} />
        {doc.passport && <PassportGuides specId={doc.passport.specId} crop={crop} />}
        {perspectiveOn && (
          <>
            {/* The quad in normalized frame units, so one viewBox covers any
                aspect: `non-scaling-stroke` keeps the line 1.5 px whatever the
                frame's proportions are. */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
            >
              <polygon
                points={PERSPECTIVE_CORNERS.map(
                  ({ key, base }) =>
                    `${(base.x + perspective[key].x) * 100},${(base.y + perspective[key].y) * 100}`,
                ).join(' ')}
                fill="none"
                stroke="color-mix(in srgb, var(--ie-accent-bright) 90%, transparent)"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {PERSPECTIVE_CORNERS.map(({ key, label, base }) => (
              <PerspectiveCorner
                key={key}
                corner={key}
                label={label}
                base={base}
                displayW={displayW}
                displayH={displayH}
                zoom={zoom}
              />
            ))}
          </>
        )}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          <button
            type="button"
            className={styles.overlayButton}
            style={OVERLAY_BUTTON}
            onClick={() => setCrop(FULL_CROP)}
          >
            Reset crop
          </button>
          <button
            type="button"
            className={styles.overlayButton}
            style={{
              ...OVERLAY_BUTTON,
              ...(perspectiveOn
                ? {
                    background: 'color-mix(in srgb, var(--ie-accent-bright) 90%, transparent)',
                    color: 'var(--on-accent-bright)',
                  }
                : {}),
            }}
            aria-pressed={perspectiveOn}
            title="Pull a corner to straighten a photo shot at an angle"
            onClick={() => setPerspectiveOn((on) => !on)}
          >
            Perspective
          </button>
          {perspectiveOn && (
            <button
              type="button"
              className={styles.overlayButton}
              style={OVERLAY_BUTTON}
              onClick={resetPerspective}
              disabled={!perspectiveWarped(perspective)}
            >
              Reset perspective
            </button>
          )}
        </div>
        {/* "Perspective" was a word with no referent anywhere in the product: a
            first-time reader had a toggle and a photo and no way to find out
            what pressing it wanted of them. It is not a stub — dragging a corner
            genuinely warps the frame — so the honest thing is to say what it does
            and what it costs. Text content rather than `title` alone, because a
            `title` is not an accessible name and a hover-only sentence reaches
            nobody on a phone. */}
        {perspectiveOn && (
          <p className={styles.overlayHint} style={OVERLAY_HINT}>
            Drag a corner to correct a photo shot at an angle — its straight lines come back
            parallel. Nothing is detected for you, and the warp is baked into the exported pixels.
          </p>
        )}
      </div>
      <div className={styles.cropDimensions}>
        {readout.pixels}
        {readout.ratio !== '—' ? ` · ${readout.ratio}` : ''}
        {readout.output !== readout.pixels ? ` · exports ${readout.output}` : ''}
      </div>
    </div>
  )
}
