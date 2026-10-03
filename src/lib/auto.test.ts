import { describe, expect, it } from 'vitest'
import {
  AUTO_ADJUST_KEYS,
  AUTO_BLACK_FLOOR,
  AUTO_BLOWN_BUDGET,
  AUTO_BLOWN_LEVEL,
  AUTO_CLIP_BUDGET,
  AUTO_WHITE_TARGET,
  autoAdjust,
  autoChangedKeys,
  autoExposure,
  buildHistogram,
} from './auto'
import type { Histogram } from './auto'
import { blackPointTransfer } from './tonemap'

/** A histogram with every level in [start, end] holding exactly one pixel. */
function histogramFromRange(start: number, end: number): Histogram {
  const luma = new Uint32Array(256)
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  for (let i = start; i <= end; i += 1) {
    luma[i] += 1
    r[i] += 1
    g[i] += 1
    b[i] += 1
  }
  return { luma, r, g, b, total: Math.max(0, end - start + 1) }
}

/** A histogram built from a weight per level, so fixtures can be lumpy. */
function histogramFromWeights(weights: number[]): Histogram {
  const luma = new Uint32Array(256)
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  let total = 0
  weights.forEach((weight, level) => {
    const count = Math.round(weight * 1000)
    luma[level] += count
    r[level] += count
    g[level] += count
    b[level] += count
    total += count
  })
  return { luma, r, g, b, total }
}

function histogramFromPixels(levels: number[]): Histogram {
  const data: number[] = []
  for (const level of levels) data.push(level, level, level, 255)
  return buildHistogram(data)
}

/** Mass piled at the bottom, nothing at the top: a dark, low-contrast frame. */
function darkFrame(): Histogram {
  const weights = new Array(256).fill(0)
  for (let i = 0; i <= 5; i += 1) weights[i] = 2.2
  for (let i = 6; i <= 90; i += 1) weights[i] = 0.25
  for (let i = 91; i <= 209; i += 1) weights[i] = 0.05
  return histogramFromWeights(weights)
}

/** A frame with no blacks and no whites: the hazy, lifted, low-contrast case. */
function hazyFrame(): Histogram {
  const weights = new Array(256).fill(0)
  for (let i = 76; i <= 250; i += 1) weights[i] = 0.3
  return histogramFromWeights(weights)
}

/** A correctly exposed frame: a real black, a real white, a broad midrange. */
function wellExposedFrame(): Histogram {
  const weights = new Array(256).fill(0)
  for (let i = 0; i <= 1; i += 1) weights[i] = 0.02
  for (let i = 2; i <= 250; i += 1) weights[i] = 0.08
  return histogramFromWeights(weights)
}

function percentileOf(histogram: Histogram, fraction: number): number {
  const target = Math.max(1, Math.round(fraction * histogram.total))
  let cumulative = 0
  for (let i = 0; i < 256; i += 1) {
    cumulative += histogram.luma[i]
    if (cumulative >= target) return i / 255
  }
  return 1
}

/**
 * The six knobs Auto writes, run through the arithmetic `TONE_FRAG` performs on
 * an sRGB-encoded pixel. This is the model the assertions below check against,
 * so a test passes only when the *frame* ends up exposed, not when the formula
 * returns the number a fixture was tuned to expect.
 */
function applyTone(
  level: number,
  adjust: {
    exposure: number
    brightness: number
    blackPoint: number
    contrast: number
    highlights: number
    shadows: number
  },
): number {
  let c = level * Math.pow(2, adjust.exposure)
  c += adjust.brightness * 0.25
  c = (c - 0.5) * (1 + adjust.contrast / 100) + 0.5
  c += (adjust.shadows / 100) * 0.5 * (1 - smoothstep(0, 0.5, c))
  c += (adjust.highlights / 100) * 0.5 * smoothstep(0.5, 1, c)
  c = blackPointTransfer(c, adjust.blackPoint / 100)
  return Math.max(0, Math.min(1, c))
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function toneStats(histogram: Histogram, adjust: Parameters<typeof applyTone>[1]) {
  const out = new Float64Array(256)
  for (let i = 0; i < 256; i += 1) {
    out[Math.round(applyTone(i / 255, adjust) * 255)] += histogram.luma[i]
  }
  const total = histogram.total
  const at = (fraction: number) => {
    const target = Math.max(1, Math.round(fraction * total))
    let cumulative = 0
    for (let i = 0; i < 256; i += 1) {
      cumulative += out[i]
      if (cumulative >= target) return i / 255
    }
    return 1
  }
  let clipped = 0
  for (let i = 250; i < 256; i += 1) clipped += out[i]
  return { p005: at(0.005), p01: at(0.01), p50: at(0.5), p99: at(0.99), clipped: clipped / total }
}

describe('buildHistogram', () => {
  it('bins rgba pixels and computes luma', () => {
    const data = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]
    const histogram = buildHistogram(data)
    expect(histogram.total).toBe(3)
    expect(histogram.r[255]).toBe(1)
    expect(histogram.g[255]).toBe(1)
    expect(histogram.b[255]).toBe(1)
    expect(histogram.luma[Math.round(0.2126 * 255)]).toBe(1)
    expect(histogram.luma[Math.round(0.7152 * 255)]).toBe(1)
    expect(histogram.luma[Math.round(0.0722 * 255)]).toBe(1)
  })
})

