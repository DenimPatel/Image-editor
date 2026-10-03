export const JPEG_TEM = 0x01
export const JPEG_SOI = 0xd8
export const JPEG_EOI = 0xd9
export const JPEG_SOS = 0xda
export const JPEG_APP0 = 0xe0
export const JPEG_APP15 = 0xef
export const JPEG_COM = 0xfe

/**
 * One walk of the JPEG marker stream, shared by every metadata/DPI reader and
 * writer so they cannot desynchronise from each other.
 *
 * The three cases an ad-hoc `bytes[offset + 2] << 8 | bytes[offset + 3]` walk
 * gets wrong, all of them legal in a real file:
 * - `0xFF 0xFF` fill bytes between segments (each 0xFF is padding for the next
 *   marker, not a marker of its own),
 * - `0xFF 0x01` (TEM), which is a marker with *no* length field,
 * - `0xFF 0x00`, legal only inside entropy-coded scan data.
 *
 * Treating any of those as a length-prefixed segment desynchronises the walk
 * and makes it bail out early, silently dropping every later segment.
 */
export type JpegPart =
  /** A bare `0xFF` padding byte ahead of a real marker. */
  | { kind: 'fill'; start: number; end: number }
  /** `0xFF 0x01` (TEM) and `0xFF 0xD0..0xD7` (RSTn): a marker with no payload. */
  | { kind: 'marker'; marker: number; start: number; end: number }
  /** A length-prefixed segment such as DQT, SOF, DHT or APPn. */
  | { kind: 'segment'; marker: number; start: number; dataStart: number; end: number }
  /** SOS, EOI or a repeated SOI: everything from here on is copied verbatim. */
  | { kind: 'scan'; start: number }

export type JpegWalk = {
  parts: JpegPart[]
  /** False once the stream desynchronised; callers must not act on `parts`. */
  ok: boolean
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === JPEG_SOI
}

export function walkJpeg(bytes: Uint8Array): JpegWalk {
  const parts: JpegPart[] = []
  if (!isJpeg(bytes)) return { parts, ok: false }

  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return { parts, ok: false }
    const marker = bytes[offset + 1]
    if (marker === undefined) return { parts, ok: false }

    if (marker === 0xff) {
      parts.push({ kind: 'fill', start: offset, end: offset + 1 })
      offset += 1
      continue
    }
    if (marker === JPEG_TEM || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push({ kind: 'marker', marker, start: offset, end: offset + 2 })
      offset += 2
      continue
    }
    if (marker === JPEG_SOS || marker === JPEG_EOI || marker === JPEG_SOI) {
      parts.push({ kind: 'scan', start: offset })
      return { parts, ok: true }
    }
    if (marker === 0x00 || offset + 4 > bytes.length) return { parts, ok: false }

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + 2 + length > bytes.length) return { parts, ok: false }
    parts.push({
      kind: 'segment',
      marker,
      start: offset,
      dataStart: offset + 4,
      end: offset + 2 + length,
    })
    offset += 2 + length
  }

  return { parts, ok: true }
}

/** True for an APP0 that carries the JFIF signature (density, not metadata). */
export function isJfifApp0(bytes: Uint8Array, start: number, end: number): boolean {
  return (
    end - start >= 18 &&
    bytes[start + 4] === 0x4a &&
    bytes[start + 5] === 0x46 &&
    bytes[start + 6] === 0x49 &&
    bytes[start + 7] === 0x46 &&
    bytes[start + 8] === 0x00
  )
}
