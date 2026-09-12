import type { Pass } from './passes';

export type Tile = { x: number; y: number; width: number; height: number; halo: number };

export type TileOptions = {
  maxArea: number;
  maxTextureSize: number;
  halo: number;
};

/**
 * Split an image into non-overlapping core tiles that each fit in one render
 * target (including the halo needed for spatially-dependent passes). Core
 * rects tile the image exactly; `tileRenderSize` expands each by the halo at
 * draw time so neighbouring pixels are available to blur/sharpen kernels.
 */
export function computeTiles(width: number, height: number, options: TileOptions): Tile[] {
  const { maxArea, maxTextureSize, halo } = options;
  const limit = Math.max(
    1,
    Math.min(maxTextureSize, Math.floor(Math.sqrt(Math.max(1, maxArea)))) - halo * 2,
  );

  const columns = Math.max(1, Math.ceil(width / limit));
  const rows = Math.max(1, Math.ceil(height / limit));
  const tileWidth = Math.ceil(width / columns);
  const tileHeight = Math.ceil(height / rows);

  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = col * tileWidth;
      const y = row * tileHeight;
      tiles.push({
        x,
        y,
        width: Math.min(tileWidth, width - x),
        height: Math.min(tileHeight, height - y),
        halo,
      });
    }
  }
  return tiles;
}

/** Region (clipped to the image) that must be rendered for a tile. */
export function tileRenderSize(
  tile: Tile,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, tile.x - tile.halo);
  const y = Math.max(0, tile.y - tile.halo);
  const right = Math.min(width, tile.x + tile.width + tile.halo);
  const bottom = Math.min(height, tile.y + tile.height + tile.halo);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Halo in pixels required by the plan's spatially-dependent passes. Global
 * passes (curves, vignette, grain) need none; blur-like passes need roughly
 * their radius.
 */
export function planHalo(passes: Pass[], size: { width: number; height: number }): number {
  const longEdge = Math.max(size.width, size.height);
  let radius = 0;
  for (const pass of passes) {
    switch (pass.kind) {
      case 'effects':
        radius = Math.max(radius, longEdge * 0.05 * Math.max(pass.bloom, pass.fieldBlur));
        break;
      case 'sharpen':
      case 'definition':
      case 'denoise':
        radius = Math.max(radius, 4);
        break;
      default:
        break;
    }
  }
  return Math.ceil(radius) + 2;
}
