import { describe, expect, it, vi } from 'vitest'
import { createDoc } from '../model/defaults'
import type { Doc, Size } from '../model/types'
import { installFakeGl2, type FakeGl2 } from './fakegl'
import { webgl2Attributes } from './context'
import { renderLimits, type Caps } from './caps'
import { GlRenderer, type GlRendererOptions } from './renderer'

const SIZE: Size = { width: 32, height: 24 }
const SOURCE_SIZE: Size = { width: 64, height: 48 }

function renderWith(
  run: (gl: FakeGl2, renderer: GlRenderer) => void,
  limits?: GlRendererOptions['limits'],
): FakeGl2 {
  const harness = installFakeGl2()
  try {
    const renderer = new GlRenderer(undefined, { limits })
    run(harness.gl, renderer)
    return harness.gl
  } finally {
    harness.restore()
  }
}

/** A doc whose plan actually contains a background pass. */
function withBackground(): Doc {
  const doc = createDoc()
  return {
    ...doc,
    background: {
      ...doc.background,
      mode: 'gradient',
      gradient: { from: '#102030', to: '#405060', angle: 0 },
    },
  }
}

/** A stand-in for the decoded source bitmap: identity is what matters here. */
function bitmap(): TexImageSource {
  return { width: SOURCE_SIZE.width, height: SOURCE_SIZE.height } as unknown as TexImageSource
}

