import {
  isJfifApp0,
  isJpeg,
  JPEG_APP0,
  JPEG_APP15,
  JPEG_COM,
  walkJpeg,
  type JpegPart,
} from './jpeg'
import type { MetadataPolicy } from './policy'
import { applyCopyPlan, type CopyPiece, type CopyPlan } from './png'
import { buildTiff, readTiffOrientation, TIFF_TAG_ORIENTATION, TIFF_TYPE_SHORT } from './tiff'

export type { MetadataPolicy }

const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00])

function isExifApp1(bytes: Uint8Array, dataStart: number, dataEnd: number): boolean {
  return (
    dataEnd - dataStart >= 6 &&
    bytes[dataStart] === 0x45 &&
    bytes[dataStart + 1] === 0x78 &&
    bytes[dataStart + 2] === 0x69 &&
    bytes[dataStart + 3] === 0x66 &&
    bytes[dataStart + 4] === 0x00 &&
    bytes[dataStart + 5] === 0x00
  )
}

/**
 * Does this segment carry metadata rather than image structure? APP0/JFIF holds
 * the pixel density and stays (the DPI writer needs it); every other APPn and
 * the COM marker is provenance the user asked to remove.
 */
function isMetadataSegment(
  bytes: Uint8Array,
  part: Extract<JpegPart, { kind: 'segment' }>,
): boolean {
  if (part.marker === JPEG_COM) return true
  if (part.marker < JPEG_APP0 || part.marker > JPEG_APP15) return false
  if (part.marker === JPEG_APP0 && isJfifApp0(bytes, part.start, part.end)) return false
  return true
}

function orientationApp1(orientation: number): Uint8Array {
  const tiff = buildTiff([
    { tag: TIFF_TAG_ORIENTATION, type: TIFF_TYPE_SHORT, values: [orientation & 0xffff] },
  ])
  const payload = new Uint8Array(EXIF_HEADER.length + tiff.length)
  payload.set(EXIF_HEADER, 0)
  payload.set(tiff, EXIF_HEADER.length)

  const chunk = new Uint8Array(4 + payload.length)
  chunk[0] = 0xff
  chunk[1] = 0xe1
  const length = payload.length + 2
  chunk[2] = (length >> 8) & 0xff
  chunk[3] = length & 0xff
  chunk.set(payload, 4)
  return chunk
}

export function containsExif(bytes: Uint8Array): boolean {
  const walk = walkJpeg(bytes)
  if (!walk.ok) return false
  return walk.parts.some(
    (part) =>
      part.kind === 'segment' &&
      part.marker === 0xe1 &&
      isExifApp1(bytes, part.dataStart, part.end),
  )
}

/**
 * Work out the exact output of `stripJpegMetadata` before allocating anything:
 * an ordered list of verbatim spans and literal replacement chunks, plus the
 * total length they add up to. Returns null when the policy is a plain copy
 * (`all`) or the stream is not a well-formed JPEG.
 *
 * The previous implementation pushed every surviving byte into a `number[]`
 * one at a time, so a 10 MB export allocated a ten-million-element array and
 * a second full copy before a single `Uint8Array` was created.
 */
export function planJpegCopy(bytes: Uint8Array, policy: MetadataPolicy): CopyPlan | null {
  if (policy === 'all') return null
  if (!isJpeg(bytes)) return null

  const walk = walkJpeg(bytes)
  if (!walk.ok) return null

  const pieces: CopyPiece[] = []
  let length = 0
  const pushSpan = (start: number, end: number) => {
    pieces.push({ kind: 'span', start, end })
    length += end - start
  }
  let wroteOrientation = false

  pushSpan(0, 2)
  for (const part of walk.parts) {
    if (part.kind === 'scan') {
      pushSpan(part.start, bytes.length)
      break
    }
    if (part.kind === 'fill' || part.kind === 'marker') {
      pushSpan(part.start, part.end)
      continue
    }
    if (!isMetadataSegment(bytes, part)) {
      pushSpan(part.start, part.end)
      continue
    }

    const exif = part.marker === 0xe1 && isExifApp1(bytes, part.dataStart, part.end)
    if (!exif || policy !== 'orientation' || wroteOrientation) continue
    const orientation = readTiffOrientation(bytes, part.dataStart + 6, part.end)
    if (orientation === null) continue
    const replacement = orientationApp1(orientation)
    pieces.push({ kind: 'bytes', bytes: replacement })
    length += replacement.length
    wroteOrientation = true
  }

  return { length, pieces }
}

export function stripJpegMetadata(bytes: Uint8Array, policy: MetadataPolicy): Uint8Array {
  const plan = planJpegCopy(bytes, policy)
  if (!plan) return new Uint8Array(bytes)
  return applyCopyPlan(bytes, plan)
}
