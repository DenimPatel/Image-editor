export type ContextLossHandlers = {
  onLost?: () => void
  onRestored?: () => void
}

export type Webgl2Options = {
  /**
   * Keep the drawing buffer after a composite so a later frame can be blitted
   * from it without re-rendering. The interactive preview needs this; an export
   * reads the buffer back in the same task, so paying for it there costs a full
   * buffer copy on every frame for nothing.
   */
  preserveDrawingBuffer?: boolean
}

const DEFAULT_OPTIONS: Required<Webgl2Options> = {
  preserveDrawingBuffer: true,
}

/**
 * The pipeline is straight-alpha end to end: `UNPACK_PREMULTIPLY_ALPHA_WEBGL`
 * is false at upload, every shader writes unpremultiplied rgb with the source
 * alpha, and the Canvas2D fallback composites straight over the matte. Asking
 * the browser to *also* treat the canvas as premultiplied made it darken every
 * semi-transparent edge a second time, so the context is declared straight.
 */
export function webgl2Attributes(options: Webgl2Options = {}): WebGLContextAttributes {
  const { preserveDrawingBuffer } = { ...DEFAULT_OPTIONS, ...options }
  return {
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer,
    desynchronized: false,
  }
}

export function getWebgl2(
  canvas: HTMLCanvasElement,
  options: Webgl2Options = {},
): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext('webgl2', webgl2Attributes(options))
    return gl ?? null
  } catch {
    return null
  }
}

/**
 * WebGL context loss is guaranteed on mobile. `preventDefault()` is required
 * for the browser to attempt a restore; the app rebuilds all GPU state from
 * `Doc` (which is why nothing pixel-shaped lives in the document).
 */
export function attachContextLossHandlers(
  canvas: HTMLCanvasElement,
  handlers: ContextLossHandlers,
): () => void {
  const onLost = (event: Event) => {
    event.preventDefault()
    handlers.onLost?.()
  }
  const onRestored = () => handlers.onRestored?.()
  canvas.addEventListener('webglcontextlost', onLost, false)
  canvas.addEventListener('webglcontextrestored', onRestored, false)
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false)
    canvas.removeEventListener('webglcontextrestored', onRestored, false)
  }
}
