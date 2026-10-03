import { describe, expect, it } from 'vitest'
import { createDoc } from '../model/defaults'
import type { BrushStroke, Mask, Point } from '../model/types'
import {
  LOCAL_ADJUST_KEYS,
  isLocalAdjustKey,
  localAdjustIsNeutral,
  localAdjustUniforms,
  maskKindIndex,
  maskValueAt,
  rasterizeMask,
  type MaskSample,
} from './mask'

const SQUARE: MaskSample = { luma: 0.5, alpha: 1, aspect: 1 }

function sample(overrides: Partial<MaskSample> = {}): MaskSample {
  return { ...SQUARE, ...overrides }
}

function stroke(patch: Partial<BrushStroke> = {}): BrushStroke {
  return {
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
    radius: 0.1,
    hardness: 1,
    ...patch,
  }
}

// --- D1-F14: one test per mask kind ------------------------------------------

describe('maskValueAt: subject', () => {
  const mask: Mask = { id: 'm', kind: 'subject', enabled: true, feather: 0 }

  it('follows the matte alpha', () => {
    expect(maskValueAt(mask, 0.5, 0.5, sample({ alpha: 0.9 }))).toBeGreaterThan(0.8)
    expect(maskValueAt(mask, 0.5, 0.5, sample({ alpha: 0.1 }))).toBeLessThan(0.2)
  })

  it('is a hard threshold at feather 0', () => {
    expect(maskValueAt(mask, 0.5, 0.5, sample({ alpha: 0.49 }))).toBe(0)
    expect(maskValueAt(mask, 0.5, 0.5, sample({ alpha: 0.51 }))).toBe(1)
  })

  it('is the full alpha ramp at feather 1', () => {
    const soft: Mask = { ...mask, feather: 1 }
    expect(maskValueAt(soft, 0.5, 0.5, sample({ alpha: 0 }))).toBeCloseTo(0, 12)
    expect(maskValueAt(soft, 0.5, 0.5, sample({ alpha: 1 }))).toBeCloseTo(1, 12)
    expect(maskValueAt(soft, 0.5, 0.5, sample({ alpha: 0.5 }))).toBeCloseTo(0.5, 12)
  })

  it('ignores geometry: the same alpha gives the same value anywhere', () => {
    const a = maskValueAt(mask, 0.1, 0.1, sample({ alpha: 0.8 }))
    const b = maskValueAt(mask, 0.9, 0.9, sample({ alpha: 0.8 }))
    expect(a).toBe(b)
  })
})

describe('maskValueAt: brush', () => {
  const mask: Mask = { id: 'm', kind: 'brush', enabled: true, feather: 0, strokes: [stroke()] }

  it('is solid on the stroke and zero well away from it', () => {
    expect(maskValueAt(mask, 0.5, 0.5, sample())).toBe(1)
    expect(maskValueAt(mask, 0.5, 0.05, sample())).toBe(0)
    expect(maskValueAt(mask, 0.05, 0.5, sample())).toBe(0)
  })

  it('ends at the round cap, not a square one', () => {
    // The polyline runs 0.2..0.8 at y=0.5 with radius 0.1, so the cap reaches
    // x=0.1 at full strength and nothing at all by x=0.05.
    expect(maskValueAt(mask, 0.15, 0.5, sample())).toBe(1)
    expect(maskValueAt(mask, 0.05, 0.5, sample())).toBe(0)
  })

  it('feathers from `hardness` outwards to `radius`', () => {
    const soft: Mask = { ...mask, strokes: [stroke({ hardness: 0 })] }
    expect(maskValueAt(soft, 0.5, 0.5, sample())).toBe(1)
    const half = maskValueAt(soft, 0.5, 0.55, sample())
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(1)
    expect(maskValueAt(soft, 0.5, 0.6, sample())).toBe(0)
  })

  it('unions painting strokes', () => {
    const two: Mask = {
      ...mask,
      strokes: [
        stroke(),
        stroke({
          points: [
            { x: 0.5, y: 0.2 },
            { x: 0.5, y: 0.8 },
          ],
        }),
      ],
    }
    expect(maskValueAt(two, 0.5, 0.25, sample())).toBe(1)
  })

  it('subtracts erasing strokes, not the other way round', () => {
    const erase: Mask = {
      ...mask,
      strokes: [stroke(), stroke({ erase: true, points: [{ x: 0.4, y: 0.5 }] })],
    }
    expect(maskValueAt(erase, 0.3, 0.5, sample())).toBe(0)
    expect(maskValueAt(erase, 0.7, 0.5, sample())).toBe(1)
  })

  it('measures the radius in the y-squeezed metric, so it is round on screen', () => {
    // A 4:3 frame: a radius of 0.1 is a tenth of the width, so 0.1 / (3/4) =
    // 0.133 in normalized y is the same distance — not 0.1.
    const wide = sample({ aspect: 4 / 3 })
    expect(maskValueAt(mask, 0.5, 0.62, wide)).toBe(1)
    expect(maskValueAt(mask, 0.5, 0.64, wide)).toBe(0)
  })

  it('is empty with no strokes', () => {
    expect(maskValueAt({ ...mask, strokes: [] }, 0.5, 0.5, sample())).toBe(0)
  })
})

