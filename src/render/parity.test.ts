import { describe, expect, it } from 'vitest'
import { CANVAS2D_SUPPORT } from '../gl/caps'
import { computeOutputToSource } from '../gl/geometry'
import { rasterizeMask } from '../gl/mask'
import { pixelScale } from '../gl/pixel-scale'
import { planPasses, withLeadingGeometry, type Pass } from '../gl/passes'
import { GlRenderer } from '../gl/renderer'
import { installFakeGl2 } from '../gl/fakegl'
import { createDoc } from '../model/defaults'
import { DITHER_LSB, ditherOffsetLsb } from '../lib/tonemap'
import { hexToRgb } from '../gl/pass-colors'
import type { Curves, Doc, Mask, Size } from '../model/types'
import {
  gatedFamilies,
  leadingGeometryClamp,
  makePixels,
  projectiveResample,
  runCpuPasses,
  type Pixels,
} from './cpu-passes'
import { meanAbsDiff, replayGlFrames } from './gl-replay'

/**
 * Backend parity (D3-F10) and kernel scale (D3-F17).
 *
 * The GL side of every comparison is not a transcription: the fake GL records
 * the linked fragment source and the exact uniform values the renderer
 * uploaded, and `replayGlFrames` executes them. So if a shader constant and its
 * CPU twin disagree, or if a uniform stops being bound, these fail.
 */
const TOLERANCE = 2 / 255

/**
 * A synthetic source: a hard vertical edge, two ramps and a block of
 * semi-transparent red, so sharpen, blur, grain, vignette and alpha all have
 * something to bite on.
 */
function fixture(width: number, height: number): Pixels {
  const pixels = makePixels(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4
      const left = x < width / 2
      pixels.data[i] = Math.round(255 * (x / width) * (left ? 0.35 : 1))
      pixels.data[i + 1] = Math.round(255 * (y / height) * (left ? 1 : 0.8))
      pixels.data[i + 2] = Math.round(255 * ((x + y) / (width + height)))
      pixels.data[i + 3] = x > width * 0.75 && y < height / 3 ? 128 : 255
    }
  }
  return pixels
}

const IDENTITY_CURVES: Curves = {
  rgb: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  r: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  g: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  b: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
}

const NEUTRAL_HSL: Doc['hsl'] = {
  red: { hue: 0, sat: 0, lum: 0 },
  orange: { hue: 0, sat: 0, lum: 0 },
  yellow: { hue: 0, sat: 0, lum: 0 },
  green: { hue: 0, sat: 0, lum: 0 },
  aqua: { hue: 0, sat: 0, lum: 0 },
  blue: { hue: 0, sat: 0, lum: 0 },
  purple: { hue: 0, sat: 0, lum: 0 },
  magenta: { hue: 0, sat: 0, lum: 0 },
}

function docWith(overrides: Partial<Doc> = {}): Doc {
  const base = createDoc()
  return { ...base, hsl: NEUTRAL_HSL, curves: IDENTITY_CURVES, ...overrides }
}

/** Detail amounts live on `doc.adjust`, not at the top level. */
function detail(overrides: Partial<Doc['adjust']> & { effects?: Doc['effects'] }): Partial<Doc> {
  const { effects, ...adjust } = overrides
  return { adjust: { ...createDoc().adjust, ...adjust }, ...(effects ? { effects } : {}) }
}

/**
 * Optional inputs the two engines cannot both read on their own. A background
 * image is a `TexImageSource` to the renderer and a byte buffer to the CPU twin,
 * so a test that wants one supplies the same pixels to both.
 */
type ParityOptions = {
  backgroundImage?: Pixels
}

/** The GL image, produced by running the real renderer and replaying its frame. */
function glImage(
  doc: Doc,
  size: Size,
  source: Pixels,
  options: ParityOptions = {},
): { pixels: Pixels; kernelScales: number[]; uniforms: string[]; draws: number } {
  const sourceSize = { width: source.width, height: source.height }
  const harness = installFakeGl2()
  try {
    const assets = options.backgroundImage
      ? (): TexImageSource => options.backgroundImage as unknown as TexImageSource
      : undefined
    const renderer = new GlRenderer(document.createElement('canvas'), { assets })
    ;(renderer as unknown as { render: (r: unknown) => void }).render({
      doc,
      size,
      source: source as unknown as TexImageSource,
      sourceSize,
    })
    const brushField = rasterizeBrushField(doc, size)
    const replayed = replayGlFrames(source, harness.gl.drawFrames, {
      curves: doc.curves,
      backgroundImage: options.backgroundImage,
      brushField,
    })
    return {
      pixels: replayed.pixels,
      kernelScales: harness.gl.uniforms
        .filter((uniform) => uniform.name === 'u_pixelScale')
        .map((uniform) => (uniform as { value: number }).value),
      uniforms: [...new Set(harness.gl.uniforms.map((uniform) => uniform.name))],
      draws: replayed.draws,
    }
  } finally {
    harness.restore()
  }
}

