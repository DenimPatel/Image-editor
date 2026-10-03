import type { Doc, Size } from '../model/types'

export type RenderRequest = {
  source: TexImageSource
  sourceSize: Size
  doc: Doc
  size: Size
  /**
   * Stops the pass chain between passes. A 48 MP export is a dozen GPU passes
   * and the user can cancel it at any point; without this the whole chain runs
   * before the abort is noticed.
   */
  signal?: AbortSignal
}

/**
 * The one interface the editor talks to. `Editor` never branches on engine:
 * capabilities pick a backend at boot, and an unrecoverable WebGL context
 * loss swaps back to Canvas2D behind the same contract.
 */
export interface RenderBackend {
  readonly kind: 'gl' | 'canvas2d'
  readonly canvas: HTMLCanvasElement
  render(request: RenderRequest): void
  /**
   * Warm anything the next frame needs asynchronously — a 3D LUT texture for
   * the GL backend, nothing for Canvas2D. Called after a look change so a
   * preset does not silently render ungraded.
   */
  prepare(doc: Doc): Promise<void>
  dispose(): void
}
