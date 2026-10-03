import { describe, expect, it } from 'vitest'
import { containsExif, planJpegCopy, stripJpegMetadata } from './exif'

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

function buildApp1Exif(orientation: number, little: boolean): Uint8Array {
  const tiff = new Uint8Array(26)
  const view = new DataView(tiff.buffer)
  tiff[0] = little ? 0x49 : 0x4d
  tiff[1] = little ? 0x49 : 0x4d
  view.setUint16(2, 42, little)
  view.setUint32(4, 8, little)
  view.setUint16(8, 1, little)
  view.setUint16(10, 0x0112, little)
  view.setUint16(12, 3, little)
  view.setUint32(14, 1, little)
  view.setUint16(18, orientation, little)

  const chunk = new Uint8Array(4 + 6 + tiff.length)
  chunk[0] = 0xff
  chunk[1] = 0xe1
  const length = 6 + tiff.length + 2
  chunk[2] = (length >> 8) & 0xff
  chunk[3] = length & 0xff
  chunk.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4)
  chunk.set(tiff, 10)
  return chunk
}

const SOI = new Uint8Array([0xff, 0xd8])
const APP0 = new Uint8Array([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
  0x00, 0x00,
])
const SOS = new Uint8Array([
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9,
])

function sampleJpeg(orientation: number, little: boolean): { bytes: Uint8Array; app1: Uint8Array } {
  const app1 = buildApp1Exif(orientation, little)
  return { bytes: concat([SOI, APP0, app1, SOS]), app1 }
}

function tailFromSos(bytes: Uint8Array): Uint8Array {
  for (let i = 2; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xda) return bytes.subarray(i)
  }
  return new Uint8Array(0)
}

/** A length-prefixed segment with an arbitrary payload, e.g. APP2 ICC or COM. */
function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  out[0] = 0xff
  out[1] = marker
  const length = payload.length + 2
  out[2] = (length >> 8) & 0xff
  out[3] = length & 0xff
  out.set(payload, 4)
  return out
}

const ICC = segment(
  0xe2,
  concat([
    new Uint8Array([0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x01]),
    new Uint8Array(300).fill(0x5a),
  ]),
)
const IPTC = segment(0xed, new Uint8Array(120).fill(0x38))
const COMMENT = segment(0xfe, new Uint8Array([0x68, 0x69, 0x20, 0x74, 0x68, 0x65, 0x72, 0x65]))

/** A SOI, APP0, a comment, a payload of `size` bytes inside one DQT, then the scan. */
function syntheticJpeg(size: number): Uint8Array {
  return concat([SOI, APP0, COMMENT, segment(0xdb, new Uint8Array(size).fill(0x11)), SOS])
}

/** The same file with the comment removed, built without the stripper. */
function syntheticJpegGolden(size: number): Uint8Array {
  return concat([SOI, APP0, segment(0xdb, new Uint8Array(size).fill(0x11)), SOS])
}

describe('containsExif', () => {
  it('detects EXIF APP1 segments', () => {
    expect(containsExif(sampleJpeg(6, false).bytes)).toBe(true)
    expect(containsExif(concat([SOI, APP0, SOS]))).toBe(false)
    expect(containsExif(new Uint8Array([1, 2, 3]))).toBe(false)
  })

  it('walks past TEM and 0xFF fill bytes to find EXIF', () => {
    const tem = new Uint8Array([0xff, 0x01])
    const fill = new Uint8Array([0xff, 0xff])
    expect(containsExif(concat([SOI, tem, fill, APP0, fill, buildApp1Exif(1, true), SOS]))).toBe(
      true,
    )
  })
})

describe('stripJpegMetadata', () => {
  it('strips APP1 EXIF and keeps APP0 and the image data byte-for-byte', () => {
    const { bytes } = sampleJpeg(6, false)
    const result = stripJpegMetadata(bytes, 'strip')

    expect(containsExif(result)).toBe(false)
    expect(result.subarray(0, 2)).toEqual(SOI)
    expect(result.subarray(2, 2 + APP0.length)).toEqual(APP0)
    expect(tailFromSos(result)).toEqual(tailFromSos(bytes))
  })

  it('keeps only a minimal little-endian orientation APP1', () => {
    const bigEndian = buildApp1Exif(6, false)
    const { bytes } = sampleJpeg(6, false)
    const result = stripJpegMetadata(bytes, 'orientation')

    const expectedMinimal = buildApp1Exif(6, true)
    expect(containsExif(result)).toBe(true)
    expect(
      Array.from(result.subarray(2 + APP0.length, 2 + APP0.length + expectedMinimal.length)),
    ).toEqual(Array.from(expectedMinimal))
    expect(result.length).toBe(bytes.length - bigEndian.length + expectedMinimal.length)
    expect(tailFromSos(result)).toEqual(tailFromSos(bytes))
  })

  it('preserves the orientation value when rebuilding', () => {
    const { bytes } = sampleJpeg(8, true)
    const result = stripJpegMetadata(bytes, 'orientation')
    const expectedMinimal = buildApp1Exif(8, true)
    expect(
      Array.from(result.subarray(2 + APP0.length, 2 + APP0.length + expectedMinimal.length)),
    ).toEqual(Array.from(expectedMinimal))
  })

  it('returns an identical copy for policy all', () => {
    const { bytes } = sampleJpeg(6, false)
    const result = stripJpegMetadata(bytes, 'all')
    expect(result).toEqual(bytes)
    expect(result).not.toBe(bytes)
  })

  it('returns a copy for malformed input', () => {
    const malformed = new Uint8Array([1, 2, 3, 4, 5])
    const result = stripJpegMetadata(malformed, 'strip')
    expect(result).toEqual(malformed)
    expect(result).not.toBe(malformed)

    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1])
    expect(stripJpegMetadata(truncated, 'strip')).toEqual(truncated)
  })
})