/**
 * The R8 texture the renderer uploads for a brush mask, reconstructed with the
 * same function it used. It is passed back in so the replay samples the very
 * bytes the shader saw rather than a second evaluation of the same maths.
 */
function rasterizeBrushField(doc: Doc, size: Size): Pixels | undefined {
  const brush = doc.masks.find((mask) => mask.kind === 'brush')
  if (!brush) return undefined
  const field = rasterizeMask(brush, size.width, size.height, () => ({
    luma: 0,
    alpha: 0,
    aspect: size.width / size.height,
  }))
  const out = makePixels(size.width, size.height)
  for (let i = 0; i < field.length; i += 1) {
    out.data[i * 4] = field[i]!
    out.data[i * 4 + 3] = 255
  }
  return out
}

/** The Canvas2D image, for the same doc and size. */
function cpuImage(doc: Doc, size: Size, source: Pixels, options: ParityOptions = {}): Pixels {
  const sourceSize = { width: source.width, height: source.height }
  const matrix = computeOutputToSource(doc, sourceSize, size)
  const passes = withLeadingGeometry(planPasses(doc, size, matrix), matrix)
  const clamp = leadingGeometryClamp(passes)
  const geometry = projectiveResample(source, matrix, size.width, size.height, sourceSize, clamp)
  return runCpuPasses(geometry, passes, {
    pixelScale: pixelScale(size),
    backgroundImage: options.backgroundImage,
  }).pixels
}

/** A document with one mask and one local adjust bound to it. */
function maskedDoc(mask: Mask, values: Record<string, number>): Doc {
  return docWith({
    masks: [mask],
    localAdjusts: [{ id: 'la1', maskId: mask.id, enabled: true, values }],
  })
}

describe('backend parity (D3-F10)', () => {
  const size: Size = { width: 64, height: 48 }
  const source = fixture(size.width, size.height)

  it('matches the GL pipeline within 2/255 for a full edit', () => {
    const doc = docWith({
      adjust: {
        ...createDoc().adjust,
        exposure: 0.4,
        contrast: 18,
        saturation: 12,
        warmth: 8,
        highlights: -20,
        shadows: 15,
        noiseReduction: 20,
        definition: 30,
        sharpness: 40,
        vignette: 20,
      },
      curves: {
        rgb: [
          { x: 0, y: 0.02 },
          { x: 0.5, y: 0.54 },
          { x: 1, y: 1 },
        ],
        r: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        g: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        b: [
          { x: 0, y: 0.04 },
          { x: 1, y: 0.98 },
        ],
      },
      hsl: {
        ...NEUTRAL_HSL,
        red: { hue: 4, sat: 10, lum: 0 },
        blue: { hue: -6, sat: 0, lum: 4 },
      },
      effects: { grain: 25, bloom: 20, fieldBlur: 0 },

      background: {
        mode: 'gradient',
        color: '#101010',
        gradient: { from: '#0b1a3a', to: '#3a0b1a', angle: 45 },
        blur: 0,
        fit: 'cover',
        removed: false,
        imageAssetId: null,
      },
      output: { ...createDoc().output, format: 'jpeg', matte: '#ffffff' },
    })
    const { pixels: gl } = glImage(doc, size, source)
    const cpu = cpuImage(doc, size, source)
    expect(meanAbsDiff(gl, cpu)).toBeLessThan(TOLERANCE)
  })

  it('matches the GL pipeline for a crop, a straighten and a perspective warp', () => {
    const base = createDoc().geometry
    const geometries: [string, Doc['geometry']][] = [
      ['identity', base],
      ['crop', { ...base, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }],
      ['straighten', { ...base, straighten: 0.18 }],
      [
        'perspective',
        {
          ...base,
          perspective: {
            topLeft: { x: 0.08, y: 0 },
            topRight: { x: 0, y: 0.03 },
            bottomRight: { x: 0, y: 0 },
            bottomLeft: { x: -0.06, y: -0.02 },
          },
        },
      ],
    ]
    for (const [label, geometry] of geometries) {
      const doc = docWith({ geometry })
      const { pixels: gl } = glImage(doc, size, source)
      expect(meanAbsDiff(gl, cpuImage(doc, size, source)), label).toBeLessThan(TOLERANCE)
    }
  })

  it('gates only the families Canvas2D cannot run', () => {
    expect(gatedFamilies(planPasses(createDoc(), size))).toEqual([])
    const doc = docWith({ look: { id: 'kodak-portra', amount: 1 } })
    const gated = gatedFamilies(planPasses(doc, size))
    expect(gated).toEqual(['lut3d'])
    for (const family of gated) expect(CANVAS2D_SUPPORT[family as 'lut3d']).toBe(false)
  })
})

