import { loadCaps } from '../gl/caps';
import { GlRenderer } from '../gl/renderer';
import { assetStore } from '../model/assetsSingleton';
import { effectiveOutputSize } from '../model/selectors';
import type { Doc, Size } from '../model/types';
import { Canvas2dRenderer } from './fallback2d';
import { drawLayers } from './layers';

export type RenderableSource = TexImageSource & { width: number; height: number };

const compositorAssets = {
  get: (id: string) =>
    assetStore.get(id) as (CanvasImageSource & { width: number; height: number }) | undefined,
};

/**
 * Render the document at full output resolution to a plain 2D canvas suitable
 * for encoding, compositing vector layers on top so text stays crisp at 1:1.
 * Prefers the GL pipeline and falls back to Canvas2D when WebGL2 is
 * unavailable.
 */
export async function renderExportCanvas(source: RenderableSource, doc: Doc, size?: Size): Promise<HTMLCanvasElement> {
  const output = size ?? effectiveOutputSize(doc);
  const sourceSize = { width: source.width, height: source.height };
  const caps = loadCaps();

  if (caps.webgl2) {
    const renderer = new GlRenderer(document.createElement('canvas'));
    try {
      await renderer.prepare(doc);
      renderer.render({ source, sourceSize, doc, size: output });
      const out = document.createElement('canvas');
      out.width = output.width;
      out.height = output.height;
      const ctx = out.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas 2D unavailable');
      ctx.drawImage(renderer.canvas, 0, 0);
      if (doc.layers.length > 0) drawLayers(ctx, doc, { size: output, assets: compositorAssets });
      return out;
    } catch {
      // fall through to Canvas2D
    } finally {
      renderer.dispose();
    }
  }

  const fallback = new Canvas2dRenderer();
  fallback.render({ source, sourceSize, doc, size: output });
  if (doc.layers.length > 0) {
    const ctx = fallback.canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) drawLayers(ctx, doc, { size: output, assets: compositorAssets });
  }
  return fallback.canvas;
}