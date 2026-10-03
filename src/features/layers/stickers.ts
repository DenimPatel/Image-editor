/**
 * Sticker layers: the built-in vector set, and the user's own uploads.
 *
 * `StickerLayer` carries both a `svg` id (a path from `STICKERS`) and an
 * `assetId` (pixels in the Asset Vault). The upload half used to be advertised
 * and unreachable — `factory.ts` pinned `assetId: null`, there was no file
 * input anywhere, and `ToolSurface` said "Built-in sticker set plus your own
 * uploads". This module is the part that can be pure and testable: turn a
 * `File` into a validated `ImageBitmap`, and a decoded bitmap into a layer the
 * store can accept. Registration itself is `assetStore.add`, one line, because
 * `Doc` may only hold an `AssetId` — see the architecture law in `AGENTS.md`.
 */

import { decodeImageBlob } from '../../lib/decode'
import { createId } from '../../model/ids'
import type { AssetId, StickerLayer } from '../../model/types'
import { defaultTransform } from './factory'

/** Built-in stickers as SVG path data, drawable synchronously via Path2D. */
export type StickerDef = { id: string; label: string; viewBox: number; path: string; fill: string }

export const STICKERS: StickerDef[] = [
  {
    id: 'star',
    label: 'Star',
    viewBox: 100,
    path: 'M50 5l14 29 32 4-23 22 6 32-29-15-29 15 6-32L4 38l32-4z',
    fill: '#ffd166',
  },
  {
    id: 'heart',
    label: 'Heart',
    viewBox: 100,
    path: 'M50 88S12 62 12 36a20 20 0 0 1 38-9 20 20 0 0 1 38 9c0 26-38 52-38 52z',
    fill: '#ef476f',
  },
  {
    id: 'bolt',
    label: 'Bolt',
    viewBox: 100,
    path: 'M58 4L20 56h22l-6 40 40-54H52z',
    fill: '#ffd166',
  },
  {
    id: 'check',
    label: 'Check',
    viewBox: 100,
    path: 'M42 66L22 46l-8 8 28 28 48-56-9-8z',
    fill: '#06d6a0',
  },
  {
    id: 'arrow',
    label: 'Arrow',
    viewBox: 100,
    path: 'M10 44h52V24l30 28-30 28V60H10z',
    fill: '#118ab2',
  },
  {
    id: 'sparkle',
    label: 'Sparkle',
    viewBox: 100,
    path: 'M50 6l8 28 28 8-28 8-8 28-8-28-28-8 28-8z',
    fill: '#f78c6b',
  },
  {
    id: 'circle',
    label: 'Ring',
    viewBox: 100,
    path: 'M50 10a40 40 0 1 0 0 80 40 40 0 0 0 0-80zm0 12a28 28 0 1 1 0 56 28 28 0 0 1 0-56z',
    fill: '#ffffff',
  },
  {
    id: 'speech',
    label: 'Speech',
    viewBox: 100,
    path: 'M14 18h72v46H44L22 84V64H14z',
    fill: '#ffffff',
  },
]

export function stickerById(id: string): StickerDef | undefined {
  return STICKERS.find((sticker) => sticker.id === id)
}

/** What the upload input accepts; matches `ACCEPTED_IMAGE_TYPES` in src/lib/accept.ts. */
export const STICKER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

/**
 * Long-edge ceiling for an uploaded sticker. A sticker is drawn at 25% of the
 * frame height, so anything past this is pixels nobody will ever see — and every
 * extra pixel is resident in the Asset Vault for the life of the document.
 */
export const STICKER_MAX_EDGE = 2048

export class StickerDecodeError extends Error {
  readonly fileName: string

  constructor(fileName: string, reason: string) {
    super(`"${fileName}" could not be used as a sticker: ${reason}`)
    this.name = 'StickerDecodeError'
    this.fileName = fileName
  }
}

export function isStickerUpload(type: string): boolean {
  return STICKER_ACCEPT.split(',').includes(type.toLowerCase())
}

/**
 * Decode an uploaded image into an `ImageBitmap` the store can hold.
 *
 * The size guard is not optional: `createImageBitmap` will happily allocate a
 * 200 MP bitmap, and unlike the source photo this one is *never* needed at full
 * size — it is composited at 25% of the frame. `decodeImageBlob` gets the same
 * treatment as any other decode so the ceiling follows the device's probed
 * canvas area rather than a magic number.
 */
export async function decodeStickerFile(file: File | Blob, name = 'sticker'): Promise<ImageBitmap> {
  if (file.type && !isStickerUpload(file.type)) {
    throw new StickerDecodeError(name, `${file.type} is not a supported image type`)
  }
  try {
    return await decodeImageBlob(file, { maxEdge: STICKER_MAX_EDGE })
  } catch (error) {
    throw new StickerDecodeError(
      name,
      error instanceof Error ? error.message : 'the file is not a readable image',
    )
  }
}

/**
 * The `StickerLayer` for an uploaded image. `svg` is left empty on purpose:
 * `stickerById('')` is undefined, so the compositor takes the `assetId` branch
 * and never tries to fill a `Path2D` that was never chosen.
 */
export function uploadedStickerLayer(assetId: AssetId, name: string): StickerLayer {
  const label = name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Sticker'
  return {
    id: createId('sticker'),
    kind: 'sticker',
    name: label,
    visible: true,
    transform: defaultTransform(),
    svg: '',
    assetId,
  }
}

/** Whether a sticker layer is an upload rather than a built-in path. */
export function isUploadedSticker(layer: StickerLayer): boolean {
  return layer.assetId !== null
}
