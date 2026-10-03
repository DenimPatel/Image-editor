import { describe, expect, it } from 'vitest'
import { avifCanCarryDpi, hasMetaBox, isAvif, readAvifDpi, walkBoxes } from './avif'
import {
  buildTiff,
  TIFF_TAG_RESOLUTION_UNIT,
  TIFF_TAG_X_RESOLUTION,
  TIFF_TYPE_RATIONAL,
  TIFF_TYPE_SHORT,
} from './tiff'

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function fourcc(type: string): Uint8Array {
  return new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])
}

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, out.length)
  out.set(fourcc(type), 4)
  out.set(body, 8)
  return out
}

function fullBox(type: string, version: number, flags: number, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(4)
  head[0] = version
  const view = new DataView(head.buffer)
  view.setUint32(0, ((version << 24) | flags) >>> 0)
  return box(type, concat([head, body]))
}

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff])
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

function exifTiff(dpi: number): Uint8Array {
  return buildTiff([
    { tag: TIFF_TAG_X_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [dpi] },
    { tag: TIFF_TAG_RESOLUTION_UNIT, type: TIFF_TYPE_SHORT, values: [2] },
  ])
}

const HANDLER = fullBox(
  'hdlr',
  0,
  0,
  concat([u32(0), fourcc('pict'), u32(0), u32(0), new Uint8Array([0])]),
)
const PITM = fullBox('pitm', 0, 0, u16(1))

function infe(itemId: number, itemType: string): Uint8Array {
  const name = new Uint8Array([0])
  return fullBox('infe', 2, 0, concat([u16(itemId), u16(0), fourcc(itemType), name]))
}

/** A v1 `iloc` with 4-byte offsets and lengths and a zero base offset. */
function iloc(items: { id: number; offset: number; length: number }[]): Uint8Array {
  const body: Uint8Array[] = [
    new Uint8Array([0x44, 0x00]), // offset_size 4, length_size 4; base 0, index 0
    u16(items.length),
  ]
  for (const item of items) {
    body.push(u16(item.id), u16(0), u16(0), u16(1), u32(item.offset), u32(item.length))
  }
  return fullBox('iloc', 1, 0, concat(body))
}

function avif(items: { id: number; type: string; payload: Uint8Array }[]): Uint8Array {
  const mdatPayload = concat(items.map((item) => item.payload))
  const ftyp = box('ftyp', concat([fourcc('avif'), u32(0), fourCCBrandTail()]))
  // Two passes: the file offsets inside `iloc` are absolute, so the meta box
  // has to be laid out once to learn where `mdat` will start.
  const build = (mdatStart: number) => {
    let cursor = mdatStart
    const located = items.map((item) => {
      const entry = { id: item.id, offset: cursor, length: item.payload.length }
      cursor += item.payload.length
      return entry
    })
    const iinf = fullBox(
      'iinf',
      0,
      0,
      concat([u16(items.length), ...items.map((i) => infe(i.id, i.type))]),
    )
    const meta = fullBox('meta', 0, 0, concat([HANDLER, PITM, iinf, iloc(located)]))
    return concat([ftyp, meta, box('mdat', mdatPayload)])
  }
  const probe = build(0)
  return build(probe.length - mdatPayload.length)
}

function fourCCBrandTail(): Uint8Array {
  return concat([fourcc('mif1'), fourcc('miaf'), new Uint8Array(4)])
}

describe('AVIF resolution metadata (D7-F12)', () => {
  it('reads the density from an Exif item', () => {
    const bytes = avif([
      { id: 1, type: 'hvc1', payload: new Uint8Array(40).fill(1) },
      { id: 2, type: 'Exif', payload: exifTiff(300) },
    ])
    expect(isAvif(bytes)).toBe(true)
    expect(hasMetaBox(bytes)).toBe(true)
    expect(avifCanCarryDpi(bytes)).toBe(true)
    expect(readAvifDpi(bytes)).toBe(300)
  })

  it('reports no density when there is no Exif item', () => {
    const bytes = avif([{ id: 1, type: 'av01', payload: new Uint8Array(40).fill(2) }])
    expect(hasMetaBox(bytes)).toBe(true)
    expect(avifCanCarryDpi(bytes)).toBe(false)
    expect(readAvifDpi(bytes)).toBeNull()
  })

  it('returns null for a file that is not AVIF', () => {
    expect(isAvif(new Uint8Array(32))).toBe(false)
    expect(readAvifDpi(new Uint8Array(32))).toBeNull()
    expect(avifCanCarryDpi(new Uint8Array(32))).toBe(false)
  })

  it('stops walking a box tree at the first bad size', () => {
    const bytes = avif([{ id: 1, type: 'av01', payload: new Uint8Array(8) }])
    const truncated = bytes.subarray(0, 40)
    expect(
      walkBoxes(truncated, 0, truncated.length).some((box) => box.end > truncated.length),
    ).toBe(false)
  })
})
