import type { Page } from '@playwright/test'
import { readImageHeader, test, expect } from './fixtures'
import { setOutput } from './store'

/**
 * D3-F08 — a real context loss, driven through the UI, in a real browser.
 *
 * The retry ladder and the `webglcontextlost` listener were unit-tested against
 * a fake context and a fake timer, and the renderer's own restore was covered by
 * a replay harness. What none of that reaches is the path a phone actually
 * takes: the GPU driver resets, the canvas fires `webglcontextlost`,
 * `useRenderLoop` waits out `contextRetryDelay(1)` and swaps in a fresh
 * backend, and the user — who was mid-edit — sees the same image.
 *
 * The loss is genuine. `WEBGL_lose_context.loseContext()` is the browser's own
 * "simulate a GPU reset" switch, the one Chrome's own diagnostics use.
 *
 * Picking *which* context to lose is the only delicate part, because the page
 * holds several: the capability probe (`probeCaps`), the interactive backend
 * and — after the first export — a shared export renderer (`renderExportCanvas`
 * keeps one for the whole page). At mount only the first two exist and the
 * probe's canvas is 300×150 — the HTML default, which `probeCaps` never
 * resizes — while the preview's is clamped to at least 512 px on the long edge,
 * so the display backend is identified exactly. That index is read *before* the
 * first export and pinned.
 *
 * Recognising the *replacement* is harder, and the first version of this file
 * got it wrong in a way that passed: after an export the shared renderer's
 * canvas is also larger than 512 px, so "the last big context" was the
 * exporter and the recovery assertion was satisfied before the 10 s backoff had
 * even elapsed. The replacement is now found by *excluding* both known canvases
 * — the lost one and `exportRendererCanvas()`, an exported diagnostic that
 * names the exporter's own canvas — so the assertion can only be met by a
 * genuinely new context the render loop built.
 *
 * If the identification ever drifts, the test cannot pass: losing the wrong
 * context produces no replacement, and the recovery assertion fails. It is a
 * claim that fails loudly when it stops being true, not a skip.
 */

/** The preview's proxy long-edge floor, from `computeProxySize` in `useRenderLoop`. */
const MIN_PROXY_EDGE = 512

function recordWebglContexts(): void {
  const created: WebGL2RenderingContext[] = []
  const original = HTMLCanvasElement.prototype.getContext as (
    this: HTMLCanvasElement,
    type: string,
    attributes?: unknown,
  ) => unknown
  HTMLCanvasElement.prototype.getContext = function patched(
    this: HTMLCanvasElement,
    type: string,
    attributes?: unknown,
  ) {
    const context = original.call(this, type, attributes)
    if (type === 'webgl2' && context) created.push(context as WebGL2RenderingContext)
    return context
  } as unknown as HTMLCanvasElement['getContext']
  ;(window as unknown as { __ieWebgl: WebGL2RenderingContext[] }).__ieWebgl = created
}

/**
 * Index of the interactive backend's context, or -1. Read once, immediately
 * after the editor paints and before any export exists.
 */
async function displayContextIndex(page: Page): Promise<number> {
  return page.evaluate((minEdge) => {
    const list = (window as unknown as { __ieWebgl?: WebGL2RenderingContext[] }).__ieWebgl ?? []
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const canvas = list[index].canvas
      if (Math.max(canvas.width, canvas.height) >= minEdge) return index
    }
    return -1
  }, MIN_PROXY_EDGE)
}

/**
 * Is there a WebGL2 context that is neither the one just lost nor the shared
 * export renderer's, is not itself lost, and is preview-sized?
 *
 * The two exclusions are what make this an assertion about the render loop: the
 * page creates contexts for reasons that have nothing to do with a context
 * loss, and without excluding them by canvas identity this predicate is
 * satisfied by ordinary export traffic.
 */
async function hasReplacementContext(page: Page, lostIndex: number): Promise<boolean> {
  return page.evaluate(
    ({ index, minEdge }) => {
      const list = (window as unknown as { __ieWebgl?: WebGL2RenderingContext[] }).__ieWebgl ?? []
      const lost = list[index]?.canvas
      // Named by the module that owns it, not guessed from a size.
      const exporter = (
        window as unknown as {
          __ieExporterCanvas?: HTMLCanvasElement | null
        }
      ).__ieExporterCanvas
      return list.some((context) => {
        const canvas = context.canvas
        if (canvas === lost || canvas === exporter) return false
        if (Math.max(canvas.width, canvas.height) < minEdge) return false
        return !context.isContextLost()
      })
    },
    { index: lostIndex, minEdge: MIN_PROXY_EDGE },
  )
}

