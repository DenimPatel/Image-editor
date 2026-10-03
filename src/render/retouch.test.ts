import { describe, expect, it } from 'vitest'
import {
  HEAL_ANGLES,
  HEAL_RINGS,
  RED_EYE_REACH,
  SMOOTH_DIRS,
  SMOOTH_RANGE,
  SMOOTH_REACH,
  healAt,
  luma,
  redEyeAt,
  retouchHalo,
  sampleRgba,
  smoothAt,
  smoothRadius,
  spotWeight,
  type RetouchSource,
  type Rgba,
} from './retouch'

const W = 64
const H = 64

function makeSource(width: number, height: number, shade: (x: number, y: number) => Rgba) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = shade(x, y)
      const at = (y * width + x) * 4
      data[at] = r * 255
      data[at + 1] = g * 255
      data[at + 2] = b * 255
      data[at + 3] = a * 255
    }
  }
  return { width, height, data } satisfies RetouchSource
}

/** 8-bit round trip: the buffer is the only place the values live. */
const STEP = 1 / 255

/** Flat skin at `base` luma with a disc of `level` at the frame's centre. */
function blemishFixture(radius = 4, level = 0.35, base = 0.6): RetouchSource {
  return makeSource(W, H, (x, y) => {
    const d = Math.hypot(x - W / 2, y - H / 2)
    const v = d <= radius ? level : base
    return [v, v, v, 1]
  })
}

function window(src: RetouchSource, cx: number, cy: number, half: number) {
  const values: number[] = []
  for (let y = cy - half; y <= cy + half; y += 1) {
    for (let x = cx - half; x <= cx + half; x += 1) {
      const s = sampleRgba(src, (x + 0.5) / src.width, (y + 0.5) / src.height)
      values.push(luma(s[0], s[1], s[2]))
    }
  }
  return values
}

function stdev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
}

/** A plain box blur of the same radius, for the "a box blur fails this" case. */
function boxBlurAt(src: RetouchSource, u: number, v: number, radius: number): Rgba {
  const out: Rgba = [0, 0, 0, 0]
  const x = Math.floor(u * src.width)
  const y = Math.floor(v * src.height)
  let n = 0
  for (let j = -radius; j <= radius; j += 1) {
    for (let i = -radius; i <= radius; i += 1) {
      const s = sampleRgba(
        src,
        (Math.min(src.width - 1, Math.max(0, x + i)) + 0.5) / src.width,
        (Math.min(src.height - 1, Math.max(0, y + j)) + 0.5) / src.height,
      )
      out[0] += s[0]
      out[1] += s[1]
      out[2] += s[2]
      n += 1
    }
  }
  return [out[0] / n, out[1] / n, out[2] / n, sampleRgba(src, u, v)[3]]
}

// --- sampler ------------------------------------------------------------------

describe('sampleRgba', () => {
  const src = makeSource(4, 4, (x, y) => [x / 3, y / 3, 0, 1])

  it('returns the exact texel at a texel centre', () => {
    const s = sampleRgba(src, 0.125, 0.125)
    expect(s[0]).toBeCloseTo(0, 12)
    expect(s[1]).toBeCloseTo(0, 12)
    const far = sampleRgba(src, 0.875, 0.875)
    expect(far[0]).toBeCloseTo(1, 12)
    expect(far[1]).toBeCloseTo(1, 12)
  })

  it('clamps to the edge outside 0..1 instead of reading garbage', () => {
    const s = sampleRgba(src, -0.5, 1.5)
    expect(s[0]).toBeCloseTo(0, 12)
    expect(s[1]).toBeCloseTo(1, 12)
  })

  it('interpolates between texels', () => {
    const ramp = makeSource(2, 1, (x) => [x, 0, 0, 1])
    const s = sampleRgba(ramp, 0.5, 0.5)
    expect(s[0]).toBeCloseTo(0.5, 6)
  })
})

// --- D1-F13: skin smoothing ---------------------------------------------------

