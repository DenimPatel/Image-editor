import { describe, expect, it } from 'vitest'
import {
  DEFINITION_WEIGHTS,
  SHARPEN_GAIN,
  definition,
  definitionRadius,
  localContrast,
  pixelReader,
  sharpen,
  sharpenRadius,
} from './detail-kernels'

const SIGMA = 3
const WIDTH = 41
const EDGE = 20

/** A step edge convolved with a Gaussian: the S-curve a soft lens really gives. */
function blurredEdge(): number[][] {
  const cdf = (z: number) => 1 / (1 + Math.exp(-z))
  const row = Array.from({ length: WIDTH }, (_, x) => cdf((x - EDGE) / SIGMA))
  return [row, [...row], [...row]]
}

/** A hard vertical edge with wide flat regions either side, for the no-op checks. */
function stepImage(): number[][] {
  const row = Array.from({ length: 60 }, (_, x) => (x < 30 ? 0.2 : 0.8))
  return [row, [...row], [...row]]
}

const FLAT = [1, 4, 8, 12, 16]

function rangeAfter(
  sample: (x: number, y: number) => number,
  centerX: number,
  centerY: number,
  half: number,
): number {
  let min = Infinity
  let max = -Infinity
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const value = sample(centerX + dx, centerY + dy)
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  return max - min
}

describe('kernel radii', () => {
  it('gives sharpen a 1..2.5 texel cross and definition a wider 1..3 texel ring', () => {
    expect(sharpenRadius(0)).toBe(1)
    expect(sharpenRadius(1)).toBeCloseTo(2.5, 12)
    expect(definitionRadius(0)).toBe(1)
    expect(definitionRadius(1)).toBe(3)
    expect(definitionRadius(0.5)).toBeGreaterThan(sharpenRadius(0.5))
  })
})

describe('sharpen', () => {
  it('leaves a flat region exactly as it found it', () => {
    const read = pixelReader(stepImage())
    for (const x of FLAT) {
      expect(sharpen(read, x, 1, 0.9)).toBeCloseTo(stepImage()[0]![x]!, 12)
    }
  })

  it('gains local contrast across a blurred edge', () => {
    const read = pixelReader(blurredEdge())
    const amount = 0.6
    const before = localContrast(read, EDGE, 0, 6)
    const after = rangeAfter((x, y) => sharpen(read, x, y, amount), EDGE, 0, 6)
    expect(after).toBeGreaterThan(before)
  })

  it('is a no-op at zero amount', () => {
    const read = pixelReader(blurredEdge())
    for (let x = 12; x <= 28; x += 1) {
      expect(sharpen(read, x, 1, 0)).toBeCloseTo(read(x, 1), 12)
    }
  })
})

describe('definition', () => {
  it('leaves a flat region exactly as it found it', () => {
    const read = pixelReader(stepImage())
    for (const x of FLAT) {
      expect(definition(read, x, 1, 0.9)).toBeCloseTo(stepImage()[0]![x]!, 12)
    }
  })

  it('gains local contrast across a blurred edge', () => {
    const read = pixelReader(blurredEdge())
    const before = localContrast(read, EDGE, 0, 6)
    const after = rangeAfter((x, y) => definition(read, x, y, 0.6), EDGE, 0, 6)
    expect(after).toBeGreaterThan(before)
  })

  it('is a no-op at zero amount', () => {
    const read = pixelReader(blurredEdge())
    for (let x = 12; x <= 28; x += 1) {
      expect(definition(read, x, 1, 0)).toBeCloseTo(read(x, 1), 12)
    }
  })
})

describe('sharpen vs definition', () => {
  it('are different kernels: same amount, different output', () => {
    const read = pixelReader(blurredEdge())
    let differences = 0
    for (let x = 8; x <= 32; x += 1) {
      const sharpened = sharpen(read, x, 1, 0.5)
      const defined = definition(read, x, 1, 0.5)
      if (Math.abs(sharpened - defined) > 1e-6) differences += 1
    }
    expect(differences).toBeGreaterThan(10)
  })

  it('combine their three radii into weights that sum to one', () => {
    const total = DEFINITION_WEIGHTS.near + DEFINITION_WEIGHTS.mid + DEFINITION_WEIGHTS.far
    expect(total).toBeCloseTo(1, 12)
  })

  it('agrees with the shader gains the renderer sends', () => {
    // The renderer writes sharpenRadius/definitionRadius straight into
    // u_radius and amount into u_amount, so the CPU twin and the shader share
    // these constants rather than drifting apart.
    expect(SHARPEN_GAIN).toBe(2)
  })
})
