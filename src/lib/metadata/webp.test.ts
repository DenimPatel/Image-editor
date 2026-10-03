import { describe, expect, it } from 'vitest'
import { buildTiff, TIFF_TAG_ORIENTATION, TIFF_TYPE_SHORT } from './tiff'
import {
  isWebp,
  readWebpDpi,
  setWebpDpi,
  stripWebpMetadata,
  walkRiff,
  webpOrientationExifChunk,
} from './webp'

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >>> 8) & 0xff
  bytes[at + 2] = (value >>> 16) & 0xff
  bytes[at + 3] = (value >>> 24) & 0xff
}

function writeU24(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >>> 8) & 0xff
  bytes[at + 2] = (value >>> 16) & 0xff
}

function fourcc(type: string): Uint8Array {
  return new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length % 2))
  out.set(fourcc(type), 0)
  writeU32(out, 4, payload.length)
  out.set(payload, 8)
  return out
}

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

function wrap(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  out.set(concat([fourcc('RIFF'), new Uint8Array(4), fourcc('WEBP')]), 0)
  writeU32(out, 4, body.length + 4)
  out.set(body, 12)
  return out
}

/** A lossy `VP8 ` payload whose frame header declares width × height. */
function lossyPayload(width: number, height: number): Uint8Array {
  const out = new Uint8Array(24).fill(0x7e)
  out[3] = 0x9d
  out[4] = 0x01
  out[5] = 0x2a
  writeU32(out, 6, width)
  writeU32(out, 8, height)
  return out
}

function simpleLossyWebp(width = 640, height = 480): Uint8Array {
  return wrap(concat([chunk('VP8 ', lossyPayload(width, height))]))
}

function extendedWebp(width = 1024, height = 768, flags = 0x20): Uint8Array {
  const vp8x = new Uint8Array(10)
  vp8x[0] = flags
  writeU24(vp8x, 4, width - 1)
  writeU24(vp8x, 7, height - 1)
  return wrap(concat([chunk('VP8X', vp8x), chunk('VP8 ', lossyPayload(width, height))]))
}

describe('walkRiff', () => {
  it('lists chunks with padding accounted for', () => {
    const odd = wrap(concat([chunk('VP8X', new Uint8Array(10)), chunk('EXIF ', new Uint8Array(3))]))
    const walk = walkRiff(odd)
    expect(walk.ok).toBe(true)
    expect(walk.chunks.map((entry) => entry.type)).toEqual(['VP8X', 'EXIF'])
    expect(walk.chunks[1].end).toBe(odd.length)
  })

  it('rejects a file that is not RIFF/WEBP', () => {
    expect(isWebp(new Uint8Array(20))).toBe(false)
    expect(walkRiff(new Uint8Array(20)).ok).toBe(false)
  })
})