describe('maskValueAt: linear', () => {
  const mask: Mask = {
    id: 'm',
    kind: 'linear',
    enabled: true,
    feather: 0,
    from: { x: 0.25, y: 0.5 },
    to: { x: 0.75, y: 0.5 },
  }

  it('is a hard step across the segment at feather 0', () => {
    expect(maskValueAt(mask, 0.2, 0.5, sample())).toBe(0)
    expect(maskValueAt(mask, 0.8, 0.5, sample())).toBe(1)
  })

  it('ramps 0 -> 1 across the segment at feather 1', () => {
    const soft: Mask = { ...mask, feather: 1 }
    expect(maskValueAt(soft, 0.25, 0.5, sample())).toBeCloseTo(0, 12)
    expect(maskValueAt(soft, 0.5, 0.5, sample())).toBeCloseTo(0.5, 12)
    expect(maskValueAt(soft, 0.75, 0.5, sample())).toBeCloseTo(1, 12)
  })

  it('measures distance perpendicular to the axis, not along x', () => {
    // The axis is horizontal, so walking down the frame changes nothing until
    // the feather starts to bleed across it.
    const soft: Mask = { ...mask, feather: 1 }
    expect(maskValueAt(soft, 0.5, 0.95, sample())).toBeCloseTo(
      maskValueAt(soft, 0.5, 0.05, sample()),
      12,
    )
  })

  it('follows a diagonal axis', () => {
    const diagonal: Mask = { ...mask, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, feather: 1 }
    expect(maskValueAt(diagonal, 0, 0, sample())).toBeCloseTo(0, 12)
    expect(maskValueAt(diagonal, 1, 1, sample())).toBeCloseTo(1, 12)
    expect(maskValueAt(diagonal, 0, 1, sample())).toBeCloseTo(0.5, 12)
  })

  it('masks nothing when the axis has no length', () => {
    const degenerate: Mask = { ...mask, to: { x: 0.25, y: 0.5 } }
    expect(maskValueAt(degenerate, 0.25, 0.5, sample())).toBe(0)
  })
})

describe('maskValueAt: radial', () => {
  const mask: Mask = {
    id: 'm',
    kind: 'radial',
    enabled: true,
    feather: 0,
    center: { x: 0.5, y: 0.5 },
    radiusX: 0.2,
    radiusY: 0.2,
    rotation: 0,
    invert: false,
  }

  it('is solid at the centre and empty outside the ellipse', () => {
    expect(maskValueAt(mask, 0.5, 0.5, sample())).toBe(1)
    expect(maskValueAt(mask, 0.9, 0.5, sample())).toBe(0)
  })

  it('follows the ellipse axes separately', () => {
    const oval: Mask = { ...mask, radiusX: 0.4, radiusY: 0.1 }
    expect(maskValueAt(oval, 0.8, 0.5, sample())).toBe(1)
    expect(maskValueAt(oval, 0.5, 0.7, sample())).toBe(0)
  })

  it('rotates with `rotation`', () => {
    const turned: Mask = { ...mask, radiusX: 0.4, radiusY: 0.1, rotation: 90 }
    expect(maskValueAt(turned, 0.5, 0.8, sample())).toBe(1)
    expect(maskValueAt(turned, 0.8, 0.5, sample())).toBe(0)
  })

  it('feathers outward from the boundary', () => {
    const soft: Mask = { ...mask, feather: 1 }
    const edge = maskValueAt(soft, 0.7, 0.5, sample())
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
    expect(maskValueAt(soft, 0.5, 0.5, sample())).toBe(1)
    expect(maskValueAt(soft, 0.95, 0.5, sample())).toBe(0)
  })

  it('inverts the whole field, feather included', () => {
    const inverted: Mask = { ...mask, invert: true }
    expect(maskValueAt(inverted, 0.5, 0.5, sample())).toBe(0)
    expect(maskValueAt(inverted, 0.9, 0.5, sample())).toBe(1)
    const softInverted: Mask = { ...inverted, feather: 1 }
    expect(softInverted).toBeTruthy()
    expect(maskValueAt(softInverted, 0.7, 0.5, sample())).toBeCloseTo(
      1 - maskValueAt({ ...mask, feather: 1 }, 0.7, 0.5, sample()),
      12,
    )
  })

  it('squashes y by the frame aspect so a radiusY is round on screen', () => {
    const wide = sample({ aspect: 4 / 3 })
    // radiusY 0.2 is a fifth of the frame's *width*, so its vertical extent
    // is 0.2 * 4/3 = 0.267 in normalized y.
    expect(maskValueAt(mask, 0.5, 0.76, wide)).toBe(1)
    expect(maskValueAt(mask, 0.5, 0.78, wide)).toBe(0)
  })
})