describe('kernel scale (D3-F17)', () => {
  // `pixelScale` is `longEdge / 2048`, so a scale-3 render needs a 6144 px long
  // edge. A strip is enough: the kernels are being checked for the *scale* they
  // are given, and a 6144x8 frame is 49k fragments rather than 28 million.
  const cases: { label: string; overrides: Partial<Doc> }[] = [
    { label: 'sharpen', overrides: detail({ sharpness: 60, definition: 0, noiseReduction: 0 }) },
    { label: 'definition', overrides: detail({ sharpness: 0, definition: 60, noiseReduction: 0 }) },
    { label: 'denoise', overrides: detail({ sharpness: 0, definition: 0, noiseReduction: 60 }) },
    { label: 'grain', overrides: detail({ effects: { grain: 50, bloom: 0, fieldBlur: 0 } }) },
    { label: 'bloom', overrides: detail({ effects: { grain: 0, bloom: 60, fieldBlur: 0 } }) },
    { label: 'fieldBlur', overrides: detail({ effects: { grain: 0, bloom: 0, fieldBlur: 60 } }) },
  ]

  for (const scale of [1, 3] as const) {
    for (const testCase of cases) {
      it(
        `GL and CPU agree within 2/255 for ${testCase.label} at scale ${scale}`,
        { timeout: 120000 },
        () => {
          const size: Size = scale === 1 ? { width: 96, height: 8 } : { width: 6144, height: 8 }
          const source = fixture(size.width, size.height)
          const doc = docWith(testCase.overrides)
          expect(pixelScale(size)).toBe(scale)
          const { pixels: gl, kernelScales } = glImage(doc, size, source)
          // The scale really reached the shader, not just the CPU twin.
          expect(kernelScales.length).toBeGreaterThan(0)
          expect(new Set(kernelScales)).toEqual(new Set([scale]))
          expect(meanAbsDiff(gl, cpuImage(doc, size, source))).toBeLessThan(TOLERANCE)
        },
      )
    }
  }
})

/**
 * D1-F14, D1-F13, D3-F12 and D3-F13: the passes that used to have no executor.
 * The GL side of each is the real shader, replayed frame by frame; the CPU side
 * is `runCpuPasses`. If a mask kind's two evaluations drift, or a retouch
 * kernel's constants stop matching, or the background image stops being placed
 * the same way, one of these fails.
 */
