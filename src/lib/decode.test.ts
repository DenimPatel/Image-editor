import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_CAPS } from '../gl/caps'
import {
  decodeImageBlob,
  decodeImageFile,
  decodeImageUrl,
  estimatePixels,
  ImageTooLargeError,
  probeImageSize,
  probeImageSizeFromBytes,
  proxyResize,
} from './decode'

const MP = 1_000_000

/**
 * jsdom's Blob has no `arrayBuffer()`, and the guard only ever reads `size` and
 * a header slice, so the tests hand it the smallest object that behaves the
 * same way.
 */
function fakeBlob(bytes: Uint8Array, type = 'image/png'): Blob {
  return {
    size: bytes.byteLength,
    type,
    slice: () => ({ arrayBuffer: async () => bytes.buffer.slice(0) }),
  } as unknown as Blob
}

function bytesOf(...parts: number[]): Uint8Array {
  return new Uint8Array(parts)
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  const view = new DataView(bytes.buffer)
  bytes.set([0xff, 0xd8])
  view.setUint16(2, 0x0010)
  bytes[4] = 0xe0
  view.setUint16(20, 0xffc0)
  view.setUint16(22, 0x0011)
  bytes[24] = 8
  view.setUint16(25, height)
  view.setUint16(27, width)
  return bytes
}

function gifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(16)
  const view = new DataView(bytes.buffer)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

function bmpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)
  bytes.set([0x42, 0x4d])
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true)
  return bytes
}

function webpHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  const view = new DataView(bytes.buffer)
  bytes.set([0x52, 0x49, 0x46, 0x46])
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)
  view.setUint32(16, 10, true)
  bytes[24] = (width - 1) & 0xff
  bytes[25] = ((width - 1) >> 8) & 0xff
  bytes[26] = ((width - 1) >> 16) & 0xff
  bytes[27] = (height - 1) & 0xff
  bytes[28] = ((height - 1) >> 8) & 0xff
  bytes[29] = ((height - 1) >> 16) & 0xff
  return bytes
}

function avifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  const view = new DataView(bytes.buffer)
  bytes.set([0x00, 0x00, 0x00, 0x20])
  bytes.set([0x66, 0x74, 0x79, 0x70], 4)
  bytes.set([0x61, 0x76, 0x69, 0x66], 8)
  view.setUint32(24, 20)
  bytes.set([0x69, 0x73, 0x70, 0x65], 28)
  view.setUint32(32, 0)
  view.setUint32(36, width)
  view.setUint32(40, height)
  return bytes
}

let decodeArgs: Array<[unknown, ImageBitmapOptions | undefined]> = []
const bitmap = { width: 10, height: 10 } as ImageBitmap