describe('maskValueAt: luminance', () => {
  const mask: Mask = {
    id: 'm',
    kind: 'luminance',
    enabled: true,
    feather: 0,
    low: 0.3,
    high: 0.7,
    invert: false,
  }

  it('selects the band and nothing else', () => {
    expect(maskValueAt(mask, 0.5, 0.5, sample({ luma: 0.1 }))).toBe(0)
    expect(maskValueAt(mask, 0.5, 0.5, sample({ luma: 0.5 }))).toBeCloseTo(0.5, 12)
    expect(maskValueAt(mask, 0.5, 0.5, sample({ luma: 0.9 }))).toBe(1)
  })

  it('widens the band by `feather` on both edges', () => {
    const soft: Mask = { ...mask, feather: 0.2 }
    expect(maskValueAt(soft, 0.5, 0.5, sample({ luma: 0.1 }))).toBeLessThan(1e-9)
    expect(maskValueAt(soft, 0.5, 0.5, sample({ luma: 0.2 }))).toBeGreaterThan(0)
    expect(maskValueAt(soft, 0.5, 0.5, sample({ luma: 0.8 }))).toBeLessThan(1)
    expect(maskValueAt(soft, 0.5, 0.5, sample({ luma: 0.5 }))).toBeCloseTo(0.5, 12)
  })

  it('survives a zero-width band instead of dividing by zero', () => {
    const point: Mask = { ...mask, low: 0.5, high: 0.5 }
    expect(maskValueAt(point, 0, 0, sample({ luma: 0.4 }))).toBe(0)
    expect(maskValueAt(point, 0, 0, sample({ luma: 0.6 }))).toBe(1)
  })

  it('inverts so the selection becomes the rejection', () => {
    const inverted: Mask = { ...mask, invert: true }
    expect(maskValueAt(inverted, 0.5, 0.5, sample({ luma: 0.1 }))).toBe(1)
    expect(maskValueAt(inverted, 0.5, 0.5, sample({ luma: 0.9 }))).toBe(0)
  })

  it('reads the luma the caller supplies, not the geometry', () => {
    expect(maskValueAt(mask, 0.02, 0.98, sample({ luma: 0.5 }))).toBeCloseTo(0.5, 12)
  })
})

