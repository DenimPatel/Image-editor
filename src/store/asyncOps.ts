import { createId } from '../model/ids';
import type { Doc } from '../model/types';
import { getDoc, useDocStore } from './docStore';
import { useUiStore } from './uiStore';

/**
 * Async-edit contract shared by every worker-backed operation (export, ML
 * matting, encode). A job never touches history while it runs, and commits
 * exactly one history entry on success. Failure and cancellation mutate
 * nothing, so a user can keep editing while a slow job is in flight.
 */
export type AsyncRunResult<T> =
  | { status: 'done'; value: T }
  | { status: 'cancelled' }
  | { status: 'error'; error: unknown };

export async function runAsyncEdit<T>(params: {
  label: string;
  run: (signal: AbortSignal, onProgress: (progress: number) => void) => Promise<T>;
  apply: (doc: Doc, value: T) => Doc;
  key?: string;
  externalSignal?: AbortSignal;
}): Promise<AsyncRunResult<T>> {
  const jobId = createId('job');
  const ui = useUiStore.getState();
  ui.startJob({ id: jobId, label: params.label, progress: 0, status: 'running' });

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  params.externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const value = await params.run(controller.signal, (progress) => {
      useUiStore.getState().updateJob(jobId, { progress: Math.min(1, Math.max(0, progress)) });
    });

    if (controller.signal.aborted) {
      useUiStore.getState().finishJob(jobId, 'cancelled');
      return { status: 'cancelled' };
    }

    // Exactly one history entry, applied to the current doc so edits made
    // while the job ran are preserved (the recipe is value-based, not a
    // wholesale doc replacement).
    useDocStore.getState().update((doc) => params.apply(doc, value), { key: params.key });
    useUiStore.getState().finishJob(jobId, 'done');
    return { status: 'done', value };
  } catch (error) {
    if (controller.signal.aborted) {
      useUiStore.getState().finishJob(jobId, 'cancelled');
      return { status: 'cancelled' };
    }
    useUiStore.getState().finishJob(jobId, 'error');
    return { status: 'error', error };
  } finally {
    params.externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Convenience for recipes that only need the present doc. */
export function currentDoc(): Doc {
  return getDoc();
}