beforeEach(() => {
  // Pin the probed canvas area so the default guard is deterministic in jsdom,
  // which cannot report a real GPU limit.
  localStorage.setItem('ie-caps-v1', JSON.stringify({ ...FALLBACK_CAPS, maxCanvasArea: 16 * MP }))
  decodeArgs = []
  vi.stubGlobal('createImageBitmap', async (source: unknown, options?: ImageBitmapOptions) => {
    decodeArgs.push([source, options])
    return bitmap
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('probeImageSizeFromBytes', () => {
  it('reads the dimensions of every format the editor accepts', () => {
    expect(probeImageSizeFromBytes(pngHeader(3000, 2000))).toEqual({ width: 3000, height: 2000 })
    expect(probeImageSizeFromBytes(jpegHeader(4000, 3000))).toEqual({ width: 4000, height: 3000 })
    expect(probeImageSizeFromBytes(gifHeader(640, 480))).toEqual({ width: 640, height: 480 })
    expect(probeImageSizeFromBytes(bmpHeader(1920, 1080))).toEqual({ width: 1920, height: 1080 })
    expect(probeImageSizeFromBytes(webpHeader(2560, 1440))).toEqual({ width: 2560, height: 1440 })
    expect(probeImageSizeFromBytes(avifHeader(6048, 4024))).toEqual({ width: 6048, height: 4024 })
  })

  it('returns null for anything it does not recognise rather than guessing', () => {
    expect(probeImageSizeFromBytes(bytesOf(1, 2, 3))).toBeNull()
    expect(probeImageSizeFromBytes(new Uint8Array(8))).toBeNull()
  })
})

describe('probeImageSize', () => {
  it('reads a header slice out of the blob', async () => {
    expect(await probeImageSize(fakeBlob(jpegHeader(800, 600)))).toEqual({
      width: 800,
      height: 600,
    })
  })

  it('degrades to null when the blob cannot be read', async () => {
    const broken = { size: 10, slice: () => ({}) } as unknown as Blob
    expect(await probeImageSize(broken)).toBeNull()
  })
})

describe('D7-F03 decode guard', () => {
  it('refuses an image larger than the device can hold, before decoding it', async () => {
    const file = fakeBlob(pngHeader(6000, 4000), 'image/png')
    await expect(decodeImageFile(file as unknown as File)).rejects.toBeInstanceOf(
      ImageTooLargeError,
    )
    expect(decodeArgs).toHaveLength(0)
  })

  it('names the size and the limit in the message the user sees', async () => {
    const file = fakeBlob(jpegHeader(6000, 4000), 'image/jpeg')
    const error = await decodeImageFile(file as unknown as File, { maxPixels: 8 * MP }).then(
      () => null,
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(ImageTooLargeError)
    const tooLarge = error as ImageTooLargeError
    expect(tooLarge.message).toContain('24 megapixels')
    expect(tooLarge.message).toContain('8 megapixels')
    expect(tooLarge.pixels).toBe(24 * MP)
  })

  it('falls back to an estimate from the byte count when the header is unreadable', async () => {
    const unreadable = { size: 60 * MP, type: 'image/tiff', slice: () => ({}) } as unknown as Blob
    await expect(decodeImageBlob(unreadable, { maxPixels: 16 * MP })).rejects.toBeInstanceOf(
      ImageTooLargeError,
    )
    expect(estimatePixels(60 * MP)).toBe(20 * MP)
  })

  it('decodes an image inside the limit with EXIF orientation honored', async () => {
    const file = fakeBlob(jpegHeader(4000, 3000), 'image/jpeg')
    await expect(decodeImageFile(file as unknown as File)).resolves.toBe(bitmap)
    expect(decodeArgs[0][1]).toEqual({ imageOrientation: 'from-image' })
  })

  it('decodeImageUrl reports the response content type and returns the decoded bytes', async () => {
    // A real Response body, so the response path and the header probe both run
    // exactly as they do for a bundled sample image.
    const jpeg = jpegHeader(800, 600)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(jpeg.buffer as ArrayBuffer, { headers: { 'content-type': 'image/jpeg' } }),
      ),
    )
    const result = await decodeImageUrl('/sample-images/sample.jpg')
    expect(result.mime).toBe('image/jpeg')
    expect(result.blob.size).toBe(64)
    expect(result.bitmap).toBe(bitmap)
  })

  it('decodeImageUrl refuses a sample larger than the device can hold', async () => {
    const huge = pngHeader(6000, 4000)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(huge.buffer as ArrayBuffer, { headers: { 'content-type': 'image/png' } }),
      ),
    )
    await expect(decodeImageUrl('/sample-images/huge.png')).rejects.toBeInstanceOf(
      ImageTooLargeError,
    )
  })
})

describe('proxy decode', () => {
  it('asks for a proxy through resizeWidth/resizeHeight when one is enough', async () => {
    const file = fakeBlob(pngHeader(4000, 3000), 'image/png')
    await decodeImageBlob(file, { maxEdge: 800 })
    expect(decodeArgs[0][1]).toEqual({
      imageOrientation: 'from-image',
      resizeWidth: 800,
      resizeHeight: 600,
    })
  })

  it('leaves an image that already fits at full size alone', async () => {
    const file = fakeBlob(pngHeader(400, 300), 'image/png')
    await decodeImageBlob(file, { maxEdge: 800 })
    expect(decodeArgs[0][1]).toEqual({ imageOrientation: 'from-image' })
  })

  it('proxyResize cannot invent dimensions it does not know', () => {
    expect(proxyResize(null, 800)).toEqual({})
    expect(proxyResize({ width: 100, height: 100 }, undefined)).toEqual({})
  })
})
