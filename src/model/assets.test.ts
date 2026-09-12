import { describe, expect, it, vi } from 'vitest';
import { AssetStore } from './assets';

function asset(width = 10, height = 10) {
  return { width, height, close: vi.fn() };
}

describe('AssetStore', () => {
  it('adds, gets and reports size', () => {
    const store = new AssetStore();
    const a = asset();
    const id = store.add(a);
    expect(store.get(id)).toBe(a);
    expect(store.has(id)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.refCount(id)).toBe(1);
  });

  it('tracks refcounts', () => {
    const store = new AssetStore();
    const id = store.add(asset());
    store.retain(id);
    expect(store.refCount(id)).toBe(2);
    store.release(id);
    expect(store.refCount(id)).toBe(1);
  });

  it('prunes and closes assets not in the live set, keeping live ones', () => {
    const store = new AssetStore();
    const live = asset();
    const dead = asset();
    const liveId = store.add(live);
    const deadId = store.add(dead);
    const closed = store.prune(new Set([liveId]));
    expect(closed).toBe(1);
    expect(dead.close).toHaveBeenCalledTimes(1);
    expect(live.close).not.toHaveBeenCalled();
    expect(store.has(deadId)).toBe(false);
    expect(store.has(liveId)).toBe(true);
  });

  it('keeps assets reachable from history and closes them only when released from it', () => {
    const store = new AssetStore();
    const before = asset();
    const after = asset();
    const beforeId = store.add(before);
    const afterId = store.add(after);
    // Generation 1: both docs (past + present) are live.
    store.prune(new Set([beforeId, afterId]));
    expect(before.close).not.toHaveBeenCalled();
    // Generation 2: the past doc has been discarded.
    store.prune(new Set([afterId]));
    expect(before.close).toHaveBeenCalledTimes(1);
    expect(after.close).not.toHaveBeenCalled();
  });

  it('clears everything', () => {
    const store = new AssetStore();
    const a = asset();
    store.add(a);
    store.clear();
    expect(a.close).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });
});
