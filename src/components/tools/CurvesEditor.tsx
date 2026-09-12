import { useMemo, useRef, useState } from 'react';
import { buildCurveLut } from '../../lib/curves';
import type { CurveChannel, CurvePoint } from '../../model/types';
import { setCurveChannel } from '../../store/actions';
import { useDocStore } from '../../store/docStore';
import { SegmentedControl } from '../controls/SegmentedControl';
import styles from './tools.module.css';

const SIZE = 260;
const CHANNELS: { value: CurveChannel; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'R' },
  { value: 'g', label: 'G' },
  { value: 'b', label: 'B' },
];

const CHANNEL_COLOR: Record<CurveChannel, string> = {
  rgb: '#ffffff',
  r: '#ff5a5a',
  g: '#4fdc78',
  b: '#5a8cff',
};

function sortPoints(points: CurvePoint[]): CurvePoint[] {
  return [...points].sort((a, b) => a.x - b.x);
}

export function CurvesEditor() {
  const curves = useDocStore((state) => state.present.curves);
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const points = curves[channel];
  const path = useMemo(() => {
    const lut = buildCurveLut(points);
    return Array.from(lut)
      .map((value, x) => `${x === 0 ? 'M' : 'L'}${(x / 255) * SIZE},${SIZE - (value / 255) * SIZE}`)
      .join(' ');
  }, [points]);

  const positionFromEvent = (event: React.PointerEvent): CurvePoint => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * 255),
      y: Math.round(255 - ((event.clientY - rect.top) / rect.height) * 255),
    };
  };

  const updatePoint = (index: number, point: CurvePoint) => {
    const clamped: CurvePoint = {
      x: Math.max(0, Math.min(255, point.x)),
      y: Math.max(0, Math.min(255, point.y)),
    };
    if (index === 0) clamped.x = 0;
    if (index === points.length - 1) clamped.x = 255;
    const next = sortPoints(points.map((existing, i) => (i === index ? clamped : existing)));
    setCurveChannel(channel, next);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragging.current === null) return;
    const point = positionFromEvent(event);
    const index = dragging.current;
    const cloned = [...points];
    const previous = cloned[index - 1];
    const following = cloned[index + 1];
    if (previous) point.x = Math.max(previous.x + 1, point.x);
    if (following) point.x = Math.min(following.x - 1, point.x);
    updatePoint(index, point);
  };

  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const point = positionFromEvent(event as unknown as React.PointerEvent);
    const existing = points.findIndex(
      (candidate) => Math.abs(candidate.x - point.x) < 8 && Math.abs(candidate.y - point.y) < 8,
    );
    if (existing !== -1 && existing !== 0 && existing !== points.length - 1) {
      setCurveChannel(channel, points.filter((_, index) => index !== existing));
      return;
    }
    if (existing === -1) {
      setCurveChannel(channel, sortPoints([...points, point]));
    }
  };

  return (
    <div>
      <SegmentedControl
        ariaLabel="Curve channel"
        options={CHANNELS}
        value={channel}
        onChange={(next) => setChannel(next)}
      />
      <svg
        ref={svgRef}
        className={styles.curves}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerLeave={() => {
          dragging.current = null;
        }}
        onDoubleClick={handleDoubleClick}
        role="application"
        aria-label={`${channel} curves editor`}
      >
        <rect x="0" y="0" width={SIZE} height={SIZE} fill="rgba(255,255,255,0.04)" />
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction}>
            <line
              x1={fraction * SIZE}
              y1={0}
              x2={fraction * SIZE}
              y2={SIZE}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
            <line
              x1={0}
              y1={fraction * SIZE}
              x2={SIZE}
              y2={fraction * SIZE}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
          </g>
        ))}
        <path d={path} fill="none" stroke={CHANNEL_COLOR[channel]} strokeWidth="2" />
        {points.map((point, index) => (
          <circle
            key={`${point.x}-${index}`}
            cx={(point.x / 255) * SIZE}
            cy={SIZE - (point.y / 255) * SIZE}
            r={9}
            fill="#121214"
            stroke={CHANNEL_COLOR[channel]}
            strokeWidth="2"
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(event) => {
              event.stopPropagation();
              (event.target as Element).setPointerCapture(event.pointerId);
              dragging.current = index;
            }}
          />
        ))}
      </svg>
      <p className={styles.hint}>Double-tap the graph to add a point; drag a point to shape the curve; double-tap a point to remove it.</p>
    </div>
  );
}
