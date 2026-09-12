import type { Doc, ResizeSpec, Size } from '../model/types';
import { getTransformedSize, mmToPx } from './crop/geometry';

/**
 * Output height is derived from the actual crop box's own aspect ratio, never
 * from the typed "W:H" ratio field. The original Python app recomputed height
 * from the typed ratio, so a crop box that drifted from the typed value
 * silently distorted the image on export.
 */
export function computeOutputHeight(outWidth: number, crop: { width: number; height: number }): number {
  return Math.round((outWidth * crop.height) / crop.width);
}

export const MAX_UPSCALE = 4;

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function resolveResize(resize: ResizeSpec, base: Size, dpi: number): Size {
  const { width, height } = base;
  switch (resize.mode) {
    case 'none':
      return { width: positive(width), height: positive(height) };
    case 'width': {
      const w = positive(resize.width);
      return { width: Math.round(w), height: Math.round((w * height) / width) };
    }
    case 'height': {
      const h = positive(resize.height);
      return { width: Math.round((h * width) / height), height: Math.round(h) };
    }
    case 'longEdge': {
      const edge = positive(resize.longEdge);
      const scale = edge / Math.max(width, height);
      return { width: Math.round(width * scale), height: Math.round(height * scale) };
    }
    case 'percent': {
      const scale = positive(resize.percent) / 100;
      return { width: Math.round(width * scale), height: Math.round(height * scale) };
    }
    case 'physical': {
      return {
        width: Math.round(positive(mmToPx(resize.widthMm, dpi))),
        height: Math.round(positive(mmToPx(resize.heightMm, dpi))),
      };
    }
  }
}

/** Rendered size of the cropped image before any output resize. */
export function croppedPixelSize(doc: Doc): Size {
  const source = doc.source;
  if (!source) return { width: 1, height: 1 };
  const { orientation, straighten, crop } = doc.geometry;
  const swapped = orientation.quarterTurns % 2 === 1;
  const baseW = swapped ? source.height : source.width;
  const baseH = swapped ? source.width : source.height;
  const transformed = getTransformedSize(baseW, baseH, straighten);
  return {
    width: Math.max(1, Math.round(transformed.width * crop.width)),
    height: Math.max(1, Math.round(transformed.height * crop.height)),
  };
}

export function resolveOutputSize(doc: Doc): Size {
  const base = croppedPixelSize(doc);
  const resized = resolveResize(doc.output.resize, base, doc.output.dpi);
  const cap = MAX_UPSCALE;
  return {
    width: Math.max(1, Math.min(resized.width, Math.round(base.width * cap))),
    height: Math.max(1, Math.min(resized.height, Math.round(base.height * cap))),
  };
}

export function upscaleFactor(base: Size, out: Size): number {
  return Math.max(out.width / base.width, out.height / base.height);
}

export function isUpscale(base: Size, out: Size): boolean {
  return upscaleFactor(base, out) > 1.0001;
}