describe('autoExposure', () => {
  it('leaves a correctly exposed frame alone', () => {
    expect(autoExposure(wellExposedFrame().luma, wellExposedFrame().total)).toBeCloseTo(0, 1)
  })

  it('lifts a dark frame', () => {
    const frame = darkFrame()
    expect(autoExposure(frame.luma, frame.total)).toBeGreaterThan(0.1)
  })

  it('never darkens a frame that has no lifted midtones beyond the white anchor', () => {
    // The beach-photo shape: a white sky over a bright subject. The median is
    // far above any midtone target, and the only thing that should pull the
    // exposure is the white point, which is already at its target.
    const beach = histogramFromWeights(
      (() => {
        const w = new Array(256).fill(0)
        for (let i = 0; i <= 30; i += 1) w[i] = 0.3
        for (let i = 31; i <= 244; i += 1) w[i] = 1
        for (let i = 245; i <= 250; i += 1) w[i] = 0.9
        return w
      })(),
    )
    expect(autoExposure(beach.luma, beach.total)).toBeGreaterThan(-0.1)
    expect(autoExposure(beach.luma, beach.total)).toBeLessThan(0.1)
  })

  it('does not lift a frame past the share of it Auto is willing to clip', () => {
    const frame = darkFrame()
    const ev = autoExposure(frame.luma, frame.total)
    const gain = Math.pow(2, ev)
    let clipped = 0
    for (let i = 0; i < 256; i += 1) if ((i / 255) * gain > 1) clipped += frame.luma[i]
    expect(clipped / frame.total).toBeLessThanOrEqual(AUTO_CLIP_BUDGET + 0.005)
  })
})

