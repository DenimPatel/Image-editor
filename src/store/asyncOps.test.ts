import { beforeEach, describe, expect, it } from 'vitest';
import { createDoc } from '../model/defaults';
import { useDocStore } from './docStore';
import { runAsyncEdit } from './asyncOps';

describe('runAsyncEdit', () => {
  beforeEach(() => {
    useDocStore.getState().load(createDoc());
  });

  it('commits exactly one history entry on success', async () => {
    const before = useDocStore.getState().present;
    const result = await runAsyncEdit<number>({
      label: 'test',
      run: async (_signal, onProgress) => {
        onProgress(0.5);
        return 42;
      },
      apply: (doc, value) => ({ ...doc, adjust: { ...doc.adjust, exposure: value } }),
    });
    expect(result.status).toBe('done');
    const state = useDocStore.getState();
    expect(state.past).toHaveLength(1);
    expect(state.past[0]).toBe(before);
    expect(state.present.adjust.exposure).toBe(42);
  });

  it('mutates nothing when the job fails', async () => {
    const before = useDocStore.getState().present;
    const result = await runAsyncEdit<number>({
      label: 'test',
      run: async () => {
        throw new Error('boom');
      },
      apply: (doc) => doc,
    });
    expect(result.status).toBe('error');
    const state = useDocStore.getState();
    expect(state.present).toBe(before);
    expect(state.past).toHaveLength(0);
  });

  it('mutates nothing when cancelled', async () => {
    const before = useDocStore.getState().present;
    const controller = new AbortController();
    const promise = runAsyncEdit<number>({
      label: 'test',
      externalSignal: controller.signal,
      run: (signal, onProgress) =>
        new Promise((_resolve, reject) => {
          onProgress(0.1);
          signal.addEventListener('abort', () => reject(new Error('cancelled')));
        }),
      apply: (doc) => doc,
    });
    controller.abort();
    const result = await promise;
    expect(result.status).toBe('cancelled');
    const state = useDocStore.getState();
    expect(state.present).toBe(before);
    expect(state.past).toHaveLength(0);
  });
});
