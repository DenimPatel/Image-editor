import { describe, expect, it } from 'vitest'
import { installFakeGl2 } from '../gl/fakegl'
import { GlRenderer } from '../gl/renderer'
import { createDoc } from '../model/defaults'
import type { Doc, Size } from '../model/types'
import { installFake2d, sourceCanvas } from './fake2d'
import { Canvas2dRenderer } from './fallback2d'
import { meanAbsDiff, replayGlFrames } from './gl-replay'
import { makePixels, type Pixels } from './cpu-passes'

const SIZE: Size = { width: 48, height: 36 }
const SOURCE_SIZE: Size = { width: 48, height: 36 }
const TOLERANCE = 2 / 255

function fixture(size: Size = SOURCE_SIZE): Pixels {
  const pixels = makePixels(size.width, size.height)
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const i = (y * size.width + x) * 4
      pixels.data[i] = Math.round(255 * (x / size.width))
      pixels.data[i + 1] = Math.round(255 * (y / size.height))
      pixels.data[i + 2] = Math.round((255 * ((x * 5 + y * 2) % 16)) / 16)
      pixels.data[i + 3] = x % 7 === 0 ? 160 : 255
    }
  }
  return pixels
}

/** A doc with every family the Canvas2D backend claims to support turned on. */
function fullEdit(): Doc {
  const base = createDoc()
  return {
    ...base,
    adjust: {
      ...base.adjust,
      exposure: 0.3,
      contrast: 14,
      saturation: 10,
      warmth: 6,
      highlights: -12,
      shadows: 10,
      noiseReduction: 15,
      definition: 20,
      sharpness: 25,
      vignette: 18,
    },
    hsl: { ...base.hsl, red: { hue: 3, sat: 6, lum: 0 }, blue: { hue: -4, sat: 0, lum: 3 } },
    effects: { grain: 15, bloom: 18, fieldBlur: 12 },
    background: {
      ...base.background,
      mode: 'gradient',
      color: '#101820',
      gradient: { from: '#0b1a3a', to: '#3a0b1a', angle: 45 },
    },
  }
}

/** The GL image, from the real renderer and the real shaders. */
function glImage(
  doc: Doc,
  source: Pixels,
  size: Size = SIZE,
  sourceSize: Size = SOURCE_SIZE,
): Pixels {
  const harness = installFakeGl2()
  try {
    const renderer = new GlRenderer()
    renderer.render({
      doc,
      size,
      source: source as unknown as TexImageSource,
      sourceSize,
    })
    return replayGlFrames(source, harness.gl.drawFrames, { curves: doc.curves }).pixels
  } finally {
    harness.restore()
  }
}

/** The Canvas2D image, straight out of the backend's canvas. */
function canvas2dImage(
  doc: Doc,
  source: Pixels,
  size = SIZE,
  sourceSize: Size = SOURCE_SIZE,
): { pixels: Pixels; degraded: string[]; calls: string[] } {
  const fake = installFake2d()
  try {
    const bitmap = sourceCanvas(source)
    const renderer = new Canvas2dRenderer()
    renderer.render({ doc, size, source: bitmap, sourceSize })
    const data = fake.readCanvas(renderer.canvas)
    const pixels = makePixels(renderer.canvas.width, renderer.canvas.height)
    pixels.data.set(data.subarray(0, pixels.data.length))
    return { pixels, degraded: renderer.degraded, calls: fake.callsFor(renderer.canvas) }
  } finally {
    fake.restore()
  }
}