test.describe('a real WebGL context loss', () => {
  test('the editor comes back on a new context and the image is byte-identical', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    settle,
    openTool,
    downloadFrom,
    isWebGL2,
  }, testInfo) => {
    test.skip(!(await isWebGL2()), 'no WebGL2 context in this browser')
    await page.addInitScript(recordWebglContexts)
    // `?engine=gl` takes the capability probe out of the outcome: this test is
    // about the WebGL path, and on a machine that cannot do WebGL the honest
    // result is the skip above rather than a Canvas2D pass.
    await goto('/editor?engine=gl')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()

    // Read the display context before anything else creates one.
    const display = await displayContextIndex(page)
    expect(
      display,
      'the editor did not create an interactive WebGL2 context',
    ).toBeGreaterThanOrEqual(0)

    const loss = await page.evaluate((index) => {
      const context = (window as unknown as { __ieWebgl: WebGL2RenderingContext[] }).__ieWebgl[
        index
      ]
      const info = context.getExtension('WEBGL_debug_renderer_info')
      const renderer = info
        ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : String(context.getParameter(context.RENDERER))
      const extension = context.getExtension('WEBGL_lose_context')
      extension?.loseContext()
      return {
        renderer,
        width: context.canvas.width,
        height: context.canvas.height,
        lost: Boolean(extension),
      }
    }, display)
    // Recorded either way, so a skip can never be read as a pass.
    console.log(
      `context loss forced on renderer: ${loss.renderer} (preview canvas ${loss.width}x${loss.height})`,
    )
    test.skip(!loss.lost, 'this browser has no WEBGL_lose_context')

    // 480 px, as the export suite does: the claim is that the bytes survive a
    // context swap, not that a 24-megapixel frame re-encodes quickly.
    await setOutput(page, { resize: { mode: 'width', width: 480 } })
    await settle()

    const panel = await openTool('Export')
    const png = panel.getByRole('button', { name: 'PNG', exact: true })
    if ((await png.getAttribute('aria-pressed')) !== 'true') await png.click()
    const first = await downloadFrom(panel.getByRole('button', { name: 'Download', exact: true }))
    const header = readImageHeader(first.bytes)
    expect(header.format).toBe('png')
    expect(header.width).toBe(480)

    // Publish the shared export renderer's canvas. It is the one other context
    // the page can legitimately create while the recovery poll runs, and the
    // poll has to be able to exclude it by identity rather than by size.
    const exporterPublished = await page.evaluate(async () => {
      const base = document.baseURI
      const module = await import(
        /* @vite-ignore */ new URL('src/render/exportCanvas.ts', base).href
      )
      const canvas = module.exportRendererCanvas()
      ;(window as unknown as { __ieExporterCanvas?: HTMLCanvasElement | null }).__ieExporterCanvas =
        canvas
      return canvas !== null
    })
    expect(exporterPublished, 'the export did not create a shared renderer').toBe(true)

    // The context really is gone — the browser says so, not the test.
    await expect
      .poll(
        () =>
          page.evaluate(
            (index) =>
              (window as unknown as { __ieWebgl: WebGL2RenderingContext[] }).__ieWebgl[
                index
              ].isContextLost(),
            display,
          ),
        { timeout: 15_000 },
      )
      .toBe(true)

    // Recovery. `contextRetryDelay(1)` is 10 s, so the swap is deliberately not
    // instant: a driver that has just reset gets time to settle. The predicate
    // excludes the context just lost and the export renderer's, so nothing but a
    // genuinely new interactive backend can satisfy it.
    await expect
      .poll(async () => hasReplacementContext(page, display), {
        timeout: 45_000,
        message: 'the render loop never built a replacement WebGL backend after the loss',
      })
      .toBe(true)

    // The original is still gone, and the canvas the user can see is still being
    // drawn into — a swap that produced a context nobody renders into would
    // satisfy the poll above on its own.
    expect(
      await page.evaluate(
        (index) =>
          (window as unknown as { __ieWebgl: WebGL2RenderingContext[] }).__ieWebgl[
            index
          ].isContextLost(),
        display,
      ),
    ).toBe(true)
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
    await settle()

    // And the image is the same image. A loss that quietly changed the pipeline
    // would still satisfy every assertion above.
    const second = await downloadFrom(panel.getByRole('button', { name: 'Download', exact: true }))
    expect(readImageHeader(second.bytes)).toEqual(header)
    expect(second.bytes.equals(first.bytes)).toBe(true)

    // Proof, kept out of `test-results/` — a concurrent run wipes that.
    const shot = await page.screenshot({ path: '.playwright-mcp/context-loss-recovered.png' })
    await testInfo.attach('context-loss-recovered', { body: shot, contentType: 'image/png' })
  })
})