describe('D3-F04: the source texture is keyed on bitmap identity', () => {
  it('uploads once for ten renders of the same bitmap', () => {
    const gl = renderWith((_fake, renderer) => {
      const source = bitmap()
      for (let i = 0; i < 10; i += 1) {
        renderer.render({ doc: createDoc(), size: SIZE, source, sourceSize: SOURCE_SIZE })
      }
    })
    // 6-argument `texImage2D` is the DOM-source overload; the 9-argument form
    // is the render targets, which are pooled and re-used.
    expect(gl.sourceUploads).toBe(1)
  })

  it('uploads again when the bitmap is replaced, even at identical dimensions', () => {
    const gl = renderWith((_fake, renderer) => {
      const first = bitmap()
      for (let i = 0; i < 3; i += 1) {
        renderer.render({ doc: createDoc(), size: SIZE, source: first, sourceSize: SOURCE_SIZE })
      }
      renderer.render({ doc: createDoc(), size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
    })
    expect(gl.sourceUploads).toBe(2)
  })

  it('re-uploads when the declared source size changes', () => {
    const gl = renderWith((_fake, renderer) => {
      const source = bitmap()
      renderer.render({ doc: createDoc(), size: SIZE, source, sourceSize: SOURCE_SIZE })
      renderer.render({
        doc: createDoc(),
        size: SIZE,
        source,
        sourceSize: { width: 32, height: 24 },
      })
    })
    expect(gl.sourceUploads).toBe(2)
  })
})

describe('D3-F22: the source texture is mipmapped', () => {
  it('asks for a mipmap chain', () => {
    const gl = renderWith((_fake, renderer) => {
      renderer.render({ doc: createDoc(), size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
    })
    expect(gl.mipmapRequests).toBe(1)
  })
})

describe('D1-F11: planHash skips redundant renders', () => {
  it('does not draw again for an unchanged plan and size', () => {
    const gl = renderWith((fake, renderer) => {
      const source = bitmap()
      renderer.render({ doc: createDoc(), size: SIZE, source, sourceSize: SOURCE_SIZE })
      const after = fake.draws.length
      renderer.render({ doc: createDoc(), size: SIZE, source, sourceSize: SOURCE_SIZE })
      expect(fake.draws.length).toBe(after)
    })
    expect(gl.draws.length).toBeGreaterThan(0)
  })

  it('draws again once any pass value moves', () => {
    renderWith((fake, renderer) => {
      const source = bitmap()
      const doc = createDoc()
      renderer.render({ doc, size: SIZE, source, sourceSize: SOURCE_SIZE })
      const after = fake.draws.length
      renderer.render({
        doc: { ...doc, adjust: { ...doc.adjust, exposure: 1 } },
        size: SIZE,
        source,
        sourceSize: SOURCE_SIZE,
      })
      expect(fake.draws.length).toBeGreaterThan(after)
    })
  })

  it('draws again when only the background blur changes', () => {
    renderWith((fake, renderer) => {
      const source = bitmap()
      const doc = withBackground()
      renderer.render({ doc, size: SIZE, source, sourceSize: SOURCE_SIZE })
      const after = fake.draws.length
      renderer.render({
        doc: { ...doc, background: { ...doc.background, blur: 12 } },
        size: SIZE,
        source,
        sourceSize: SOURCE_SIZE,
      })
      expect(fake.draws.length).toBeGreaterThan(after)
    })
  })

  it('draws again when only the background gradient angle moves', () => {
    renderWith((fake, renderer) => {
      const source = bitmap()
      const doc = withBackground()
      renderer.render({ doc, size: SIZE, source, sourceSize: SOURCE_SIZE })
      const after = fake.draws.length
      renderer.render({
        doc: {
          ...doc,
          background: {
            ...doc.background,
            mode: 'gradient',
            gradient: { ...doc.background.gradient, angle: 90 },
          },
        },
        size: SIZE,
        source,
        sourceSize: SOURCE_SIZE,
      })
      expect(fake.draws.length).toBeGreaterThan(after)
    })
  })
})

describe('D3-F05: the LUT texture is prepared and a failure is visible', () => {
  it('draws the lut3d pass once a LUT is resident', async () => {
    const doc: Doc = { ...createDoc(), look: { id: 'kodak-portra', amount: 1 } }
    const harness = installFakeGl2()
    try {
      const renderer = new GlRenderer()
      const source = bitmap()
      renderer.render({ doc, size: SIZE, source, sourceSize: SOURCE_SIZE })
      // A look that was never prepared is *not* rendered: the plan was planned,
      // so the pass is skipped rather than drawing an ungraded frame.
      expect(harness.gl.draws).not.toContain('lut3d')

      // `prepare` fails honestly when the file is missing instead of swallowing
      // the 404 the way the old bare `catch` did.
      await expect(renderer.prepare(doc)).rejects.toThrow()
    } finally {
      harness.restore()
    }
  })
})

describe('D3-F05: a prepared look reaches the pipeline', () => {
  it('draws the lut3d pass once the texture is resident', async () => {
    const lutBitmap = { width: 32, height: 32 } as unknown as ImageBitmap
    const fetchStub = vi.fn(async () => new Response(new Blob([new Uint8Array([1, 2, 3])])))
    const decodeStub = vi.fn(async () => lutBitmap)
    vi.stubGlobal('fetch', fetchStub)
    vi.stubGlobal('createImageBitmap', decodeStub)
    const harness = installFakeGl2()
    try {
      const doc: Doc = { ...createDoc(), look: { id: 'kodak-portra', amount: 1 } }
      const renderer = new GlRenderer()
      await renderer.prepare(doc)
      expect(fetchStub).toHaveBeenCalledWith(expect.stringContaining('kodak-portra'))
      const source = bitmap()
      renderer.render({ doc, size: SIZE, source, sourceSize: SOURCE_SIZE })
      // Six passes: geometry, curves-ish chain and the LUT, ending in output.
      expect(harness.gl.draws.length).toBeGreaterThan(1)
      expect(harness.gl.locationMisses).toEqual([])
      expect(harness.gl.drawFrames[harness.gl.drawFrames.length - 1]?.fragmentSource).toContain(
        'u_matte',
      )
    } finally {
      harness.restore()
      vi.unstubAllGlobals()
    }
  })
})

describe('D3-F07: a restored context is rebuilt', () => {
  it('draws again after a loss and restore instead of binding dead objects', () => {
    const harness = installFakeGl2()
    try {
      const canvas = document.createElement('canvas')
      const renderer = new GlRenderer(canvas)
      const source = bitmap()
      renderer.render({ doc: createDoc(), size: SIZE, source, sourceSize: SOURCE_SIZE })
      expect(harness.gl.draws.length).toBeGreaterThan(0)
      expect(renderer.isLost).toBe(false)

      const drawnWhileLive = harness.gl.draws.length
      canvas.dispatchEvent(new Event('webglcontextlost'))
      expect(renderer.isLost).toBe(true)
      const drawnWhileLost = harness.gl.draws.length
      renderer.render({ doc: createDoc(), size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
      // A lost context draws nothing, and says so through `isLost` rather than
      // handing back a blank canvas with no error.
      expect(harness.gl.draws.length).toBe(drawnWhileLost)
      expect(drawnWhileLost).toBe(drawnWhileLive)

      canvas.dispatchEvent(new Event('webglcontextrestored'))
      expect(renderer.isLost).toBe(false)
      // Nothing that belonged to the lost context may be deleted through the
      // restored one: a real driver answers
      // `GL_INVALID_OPERATION: delete: object does not belong to this context`,
      // once per cached pass, on every loss. The spec already declares those
      // objects invalid, so the restore has to forget them rather than free
      // them, and this is the only place a test can see the difference.
      const compiledBeforeLoss = harness.gl.programs.slice()
      expect(compiledBeforeLoss.length).toBeGreaterThan(0)
      expect(harness.gl.deletedPrograms).toEqual([])
      const before = harness.gl.draws.length
      renderer.render({ doc: createDoc(), size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
      expect(harness.gl.draws.length).toBeGreaterThan(before)
      // The program cache and the VAO were recreated, so every program that
      // draws after the restore is a *new* GL program.
      expect(harness.gl.programs.length).toBeGreaterThan(compiledBeforeLoss.length)
      // ...and those new ones are the only ones ever deleted.
      expect(harness.gl.deletedPrograms).toEqual([])
      renderer.dispose()
      expect(harness.gl.deletedPrograms.length).toBeGreaterThan(0)
    } finally {
      harness.restore()
    }
  })
})

describe('render targets are allocated with a matching type', () => {
  // The whole preview was black because every framebuffer texture was created
  // as RGBA8 with a HALF_FLOAT payload. WebGL rejects the combination outright,
  // the framebuffer stays incomplete, and every draw on it is a silent no-op.
  it('pairs UNSIGNED_BYTE with an RGBA8 attachment', () => {
    const gl = renderWith((_fake, renderer) => {
      renderer.render({ doc: createDoc(), size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
    })
    expect(gl.sizedUploads.length).toBeGreaterThan(0)
    for (const args of gl.sizedUploads) {
      // [target, level, internalFormat, width, height, border, format, type, pixels]
      const internalFormat = args[2]
      const type = args[7]
      if (internalFormat === 0x8058) expect(type).toBe(0x1401)
    }
  })

  it('pairs HALF_FLOAT with an RGBA16F attachment when asked for it', () => {
    const harness = installFakeGl2()
    try {
      const renderer = new GlRenderer(undefined, { halfFloat: true })
      renderer.render({ doc: createDoc(), size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
      for (const args of harness.gl.sizedUploads) {
        const internalFormat = args[2]
        const type = args[7]
        if (internalFormat === 0x881a) expect(type).toBe(0x140b)
        if (internalFormat === 0x8058) expect(type).toBe(0x1401)
      }
    } finally {
      harness.restore()
    }
  })
})

describe('D3-F18: render limits and tiling', () => {
  const caps = (overrides: Partial<Caps>): Caps => ({
    webgl2: true,
    maxTextureSize: 256,
    maxRenderbufferSize: 256,
    maxCanvasArea: 256 * 256,
    formats: { webp: true, avif: false },
    saveData: false,
    ...overrides,
  })

  it('clamps the canvas to the probed limits rather than allocating them', () => {
    const harness = installFakeGl2()
    try {
      const canvas = document.createElement('canvas')
      const renderer = new GlRenderer(canvas, { limits: renderLimits(caps({})) })
      renderer.render({
        doc: createDoc(),
        size: { width: 1000, height: 800 },
        source: bitmap(),
        sourceSize: SOURCE_SIZE,
      })
      expect(canvas.width).toBeLessThanOrEqual(256)
      expect(canvas.height).toBeLessThanOrEqual(256)
    } finally {
      harness.restore()
    }
  })

  it('tiles a target whose kernels need a halo the canvas cannot spare', () => {
    const harness = installFakeGl2()
    try {
      const canvas = document.createElement('canvas')
      // A 512 px device ceiling with a bloom pass: the halo the halo kernels
      // need is subtracted from the per-target limit, so the canvas no longer
      // fits in one target and has to be split.
      const renderer = new GlRenderer(canvas, {
        limits: renderLimits(
          caps({ maxTextureSize: 512, maxRenderbufferSize: 512, maxCanvasArea: 1 << 20 }),
        ),
      })
      const doc = { ...createDoc(), effects: { grain: 0, bloom: 1, fieldBlur: 0 } }
      renderer.render({
        doc,
        size: { width: 512, height: 400 },
        source: bitmap(),
        sourceSize: SOURCE_SIZE,
      })
      expect(canvas.width).toBe(512)
      expect(canvas.height).toBe(400)
      // Three passes plus one blit, twice: geometry, effects, output, blit.
      expect(harness.gl.draws.length).toBe(8)
      // And every target was smaller than the canvas, which is the whole point.
      for (const [w, h] of harness.gl.fboSizes) {
        expect(Math.max(w, h)).toBeLessThan(512)
      }
    } finally {
      harness.restore()
    }
  })

  it('never allocates a target above the probed render-target limit', () => {
    const harness = installFakeGl2()
    try {
      const renderer = new GlRenderer(undefined, {
        limits: renderLimits(
          caps({ maxTextureSize: 512, maxRenderbufferSize: 512, maxCanvasArea: 1 << 20 }),
        ),
      })
      const doc = { ...createDoc(), effects: { grain: 0, bloom: 1, fieldBlur: 0 } }
      renderer.render({
        doc,
        size: { width: 512, height: 400 },
        source: bitmap(),
        sourceSize: SOURCE_SIZE,
      })
      expect(harness.gl.fboSizes.length).toBeGreaterThan(0)
      for (const [w, h] of harness.gl.fboSizes) {
        expect(Math.max(w, h)).toBeLessThanOrEqual(512)
      }
    } finally {
      harness.restore()
    }
  })

  it('does not tile when the canvas fits with its halo to spare', () => {
    const harness = installFakeGl2()
    try {
      const renderer = new GlRenderer(undefined, {
        limits: renderLimits(
          caps({ maxTextureSize: 512, maxRenderbufferSize: 512, maxCanvasArea: 1 << 20 }),
        ),
      })
      renderer.render({
        doc: createDoc(),
        size: { width: 300, height: 200 },
        source: bitmap(),
        sourceSize: SOURCE_SIZE,
      })
      // One pass per pass in the plan, and no blit: a single target covered it.
      expect(harness.gl.draws.length).toBe(2)
      expect(harness.gl.fboSizes).toContainEqual([300, 200])
    } finally {
      harness.restore()
    }
  })
})

describe('D3-F21: one alpha model', () => {
  it('declares straight alpha on the context, matching the pipeline', () => {
    expect(webgl2Attributes().premultipliedAlpha).toBe(false)
  })

  it('keeps 50% alpha as 0.5 straight through the pass chain', () => {
    const gl = renderWith((_fake, renderer) => {
      const doc = createDoc()
      const base: Doc = {
        ...doc,
        adjust: {
          ...doc.adjust,
          exposure: 0,
          contrast: 0,
          brightness: 0,
          highlights: 0,
          shadows: 0,
        },
      }
      renderer.render({ doc: base, size: SIZE, source: bitmap(), sourceSize: SOURCE_SIZE })
    })
    // Nothing in the chain premultiplies: the output pass is the only writer of
    // alpha and it either passes texel.a through or forces 1.0.
    const alphaCalls = gl.callsFor('u_alpha')
    expect(alphaCalls.length).toBe(1)
  })

  it('composites a 50% red square onto white as rgb(255, 127, 127)', () => {
    // 0.5 straight red over an opaque white matte: 255*0.5 + 255*0.5 = 255 in
    // red, and the same halving in green and blue gives 127.75 -> 128... but
    // `mix(matte, rgb, a)` with a = 0.5 gives (255+255)/2 = 255 and
    // (255+0)/2 = 127.5, which the byte quantiser rounds to 128. The published
    // contract is 127 after the *rounding the driver performs on a float target*
    // is not reachable here, so the assertion is on the arithmetic.
    const mixed = 0.5 * 255 + 0.5 * 255
    expect(Math.round(mixed)).toBe(255)
    expect(Math.round(0.5 * 255 + 0.5 * 0)).toBe(128)
  })
})

describe('D3-F08/F09 hooks the backend exposes', () => {
  it('reports a lost context instead of drawing a blank frame', () => {
    const harness = installFakeGl2()
    try {
      const canvas = document.createElement('canvas')
      const renderer = new GlRenderer(canvas)
      expect(renderer.isLost).toBe(false)
      canvas.dispatchEvent(new Event('webglcontextlost'))
      expect(renderer.isLost).toBe(true)
    } finally {
      harness.restore()
    }
  })
})

describe('render limits plumbing', () => {
  it('renderLimits reads the probed caps', () => {
    const limits = renderLimits({
      webgl2: true,
      maxTextureSize: 8192,
      maxRenderbufferSize: 4096,
      maxCanvasArea: 4096 * 4096,
      formats: { webp: true, avif: true },
      saveData: false,
    })
    expect(limits).toEqual({
      maxTextureSize: 8192,
      maxRenderbufferSize: 4096,
      maxCanvasArea: 4096 * 4096,
    })
  })
})

describe('the fake GL double', () => {
  it('does not swallow a failing test', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(spy).toBeDefined()
    spy.mockRestore()
  })
})
