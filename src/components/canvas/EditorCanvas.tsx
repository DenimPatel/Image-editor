import { useGesture } from '@use-gesture/react'
import { useCallback, useEffect, useRef } from 'react'
import { SHEET_HEIGHTS } from '../controls/sheetHeights'
import { useIsInspector } from '../ui/useMediaQuery'
import { createDrawLayer, defaultTransform, isDraggableLayer } from '../../features/layers/factory'
import { useRenderLoop } from '../../hooks/useRenderLoop'
import type { DrawLayer, Layer } from '../../model/types'
import { addLayerToDoc, updateLayerPatch } from '../../store/actions'
import { getDoc, useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { CompareGlyph } from '../ui/icons'
import { CompareBadge } from './CompareBadge'
import { CropOverlay } from './CropOverlay'
import { LayerTransformOverlay } from './transformHandles'
import styles from './canvas.module.css'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 8

/**
 * The X/Y sliders in the inspector run -20%..120%, so the drag has to reach
 * the same range or a layer parked off-canvas can never be dragged back.
 */
const DRAG_MIN = -0.2
const DRAG_MAX = 1.2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function EditorCanvas({ source }: { source: ImageBitmap | null }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { canvas } = useRenderLoop(containerRef, source)
  const activeTool = useUiStore((state) => state.activeTool)
  const sheetDetent = useUiStore((state) => state.sheetDetent)
  const isInspector = useIsInspector()
  const compareHeld = useUiStore((state) => state.compareHeld)
  const setViewport = useUiStore((state) => state.setViewport)
  const drawLayerId = useRef<string | null>(null)
  const movingLayerId = useRef<string | null>(null)
  const moveGrabOffset = useRef<{ dx: number; dy: number } | null>(null)

  const pointFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvas?.getBoundingClientRect()
      if (!rect || rect.width === 0 || rect.height === 0) return null
      return {
        x: clamp((clientX - rect.left) / rect.width, 0, 1),
        y: clamp((clientY - rect.top) / rect.height, 0, 1),
      }
    },
    [canvas],
  )

  const bind = useGesture(
    {
      onDragStart: ({ event }) => {
        if (activeTool !== 'draw') {
          const doc = getDoc()
          const selectedId = useUiStore.getState().selectedLayerId
          const layer = doc.layers.find((candidate) => candidate.id === selectedId)
          // Only kinds whose x/y the compositor actually reads are draggable;
          // `frame`, `redact` and `draw` draw from their own geometry.
          if (layer && isDraggableLayer(layer.kind)) {
            const point = pointFromEvent(
              (event as PointerEvent).clientX,
              (event as PointerEvent).clientY,
            )
            if (point) {
              movingLayerId.current = layer.id
              moveGrabOffset.current = {
                dx: point.x - layer.transform.x,
                dy: point.y - layer.transform.y,
              }
              useDocStore.getState().beginInteraction('move-layer')
            }
          }
          return
        }
        const doc = getDoc()
        const selectedId = useUiStore.getState().selectedLayerId
        let layer =
          (doc.layers.find(
            (candidate) => candidate.id === selectedId && candidate.kind === 'draw',
          ) as DrawLayer | undefined) ??
          (doc.layers.find((candidate) => candidate.kind === 'draw') as DrawLayer | undefined)
        if (!layer) {
          // The interaction is opened *before* the layer lands, so the empty
          // drawing layer and the first stroke are one undo step: a first
          // stroke used to cost two (D2-F05).
          layer = createDrawLayer()
          useDocStore.getState().beginInteraction('draw')
          addLayerToDoc(layer)
        } else {
          useDocStore.getState().beginInteraction('draw')
        }
        drawLayerId.current = layer.id
        const point = pointFromEvent(
          (event as PointerEvent).clientX,
          (event as PointerEvent).clientY,
        )
        useDocStore.getState().update((current) => ({
          ...current,
          layers: current.layers.map((candidate) =>
            candidate.id === layer?.id && candidate.kind === 'draw'
              ? {
                  ...candidate,
                  strokes: [
                    ...candidate.strokes,
                    { points: point ? [point] : [], radius: candidate.size, hardness: 1 },
                  ],
                }
              : candidate,
          ),
        }))
      },
      onDrag: ({ event, offset: [x, y] }) => {
        if (activeTool === 'draw') {
          const id = drawLayerId.current
          const point = pointFromEvent(
            (event as PointerEvent).clientX,
            (event as PointerEvent).clientY,
          )
          if (!id || !point) return
          useDocStore.getState().update((current) => ({
            ...current,
            layers: current.layers.map((candidate) => {
              if (
                candidate.id !== id ||
                candidate.kind !== 'draw' ||
                candidate.strokes.length === 0
              )
                return candidate
              const strokes = candidate.strokes.slice()
              const last = strokes[strokes.length - 1]
              strokes[strokes.length - 1] = { ...last, points: [...last.points, point] }
              return { ...candidate, strokes }
            }),
          }))
          return
        }
        if (movingLayerId.current && moveGrabOffset.current) {
          const point = pointFromEvent(
            (event as PointerEvent).clientX,
            (event as PointerEvent).clientY,
          )
          if (!point) return
          const { dx, dy } = moveGrabOffset.current
          const id = movingLayerId.current
          const current = getDoc().layers.find(
            (candidate): candidate is Layer => candidate.id === id,
          )
          const transform = current?.transform ?? defaultTransform()
          updateLayerPatch(id, {
            transform: {
              ...transform,
              x: clamp(point.x - dx, DRAG_MIN, DRAG_MAX),
              y: clamp(point.y - dy, DRAG_MIN, DRAG_MAX),
            },
          })
          return
        }
        setViewport({ x, y })
      },
      onDragEnd: () => {
        if (activeTool === 'draw') {
          useDocStore.getState().endInteraction()
          drawLayerId.current = null
        }
        if (movingLayerId.current) {
          useDocStore.getState().endInteraction()
          movingLayerId.current = null
          moveGrabOffset.current = null
        }
      },
      onPinch: ({ offset: [scale] }) => {
        setViewport({ scale: clamp(scale, MIN_ZOOM, MAX_ZOOM) })
      },
      onWheel: ({ event, delta: [dx, dy] }) => {
        event.preventDefault()
        const current = useUiStore.getState().viewport
        if (event.ctrlKey || event.metaKey) {
          setViewport({ scale: clamp(current.scale * Math.exp(-dy * 0.01), MIN_ZOOM, MAX_ZOOM) })
        } else {
          setViewport({ x: current.x - dx, y: current.y - dy })
        }
      },
    },
    {
      drag: {
        from: () => [useUiStore.getState().viewport.x, useUiStore.getState().viewport.y],
        filterTaps: true,
      },
      pinch: {
        from: () => [useUiStore.getState().viewport.scale, 0],
        scaleBounds: { min: MIN_ZOOM, max: MAX_ZOOM },
      },
      wheel: { eventOptions: { passive: false } },
    },
  )

  useEffect(() => () => useUiStore.getState().setCompareHeld(false), [])

  const gesture = bind()

  /**
   * The canvas is laid out in the strip the sheet leaves, not in the box the
   * sheet then covers.
   *
   * `.canvasRegion` is the box between the two bars and the sheet is
   * `position: absolute; bottom: 0` inside it, so with a panel open the sheet
   * sat on top of the lower part of the canvas. The canvas was still fitted to
   * the *whole* region, which put the bottom of the photo — and with it five of
   * the eight crop handles, all four layer scale grips and the rotate grip —
   * under the sheet. On a phone those controls were drawn but could not be
   * touched, and a thumb aimed at one landed on a panel control instead.
   *
   * A margin rather than an inset because `.canvas` is the flex item every one
   * of those consumers already measures: `useRenderLoop` fits the output into
   * this box, and both `CropOverlay` and `LayerTransformOverlay` observe their
   * own overlay root, which fills it. One number on one element, and the
   * pixels, the crop box and the grips all move together. Shrinking it in the
   * stylesheet instead would need the same number in three places and would
   * drift from `SHEET_HEIGHTS` the first time a detent changed.
   *
   * `peek` is the detent that makes the canvas roomiest, which is the point of
   * it: a long panel at `large` leaves a sliver, and dragging the sheet down is
   * how a reader asks for the image back.
   */
  const sheetInset =
    activeTool !== null && !isInspector ? { marginBottom: SHEET_HEIGHTS[sheetDetent] } : undefined

  return (
    <div className={styles.canvas} style={sheetInset} ref={containerRef}>
      <div
        className={styles.gestureLayer}
        {...gesture}
        onDoubleClick={() => useUiStore.getState().resetViewport()}
      />
      {activeTool === 'crop' && <CropOverlay />}
      {activeTool !== 'crop' && <LayerTransformOverlay />}
      <button
        type="button"
        className={styles.compareToggle}
        aria-pressed={compareHeld}
        onClick={() => useUiStore.getState().setCompareHeld(!compareHeld)}
      >
        <CompareGlyph />
        {compareHeld ? 'Editing' : 'Compare'}
      </button>
      {compareHeld && <CompareBadge />}
    </div>
  )
}
