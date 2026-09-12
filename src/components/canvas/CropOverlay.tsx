import { useEffect, useMemo, useRef, useState } from 'react';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { setCrop } from '../../store/actions';
import { getDoc, useDocStore } from '../../store/docStore';
import { useUiStore } from '../../store/uiStore';
import { effectiveOutputSize } from '../../model/selectors';
import type { NormRect } from '../../model/types';
import { rectForHandleDrag, type CropHandle } from '../../lib/crop/geometry';
import { PassportGuides } from './PassportGuides';
import { SafeAreaOverlay } from './SafeAreaOverlay';
import styles from './canvas.module.css';

const HANDLES: { id: CropHandle; className: string }[] = [
  { id: 'nw', className: styles.handleNw },
  { id: 'ne', className: styles.handleNe },
  { id: 'sw', className: styles.handleSw },
  { id: 'se', className: styles.handleSe },
];

function CropHandleView({
  id,
  className,
  displayW,
  displayH,
  zoom,
  aspectLock,
}: {
  id: CropHandle;
  className: string;
  displayW: number;
  displayH: number;
  zoom: number;
  aspectLock: number | null;
}) {
  const startRect = useRef<NormRect>(getDoc().geometry.crop);
  const { onPointerDown } = usePointerDrag({
    onStart: () => {
      startRect.current = getDoc().geometry.crop;
      useDocStore.getState().beginInteraction(`crop:${id}`);
    },
    onMove: (dx, dy) => {
      const nx = dx / Math.max(1, displayW * zoom);
      const ny = dy / Math.max(1, displayH * zoom);
      setCrop(rectForHandleDrag(startRect.current, id, nx, ny, aspectLock));
    },
    onEnd: () => useDocStore.getState().endInteraction(),
  });

  return (
    <span
      className={`${styles.handle} ${className}`}
      onPointerDown={onPointerDown}
      role="slider"
      aria-label={`Crop ${id} handle`}
      aria-valuetext="crop handle"
      tabIndex={0}
    />
  );
}

/**
 * Interactive crop box over the full straightened frame. Rendering during
 * crop deliberately ignores the committed crop (handled by useRenderLoop), so
 * the box can be dragged freely; the committed values are normalized and are
 * the exact numbers the renderer and export consume.
 */
export function CropOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 320, height: 320 });
  const crop = useDocStore((state) => state.present.geometry.crop);
  const aspectLock = useDocStore((state) => state.present.geometry.aspectLock);
  const doc = useDocStore((state) => state.present);
  const viewport = useUiStore((state) => state.viewport);
  const safeArea = useUiStore((state) => state.safeArea);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0) setContainerSize({ width: rect.width, height: rect.height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const fullDoc = useMemo(
    () => ({ ...doc, geometry: { ...doc.geometry, crop: { x: 0, y: 0, width: 1, height: 1 } } }),
    [doc],
  );
  const output = effectiveOutputSize(fullDoc);
  const availableW = Math.max(1, containerSize.width - 32);
  const availableH = Math.max(1, containerSize.height - 32);
  const fitScale = Math.min(availableW / output.width, availableH / output.height);
  const displayW = Math.max(1, output.width * fitScale);
  const displayH = Math.max(1, output.height * fitScale);
  const zoom = viewport.scale;
  const box = {
    left: crop.x * displayW,
    top: crop.y * displayH,
    width: crop.width * displayW,
    height: crop.height * displayH,
  };

  const startMove = useRef<NormRect>(crop);
  const move = usePointerDrag({
    onStart: () => {
      startMove.current = getDoc().geometry.crop;
      useDocStore.getState().beginInteraction('crop:move');
    },
    onMove: (dx, dy) => {
      const nx = dx / Math.max(1, displayW * zoom);
      const ny = dy / Math.max(1, displayH * zoom);
      setCrop(rectForHandleDrag(startMove.current, 'move', nx, ny, aspectLock));
    },
    onEnd: () => useDocStore.getState().endInteraction(),
  });

  const pixelW = Math.round(crop.width * output.width);
  const pixelH = Math.round(crop.height * output.height);

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
        {HANDLES.map(({ id, className }) => (
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
              displayW={displayW}
              displayH={displayH}
              zoom={zoom}
              aspectLock={aspectLock}
            />
          </div>
        ))}
        <SafeAreaOverlay preset={safeArea} />
        {doc.passport && <PassportGuides specId={doc.passport.specId} />}
      </div>
      <div className={styles.cropDimensions}>
        {pixelW} × {pixelH} px
      </div>
    </div>
  );
}