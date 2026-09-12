import { bitmapToBlob } from '../../lib/decode';
import { ModelUnavailableError, type ModelKind } from './ModelLoader';

export type MattingQuality = 'fast' | 'best';
type MattingModelId = 'isnet_quint8' | 'isnet_fp16';

function kindFor(quality: MattingQuality): ModelKind {
  return quality === 'best' ? 'matting-fp16' : 'matting-quint8';
}

function modelFor(quality: MattingQuality): MattingModelId {
  return quality === 'best' ? 'isnet_fp16' : 'isnet_quint8';
}

const readyQualities = new Set<MattingQuality>();

/** Whether a run has already succeeded for this quality tier, so the UI's "(cached)" hint is truthful. */
export function isMattingReady(quality: MattingQuality): boolean {
  return readyQualities.has(quality);
}

// Messages @imgly/background-removal (and the onnxruntime-web session it
// creates) throws when its CDN assets can't be fetched — everything else is
// a real removal failure, not a missing model.
const ASSET_ERROR_PATTERNS = [
  /resource metadata not found/i,
  /resource .* not found/i,
  /failed to fetch/i,
  /failed to create session/i,
];

function isAssetError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) return ASSET_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
  return false;
}

type RemoveBackgroundFn = (
  input: Blob,
  config?: {
    model?: MattingModelId;
    output?: { format?: string };
    progress?: (key: string, current: number, total: number) => void;
    fetchArgs?: RequestInit;
  },
) => Promise<Blob>;

/**
 * Remove the background from an image via @imgly/background-removal, whose
 * weights and onnxruntime-web wasm stream from its CDN on first use and are
 * then cached by the browser. Loaded dynamically so the ~2 MB of ORT/imgly
 * JS stays out of the initial bundle.
 */
export async function removeBackground(
  source: ImageBitmap,
  options: { quality: MattingQuality; onProgress?: (progress: number) => void; signal?: AbortSignal },
): Promise<ImageBitmap> {
  let removeBackgroundFn: RemoveBackgroundFn;
  try {
    const mod = (await import('@imgly/background-removal')) as { removeBackground: RemoveBackgroundFn };
    removeBackgroundFn = mod.removeBackground;
  } catch (error) {
    throw new ModelUnavailableError(kindFor(options.quality), error);
  }

  try {
    const blob = await bitmapToBlob(source, 'image/png');
    const resultBlob = await removeBackgroundFn(blob, {
      model: modelFor(options.quality),
      output: { format: 'image/png' },
      progress: (_key, current, total) => options.onProgress?.(total > 0 ? current / total : 0),
      // Forwarded to every model-chunk fetch, so Cancel actually aborts an
      // in-flight download instead of only being noticed after it resolves.
      fetchArgs: options.signal ? { signal: options.signal } : undefined,
    });
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const bitmap = await createImageBitmap(resultBlob);
    readyQualities.add(options.quality);
    return bitmap;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (isAssetError(error)) throw new ModelUnavailableError(kindFor(options.quality), error);
    throw error;
  }
}