describe('skin smoothing', () => {
  const radius = smoothRadius(1, 1)

  /**
   * The probe window for the edge-preservation tests. It is eight texels from
   * the blemish's centre, so it is flat in the source *and* inside the
   * kernel's 7.2-texel reach: a blur of the same radius genuinely drags the
   * blemish into it, so a bilateral genuinely has to reject it.
   */
  const PROBE = { x: W / 2 + 8, y: H / 2 }

  it('is a no-op at amount 0, and on a flat field at full amount', () => {
    const flat = makeSource(W, H, () => [0.5, 0.5, 0.5, 1])
    expect(Math.abs(smoothAt(flat, 0.5, 0.5, 0, 1)[0] - 0.5)).toBeLessThan(STEP)
    expect(Math.abs(smoothAt(flat, 0.5, 0.5, 1, 1)[0] - 0.5)).toBeLessThan(STEP)
  })

  it('reduces the variance of a low-contrast blemish', () => {
    // A skin smoother's job is tonal irregularity, not a distinct spot: a
    // patch that far from the skin tone is outside the range term by
    // construction, and that is a heal stamp, not this filter.
    const src = blemishFixture(4, 0.52, 0.62)
    const before = stdev(window(src, W / 2, H / 2, 4))
    const out = makeSource(W, H, (x, y) => smoothAt(src, (x + 0.5) / W, (y + 0.5) / H, 1, 1))
    const after = stdev(window(out, W / 2, H / 2, 4))
    expect(before).toBeGreaterThan(0.03)
    expect(after).toBeLessThan(before * 0.6)
  })

  it('leaves a flat region next to the blemish at exactly its own variance', () => {
    // This is the assertion a box blur cannot pass. The probe is flat in the
    // source and inside the kernel's reach, so the blemish is one rejected tap
    // away; a box blur of the same radius averages it straight in.
    const src = blemishFixture()
    expect(stdev(window(src, PROBE.x, PROBE.y, 2))).toBeLessThan(STEP)
    const smoothed = makeSource(W, H, (x, y) => smoothAt(src, (x + 0.5) / W, (y + 0.5) / H, 1, 1))
    expect(stdev(window(smoothed, PROBE.x, PROBE.y, 2))).toBeLessThan(2 * STEP)
  })

  it('and a box blur of the same radius really would have raised it', () => {
    const src = blemishFixture()
    const before = stdev(window(src, PROBE.x, PROBE.y, 2))
    const blurred = makeSource(W, H, (x, y) =>
      boxBlurAt(src, (x + 0.5) / W, (y + 0.5) / H, Math.round(radius)),
    )
    expect(stdev(window(blurred, PROBE.x, PROBE.y, 2))).toBeGreaterThan(before + 0.005)
  })

  it('preserves a step edge, which is the other half of "edge-preserving"', () => {
    // Left half at 0.2, right half at 0.8, a 0.6 luma jump.
    const src = makeSource(W, H, (x) => {
      const v = x < W / 2 ? 0.2 : 0.8
      return [v, v, v, 1]
    })
    const out = makeSource(W, H, (x, y) => smoothAt(src, (x + 0.5) / W, (y + 0.5) / H, 1, 1))
    const before = Math.abs(
      sampleRgba(src, (W / 2 - 4) / W, 0.5)[0] - sampleRgba(src, (W / 2 + 4) / W, 0.5)[0],
    )
    const after = Math.abs(
      sampleRgba(out, (W / 2 - 4) / W, 0.5)[0] - sampleRgba(out, (W / 2 + 4) / W, 0.5)[0],
    )
    // A bilateral keeps nearly all of it; a box blur of the same radius would
    // leave barely a third.
    expect(after).toBeGreaterThan(before * 0.85)
  })

  it('keeps a perfectly flat region within one 8-bit step', () => {
    const flat = makeSource(W, H, () => [0.42, 0.42, 0.42, 1])
    for (let y = 4; y < H; y += 7) {
      for (let x = 4; x < W; x += 7) {
        const s = smoothAt(flat, (x + 0.5) / W, (y + 0.5) / H, 1, 1)
        expect(Math.abs(s[0] - 0.42)).toBeLessThan(STEP)
      }
    }
  })

  it('never touches alpha', () => {
    const src = makeSource(W, H, (x) => [0.5, 0.5, 0.5, x < W / 2 ? 1 : 0.25])
    expect(smoothAt(src, 0.3, 0.5, 1, 1)[3]).toBeCloseTo(1, 6)
    expect(Math.abs(smoothAt(src, 0.8, 0.5, 1, 1)[3] - 0.25)).toBeLessThan(STEP)
  })

  it('scales its kernel radius with the render size', () => {
    expect(smoothRadius(1, 1)).toBe(4)
    expect(smoothRadius(1, 3)).toBe(12)
    expect(smoothRadius(0, 1)).toBe(1)
  })

  it('samples eight directions at two rings each, all within the reach', () => {
    expect(SMOOTH_DIRS).toHaveLength(8)
    expect(SMOOTH_REACH).toBe(4)
    for (const [dx, dy] of SMOOTH_DIRS) expect(Math.hypot(dx, dy)).toBeCloseTo(1, 6)
    // The set is closed under a y flip, which is why the buffer-order and the
    // bottom-up shader sum to the same value.
    const flipped = new Set(SMOOTH_DIRS.map(([dx, dy]) => `${dx},${-dy}`))
    for (const dir of SMOOTH_DIRS) expect(flipped.has(`${dir[0]},${dir[1]}`)).toBe(true)
  })

  it('has a range tolerance inside 0..1', () => {
    expect(SMOOTH_RANGE).toBeGreaterThan(0)
    expect(SMOOTH_RANGE).toBeLessThan(0.5)
  })
})

