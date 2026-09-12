import { useCallback, useRef } from 'react';
import { useHaptics } from '../../hooks/useHaptics';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import styles from './controls.module.css';

export type DialSliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  neutral?: number;
  unit?: string;
  pxPerUnit?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * iOS-Photos-style dial: a tick ruler with a fixed centre needle, no momentum,
 * a detent + haptic tick at the neutral value, and double-tap to reset.
 * Fully keyboard operable.
 */
export function DialSlider({
  label,
  value,
  min,
  max,
  step = 1,
  neutral = 0,
  unit = '',
  pxPerUnit = 2,
  disabled = false,
  format,
  onChange,
  onInteractionStart,
  onInteractionEnd,
}: DialSliderProps) {
  const haptics = useHaptics();
  const startValue = useRef(value);
  const totalDx = useRef(0);
  const detentActive = useRef(value === neutral);
  const lastTap = useRef(0);

  const emit = useCallback(
    (next: number) => {
      const clamped = clamp(next, min, max);
      const atDetent = Math.abs(clamped - neutral) < step / 2 + 1e-9;
      const snapped = atDetent ? neutral : clamped;
      if (atDetent && !detentActive.current) {
        detentActive.current = true;
        haptics(8);
      } else if (!atDetent) {
        detentActive.current = false;
      }
      onChange(snapped);
    },
    [haptics, max, min, neutral, onChange, step],
  );

  const { onPointerDown } = usePointerDrag({
    onStart: () => {
      startValue.current = value;
      totalDx.current = 0;
      onInteractionStart?.();
    },
    onMove: (dx) => {
      totalDx.current += dx;
      const raw = startValue.current + totalDx.current / pxPerUnit;
      const snapped = Math.round(raw / step) * step;
      emit(snapped);
    },
    onEnd: () => {
      onInteractionEnd?.();
    },
  });

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        onInteractionStart?.();
        emit(neutral);
        onInteractionEnd?.();
        haptics(12);
        return;
      }
      lastTap.current = now;
      onPointerDown(event);
    },
    [emit, haptics, neutral, onInteractionEnd, onInteractionStart, onPointerDown],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      let next: number;
      const big = step * 10;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          next = value + step;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          next = value - step;
          break;
        case 'PageUp':
          next = value + big;
          break;
        case 'PageDown':
          next = value - big;
          break;
        case 'Home':
          next = neutral;
          break;
        case 'End':
          next = max;
          break;
        default:
          return;
      }
      event.preventDefault();
      emit(next);
    },
    [emit, max, neutral, step, value],
  );

  const display = format
    ? format(value)
    : `${value > 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`;
  const offset = (value - neutral) * pxPerUnit;

  return (
    <div className={styles.dial}>
      <div className={styles.dialHeader}>
        <span>{label}</span>
        <span className={styles.dialValue}>{display}</span>
      </div>
      <div
        className={styles.dialTrack}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        aria-disabled={disabled}
        onPointerDown={disabled ? undefined : handlePointerDown}
        onKeyDown={disabled ? undefined : handleKeyDown}
      >
        <div className={styles.dialRulerMajor} style={{ backgroundPositionX: `calc(50% - ${offset}px)` }} />
        <div className={styles.dialRuler} style={{ backgroundPositionX: `calc(50% - ${offset}px)` }} />
        <div className={styles.dialNeedle} />
        <div className={`${styles.dialDetent}${value === neutral ? ` ${styles.dialDetentActive}` : ''}`} />
      </div>
    </div>
  );
}
