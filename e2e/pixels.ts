import type { Page } from '@playwright/test'

/**
 * D6-F05 — the redaction privacy proof.
 *
 * A redaction is only a privacy feature if the *exported bytes* do not contain
 * what it was supposed to hide. Asserting that the compositor called `blur()`,
 * or that a fake context's gradient argument was positive, does not prove it:
 * the bytes that land on disk come from a real `canvas.toBlob`, through the real
 * pass stack, at full resolution.
 *
 * So these helpers decode the real downloaded file with `createImageBitmap` in
 * the page and report what is in the pixels. Nothing here trusts a UI label, a
 * store value, or a call the renderer claims to have made.
 *
 * The decisive number is `pearson(signature(before), signature(after))`: the
 * correlation between the redacted band and the same band of the *same image*
 * exported without the redaction. A redaction that did nothing correlates at
 * 1.0. A redaction that destroyed the content collapses towards 0, and a
 * negative value means the band now says something unrelated to the secret.
 */

export type Signature = {
  imageWidth: number
  imageHeight: number
  /** Region bounds in pixels, derived from the normalized rect. */
  left: number
  top: number
  width: number
  height: number
  /**
   * Fraction of pixels in the region whose luma is above `inkThreshold`.
   * White glyph ink on a black plate is the highest-contrast content a canvas
   * can hold, so this is the direct measure of "is the hidden ink still here".
   */
  inkFraction: number
  /**
   * Fraction of horizontally adjacent pixel pairs whose luma differs by more
   * than 64 — i.e. how much of the band is edge. Glyphs are edges; a blur, a
   * solid cover and a low-resolution block mosaic are not.
   */
  edgeFraction: number
  /** Distinct luma values quantised to 8 levels; antialiased text has many. */
  distinctLevels: number
  /** Mean luma, so a flat cover is distinguishable from a smear. */
  meanLuma: number
  /** 48x48 mean-luma grid: the region's actual structure, for correlation. */
  grid: number[]
  /**
   * SHA-256 of the region's exact RGBA bytes. This is the strongest form of
   * the privacy claim: export the same image twice with two *different*
   * secrets under an opaque redaction, and the digests are equal — the file
   * carries no information whatsoever about what it is hiding.
   */
  digest: string
}

export type Rect = { x: number; y: number; width: number; height: number }

const GRID = 48

function signatureExpression(base64: string, rect: Rect, inkThreshold: number): string {
  return `(async () => {
  const raw = atob(${JSON.stringify(base64)})
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  const bitmap = await createImageBitmap(new Blob([bytes]))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  const full = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
  const rect = ${JSON.stringify(rect)}
  const left = Math.max(0, Math.round(rect.x * bitmap.width))
  const top = Math.max(0, Math.round(rect.y * bitmap.height))
  const right = Math.min(bitmap.width, Math.round((rect.x + rect.width) * bitmap.width))
  const bottom = Math.min(bitmap.height, Math.round((rect.y + rect.height) * bitmap.height))
  const w = Math.max(0, right - left)
  const h = Math.max(0, bottom - top)
  const empty = {
    imageWidth: bitmap.width, imageHeight: bitmap.height, left, top, width: w, height: h,
    inkFraction: 0, edgeFraction: 0, distinctLevels: 0, meanLuma: 0,
    grid: new Array(${GRID * GRID}).fill(0),
    digest: 'empty',
  }
  if (w < 2 || h < 2) return empty
  const lumaAt = (x, y) => {
    const i = (y * bitmap.width + x) * 4
    return 0.299 * full[i] + 0.587 * full[i + 1] + 0.114 * full[i + 2]
  }
  let ink = 0, total = 0, edges = 0, pairs = 0, lumaSum = 0
  const levels = new Set()
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const l = lumaAt(x, y)
      if (l > ${inkThreshold}) ink += 1
      lumaSum += l
      total += 1
      levels.add(Math.round(l / 8))
      if (x + 1 < right) {
        pairs += 1
        if (Math.abs(lumaAt(x + 1, y) - l) > 64) edges += 1
      }
    }
  }
  const grid = new Array(${GRID * GRID}).fill(0)
  const counts = new Array(${GRID * GRID}).fill(0)
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const gx = Math.min(${GRID - 1}, Math.floor(((x - left) * ${GRID}) / w))
      const gy = Math.min(${GRID - 1}, Math.floor(((y - top) * ${GRID}) / h))
      const index = gy * ${GRID} + gx
      grid[index] += lumaAt(x, y)
      counts[index] += 1
    }
  }
  for (let i = 0; i < grid.length; i += 1) grid[i] = counts[i] > 0 ? grid[i] / counts[i] : 0
  const band = new Uint8Array(w * h * 4)
  for (let y = top; y < bottom; y += 1) {
    const src = (y * bitmap.width + left) * 4
    band.set(full.subarray(src, src + w * 4), (y - top) * w * 4)
  }
  const hash = await crypto.subtle.digest('SHA-256', band)
  const digest = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return {
    imageWidth: bitmap.width, imageHeight: bitmap.height, left, top, width: w, height: h,
    inkFraction: ink / total,
    edgeFraction: pairs > 0 ? edges / pairs : 0,
    distinctLevels: levels.size,
    meanLuma: lumaSum / total,
    grid,
    digest,
  }
})()`
}

