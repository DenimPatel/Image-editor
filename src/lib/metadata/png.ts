import { crc32 } from './crc32'
import type { MetadataPolicy } from './policy'
import { buildTiff, readTiffOrientation, TIFF_TAG_ORIENTATION, TIFF_TYPE_SHORT } from './tiff'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Chunks that carry descriptive or provenance metadata rather than pixels:
 * text, EXIF, the edit timestamp, the ICC profile and the (now invalid)
 * digital signature. `pHYs` is deliberately absent — resolution is an export
 * control, not metadata, and is written separately.
 */
const PNG_METADATA_CHUNKS = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'iCCP', 'dSIG']

export type PngChunk = { type: string; start: number; dataStart: number; end: number }

export type PngWalk = {
  chunks: PngChunk[]
  /** End offset of IHDR, or -1 when the file has no readable IHDR. */
  ihdrEnd: number
  ok: boolean
}

export function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  )
}

export function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

export function walkPng(bytes: Uint8Array): PngWalk {
  const chunks: PngChunk[] = []
  if (!isPng(bytes)) return { chunks, ihdrEnd: -1, ok: false }

  let ihdrEnd = -1
  let sawIend = false
  let offset = 8
  let ok = true
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset)
    const dataStart = offset + 8
    const end = dataStart + length + 4
    if (end > bytes.length) {
      ok = false
      break
    }
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    )
    chunks.push({ type, start: offset, dataStart, end })
    if (type === 'IHDR') ihdrEnd = end
    if (type === 'IEND') {
      sawIend = true
      break
    }
    offset = end
  }

  // A stream that never reached IEND is a partial parse; callers must not
  // rewrite a file they only half understood.
  return { chunks, ihdrEnd, ok: ok && sawIend }
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export type CopyPiece =
  { kind: 'span'; start: number; end: number } | { kind: 'bytes'; bytes: Uint8Array }

export type CopyPlan = { length: number; pieces: readonly CopyPiece[] }

export function applyCopyPlan(bytes: Uint8Array, plan: CopyPlan): Uint8Array {
  const out = new Uint8Array(plan.length)
  let cursor = 0
  for (const piece of plan.pieces) {
    if (piece.kind === 'bytes') {
      out.set(piece.bytes, cursor)
      cursor += piece.bytes.length
    } else {
      out.set(bytes.subarray(piece.start, piece.end), cursor)
      cursor += piece.end - piece.start
    }
  }
  return out
}

function isMetadataChunk(type: string): boolean {
  return PNG_METADATA_CHUNKS.includes(type)
}

/** `eXIf` holds a bare TIFF block: no `Exif\0\0` prefix, unlike JPEG's APP1. */
export function exifChunk(orientation: number): Uint8Array {
  return pngChunk(
    'eXIf',
    buildTiff([
      { tag: TIFF_TAG_ORIENTATION, type: TIFF_TYPE_SHORT, values: [orientation & 0xffff] },
    ]),
  )
}

export function planPngCopy(bytes: Uint8Array, policy: MetadataPolicy): CopyPlan | null {
  if (policy === 'all') return null
  const walk = walkPng(bytes)
  if (!walk.ok || walk.ihdrEnd < 0) return null

  const pieces: CopyPiece[] = []
  let length = 0
  const pushSpan = (start: number, end: number) => {
    pieces.push({ kind: 'span', start, end })
    length += end - start
  }
  let wroteOrientation = false

  pushSpan(0, 8)
  for (const chunk of walk.chunks) {
    if (chunk.type === 'IHDR' || !isMetadataChunk(chunk.type)) {
      pushSpan(chunk.start, chunk.end)
      continue
    }
    if (policy === 'orientation' && chunk.type === 'eXIf' && !wroteOrientation) {
      const orientation = readTiffOrientation(bytes, chunk.dataStart, chunk.end)
      if (orientation !== null) {
        const replacement = exifChunk(orientation)
        pieces.push({ kind: 'bytes', bytes: replacement })
        length += replacement.length
        wroteOrientation = true
      }
    }
  }

  return { length, pieces }
}

export function stripPngMetadata(bytes: Uint8Array, policy: MetadataPolicy): Uint8Array {
  const plan = planPngCopy(bytes, policy)
  if (!plan) return new Uint8Array(bytes)
  return applyCopyPlan(bytes, plan)
}