// --- D1-F13: heal spots -------------------------------------------------------

describe('heal spots', () => {
  it('reduces the local variance at the blemish', () => {
    const src = blemishFixture(4, 0.3)
    const at: [number, number] = [W / 2 / W, H / 2 / H]
    const out = makeSource(W, H, (x, y) =>
      healAt(src, (x + 0.5) / W, (y + 0.5) / H, at, 0.08, H / W),
    )
    const before = stdev(window(src, W / 2, H / 2, 4))
    const after = stdev(window(out, W / 2, H / 2, 4))
    expect(after).toBeLessThan(before * 0.4)
  })

  it('picks the patch from outside the spot, not from inside it', () => {
    // The centre pixel is the darkest; a clone that sampled the spot itself
    // would leave it dark. A clone from the ring at 1.6r sees clean skin.
    const src = blemishFixture(4, 0.2, 0.7)
    const at: [number, number] = [W / 2 / W, H / 2 / H]
    const s = healAt(src, at[0], at[1], at, 0.08, H / W)
    expect(s[0]).toBeGreaterThan(0.5)
  })

  it('leaves everything outside the radius untouched', () => {
    const src = blemishFixture()
    const at: [number, number] = [W / 2 / W, H / 2 / H]
    const far = healAt(src, 0.1, 0.1, at, 0.08, H / W)
    const base = sampleRgba(src, 0.1, 0.1)
    expect(far[0]).toBeCloseTo(base[0], 12)
    expect(far[2]).toBeCloseTo(base[2], 12)
  })

  it('is rotationally symmetric, so one dark neighbour cannot stamp a wedge', () => {
    // A single-source clone picks up exactly this: the dark mark sits just
    // outside the spot, so a clone aimed anywhere near it folds the mark
    // across the whole disc. Averaging the ring leaves the patch skin-coloured.
    const src = makeSource(W, H, (x, y) => {
      const nearMark = Math.abs(x - (W / 2 - 7)) < 2 && Math.abs(y - H / 2) < 2
      return nearMark ? [0.02, 0.02, 0.02, 1] : [0.7, 0.7, 0.7, 1]
    })
    const at: [number, number] = [W / 2 / W, H / 2 / H]
    const out = makeSource(W, H, (x, y) =>
      healAt(src, (x + 0.5) / W, (y + 0.5) / H, at, 0.1, H / W),
    )
    const inside = window(out, W / 2, H / 2, 3)
    const minimum = Math.min(...inside)
    expect(minimum).toBeGreaterThan(0.5)
    expect(stdev(inside)).toBeLessThan(0.05)
  })

  it('samples eight directions over two rings, all outside the spot', () => {
    expect(HEAL_ANGLES).toBe(8)
    expect(HEAL_RINGS).toEqual([1.4, 1.9])
    for (const ring of HEAL_RINGS) expect(ring).toBeGreaterThan(1)
  })

  it('is a no-op for a zero radius', () => {
    const src = blemishFixture()
    const s = healAt(src, 0.5, 0.5, [0.5, 0.5], 0, 1)
    expect(s[0]).toBeCloseTo(sampleRgba(src, 0.5, 0.5)[0], 12)
  })

  it('fades in from 75% of the radius so the seam is invisible', () => {
    const at: [number, number] = [0.5, 0.5]
    expect(spotWeight(0.5, 0.5, at, 0.1, 1, 0.75)).toBe(1)
    expect(spotWeight(0.5 + 0.07, 0.5, at, 0.1, 1, 0.75)).toBe(1)
    expect(spotWeight(0.5 + 0.09, 0.5, at, 0.1, 1, 0.75)).toBeLessThan(0.5)
    expect(spotWeight(0.5 + 0.11, 0.5, at, 0.1, 1, 0.75)).toBe(0)
  })
})

