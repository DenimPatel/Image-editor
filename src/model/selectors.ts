import type { AssetId, Doc, Size } from './types';
import { croppedPixelSize, resolveOutputSize } from '../lib/sizing';

/** Every asset id the document references — drives AssetStore.prune(). */
export function activeAssetIds(doc: Doc): Set<AssetId> {
  const ids = new Set<AssetId>();
  if (doc.source) ids.add(doc.source.assetId);
  if (doc.background.imageAssetId) ids.add(doc.background.imageAssetId);
  for (const layer of doc.layers) {
    if (layer.kind === 'sticker' && layer.assetId) ids.add(layer.assetId);
    if (layer.kind === 'watermark' && layer.assetId) ids.add(layer.assetId);
  }
  return ids;
}

/** Rendered crop size in image pixels, before output resize. */
export function croppedSize(doc: Doc): Size {
  return croppedPixelSize(doc);
}

/** Final output pixel dimensions after resize/DPI. */
export function effectiveOutputSize(doc: Doc): Size {
  return resolveOutputSize(doc);
}

/**
 * Whether the chosen format can preserve alpha. JPEG and PDF flatten onto the
 * matte; PNG/WebP/AVIF keep the source alpha when no background has been
 * composited.
 */
export function hasAlphaOutput(doc: Doc): boolean {
  const { format } = doc.output;
  if (format !== 'png' && format !== 'webp' && format !== 'avif') return false;
  return doc.background.mode === 'none';
}

export function needsFlatten(doc: Doc): boolean {
  return doc.output.format === 'jpeg' || doc.output.format === 'pdf';
}

export function isNeutralAdjust(adjust: Doc['adjust']): boolean {
  return Object.values(adjust).every((value) => value === 0);
}

export function hasEdits(doc: Doc): boolean {
  if (doc.layers.length > 0 || doc.masks.length > 0 || doc.localAdjusts.length > 0) return true;
  if (doc.retouch.healSpots.length > 0 || doc.retouch.smooth > 0) return true;
  if (doc.look.id !== null) return true;
  if (doc.effects.grain || doc.effects.bloom || doc.effects.fieldBlur) return true;
  if (!isNeutralAdjust(doc.adjust)) return true;
  const { crop, straighten, orientation, perspective } = doc.geometry;
  if (crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1) return true;
  if (straighten !== 0) return true;
  if (orientation.quarterTurns !== 0 || orientation.flipH || orientation.flipV) return true;
  const p = perspective;
  if (
    p.topLeft.x ||
    p.topLeft.y ||
    p.topRight.x ||
    p.topRight.y ||
    p.bottomLeft.x ||
    p.bottomLeft.y ||
    p.bottomRight.x ||
    p.bottomRight.y
  ) {
    return true;
  }
  return false;
}