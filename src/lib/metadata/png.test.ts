import { describe, expect, it } from 'vitest'
import { buildTiff, TIFF_TAG_ORIENTATION, TIFF_TYPE_SHORT } from './tiff'
import {
  exifChunk,
  isPng,
  planPngCopy,
  pngChunk,
  readU32,
  stripPngMetadata,
  walkPng,
  writeU32,
} from './png'

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

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

function ihdr(): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, 1)
  view.setUint32(4, 1)
  data[8] = 8
  data[9] = 6
  return pngChunk('IHDR', data)
}

function text(keyword: string, value: string): Uint8Array {
  const data = new Uint8Array(keyword.length + 2 + value.length)
  data.set(new TextEncoder().encode(`${keyword}\0${value}`), 0)
  return pngChunk('tEXt', data)
}

function itxt(keyword: string): Uint8Array {
  const body = new TextEncoder().encode(`${keyword}\0\0\0en\0\0`)
  return pngChunk('iTXt', body)
}

const IDAT = pngChunk(
  'IDAT',
  new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]),
)
const IEND = pngChunk('IEND', new Uint8Array(0))

function basePng(): Uint8Array {
  return concat([SIGNATURE, ihdr(), IDAT, IEND])
}

function pngWithMetadata(): Uint8Array {
  return concat([
    SIGNATURE,
    ihdr(),
    text('Author', 'someone'),
    itxt('Description'),
    pngChunk('tIME', new Uint8Array([0x07, 0xe6, 1, 1, 0, 0, 0])),
    pngChunk('iCCP', new Uint8Array([0x00, 0x00, 0x01, 0x02, 0x03])),
    exifChunk(6),
    IDAT,
    IEND,
  ])
}

describe('walkPng', () => {
  it('lists every chunk with its byte range', () => {
    const walk = walkPng(pngWithMetadata())
    expect(walk.ok).toBe(true)
    expect(walk.chunks.map((chunk) => chunk.type)).toEqual([
      'IHDR',
      'tEXt',
      'iTXt',
      'tIME',
      'iCCP',
      'eXIf',
      'IDAT',
      'IEND',
    ])
    expect(walk.ihdrEnd).toBe(8 + 25)
  })

  it('rejects non-PNG input', () => {
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false)
    expect(walkPng(new Uint8Array([1, 2, 3])).ok).toBe(false)
  })

  it('reports a truncated chunk stream as not ok', () => {
    const truncated = basePng().subarray(0, basePng().length - 6)
    expect(walkPng(truncated).ok).toBe(false)
  })
})

describe('stripPngMetadata (D7-F01, D7-F08)', () => {
  it('strip removes text, EXIF, timestamp and the colour profile', () => {
    const png = pngWithMetadata()
    const result = stripPngMetadata(png, 'strip')
    expect(result).toEqual(basePng())
    expect(walkPng(result).chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('orientation keeps only an Orientation tag', () => {
    const result = stripPngMetadata(pngWithMetadata(), 'orientation')
    const types = walkPng(result).chunks.map((chunk) => chunk.type)
    expect(types).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND'])
    const exif = walkPng(result).chunks.find((chunk) => chunk.type === 'eXIf')
    const expected = exifChunk(6)
    expect(result.subarray(exif?.start ?? 0, (exif?.start ?? 0) + expected.length)).toEqual(
      expected,
    )
  })

  it('orientation does not invent an eXIf chunk when there was none', () => {
    const withText = concat([SIGNATURE, ihdr(), text('Author', 'someone'), IDAT, IEND])
    expect(stripPngMetadata(withText, 'orientation')).toEqual(basePng())
  })

  it('all keeps every chunk', () => {
    const png = pngWithMetadata()
    const result = stripPngMetadata(png, 'all')
    expect(result).toEqual(png)
    expect(result).not.toBe(png)
  })

  it('reports the output length before allocating', () => {
    const png = pngWithMetadata()
    const plan = planPngCopy(png, 'strip')
    expect(plan?.length).toBe(basePng().length)
    expect(stripPngMetadata(png, 'strip').length).toBe(plan?.length)
    expect(planPngCopy(png, 'all')).toBeNull()
  })

  it('copies non-PNG input unchanged', () => {
    const junk = new Uint8Array([1, 2, 3, 4])
    expect(stripPngMetadata(junk, 'strip')).toEqual(junk)
  })
})

describe('pngChunk', () => {
  it('writes a matching CRC32 over type and data', () => {
    const chunk = pngChunk('tEXt', new TextEncoder().encode('a\0b'))
    expect(readU32(chunk, 0)).toBe(3)
    expect(String.fromCharCode(chunk[4], chunk[5], chunk[6], chunk[7])).toBe('tEXt')
    expect(chunk.length).toBe(15)
  })

  it('round-trips through writeU32/readU32', () => {
    const out = new Uint8Array(4)
    writeU32(out, 0, 11811)
    expect(readU32(out, 0)).toBe(11811)
  })

  it('stores an orientation in a bare TIFF block with no Exif header', () => {
    const chunk = exifChunk(3)
    const tiff = buildTiff([{ tag: TIFF_TAG_ORIENTATION, type: TIFF_TYPE_SHORT, values: [3] }])
    expect(chunk.subarray(8, 8 + tiff.length)).toEqual(tiff)
  })
})