/**
 * Decode real exported bytes and measure the structure of `rect`.
 *
 * `bytes` come straight off the download stream, so this is the file the user
 * would have saved — not a re-render of it, and not the preview canvas.
 */
export async function signatureOf(
  page: Page,
  bytes: Buffer,
  rect: Rect,
  inkThreshold = 200,
): Promise<Signature> {
  const base64 = bytes.toString('base64')
  return (await page.evaluate(signatureExpression(base64, rect, inkThreshold))) as Signature
}

/** Pearson correlation of two grids, in -1..1. Flat inputs report 0. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length < 2) return 0
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length
  const ma = mean(a)
  const mb = mean(b)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  const den = Math.sqrt(da * db)
  return den > 1e-9 ? num / den : 0
}

/**
 * The bounding box of every pixel in the export whose luma is above
 * `threshold`, in pixels from the top-left.
 *
 * On a frame that is otherwise flat black this is the literal, measured extent
 * of whatever was drawn on top of it — which is how the watermark test knows the
 * mark *moved* rather than merely that the file changed.
 */
export async function inkBounds(
  page: Page,
  bytes: Buffer,
  threshold = 100,
): Promise<{
  x: number
  y: number
  width: number
  height: number
  cx: number
  cy: number
  count: number
}> {
  const base64 = bytes.toString('base64')
  return page.evaluate(
    `(async () => {
  const raw = atob(${JSON.stringify(base64)})
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  const bitmap = await createImageBitmap(new Blob([bytes]))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const i = (y * bitmap.width + x) * 4
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (luma <= ${threshold}) continue
      count += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (count === 0) return { x: 0, y: 0, width: 0, height: 0, cx: 0, cy: 0, count: 0 }
  return {
    x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, count,
  }
})()`,
  )
}
export async function bandCrop(page: Page, bytes: Buffer, rect: Rect): Promise<string> {
  const base64 = bytes.toString('base64')
  return page.evaluate(
    `(async () => {
  const raw = atob(${JSON.stringify(base64)})
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  const bitmap = await createImageBitmap(new Blob([bytes]))
  const rect = ${JSON.stringify(rect)}
  const sx = Math.max(0, Math.round(rect.x * bitmap.width))
  const sy = Math.max(0, Math.round(rect.y * bitmap.height))
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * bitmap.width)))
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * bitmap.height)))
  const out = new OffscreenCanvas(sw, sh)
  out.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  const blob = await out.convertToBlob({ type: 'image/png' })
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (const byte of buf) s += String.fromCharCode(byte)
  return btoa(s)
})()`,
  )
}
