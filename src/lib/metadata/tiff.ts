export const TIFF_TYPE_SHORT = 3
export const TIFF_TYPE_LONG = 4
export const TIFF_TYPE_RATIONAL = 5

export const TIFF_TAG_ORIENTATION = 0x0112
export const TIFF_TAG_X_RESOLUTION = 0x011a
export const TIFF_TAG_Y_RESOLUTION = 0x011b
export const TIFF_TAG_RESOLUTION_UNIT = 0x0128

export type TiffEntry = { tag: number; type: number; values: readonly number[] }

function typeSize(type: number): number {
  if (type === TIFF_TYPE_SHORT) return 2
  if (type === TIFF_TYPE_LONG) return 4
  if (type === TIFF_TYPE_RATIONAL) return 8
  throw new Error(`unsupported TIFF field type ${type}`)
}

function writeInline(out: Uint8Array, at: number, type: number, values: readonly number[]): void {
  let cursor = at
  for (const value of values) {
    if (type === TIFF_TYPE_SHORT) {
      out[cursor] = value & 0xff
      out[cursor + 1] = (value >> 8) & 0xff
      cursor += 2
    } else {
      out[cursor] = value & 0xff
      out[cursor + 1] = (value >>> 8) & 0xff
      out[cursor + 2] = (value >>> 16) & 0xff
      out[cursor + 3] = (value >>> 24) & 0xff
      cursor += 4
    }
  }
}

/**
 * Build a little-endian TIFF header plus a single IFD0. Entries are sorted by
 * tag because the TIFF spec requires ascending tag order, and `nextIfd` is left
 * at zero because there is no IFD1. Values of four bytes or fewer live inline
 * in the entry, which is what keeps a one-entry orientation block at 26 bytes.
 */
export function buildTiff(entries: readonly TiffEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag)
  const ifdSize = 2 + sorted.length * 12 + 4
  const dataStart = 8 + ifdSize
  let dataSize = 0
  for (const entry of sorted) {
    // Values of four bytes or fewer sit inside the 12-byte entry itself.
    if (entry.values.length * typeSize(entry.type) > 4) {
      dataSize += entry.values.length * typeSize(entry.type)
    }
  }

  const out = new Uint8Array(dataStart + dataSize)
  const view = new DataView(out.buffer, out.byteOffset)
  out[0] = 0x49
  out[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, sorted.length, true)

  let cursor = dataStart
  sorted.forEach((entry, index) => {
    const at = 10 + index * 12
    view.setUint16(at, entry.tag, true)
    view.setUint16(at + 2, entry.type, true)
    view.setUint32(at + 4, entry.values.length, true)
    const total = entry.values.length * typeSize(entry.type)
    if (total <= 4) writeInline(out, at + 8, entry.type, entry.values)
    else {
      view.setUint32(at + 8, cursor, true)
      for (let i = 0; i < entry.values.length; i += 1) {
        view.setUint32(cursor + i * 8, entry.values[i], true)
        view.setUint32(cursor + i * 8 + 4, 1, true)
      }
      cursor += total
    }
  })

  return out
}

function readU16(bytes: Uint8Array, at: number, little: boolean): number {
  return little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]
}

function readU32(bytes: Uint8Array, at: number, little: boolean): number {
  return little
    ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
    : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

type TiffView = { little: boolean }

function openTiff(bytes: Uint8Array, start: number, end: number): TiffView | null {
  if (start + 8 > end) return null
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49
  const big = bytes[start] === 0x4d && bytes[start + 1] === 0x4d
  if (!little && !big) return null
  return { little }
}

/**
 * Locate an IFD0 entry by tag. A zero IFD0 offset is the TIFF way of saying
 * "this file has no IFD0" and an offset below 8 points back into the 8-byte
 * header; both used to be followed, which parsed the header itself as an
 * entry count and reported a garbage orientation.
 */
function findEntry(bytes: Uint8Array, start: number, end: number, tag: number): number {
  const view = openTiff(bytes, start, end)
  if (!view) return -1
  const ifd0 = readU32(bytes, start + 4, view.little)
  if (ifd0 < 8) return -1
  const base = start + ifd0
  if (base + 2 > end) return -1

  const count = readU16(bytes, base, view.little)
  for (let i = 0; i < count; i += 1) {
    const at = base + 2 + i * 12
    if (at + 12 > end) return -1
    if (readU16(bytes, at, view.little) === tag) return at
  }
  return -1
}

/** Read IFD0 Orientation (0x0112) from a TIFF block at `bytes[start..end)`. */
export function readTiffOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  const view = openTiff(bytes, start, end)
  if (!view) return null
  const at = findEntry(bytes, start, end, TIFF_TAG_ORIENTATION)
  if (at < 0) return null
  return readU16(bytes, at + 8, view.little)
}

/** Read XResolution/YResolution plus ResolutionUnit (1 none, 2 inch, 3 cm). */
export function readTiffDpi(bytes: Uint8Array, start: number, end: number): number | null {
  const view = openTiff(bytes, start, end)
  if (!view) return null

  const unitEntry = findEntry(bytes, start, end, TIFF_TAG_RESOLUTION_UNIT)
  const unit = unitEntry < 0 ? 2 : readU16(bytes, unitEntry + 8, view.little)

  for (const tag of [TIFF_TAG_X_RESOLUTION, TIFF_TAG_Y_RESOLUTION]) {
    const at = findEntry(bytes, start, end, tag)
    if (at < 0) continue
    const type = readU16(bytes, at + 2, view.little)
    const count = readU32(bytes, at + 4, view.little)
    if (type !== TIFF_TYPE_RATIONAL || count < 1) continue
    const at8 = readU32(bytes, at + 8, view.little)
    const valueAt = at8 >= 8 && at8 < end - start ? start + at8 : at + 8
    if (valueAt + 8 > end) continue
    const numerator = readU32(bytes, valueAt, view.little)
    const denominator = readU32(bytes, valueAt + 4, view.little)
    if (denominator === 0) continue
    const resolution = numerator / denominator
    if (resolution <= 0) continue
    return Math.round(unit === 3 ? resolution * 2.54 : resolution)
  }
  return null
}
