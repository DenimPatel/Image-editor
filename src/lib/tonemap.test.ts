import { describe, expect, it } from 'vitest'
import {
  BLACK_POINT_STRENGTH,
  DITHER_LSB,
  LUMA_WEIGHTS,
  SHOULDER_HEADROOM,
  SHOULDER_KNEE,
  blackPointTransfer,
  ditherOffsetLsb,
  ditherThreshold,
  filmicShoulder,
  whiteBalance,
} from './tonemap'

function sweep(blackPoint: number): number[] {
  const values: number[] = []
  for (let i = 0; i <= 100; i += 1) values.push(blackPointTransfer(i / 100, blackPoint))
  return values
}

describe('blackPointTransfer', () => {
  it('crushes the blacks when raised', () => {
    expect(blackPointTransfer(0.02, 1)).toBeLessThan(0.02)
    expect(blackPointTransfer(0.2, 1)).toBeLessThan(0.2)
    expect(blackPointTransfer(0.02, 0.5)).toBeLessThan(blackPointTransfer(0.02, 0))
  })

  it('lifts the blacks when lowered', () => {
    expect(blackPointTransfer(0.02, -1)).toBeGreaterThan(0.02)
    expect(blackPointTransfer(0.2, -1)).toBeGreaterThan(0.2)
    expect(blackPointTransfer(0.02, -0.5)).toBeGreaterThan(blackPointTransfer(0.02, 0))
  })

  it('leaves the image untouched at neutral', () => {
    expect(blackPointTransfer(0.42, 0)).toBeCloseTo(0.42, 12)
  })

  it('is monotonically increasing everywhere in the slider range', () => {
    for (const blackPoint of [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]) {
      const curve = sweep(blackPoint)
      for (let i = 1; i < curve.length; i += 1) {
        expect(curve[i]!).toBeGreaterThan(curve[i - 1]!)
      }
    }
  })

  it('keeps white a fixed point and pushes black the right way', () => {
    for (const blackPoint of [-1, -0.5, 0, 0.5, 1]) {
      expect(blackPointTransfer(1, blackPoint)).toBeCloseTo(1, 12)
      const black = blackPointTransfer(0, blackPoint)
      if (blackPoint > 0) expect(black).toBeLessThanOrEqual(0)
      if (blackPoint < 0) expect(black).toBeGreaterThan(0)
    }
  })

  it('scales by the strength constant the shader uses', () => {
    expect(blackPointTransfer(1, 1)).toBeCloseTo(
      (1 - BLACK_POINT_STRENGTH) / (1 - BLACK_POINT_STRENGTH),
      12,
    )
    expect(blackPointTransfer(0, 1)).toBeCloseTo(
      -BLACK_POINT_STRENGTH / (1 - BLACK_POINT_STRENGTH),
      12,
    )
  })
})

// --- D4-F07: decorrelated white balance ---------------------------------------

type Rgb = readonly [number, number, number]

function lumaOf(rgb: Rgb): number {
  return LUMA_WEIGHTS[0] * rgb[0] + LUMA_WEIGHTS[1] * rgb[1] + LUMA_WEIGHTS[2] * rgb[2]
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1))
  return t * t * (3 - 2 * t)
}

/** Hue in degrees, the way HSV defines it. */
function hueDegrees(rgb: Rgb): number {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 1e-9) return 0
  let h: number
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

/** Signed rotation from `from` to `to`, folded into 0..180. */
function hueShift(from: number, to: number): number {
  const d = Math.abs(from - to) % 360
  return d > 180 ? 360 - d : d
}

/** The luma delta the shadows slider asks for, the same weight TONE_FRAG uses. */
function shadowDelta(rgb: Rgb, shadows: number): number {
  return shadows * 0.5 * (1 - smoothstep(0, 0.5, lumaOf(rgb)))
}

/**
 * The implementation D4-F07 replaced: one scalar added to all three channels.
 * Kept in the test as the control, because "the new one preserves the hue" is
 * only evidence of anything next to what the old one did to it.
 */
function uniformAdd(rgb: Rgb, delta: number): Rgb {
  return rgb.map((c) => clamp01(c + delta)) as unknown as Rgb
}

