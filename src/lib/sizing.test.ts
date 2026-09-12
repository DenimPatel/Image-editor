import { describe, expect, it } from 'vitest';
import { createDoc } from '../model/defaults';
import type { Doc } from '../model/types';
import {
  computeOutputHeight,
  croppedPixelSize,
  isUpscale,
  resolveOutputSize,
  resolveResize,
  upscaleFactor,
} from './sizing';

describe('computeOutputHeight (moved, behaviour unchanged)', () => {
  it('derives height from the crop box aspect, not a separately typed ratio', () => {
    const crop = { x: 0, y: 0, width: 300, height: 200 };
    expect(computeOutputHeight(640, crop)).toBe(427);
  });

  it('ignores a typed ratio that disagrees with the actual crop box', () => {
    const crop = { x: 10, y: 10, width: 1600, height: 900 };
    expect(computeOutputHeight(1280, crop)).toBe(720);
  });

  it('handles a square crop', () => {
    const crop = { x: 0, y: 0, width: 500, height: 500 };
    expect(computeOutputHeight(200, crop)).toBe(200);
  });
});

describe('resolveResize', () => {
  const base = { width: 1600, height: 900 };

  it('passes through for mode none', () => {
    expect(resolveResize({ mode: 'none' }, base, 300)).toEqual(base);
  });

  it('resolves a width keeping aspect', () => {
    expect(resolveResize({ mode: 'width', width: 800 }, base, 300)).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('resolves a height keeping aspect', () => {
    expect(resolveResize({ mode: 'height', height: 450 }, base, 300)).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('resolves a long edge', () => {
    expect(resolveResize({ mode: 'longEdge', longEdge: 800 }, base, 300)).toEqual({
      width: 800,
      height: 450,
    });
  });

  it('resolves a percent', () => {
    expect(resolveResize({ mode: 'percent', percent: 25 }, base, 300)).toEqual({
      width: 400,
      height: 225,
    });
  });

  it('resolves physical millimetres at a DPI', () => {
    expect(resolveResize({ mode: 'physical', widthMm: 25.4, heightMm: 12.7, dpi: 300 }, base, 300)).toEqual({
      width: 300,
      height: 150,
    });
  });
});

describe('resolveOutputSize', () => {
  function docWith(source: { width: number; height: number }): Doc {
    return createDoc({
      source: { assetId: 'a', width: source.width, height: source.height, name: 'x', mime: 'image/jpeg' },
    });
  }

  it('returns the cropped size when resize is none', () => {
    const doc = docWith({ width: 1600, height: 900 });
    expect(croppedPixelSize(doc)).toEqual({ width: 1600, height: 900 });
    expect(resolveOutputSize(doc)).toEqual({ width: 1600, height: 900 });
  });

  it('accounts for a crop box', () => {
    const doc = docWith({ width: 1000, height: 1000 });
    doc.geometry.crop = { x: 0.5, y: 0, width: 0.5, height: 0.5 };
    expect(resolveOutputSize(doc)).toEqual({ width: 500, height: 500 });
  });

  it('swaps dimensions for a quarter turn and keeps the crop', () => {
    const doc = docWith({ width: 1600, height: 900 });
    doc.geometry.orientation.quarterTurns = 1;
    expect(croppedPixelSize(doc)).toEqual({ width: 900, height: 1600 });
  });

  it('caps upscaling at 4x', () => {
    const doc = docWith({ width: 100, height: 100 });
    doc.output.resize = { mode: 'width', width: 10000 };
    expect(resolveOutputSize(doc)).toEqual({ width: 400, height: 400 });
  });
});

describe('upscale helpers', () => {
  it('detects upscaling', () => {
    expect(upscaleFactor({ width: 100, height: 100 }, { width: 200, height: 200 })).toBeCloseTo(2);
    expect(isUpscale({ width: 100, height: 100 }, { width: 200, height: 200 })).toBe(true);
    expect(isUpscale({ width: 100, height: 100 }, { width: 100, height: 100 })).toBe(false);
  });
});
