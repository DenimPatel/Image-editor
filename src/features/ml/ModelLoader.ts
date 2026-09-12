/**
 * Idempotent ML weight loader.
 *
 * Weights are never committed; `scripts/fetch-models.mjs` downloads them into
 * `public/models/` from the pinned URLs in `models.lock.json`, and this loader
 * caches them in Cache Storage keyed by URL so the second use is instant and
 * offline. Progress is reported before/while bytes move so the UI can disclose
 * the download and offer Cancel.
 */

export type ModelKind = 'matting-quint8' | 'matting-fp16' | 'face-landmarker';

export type ModelInfo = {
  kind: ModelKind;
  label: string;
  url: string;
  bytes: number;
};

export const MODELS: Record<ModelKind, ModelInfo> = {
  'matting-quint8': {
    kind: 'matting-quint8',
    label: 'Background removal (fast, ~11 MB)',
    url: `${import.meta.env.BASE_URL}models/isnet_quint8.onnx`,
    bytes: 11 * 1024 * 1024,
  },
  'matting-fp16': {
    kind: 'matting-fp16',
    label: 'Background removal (best quality, ~44 MB)',
    url: `${import.meta.env.BASE_URL}models/isnet_fp16.onnx`,
    bytes: 44 * 1024 * 1024,
  },
  'face-landmarker': {
    kind: 'face-landmarker',
    label: 'Face landmarks (~3.7 MB)',
    url: `${import.meta.env.BASE_URL}models/face_landmarker.task`,
    bytes: Math.round(3.7 * 1024 * 1024),
  },
};

export class ModelUnavailableError extends Error {
  readonly reason: unknown;
  constructor(kind: ModelKind, cause?: unknown) {
    super(
      `Model “${MODELS[kind].label}” is not available. Run \`npm run models:fetch\` before building to self-host it.`,
    );
    this.name = 'ModelUnavailableError';
    this.reason = cause;
  }
}

export type LoaderDeps = {
  cacheStorage: CacheStorage | undefined;
  fetchFn: typeof fetch;
  cacheName: string;
};

const CACHE_NAME = 'ie-models-v1';

function defaultDeps(): LoaderDeps {
  return {
    cacheStorage: typeof caches !== 'undefined' ? caches : undefined,
    fetchFn: typeof fetch !== 'undefined' ? fetch : (undefined as unknown as typeof fetch),
    cacheName: CACHE_NAME,
  };
}

export type EnsureModelOptions = {
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
  deps?: Partial<LoaderDeps>;
  force?: boolean;
};

const inFlight = new Map<ModelKind, Promise<ArrayBuffer>>();
const ready = new Map<ModelKind, ArrayBuffer>();

export function isModelCached(kind: ModelKind): boolean {
  return ready.has(kind);
}

export function resetModelCache(): void {
  ready.clear();
  inFlight.clear();
}

/**
 * Resolve a model's bytes, from Cache Storage when possible, otherwise from
 * the network (streamed with progress) and then cached. Concurrent calls for
 * the same kind share one request.
 */
export async function ensureModel(kind: ModelKind, options: EnsureModelOptions = {}): Promise<ArrayBuffer> {
  const cached = ready.get(kind);
  if (cached && !options.force) return cached;
  const existing = inFlight.get(kind);
  if (existing && !options.force) return existing;

  const deps: LoaderDeps = { ...defaultDeps(), ...options.deps };
  const info = MODELS[kind];

  const promise = (async () => {
    const cache = deps.cacheStorage ? await deps.cacheStorage.open(deps.cacheName).catch(() => undefined) : undefined;

    if (cache && !options.force) {
      const hit = await cache.match(info.url);
      if (hit) {
        const buffer = await hit.arrayBuffer();
        ready.set(kind, buffer);
        return buffer;
      }
    }

    let response: Response;
    try {
      response = await deps.fetchFn(info.url, { signal: options.signal });
    } catch (error) {
      throw new ModelUnavailableError(kind, error);
    }
    if (!response.ok) throw new ModelUnavailableError(kind, new Error(`HTTP ${response.status}`));

    const total = Number(response.headers.get('content-length')) || info.bytes;
    const buffer = await readWithProgress(response, total, options.onProgress, options.signal);
    if (cache) {
      await cache
        .put(info.url, new Response(buffer.slice(0), { headers: { 'content-type': 'application/octet-stream' } }))
        .catch(() => undefined);
    }
    ready.set(kind, buffer);
    return buffer;
  })();

  inFlight.set(kind, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(kind);
  }
}

async function readWithProgress(
  response: Response,
  total: number,
  onProgress: ((received: number, total: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, total);
    return buffer;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new DOMException('Aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(received, total);
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

/** Clear stale caches from previous schema versions when the browser is idle. */
export function scheduleOldCacheCleanup(): void {
  if (typeof window === 'undefined' || typeof caches === 'undefined') return;
  const run = async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith('ie-models-') && name !== CACHE_NAME).map((name) => caches.delete(name)),
    );
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(() => void run());
  else window.setTimeout(() => void run(), 3000);
}
