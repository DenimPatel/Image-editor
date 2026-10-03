import type { MetadataPolicy } from './policy'
import {
  buildTiff,
  readTiffDpi,
  readTiffOrientation,
  TIFF_TAG_ORIENTATION,
  TIFF_TAG_RESOLUTION_UNIT,
  TIFF_TAG_X_RESOLUTION,
  TIFF_TAG_Y_RESOLUTION,
  TIFF_TYPE_RATIONAL,
  TIFF_TYPE_SHORT,
} from './tiff'

const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])

/** VP8X feature flags, MSB first: rsv rsv ICC Alpha EXIF XMP Animation rsv. */
const VP8X_ICC = 0x20
const VP8X_ALPHA = 0x10
const VP8X_EXIF = 0x08
const VP8X_XMP = 0x04

export type RiffChunk = { type: string; start: number; dataStart: number; end: number }

export type RiffWalk = { chunks: RiffChunk[]; ok: boolean }

type Size = { width: number; height: number }

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
}

function readU16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8)
}

function readU24(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
}

function readU32(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | ((bytes[at + 3] << 24) >>> 0)
}

function writeU24(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >> 8) & 0xff
  bytes[at + 2] = (value >> 16) & 0xff
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >>> 8) & 0xff
  bytes[at + 2] = (value >>> 16) & 0xff
  bytes[at + 3] = (value >>> 24) & 0xff
}

/** A RIFF chunk plus the pad byte every odd-length payload needs. */
function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length % 2))
  for (let i = 0; i < 4; i += 1) out[i] = type.charCodeAt(i)
  writeU32(out, 4, payload.length)
  out.set(payload, 8)
  return out
}

export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && fourcc(bytes, 0) === 'RIFF' && fourcc(bytes, 8) === 'WEBP'
}

export function walkRiff(bytes: Uint8Array): RiffWalk {
  const chunks: RiffChunk[] = []
  if (!isWebp(bytes)) return { chunks, ok: false }

  let offset = 12
  let ok = true
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset + 4)
    const dataStart = offset + 8
    const end = dataStart + length + (length % 2)
    if (end > bytes.length) {
      ok = false
      break
    }
    chunks.push({ type: fourcc(bytes, offset), start: offset, dataStart, end })
    offset = end
  }

  return { chunks, ok }
}

/** Canvas size from a VP8X payload (24-bit `minus one` fields). */
function vp8xSize(bytes: Uint8Array, dataStart: number): Size | null {
  if (dataStart + 10 > bytes.length) return null
  return { width: readU24(bytes, dataStart + 4) + 1, height: readU24(bytes, dataStart + 7) + 1 }
}

function lossySize(bytes: Uint8Array, dataStart: number): Size | null {
  if (dataStart + 10 > bytes.length) return null
  if (
    bytes[dataStart + 3] !== 0x9d ||
    bytes[dataStart + 4] !== 0x01 ||
    bytes[dataStart + 5] !== 0x2a
  ) {
    return null
  }
  return {
    width: readU16(bytes, dataStart + 6) & 0x3fff,
    height: readU16(bytes, dataStart + 8) & 0x3fff,
  }
}

function losslessSize(bytes: Uint8Array, dataStart: number): Size | null {
  if (dataStart + 6 > bytes.length) return null
  if (bytes[dataStart] !== 0x2f) return null
  return {
    width:
      (bytes[dataStart + 1] | (bytes[dataStart + 2] << 8) | ((bytes[dataStart + 3] & 0x0f) << 16)) +
      1,
    height:
      ((bytes[dataStart + 3] >> 4) |
        (bytes[dataStart + 4] << 4) |
        ((bytes[dataStart + 5] & 0x0f) << 12)) +
      1,
  }
}

function canvasSize(chunks: readonly RiffChunk[], bytes: Uint8Array): Size | null {
  for (const chunk of chunks) {
    if (chunk.type === 'VP8X') return vp8xSize(bytes, chunk.dataStart)
  }
  for (const chunk of chunks) {
    if (chunk.type === 'VP8 ') return lossySize(bytes, chunk.dataStart)
    if (chunk.type === 'VP8L') return losslessSize(bytes, chunk.dataStart)
  }
  return null
}

/** EXIF chunk payload: the JPEG APP1 Exif form, `Exif\0\0` then the TIFF block. */
export function webpExifChunk(dpi: number): Uint8Array {
  const value = Number.isFinite(dpi) ? Math.max(1, Math.round(dpi)) : 1
  return riffChunk(
    'EXIF',
    webpExifPayload(
      buildTiff([
        { tag: TIFF_TAG_X_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [value] },
        { tag: TIFF_TAG_Y_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [value] },
        { tag: TIFF_TAG_RESOLUTION_UNIT, type: TIFF_TYPE_SHORT, values: [2] },
      ]),
    ),
  )
}

function webpExifPayload(tiff: Uint8Array): Uint8Array {
  const payload = new Uint8Array(EXIF_HEADER.length + tiff.length)
  payload.set(EXIF_HEADER, 0)
  payload.set(tiff, EXIF_HEADER.length)
  return payload
}

