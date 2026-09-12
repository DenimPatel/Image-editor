import { describe, expect, it } from 'vitest';
import { computeTiles, planHalo, tileRenderSize } from './tiling';
import type { Pass } from './passes';

describe('computeTiles', () => {
  it('covers the image exactly with no core overlaps', () => {
    const width = 5000;
    const height = 3000;
    const tiles = computeTiles(width, height, { maxArea: 16e6, maxTextureSize: 4096, halo: 8 });
    const area = tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
    expect(area).toBe(width * height);

    // No two core rects overlap.
    for (let i = 0; i < tiles.length; i += 1) {
      for (let j = i + 1; j < tiles.length; j += 1) {
        const a = tiles[i];
        const b = tiles[j];
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  });

  it('keeps every tile within the texture and area limits including halo', () => {
    const maxArea = 4_000_000;
    const maxTextureSize = 2048;
    const halo = 16;
    const tiles = computeTiles(9000, 6000, { maxArea, maxTextureSize, halo });
    for (const tile of tiles) {
      const render = tileRenderSize(tile, 9000, 6000);
      expect(render.width).toBeLessThanOrEqual(maxTextureSize);
      expect(render.height).toBeLessThanOrEqual(maxTextureSize);
      expect(render.width * render.height).toBeLessThanOrEqual(maxArea);
    }
  });

  it('handles a single small tile', () => {
    const tiles = computeTiles(100, 50, { maxArea: 16e6, maxTextureSize: 4096, halo: 8 });
    expect(tiles).toHaveLength(1);
    expect(tileRenderSize(tiles[0], 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
});

describe('tileRenderSize', () => {
  it('expands by the halo and clips at the borders', () => {
    const tile = { x: 100, y: 100, width: 200, height: 200, halo: 20 };
    const render = tileRenderSize(tile, 500, 500);
    expect(render).toEqual({ x: 80, y: 80, width: 240, height: 240 });
    expect(tileRenderSize({ x: 0, y: 0, width: 100, height: 100, halo: 20 }, 500, 500)).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 120,
    });
  });
});

describe('planHalo', () => {
  it('is small for global-only passes', () => {
    const passes: Pass[] = [{ kind: 'vignette', amount: 0.5 }, { kind: 'output', width: 10, height: 10, matte: '#fff', flatten: false, alpha: false }];
    expect(planHalo(passes, { width: 100, height: 100 })).toBe(2);
  });

  it('grows with a large field blur', () => {
    const passes: Pass[] = [{ kind: 'effects', grain: 0, bloom: 0, fieldBlur: 1 }];
    expect(planHalo(passes, { width: 4000, height: 3000 })).toBeGreaterThan(100);
  });

  it('accounts for sharpen kernels', () => {
    const passes: Pass[] = [{ kind: 'sharpen', amount: 1 }];
    expect(planHalo(passes, { width: 100, height: 100 })).toBe(6);
  });
});