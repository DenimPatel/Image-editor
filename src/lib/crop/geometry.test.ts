import { describe, expect, it } from 'vitest';
import type { NormRect, Orientation } from '../../model/types';
import {
  clampInsideImage,
  constrainToAspect,
  cropToPixels,
  getTransformedSize,
  largestInscribedRect,
  mmToPx,
  rectForHandleDrag,
  transformCropUnderOrientation,
} from './geometry';

describe('getTransformedSize (moved, behaviour unchanged)', () => {
  it('keeps dimensions unchanged at 0 degrees', () => {
    expect(getTransformedSize(800, 600, 0)).toEqual({ width: 800, height: 600 });
  });

  it('swaps width and height at 90 degrees', () => {
    expect(getTransformedSize(800, 600, 90)).toEqual({ width: 600, height: 800 });
  });

  it('swaps width and height at 270 degrees', () => {
    expect(getTransformedSize(800, 600, 270)).toEqual({ width: 600, height: 800 });
  });

  it('keeps dimensions unchanged at 180 degrees', () => {
    expect(getTransformedSize(800, 600, 180)).toEqual({ width: 800, height: 600 });
  });

  it('expands the bounding box for an arbitrary angle', () => {
    const { width, height } = getTransformedSize(800, 600, 37);
    expect(width).toBeGreaterThan(800);
    expect(height).toBeGreaterThan(600);
  });
});

describe('mmToPx', () => {
  it('converts at 300 DPI', () => {
    // 25.4 mm = 1 inch = 300 px
    expect(mmToPx(25.4, 300)).toBeCloseTo(300, 6);
  });
});

describe('clampInsideImage', () => {
  it('pulls an overflowing rect back inside the unit square', () => {
    expect(clampInsideImage({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
  });
});

describe('constrainToAspect', () => {
  it('produces the requested aspect', () => {
    const rect = constrainToAspect({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 16 / 9);
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 6);
  });

  it('keeps the result inside the unit square', () => {
    const rect = constrainToAspect({ x: 0, y: 0, width: 0.9, height: 0.9 }, 0.1);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1.0000001);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1.0000001);
  });
});

describe('largestInscribedRect', () => {
  it('returns the full image at 0 degrees', () => {
    const rect = largestInscribedRect(1000, 800, 0, 1000 / 800);
    expect(rect.width).toBeCloseTo(1000, 2);
    expect(rect.height).toBeCloseTo(800, 2);
  });

  it('shrinks monotonically as the straighten angle grows', () => {
    const at0 = largestInscribedRect(1000, 800, 0).width;
    const at15 = largestInscribedRect(1000, 800, 15).width;
    const at45 = largestInscribedRect(1000, 800, 45).width;
    expect(at15).toBeLessThan(at0);
    expect(at45).toBeLessThan(at15);
  });

  it('keeps the requested aspect at 45 degrees', () => {
    const rect = largestInscribedRect(1000, 800, 45, 1);
    expect(rect.width / rect.height).toBeCloseTo(1, 6);
  });

  it('fits inside the rotated image (corner test)', () => {
    const rect = largestInscribedRect(1000, 800, 15);
    const halfW = 1000 / 2;
    const halfH = 800 / 2;
    const theta = (15 * Math.PI) / 180;
    for (const [x, y] of [
      [-rect.width / 2, -rect.height / 2],
      [rect.width / 2, -rect.height / 2],
      [-rect.width / 2, rect.height / 2],
      [rect.width / 2, rect.height / 2],
    ]) {
      const rx = x * Math.cos(theta) + y * Math.sin(theta);
      const ry = -x * Math.sin(theta) + y * Math.cos(theta);
      expect(Math.abs(rx)).toBeLessThanOrEqual(halfW + 1);
      expect(Math.abs(ry)).toBeLessThanOrEqual(halfH + 1);
    }
  });
});

describe('rectForHandleDrag', () => {
  const rect: NormRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it('moves the whole rect without resizing', () => {
    const moved = rectForHandleDrag(rect, 'move', 0.1, -0.1);
    expect(moved.width).toBeCloseTo(0.5);
    expect(moved.height).toBeCloseTo(0.5);
    expect(moved.x).toBeCloseTo(0.35);
    expect(moved.y).toBeCloseTo(0.15);
  });

  it('drags a corner and respects the aspect lock', () => {
    const dragged = rectForHandleDrag(rect, 'se', 0.1, 0.1, 1);
    expect(dragged.width / dragged.height).toBeCloseTo(1, 6);
  });

  it('never inverts (keeps the minimum size)', () => {
    const dragged = rectForHandleDrag(rect, 'nw', 1, 1);
    expect(dragged.width).toBeGreaterThan(0);
    expect(dragged.height).toBeGreaterThan(0);
  });
});

describe('transformCropUnderOrientation', () => {
  function orientations(): Orientation[] {
    const list: Orientation[] = [];
    for (let q = 0; q < 4; q += 1) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          list.push({ quarterTurns: q, flipH, flipV });
        }
      }
    }
    return list;
  }

  it('leaves the crop unchanged for an identity change', () => {
    const crop: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const same = transformCropUnderOrientation(crop, orientations()[0], orientations()[0]);
    expect(same.x).toBeCloseTo(crop.x, 9);
    expect(same.y).toBeCloseTo(crop.y, 9);
    expect(same.width).toBeCloseTo(crop.width, 9);
    expect(same.height).toBeCloseTo(crop.height, 9);
  });

  it('maps a crop to the rotated quadrant on one CW turn', () => {
    const crop: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const from: Orientation = { quarterTurns: 0, flipH: false, flipV: false };
    const to: Orientation = { quarterTurns: 1, flipH: false, flipV: false };
    const mapped = transformCropUnderOrientation(crop, from, to);
    expect(mapped.x).toBeCloseTo(1 - crop.y - crop.height, 9);
    expect(mapped.y).toBeCloseTo(crop.x, 9);
    expect(mapped.width).toBeCloseTo(crop.height, 9);
    expect(mapped.height).toBeCloseTo(crop.width, 9);
  });

  it('round-trips under every pair of the 8 orientations', () => {
    const crop: NormRect = { x: 0.12, y: 0.28, width: 0.34, height: 0.22 };
    for (const from of orientations()) {
      for (const to of orientations()) {
        const there = transformCropUnderOrientation(crop, from, to);
        const back = transformCropUnderOrientation(there, to, from);
        expect(back.x).toBeCloseTo(crop.x, 8);
        expect(back.y).toBeCloseTo(crop.y, 8);
        expect(back.width).toBeCloseTo(crop.width, 8);
        expect(back.height).toBeCloseTo(crop.height, 8);
      }
    }
  });
});

describe('cropToPixels', () => {
  it('scales a normalized crop into image pixels', () => {
    expect(cropToPixels({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, 1000, 800)).toEqual({
      x: 500,
      y: 200,
      width: 500,
      height: 400,
    });
  });
});
