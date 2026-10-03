import type { CurveChannel, CurvePoint, Curves } from '../model/types'

/**
 * The colour every surface in the app draws a given curve band in.
 *
 * There are two of them and they used not to agree. `CurvesEditor` held its own
 * `CHANNEL_COLOR` literal (`#ff5a5a`) while `Histogram` drew its channel overlay
 * from a different one (`rgba(255, 80, 80, 0.5)`) inside its own function — so
 * "the red curve" and "the red histogram" were two different reds, ten and
 * twenty units apart, and nothing in either file could have noticed. Two
 * literals for one concept is exactly how that happens: the second one was
 * written to match the first by eye and nobody measured it.
 *
 * One table, ordered so that a band and its curve are the same colour by
 * construction rather than by coincidence:
 *
 * | key  | hex       | the histogram fill it replaces          |
 * | ---- | --------- | -------------------------------------- |
 * | `rgb` | `#ffffff` | `rgba(255, 255, 255, 0.35)` (luma)     |
 * | `r`   | `#ff5050` | `rgba(255, 80, 80, 0.5)`                |
 * | `g`   | `#50dc78` | `rgba(80, 220, 120, 0.5)`               |
 * | `b`   | `#5a8cff` | `rgba(90, 140, 255, 0.5)`               |
 *
 * The hexes are the *current* histogram fills taken apart, not new picks, so
 * pointing `Histogram` at this table is a refactor and not a restyle. They are
 * keyed by `CurveChannel`, which makes the map total by construction: a fifth
 * channel stops this compiling.
 */
export const TONAL_CURVE_COLORS: Record<CurveChannel, string> = {
  rgb: '#ffffff',
  r: '#ff5050',
  g: '#50dc78',
  b: '#5a8cff',
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** `0..255` components to `#rrggbb`. Clamped, so a float hue cannot emit `#ff00-1`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (value: number) => clamp255(value).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * The same colour as an `rgba()` fill. The histogram composites three channel
 * areas with `globalCompositeOperation = 'lighter'`, so it needs an alpha and a
 * stroke does not — deriving the fill from the stroke is what keeps the two from
 * being re-picked apart.
 */
export function curveChannelFill(channel: CurveChannel, alpha: number): string {
  const hex = TONAL_CURVE_COLORS[channel]
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function identityLut(): Uint8Array {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i += 1) lut[i] = i
  return lut
}

function normalizePoints(points: CurvePoint[]): CurvePoint[] {
  const sorted = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: point.x, y: point.y }))
    .sort((a, b) => a.x - b.x)

  const deduped: CurvePoint[] = []
  for (const point of sorted) {
    const last = deduped[deduped.length - 1]
    if (last && last.x === point.x) deduped[deduped.length - 1] = point
    else deduped.push(point)
  }
  return deduped
}

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson). Control points are
 * sorted and deduped by x; with fewer than two points the curve is the
 * identity. Output values are rounded and clamped to 0..255.
 */
export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  const pts = normalizePoints(points)
  if (pts.length < 2) return identityLut()

  const n = pts.length
  const delta = new Array<number>(n - 1)
  for (let i = 0; i < n - 1; i += 1) {
    delta[i] = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x)
  }

  const m = new Array<number>(n).fill(0)
  m[0] = delta[0]
  m[n - 1] = delta[n - 2]
  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) m[i] = 0
    else m[i] = (delta[i - 1] + delta[i]) / 2
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (delta[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
    } else {
      const alpha = m[i] / delta[i]
      const beta = m[i + 1] / delta[i]
      const strength = alpha * alpha + beta * beta
      if (strength > 9) {
        const tau = 3 / Math.sqrt(strength)
        m[i] = tau * alpha * delta[i]
        m[i + 1] = tau * beta * delta[i]
      }
    }
  }

  const lut = new Uint8Array(256)
  const first = pts[0]
  const last = pts[n - 1]
  let segment = 0

  for (let x = 0; x < 256; x += 1) {
    while (segment < n - 2 && x > pts[segment + 1].x) segment += 1

    let y: number
    if (x <= first.x) {
      y = first.y + m[0] * (x - first.x)
    } else if (x >= last.x) {
      y = last.y + m[n - 1] * (x - last.x)
    } else {
      const x0 = pts[segment].x
      const x1 = pts[segment + 1].x
      const h = x1 - x0
      const t = (x - x0) / h
      const t2 = t * t
      const t3 = t2 * t
      const h00 = 2 * t3 - 3 * t2 + 1
      const h10 = t3 - 2 * t2 + t
      const h01 = -2 * t3 + 3 * t2
      const h11 = t3 - t2
      y =
        h00 * pts[segment].y +
        h10 * h * m[segment] +
        h01 * pts[segment + 1].y +
        h11 * h * m[segment + 1]
    }

    lut[x] = Math.max(0, Math.min(255, Math.round(y)))
  }

  return lut
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  const lut = buildCurveLut(points)
  for (let i = 0; i < 256; i += 1) {
    if (lut[i] !== i) return false
  }
  return true
}

export function buildChannelLuts(curves: Curves): {
  rgb: Uint8Array
  r: Uint8Array
  g: Uint8Array
  b: Uint8Array
} {
  return {
    rgb: buildCurveLut(curves.rgb),
    r: buildCurveLut(curves.r),
    g: buildCurveLut(curves.g),
    b: buildCurveLut(curves.b),
  }
}

const CHANNELS = ['rgb', 'r', 'g', 'b'] as const

export function curvesAreIdentity(curves: Curves): boolean {
  return CHANNELS.every((channel) => isIdentityCurve(curves[channel]))
}

export function applyLut(value: number, lut: Uint8Array): number {
  const index = Math.max(0, Math.min(255, Math.round(value)))
  return lut[index]
}
