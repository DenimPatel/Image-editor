/**
 * CPU twins of the two detail kernels in `src/gl/shaders/index.ts`. The GL
 * backend runs per-channel, so a single channel plus a sampling function is
 * all it takes to mirror them exactly (up to the texture's bilinear filtering,
 * which the tests replace with nearest-neighbour sampling).
 */

export const SHARPEN_GAIN = 2
export const DEFINITION_WEIGHTS = { near: 0.2, mid: 0.3, far: 0.5 } as const

/** Kernel radius in texels for a 0..1 sharpen amount. */
export function sharpenRadius(amount: number): number {
  return 1 + amount * 1.5
}

/** Kernel radius in texels for a 0..1 definition amount; always wider. */
export function definitionRadius(amount: number): number {
  return 1 + amount * 2
}

export type Read = (x: number, y: number) => number

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Cross of four neighbours, centre weighted twice. */
export function crossBlur(read: Read, x: number, y: number, radius: number): number {
  return (
    (2 * read(x, y) +
      read(x + radius, y) +
      read(x - radius, y) +
      read(x, y + radius) +
      read(x, y - radius)) /
    6
  )
}

/** Average of the eight points on the ring at `radius`. */
export function ringAverage(read: Read, x: number, y: number, radius: number): number {
  return (
    (read(x + radius, y) +
      read(x - radius, y) +
      read(x, y + radius) +
      read(x, y - radius) +
      read(x + radius, y + radius) +
      read(x - radius, y - radius) +
      read(x + radius, y - radius) +
      read(x - radius, y + radius)) /
    8
  )
}

/** Unsharp mask on a cross: a single-radius, 1-texel-scale detail boost. */
export function sharpen(read: Read, x: number, y: number, amount: number): number {
  const centre = read(x, y)
  const detail = centre - crossBlur(read, x, y, sharpenRadius(amount))
  return clamp01(centre + detail * amount * SHARPEN_GAIN)
}

/** Multi-radius local contrast at 1x / 2x / 4x the base radius. */
export function definition(read: Read, x: number, y: number, amount: number): number {
  const centre = read(x, y)
  const radius = definitionRadius(amount)
  const near = ringAverage(read, x, y, radius)
  const mid = ringAverage(read, x, y, radius * 2)
  const far = ringAverage(read, x, y, radius * 4)
  const detail =
    (centre - near) * DEFINITION_WEIGHTS.near +
    (centre - mid) * DEFINITION_WEIGHTS.mid +
    (centre - far) * DEFINITION_WEIGHTS.far
  return clamp01(centre + detail * amount)
}

/** Nearest-neighbour sampler with clamp-to-edge, matching a GL texture wrap. */
export function pixelReader(rows: number[][]): Read {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  return (x, y) => {
    const cx = Math.min(width - 1, Math.max(0, Math.round(x)))
    const cy = Math.min(height - 1, Math.max(0, Math.round(y)))
    return rows[cy][cx]
  }
}

/** Max - min inside a square window, i.e. the local contrast of a region. */
export function localContrast(read: Read, x: number, y: number, half: number): number {
  let min = Infinity
  let max = -Infinity
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const value = read(x + dx, y + dy)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  return max - min
}
