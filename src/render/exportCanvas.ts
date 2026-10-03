import { loadCaps, renderLimits } from '../gl/caps'
import { GlRenderer } from '../gl/renderer'
import { flagOff } from '../lib/flags'
import { throwIfAborted } from '../lib/metadata/abort'
import { effectiveOutputSize } from '../model/selectors'
import type { Doc, Size } from '../model/types'
import type { RenderBackend } from './backend'
import { Canvas2dRenderer } from './fallback2d'
import { drawLayers, type CompositorAssets } from './layers'
import { assetStore } from '../model/assetsSingleton'

export type RenderableSource = TexImageSource & { width: number; height: number }

const compositorAssets: CompositorAssets = {
  get: (id: string) =>
    assetStore.get(id) as (CanvasImageSource & { width: number; height: number }) | undefined,
}

export class ExportAbortedError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportAbortedError'
  }
}

export type ExportOptions = {
  /**
   * Stops the GPU pass chain between passes. A 48 MP export is a dozen
   * full-screen draws; without this a cancelled export ran all of them before
   * the abort was noticed.
   */
  signal?: AbortSignal
}

/**
 * One GL context for the whole page, created on the first export and kept.
 *
 * The old code built a `GlRenderer` per call and disposed it, and `dispose()`
 * ends in `WEBGL_lose_context.loseContext()`. The callers are the histogram
 * (every 400 ms of slider idle), the export-size estimate (every 350 ms), Auto,
 * every multi-size entry and the passport sheet — and browsers cap live
 * contexts at roughly 16, so with the Adjust sheet open the *interactive*
 * context was repeatedly evicted mid-edit. A shared renderer also keeps the
 * compiled program cache and the framebuffer pool warm.
 */
let exportRenderer: GlRenderer | null = null
let contextCreations = 0

/** How many WebGL contexts this module has created since the page loaded. */
export function exportContextCreations(): number {
  return contextCreations
}

/** The canvas the shared renderer draws into, for tests and diagnostics. */
export function exportRendererCanvas(): HTMLCanvasElement | null {
  return exportRenderer?.canvas ?? null
}

/** Drop the shared export renderer. Tests and full teardown only. */
export function disposeExportRenderer(): void {
  exportRenderer?.dispose()
  exportRenderer = null
  contextCreations = 0
}

/** Thrown when the shared GL renderer cannot produce a frame. */
export class ExportRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExportRenderError'
  }
}

/**
 * Render the document at full output resolution onto a plain 2D canvas suitable
 * for encoding, compositing vector layers on top so text stays crisp at 1:1.
 *
 * The GL pipeline is preferred. The Canvas2D fallback is a *complete*
 * implementation of the same pass list now (see `src/render/fallback2d.ts`), so
 * it is only used when WebGL2 is genuinely unavailable — and if the GL render
 * fails at runtime the caller is told, because falling through silently used to
 * export a file missing every colour edit with no warning at all.
 */
export async function renderExportCanvas(
  source: RenderableSource,
  doc: Doc,
  size?: Size,
  options: ExportOptions = {},
): Promise<HTMLCanvasElement> {
  throwIfAborted(options.signal)
  const output = size ?? effectiveOutputSize(doc)
  const sourceSize = { width: source.width, height: source.height }
  const caps = loadCaps()

  // The `webgl: off` kill switch has to cover the non-interactive renderers too,
  // not just the loop that picks a backend for the canvas. A flag that silently
  // stopped working the moment the user pressed Export is worse than no flag: the
  // canvas is on the fallback and the downloaded file is not.
  if (flagOff('webgl') || !caps.webgl2)
    return canvas2dExport(source, doc, sourceSize, output, options)

  if (!exportRenderer) {
    contextCreations += 1
    // No `halfFloat` here: see `GlRendererOptions`. ANGLE rejects the RGBA16F
    // attachment even where the extension is present, and the canvas then comes
    // back blank.
    exportRenderer = new GlRenderer(document.createElement('canvas'), {
      limits: renderLimits(caps),
    })
  }
  const renderer: RenderBackend & { isLost?: boolean } = exportRenderer
  await renderer.prepare(doc)
  throwIfAborted(options.signal)
  if (renderer.isLost) {
    throw new ExportRenderError(
      'The WebGL context was lost while rendering the export. Nothing was written; try again.',
    )
  }

  renderer.render({ source, sourceSize, doc, size: output, signal: options.signal })
  if (options.signal?.aborted) throw new ExportAbortedError()
  if (renderer.isLost) {
    throw new ExportRenderError(
      'The WebGL context was lost while rendering the export. Nothing was written; try again.',
    )
  }

  const out = document.createElement('canvas')
  out.width = output.width
  out.height = output.height
  const ctx = out.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new ExportRenderError('Canvas 2D unavailable for the export')
  ctx.drawImage(renderer.canvas, 0, 0)
  if (doc.layers.length > 0) drawLayers(ctx, doc, { size: output, assets: compositorAssets })
  return out
}

function canvas2dExport(
  source: RenderableSource,
  doc: Doc,
  sourceSize: Size,
  output: Size,
  options: ExportOptions,
): HTMLCanvasElement {
  const fallback = new Canvas2dRenderer()
  fallback.render({ source, sourceSize, doc, size: output, signal: options.signal })
  if (options.signal?.aborted) throw new ExportAbortedError()
  if (doc.layers.length > 0) {
    const ctx = fallback.canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) drawLayers(ctx, doc, { size: output, assets: compositorAssets })
  }
  return fallback.canvas
}