describe('D3-F10: the Canvas2D backend is the same pipeline', () => {
  it('matches the GL pipeline within 2/255 for a full edit', () => {
    const source = fixture()
    const doc = fullEdit()
    const { pixels } = canvas2dImage(doc, source)
    expect(meanAbsDiff(glImage(doc, source), pixels)).toBeLessThan(TOLERANCE)
  })

  it('matches the GL pipeline through a perspective warp', () => {
    const source = fixture()
    const base = createDoc()
    const doc: Doc = {
      ...base,
      geometry: {
        ...base.geometry,
        perspective: {
          topLeft: { x: 0.06, y: 0 },
          topRight: { x: 0, y: 0.02 },
          bottomRight: { x: 0, y: 0 },
          bottomLeft: { x: -0.05, y: -0.02 },
        },
      },
    }
    const { pixels } = canvas2dImage(doc, source)
    // A Canvas2D setTransform cannot do this: it takes six scalars and drops
    // the projective terms, so perspective was structurally impossible here.
    expect(meanAbsDiff(glImage(doc, source), pixels)).toBeLessThan(TOLERANCE)
  })

  it('renders a crop, a straighten and a flip like the GL pipeline', () => {
    const source = fixture()
    const base = createDoc().geometry
    for (const geometry of [
      { ...base, crop: { x: 0.2, y: 0.2, width: 0.6, height: 0.5 } },
      { ...base, straighten: 0.15 },
      { ...base, flipH: true },
      { ...base, rotate: 90 },
    ]) {
      const doc: Doc = { ...createDoc(), geometry }
      const { pixels } = canvas2dImage(doc, source)
      expect(meanAbsDiff(glImage(doc, source), pixels), JSON.stringify(geometry)).toBeLessThan(
        TOLERANCE,
      )
    }
  })

  it('matches the GL pipeline when the source is larger than the output', () => {
    // The decode used to go through the renderer's own canvas, which is the
    // *output* size. A preview is smaller than the source, so `drawImage` was
    // clipped and `getImageData` read transparent black past the edge — a
    // downscaled Canvas2D frame came out with only a corner of the image in it,
    // and every parity test above missed it because SIZE === SOURCE_SIZE.
    //
    // The crop is what keeps this a *parity* assertion rather than a
    // resampling one: the output is 1:1 with a region of the source, so both
    // engines land on the same texels and the tolerance stays 2/255. A free
    // downscale would compare bilinear against the fake GL's nearest sampling
    // and fail for a reason that has nothing to do with the defect.
    const sourceSize: Size = { width: 96, height: 72 }
    const size: Size = { width: 32, height: 24 }
    const base = fullEdit()
    const doc: Doc = {
      ...base,
      geometry: { ...base.geometry, crop: { x: 0.2, y: 0.25, width: 1 / 3, height: 1 / 3 } },
    }
    const { pixels } = canvas2dImage(doc, fixture(sourceSize), size, sourceSize)
    expect(pixels.width).toBe(size.width)
    expect(pixels.height).toBe(size.height)
    // The whole frame carries image, not just the top-left corner.
    const corner = pixels.data[((size.height - 1) * size.width + (size.width - 1)) * 4]
    expect(corner).toBeGreaterThan(0)
    expect(meanAbsDiff(glImage(doc, fixture(sourceSize), size, sourceSize), pixels)).toBeLessThan(
      TOLERANCE,
    )
  })

  it('gates and reports the families it cannot run', () => {
    const source = fixture()
    const base = createDoc()
    const { degraded } = canvas2dImage({ ...base, look: { id: 'kodak-portra', amount: 1 } }, source)
    expect(degraded).toEqual(['lut3d'])
  })

  it('reports nothing gated for a document it can fully render', () => {
    const source = fixture()
    const { degraded } = canvas2dImage(fullEdit(), source)
    expect(degraded).toEqual([])
  })

  it('no longer leans on ctx.filter, which cannot express the pipeline', () => {
    const source = fixture()
    const { calls } = canvas2dImage(fullEdit(), source)
    expect(calls).not.toContain('putImageData:none')
    // The old implementation painted tone and colour with `ctx.filter` and
    // dropped everything else; the new one writes the whole frame itself.
    expect(calls.filter((call) => call === 'putImageData').length).toBe(1)
  })

  it('resamples through the projective matrix, not a six-scalar transform', () => {
    const source = fixture()
    const fake = installFake2d()
    try {
      const renderer = new Canvas2dRenderer()
      renderer.render({
        doc: createDoc(),
        size: SIZE,
        source: source as unknown as TexImageSource,
        sourceSize: SOURCE_SIZE,
      })
      // A setTransform is still used to reset the context, but the geometry
      // itself is a resample: the frame is one `putImageData` of computed
      // pixels, not a transformed `drawImage`.
      expect(fake.ctx.calls.filter((call) => call === 'drawImage').length).toBe(1)
    } finally {
      fake.restore()
    }
  })
})
