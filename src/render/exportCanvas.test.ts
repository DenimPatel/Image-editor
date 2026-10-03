import { describe, expect, it } from 'vitest'
import { installFakeGl2, type FakeGl2 } from '../gl/fakegl'
import { createDoc } from '../model/defaults'
import type { Doc } from '../model/types'
import { installFake2d, sourceCanvas } from './fake2d'
import { makePixels } from './cpu-passes'
import {
  disposeExportRenderer,
  exportContextCreations,
  exportRendererCanvas,
  renderExportCanvas,
  type RenderableSource,
} from './exportCanvas'

/**
 * `loadCaps` reads localStorage, and a cached `webgl2: true` with no real
 * context is exactly the state D3-F06 has to be measured in: the export path
 * builds a context, and every caller used to destroy it again.
 *
 * The stored shape is the envelope `loadCaps` writes — a version, the time of
 * the probe, and the caps — and `at` has to be current, because a record past its
 * TTL is re-probed and jsdom has no context to find. `ie-caps-v4` and version 4
 * are guarded against drift by `diagnostics.test.ts`, which reads `caps.ts`.
 */
function cacheWebgl2Caps(): void {
  window.localStorage.setItem(
    'ie-caps-v4',
    JSON.stringify({
      v: 4,
      at: Date.now(),
      caps: {
        webgl2: true,
        maxTextureSize: 4096,
        maxRenderbufferSize: 4096,
        maxCanvasArea: 4096 * 4096,
        formats: { webp: true, avif: false },
        saveData: false,
      },
    }),
  )
}

function source(): RenderableSource {
  const pixels = makePixels(16, 12)
  for (let i = 0; i < pixels.data.length; i += 1) pixels.data[i] = (i * 37) % 256
  const canvas = sourceCanvas(pixels)
  return canvas as unknown as RenderableSource
}

function runExport(runs: number, doc: Doc = createDoc()): { gl: FakeGl2; created: number } {
  cacheWebgl2Caps()
  const twoD = installFake2d()
  const gl = installFakeGl2()
  try {
    for (let i = 0; i < runs; i += 1) {
      // Fire and forget: what is under test is how many contexts get created,
      // not the bytes. The catch keeps a rejected render (the test restores the
      // canvas stubs while these are still awaiting) out of the global handler.
      void renderExportCanvas(source(), doc, { width: 16, height: 12 }).catch(() => undefined)
    }
    return { gl: gl.gl, created: exportContextCreations() }
  } finally {
    twoD.restore()
    gl.restore()
  }
}

describe('D3-F06: one long-lived export renderer', () => {
  it('constructs one WebGL context for ten export calls', () => {
    disposeExportRenderer()
    const { created } = runExport(10)
    expect(created).toBe(1)
    disposeExportRenderer()
  })

  it('does not create a second context for a different size or document', () => {
    disposeExportRenderer()
    const base = createDoc()
    const { created } = runExport(1)
    expect(created).toBe(1)
    // A second, different export: different size, different look.
    const other: Doc = { ...base, adjust: { ...base.adjust, exposure: 1 } }
    cacheWebgl2Caps()
    const twoD = installFake2d()
    const gl = installFakeGl2()
    try {
      void renderExportCanvas(source(), other, { width: 24, height: 18 }).catch(() => undefined)
      expect(exportContextCreations()).toBe(1)
    } finally {
      twoD.restore()
      gl.restore()
      disposeExportRenderer()
    }
  })

  it('never loses the shared context between calls', () => {
    disposeExportRenderer()
    const { gl, created } = runExport(3)
    // `dispose()` used to end in WEBGL_lose_context.loseContext(), so the
    // browser was being told to drop the context on every single export. The
    // double records the calls; there must be none.
    expect({ lose: gl.loseContextCalls, created }).toEqual({ lose: 0, created: 1 })
    disposeExportRenderer()
  })
})

describe('D3-F06: a cancelled export stops', () => {
  it('does not render at all when the signal is already aborted', async () => {
    disposeExportRenderer()
    cacheWebgl2Caps()
    const twoD = installFake2d()
    const gl = installFakeGl2()
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(
        renderExportCanvas(
          source(),
          createDoc(),
          { width: 16, height: 12 },
          { signal: controller.signal },
        ),
      ).rejects.toThrow()
      expect(gl.gl.draws.length).toBe(0)
    } finally {
      twoD.restore()
      gl.restore()
      disposeExportRenderer()
    }
  })

  it('reports the abort rather than handing back a half-rendered canvas', async () => {
    disposeExportRenderer()
    cacheWebgl2Caps()
    const twoD = installFake2d()
    const gl = installFakeGl2()
    try {
      const controller = new AbortController()
      const promise = renderExportCanvas(
        source(),
        createDoc(),
        { width: 16, height: 12 },
        {
          signal: controller.signal,
        },
      )
      controller.abort()
      await expect(promise).rejects.toThrow()
    } finally {
      twoD.restore()
      gl.restore()
      disposeExportRenderer()
    }
  })
})

describe('D3-F06: a lost context is an error, not a blank file', () => {
  it('throws instead of silently exporting nothing', async () => {
    disposeExportRenderer()
    cacheWebgl2Caps()
    const twoD = installFake2d()
    const gl = installFakeGl2()
    try {
      // Warm the shared renderer so its canvas is the one that gets lost.
      await renderExportCanvas(source(), createDoc(), { width: 16, height: 12 })
      const canvas = exportRendererCanvas()
      if (!canvas) throw new Error('the shared renderer was not created')
      canvas.dispatchEvent(new Event('webglcontextlost'))
      await expect(
        renderExportCanvas(source(), createDoc(), { width: 16, height: 12 }),
      ).rejects.toThrow(/context was lost/i)
    } finally {
      twoD.restore()
      gl.restore()
      disposeExportRenderer()
    }
  })
})