describe('every kind stays inside 0..1', () => {
  const masks: Mask[] = [
    { id: 'a', kind: 'subject', enabled: true, feather: 1 },
    { id: 'b', kind: 'brush', enabled: true, feather: 1, strokes: [stroke({ hardness: 0 })] },
    {
      id: 'c',
      kind: 'linear',
      enabled: true,
      feather: 1,
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    },
    {
      id: 'd',
      kind: 'radial',
      enabled: true,
      feather: 1,
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.3,
      radiusY: 0.3,
      rotation: 17,
      invert: true,
    },
    { id: 'e', kind: 'luminance', enabled: true, feather: 1, low: 0.2, high: 0.8, invert: true },
  ]

  it('never leaves the unit interval anywhere on the frame', () => {
    for (const mask of masks) {
      for (let y = 0; y <= 1.0001; y += 0.05) {
        for (let x = 0; x <= 1.0001; x += 0.05) {
          for (const s of [sample({ alpha: 0, luma: 0 }), sample({ alpha: 1, luma: 1 })]) {
            const value = maskValueAt(mask, x, y, s)
            expect(Number.isFinite(value), `${mask.kind} at ${x},${y}`).toBe(true)
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})

// --- rasterisation ------------------------------------------------------------

describe('rasterizeMask', () => {
  const radial: Mask = {
    id: 'm',
    kind: 'radial',
    enabled: true,
    feather: 0.5,
    center: { x: 0.5, y: 0.5 },
    radiusX: 0.3,
    radiusY: 0.3,
    rotation: 0,
    invert: false,
  }

  it('is one byte per pixel, row-major, and quantises to 0..255', () => {
    const field = rasterizeMask(radial, 8, 6, () => sample())
    expect(field).toBeInstanceOf(Uint8Array)
    expect(field).toHaveLength(48)
    // Row 0 is the top of the frame, so both corners are outside the ellipse
    // and the middle of the frame is inside it.
    expect(field[0]).toBe(0)
    expect(field[7]).toBe(0)
    expect(field[8 * 3 + 4]).toBe(255)
  })

  it('agrees with `maskValueAt` to within half a code', () => {
    const width = 16
    const height = 12
    const field = rasterizeMask(radial, width, height, () => sample())
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const exact = maskValueAt(radial, (x + 0.5) / width, (y + 0.5) / height, sample())
        expect(Math.abs(field[y * width + x] / 255 - exact)).toBeLessThanOrEqual(0.5 / 255 + 1e-9)
      }
    }
  })

  it('reads the sample it is given, so a luminance mask tracks the image', () => {
    const luma: Mask = {
      id: 'l',
      kind: 'luminance',
      enabled: true,
      feather: 0,
      low: 0.4,
      high: 0.6,
      invert: false,
    }
    const bright = rasterizeMask(luma, 4, 1, () => sample({ luma: 0.9 }))
    const dark = rasterizeMask(luma, 4, 1, () => sample({ luma: 0.1 }))
    expect(bright[0]).toBe(255)
    expect(dark[0]).toBe(0)
  })

  it('clamps a degenerate size to at least one pixel', () => {
    expect(rasterizeMask(radial, 0, 0, () => sample())).toHaveLength(1)
  })
})

// --- kinds / keys -------------------------------------------------------------

describe('maskKindIndex', () => {
  it('names every kind in the shader and nothing else', () => {
    const doc = createDoc()
    doc.masks = [
      { id: 'a', kind: 'subject', enabled: true, feather: 0 },
      { id: 'b', kind: 'brush', enabled: true, feather: 0, strokes: [] },
      {
        id: 'c',
        kind: 'linear',
        enabled: true,
        feather: 0,
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
      },
      {
        id: 'd',
        kind: 'radial',
        enabled: true,
        feather: 0,
        center: { x: 0.5, y: 0.5 },
        radiusX: 0.2,
        radiusY: 0.2,
        rotation: 0,
        invert: false,
      },
      { id: 'e', kind: 'luminance', enabled: true, feather: 0, low: 0, high: 1, invert: false },
    ]
    expect(doc.masks.map((mask) => maskKindIndex(mask.kind))).toEqual([0, 1, 2, 3, 4])
  })
})

describe('local adjust keys', () => {
  it('is exactly the tone and colour set the pass can weigh by a mask', () => {
    expect([...LOCAL_ADJUST_KEYS]).toEqual([
      'exposure',
      'brightness',
      'contrast',
      'highlights',
      'shadows',
      'blackPoint',
      'brilliance',
      'saturation',
      'vibrance',
      'warmth',
      'tint',
    ])
  })

  it('rejects the neighbourhood kernels and the spatial ones', () => {
    for (const key of ['sharpness', 'definition', 'noiseReduction', 'vignette']) {
      expect(isLocalAdjustKey(key)).toBe(false)
    }
    for (const key of LOCAL_ADJUST_KEYS) expect(isLocalAdjustKey(key)).toBe(true)
  })

  it('drops the non-local keys instead of uploading an unused uniform', () => {
    const values = { exposure: 0.5, sharpness: 40, noiseReduction: 30, saturation: -0.2 }
    expect(localAdjustUniforms(values)).toEqual({ exposure: 0.5, saturation: -0.2 })
  })

  it('ignores non-finite values', () => {
    expect(localAdjustUniforms({ exposure: Number.NaN, contrast: Infinity, tint: 0.1 })).toEqual({
      tint: 0.1,
    })
  })

  it('reports a local adjust of all zeroes as neutral', () => {
    expect(localAdjustIsNeutral({})).toBe(true)
    expect(localAdjustIsNeutral({ exposure: 0, contrast: -0 })).toBe(true)
    expect(localAdjustIsNeutral({ exposure: 0.01 })).toBe(false)
  })
})

// --- integration with the document model --------------------------------------

describe('masks on a real doc', () => {
  it('evaluates a mask authored in the frame the crop lives in', () => {
    const doc = createDoc()
    const mask: Mask = {
      id: 'm',
      kind: 'linear',
      enabled: true,
      feather: 1,
      from: { x: 0, y: 0 } as Point,
      to: { x: 1, y: 0 } as Point,
    }
    doc.masks = [mask]
    expect(maskValueAt(doc.masks[0], 0, 0, sample())).toBeCloseTo(0, 12)
    expect(maskValueAt(doc.masks[0], 1, 0, sample())).toBeCloseTo(1, 12)
  })
})
