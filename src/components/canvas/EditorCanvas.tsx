import { useGesture } from '@use-gesture/react';
import { useCallback, useEffect, useRef } from 'react';
import { createDrawLayer } from '../../features/layers/factory';
import { useRenderLoop } from '../../hooks/useRenderLoop';
import type { DrawLayer } from '../../model/types';
import { addLayerToDoc, updateLayerPatch } from '../../store/actions';
import { getDoc, useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import { CompareBadge } from './CompareBadge';
import { CropOverlay } from './CropOverlay';
import styles from './canvas.module.css';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

const MOVABLE_LAYER_KINDS = new Set(['sticker', 'text', 'shape', 'watermark', 'frame']);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function EditorCanvas({ source }: { source: ImageBitmap | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { canvas } = useRenderLoop(containerRef, source);
  const activeTool = useUiStore((state) => state.activeTool);
  const compareHeld = useUiStore((state) => state.compareHeld);
  const setViewport = useUiStore((state) => state.setViewport);
  const holdTimer = useRef<number | null>(null);
  const drawLayerId = useRef<string | null>(null);
  const movingLayerId = useRef<string | null>(null);
  const moveGrabOffset = useRef<{ dx: number; dy: number } | null>(null);

  const pointFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvas?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return null;
      return {
        x: clamp((clientX - rect.left) / rect.width, 0, 1),
        y: clamp((clientY - rect.top) / rect.height, 0, 1),
      };
    },
    [canvas],
  );

  const bind = useGesture(
    {
      onDragStart: ({ event }) => {
        if (activeTool !== 'draw') {
          const doc = getDoc();
          const selectedId = useUiStore.getState().selectedLayerId;
          const layer = doc.layers.find((candidate) => candidate.id === selectedId);
          if (layer && MOVABLE_LAYER_KINDS.has(layer.kind)) {
            const point = pointFromEvent((event as PointerEvent).clientX, (event as PointerEvent).clientY);
            if (point) {
              movingLayerId.current = layer.id;
              moveGrabOffset.current = { dx: point.x - layer.transform.x, dy: point.y - layer.transform.y };
              useDocStore.getState().beginInteraction('move-layer');
            }
          }
          return;
        }
        const doc = getDoc();
        const selectedId = useUiStore.getState().selectedLayerId;
        let layer =
          (doc.layers.find((candidate) => candidate.id === selectedId && candidate.kind === 'draw') as
            | DrawLayer
            | undefined) ?? (doc.layers.find((candidate) => candidate.kind === 'draw') as DrawLayer | undefined);
        if (!layer) {
          layer = createDrawLayer();
          addLayerToDoc(layer);
        }
        drawLayerId.current = layer.id;
        useDocStore.getState().beginInteraction('draw');
        const point = pointFromEvent((event as PointerEvent).clientX, (event as PointerEvent).clientY);
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
        }));
      },
      onDrag: ({ event, offset: [x, y] }) => {
        if (activeTool === 'draw') {
          const id = drawLayerId.current;
          const point = pointFromEvent((event as PointerEvent).clientX, (event as PointerEvent).clientY);
          if (!id || !point) return;
          useDocStore.getState().update((current) => ({
            ...current,
            layers: current.layers.map((candidate) => {
              if (candidate.id !== id || candidate.kind !== 'draw' || candidate.strokes.length === 0) return candidate;
              const strokes = candidate.strokes.slice();
              const last = strokes[strokes.length - 1];
              strokes[strokes.length - 1] = { ...last, points: [...last.points, point] };
              return { ...candidate, strokes };
            }),
          }));
          return;
        }
        if (movingLayerId.current && moveGrabOffset.current) {
          const point = pointFromEvent((event as PointerEvent).clientX, (event as PointerEvent).clientY);
          if (!point) return;
          const { dx, dy } = moveGrabOffset.current;
          const id = movingLayerId.current;
          updateLayerPatch(id, {
            transform: {
              ...getDoc().layers.find((candidate) => candidate.id === id)?.transform,
              x: clamp(point.x - dx, 0, 1),
              y: clamp(point.y - dy, 0, 1),
            },
          });
          return;
        }
        setViewport({ x, y });
      },
      onDragEnd: () => {
        if (activeTool === 'draw') {
          useDocStore.getState().endInteraction();
          drawLayerId.current = null;
        }
        if (movingLayerId.current) {
          useDocStore.getState().endInteraction();
          movingLayerId.current = null;
          moveGrabOffset.current = null;
        }
      },
      onPinch: ({ offset: [scale] }) => {
        setViewport({ scale: clamp(scale, MIN_ZOOM, MAX_ZOOM) });
      },
      onWheel: ({ event, delta: [dx, dy] }) => {
        event.preventDefault();
        const current = useUiStore.getState().viewport;
        if (event.ctrlKey || event.metaKey) {
          setViewport({ scale: clamp(current.scale * Math.exp(-dy * 0.01), MIN_ZOOM, MAX_ZOOM) });
        } else {
          setViewport({ x: current.x - dx, y: current.y - dy });
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
  );

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    useUiStore.getState().setCompareHeld(false);
  }, []);

  const startHold = useCallback(() => {
    if (holdTimer.current !== null) return;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      useUiStore.getState().setCompareHeld(true);
    }, 260);
  }, []);

  useEffect(() => cancelHold, [cancelHold]);

  const gesture = bind();

  return (
    <div className={styles.canvas} ref={containerRef}>
      <div
        className={styles.gestureLayer}
        {...gesture}
        onPointerDown={(event) => {
          gesture.onPointerDown?.(event);
          startHold();
        }}
        onPointerUp={(event) => {
          gesture.onPointerUp?.(event);
          cancelHold();
        }}
        onPointerCancel={(event) => {
          gesture.onPointerCancel?.(event);
          cancelHold();
        }}
        onPointerLeave={cancelHold}
        onDoubleClick={() => useUiStore.getState().resetViewport()}
      />
      {activeTool === 'crop' && <CropOverlay />}
      {compareHeld && <CompareBadge />}
    </div>
  );
}
