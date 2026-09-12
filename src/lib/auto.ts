import type { Adjust, AdjustKey } from '../model/types';
import { ADJUST_SPEC_BY_KEY } from '../model/defaults';

export type Histogram = {
  luma: Uint32Array;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  total: number;
};

function clampToSpec(key: AdjustKey, value: number): number {
  const spec = ADJUST_SPEC_BY_KEY[key];
  return Math.max(spec.min, Math.min(spec.max, value));
}

/** Histogram of an RGBA pixel buffer (4 bytes per pixel). */
export function buildHistogram(data: Uint8ClampedArray | number[]): Histogram {
  const luma = new Uint32Array(256);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  let total = 0;

  for (let i = 0; i + 3 < data.length; i += 4) {
    const rv = data[i];
    const gv = data[i + 1];
    const bv = data[i + 2];
    r[rv] += 1;
    g[gv] += 1;
    b[bv] += 1;
    const lv = Math.max(0, Math.min(255, Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv)));
    luma[lv] += 1;
    total += 1;
  }

  return { luma, r, g, b, total };
}

function percentile(hist: Uint32Array, total: number, fraction: number): number {
  if (total <= 0) return 0;
  const target = Math.max(1, Math.round(fraction * total));
  let cumulative = 0;
  for (let i = 0; i < 256; i += 1) {
    cumulative += hist[i];
    if (cumulative >= target) return i;
  }
  return 255;
}

export function autoAdjust(histogram: Histogram): Partial<Adjust> {
  const total = histogram.total;
  if (total <= 0) {
    return { exposure: 0, contrast: 0, blackPoint: 0, brightness: 0, highlights: 0, shadows: 0 };
  }

  const black = percentile(histogram.luma, total, 0.005);
  const white = percentile(histogram.luma, total, 0.995);

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram.luma[i];
  const mean = sum / total / 255;

  const range = (white - black) / 255;
  const lift = 0.5 - mean;

  return {
    exposure: clampToSpec('exposure', lift * 4),
    contrast: clampToSpec('contrast', Math.max(0, (0.75 - range) * 120)),
    brightness: clampToSpec('brightness', lift * 50),
    blackPoint: clampToSpec('blackPoint', (black - 16) * 0.6),
    highlights: clampToSpec('highlights', lift * 60),
    shadows: clampToSpec('shadows', lift * 80),
  };
}
