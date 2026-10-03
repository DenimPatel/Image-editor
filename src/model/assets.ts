import { createId } from './ids'
import type { AssetId } from './types'

/**
 * The out-of-band pixel store. `Doc` only ever references assets by id, so
 * this is the one place that owns live, closable GPU/CPU resources. Keeping
 * it here is the memory-leak firewall: every `ImageBitmap` is closed exactly
 * once, and assets reachable from undo/redo history are never collected.
 */
export interface DisposableAsset {
  readonly width: number
  readonly height: number
  close(): void
}

type Entry = { asset: DisposableAsset; refs: number; bytes: number; lastUsed: number }

/** 4 bytes per pixel — the only honest estimate available for an `ImageBitmap`. */
function assetBytes(asset: DisposableAsset): number {
  const width = Number.isFinite(asset.width) ? Math.max(0, asset.width) : 0
  const height = Number.isFinite(asset.height) ? Math.max(0, asset.height) : 0
  return Math.round(width * height * 4)
}

/**
 * What the process will keep resident when nothing is pinning an asset. The
 * old store had no ceiling at all: `liveAssetIds()` pins every id reachable from
 * 50 past documents plus the present one plus every future document, so a long
 * editing session could hold hundreds of megapixels of `ImageBitmap` and rely on
 * the browser to survive it. `prune` is still the correctness contract — it is
 * the only thing that knows what is still reachable — and this budget is the
 * backstop underneath it.
 */
export const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024

export class AssetStore {
  private readonly map = new Map<AssetId, Entry>()
  private clock = 0
  private budget = DEFAULT_BUDGET_BYTES

  /**
   * Adding under an id that is already taken *discards the incoming asset*: the
   * id is the document's handle on a specific set of pixels, so the one already
   * stored is the one every reference means. The old code returned early
   * without calling `close()` on what it had been handed, so pressing Resume
   * twice leaked a full `ImageBitmap` per press.
   */
  add(asset: DisposableAsset, id: AssetId = createId('asset')): AssetId {
    const existing = this.map.get(id)
    if (existing) {
      // The collision is *rejected*, not retained: the id names one specific
      // set of pixels, so a second `add` is a caller bug rather than a second
      // owner. Counting it as a reference would make `refCount` a lie and pin
      // the entry against any future refcount-aware eviction.
      asset.close()
      return id
    }
    this.map.set(id, {
      asset,
      refs: 1,
      bytes: assetBytes(asset),
      lastUsed: (this.clock += 1),
    })
    return id
  }

  /** Alias making the intent explicit at call sites. */
  create(asset: DisposableAsset): AssetId {
    return this.add(asset)
  }

  get(id: AssetId): DisposableAsset | undefined {
    const entry = this.map.get(id)
    if (!entry) return undefined
    // Reading is the only usage signal there is: a bitmap the renderer is not
    // pulling from is the first candidate for eviction.
    entry.lastUsed = this.clock += 1
    return entry.asset
  }

  has(id: AssetId): boolean {
    return this.map.has(id)
  }

  get size(): number {
    return this.map.size
  }

  /** Total estimated resident bytes across every stored asset. */
  get bytes(): number {
    let total = 0
    for (const entry of this.map.values()) total += entry.bytes
    return total
  }

  get byteBudget(): number {
    return this.budget
  }

  setByteBudget(bytes: number): void {
    this.budget = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : DEFAULT_BUDGET_BYTES
  }

  refCount(id: AssetId): number {
    return this.map.get(id)?.refs ?? 0
  }

  /**
   * Advisory ownership counter, for callers that hand an asset to something
   * which is not the document. It is deliberately *not* an eviction gate:
   * `prune(live)` and `evictToBudget(pin)` both take the set of ids computed
   * from the documents themselves, which is a strictly stronger signal than a
   * hand-maintained count that nothing in the app currently keeps honest.
   */
  retain(id: AssetId): boolean {
    const entry = this.map.get(id)
    if (!entry) return false
    entry.refs += 1
    return true
  }

  release(id: AssetId): boolean {
    const entry = this.map.get(id)
    if (!entry) return false
    entry.refs = Math.max(0, entry.refs - 1)
    return true
  }

  /**
   * Close every asset whose id is not in `live`. Callers pass the union of
   * asset ids referenced by the present doc *and* every past/future doc, so
   * undoing an edit never resurrects a closed bitmap.
   */
  prune(live: ReadonlySet<AssetId>): number {
    let closed = 0
    for (const [id, entry] of this.map) {
      if (!live.has(id)) {
        entry.asset.close()
        this.map.delete(id)
        closed += 1
      }
    }
    return closed
  }

  /**
   * Enforce the byte budget by evicting least-recently-read assets. `pin` is
   * the caller's live set — anything reachable from history is excluded, so the
   * budget can never destroy a bitmap an undo would need. Returns the ids it
   * closed.
   */
  evictToBudget(pin: ReadonlySet<AssetId> = new Set()): AssetId[] {
    const evicted: AssetId[] = []
    if (this.bytes <= this.budget) return evicted
    const candidates = [...this.map.entries()]
      .filter(([id]) => !pin.has(id))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    let total = this.bytes
    for (const [id, entry] of candidates) {
      if (total <= this.budget) break
      entry.asset.close()
      this.map.delete(id)
      total -= entry.bytes
      evicted.push(id)
    }
    return evicted
  }

  /** Ids in eviction order, oldest read first — the LRU view the budget uses. */
  lruOrder(): AssetId[] {
    return [...this.map.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed).map(([id]) => id)
  }

  clear(): void {
    for (const entry of this.map.values()) entry.asset.close()
    this.map.clear()
  }
}
