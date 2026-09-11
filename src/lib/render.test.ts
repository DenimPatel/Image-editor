import { describe, expect, it } from 'vitest';
import { computeOutputHeight, getTransformedSize } from './render';

describe('computeOutputHeight', () => {
  it('derives height from the crop box aspect, not a separately typed ratio', () => {
    // app.py bug: height was computed from the *typed* aspect-ratio field
    // (save_width / aspect_ratio[0] * aspect_ratio[1]), so it silently
    // distorted the image whenever the crop box didn't match. Here it must
    // come only from the crop rectangle itself.
    const crop = { x: 0, y: 0, width: 300, height: 200 }; // 3:2 crop
    expect(computeOutputHeight(640, crop)).toBe(427); // 640 * 200/300, rounded
  });

  it('ignores a typed ratio that disagrees with the actual crop box', () => {
    // Even if the UI's ratio field says "1:1", the crop box is 16:9 — the
    // output must follow the box, not the field.
    const crop = { x: 10, y: 10, width: 1600, height: 900 };
    expect(computeOutputHeight(1280, crop)).toBe(720);
  });

  it('handles a square crop', () => {
    const crop = { x: 0, y: 0, width: 500, height: 500 };
    expect(computeOutputHeight(200, crop)).toBe(200);
  });
});

describe('getTransformedSize', () => {
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
