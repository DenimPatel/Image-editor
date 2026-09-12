import { createId } from './ids';
import type { AssetId } from './types';

/**
 * The out-of-band pixel store. `Doc` only ever references assets by id, so
 * this is the one place that owns live, closable GPU/CPU resources. Keeping
 * it here is the memory-leak firewall: every `ImageBitmap` is closed exactly
 * once, and assets reachable from undo/redo history are never collected.
 */
export interface DisposableAsset {
  readonly width: number;
  readonly height: number;
  close(): void;
}

type Entry = { asset: DisposableAsset; refs: number };

export class AssetStore {
  private readonly map = new Map<AssetId, Entry>();

  add(asset: DisposableAsset, id: AssetId = createId('asset')): AssetId {
    const existing = this.map.get(id);
    if (existing) {
      existing.refs += 1;
      return id;
    }
    this.map.set(id, { asset, refs: 1 });
    return id;
  }

  /** Alias making the intent explicit at call sites. */
  create(asset: DisposableAsset): AssetId {
    return this.add(asset);
  }

  get(id: AssetId): DisposableAsset | undefined {
    return this.map.get(id)?.asset;
  }

  has(id: AssetId): boolean {
    return this.map.has(id);
  }

  get size(): number {
    return this.map.size;
  }

  refCount(id: AssetId): number {
    return this.map.get(id)?.refs ?? 0;
  }

  retain(id: AssetId): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    entry.refs += 1;
    return true;
  }

  release(id: AssetId): boolean {
    const entry = this.map.get(id);
    if (!entry) return false;
    entry.refs = Math.max(0, entry.refs - 1);
    return true;
  }

  /**
   * Close every asset whose id is not in `live`. Callers pass the union of
   * asset ids referenced by the present doc *and* every past/future doc, so
   * undoing an edit never resurrects a closed bitmap.
   */
  prune(live: ReadonlySet<AssetId>): number {
    let closed = 0;
    for (const [id, entry] of this.map) {
      if (!live.has(id)) {
        entry.asset.close();
        this.map.delete(id);
        closed += 1;
      }
    }
    return closed;
  }

  clear(): void {
    for (const entry of this.map.values()) entry.asset.close();
    this.map.clear();
  }
}
