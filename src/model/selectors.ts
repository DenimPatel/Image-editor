import { curvesAreIdentity } from '../lib/curves'
import type { AssetId, Doc, Size } from './types'
import { DEFAULT_MULTI_WIDTHS, DEFAULT_OUTPUT, HSL_BANDS } from './defaults'
import { croppedPixelSize, resolveOutputSize } from '../lib/sizing'

/** Every asset id the document references — drives AssetStore.prune(). */
export function activeAssetIds(doc: Doc): Set<AssetId> {
  const ids = new Set<AssetId>()
  if (doc.source) ids.add(doc.source.assetId)
  if (doc.background.imageAssetId) ids.add(doc.background.imageAssetId)
  for (const layer of doc.layers) {
    if (layer.kind === 'sticker' && layer.assetId) ids.add(layer.assetId)
    if (layer.kind === 'watermark' && layer.assetId) ids.add(layer.assetId)
  }
  return ids
}

/** Rendered crop size in image pixels, before output resize. */
export function croppedSize(doc: Doc): Size {
  return croppedPixelSize(doc)
}

/** Final output pixel dimensions after resize/DPI. */
export function effectiveOutputSize(doc: Doc): Size {
  return resolveOutputSize(doc)
}

/**
 * Whether the chosen format can preserve alpha. JPEG and PDF flatten onto the
 * matte; PNG/WebP/AVIF keep the source alpha when no background has been
 * composited.
 */
export function hasAlphaOutput(doc: Doc): boolean {
  const { format } = doc.output
  if (format !== 'png' && format !== 'webp' && format !== 'avif') return false
  return doc.background.mode === 'none'
}

export function needsFlatten(doc: Doc): boolean {
  return doc.output.format === 'jpeg' || doc.output.format === 'pdf'
}

export function isNeutralAdjust(adjust: Doc['adjust']): boolean {
  return Object.values(adjust).every((value) => value === 0)
}

export function isNeutralHsl(hsl: Doc['hsl']): boolean {
  return HSL_BANDS.every((band) => {
    const value = hsl[band]
    return value.hue === 0 && value.sat === 0 && value.lum === 0
  })
}

function isFullFrame(crop: Doc['geometry']['crop']): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1
}

function isDefaultOutput(doc: Doc): boolean {
  const { output } = doc
  return (
    output.format === DEFAULT_OUTPUT.format &&
    output.quality === DEFAULT_OUTPUT.quality &&
    output.dpi === DEFAULT_OUTPUT.dpi &&
    output.matte === DEFAULT_OUTPUT.matte &&
    output.metadata === DEFAULT_OUTPUT.metadata &&
    output.targetBytes === DEFAULT_OUTPUT.targetBytes &&
    output.sheet === DEFAULT_OUTPUT.sheet &&
    output.resize.mode === DEFAULT_OUTPUT.resize.mode &&
    output.multiWidths.length === DEFAULT_MULTI_WIDTHS.length &&
    output.multiWidths.every((width, index) => width === DEFAULT_MULTI_WIDTHS[index])
  )
}

function isDefaultPerspective(perspective: Doc['geometry']['perspective']): boolean {
  return Object.values(perspective).every((point) => point.x === 0 && point.y === 0)
}

/**
 * Whether the document is anything other than a straight pass-through of its
 * source.
 *
 * Every section of `Doc` is consulted. This used to stop at six of them, so a
 * document whose *only* edit was a curve point, an HSL band, a background
 * colour, an aspect lock, an export width, a passport spec or a red-eye spot
 * reported "no edits" — which is what the Unsaved-work badge and the
 * before/after guard both read.
 *
 * A section is compared against the same default `createDoc()` mints, so a
 * document that merely round-tripped through `migrateDoc` still reads as
 * pristine.
 */
export function hasEdits(doc: Doc): boolean {
  if (doc.layers.length > 0 || doc.masks.length > 0 || doc.localAdjusts.length > 0) return true
  if (doc.retouch.healSpots.length > 0 || doc.retouch.redEye.length > 0) return true
  if (doc.retouch.smooth > 0) return true
  if (doc.look.id !== null) return true
  if (doc.effects.grain || doc.effects.bloom || doc.effects.fieldBlur) return true
  if (!isNeutralAdjust(doc.adjust)) return true
  if (!isNeutralHsl(doc.hsl)) return true
  if (!curvesAreIdentity(doc.curves)) return true
  const { crop, straighten, orientation, aspectLock, perspective } = doc.geometry
  if (!isFullFrame(crop)) return true
  if (straighten !== 0) return true
  if (orientation.quarterTurns !== 0 || orientation.flipH || orientation.flipV) return true
  if (!isDefaultPerspective(perspective)) return true
  if (aspectLock !== null) return true
  const { background } = doc
  if (background.mode !== 'none' || background.removed) return true
  if (background.imageAssetId !== null) return true
  if (!isDefaultOutput(doc)) return true
  if (doc.passport !== null) return true
  return false
}
