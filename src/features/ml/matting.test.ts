import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isMattingReady, removeBackground } from './matting';
import { ModelUnavailableError } from './ModelLoader';

const removeBackgroundMock = vi.fn();

vi.mock('@imgly/background-removal', () => ({
  removeBackground: (...args: unknown[]) => removeBackgroundMock(...args),
}));

vi.mock('../../lib/decode', () => ({
  bitmapToBlob: vi.fn(async () => new Blob(['fake'], { type: 'image/png' })),
}));

const fakeBitmap = { width: 10, height: 10 } as unknown as ImageBitmap;

describe('removeBackground', () => {
  beforeEach(() => {
    removeBackgroundMock.mockReset();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap),
    );
  });

  it('reports a model not yet used as not ready', () => {
    expect(isMattingReady('fast')).toBe(false);
    expect(isMattingReady('best')).toBe(false);
  });

  it('maps "fast" quality to the isnet_quint8 model and marks it ready', async () => {
    removeBackgroundMock.mockResolvedValue(new Blob());
    await removeBackground(fakeBitmap, { quality: 'fast' });
    expect(removeBackgroundMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'isnet_quint8' }),
    );
    expect(isMattingReady('fast')).toBe(true);
    expect(isMattingReady('best')).toBe(false);
  });

  it('maps "best" quality to the isnet_fp16 model and marks it ready', async () => {
    removeBackgroundMock.mockResolvedValue(new Blob());
    await removeBackground(fakeBitmap, { quality: 'best' });
    expect(removeBackgroundMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'isnet_fp16' }),
    );
    expect(isMattingReady('best')).toBe(true);
  });

  it('wraps an asset-loading failure as ModelUnavailableError', async () => {
    removeBackgroundMock.mockRejectedValue(new Error('Resource metadata not found'));
    await expect(removeBackground(fakeBitmap, { quality: 'fast' })).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('does not wrap an arbitrary removal failure', async () => {
    removeBackgroundMock.mockRejectedValue(new Error('subject mask degenerate'));
    const error = await removeBackground(fakeBitmap, { quality: 'fast' }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ModelUnavailableError);
  });

  it('propagates AbortError untouched', async () => {
    removeBackgroundMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const controller = new AbortController();
    const error = await removeBackground(fakeBitmap, { quality: 'fast', signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});