describe('setWebpDpi (D7-F12)', () => {
  it('promotes a simple lossy file to VP8X and round-trips 300 dpi', () => {
    const result = setWebpDpi(simpleLossyWebp(640, 480), 300)
    const walk = walkRiff(result)
    expect(walk.ok).toBe(true)
    expect(walk.chunks.map((entry) => entry.type)).toEqual(['VP8X', 'VP8 ', 'EXIF'])
    expect(result[12 + 8] & 0x08).toBe(0x08)
    // The synthesised VP8X must describe the picture the decoder already had.
    expect(result[12 + 12] | (result[12 + 13] << 8) | (result[12 + 14] << 16)).toBe(639)
    expect(result[12 + 15] | (result[12 + 16] << 8) | (result[12 + 17] << 16)).toBe(479)
    expect(readWebpDpi(result)).toBe(300)
  })

  it('keeps the original VP8 payload byte-for-byte', () => {
    const source = simpleLossyWebp(320, 240)
    const result = setWebpDpi(source, 150)
    const original = walkRiff(source).chunks.find((entry) => entry.type === 'VP8 ')
    const updated = walkRiff(result).chunks.find((entry) => entry.type === 'VP8 ')
    expect(result.subarray(updated?.start ?? 0, updated?.end ?? 0)).toEqual(
      source.subarray(original?.start ?? 0, original?.end ?? 0),
    )
  })

  it('replaces an existing EXIF chunk rather than adding a second one', () => {
    const once = setWebpDpi(simpleLossyWebp(), 300)
    const twice = setWebpDpi(once, 300)
    expect(twice.length).toBe(once.length)
    expect(readWebpDpi(twice)).toBe(300)
    expect(walkRiff(twice).chunks.filter((entry) => entry.type === 'EXIF')).toHaveLength(1)
  })

  it('preserves the ICC and alpha flags of an extended file', () => {
    const withAlpha = extendedWebp(1024, 768, 0x20 | 0x10)
    const result = setWebpDpi(withAlpha, 600)
    expect(result[12 + 8] & 0x20).toBe(0x20)
    expect(result[12 + 8] & 0x10).toBe(0x10)
    expect(result[12 + 8] & 0x08).toBe(0x08)
    expect(readWebpDpi(result)).toBe(600)
  })

  it('writes a well-formed RIFF size', () => {
    const result = setWebpDpi(simpleLossyWebp(), 96)
    const declared =
      ((result[4] | (result[5] << 8) | (result[6] << 16)) >>> 0) | ((result[7] << 24) >>> 0)
    expect(declared).toBe(result.length - 8)
  })

  it('round-trips a range of densities', () => {
    for (const dpi of [72, 150, 300, 600, 1200]) {
      expect(readWebpDpi(setWebpDpi(simpleLossyWebp(), dpi))).toBe(dpi)
    }
  })

  it('leaves a file with no readable frame header unchanged', () => {
    const noFrame = wrap(concat([chunk('XMP ', new Uint8Array([1, 2, 3]))]))
    expect(setWebpDpi(noFrame, 300)).toEqual(noFrame)
    expect(setWebpDpi(new Uint8Array([1, 2, 3, 4]), 300)).toEqual(new Uint8Array([1, 2, 3, 4]))
  })
})

describe('stripWebpMetadata (D7-F01, D7-F08)', () => {
  const withMetadata = () =>
    wrap(
      concat([
        chunk(
          'VP8X',
          (() => {
            const payload = new Uint8Array(10)
            payload[0] = 0x20 | 0x08 | 0x04
            writeU24(payload, 4, 99)
            writeU24(payload, 7, 49)
            return payload
          })(),
        ),
        chunk('ICCP', new Uint8Array([0, 0, 0, 3, 1, 2, 3])),
        chunk('VP8 ', lossyPayload(100, 50)),
        chunk('XMP ', new Uint8Array([0x3c, 0x78, 0x3a, 0x78])),
        webpOrientationExifChunk(6),
      ]),
    )

  it('strip removes EXIF, XMP and the colour profile and clears the VP8X flags', () => {
    const result = stripWebpMetadata(withMetadata(), 'strip')
    expect(walkRiff(result).chunks.map((entry) => entry.type)).toEqual(['VP8X', 'VP8 '])
    expect(result[12 + 8] & 0x20).toBe(0)
    expect(result[12 + 8] & 0x08).toBe(0)
    expect(result[12 + 8] & 0x04).toBe(0)
  })

  it('orientation rewrites the EXIF chunk to a bare orientation block', () => {
    const result = stripWebpMetadata(withMetadata(), 'orientation')
    const types = walkRiff(result).chunks.map((entry) => entry.type)
    expect(types).toContain('EXIF')
    expect(types).not.toContain('XMP ')
    expect(types).not.toContain('ICCP')
    const expected = buildTiff([{ tag: TIFF_TAG_ORIENTATION, type: TIFF_TYPE_SHORT, values: [6] }])
    const exif = walkRiff(result).chunks.find((entry) => entry.type === 'EXIF')
    const payload = result.subarray(
      (exif?.dataStart ?? 0) + 6,
      (exif?.dataStart ?? 0) + 6 + expected.length,
    )
    expect(payload).toEqual(expected)
  })

  it('all keeps the container as it was', () => {
    const source = withMetadata()
    expect(stripWebpMetadata(source, 'all')).toEqual(source)
  })
})
