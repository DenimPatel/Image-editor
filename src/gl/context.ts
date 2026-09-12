export type ContextLossHandlers = {
  onLost?: () => void;
  onRestored?: () => void;
};

export function getWebgl2(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      desynchronized: false,
    });
    return gl ?? null;
  } catch {
    return null;
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
    event.preventDefault();
    handlers.onLost?.();
  };
  const onRestored = () => handlers.onRestored?.();
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
  };
}