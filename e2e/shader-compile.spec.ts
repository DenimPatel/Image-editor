import * as SHADERS from '../src/gl/shaders'
import { expect, test } from './fixtures'

/**
 * D3-F17/D4-F02 — every shader in `src/gl/shaders/index.ts` compiles on the
 * real driver, and a background actually reaches the exported pixels.
 *
 * This exists because of a defect nothing else in the suite could see.
 * `BACKGROUND_FRAG` had `sum += texture(...) * w`, assigning a `vec4` into a
 * `vec3`. It broke `renderExportCanvas` for *every* document with a background —
 * all four passport specs, the white-background button, background colour,
 * gradient and image — and made the passport measurement reject. It survived
 * because:
 *
 *  - jsdom has no WebGL, so no unit test ever ran a GLSL compiler;
 *  - `e2e/shader-parity.spec.ts` skips on a software rasteriser, and this
 *    project's CI agents are exactly that;
 *  - the GLSL interpreter in `src/gl/glsl-eval.ts` is more permissive than a
 *    driver about implicit vector truncation, so the CPU twin agreed with the
 *    broken shader.
 *
 * A compile failure is silent to the user and loud here, which is the point: a
 * broken shader must fail a test rather than a customer's export.
 *
 * The gate covers *every* exported shader rather than a hand-picked few, so a new
 * pass cannot arrive uncompiled either, and it runs on a software rasteriser
 * too — compilation is a compiler question, not a rendering one, so unlike the
 * parity spec there is nothing here to skip. The parity spec still records the
 * renderer string so a skip can never be read as a pass.
 */

/** Every `*_FRAG` / `*_VERT` export, by name, so a failure names its shader. */
const FRAGMENT = 0x8b30
const VERTEX = 0x8b31

function exportedShaders(): { name: string; type: number; source: string }[] {
  return Object.entries(SHADERS)
    .filter(([name, value]) => {
      const isFragment = name.endsWith('_FRAG')
      const isVertex = name.endsWith('_VERT')
      return typeof value === 'string' && (isFragment || isVertex)
    })
    .map(([name, value]) => ({
      name,
      type: name.endsWith('_FRAG') ? FRAGMENT : VERTEX,
      source: value as string,
    }))
}

type CompileOutcome = { name: string; ok: boolean; log: string }

test.describe('the GLSL compiles, on the real driver', () => {
  test('every exported fragment and vertex shader compiles', async ({ page, goto, isWebGL2 }) => {
    test.skip(!(await isWebGL2()), 'no WebGL2 context in this browser')
    await goto('/')
    // Read from the module under test, not from a copy: a fixture that restated
    // the sources would keep passing after the sources broke.
    const shaders = exportedShaders()
    expect(shaders.length).toBeGreaterThan(10)

    const outcome = await page.evaluate((list) => {
      const canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 4
      const gl = canvas.getContext('webgl2')
      if (!gl) return null
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = ext
        ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER))
      const compiled: { name: string; ok: boolean; log: string }[] = []
      for (const shader of list) {
        const handle = gl.createShader(shader.type)
        if (!handle) {
          compiled.push({ name: shader.name, ok: false, log: 'createShader returned null' })
          continue
        }
        gl.shaderSource(handle, shader.source)
        gl.compileShader(handle)
        const ok = Boolean(gl.getShaderParameter(handle, gl.COMPILE_STATUS))
        const log = ok ? '' : (gl.getShaderInfoLog(handle) ?? '').trim()
        gl.deleteShader(handle)
        compiled.push({ name: shader.name, ok, log })
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      return { renderer, compiled }
    }, shaders)

    if (!outcome) throw new Error('no WebGL2 context after the skip guard passed')
    // Recorded either way: a green run on SwiftShader is still a compile check,
    // and the report should say which compiler passed it.
    console.log(`shader compile check on renderer: ${outcome.renderer}`)
    const failures = (outcome.compiled as CompileOutcome[])
      .filter((shader) => !shader.ok)
      .map((shader) => `${shader.name}: ${shader.log}`)
    expect(failures, `shaders that failed to compile:\n${failures.join('\n')}`).toEqual([])
  })
})

test.describe('a background reaches the exported pixels', () => {
  // The half of the regression a compile check cannot see: the shader compiled,
  // but the pass must also produce the frame. `renderExportCanvas` on a
  // document with a background colour is the shortest path to the defect, and it
  // is the same call the passport sheet and the white-background button make.
  test('a document with a background colour exports that colour', async ({
    page,
    goto,
    loadSample,
    isWebGL2,
  }) => {
    test.skip(!(await isWebGL2()), 'no WebGL2 context in this browser')
    await goto('/editor')
    await loadSample('Sample 1')
    const original = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.ie-canvas-el')
      if (!(canvas instanceof HTMLCanvasElement)) return null
      return { width: canvas.width, height: canvas.height }
    })
    expect(original).not.toBeNull()

    const result = await page.evaluate(async () => {
      const base = new URL('./', location.href).href
      const store = await import(new URL('src/store/docStore.ts', base).href)
      const defaults = await import(new URL('src/model/defaults.ts', base).href)
      const assets = await import(new URL('src/model/assetsSingleton.ts', base).href)
      const exportCanvas = await import(new URL('src/render/exportCanvas.ts', base).href)
      const state = store.useDocStore.getState()
      const originalDoc = JSON.parse(JSON.stringify(state.present))

      // A background is only composited behind a subject matte, so the fixture
      // source is replaced with one that carries real transparency.
      const width = 64
      const height = 96
      const scratch = document.createElement('canvas')
      scratch.width = width
      scratch.height = height
      const g = scratch.getContext('2d')
      if (!g) return { err: 'no 2d context' }
      g.clearRect(0, 0, width, height)
      g.fillStyle = '#00ff00'
      g.fillRect(width * 0.25, height * 0.25, width * 0.5, height * 0.5)
      const assetId = assets.assetStore.add(await createImageBitmap(scratch), 'e2e-matte')
      const doc = defaults.createDoc()
      doc.source = { assetId, width, height, name: 'e2e-matte', mime: 'image/png' }
      doc.background = { ...doc.background, mode: 'color', color: '#ff0000', removed: true }
      const source = assets.assetStore.get(assetId)
      if (!source) return { err: 'the fixture bitmap is not in the asset store' }
      try {
        const canvas = await exportCanvas.renderExportCanvas(
          source,
          JSON.parse(JSON.stringify(doc)),
        )
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return { err: 'no 2d context on the export' }
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const at = (fx: number, fy: number) => {
          const x = Math.round(fx * (canvas.width - 1))
          const y = Math.round(fy * (canvas.height - 1))
          const i = (y * canvas.width + x) * 4
          return [data[i], data[i + 1], data[i + 2], data[i + 3]]
        }
        return { corner: at(0.02, 0.02), subject: at(0.5, 0.5) }
      } finally {
        state.load(originalDoc)
      }
    })

    if ('err' in result) throw new Error(String(result.err))
    // The corner is outside the matte, so it has to be the chosen background.
    expect(result.corner[0]).toBeGreaterThan(200)
    expect(result.corner[1]).toBeLessThan(60)
    expect(result.corner[2]).toBeLessThan(60)
    // The middle is the opaque subject and must not be tinted by the background.
    expect(result.subject[1]).toBeGreaterThan(180)
  })
})
