/**
 * The catalogue of ML models the UI talks about, and the error type that carries
 * "this feature cannot run" all the way to a toast.
 *
 * This file used to be a 193-line weight loader. `ensureModel`,
 * `isModelCached` and `resetModelCache` had no production callers at all, and
 * they could not have had any: for the two matting kinds `MODELS[kind].url` is
 * `''`, so the only thing `ensureModel` could do was `fetch('')` — a request
 * for the current page. Background removal goes through
 * `@imgly/background-removal` (src/features/ml/matting.ts), which manages its own
 * weights and wasm from its CDN, and the passport auto-framer that the
 * `face-landmarker` entry existed for turned out to need no model at all. With
 * the passport agent's explicit agreement (board, 2026-09-29) the fetcher and
 * the `face-landmarker` entry are gone rather than left as 130 lines that look
 * load-bearing and are not.
 *
 * What remains is honest about where the bytes come from, which is the part the
 * user is actually shown: `BackgroundPanel` renders `label` and `bytes`.
 */

export type ModelKind = 'matting-quint8' | 'matting-fp16'

/** Where the weights are actually served from. */
export type ModelHost = 'cdn' | 'self-hosted'

export type ModelInfo = {
  kind: ModelKind
  label: string
  host: ModelHost
  /**
   * Measured from the real manifest download of the imgly CDN chunks (encoder
   * and decoder stages, not just the single isnet_*.onnx file). It is an
   * estimate of a third-party CDN, which is why the panel must say so.
   */
  bytes: number
}

// The imgly CDN serves each model as several chunks, so these totals are measured
// from the actual manifest download, not the raw .onnx file size. Neither entry
// can be served from public/models/: @imgly/background-removal resolves its own
// asset base and its own cache, and offers no hook to inject local weights.
export const MODELS: Record<ModelKind, ModelInfo> = {
  'matting-quint8': {
    kind: 'matting-quint8',
    label: 'Background removal (fast)',
    host: 'cdn',
    bytes: 42 * 1024 * 1024,
  },
  'matting-fp16': {
    kind: 'matting-fp16',
    label: 'Background removal (best quality)',
    host: 'cdn',
    bytes: 84 * 1024 * 1024,
  },
}

export function modelKindFor(quality: 'fast' | 'best'): ModelKind {
  return quality === 'best' ? 'matting-fp16' : 'matting-quint8'
}

export class ModelUnavailableError extends Error {
  readonly kind: ModelKind
  readonly reason: unknown

  constructor(kind: ModelKind, cause?: unknown) {
    super(`Model “${MODELS[kind].label}” is not available.`)
    this.name = 'ModelUnavailableError'
    this.kind = kind
    this.reason = cause
  }
}

const CACHE_NAME = 'ie-models-v1'

/**
 * Clear stale caches from previous schema versions when the browser is idle.
 * Called from `src/pages/Editor.tsx`. It is currently a no-op — nothing writes
 * `ie-models-*` caches since the fetcher went away — and is kept only because
 * removing it means editing a file this district does not own. The exact
 * deletion is in the D7-F06 report.
 */
export function scheduleOldCacheCleanup(): void {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return
  const run = async () => {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => name.startsWith('ie-models-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    )
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback
  if (idle) idle(() => void run())
  else window.setTimeout(() => void run(), 3000)
}
