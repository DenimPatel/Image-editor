import { useEffect, useState, type RefObject } from 'react';
import { loadCaps } from '../gl/caps';
import { createDoc } from '../model/defaults';
import { assetStore } from '../model/assetsSingleton';
import { effectiveOutputSize } from '../model/selectors';
import type { Doc, Size } from '../model/types';
import { drawLayers } from '../render/layers';
import { createBackend, readEnginePreference, type EnginePreference } from '../render/selectBackend';
import type { RenderBackend } from '../render/backend';
import { getDoc, getRevision, useDocStore } from '../store/docStore';
import { useUiStore } from '../store/uiStore';

export type RenderLoopResult = {
  canvas: HTMLCanvasElement | null;
  engineKind: 'gl' | 'canvas2d';
};

const MIN_PROXY = 512;
const MAX_PROXY = 2048;

const compositorAssets = {
  get: (id: string) =>
    assetStore.get(id) as (CanvasImageSource & { width: number; height: number }) | undefined,
};

function computeProxySize(output: Size, display: Size, dpr: number): Size {
  const longEdgeRaw = Math.max(display.width, display.height) * dpr * 2;
  const longEdge = Math.min(MAX_PROXY, Math.max(MIN_PROXY, longEdgeRaw));
  const aspect = output.width / Math.max(1, output.height);
  if (aspect >= 1) {
    return { width: Math.round(longEdge), height: Math.max(1, Math.round(longEdge / aspect)) };
  }
  return { width: Math.max(1, Math.round(longEdge * aspect)), height: Math.round(longEdge) };
}

/**
 * Owns the render backend, the rAF loop and a 2D presentation canvas. The
 * backend renders the photo pipeline; layers are composited on top on the
 * presentation canvas, which is the single DOM element the user sees. That
 * keeps layer compositing identical between engines and lets a backend swap
 * (context loss) go unnoticed.
 */
/* eslint-disable react-hooks/set-state-in-effect -- this effect creates and
   owns external resources (canvas + backend) and must publish them to React. */
export function useRenderLoop(
  containerRef: RefObject<HTMLElement | null>,
  source: ImageBitmap | null,
  preference: EnginePreference = readEnginePreference(window.location.search),
): RenderLoopResult {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [engineKind, setEngineKind] = useState<'gl' | 'canvas2d'>('canvas2d');

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !source) return;

    const caps = loadCaps();
    let backend: RenderBackend = createBackend(preference, caps);
    setEngineKind(backend.kind);

    const presentation = document.createElement('canvas');
    presentation.className = 'ie-canvas-el';
    const presentCtx = presentation.getContext('2d');
    if (!presentCtx) return;
    container.appendChild(presentation);
    setCanvas(presentation);

    let dirty = true;
    let raf = 0;
    let disposed = false;
    let containerSize: Size = { width: container.clientWidth || 320, height: container.clientHeight || 320 };
    let lastRevision = -1;
    let lastCompare = false;
    let lastViewport = useUiStore.getState().viewport;

    const schedule = () => {
      dirty = true;
    };

    const onLost = () => {
      window.setTimeout(() => {
        if (disposed || backend.kind !== 'gl') return;
        backend = createBackend('canvas2d', caps);
        setEngineKind(backend.kind);
        dirty = true;
      }, 700);
    };
    backend.canvas.addEventListener('webglcontextlost', onLost);

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        containerSize = { width: rect.width, height: rect.height };
        dirty = true;
      }
    });
    resizeObserver.observe(container);

    const unsubscribeDoc = useDocStore.subscribe(schedule);
    const unsubscribeUi = useUiStore.subscribe(schedule);

    const applyLayout = (output: Size) => {
      const viewport = useUiStore.getState().viewport;
      const availableW = Math.max(1, containerSize.width - 32);
      const availableH = Math.max(1, containerSize.height - 32);
      const fit = Math.min(availableW / output.width, availableH / output.height);
      const displayW = Math.max(1, output.width * fit);
      const displayH = Math.max(1, output.height * fit);
      presentation.style.width = `${displayW}px`;
      presentation.style.height = `${displayH}px`;
      presentation.style.transform = `translate(-50%, -50%) translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
      return { width: displayW, height: displayH };
    };

    const renderOnce = () => {
      const doc = getDoc();
      const compareHeld = useUiStore.getState().compareHeld;
      const editingCrop = useUiStore.getState().activeTool === 'crop';
      let activeDoc: Doc = compareHeld ? createDoc({ source: doc.source, output: doc.output }) : doc;
      if (editingCrop) {
        activeDoc = {
          ...activeDoc,
          geometry: { ...activeDoc.geometry, crop: { x: 0, y: 0, width: 1, height: 1 } },
        };
      }
      const output = effectiveOutputSize(activeDoc);
      const display = applyLayout(output);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const proxy = computeProxySize(output, display, dpr);

      backend.render({
        source,
        sourceSize: { width: source.width, height: source.height },
        doc: activeDoc,
        size: proxy,
      });

      if (presentation.width !== proxy.width || presentation.height !== proxy.height) {
        presentation.width = proxy.width;
        presentation.height = proxy.height;
      }
      presentCtx.setTransform(1, 0, 0, 1, 0, 0);
      presentCtx.clearRect(0, 0, proxy.width, proxy.height);
      presentCtx.drawImage(backend.canvas, 0, 0, proxy.width, proxy.height);
      if (!compareHeld && activeDoc.layers.length > 0) {
        drawLayers(presentCtx, activeDoc, { size: proxy, assets: compositorAssets });
      }
    };

    const loop = () => {
      raf = window.requestAnimationFrame(loop);
      if (!dirty) return;
      const revision = getRevision();
      const compareHeld = useUiStore.getState().compareHeld;
      const viewport = useUiStore.getState().viewport;
      const viewportChanged =
        viewport.scale !== lastViewport.scale || viewport.x !== lastViewport.x || viewport.y !== lastViewport.y;
      if (revision === lastRevision && compareHeld === lastCompare && !viewportChanged) {
        dirty = false;
        return;
      }
      lastRevision = revision;
      lastCompare = compareHeld;
      lastViewport = viewport;
      dirty = false;
      try {
        renderOnce();
      } catch {
        if (backend.kind === 'gl') {
          backend.dispose();
          backend = createBackend('canvas2d', caps);
          setEngineKind(backend.kind);
          dirty = true;
        }
      }
    };

    const lookId = getDoc().look.id;
    if (lookId && backend.kind === 'gl') {
      const gl = backend as RenderBackend & { prepare?: (doc: Doc) => Promise<void> };
      void gl.prepare?.(getDoc()).then(schedule);
    }

    dirty = true;
    raf = window.requestAnimationFrame(loop);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      unsubscribeDoc();
      unsubscribeUi();
      backend.canvas.removeEventListener('webglcontextlost', onLost);
      backend.dispose();
      presentation.remove();
    };
  }, [source, containerRef, preference]);

  return { canvas, engineKind };
}
