/**
 * Sticker uploads (D6-F10).
 *
 * `ToolSurface` advertises "Built-in sticker set plus your own uploads" and
 * `createStickerLayer` pinned `assetId: null`, so there was no path for an
 * upload to exist. These are the pure halves: decode + validate, build the
 * layer, and prove the Asset Vault keeps the pixels alive. The two call sites
 * that finish the job are the file input in `LayerPanels.tsx` and the
 * `assetId` branch in `src/render/layers.ts`; both diffs are in the D6-F10
 * report.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssetStore } from '../../model/assets'
import { activeAssetIds } from '../../model/selectors'
import { createDoc } from '../../model/defaults'
import type { AssetId } from '../../model/types'
import {
  decodeStickerFile,
  isStickerUpload,
  isUploadedSticker,
  STICKER_ACCEPT,
  STICKER_MAX_EDGE,
  STICKERS,
  stickerById,
  StickerDecodeError,
  uploadedStickerLayer,
} from './stickers'
import { createStickerLayer } from './factory'

class FakeBitmap {
  width: number
  height: number
  closed = false

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  close(): void {
    this.closed = true
  }
}

type DecodeMock = ReturnType<
  typeof vi.fn<(blob: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>>
>

function stubDecode(): DecodeMock {
  const decode = vi.fn(
    async () => new FakeBitmap(STICKER_MAX_EDGE, STICKER_MAX_EDGE) as unknown as ImageBitmap,
  )
  vi.stubGlobal('createImageBitmap', decode)
  return decode
}

const file = (name: string, type: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

/**
 * A file whose header `probeImageSize` can read, so the long-edge guard is
 * exercised for real instead of being taken on trust. Only the 24 header bytes
 * matter; nothing decodes them in jsdom.
 */
function oversizedPngFile(width: number, height: number, name = 'huge.png'): File {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return new File([bytes], name, { type: 'image/png' })
}

describe('the built-in sticker set', () => {
  it('stays a set of drawable paths', () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(8)
    for (const sticker of STICKERS) {
      expect(stickerById(sticker.id)).toBe(sticker)
      expect(sticker.path.length).toBeGreaterThan(10)
    }
    expect(stickerById('nope')).toBeUndefined()
    expect(createStickerLayer('star').assetId).toBeNull()
  })
})

describe('accept attribute', () => {
  it('lists only image types the browser can decode here', () => {
    expect(isStickerUpload('image/png')).toBe(true)
    expect(isStickerUpload('image/avif')).toBe(true)
    expect(isStickerUpload('text/html')).toBe(false)
    expect(isStickerUpload('')).toBe(false)
    for (const type of STICKER_ACCEPT.split(',')) expect(type.startsWith('image/')).toBe(true)
  })
})

describe('decodeStickerFile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a type that is not an image, without decoding it', async () => {
    const decode = stubDecode()
    await expect(decodeStickerFile(file('page.html', 'text/html'))).rejects.toBeInstanceOf(
      StickerDecodeError,
    )
    expect(decode).not.toHaveBeenCalled()
  })

  it('reports a file the browser cannot decode, naming it', async () => {
    stubDecode()
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('unsupported format'))),
    )
    await expect(
      decodeStickerFile(file('mystery.png', 'image/png'), 'mystery.png'),
    ).rejects.toThrow(/"mystery.png" could not be used as a sticker: unsupported format/)
  })

  it('caps the long edge, because a sticker is never composited at full size', async () => {
    const decode = stubDecode()
    await decodeStickerFile(oversizedPngFile(4096, 2048))
    expect(decode).toHaveBeenCalledTimes(1)
    const options = decode.mock.calls[0]?.[1] as { resizeWidth?: number; resizeHeight?: number }
    expect(options.resizeWidth).toBe(STICKER_MAX_EDGE)
    expect(options.resizeHeight).toBe(STICKER_MAX_EDGE / 2)
  })

  it('leaves an image that already fits untouched', async () => {
    const decode = stubDecode()
    await decodeStickerFile(oversizedPngFile(1200, 800, 'small.png'))
    const options = decode.mock.calls[0]?.[1] as { resizeWidth?: number }
    expect(options.resizeWidth).toBeUndefined()
  })

  it('refuses an image too large for this device even after downscaling', async () => {
    stubDecode()
    // 64 megapixels: over the probed canvas ceiling, so the decode is refused
    // rather than attempting a bitmap no canvas here could hold.
    await expect(
      decodeStickerFile(oversizedPngFile(8000, 8000, 'enormous.png')),
    ).rejects.toBeInstanceOf(StickerDecodeError)
  })

  it('returns the bitmap the Asset Vault can own', async () => {
    stubDecode()
    const bitmap = await decodeStickerFile(file('cat.png', 'image/png'))
    expect(bitmap.width).toBe(STICKER_MAX_EDGE)
  })
})

describe('uploadedStickerLayer', () => {
  it('produces a layer that is an asset, not a built-in path', () => {
    const assetId = 'sticker-asset-1' as AssetId
    const layer = uploadedStickerLayer(assetId, 'holiday-photo.png')
    expect(layer.kind).toBe('sticker')
    expect(layer.assetId).toBe(assetId)
    // Empty `svg` is the contract with the compositor: `stickerById('')`
    // is undefined, so the renderer must take the asset branch and never
    // reach for a Path2D nobody chose.
    expect(layer.svg).toBe('')
    expect(stickerById(layer.svg ?? 'x')).toBeUndefined()
    expect(isUploadedSticker(layer)).toBe(true)
    expect(isUploadedSticker(createStickerLayer('star'))).toBe(false)
    expect(layer.name).toBe('holiday-photo')
  })

  it('keeps a layer name short and strips the extension', () => {
    expect(
      uploadedStickerLayer('a' as AssetId, 'a-really-very-long-photo-filename-indeed.png').name,
    ).toBe('a-really-very-long-photo-filenam')
    expect(uploadedStickerLayer('a' as AssetId, '.png').name).toBe('Sticker')
  })

  it('gives every upload its own id and a default transform', () => {
    const first = uploadedStickerLayer('a' as AssetId, 'one.png')
    const second = uploadedStickerLayer('b' as AssetId, 'two.png')
    expect(first.id).not.toBe(second.id)
    expect(first.transform).toEqual({
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      blend: 'normal',
    })
  })
})

describe('asset lifetime', () => {
  it('an uploaded sticker keeps its pixels out of the GC', () => {
    const store = new AssetStore()
    const bitmap = new FakeBitmap(512, 512) as unknown as ImageBitmap
    const assetId = store.add(bitmap)
    const doc = { ...createDoc(), layers: [uploadedStickerLayer(assetId, 'cat.png')] }

    expect([...activeAssetIds(doc)]).toContain(assetId)
    expect(store.prune(activeAssetIds(doc))).toBe(0)
    expect(store.has(assetId)).toBe(true)
  })

  it('a deleted sticker is collected on the next prune', () => {
    const store = new AssetStore()
    const assetId = store.add(new FakeBitmap(64, 64) as unknown as ImageBitmap)
    const doc = { ...createDoc(), layers: [uploadedStickerLayer(assetId, 'cat.png')] }
    const removed = { ...doc, layers: [] }
    expect(store.prune(activeAssetIds(removed))).toBe(1)
    expect(store.has(assetId)).toBe(false)
  })
})