describe('whiteBalance (D4-F07)', () => {
  it('lifts a pure grey back to pure grey', () => {
    // Below luma 0.5 only: the shadows weight is a smoothstep that reaches
    // zero there, so a mid grey is asked for no lift at all.
    for (const level of [0.05, 0.2, 0.3, 0.45]) {
      const grey: Rgb = [level, level, level]
      const out = whiteBalance(grey, lumaOf(grey), shadowDelta(grey, 1))
      expect(out[0]).toBeCloseTo(out[1], 12)
      expect(out[1]).toBeCloseTo(out[2], 12)
      // and it really did something, or this would pass for a no-op
      expect(out[0]).toBeGreaterThan(level)
    }
  })

  it('keeps the hue of a saturated colour whose shadows are lifted', () => {
    // A blue sky, which is where this was caught. At +1 the old code pushed a
    // channel past 1, the clamp took it, the channel differences stopped being
    // what they were, and the pixel came out 4 degrees closer to violet.
    const sky: Rgb = [0, 0.1, 1]
    const out = whiteBalance(sky, lumaOf(sky), shadowDelta(sky, 1))
    expect(hueShift(hueDegrees(sky), hueDegrees(out))).toBeLessThan(0.5)
    // The control: the same lift written as one scalar on all three channels.
    const before = hueShift(hueDegrees(sky), hueDegrees(uniformAdd(sky, shadowDelta(sky, 1))))
    expect(before).toBeCloseTo(4, 1)
  })

  it('keeps the hue across a spread of saturated colours', () => {
    const samples: Rgb[] = [
      [0.8, 0.4, 0],
      [0.65, 0.33, 0.04],
      [0.1, 0.2, 0.45],
      [0, 0.1, 1],
      [0.2, 0.3, 0.95],
      [0.9, 0.1, 0.2],
      [0.15, 0.75, 0.35],
    ]
    for (const rgb of samples) {
      for (const shadows of [0.5, 1]) {
        const out = whiteBalance(rgb, lumaOf(rgb), shadowDelta(rgb, shadows))
        expect(
          hueShift(hueDegrees(rgb), hueDegrees(out)),
          `${rgb} at shadows=${shadows}`,
        ).toBeLessThan(0.5)
      }
    }
  })

  it('keeps the hue when the highlights are recovered, not just lifted', () => {
    // The opposite direction, on a pixel bright enough for the highlights
    // weight to be non-zero at all.
    const lit: Rgb[] = [
      [0.7, 0.5, 0.4],
      [0.6, 0.5, 0.45],
      [0.55, 0.5, 0.5],
    ]
    for (const rgb of lit) {
      const delta = -1 * 0.5 * smoothstep(0.5, 1, lumaOf(rgb))
      expect(delta).toBeLessThan(0)
      const out = whiteBalance(rgb, lumaOf(rgb), delta)
      expect(hueShift(hueDegrees(rgb), hueDegrees(out)), `${rgb}`).toBeLessThan(0.5)
    }
  })

  it('crushes to black rather than inverting a colour it cannot pull down', () => {
    // Asking to remove more luma than the pixel has has one honest answer, and
    // it is not a negative gain. Black has no hue to preserve.
    const dark: Rgb = [0.1, 0.1, 0.1]
    const delta = shadowDelta(dark, -1)
    expect(delta).toBeLessThan(-lumaOf(dark))
    expect(whiteBalance(dark, lumaOf(dark), delta)).toEqual([0, 0, 0])
  })

  it('moves luma by exactly what was asked and spends no more energy', () => {
    // The claim the proportional gain buys: the step is an exposure change and
    // nothing else, so the luma it delivers is the luma it was asked for.
    const samples: Rgb[] = [
      [0.3, 0.4, 0.5],
      [0.1, 0.1, 0.1],
      [0.8, 0.7, 0.6],
      [0.05, 0.3, 0.5],
    ]
    // Lifts only - a delta past the pixel's own luma is refused, not half-served.
    for (const rgb of samples) {
      for (const shadows of [0.5, 1]) {
        const delta = shadowDelta(rgb, shadows)
        const out = whiteBalance(rgb, lumaOf(rgb), delta)
        expect(lumaOf(out) - lumaOf(rgb), `${rgb} at shadows=${shadows}`).toBeCloseTo(delta, 12)
      }
    }
  })

  it('never pushes a channel out of gamut, and never darkens a lift', () => {
    for (const rgb of [
      [0, 0.1, 1],
      [0.9, 0.1, 0.2],
      [1, 1, 1],
      [0.5, 0.5, 0.5],
    ] as Rgb[]) {
      const out = whiteBalance(rgb, lumaOf(rgb), 1)
      expect(Math.max(...out)).toBeLessThanOrEqual(1 + 1e-12)
      // A lift that will not fit is refused, not paid for out of the pixel.
      expect(lumaOf(out)).toBeGreaterThanOrEqual(lumaOf(rgb))
    }
  })

  it('is an exact pass-through at zero', () => {
    // A neutral `delta` must be the identity, including on a blown pixel: the
    // gamut cap is a cap on the *push*, and a cap that also scaled things down
    // would quietly normalise every highlight before the shoulder saw it.
    for (const rgb of [
      [0.5, 0.5, 0.5],
      [1.5, 1.2, 0.9],
      [0, 0, 0],
    ] as Rgb[]) {
      expect(whiteBalance(rgb, lumaOf(rgb), 0)).toEqual(rgb)
    }
  })
})