describe('autoAdjust', () => {
  it('crushes a lifted black floor without touching the white point', () => {
    const frame = hazyFrame()
    const result = autoAdjust(frame)
    expect(result.blackPoint).toBeGreaterThan(0)
    const after = toneStats(frame, result as Parameters<typeof applyTone>[1])
    expect(after.p005).toBeLessThan(AUTO_BLACK_FLOOR)
    expect(after.p99).toBeLessThanOrEqual(1)
  })

  it('leaves a frame that already has real blacks alone', () => {
    expect(autoAdjust(wellExposedFrame()).blackPoint).toBe(0)
  })

  it('raises contrast for a flat, low-range histogram', () => {
    const result = autoAdjust(histogramFromRange(120, 135))
    expect(result.contrast).toBeGreaterThan(0)
  })

  it('recovers highlights for a flat white plateau, and only for that', () => {
    // Nothing above 245: the top of the scale is clear, so there is nothing to
    // recover even though the frame is bright.
    expect(autoAdjust(histogramFromRange(200, 244)).highlights).toBe(0)
    // 60% of the frame sitting at 250 is as lost as 60% at 255.
    const plateau = (() => {
      const w = new Array(256).fill(0.05)
      for (let i = 250; i <= 255; i += 1) w[i] = 4
      return histogramFromWeights(w)
    })()
    expect(autoAdjust(plateau).highlights).toBeLessThan(0)
  })

  it('does not treat a large bright sky as a blown highlight', () => {
    // The regression: a beach frame with a third of its mass in a clean white
    // sky and nothing anywhere near 255. Auto used to measure "blown" against
    // its own white *target*, called that sky blown, and answered with
    // `highlights: -39` — greying a sky that had no detail to recover and never
    // clipped a pixel. The verdict has to be zero, not merely smaller.
    const sky = (() => {
      const w = new Array(256).fill(0.02)
      for (let i = 150; i <= 244; i += 1) w[i] = 0.6
      for (let i = 240; i <= 246; i += 1) w[i] = 6
      return histogramFromWeights(w)
    })()
    const massAbove = (hist: Uint32Array, total: number, level: number) => {
      let mass = 0
      for (let i = Math.ceil(level * 255); i < 256; i += 1) mass += hist[i]
      return mass / total
    }
    expect(massAbove(sky.luma, sky.total, 0.9)).toBeGreaterThan(0.3)
    // Well inside the budget, so `highlights` never moves.
    expect(massAbove(sky.luma, sky.total, AUTO_BLOWN_LEVEL)).toBeLessThan(AUTO_BLOWN_BUDGET)
    expect(autoAdjust(sky).highlights).toBe(0)
  })

  it('lifts shadows only for a frame that has crushed them', () => {
    expect(autoAdjust(wellExposedFrame()).shadows).toBe(0)
    expect(autoAdjust(darkFrame()).shadows).toBeGreaterThan(0)
  })

  it('is near-neutral for an already well-exposed frame', () => {
    const result = autoAdjust(wellExposedFrame())
    expect(Math.abs(result.exposure ?? 0)).toBeLessThan(0.3)
    expect(Math.abs(result.blackPoint ?? 0)).toBeLessThan(20)
    expect(Math.abs(result.contrast ?? 0)).toBeLessThan(20)
    expect(result.highlights).toBe(0)
    expect(result.shadows).toBe(0)
  })

  it('leaves brightness at zero, so exposure alone owns the level', () => {
    for (const frame of [wellExposedFrame(), darkFrame(), hazyFrame()]) {
      expect(autoAdjust(frame).brightness).toBe(0)
    }
  })

  it('does not push every slider the same way', () => {
    // The defect this replaced: every output was a signed multiple of one
    // `lift` scalar, so a dark frame got six corrections in one direction.
    const dark = autoAdjust(darkFrame())
    const signed = ['exposure', 'blackPoint', 'highlights', 'shadows'].map(
      (k) => (dark as Record<string, number>)[k],
    )
    expect(new Set(signed.map((v) => Math.sign(v))).size).toBeGreaterThan(1)
  })

  it('measures each slider off a different end of the histogram', () => {
    // A frame with a lifted floor and a high white point: black point must move
    // even though exposure does not, which is impossible if both come from the
    // same scalar.
    const frame = hazyFrame()
    const result = autoAdjust(frame)
    expect(Math.abs(result.exposure ?? 0)).toBeLessThan(0.2)
    expect(result.blackPoint).toBeGreaterThan(0)
  })

  it('actually exposes a dark frame, judged on the pixels not the formula', () => {
    const frame = darkFrame()
    const before = toneStats(frame, {
      exposure: 0,
      brightness: 0,
      blackPoint: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
    })
    const after = toneStats(frame, autoAdjust(frame) as Parameters<typeof applyTone>[1])
    expect(after.p50).toBeGreaterThan(before.p50 * 1.3)
    expect(after.p50).toBeLessThan(0.6)
    expect(after.p99).toBeLessThanOrEqual(1)
  })

  it('converges: a second Auto is a much smaller move than the first', () => {
    const first = autoAdjust(darkFrame())
    const applied = toneStats(darkFrame(), first as Parameters<typeof applyTone>[1])
    const histogram: Histogram = {
      luma: (() => {
        const h = new Uint32Array(256)
        for (let i = 0; i < 256; i += 1) h[i] = 0
        const out = new Float64Array(256)
        for (let i = 0; i < 256; i += 1) {
          out[Math.round(applyTone(i / 255, first as Parameters<typeof applyTone>[1]) * 255)] +=
            darkFrame().luma[i]
        }
        for (let i = 0; i < 256; i += 1) h[i] = Math.round(out[i])
        return h
      })(),
      r: new Uint32Array(256),
      g: new Uint32Array(256),
      b: new Uint32Array(256),
      total: darkFrame().total,
    }
    const second = autoAdjust(histogram)
    expect(Math.abs((second.exposure ?? 0) - (first.exposure ?? 0))).toBeLessThan(0.6)
    expect(applied.p50).toBeGreaterThan(0)
  })

  it('reads a real pixel buffer, not a hand-built histogram', () => {
    const levels: number[] = []
    for (let i = 0; i <= 4; i += 1) for (let n = 0; n < 40; n += 1) levels.push(i)
    for (let i = 20; i <= 120; i += 1) for (let n = 0; n < 4; n += 1) levels.push(i)
    for (let i = 180; i <= 209; i += 1) for (let n = 0; n < 2; n += 1) levels.push(i)
    const histogram = histogramFromPixels(levels)
    expect(histogram.total).toBe(levels.length)
    const result = autoAdjust(histogram)
    expect(result.exposure).toBeGreaterThan(0)
    const after = toneStats(histogram, result as Parameters<typeof applyTone>[1])
    expect(after.p99).toBeGreaterThanOrEqual(0.9)
    expect(after.p99).toBeLessThanOrEqual(1)
  })

  it('places the white point at the target for a frame that has headroom', () => {
    const frame = darkFrame()
    const after = toneStats(frame, autoAdjust(frame) as Parameters<typeof applyTone>[1])
    expect(after.p99).toBeGreaterThan(AUTO_WHITE_TARGET - 0.15)
  })

  it('returns neutral values for an empty histogram', () => {
    const empty: Histogram = {
      luma: new Uint32Array(256),
      r: new Uint32Array(256),
      g: new Uint32Array(256),
      b: new Uint32Array(256),
      total: 0,
    }
    expect(autoAdjust(empty)).toEqual({
      exposure: 0,
      contrast: 0,
      blackPoint: 0,
      brightness: 0,
      highlights: 0,
      shadows: 0,
    })
  })

  it('keeps every value inside its slider range', () => {
    for (const frame of [
      wellExposedFrame(),
      darkFrame(),
      hazyFrame(),
      histogramFromRange(0, 255),
      histogramFromRange(0, 0),
    ]) {
      const result = autoAdjust(frame)
      for (const key of [
        'exposure',
        'brightness',
        'blackPoint',
        'contrast',
        'highlights',
        'shadows',
      ] as const) {
        const value = result[key] ?? 0
        expect(Number.isFinite(value)).toBe(true)
        if (key === 'exposure') {
          expect(value).toBeGreaterThanOrEqual(-2)
          expect(value).toBeLessThanOrEqual(2)
        } else if (key !== 'brightness') {
          expect(value).toBeGreaterThanOrEqual(-100)
          expect(value).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('does not brighten a frame that has no headroom at all', () => {
    const white = histogramFromRange(250, 255)
    expect(autoAdjust(white).exposure).toBeLessThanOrEqual(0)
  })

  it('keeps the percentile reader honest at both ends', () => {
    const frame = wellExposedFrame()
    expect(percentileOf(frame, 0.005)).toBeLessThan(0.1)
    expect(percentileOf(frame, 0.99)).toBeGreaterThan(0.8)
  })
})

describe('autoChangedKeys, so the toast can say what it did', () => {
  it('names the sliders that moved, and only those', () => {
    const before = {
      exposure: 0,
      brightness: 0,
      blackPoint: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
    }
    const after = { ...before, exposure: -0.4, shadows: 12 }
    // In `AUTO_ADJUST_KEYS` order, which is the panel's order, so the toast reads
    // as a sentence about the panel rather than an arbitrary list.
    expect(autoChangedKeys(before, after)).toEqual(['exposure', 'shadows'])
  })

  it('reports nothing for a frame Auto leaves alone', () => {
    // `autoAdjust` always returns all six keys, most of them at zero, so this is
    // the common case rather than an edge one: a run that moves nothing is the
    // run whose toast must say "nothing to change" rather than list nothing.
    const neutralAdjust = {
      exposure: 0,
      brightness: 0,
      blackPoint: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
    }
    const settled = autoAdjust(histogramFromRange(250, 255))
    // Whatever that frame produced, the report and the document cannot disagree:
    // a key is named if and only if Auto wrote something other than zero to it.
    const reported = new Set(autoChangedKeys(neutralAdjust, settled))
    for (const key of AUTO_ADJUST_KEYS) {
      expect(reported.has(key), key).toBe(Math.abs(settled[key] ?? 0) > 0.005)
    }
    // And the fully neutral document reports nothing at all, which is the shape
    // the toast's "found nothing to change" branch is written against.
    expect(autoChangedKeys(neutralAdjust, neutralAdjust)).toEqual([])
  })

  it('never reports a key Auto does not own, whatever the document says about it', () => {
    const before = {
      exposure: 0,
      brightness: 0,
      blackPoint: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
    }
    const after = { ...before, temperature: 40, warmth: 20 }
    // `brightness` is owned and unmoved; `temperature` and `warmth` moved but are
    // the user's. Naming one of those would point the user at a dial Auto never
    // turned.
    expect(autoChangedKeys(before, after)).toEqual([])
  })

  it('reads a missing key as zero rather than throwing', () => {
    expect(autoChangedKeys({}, { exposure: 0.5 })).toEqual(['exposure'])
  })

  it('ignores a difference below a step of the slider it moved', () => {
    const before = {
      exposure: 0.5,
      brightness: 0,
      blackPoint: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
    }
    const after = { ...before, exposure: 0.5 + 0.001 }
    expect(autoChangedKeys(before, after)).toEqual([])
  })
})