export function readWebpDpi(bytes: Uint8Array): number | null {
  const walk = walkRiff(bytes)
  if (!walk.ok) return null
  for (const chunk of walk.chunks) {
    if (chunk.type !== 'EXIF') continue
    const tiffStart = chunk.dataStart + EXIF_HEADER.length
    if (chunk.dataStart + EXIF_HEADER.length + 8 > bytes.length) return null
    return readTiffDpi(bytes, tiffStart, bytes.length)
  }
  return null
}

/**
 * WebP has no density field in its own headers — resolution lives in an EXIF
 * chunk, and the container specification only permits that chunk in an
 * extended (VP8X) file. A simple `VP8 `/`VP8L` file therefore has to be
 * promoted: VP8X is synthesised from the frame header's real dimensions, so the
 * decoder still sees exactly the picture it saw before with metadata attached.
 */
export function setWebpDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const walk = walkRiff(bytes)
  if (!walk.ok) return new Uint8Array(bytes)

  const size = canvasSize(walk.chunks, bytes)
  if (!size) return new Uint8Array(bytes)

  const existingVp8x = walk.chunks.find((chunk) => chunk.type === 'VP8X')
  const existingFlags = existingVp8x ? bytes[existingVp8x.dataStart] : 0
  const hasAlpha = (existingFlags & VP8X_ALPHA) !== 0 || walk.chunks.some((c) => c.type === 'ALPH')
  const flags = (existingFlags & VP8X_ICC) | (hasAlpha ? VP8X_ALPHA : 0) | VP8X_EXIF

  const vp8xPayload = new Uint8Array(10)
  vp8xPayload[0] = flags
  writeU24(vp8xPayload, 4, Math.max(0, Math.min(0xffffff, size.width - 1)))
  writeU24(vp8xPayload, 7, Math.max(0, Math.min(0xffffff, size.height - 1)))

  const pieces: Uint8Array[] = [riffChunk('VP8X', vp8xPayload)]
  for (const chunk of walk.chunks) {
    if (chunk.type === 'VP8X' || chunk.type === 'EXIF') continue
    pieces.push(bytes.subarray(chunk.start, chunk.end))
  }
  pieces.push(webpExifChunk(dpi))
  return riffWrap(pieces)
}

/** WebP's metadata carriers: the EXIF chunk, XMP, and the optional ICC chunk. */
const METADATA_CHUNKS = ['EXIF', 'XMP ', 'ICCP']

export function webpOrientationExifChunk(orientation: number): Uint8Array {
  return riffChunk(
    'EXIF',
    webpExifPayload(
      buildTiff([
        { tag: TIFF_TAG_ORIENTATION, type: TIFF_TYPE_SHORT, values: [orientation & 0xffff] },
      ]),
    ),
  )
}

/**
 * The same three policies as JPEG and PNG. `orientation` keeps an Orientation
 * tag and nothing else; `strip` drops EXIF, XMP and the colour profile, which
 * is correct here because the editor renders through a 2D canvas and the
 * output really is sRGB.
 */
export function stripWebpMetadata(bytes: Uint8Array, policy: MetadataPolicy): Uint8Array {
  if (policy === 'all') return new Uint8Array(bytes)
  const walk = walkRiff(bytes)
  if (!walk.ok) return new Uint8Array(bytes)

  // `riffWrap` supplies the RIFF/WEBP header, so only the chunks go in `kept`.
  const kept: Uint8Array[] = []
  let vp8xHeader: Uint8Array | null = null
  let wroteOrientation = false

  for (const chunk of walk.chunks) {
    if (chunk.type === 'VP8X') {
      vp8xHeader = bytes.slice(chunk.start, chunk.end)
      kept.push(vp8xHeader)
      continue
    }
    if (!METADATA_CHUNKS.includes(chunk.type)) {
      kept.push(bytes.subarray(chunk.start, chunk.end))
      continue
    }
    const flag = chunk.type === 'ICCP' ? VP8X_ICC : chunk.type === 'EXIF' ? VP8X_EXIF : VP8X_XMP
    if (vp8xHeader) vp8xHeader[8] &= ~flag
    if (policy === 'orientation' && chunk.type === 'EXIF' && !wroteOrientation) {
      const tiffStart = chunk.dataStart + EXIF_HEADER.length
      const orientation = readTiffOrientation(bytes, tiffStart, chunk.end)
      if (orientation !== null) {
        kept.push(webpOrientationExifChunk(orientation))
        wroteOrientation = true
      }
    }
  }

  return riffWrap(kept)
}

function riffWrap(pieces: readonly Uint8Array[]): Uint8Array {
  const body = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
  let cursor = 0
  for (const piece of pieces) {
    body.set(piece, cursor)
    cursor += piece.length
  }
  const out = new Uint8Array(12 + body.length)
  // 'RIFF', the 32-bit size, then the 'WEBP' form type: twelve bytes of header.
  out.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0)
  writeU32(out, 4, body.length + 4)
  out.set(body, 12)
  return out
}
