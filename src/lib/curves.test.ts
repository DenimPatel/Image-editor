import { describe, expect, it } from 'vitest'
import type { CurvePoint, Curves } from '../model/types'
import {
  TONAL_CURVE_COLORS,
  applyLut,
  buildChannelLuts,
  buildCurveLut,
  curveChannelFill,
  curvesAreIdentity,
  isIdentityCurve,
  rgbToHex,
} from './curves'

const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
]

function identityValues(): number[] {
  return Array.from({ length: 256 }, (_, i) => i)
}

describe('buildCurveLut', () => {
  it('produces the identity LUT for the identity curve', () => {
    expect(Array.from(buildCurveLut(IDENTITY_CURVE))).toEqual(identityValues())
  })

  it('falls back to the identity LUT with fewer than two points', () => {
    expect(Array.from(buildCurveLut([]))).toEqual(identityValues())
    expect(Array.from(buildCurveLut([{ x: 10, y: 10 }]))).toEqual(identityValues())
  })

  it('stays monotone non-decreasing for increasing control points', () => {
    const points: CurvePoint[] = [
      { x: 0, y: 0 },
      { x: 40, y: 20 },
      { x: 90, y: 70 },
      { x: 180, y: 200 },
      { x: 255, y: 255 },
    ]
    const lut = buildCurveLut(points)
    for (let i = 1; i < 256; i += 1) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1])
    }
  })

  it('stays monotone non-increasing for decreasing control points', () => {
    const points: CurvePoint[] = [
      { x: 0, y: 255 },
      { x: 60, y: 220 },
      { x: 140, y: 120 },
      { x: 255, y: 0 },
    ]
    const lut = buildCurveLut(points)
    for (let i = 1; i < 256; i += 1) {
      expect(lut[i]).toBeLessThanOrEqual(lut[i - 1])
    }
  })

  it('clamps endpoints and out-of-range control points to 0..255', () => {
    const lut = buildCurveLut([
      { x: -20, y: -80 },
      { x: 128, y: 128 },
      { x: 300, y: 400 },
    ])
    expect(lut[0]).toBe(0)
    expect(lut[255]).toBe(255)
    for (const value of lut) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })

  it('deduplicates control points that share an x', () => {
    const lut = buildCurveLut([
      { x: 0, y: 0 },
      { x: 128, y: 50 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ])
    expect(lut[128]).toBe(200)
  })
})

describe('isIdentityCurve', () => {
  it('detects the identity curve', () => {
    expect(isIdentityCurve(IDENTITY_CURVE)).toBe(true)
    expect(isIdentityCurve([...IDENTITY_CURVE].reverse())).toBe(true)
  })

  it('rejects a non-identity curve', () => {
    expect(
      isIdentityCurve([
        { x: 0, y: 0 },
        { x: 255, y: 100 },
      ]),
    ).toBe(false)
  })
})

describe('buildChannelLuts and curvesAreIdentity', () => {
  const identityCurves: Curves = {
    rgb: IDENTITY_CURVE,
    r: IDENTITY_CURVE,
    g: IDENTITY_CURVE,
    b: IDENTITY_CURVE,
  }

  it('builds a 256-entry LUT for every channel', () => {
    const luts = buildChannelLuts(identityCurves)
    expect(luts.rgb).toHaveLength(256)
    expect(luts.r).toHaveLength(256)
    expect(luts.g).toHaveLength(256)
    expect(luts.b).toHaveLength(256)
    expect(applyLut(128, luts.rgb)).toBe(128)
  })

  it('reports all-identity curves', () => {
    expect(curvesAreIdentity(identityCurves)).toBe(true)
    expect(
      curvesAreIdentity({
        ...identityCurves,
        g: [
          { x: 0, y: 10 },
          { x: 255, y: 255 },
        ],
      }),
    ).toBe(false)
  })
})

describe('applyLut', () => {
  it('rounds the input and clamps out-of-range indices', () => {
    const lut = buildCurveLut(IDENTITY_CURVE)
    expect(applyLut(10.4, lut)).toBe(10)
    expect(applyLut(10.5, lut)).toBe(11)
    expect(applyLut(-5, lut)).toBe(0)
    expect(applyLut(999, lut)).toBe(255)
  })
})

describe('TONAL_CURVE_COLORS is the one table both curve surfaces read', () => {
  it('has an entry for every channel the document stores', () => {
    expect(Object.keys(TONAL_CURVE_COLORS).sort()).toEqual(['b', 'g', 'r', 'rgb'])
  })

  it('is four distinguishable colours, and no channel reuses another', () => {
    expect(new Set(Object.values(TONAL_CURVE_COLORS)).size).toBe(4)
  })

  it('is exactly the fills the histogram was drawing, taken apart', () => {
    // `Histogram.drawHistogram` used to hardcode these four strings. `Histogram`
    // now reads them from here, so these four assertions no longer police that
    // call site — they pin the *values*, which is what has to stay put: these
    // are the histogram's existing fills, and the graph is not being restyled.
    // A hex that moves here moves the histogram and the curve together, which
    // is the point; a hex that moves and leaves `Histogram` alone is the defect
    // this table exists to remove, and `drawHistogram` importing it is what makes
    // that impossible rather than merely unlikely.
    expect(curveChannelFill('rgb', 0.35)).toBe('rgba(255, 255, 255, 0.35)')
    expect(curveChannelFill('r', 0.5)).toBe('rgba(255, 80, 80, 0.5)')
    expect(curveChannelFill('g', 0.5)).toBe('rgba(80, 220, 120, 0.5)')
    expect(curveChannelFill('b', 0.5)).toBe('rgba(90, 140, 255, 0.5)')
  })

  it('agrees with its own hexes, so a stroke and its fill are one colour', () => {
    for (const [channel, hex] of Object.entries(TONAL_CURVE_COLORS)) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      expect(curveChannelFill(channel as 'rgb', 1), channel).toBe(`rgba(${r}, ${g}, ${b}, 1)`)
    }
  })
})

describe('rgbToHex', () => {
  it('pads each channel to two digits', () => {
    expect(rgbToHex(255, 90, 90)).toBe('#ff5a5a')
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(1, 2, 3)).toBe('#010203')
  })

  it('clamps and rounds, so a float hue cannot emit a broken colour', () => {
    expect(rgbToHex(-20, 300, 12.6)).toBe('#00ff0d')
  })
})
