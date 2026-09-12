import { describe, expect, it } from 'vitest';
import { mmToPx } from '../../lib/crop/geometry';
import { getSpec } from './specs';
import { planSheet, SHEET_SIZES_MM } from './sheet';
import type { SheetLayout, SheetPhoto } from './sheet';

const spec = getSpec('uk-35x45');
if (!spec) throw new Error('missing uk-35x45');

const UK = spec;

function overlaps(a: SheetPhoto, b: SheetPhoto): boolean {
  const epsilon = 1e-6;
  return (
    a.x + a.width > b.x + epsilon &&
    b.x + b.width > a.x + epsilon &&
    a.y + a.height > b.y + epsilon &&
    b.y + b.height > a.y + epsilon
  );
}

function expectNoOverlaps(layout: SheetLayout): void {
  for (let i = 0; i < layout.photos.length; i += 1) {
    for (let j = i + 1; j < layout.photos.length; j += 1) {
      expect(overlaps(layout.photos[i], layout.photos[j])).toBe(false);
    }
  }
}

describe('SHEET_SIZES_MM', () => {
  it('uses the correct inch and A4 sizes', () => {
    expect(SHEET_SIZES_MM['4x6']).toEqual({ widthMm: 101.6, heightMm: 152.4 });
    expect(SHEET_SIZES_MM['5x7']).toEqual({ widthMm: 127, heightMm: 177.8 });
    expect(SHEET_SIZES_MM.a4).toEqual({ widthMm: 210, heightMm: 297 });
  });
});

describe('planSheet', () => {
  it('fits 6 copies of 35x45 mm on 4x6 in at 300 DPI with 2 mm gaps', () => {
    const layout = planSheet(UK, '4x6', 6, 300);

    expect(layout.count).toBe(6);
    expect(layout.photos).toHaveLength(6);
    expect(layout.columns * layout.rows).toBe(6);
    expect(layout.gapPx).toBeCloseTo(mmToPx(2, 300), 6);
    expectNoOverlaps(layout);
  });

  it('caps 7 copies at the 6 that actually fit', () => {
    const layout = planSheet(UK, '4x6', 7, 300);

    expect(layout.count).toBe(6);
    expect(layout.photos).toHaveLength(6);
    expectNoOverlaps(layout);
  });

  it('never returns more photos than requested', () => {
    for (const copies of [0, 1, 2, 5, 20]) {
      for (const sheet of ['4x6', '5x7', 'a4'] as const) {
        const layout = planSheet(UK, sheet, copies);
        expect(layout.photos.length).toBeLessThanOrEqual(copies);
        expect(layout.count).toBe(layout.photos.length);
      }
    }
  });

  it('defaults the DPI to the spec DPI and sizes photos in millimetres', () => {
    const layout = planSheet(UK, '5x7', 4);

    expect(layout.dpi).toBe(UK.dpi);
    for (const photo of layout.photos) {
      expect(photo.width).toBeCloseTo(mmToPx(UK.widthMm, UK.dpi), 6);
      expect(photo.height).toBeCloseTo(mmToPx(UK.heightMm, UK.dpi), 6);
    }
  });

  it('lays out every photo inside the sheet without overlapping', () => {
    for (const sheet of ['4x6', '5x7', 'a4'] as const) {
      const layout = planSheet(UK, sheet, 100, 300);
      expectNoOverlaps(layout);
      for (const photo of layout.photos) {
        expect(photo.x).toBeGreaterThanOrEqual(0);
        expect(photo.y).toBeGreaterThanOrEqual(0);
        expect(photo.x + photo.width).toBeLessThanOrEqual(layout.sheetWidthPx + 1e-6);
        expect(photo.y + photo.height).toBeLessThanOrEqual(layout.sheetHeightPx + 1e-6);
      }
    }
  });
});