describe('masks and local adjustments (D1-F14)', () => {
  const size: Size = { width: 64, height: 48 }
  const source = fixture(size.width, size.height)
  const VALUES = { exposure: 0.35, contrast: 20, saturation: -25, warmth: 14, tint: 8 }

  const masks: [string, Mask][] = [
    ['subject', { id: 'm-subject', kind: 'subject', enabled: true, feather: 0.4 }],
    [
      'brush',
      {
        id: 'm-brush',
        kind: 'brush',
        enabled: true,
        feather: 0,
        strokes: [
          {
            points: [
              { x: 0.2, y: 0.3 },
              { x: 0.7, y: 0.7 },
            ],
            radius: 0.18,
            hardness: 0.5,
          },
          {
            points: [{ x: 0.4, y: 0.4 }],
            radius: 0.12,
            hardness: 1,
            erase: true,
          },
        ],
      },
    ],
    [
      'linear',
      {
        id: 'm-linear',
        kind: 'linear',
        enabled: true,
        feather: 0.6,
        from: { x: 0.15, y: 0.2 },
        to: { x: 0.8, y: 0.9 },
      },
    ],
    [
      'radial',
      {
        id: 'm-radial',
        kind: 'radial',
        enabled: true,
        feather: 0.7,
        center: { x: 0.5, y: 0.5 },
        radiusX: 0.3,
        radiusY: 0.45,
        rotation: 25,
        invert: false,
      },
    ],
    [
      'radial inverted',
      {
        id: 'm-radial-inv',
        kind: 'radial',
        enabled: true,
        feather: 0.3,
        center: { x: 0.4, y: 0.6 },
        radiusX: 0.5,
        radiusY: 0.2,
        rotation: -40,
        invert: true,
      },
    ],
    [
      'luminance',
      {
        id: 'm-luma',
        kind: 'luminance',
        enabled: true,
        feather: 0.5,
        low: 0.2,
        high: 0.7,
        invert: false,
      },
    ],
    [
      'luminance inverted',
      {
        id: 'm-luma-inv',
        kind: 'luminance',
        enabled: true,
        feather: 0,
        low: 0.1,
        high: 0.5,
        invert: true,
      },
    ],
  ]

  for (const [label, mask] of masks) {
    it(`GL and CPU agree within 2/255 for a local adjustment on a ${label} mask`, () => {
      const doc = maskedDoc(mask, VALUES)
      const { pixels: gl, draws } = glImage(doc, size, source)
      // The mask really was rasterised: one extra draw for MASK_FRAG.
      expect(draws).toBeGreaterThan(0)
      expect(meanAbsDiff(gl, cpuImage(doc, size, source))).toBeLessThan(TOLERANCE)
    })
  }

  it('applies the adjustment inside the mask and leaves the outside alone', () => {
    const mask: Mask = {
      id: 'm-hard',
      kind: 'radial',
      enabled: true,
      feather: 0,
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.15,
      radiusY: 0.15,
      rotation: 0,
      invert: false,
    }
    const doc = maskedDoc(mask, { exposure: 1 })
    const masked = glImage(doc, size, source).pixels
    const bare = glImage(docWith(), size, source).pixels
    const changed = (x: number, y: number) => {
      const i = (y * size.width + x) * 4
      return Math.abs(masked.data[i]! - bare.data[i]!)
    }
    expect(changed(32, 24)).toBeGreaterThan(2)
    expect(changed(1, 1)).toBe(0)
  })

  it('plans a mask and a local adjust, and hashes both of them', () => {
    const doc = maskedDoc(masks[3]![1], VALUES)
    const passes = planPasses(doc, size)
    expect(passes.filter((pass) => pass.kind === 'local')).toHaveLength(1)
    const feathered = maskedDoc(
      { ...(masks[3]![1] as Extract<Mask, { kind: 'radial' }>), feather: 0.9 },
      VALUES,
    )
    expect(planPasses(feathered, size)).not.toEqual(passes)
  })

  it('skips a local adjust whose mask is missing or disabled', () => {
    const orphan = docWith({
      localAdjusts: [{ id: 'la', maskId: 'nope', enabled: true, values: { exposure: 1 } }],
    })
    expect(planPasses(orphan, size).filter((pass) => pass.kind === 'local')).toHaveLength(0)
    const disabled = maskedDoc(masks[3]![1], VALUES)
    disabled.masks[0] = { ...disabled.masks[0]!, enabled: false }
    expect(planPasses(disabled, size).filter((pass) => pass.kind === 'local')).toHaveLength(0)
  })

  it('drops a local sharpness, which no masked kernel can honour', () => {
    const doc = maskedDoc(masks[3]![1], { sharpness: 60, noiseReduction: 40, exposure: 0.2 })
    const local = planPasses(doc, size).find((pass) => pass.kind === 'local')
    expect(local).toBeTruthy()
    expect(local && 'values' in local && local.values).toEqual({ exposure: 0.2 })
  })

  it('no longer gates the local family on Canvas2D', () => {
    expect(CANVAS2D_SUPPORT.local).toBe(true)
    const doc = maskedDoc(masks[3]![1], VALUES)
    expect(gatedFamilies(planPasses(doc, size))).toEqual([])
  })
})

