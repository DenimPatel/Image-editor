import { deflateSync } from 'node:zlib'

/**
 * D9-F07 — the failure artefact.
 *
 * A shader-parity failure is worthless without a picture of it: "mean absolute
 * difference 7.31" does not say whether one corner is wrong or the whole frame
 * is shifted. This writes three PNGs side by side (GPU, CPU twin, amplified
 * difference) so a failure screenshot shows the bug.
 *
 * The encoder is ~40 lines of `node:zlib` rather than a dependency: the repo
 * already has a PNG writer in `scripts/png.mjs` for the build pipeline, but that
 * one is `checkJs`-typed build tooling and importing it into a Playwright spec
 * would tie the e2e run to the asset pipeline's module shape.
 */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Truecolour PNG from `width * height * 3` RGB bytes, row-major, top-down. */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (rgb.length !== width * height * 3) {
    throw new Error(`expected ${width * height * 3} bytes, got ${rgb.length}`)
  }
  // One filter byte (0 = None) per scanline; filter 0 keeps the encoder trivial
  // and the diff images are only ever read by a human.
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y += 1) {
    const dst = y * (width * 3 + 1)
    raw[dst] = 0
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), dst + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/**
 * A side-by-side strip: `a | b | amplified |b - a|`, amplified so a 1/255
 * rounding difference is not invisible against black.
 */
export function diffStrip(
  width: number,
  height: number,
  gpu: Uint8Array,
  cpu: Uint8Array,
  gain = 8,
): { png: Buffer; width: number; height: number } {
  const panel = width * 3
  const outWidth = panel * 3
  const out = new Uint8Array(outWidth * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4
      for (let c = 0; c < 3; c += 1) {
        const g = gpu[src + c]
        const k = cpu[src + c]
        const d = Math.min(255, Math.abs(g - k) * gain)
        const row = y * outWidth * 3
        out[row + x * 3 + c] = g
        out[row + panel + x * 3 + c] = k
        out[row + panel * 2 + x * 3 + c] = d
      }
    }
  }
  return { png: encodeRgbPng(outWidth, height, out), width: outWidth, height }
}
