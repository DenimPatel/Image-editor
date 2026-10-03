import { loadCaps } from '../gl/caps'
import type { Size } from '../model/types'

/**
 * Decode a File/Blob into an ImageBitmap, honoring EXIF orientation so phone
 * photos come out upright instead of sideways (app.py had no EXIF handling at
 * all, since Pillow's default Image.open ignores orientation too).
 *
 * Decoding is the point where an input becomes pixels, so it is also the only
 * place a size guard can run before the memory is already spent. The pixel
 * ceiling comes from the probed canvas area: `createImageBitmap` will happily
 * allocate a 200 MP bitmap that no canvas or texture in this browser can ever
 * hold, and the failure then shows up as a blank export rather than a message.
 */

export type DecodeOptions = {
  /** Refuse anything above this pixel count. Defaults to the probed canvas area. */
  maxPixels?: number
  /** Decode a proxy no larger than this on the long edge, when one is enough. */
  maxEdge?: number
}

export class ImageTooLargeError extends Error {
  readonly pixels: number
  readonly maxPixels: number

  constructor(pixels: number, maxPixels: number) {
    super(describeTooLarge(pixels, maxPixels))
    this.name = 'ImageTooLargeError'
    this.pixels = pixels
    this.maxPixels = maxPixels
  }
}

/** Fallback for formats the probe cannot read (TIFF, or a truncated header). */
export const ESTIMATED_BYTES_PER_PIXEL = 3

export function megapixels(pixels: number): number {
  return Math.round((pixels / 1_000_000) * 10) / 10
}

export function describeTooLarge(pixels: number, maxPixels: number): string {
  const limit = `${megapixels(maxPixels)} megapixels`
  return `That image is about ${megapixels(pixels)} megapixels and this device handles up to ${limit}. Resize or crop it first.`
}

export function estimatePixels(bytes: number): number {
  return Math.round(bytes / ESTIMATED_BYTES_PER_PIXEL)
}

let canvasArea: number | null = null

function defaultMaxPixels(): number {
  canvasArea ??= loadCaps().maxCanvasArea
  return canvasArea
}

function nonEmptySize(width: number, height: number): Size | null {
  return width > 0 && height > 0 ? { width, height } : null
}

function asUint32(view: DataView, offset: number): number {
  return view.getUint32(offset)
}

/** JPEG start-of-frame markers; C4 (Huffman), C8 (JPEG) and CC (arithmetic) are not one. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

function jpegSize(view: DataView, length: number): Size | null {
  let offset = 2
  while (offset + 9 < length) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1
      continue
    }
    const marker = view.getUint8(offset + 1)
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const height = view.getUint16(offset + 5)
    const width = view.getUint16(offset + 7)
    if (isStartOfFrame(marker)) return nonEmptySize(width, height)
    const segment = view.getUint16(offset + 2)
    if (segment < 2) return null
    offset += 2 + segment
  }
  return null
}

function pngSize(view: DataView, length: number): Size | null {
  if (length < 24) return null
  return nonEmptySize(asUint32(view, 16), asUint32(view, 20))
}

function gifSize(view: DataView, length: number): Size | null {
  if (length < 10) return null
  return nonEmptySize(view.getUint16(6, true), view.getUint16(8, true))
}

function bmpSize(view: DataView, length: number): Size | null {
  if (length < 26) return null
  return nonEmptySize(view.getInt32(18, true), Math.abs(view.getInt32(22, true)))
}

function webpSize(view: DataView, length: number): Size | null {
  if (length < 30) return null
  const chunk = String.fromCharCode(
    view.getUint8(12),
    view.getUint8(13),
    view.getUint8(14),
    view.getUint8(15),
  )
  if (chunk === 'VP8 ') {
    return nonEmptySize(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  }
  if (chunk === 'VP8L') {
    const bits = asUint32(view, 21)
    return nonEmptySize((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') {
    const width = 1 + view.getUint8(24) + (view.getUint8(25) << 8) + (view.getUint8(26) << 16)
    const height = 1 + view.getUint8(27) + (view.getUint8(28) << 8) + (view.getUint8(29) << 16)
    return nonEmptySize(width, height)
  }
  return null
}

function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
  for (let index = 0; index < tag.length; index += 1) {
    if (bytes[offset + index] !== tag.charCodeAt(index)) return false
  }
  return true
}

/** `ispe` is the ISO-BMFF item-size box that carries an image's real dimensions. */
function isoBmffSize(bytes: Uint8Array, view: DataView): Size | null {
  for (let offset = 0; offset + 16 < bytes.length; offset += 1) {
    if (!tagAt(bytes, offset, 'ispe')) continue
    return nonEmptySize(asUint32(view, offset + 8), asUint32(view, offset + 12))
  }
  return null
}