// --- D3-F23: the output transfer ----------------------------------------------

describe('filmicShoulder (D3-F23)', () => {
  it('is monotonically increasing across the whole range', () => {
    let previous = filmicShoulder(0)
    for (let i = 1; i <= 20000; i += 1) {
      const value = filmicShoulder((i / 20000) * 3)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('leaves everything at or below full scale bit for bit alone', () => {
    for (const value of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
      expect(filmicShoulder(value)).toBe(value)
    }
  })

  it('puts pure white at pure white, exactly', () => {
    // The bug this curve shipped with: the knee sat at 0.86, so the exponential
    // arrived at 0.9485 and a white pixel left the tone stage as 242. `toBe`, not
    // `toBeCloseTo` — the arms agree at the knee only if `1 - exp(0)` is exactly
    // zero, and a 1e-7 of shortfall is 0.0000255 of a byte.
    expect(filmicShoulder(0)).toBe(0)
    expect(filmicShoulder(1)).toBe(1)
    expect(Math.round(filmicShoulder(1) * 255)).toBe(255)
    expect(SHOULDER_KNEE).toBe(1)
  })

  it('never dims a value the user can still see detail in', () => {
    // The whole contract in one sweep: below the knee the curve is the identity,
    // so nothing in [0, 1] is darkened by even a fraction of a level.
    for (let i = 0; i <= 99; i += 1) {
      const value = i / 100
      const out = filmicShoulder(value)
      expect(out, `dimmed ${value}`).toBeGreaterThanOrEqual(value)
      expect(value - out, `dimmed ${value}`).toBeLessThan(1 / 255)
    }
  })

  it('has no flat top where a hard clip does', () => {
    // `min(x, 1)` is flat from the first pixel that reaches 1; this keeps
    // climbing, so a ramp still resolves to a new level as it approaches white.
    expect(filmicShoulder(0.99)).toBeLessThan(filmicShoulder(1))
    expect(filmicShoulder(1)).toBeLessThan(filmicShoulder(1.5))
    expect(filmicShoulder(1.5)).toBeLessThan(filmicShoulder(2))
    // And the clip it replaces really is flat there, which is what makes the
    // comparison above worth making.
    expect(Math.min(1, 1)).toBe(Math.min(1, 1.5))
    expect(filmicShoulder(1)).not.toBe(filmicShoulder(1.5))
    const levels = new Set<number>()
    for (let i = 0; i <= 2000; i += 1) {
      levels.add(Math.round(filmicShoulder(0.9 + (i / 2000) * 0.1) * 255))
    }
    expect(levels.size).toBeGreaterThan(10)
  })

  it('separates highlights that a clamp would have merged into one', () => {
    // The point of the whole curve: 1.05 and 4.0 were the same pixel before.
    const ramp = [0.9, 1.0, 1.25, 1.5, 2, 3]
    const shouldered = ramp.map(filmicShoulder)
    const clipped = ramp.map((value) => Math.min(1, value))
    expect(new Set(shouldered).size).toBe(new Set(ramp).size)
    expect(new Set(clipped).size).toBeLessThan(new Set(ramp).size)
    for (let i = 1; i < ramp.length; i += 1) {
      expect(shouldered[i]!).toBeGreaterThan(shouldered[i - 1]!)
    }
  })

  it('still compresses the blown range instead of clipping it flat', () => {
    // Every value above full scale is pulled *down* — the rolloff is doing the
    // work a clamp does — while staying above 1, so the blowout is not merely
    // rescaled to land on white and stop.
    for (const value of [1.01, 1.25, 1.5, 2, 4, 64, 1024]) {
      expect(filmicShoulder(value), `${value} is not compressed`).toBeLessThan(value)
    }
    expect(filmicShoulder(2)).toBeGreaterThan(filmicShoulder(1.5))
    expect(filmicShoulder(1.5)).toBeGreaterThan(filmicShoulder(1.25))
    expect(filmicShoulder(1.25)).toBeGreaterThan(1)
  })

  it('cannot push a pixel further out of gamut', () => {
    // The curve may leave a blown pixel above 1 — it has to, to stay monotonic —
    // but never above its own headroom, so the clamp at the end of the pass is a
    // formality rather than the thing holding the range together.
    for (const value of [1, 1.5, 4, 64, 1024]) {
      expect(filmicShoulder(value)).toBeLessThanOrEqual(1 + SHOULDER_HEADROOM)
      expect(filmicShoulder(value)).toBeLessThanOrEqual(Math.max(1, value))
    }
  })
})

describe('dither (D3-F23)', () => {
  it('is an ordered 8x8 matrix, not noise', () => {
    const seen = new Set<number>()
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) seen.add(Math.round(ditherThreshold(x, y) * 64 - 0.5))
    }
    // Every one of the 64 thresholds appears exactly once: a permutation, so
    // the error is dispersed rather than scattered.
    expect(seen.size).toBe(64)
    for (let x = 1; x < 8; x += 1) {
      expect(ditherThreshold(x, 0)).not.toBe(ditherThreshold(x - 1, 0))
    }
  })

  it('is centred and spans one level in each direction at full amplitude', () => {
    let min = Infinity
    let max = -Infinity
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const offset = ditherOffsetLsb(x, y, DITHER_LSB)
        min = Math.min(min, offset)
        max = Math.max(max, offset)
      }
    }
    expect(max).toBeLessThanOrEqual(0.5)
    expect(min).toBeGreaterThanOrEqual(-0.5)
    expect(Math.abs(max + min)).toBeLessThan(0.02)
    expect(ditherOffsetLsb(3, 5, 0)).toBe(0)
  })

  it('breaks up a quantised ramp without moving it further than 1.5/255', () => {
    // A smooth gradient across eight byte levels: 256 px, so each band is about
    // 33 px wide and plainly visible. This is the banding-count proof - the
    // distinct output levels have to go up, and the error against the ideal
    // unquantised ramp has to stay inside a level and a half.
    const width = 256
    const rows = 8
    const ideal = (x: number) => 0.3 + (0.33 - 0.3) * (x / (width - 1))
    const measure = (amount: number) => {
      const levels = new Set<number>()
      let maxError = 0
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const want = ideal(x)
          const byte = Math.round(clamp01(want + ditherOffsetLsb(x, y, amount) / 255) * 255)
          levels.add(byte)
          maxError = Math.max(maxError, Math.abs(byte / 255 - want))
        }
      }
      return { levels: levels.size, maxError: maxError * 255 }
    }
    const plain = measure(0)
    const dithered = measure(DITHER_LSB)
    // Before: eight flat bands, one per byte level. After: more levels, and the
    // error is still under one and a half of a byte.
    expect(plain.levels).toBe(8)
    expect(dithered.levels).toBeGreaterThan(plain.levels)
    expect(plain.maxError).toBeLessThanOrEqual(0.5)
    expect(dithered.maxError).toBeLessThanOrEqual(1.5)
  })
})
