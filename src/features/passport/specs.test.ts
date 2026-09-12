import { describe, expect, it } from 'vitest';
import { PASSPORT_SPECS, getSpec } from './specs';

const REQUIRED_IDS = [
  'us-2x2',
  'us-visa-2x2',
  'india-2x2',
  'uk-35x45',
  'schengen-35x45',
  'canada-50x70',
  'australia-35x45',
  'china-33x48',
  'japan-35x45',
  'oci-51x51',
  'generic-35x45',
];

describe('PASSPORT_SPECS', () => {
  it('exposes every required id exactly once', () => {
    const ids = PASSPORT_SPECS.map((spec) => spec.id);
    expect([...ids].sort()).toEqual([...REQUIRED_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has sane dimensions, ranges and notes for every spec', () => {
    for (const spec of PASSPORT_SPECS) {
      expect(spec.widthMm).toBeGreaterThan(0);
      expect(spec.heightMm).toBeGreaterThan(0);
      expect(spec.dpi).toBeGreaterThanOrEqual(300);
      expect(spec.headHeightMm.min).toBeGreaterThan(0);
      expect(spec.headHeightMm.max).toBeGreaterThan(spec.headHeightMm.min);
      expect(spec.eyeLineMmFromBottom.min).toBeGreaterThan(0);
      expect(spec.eyeLineMmFromBottom.max).toBeGreaterThan(spec.eyeLineMmFromBottom.min);
      expect(spec.notes.length).toBeGreaterThan(0);
      for (const note of spec.notes) {
        expect(typeof note).toBe('string');
        expect(note.length).toBeGreaterThan(0);
      }
    }
  });

  it('matches the canonical real-world sizes', () => {
    expect(getSpec('us-2x2')?.widthMm).toBeCloseTo(50.8, 6);
    expect(getSpec('us-2x2')?.heightMm).toBeCloseTo(50.8, 6);
    expect(getSpec('oci-51x51')?.widthMm).toBeCloseTo(51, 6);
    expect(getSpec('uk-35x45')).toMatchObject({ widthMm: 35, heightMm: 45 });
    expect(getSpec('schengen-35x45')).toMatchObject({ widthMm: 35, heightMm: 45 });
    expect(getSpec('canada-50x70')).toMatchObject({ widthMm: 50, heightMm: 70 });
    expect(getSpec('china-33x48')).toMatchObject({ widthMm: 33, heightMm: 48 });
    expect(getSpec('japan-35x45')).toMatchObject({ widthMm: 35, heightMm: 45 });
  });

  it('uses the US head height range of 1–1.375 in', () => {
    const us = getSpec('us-2x2');
    expect(us?.headHeightMm.min).toBeCloseTo(25.4, 6);
    expect(us?.headHeightMm.max).toBeCloseTo(34.925, 6);
    expect(us?.eyeLineMmFromBottom.min).toBeCloseTo(28.575, 6);
    expect(us?.eyeLineMmFromBottom.max).toBeCloseTo(34.925, 6);
  });
});

describe('getSpec', () => {
  it('returns undefined for an unknown id', () => {
    expect(getSpec('does-not-exist')).toBeUndefined();
  });
});