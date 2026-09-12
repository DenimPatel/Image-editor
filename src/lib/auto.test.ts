import { describe, expect, it } from 'vitest';
import { autoAdjust, buildHistogram } from './auto';
import type { Histogram } from './auto';

function histogramFromValues(values: number[]): Histogram {
  const luma = new Uint32Array(256);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  for (const value of values) {
    luma[value] += 1;
    r[value] += 1;
    g[value] += 1;
    b[value] += 1;
  }
  return { luma, r, g, b, total: values.length };
}

function range(start: number, end: number): number[] {
  const values: number[] = [];
  for (let i = start; i <= end; i += 1) values.push(i);
  return values;
}

describe('buildHistogram', () => {
  it('bins rgba pixels and computes luma', () => {
    const data = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255];
    const histogram = buildHistogram(data);
    expect(histogram.total).toBe(3);
    expect(histogram.r[255]).toBe(1);
    expect(histogram.g[255]).toBe(1);
    expect(histogram.b[255]).toBe(1);
    expect(histogram.luma[Math.round(0.2126 * 255)]).toBe(1);
    expect(histogram.luma[Math.round(0.7152 * 255)]).toBe(1);
    expect(histogram.luma[Math.round(0.0722 * 255)]).toBe(1);
  });
});

describe('autoAdjust', () => {
  it('raises exposure for a dark histogram', () => {
    const histogram = histogramFromValues(range(20, 60));
    const result = autoAdjust(histogram);
    expect(result.exposure).toBeGreaterThan(0);
    expect(result.shadows).toBeGreaterThan(0);
  });

  it('raises contrast for a flat, low-contrast histogram', () => {
    const histogram = histogramFromValues(range(120, 135));
    const result = autoAdjust(histogram);
    expect(result.contrast).toBeGreaterThan(0);
  });

  it('lowers exposure for a bright histogram', () => {
    const histogram = histogramFromValues(range(200, 250));
    const result = autoAdjust(histogram);
    expect(result.exposure).toBeLessThan(0);
    expect(result.highlights).toBeLessThan(0);
  });

  it('stays near-neutral for an already well-exposed histogram', () => {
    const histogram = histogramFromValues(range(16, 240));
    const result = autoAdjust(histogram);
    expect(Math.abs(result.exposure ?? 0)).toBeLessThan(0.5);
    expect(Math.abs(result.contrast ?? 0)).toBeLessThan(5);
    expect(Math.abs(result.brightness ?? 0)).toBeLessThan(5);
    expect(Math.abs(result.highlights ?? 0)).toBeLessThan(5);
    expect(Math.abs(result.shadows ?? 0)).toBeLessThan(5);
    expect(Math.abs(result.blackPoint ?? 0)).toBeLessThan(10);
  });

  it('returns neutral values for an empty histogram', () => {
    const empty: Histogram = {
      luma: new Uint32Array(256),
      r: new Uint32Array(256),
      g: new Uint32Array(256),
      b: new Uint32Array(256),
      total: 0,
    };
    expect(autoAdjust(empty)).toEqual({
      exposure: 0,
      contrast: 0,
      blackPoint: 0,
      brightness: 0,
      highlights: 0,
      shadows: 0,
    });
  });
});
