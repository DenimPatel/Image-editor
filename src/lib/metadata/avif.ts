import { readTiffDpi } from './tiff'

/**
 * AVIF keeps resolution metadata in an EXIF *item* inside the `meta` box, not
 * in any top-level field: `ispe` records pixels, not density. This module reads
 * that item and reports whether the file has one at all.
 *
 * It deliberately does not create one. `meta` is a tightly-coupled structure —
 * `iinf`, `iloc`, `iref` and `ipma` all index each other, and `iloc` carries
 * absolute file offsets into a shared `mdat` — so adding an item means
 * re-authoring every one of them. A browser canvas AVIF carries no Exif item,
 * and a wrong `meta` rewrite produces a file no decoder will open, which is a
 * far worse outcome than a format that ships without a density field.
 */

export type IsoBox = { type: string; start: number; bodyStart: number; end: number }

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
}

/** ISOBMFF integers are big-endian. */
function readU32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function readSized(bytes: Uint8Array, at: number, size: number): number {
  let value = 0
  for (let i = 0; i < size; i += 1) value = (value << 8) | bytes[at + i]
  return value
}

/** Walk the direct children of a box range, stopping at the first bad size. */
export function walkBoxes(bytes: Uint8Array, start: number, end: number): IsoBox[] {
  const boxes: IsoBox[] = []
  let offset = start
  while (offset + 8 <= end) {
    const size = readU32(bytes, offset)
    const boxEnd = offset + size
    if (size < 8 || boxEnd > end) break
    boxes.push({
      type: fourcc(bytes, offset + 4),
      start: offset,
      bodyStart: offset + 8,
      end: boxEnd,
    })
    offset = boxEnd
  }
  return boxes
}

export function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || fourcc(bytes, 4) !== 'ftyp') return false
  const brand = fourcc(bytes, 8)
  return brand === 'avif' || brand === 'avis'
}

/** Locate the Exif item's byte range, or null when the file carries none. */
function exifItemRange(bytes: Uint8Array): { start: number; end: number } | null {
  const meta = walkBoxes(bytes, 0, bytes.length).find((box) => box.type === 'meta')
  if (!meta) return null

  // `meta` is a FullBox: four bytes of version/flags ahead of the children.
  const children = walkBoxes(bytes, meta.bodyStart + 4, meta.end)
  const iinf = children.find((box) => box.type === 'iinf')
  const iloc = children.find((box) => box.type === 'iloc')
  if (!iinf || !iloc) return null

  const itemCountAt = iinf.bodyStart + 4 + (bytes[iinf.bodyStart] === 0 ? 2 : 4)
  const infe = walkBoxes(bytes, itemCountAt, iinf.end).find((box) => {
    // `infe` v2/v3 carry an item_type; v0/v1 do not, and HEIF only uses v2+.
    return bytes[box.bodyStart] >= 2 && fourcc(bytes, box.bodyStart + 8) === 'Exif'
  })
  if (!infe) return null
  const itemId = (bytes[infe.bodyStart + 4] << 8) | bytes[infe.bodyStart + 5]

  return readIlocExtent(bytes, iloc.bodyStart, itemId)
}

function readIlocExtent(
  bytes: Uint8Array,
  bodyStart: number,
  itemId: number,
): { start: number; end: number } | null {
  const version = bytes[bodyStart]
  const idWidth = version < 2 ? 2 : 4
  let at = bodyStart + 4
  const offsetSize = bytes[at] >> 4
  const lengthSize = bytes[at] & 0x0f
  const baseOffsetSize = bytes[at + 1] >> 4
  const indexSize = version === 0 ? 0 : bytes[at + 1] & 0x0f
  at += 2

  const itemCount = readSized(bytes, at, idWidth)
  at += idWidth

  for (let i = 0; i < itemCount; i += 1) {
    const currentId = readSized(bytes, at, idWidth)
    at += idWidth
    // reserved(4) + construction_method(12) in v1/v2, absent in v0.
    if (version === 1 || version === 2) at += 2
    at += 2
    const baseOffset = readSized(bytes, at, baseOffsetSize)
    at += baseOffsetSize
    const extentCount = readSized(bytes, at, idWidth)
    at += idWidth
    const extentSize = indexSize + offsetSize + lengthSize

    if (currentId !== itemId) {
      at += extentCount * extentSize
      continue
    }
    if (extentCount < 1) return null
    const extentOffset = readSized(bytes, at + indexSize, offsetSize)
    const extentLength = readSized(bytes, at + indexSize + offsetSize, lengthSize)
    const start = baseOffset + extentOffset
    if (start + extentLength > bytes.length) return null
    return { start, end: start + extentLength }
  }
  return null
}

export function readAvifDpi(bytes: Uint8Array): number | null {
  if (!isAvif(bytes)) return null
  const range = exifItemRange(bytes)
  if (!range) return null
  return readTiffDpi(bytes, range.start, range.end)
}

/**
 * Whether `setAvifDpi` has anything to write into. Always false for the AVIF a
 * browser canvas produces; the export sheet uses it to tell the truth about
 * resolution metadata instead of implying it was stamped.
 */
export function avifCanCarryDpi(bytes: Uint8Array): boolean {
  return isAvif(bytes) && exifItemRange(bytes) !== null
}

export function hasMetaBox(bytes: Uint8Array): boolean {
  return walkBoxes(bytes, 0, bytes.length).some((box) => box.type === 'meta')
}