describe('retouch (D1-F13)', () => {
  const size: Size = { width: 64, height: 48 }
  const source = fixture(size.width, size.height)

  it('matches for skin smoothing', () => {
    const doc = docWith({ retouch: { smooth: 70, healSpots: [], redEye: [] } })
    const { pixels: gl, uniforms } = glImage(doc, size, source)
    expect(uniforms).toContain('u_smooth')
    expect(meanAbsDiff(gl, cpuImage(doc, size, source))).toBeLessThan(TOLERANCE)
  })

  it('matches for heal spots', () => {
    const doc = docWith({
      retouch: {
        smooth: 0,
        healSpots: [
          { id: 'h1', at: { x: 0.4, y: 0.5 }, radius: 0.18 },
          { id: 'h2', at: { x: 0.8, y: 0.3 }, radius: 0.12 },
        ],
        redEye: [],
      },
    })
    expect(
      meanAbsDiff(glImage(doc, size, source).pixels, cpuImage(doc, size, source)),
    ).toBeLessThan(TOLERANCE)
  })

  it('matches for red-eye', () => {
    const doc = docWith({
      retouch: {
        smooth: 0,
        healSpots: [],
        redEye: [{ at: { x: 0.35, y: 0.6 }, radius: 0.1 }],
      },
    })
    expect(
      meanAbsDiff(glImage(doc, size, source).pixels, cpuImage(doc, size, source)),
    ).toBeLessThan(TOLERANCE)
  })

  it('matches for all three at once, in plan order', () => {
    const doc = docWith({
      retouch: {
        smooth: 55,
        healSpots: [{ id: 'h1', at: { x: 0.5, y: 0.45 }, radius: 0.15 }],
        redEye: [
          { at: { x: 0.3, y: 0.3 }, radius: 0.08 },
          { at: { x: 0.7, y: 0.7 }, radius: 0.08 },
        ],
      },
    })
    const kinds = planPasses(doc, size)
      .map((pass) => pass.kind)
      .filter((kind) => kind === 'retouch' || kind === 'heal' || kind === 'redeye')
    expect(kinds).toEqual(['retouch', 'heal', 'redeye', 'redeye'])
    expect(
      meanAbsDiff(glImage(doc, size, source).pixels, cpuImage(doc, size, source)),
    ).toBeLessThan(TOLERANCE)
  })

  it('plans nothing for an untouched document', () => {
    const doc = createDoc()
    const kinds = planPasses(doc, size).map((pass) => pass.kind)
    expect(kinds).not.toContain('retouch')
    expect(kinds).not.toContain('heal')
    expect(kinds).not.toContain('redeye')
  })

  it('gates no retouch family on Canvas2D', () => {
    expect(CANVAS2D_SUPPORT.retouch).toBe(true)
    expect(CANVAS2D_SUPPORT.heal).toBe(true)
    expect(CANVAS2D_SUPPORT.redeye).toBe(true)
  })
})

describe('background image, fit and blur (D3-F12)', () => {
  const size: Size = { width: 64, height: 48 }

  /** A frame with a soft alpha disc, so a background actually shows through. */
  function cutout(width: number, height: number): Pixels {
    const pixels = makePixels(width, height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        pixels.data[i] = 40 + ((x * 3) % 180)
        pixels.data[i + 1] = 60 + ((y * 5) % 160)
        pixels.data[i + 2] = 90
        // Opaque in the middle, transparent at the edges: the corners are where
        // a background has to show through.
        const d = Math.hypot(x - width / 2, y - height / 2) / (width / 2)
        pixels.data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.85 - d)))
      }
    }
    return pixels
  }

  const source = cutout(size.width, size.height)
  const image = (() => {
    // A 2:1 image on a 4:3 frame: cover crops the sides, contain letterboxes
    // them, so the two really do place the image somewhere different.
    const pixels = makePixels(40, 20)
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        const i = (y * 40 + x) * 4
        // A high-frequency pattern, not a ramp: a blur cannot reduce the
        // variance of a linear ramp, so a ramp would make the blur test pass
        // for the wrong reason.
        pixels.data[i] = ((x * 37) ^ (y * 17)) % 256
        pixels.data[i + 1] = ((x * 11) ^ (y * 29)) % 256
        pixels.data[i + 2] = ((x * 5) ^ (y * 23)) % 256
        pixels.data[i + 3] = 255
      }
    }
    return pixels
  })()

  function backgroundDoc(patch: Partial<Doc['background']>): Doc {
    return docWith({
      background: {
        ...createDoc().background,
        mode: 'image',
        imageAssetId: 'bg1',
        color: '#204080',
        removed: true,
        ...patch,
      },
      output: { ...createDoc().output, format: 'png' },
    })
  }

  for (const fit of ['cover', 'contain'] as const) {
    it(`GL and CPU agree within 2/255 for a ${fit} background image`, () => {
      const doc = backgroundDoc({ fit, blur: 0 })
      const { pixels: gl, uniforms } = glImage(doc, size, source, { backgroundImage: image })
      expect(uniforms).toContain('u_bgImage')
      expect(uniforms).toContain('u_fit')
      expect(meanAbsDiff(gl, cpuImage(doc, size, source, { backgroundImage: image }))).toBeLessThan(
        TOLERANCE,
      )
    })
  }

  it('GL and CPU agree for a blurred background image', () => {
    const doc = backgroundDoc({ fit: 'cover', blur: 0.8 })
    expect(
      meanAbsDiff(
        glImage(doc, size, source, { backgroundImage: image }).pixels,
        cpuImage(doc, size, source, { backgroundImage: image }),
      ),
    ).toBeLessThan(TOLERANCE)
  })

  it('cover and contain place the image differently', () => {
    const cover = glImage(backgroundDoc({ fit: 'cover' }), size, source, {
      backgroundImage: image,
    }).pixels
    const contain = glImage(backgroundDoc({ fit: 'contain' }), size, source, {
      backgroundImage: image,
    }).pixels
    expect(meanAbsDiff(cover, contain)).toBeGreaterThan(0.02 * 255)
  })

  it('blur measurably reduces the local variance of the background', () => {
    // Measured on the CPU pipeline at scale 1, where a full-strength blur is a
    // 12 px radius; the agreement tests above are what make this side the thing
    // to measure on. The window is the top-left corner, which the cutout leaves
    // fully transparent, so every value in it came out of the background image.
    const blur = (amount: number) => {
      const doc = backgroundDoc({ fit: 'cover', blur: amount })
      const matrix = computeOutputToSource(doc, size, size)
      const passes = withLeadingGeometry(planPasses(doc, size, matrix), matrix)
      const geometry = projectiveResample(source, matrix, size.width, size.height, size, true)
      return runCpuPasses(geometry, passes, { pixelScale: 1, backgroundImage: image }).pixels
    }
    const stdev = (pixels: Pixels) => {
      const values: number[] = []
      for (let y = 0; y < 10; y += 1) {
        for (let x = 0; x < 10; x += 1) {
          const i = (y * pixels.width + x) * 4
          values.push(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!)
        }
      }
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    }
    // A full-strength blur is an 8 px radius on this frame, so a 10 px window
    // loses a quarter of its spread — measurable, and it is the only thing the
    // blur does.
    expect(stdev(blur(0))).toBeGreaterThan(25)
    expect(stdev(blur(1))).toBeLessThan(stdev(blur(0)) * 0.8)
  })
})

