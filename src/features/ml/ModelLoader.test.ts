import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureModel, MODELS, ModelUnavailableError, resetModelCache } from './ModelLoader';

function cacheStorageWith(match: (url: string) => Promise<Response | undefined>) {
  const put = vi.fn(async () => undefined);
  return {
    storage: {
      open: async () => ({ match, put }),
    } as unknown as CacheStorage,
    put,
  };
}

function deps(storage: CacheStorage, fetchFn: typeof fetch) {
  return { cacheStorage: storage, cacheName: 'test', fetchFn };
}

afterEach(() => resetModelCache());

describe('ensureModel', () => {
  it('returns cached bytes without hitting the network', async () => {
    const fetchFn = vi.fn();
    const { storage } = cacheStorageWith(async () => new Response(new Uint8Array([1, 2, 3, 4])));
    const buffer = await ensureModel('matting-quint8', {
      deps: deps(storage, fetchFn as unknown as typeof fetch),
    });
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('streams from the network with progress and caches the result', async () => {
    const { storage, put } = cacheStorageWith(async () => undefined);
    const fetchFn = vi.fn(
      async () => new Response(new Uint8Array([9, 8, 7]), { headers: { 'content-length': '3' } }),
    );
    const progress: number[] = [];
    const buffer = await ensureModel('matting-quint8', {
      deps: deps(storage, fetchFn as unknown as typeof fetch),
      onProgress: (received) => progress.push(received),
    });
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([9, 8, 7]));
    expect(progress[progress.length - 1]).toBe(3);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('rejects with ModelUnavailableError when the download fails', async () => {
    const { storage } = cacheStorageWith(async () => undefined);
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(
      ensureModel('matting-fp16', { deps: deps(storage, fetchFn as unknown as typeof fetch) }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('rejects when the server returns a non-OK status', async () => {
    const { storage } = cacheStorageWith(async () => undefined);
    const fetchFn = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(
      ensureModel('face-landmarker', { deps: deps(storage, fetchFn as unknown as typeof fetch) }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('rejects an already-aborted request without caching', async () => {
    const { storage, put } = cacheStorageWith(async () => undefined);
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    const controller = new AbortController();
    controller.abort();
    await expect(
      ensureModel('matting-quint8', {
        deps: deps(storage, fetchFn as unknown as typeof fetch),
        signal: controller.signal,
      }),
    ).rejects.toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });

  it('shares one in-flight request across concurrent calls', async () => {
    const { storage } = cacheStorageWith(async () => undefined);
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([5, 5, 5])));
    const shared = deps(storage, fetchFn as unknown as typeof fetch);
    const [a, b] = await Promise.all([
      ensureModel('matting-quint8', { deps: shared }),
      ensureModel('matting-quint8', { deps: shared }),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('exposes an advertised size for disclosure', () => {
    expect(MODELS['matting-quint8'].bytes).toBeGreaterThan(0);
    expect(MODELS['face-landmarker'].label).toContain('Face');
  });
});