describe('stripJpegMetadata metadata policy (D7-F08)', () => {
  const withAll = concat([SOI, APP0, ICC, COMMENT, IPTC, buildApp1Exif(6, true), SOS])

  it('strip removes ICC, comments and IPTC, not just EXIF', () => {
    const app1 = buildApp1Exif(6, true)
    const result = stripJpegMetadata(withAll, 'strip')
    expect(result).toEqual(concat([SOI, APP0, SOS]))
    expect(result.length).toBe(
      withAll.length - ICC.length - COMMENT.length - IPTC.length - app1.length,
    )
  })

  it('orientation keeps the orientation tag and drops every other segment', () => {
    const result = stripJpegMetadata(withAll, 'orientation')
    const expectedMinimal = buildApp1Exif(6, true)
    expect(result).toEqual(concat([SOI, APP0, expectedMinimal, SOS]))
    expect(containsExif(result)).toBe(true)
  })

  it('all keeps every metadata segment', () => {
    expect(stripJpegMetadata(withAll, 'all')).toEqual(withAll)
  })
})

describe('JPEG marker walk robustness', () => {
  it('strips EXIF that follows a TEM marker', () => {
    const bytes = concat([SOI, new Uint8Array([0xff, 0x01]), APP0, buildApp1Exif(3, true), SOS])
    expect(containsExif(bytes)).toBe(true)
    expect(stripJpegMetadata(bytes, 'strip')).toEqual(
      concat([SOI, new Uint8Array([0xff, 0x01]), APP0, SOS]),
    )
  })

  it('strips EXIF that follows 0xFF fill bytes', () => {
    const fill = new Uint8Array([0xff, 0xff, 0xff])
    const bytes = concat([SOI, APP0, fill, buildApp1Exif(3, true), SOS])
    expect(containsExif(bytes)).toBe(true)
    expect(stripJpegMetadata(bytes, 'strip')).toEqual(concat([SOI, APP0, fill, SOS]))
  })

  it('copies the whole file when the stream desynchronises', () => {
    const desynced = concat([SOI, APP0, new Uint8Array([0x00, 0x12, 0x34])])
    expect(stripJpegMetadata(desynced, 'strip')).toEqual(desynced)
    expect(containsExif(desynced)).toBe(false)
  })
})

describe('readOrientation edge cases', () => {
  it('treats a zero IFD0 offset as "no IFD0" instead of parsing the header', () => {
    const tiff = new Uint8Array(26)
    const view = new DataView(tiff.buffer)
    tiff[0] = 0x49
    tiff[1] = 0x49
    view.setUint16(2, 42, true)
    view.setUint32(4, 0, true) // legal "no IFD0" value
    const chunk = new Uint8Array(4 + 6 + tiff.length)
    chunk[0] = 0xff
    chunk[1] = 0xe1
    chunk[2] = 0x00
    chunk[3] = chunk.length - 2
    chunk.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4)
    chunk.set(tiff, 10)

    const bytes = concat([SOI, APP0, chunk, SOS])
    expect(containsExif(bytes)).toBe(true)
    // No orientation can be read, so `orientation` must not invent one.
    expect(stripJpegMetadata(bytes, 'orientation')).toEqual(concat([SOI, APP0, SOS]))
  })
})

describe('planJpegCopy (D7-F10)', () => {
  it('computes the output length before allocating and matches the bytes', () => {
    const sizes = [0, 1, 2, 255, 4096, 65000]
    for (const size of sizes) {
      const bytes = syntheticJpeg(size)
      for (const policy of ['strip', 'orientation'] as const) {
        const plan = planJpegCopy(bytes, policy)
        expect(plan).not.toBeNull()
        const result = stripJpegMetadata(bytes, policy)
        expect(result.length).toBe(plan?.length)
        expect(result).toBeInstanceOf(Uint8Array)
        expect(result).toEqual(syntheticJpegGolden(size))
      }
    }
  })

  it('produces golden bytes that match an independent construction', () => {
    const bytes = syntheticJpeg(1000)
    expect(stripJpegMetadata(bytes, 'strip')).toEqual(syntheticJpegGolden(1000))
    expect(stripJpegMetadata(bytes, 'orientation')).toEqual(syntheticJpegGolden(1000))
  })

  it('shortens the output by exactly the dropped segments', () => {
    const app1 = buildApp1Exif(6, true)
    const bytes = concat([SOI, APP0, ICC, app1, SOS])
    const plan = planJpegCopy(bytes, 'strip')
    expect(plan?.length).toBe(SOI.length + APP0.length + SOS.length)
    expect(stripJpegMetadata(bytes, 'strip').length).toBe(bytes.length - ICC.length - app1.length)
  })

  it('returns null for the all policy and for non-JPEG input', () => {
    expect(planJpegCopy(syntheticJpeg(4), 'all')).toBeNull()
    expect(planJpegCopy(new Uint8Array([1, 2, 3, 4]), 'strip')).toBeNull()
    expect(planJpegCopy(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]), 'strip')).toBeNull()
  })
})