// --- D1-F13: red-eye ----------------------------------------------------------

describe('red-eye', () => {
  const IRIS: Rgba = [0.8, 0.2, 0.2, 1]
  const SCLERA: Rgba = [0.95, 0.95, 0.95, 1]

  function eye(): RetouchSource {
    return makeSource(W, H, (x, y) => {
      const d = Math.hypot(x - W / 2, y - H / 2)
      return d <= 4 ? IRIS : SCLERA
    })
  }

  it('removes most of the red cast from the iris', () => {
    const src = eye()
    const at: [number, number] = [0.5, 0.5]
    const before = sampleRgba(src, at[0], at[1])
    const after = redEyeAt(src, at[0], at[1], at, 0.08, H / W)
    const redness = (p: Rgba) => p[0] - p[2]
    expect(redness(before)).toBeGreaterThan(0.5)
    expect(redness(after)).toBeLessThan(redness(before) * 0.2)
  })

  it('pulls the iris toward the surrounding sclera rather than just greying it', () => {
    const src = eye()
    const at: [number, number] = [0.5, 0.5]
    const after = redEyeAt(src, at[0], at[1], at, 0.08, H / W)
    const sclera = sampleRgba(src, 0.06, 0.5)
    expect(after[0]).toBeGreaterThan(sclera[0] - 0.2)
    expect(after[1]).toBeGreaterThan(0.5)
  })

  it('leaves the sclera alone', () => {
    const src = eye()
    const at: [number, number] = [0.5, 0.5]
    const s = redEyeAt(src, 0.06, 0.5, at, 0.08, H / W)
    const base = sampleRgba(src, 0.06, 0.5)
    expect(s[0]).toBeCloseTo(base[0], 6)
  })

  it('reads the sclera from a ring outside the spot', () => {
    expect(RED_EYE_REACH).toBeGreaterThan(1)
    expect(RED_EYE_REACH).toBeLessThan(3)
  })

  it('is a no-op for a zero radius', () => {
    const src = eye()
    const s = redEyeAt(src, 0.5, 0.5, [0.5, 0.5], 0, 1)
    expect(s[0]).toBeCloseTo(sampleRgba(src, 0.5, 0.5)[0], 12)
  })
})

describe('retouchHalo', () => {
  it('is zero for an untouched document', () => {
    expect(retouchHalo(0, 0, 1)).toBe(0)
  })

  it('covers the smoothing reach', () => {
    expect(retouchHalo(1, 0, 1)).toBeGreaterThanOrEqual(
      Math.ceil(smoothRadius(1, 1) * SMOOTH_REACH),
    )
  })

  it('covers a heal spot stamped from outside itself', () => {
    expect(retouchHalo(0, 0.1, 1)).toBeGreaterThanOrEqual(1)
  })
})
