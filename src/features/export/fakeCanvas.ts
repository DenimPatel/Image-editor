/**
 * jsdom implements neither `HTMLCanvasElement.toBlob` nor `getImageData`, and
 * there is no canvas package in the dependency tree, so the export tests need
 * a stand-in. This one is honest rather than convenient: it emits *real*
 * container bytes for the requested MIME, so the metadata and DPI byte
 * surgery under test operates on files shaped like the ones a browser
 * produces, and it throws on `toDataURL` so a regression back to base64
 * cannot pass silently.
 */

export type FakeCanvasRequest = { mime: string; quality: number | undefined }

import { asBlobPart } from '../../lib/encode'

export type FakeCanvasOptions = {
  /** Mime types the pretend encoder "supports"; anything else falls back to
   * `fallbackMime`, exactly as the HTML spec requires of `toBlob`. */
  supported?: string[]
  fallbackMime?: string
}

export type FakeCanvas = HTMLCanvasElement & { calls: FakeCanvasRequest[] }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
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

/** PNG and ISOBMFF integers are big-endian. */
function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 0xff
  bytes[at + 1] = (value >>> 16) & 0xff
  bytes[at + 2] = (value >>> 8) & 0xff
  bytes[at + 3] = value & 0xff
}

/** RIFF integers are little-endian. */
function writeU32le(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >>> 8) & 0xff
  bytes[at + 2] = (value >>> 16) & 0xff
  bytes[at + 3] = (value >>> 24) & 0xff
}

function writeU16le(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff
  bytes[at + 1] = (value >>> 8) & 0xff
}

function fourcc(type: string): Uint8Array {
  return new Uint8Array([
    type.charCodeAt(0),
    type.charCodeAt(1),
    type.charCodeAt(2),
    type.charCodeAt(3),
  ])
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length)
  out[0] = 0xff
  out[1] = marker
  const length = payload.length + 2
  out[2] = (length >> 8) & 0xff
  out[3] = length & 0xff
  out.set(payload, 4)
  return out
}

const EXIF_TIFF = (() => {
  const tiff = new Uint8Array(26)
  const view = new DataView(tiff.buffer)
  tiff[0] = 0x49
  tiff[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, 1, true)
  view.setUint16(10, 0x0112, true)
  view.setUint16(12, 3, true)
  view.setUint32(14, 1, true)
  view.setUint16(18, 6, true)
  return tiff
})()

/** SOI + APP0(JFIF) + APP1(EXIF) + APP2(ICC) + DQT + SOS + entropy + EOI. */
export function jpegFixture(width: number, height: number, quality: number): Uint8Array {
  const entropy = Math.max(64, Math.round(quality * width * height * 0.01))
  return concat([
    new Uint8Array([0xff, 0xd8]),
    jpegSegment(
      0xe0,
      concat([
        fourcc('JFIF'),
        new Uint8Array([0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
      ]),
    ),
    jpegSegment(0xe1, concat([fourcc('Exif'), new Uint8Array([0, 0]), EXIF_TIFF])),
    jpegSegment(0xe2, concat([fourcc('ICC_PROFILE'), new Uint8Array(200).fill(0x33)])),
    jpegSegment(0xdb, new Uint8Array(64).fill(0x10)),
    jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0])),
    new Uint8Array(entropy).fill(0x5a),
    new Uint8Array([0xff, 0xd9]),
  ])
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Signature + IHDR + tEXt + eXIf + IDAT + IEND. */
export function pngFixture(width: number, height: number, quality: number): Uint8Array {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8
  ihdr[9] = 6
  const text = new TextEncoder().encode('Software\0fake-canvas')
  const idat = new Uint8Array(Math.max(32, Math.round(quality * width * height * 0.01))).fill(0x21)
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('eXIf', EXIF_TIFF),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

function riffChunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length % 2))
  for (let i = 0; i < 4; i += 1) out[i] = type.charCodeAt(i)
  writeU32le(out, 4, payload.length)
  out.set(payload, 8)
  return out
}

