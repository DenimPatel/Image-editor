import { useEffect, useRef } from 'react';
import { buildHistogram } from '../../lib/auto';
import { croppedSize } from '../../model/selectors';
import { renderExportCanvas } from '../../render/exportCanvas';
import { useDocStore } from '../../store/docStore';
import styles from './tools.module.css';

const WIDTH = 256;
const HEIGHT = 80;

/** Live RGB + luma histogram, rendered from a small proxy of the edit. */
export function Histogram({ source }: { source: ImageBitmap | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revision = useDocStore((state) => state.revision);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const doc = useDocStore.getState().present;
        const base = croppedSize(doc);
        const width = 160;
        const height = Math.max(1, Math.round((width * base.height) / base.width));
        const proxy = await renderExportCanvas(source, doc, { width, height });
        const context = proxy.getContext('2d');
        if (!context || cancelled) return;
        const data = context.getImageData(0, 0, proxy.width, proxy.height).data;
        const histogram = buildHistogram(data);
        drawHistogram(canvas, histogram);
      } catch {
        // Histogram is advisory; ignore failures.
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, revision]);

  return <canvas ref={canvasRef} className={styles.histogram} width={WIDTH} height={HEIGHT} aria-hidden="true" />;
}

function drawHistogram(
  canvas: HTMLCanvasElement,
  histogram: ReturnType<typeof buildHistogram>,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = 'rgba(255,255,255,0.04)';
  context.fillRect(0, 0, WIDTH, HEIGHT);

  const channels: { data: Uint32Array; color: string }[] = [
    { data: histogram.luma, color: 'rgba(255,255,255,0.35)' },
    { data: histogram.r, color: 'rgba(255,80,80,0.5)' },
    { data: histogram.g, color: 'rgba(80,220,120,0.5)' },
    { data: histogram.b, color: 'rgba(90,140,255,0.5)' },
  ];

  context.globalCompositeOperation = 'lighter';
  for (const { data, color } of channels) {
    const max = Math.max(1, ...Array.from(data.slice(1, 255)));
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, HEIGHT);
    for (let i = 0; i < 256; i += 1) {
      const value = Math.min(1, data[i] / max);
      context.lineTo((i / 255) * WIDTH, HEIGHT - value * HEIGHT);
    }
    context.lineTo(WIDTH, HEIGHT);
    context.closePath();
    context.fill();
  }
  context.globalCompositeOperation = 'source-over';
}