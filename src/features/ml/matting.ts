import { ModelUnavailableError, type ModelKind } from './ModelLoader';

export type MattingQuality = 'fast' | 'best';

const IMGLY_SPECIFIER = '@imgly/background-removal';

function kindFor(quality: MattingQuality): ModelKind {
  return quality === 'best' ? 'matting-fp16' : 'matting-quint8';
}

/**
 * Remove the background from an image using the self-hosted ISNet matting
 * model. The implementation is loaded at runtime (not bundled) so a build
 * without weights still succeeds; callers get a typed, friendly error if the
 * optional dependency/weights are missing and can offer the manual fallback.
 */
export async function removeBackground(
  source: ImageBitmap,
  options: { quality: MattingQuality; onProgress?: (progress: number) => void; signal?: AbortSignal },
): Promise<ImageBitmap> {
  try {
    const mod = (await import(/* @vite-ignore */ IMGLY_SPECIFIER)) as {
      removeBackground: (
        input: ImageBitmap,
        config?: { progress?: (key: string, current: number, total: number) => void; output?: { format?: string } },
      ) => Promise<Blob>;
    };
    if (typeof mod.removeBackground !== 'function') throw new Error('removeBackground missing');
    const blob = await mod.removeBackground(source, {
      output: { format: 'image/png' },
      progress: (_key, current, total) => options.onProgress?.(total > 0 ? current / total : 0),
    });
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return await createImageBitmap(blob);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ModelUnavailableError(kindFor(options.quality), error);
  }
}