/** A simple lossy `VP8 ` WebP, the shape a canvas encoder emits. */
export function webpFixture(width: number, height: number, quality: number): Uint8Array {
  const frame = new Uint8Array(
    16 + Math.max(32, Math.round(quality * width * height * 0.005)),
  ).fill(0x7e)
  frame[3] = 0x9d
  frame[4] = 0x01
  frame[5] = 0x2a
  writeU16le(frame, 6, width)
  writeU16le(frame, 8, height)
  const body = concat([riffChunk('VP8 ', frame), riffChunk('XMP ', new Uint8Array([1, 2, 3, 4]))])
  const out = new Uint8Array(12 + body.length)
  out.set(concat([fourcc('RIFF'), new Uint8Array(4), fourcc('WEBP')]), 0)
  writeU32le(out, 4, body.length + 4)
  out.set(body, 12)
  return out
}

function isoBox(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  writeU32(out, 0, out.length)
  out.set(fourcc(type), 4)
  out.set(body, 8)
  return out
}

/** `ftyp` + `meta` (no Exif item, like a canvas AVIF) + `mdat`. */
export function avifFixture(width: number, height: number, quality: number): Uint8Array {
  const payload = new Uint8Array(Math.max(64, Math.round(quality * width * height * 0.01))).fill(
    0x77,
  )
  const ftyp = isoBox(
    'ftyp',
    concat([fourcc('avif'), new Uint8Array(4), fourcc('mif1'), fourcc('miaf')]),
  )
  const meta = isoBox(
    'meta',
    concat([
      new Uint8Array([0, 0, 0, 0]),
      isoBox('hdlr', concat([new Uint8Array(4), fourcc('pict'), new Uint8Array(9)])),
      isoBox('pitm', concat([new Uint8Array(4), new Uint8Array([0, 1])])),
    ]),
  )
  return concat([ftyp, meta, isoBox('mdat', payload)])
}

const ENCODERS: Record<string, (w: number, h: number, q: number) => Uint8Array> = {
  'image/jpeg': jpegFixture,
  'image/png': pngFixture,
  'image/webp': webpFixture,
  'image/avif': avifFixture,
}

export function bytesForMime(
  mime: string,
  width: number,
  height: number,
  quality = 0.92,
): Uint8Array {
  const encode = ENCODERS[mime]
  if (!encode) throw new Error(`no fake encoder for ${mime}`)
  return encode(width, height, quality)
}

const DEFAULT_SUPPORTED = Object.keys(ENCODERS)

/**
 * jsdom's `Blob` implements `slice`/`size`/`type` and nothing else: no
 * `arrayBuffer()`, no `text()`. Every export stage reads its bytes back, so
 * fill the gap from `FileReader`, which jsdom does implement. Test-only, and
 * a no-op in a real browser.
 */
function installBlobArrayBuffer(): void {
  if (typeof Blob === 'undefined' || typeof Blob.prototype.arrayBuffer === 'function') return
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

installBlobArrayBuffer()

export function createFakeCanvas(
  width: number,
  height: number,
  options: FakeCanvasOptions = {},
): FakeCanvas {
  const supported = options.supported ?? DEFAULT_SUPPORTED
  const fallback = options.fallbackMime ?? 'image/png'
  const calls: FakeCanvasRequest[] = []

  const canvas = {
    width,
    height,
    calls,
    toBlob(callback: BlobCallback, type?: string, quality?: number) {
      const mime = type ?? 'image/png'
      calls.push({ mime, quality })
      const actual = supported.includes(mime) ? mime : fallback
      const bytes = bytesForMime(actual, width, height, quality ?? 0.92)
      // Real `toBlob` is asynchronous; keep that shape so ordering bugs in the
      // export pipeline still show up here.
      setTimeout(() => callback(new Blob([asBlobPart(bytes)], { type: actual })), 0)
    },
    toDataURL(): string {
      throw new Error('toDataURL must not be used by the export path')
    },
    getContext(): null {
      return null
    },
    toString() {
      return '[object HTMLCanvasElement]'
    },
  }

  return canvas as unknown as FakeCanvas
}
