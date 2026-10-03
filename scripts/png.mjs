/**
 * A minimal PNG writer: 8-bit truecolour, non-interlaced, one IDAT.
 *
 * fflate is already a runtime dependency (`src/features/export/multiSize.ts`
 * uses `zipSync`, `src/lib/assets/assetIntegrity.test.ts` uses `unzlibSync`), so
 * the only thing hand-rolled here is the container. Two callers: the 24 look
 * strips and the PWA icons.
 */

import { zlibSync } from 'fflate'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** @param {Uint8Array} bytes @returns {number} */
function crc32(bytes) {
  let c = -1
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** @param {string} type @param {Uint8Array} data @returns {Uint8Array} */
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * @param {number} a @param {number} b @param {number} c @returns {number}
 */
const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * PNG scanline filtering, choosing per row by the standard
 * minimum-sum-of-absolute-differences heuristic. A look strip is smooth in red
 * and very smooth in green, so Sub/Up/Paeth collapse most of the image: 24 strips
 * go from ~800 KB of raw RGB to the 330 KB actually shipped.
 *
 * @param {Uint8Array} rgb @param {number} width @param {number} height @returns {Uint8Array}
 */
function filterRows(rgb, width, height) {
  const stride = width * 3
  const out = new Uint8Array((stride + 1) * height)
  const candidate = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    const above = row - stride
    let bestType = 0
    /** @type {Uint8Array | null} */
    let bestData = null
    let bestScore = Infinity
    for (let type = 0; type <= 4; type += 1) {
      let score = 0
      for (let i = 0; i < stride; i += 1) {
        const x = rgb[row + i]
        const a = i >= 3 ? rgb[row + i - 3] : 0
        const b = y > 0 ? rgb[above + i] : 0
        const c = y > 0 && i >= 3 ? rgb[above + i - 3] : 0
        /** @type {number} */
        let v
        switch (type) {
          case 1:
            v = x - a
            break
          case 2:
            v = x - b
            break
          case 3:
            v = x - ((a + b) >> 1)
            break
          case 4:
            v = x - paeth(a, b, c)
            break
          default:
            v = x
        }
        v &= 0xff
        candidate[i] = v
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) {
        bestScore = score
        bestType = type
        bestData = candidate.slice()
      }
    }
    const dst = y * (stride + 1)
    out[dst] = bestType
    out.set(bestData ?? candidate, dst + 1)
  }
  return out
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb `width * height * 3` bytes, row-major, no alpha.
 * @returns {Uint8Array}
 */
export function encodeRgbPng(width, height, rgb) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`expected ${width * height * 3} bytes, got ${rgb.length}`)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  /** @type {Uint8Array[]} */
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(filterRows(rgb, width, height), { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}