// --- D3-F23: the output transfer ----------------------------------------------

/** The one quantisation step in the chain, with the dither dialled in or out. */
function outputPlan(doc: Doc, dither: number): Pass[] {
  const size = { width: 32, height: 32 }
  const passes = withLeadingGeometry(planPasses(doc, size), computeOutputToSource(doc, size, size))
  return passes.map((pass) => (pass.kind === 'output' ? { ...pass, dither } : pass))
}

function runCpuReference(source: Pixels, doc: Doc, size: Size, passes: Pass[]): Pixels {
  const geometry = projectiveResample(
    source,
    computeOutputToSource(doc, { width: source.width, height: source.height }, size),
    size.width,
    size.height,
    { width: source.width, height: source.height },
    leadingGeometryClamp(passes),
  )
  return runCpuPasses(geometry, passes, { pixelScale: 1 }).pixels
}

function runBoth(
  source: Pixels,
  doc: Doc,
  size: Size,
  passes: Pass[],
): { gl: Pixels; cpu: Pixels } {
  let glPixels!: Pixels
  const harness = installFakeGl2()
  try {
    const renderer = new GlRenderer(document.createElement('canvas'))
    renderer.render({
      doc,
      size,
      source: source as unknown as TexImageSource,
      sourceSize: { width: source.width, height: source.height },
    })
    glPixels = replayGlFrames(source, harness.gl.drawFrames, { curves: doc.curves }).pixels
  } finally {
    harness.restore()
  }
  const geometry = projectiveResample(
    source,
    computeOutputToSource(doc, { width: source.width, height: source.height }, size),
    size.width,
    size.height,
    { width: source.width, height: source.height },
    leadingGeometryClamp(passes),
  )
  const cpu = runCpuPasses(geometry, passes, { pixelScale: 1 }).pixels
  return { gl: glPixels, cpu }
}