/**
 * Read an image's dimensions out of its header without decoding it. Returns
 * null for anything it does not recognise, which is never fatal: the caller
 * falls back to an estimate from the encoded byte count.
 */
export function probeImageSizeFromBytes(bytes: Uint8Array): Size | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = bytes.byteLength
  if (length < 16) return null
  if (bytes[0] === 0x89 && tagAt(bytes, 1, 'PNG')) return pngSize(view, length)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(view, length)
  if (tagAt(bytes, 0, 'GIF8')) return gifSize(view, length)
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return bmpSize(view, length)
  if (tagAt(bytes, 0, 'RIFF') && tagAt(bytes, 8, 'WEBP')) return webpSize(view, length)
  if (tagAt(bytes, 4, 'ftyp')) return isoBmffSize(bytes, view)
  return null
}

const HEADER_BYTES = 64 * 1024

/** Read the first slice of a blob. `Blob.arrayBuffer` is missing in older Safari. */
function readHeader(blob: Blob): Promise<Uint8Array | null> {
  const slice = blob.slice(0, HEADER_BYTES)
  if (typeof slice.arrayBuffer === 'function') {
    return slice
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer))
      .catch(() => null)
  }
  if (typeof FileReader === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : null)
    reader.onerror = () => resolve(null)
    reader.readAsArrayBuffer(slice)
  })
}

export async function probeImageSize(blob: Blob): Promise<Size | null> {
  try {
    const bytes = await readHeader(blob)
    return bytes ? probeImageSizeFromBytes(bytes) : null
  } catch {
    return null
  }
}

/** `createImageBitmap` resize options for a proxy, or nothing when none is needed. */
export function proxyResize(
  probed: Size | null,
  maxEdge: number | undefined,
): {
  resizeWidth?: number
  resizeHeight?: number
} {
  if (!probed || !maxEdge) return {}
  const longest = Math.max(probed.width, probed.height)
  if (longest <= maxEdge) return {}
  const scale = maxEdge / longest
  return {
    resizeWidth: Math.max(1, Math.round(probed.width * scale)),
    resizeHeight: Math.max(1, Math.round(probed.height * scale)),
  }
}

export async function decodeImageBlob(
  blob: Blob,
  options: DecodeOptions = {},
): Promise<ImageBitmap> {
  const maxPixels = options.maxPixels ?? defaultMaxPixels()
  const probed = await probeImageSize(blob)
  const pixels = probed ? probed.width * probed.height : estimatePixels(blob.size)
  if (pixels > maxPixels) throw new ImageTooLargeError(pixels, maxPixels)
  return createImageBitmap(blob, {
    imageOrientation: 'from-image',
    ...proxyResize(probed, options.maxEdge),
  })
}

export async function decodeImageFile(
  file: File,
  options: DecodeOptions = {},
): Promise<ImageBitmap> {
  return decodeImageBlob(file, options)
}

/**
 * Decode an image served from a static URL (e.g. a bundled sample image). The
 * response's own content type is returned alongside the bitmap so the document
 * records what the bytes actually are, and the blob comes back so callers can
 * persist exactly what they decoded instead of fetching it twice.
 */
export async function decodeImageUrl(
  url: string,
  options: DecodeOptions = {},
): Promise<{ bitmap: ImageBitmap; blob: Blob; mime: string }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const mime = response.headers.get('content-type')?.split(';')[0].trim() || blob.type
  return { bitmap: await decodeImageBlob(blob, options), blob, mime }
}

/**
 * Re-encode an ImageBitmap as a Blob, for APIs that only accept encoded
 * image data. Prefers OffscreenCanvas; falls back to a detached <canvas>
 * for browsers without it (Safari < 17).
 */
export async function bitmapToBlob(bitmap: ImageBitmap, type = 'image/png'): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable')
    ctx.drawImage(bitmap, 0, 0)
    return canvas.convertToBlob({ type })
  }

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob failed'))
    }, type)
  })
}
