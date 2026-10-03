import type { ExportFormat } from '../../model/types'
import { avifCanCarryDpi, readAvifDpi } from './avif'
import { isJfifApp0, isJpeg, walkJpeg } from './jpeg'
import { isPng, pngChunk, readU32, walkPng, writeU32 } from './png'
import { readWebpDpi, setWebpDpi } from './webp'

export { avifCanCarryDpi, readAvifDpi, readWebpDpi, setWebpDpi }

function clampJpegDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return 1
  return Math.min(65535, Math.max(1, Math.round(dpi)))
}

export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const copy = new Uint8Array(bytes)
  if (!isJpeg(copy)) return copy

  const value = clampJpegDpi(dpi)
  const walk = walkJpeg(copy)
  if (walk.ok) {
    for (const part of walk.parts) {
      if (part.kind !== 'segment' || part.marker !== 0xe0) continue
      if (!isJfifApp0(copy, part.start, part.end)) continue
      copy[part.start + 11] = 1
      copy[part.start + 12] = (value >> 8) & 0xff
      copy[part.start + 13] = value & 0xff
      copy[part.start + 14] = (value >> 8) & 0xff
      copy[part.start + 15] = value & 0xff
      return copy
    }
  }

  const segment = new Uint8Array(18)
  segment[0] = 0xff
  segment[1] = 0xe0
  segment[2] = 0x00
  segment[3] = 0x10
  segment.set([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01], 4)
  segment[11] = 1
  segment[12] = (value >> 8) & 0xff
  segment[13] = value & 0xff
  segment[14] = (value >> 8) & 0xff
  segment[15] = value & 0xff

  const out = new Uint8Array(copy.length + segment.length)
  out.set(copy.subarray(0, 2), 0)
  out.set(segment, 2)
  out.set(copy.subarray(2), 2 + segment.length)
  return out
}

export function readJpegDpi(bytes: Uint8Array): number | null {
  const walk = walkJpeg(bytes)
  if (!walk.ok) return null
  for (const part of walk.parts) {
    if (part.kind !== 'segment' || part.marker !== 0xe0) continue
    if (!isJfifApp0(bytes, part.start, part.end)) continue
    if (bytes[part.start + 11] !== 1) return null
    return (bytes[part.start + 12] << 8) | bytes[part.start + 13]
  }
  return null
}

function buildPhysChunk(pixelsPerMeter: number): Uint8Array {
  const data = new Uint8Array(9)
  writeU32(data, 0, pixelsPerMeter)
  writeU32(data, 4, pixelsPerMeter)
  data[8] = 1
  return pngChunk('pHYs', data)
}

export function setPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const copy = new Uint8Array(bytes)
  if (!isPng(copy)) return copy

  const normalized = Number.isFinite(dpi) ? Math.max(1, Math.round(dpi)) : 1
  const pixelsPerMeter = Math.round(normalized / 0.0254)

  const walk = walkPng(copy)
  if (!walk.ok || walk.ihdrEnd < 0) return copy

  const chunk = buildPhysChunk(pixelsPerMeter)
  const existing = walk.chunks.find((item) => item.type === 'pHYs')

  if (existing) {
    const out = new Uint8Array(copy.length - (existing.end - existing.start) + chunk.length)
    out.set(copy.subarray(0, existing.start), 0)
    out.set(chunk, existing.start)
    out.set(copy.subarray(existing.end), existing.start + chunk.length)
    return out
  }

  const out = new Uint8Array(copy.length + chunk.length)
  out.set(copy.subarray(0, walk.ihdrEnd), 0)
  out.set(chunk, walk.ihdrEnd)
  out.set(copy.subarray(walk.ihdrEnd), walk.ihdrEnd + chunk.length)
  return out
}

export function readPngDpi(bytes: Uint8Array): number | null {
  const walk = walkPng(bytes)
  if (!walk.ok) return null
  for (const chunk of walk.chunks) {
    if (chunk.type !== 'pHYs') continue
    if (chunk.end - chunk.dataStart < 9) return null
    if (bytes[chunk.dataStart + 8] !== 1) return null
    return Math.round(readU32(bytes, chunk.dataStart) * 0.0254)
  }
  return null
}

/**
 * Stamp the requested density into whichever of the five output formats can
 * hold it. PDF carries it in the page geometry instead (see `lib/encode.ts`),
 * and AVIF only carries a density when the source already had an Exif item.
 */
export function setOutputDpi(format: ExportFormat, bytes: Uint8Array, dpi: number): Uint8Array {
  switch (format) {
    case 'jpeg':
      return setJpegDpi(bytes, dpi)
    case 'png':
      return setPngDpi(bytes, dpi)
    case 'webp':
      return setWebpDpi(bytes, dpi)
    case 'avif':
    case 'pdf':
      return bytes
  }
}

/** Read back whatever density the format actually ended up with, or null. */
export function readOutputDpi(format: ExportFormat, bytes: Uint8Array): number | null {
  switch (format) {
    case 'jpeg':
      return readJpegDpi(bytes)
    case 'png':
      return readPngDpi(bytes)
    case 'webp':
      return readWebpDpi(bytes)
    case 'avif':
      return readAvifDpi(bytes)
    case 'pdf':
      return null
  }
}