describe('D3-F23: the output transfer is the same picture in both engines', () => {
  const SIZE: Size = { width: 32, height: 32 }

  function ramp(size: Size, at: (x: number, y: number) => number[]): Pixels {
    const source = makePixels(size.width, size.height)
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const i = (y * size.width + x) * 4
        const [r, g, b, a] = at(x, y)
        source.data[i] = r
        source.data[i + 1] = g
        source.data[i + 2] = b
        source.data[i + 3] = a
      }
    }
    return source
  }

  it('dithers the same way on both sides', () => {
    // Where a dither is worth anything at all: the output of a byte buffer is
    // always exactly on a byte boundary, and `round(byte + 0.49)` is the byte
    // again. Every pass in this chain writes eight bits, so a value that has
    // been through one is on the grid. What puts a value *between* bytes is
    // the output pass computing one - the matte composite every JPEG and PDF
    // export goes through. A dither that is live there is live on a real
    // export path, not on a contrived one.
    const source = ramp(SIZE, () => [200, 100, 50, 128])
    const doc = createDoc()
    doc.output.format = 'jpeg'
    doc.output.matte = '#204060'
    const on = runBoth(source, doc, SIZE, outputPlan(doc, DITHER_LSB))
    // The reference the dither is measured against, on the CPU only: the
    // renderer plans from the document, so its output pass always dithers and
    // there is no way to ask it for an un-dithered frame.
    const off = runCpuReference(source, doc, SIZE, outputPlan(doc, 0))
    expect(meanAbsDiff(on.gl, on.cpu)).toBeLessThanOrEqual(2 / 255)
    // The shader is dithering, and it is dithering the same way the twin is:
    // an undithered CPU run is the thing the GL frame has to differ from.
    expect([...on.gl.data]).not.toEqual([...off.data])
    expect([...on.cpu.data]).toEqual([...on.gl.data])
    // And a dither that moved a byte by more than one would be doing the
    // quantisation's job twice, in both engines.
    for (let i = 0; i < on.cpu.data.length; i += 1) {
      expect(Math.abs(on.cpu.data[i]! - off.data[i]!)).toBeLessThanOrEqual(1)
    }
  })

  it('dithers a tiled render against the whole frame, not the tile', () => {
    // A pattern that restarted at each tile origin is the artefact this guards
    // against: a seam every eight pixels along every tile edge of a large
    // export. The same tile drawn at two origins has to land on the pattern its
    // own place in the frame gets.
    const FRAME: Size = { width: 48, height: 8 }
    const TILE: Size = { width: 32, height: 8 }
    const doc = createDoc()
    doc.output.format = 'jpeg'
    doc.output.matte = '#204060'
    const flat = (size: Size): Pixels => {
      const p = makePixels(size.width, size.height)
      for (let i = 0; i < p.data.length; i += 4) {
        p.data[i] = 200
        p.data[i + 1] = 100
        p.data[i + 2] = 50
        p.data[i + 3] = 128
      }
      return p
    }
    const draw = (input: Pixels, origin: { x: number; y: number }) =>
      runCpuPasses(input, planPasses(doc, input), { pixelScale: 1, origin, frame: FRAME }).pixels
    const whole = draw(flat(FRAME), { x: 0, y: 0 })
    const atZero = draw(flat(TILE), { x: 0, y: 0 })
    // x = 3, not x = 16: the matrix is eight pixels on a side, so an offset
    // that is a multiple of eight lands on the identical pattern and the
    // comparison below would pass whether or not the origin was read at all.
    const atThree = draw(flat(TILE), { x: 3, y: 0 })
    // The frame is row-major, so a run of columns is not a contiguous byte
    // range and has to be read out pixel by pixel.
    const column = (p: Pixels, frame: Size, x: number, y: number) =>
      [...p.data].slice((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 4)
    const window = (p: Pixels, frame: Size, x0: number) => {
      const out: number[][] = []
      for (let y = 0; y < TILE.height; y += 1) {
        for (let x = 0; x < TILE.width; x += 1) out.push(column(p, frame, x + x0, y))
      }
      return out
    }
    expect(window(atZero, TILE, 0)).toEqual(window(whole, FRAME, 0))
    expect(window(atThree, TILE, 0)).toEqual(window(whole, FRAME, 3))
    expect([...atZero.data]).not.toEqual([...atThree.data])
    // And exactly which threshold was used, byte for byte. The source is flat,
    // so the only things deciding these bytes are the matte composite and the
    // threshold the dither picked for that pixel of the whole frame.
    const matte = hexToRgb('#204060')
    const alpha = 128 / 255
    const composited = ([200, 100, 50] as const).map(
      (channel, i) => (matte[i]! + (channel / 255 - matte[i]!) * alpha) * 255,
    )
    for (let y = 0; y < TILE.height; y += 1) {
      for (let x = 0; x < TILE.width; x += 1) {
        const offset = (y * TILE.width + x) * 4
        const dither = ditherOffsetLsb(x + 3, y, DITHER_LSB)
        for (let channel = 0; channel < 3; channel += 1) {
          expect(atThree.data[offset + channel], `(${x},${y}) channel ${channel}`).toBe(
            Math.round(composited[channel]! + dither),
          )
        }
      }
    }
  })

  it('gives the output pass three different results, not three source shapes', () => {
    // The three branches this replaced were asserted by matching text out of
    // the shader, which proves nothing about the picture it draws.
    const source = ramp({ width: 4, height: 4 }, () => [200, 100, 50, 128])
    const render = (mutate: (doc: Doc) => void) => {
      const doc = createDoc()
      mutate(doc)
      return runCpuPasses(source, planPasses(doc, { width: 4, height: 4 }), { pixelScale: 1 })
        .pixels
    }
    const transparent = render((doc) => {
      doc.output.format = 'png'
    })
    const onWhite = render((doc) => {
      doc.output.format = 'jpeg'
      doc.output.matte = '#ffffff'
    })
    const onRed = render((doc) => {
      doc.output.format = 'jpeg'
      doc.output.matte = '#ff0000'
    })
    // png keeps the source alpha and its colour untouched.
    expect(transparent.data[3]).toBe(128)
    expect(transparent.data[0]).toBe(200)
    // jpeg flattens onto the matte at the source alpha, so the matte is visible
    // and the two mattes are two different pictures.
    expect(onWhite.data[3]).toBe(255)
    expect(onRed.data[3]).toBe(255)
    // Green, not red: both mattes are fully red, so the red channel composites
    // to the same value either way and only green can tell them apart.
    expect(onWhite.data[0]).toBeGreaterThan(200)
    expect(onRed.data[1]).toBeLessThan(onWhite.data[1]!)
    expect([...transparent.data]).not.toEqual([...onWhite.data])
  })

  it('keeps a white pixel white, through the whole pass chain, in both engines', () => {
    // The regression, at the level the user sees it: a document with any tone
    // adjustment on runs TONE_FRAG, and a pure-white pixel used to leave it at
    // 242/255 — in both engines, because both ran the same wrong knee. A white
    // sky over a person by the sea exported as light grey.
    const size: Size = { width: 16, height: 8 }
    for (const [label, edit, from250] of [
      ['exposure +0.5 EV', (d: Doc) => (d.adjust.exposure = 0.5), 255],
      ['brightness +2', (d: Doc) => (d.adjust.brightness = 2), 251],
      ['contrast +10', (d: Doc) => (d.adjust.contrast = 10), 255],
    ] as const) {
      const doc = createDoc()
      edit(doc)
      // 255 is the pixel, 250 the near-white one beside it. 250 came out at 240
      // and 255 at 242, so the top of every sky lost two visible steps. Only
      // exposure and contrast lift 250 past 1.0; brightness +2 is worth 0.005,
      // which is a real edit and must leave 250 at 251.
      for (const sourceLevel of [255, 250] as const) {
        const source = ramp(size, () => [sourceLevel, sourceLevel, sourceLevel, 255])
        const { gl, cpu } = runBoth(source, doc, size, planPasses(doc, size))
        const expected = sourceLevel === 255 ? 255 : from250
        expect(meanAbsDiff(gl, cpu), label).toBeLessThanOrEqual(TOLERANCE)
        for (let i = 0; i < cpu.data.length; i += 4) {
          for (let c = 0; c < 3; c += 1) {
            expect(cpu.data[i + c], `cpu ${label} @${sourceLevel} byte ${i + c}`).toBe(expected)
            expect(gl.data[i + c], `gl ${label} @${sourceLevel} byte ${i + c}`).toBe(expected)
          }
          // Alpha is not the tone stage's business, and a white pixel that came
          // out opaque must not have been composited on the way.
          expect(cpu.data[i + 3]).toBe(255)
          expect(gl.data[i + 3]).toBe(255)
        }
      }
    }
  })

  it('compresses a blown highlight instead of clipping it flat', () => {
    // Through the tone stage, which is the only pass that ever runs a value
    // past 1.0. The source is 8-bit, so the over-range is made by the exposure
    // the way a user would make it: a bright ramp lifted a stop, the top half
    // of which used to land on one flat 255.
    const size: Size = { width: 16, height: 8 }
    const source = ramp(size, (x) => [
      Math.round(255 * (0.5 + (0.5 * x) / (size.width - 1))),
      0,
      0,
      255,
    ])
    const doc = createDoc()
    doc.adjust.exposure = 0.5
    const { gl, cpu } = runBoth(source, doc, size, planPasses(doc, size))
    expect(meanAbsDiff(gl, cpu)).toBeLessThanOrEqual(2 / 255)
    const reds: number[] = []
    for (let x = 0; x < size.width; x += 1) {
      reds.push(cpu.data[(4 * size.width + x) * 4]!)
    }
    // The top half of the ramp is over-range after the exposure. At eight bits
    // every one of those pixels is display white — that is what the clamp is
    // for, and it is why the distinction this curve draws has to be asserted on
    // the curve itself (`filmicShoulder`, in src/lib/tonemap.test.ts and
    // glsl-eval.test.ts) and not here. What is assertable at this level is the
    // part the user can still see: the in-gamut ramp in front of the knee is
    // untouched and still strictly rising, and nothing overshoots.
    const firstWhite = reds.indexOf(255)
    expect(firstWhite).toBeGreaterThan(4)
    for (let i = 1; i < firstWhite; i += 1) {
      expect(reds[i]!, `flat at ${i}`).toBeGreaterThan(reds[i - 1]!)
    }
    expect(new Set(reds.slice(0, firstWhite)).size).toBe(firstWhite)
    expect(Math.max(...reds)).toBeLessThanOrEqual(255)
  })
})
