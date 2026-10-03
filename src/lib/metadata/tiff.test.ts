import { describe, expect, it } from 'vitest'
import {
  buildTiff,
  readTiffDpi,
  readTiffOrientation,
  TIFF_TAG_RESOLUTION_UNIT,
  TIFF_TAG_X_RESOLUTION,
  TIFF_TAG_Y_RESOLUTION,
  TIFF_TYPE_RATIONAL,
  TIFF_TYPE_SHORT,
} from './tiff'

function withDpi(dpi: number): Uint8Array {
  return buildTiff([
    { tag: TIFF_TAG_X_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [dpi] },
    { tag: TIFF_TAG_Y_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [dpi] },
    { tag: TIFF_TAG_RESOLUTION_UNIT, type: TIFF_TYPE_SHORT, values: [2] },
  ])
}

describe('buildTiff', () => {
  it('keeps an inline-only IFD0 at 26 bytes with a zero next-IFD pointer', () => {
    const tiff = buildTiff([{ tag: 0x0112, type: TIFF_TYPE_SHORT, values: [6] }])
    expect(tiff.length).toBe(26)
    expect(Array.from(tiff.subarray(0, 10))).toEqual([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00,
    ])
    expect(Array.from(tiff.subarray(18, 20))).toEqual([0x06, 0x00])
    expect(Array.from(tiff.subarray(22))).toEqual([0, 0, 0, 0])
  })

  it('sorts entries into ascending tag order', () => {
    const tiff = buildTiff([
      { tag: TIFF_TAG_RESOLUTION_UNIT, type: TIFF_TYPE_SHORT, values: [2] },
      { tag: TIFF_TAG_X_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [300] },
    ])
    expect((tiff[10] | (tiff[11] << 8)) & 0xffff).toBe(TIFF_TAG_X_RESOLUTION)
    expect((tiff[22] | (tiff[23] << 8)) & 0xffff).toBe(TIFF_TAG_RESOLUTION_UNIT)
  })

  it('rejects a field type it cannot size', () => {
    expect(() => buildTiff([{ tag: 1, type: 7, values: [0] }])).toThrow(
      /unsupported TIFF field type/,
    )
  })
})

describe('readTiffOrientation', () => {
  it('round-trips an inline SHORT value', () => {
    const tiff = buildTiff([{ tag: 0x0112, type: TIFF_TYPE_SHORT, values: [8] }])
    expect(readTiffOrientation(tiff, 0, tiff.length)).toBe(8)
  })

  it('reads a big-endian block', () => {
    const tiff = buildTiff([{ tag: 0x0112, type: TIFF_TYPE_SHORT, values: [3] }])
    const big = new Uint8Array(tiff.length)
    // Flip the whole block to MM by rewriting the header and entry fields.
    const view = new DataView(big.buffer)
    big[0] = 0x4d
    big[1] = 0x4d
    view.setUint16(2, 42, false)
    view.setUint32(4, 8, false)
    view.setUint16(8, 1, false)
    view.setUint16(10, 0x0112, false)
    view.setUint16(12, 3, false)
    view.setUint32(14, 1, false)
    view.setUint16(18, 3, false)
    expect(readTiffOrientation(big, 0, big.length)).toBe(3)
  })

  it('returns null for a zero or in-header IFD0 offset', () => {
    for (const ifd0 of [0, 4]) {
      const tiff = new Uint8Array(26)
      const view = new DataView(tiff.buffer)
      tiff[0] = 0x49
      tiff[1] = 0x49
      view.setUint16(2, 42, true)
      view.setUint32(4, ifd0, true)
      expect(readTiffOrientation(tiff, 0, tiff.length)).toBeNull()
    }
  })

  it('returns null for a block that is not a TIFF header', () => {
    const junk = new Uint8Array(32)
    expect(readTiffOrientation(junk, 0, junk.length)).toBeNull()
    expect(readTiffOrientation(new Uint8Array(4), 0, 4)).toBeNull()
  })
})

describe('readTiffDpi', () => {
  it('round-trips a range of densities', () => {
    for (const dpi of [72, 96, 150, 300, 600, 1200]) {
      const tiff = withDpi(dpi)
      expect(readTiffDpi(tiff, 0, tiff.length)).toBe(dpi)
    }
  })

  it('reads centimetres as inches', () => {
    const tiff = buildTiff([
      { tag: TIFF_TAG_X_RESOLUTION, type: TIFF_TYPE_RATIONAL, values: [118] },
      { tag: TIFF_TAG_RESOLUTION_UNIT, type: TIFF_TYPE_SHORT, values: [3] },
    ])
    expect(readTiffDpi(tiff, 0, tiff.length)).toBe(Math.round(118 * 2.54))
  })

  it('returns null when no resolution tag is present', () => {
    const tiff = buildTiff([{ tag: 0x0112, type: TIFF_TYPE_SHORT, values: [1] }])
    expect(readTiffDpi(tiff, 0, tiff.length)).toBeNull()
  })
})
