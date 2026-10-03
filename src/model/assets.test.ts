import { describe, expect, it, vi } from 'vitest'
import { AssetStore } from './assets'

function asset(width = 10, height = 10) {
  return { width, height, close: vi.fn() }
}

describe('AssetStore', () => {
  it('adds, gets and reports size', () => {
    const store = new AssetStore()
    const a = asset()
    const id = store.add(a)
    expect(store.get(id)).toBe(a)
    expect(store.has(id)).toBe(true)
    expect(store.size).toBe(1)
    expect(store.refCount(id)).toBe(1)
  })

  it('tracks refcounts', () => {
    const store = new AssetStore()
    const id = store.add(asset())
    store.retain(id)
    expect(store.refCount(id)).toBe(2)
    store.release(id)
    expect(store.refCount(id)).toBe(1)
  })

  it('prunes and closes assets not in the live set, keeping live ones', () => {
    const store = new AssetStore()
    const live = asset()
    const dead = asset()
    const liveId = store.add(live)
    const deadId = store.add(dead)
    const closed = store.prune(new Set([liveId]))
    expect(closed).toBe(1)
    expect(dead.close).toHaveBeenCalledTimes(1)
    expect(live.close).not.toHaveBeenCalled()
    expect(store.has(deadId)).toBe(false)
    expect(store.has(liveId)).toBe(true)
  })

  it('keeps assets reachable from history and closes them only when released from it', () => {
    const store = new AssetStore()
    const before = asset()
    const after = asset()
    const beforeId = store.add(before)
    const afterId = store.add(after)
    // Generation 1: both docs (past + present) are live.
    store.prune(new Set([beforeId, afterId]))
    expect(before.close).not.toHaveBeenCalled()
    // Generation 2: the past doc has been discarded.
    store.prune(new Set([afterId]))
    expect(before.close).toHaveBeenCalledTimes(1)
    expect(after.close).not.toHaveBeenCalled()
  })

  it('clears everything', () => {
    const store = new AssetStore()
    const a = asset()
    store.add(a)
    store.clear()
    expect(a.close).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(0)
  })
})

describe('D1-F09: add() must not leak the asset it is handed on an id collision', () => {
  it('closes the incoming asset and keeps the one already stored', () => {
    const store = new AssetStore()
    const first = asset()
    const second = asset()
    store.add(first, 'x')
    store.add(second, 'x')
    expect(second.close).toHaveBeenCalledTimes(1)
    expect(first.close).not.toHaveBeenCalled()
    expect(store.get('x')).toBe(first)
    expect(store.size).toBe(1)
  })

  it('closing a whole session that resumes twice closes every discarded bitmap once', () => {
    const store = new AssetStore()
    const kept = asset(4000, 3000)
    const resume1 = asset(4000, 3000)
    const resume2 = asset(4000, 3000)
    store.add(kept, 'src')
    store.add(resume1, 'src')
    store.add(resume2, 'src')
    store.clear()
    expect(resume1.close).toHaveBeenCalledTimes(1)
    expect(resume2.close).toHaveBeenCalledTimes(1)
    expect(kept.close).toHaveBeenCalledTimes(1)
  })

  it('a collision is rejected, not counted as a second owner', () => {
    const store = new AssetStore()
    store.add(asset(), 'x')
    store.add(asset(), 'x')
    expect(store.refCount('x')).toBe(1)
  })

  it('create() routes through add() and so inherits the same guarantee', () => {
    const store = new AssetStore()
    const first = asset()
    const second = asset()
    const id = store.create(first)
    store.add(second, id)
    expect(second.close).toHaveBeenCalledTimes(1)
    expect(store.get(id)).toBe(first)
  })
})

describe('D1-F09: byte accounting, LRU order and a budget', () => {
  const MB = 1024 * 1024

  it('estimates 4 bytes per pixel per stored asset', () => {
    const store = new AssetStore()
    store.add(asset(1000, 500))
    expect(store.bytes).toBe(1000 * 500 * 4)
  })

  it('ignores a non-finite or negative dimension rather than reporting NaN', () => {
    const store = new AssetStore()
    store.add({ width: Number.NaN, height: 10, close: vi.fn() })
    store.add({ width: -4, height: 10, close: vi.fn() })
    expect(store.bytes).toBe(0)
  })

  it('orders assets by when they were last read', () => {
    const store = new AssetStore()
    const first = store.add(asset(), 'first')
    const second = store.add(asset(), 'second')
    const third = store.add(asset(), 'third')
    expect(store.lruOrder()).toEqual([first, second, third])
    // Reading the oldest entry promotes it to the newest.
    store.get(first)
    expect(store.lruOrder()).toEqual([second, third, first])
  })

  it('evicts the least-recently-read assets until the budget is met', () => {
    const store = new AssetStore()
    // 10 assets of 1 MB each.
    const ids = Array.from({ length: 10 }, (_, index) => store.add(asset(512, 512), `a${index}`))
    expect(store.bytes).toBe(10 * MB)
    store.setByteBudget(5 * MB)
    expect(store.byteBudget).toBe(5 * MB)
    const evicted = store.evictToBudget()
    expect(evicted).toEqual(ids.slice(0, 5))
    expect(store.size).toBe(5)
    expect(store.bytes).toBe(5 * MB)
    for (const id of ids.slice(0, 5)) expect(store.has(id)).toBe(false)
    for (const id of ids.slice(5)) expect(store.has(id)).toBe(true)
  })

  it('closes each evicted asset exactly once', () => {
    const store = new AssetStore()
    const assets = Array.from({ length: 4 }, () => asset(512, 512))
    for (const [index, entry] of assets.entries()) store.add(entry, `a${index}`)
    store.setByteBudget(1 * MB)
    store.evictToBudget()
    expect(assets.filter((entry) => entry.close.mock.calls.length > 0)).toHaveLength(3)
    for (const entry of assets) expect(entry.close.mock.calls.length).toBeLessThanOrEqual(1)
    // A second pass has nothing left to do.
    expect(store.evictToBudget()).toEqual([])
  })

  it('never evicts an asset the caller pinned as reachable from history', () => {
    const store = new AssetStore()
    const oldest = asset(512, 512)
    const newer = Array.from({ length: 4 }, () => asset(512, 512))
    const pinned = store.add(oldest, 'pinned')
    const others = newer.map((entry, index) => store.add(entry, `a${index}`))
    store.setByteBudget(0.5 * MB)
    const evicted = store.evictToBudget(new Set([pinned]))
    expect(evicted).toEqual(others)
    expect(store.has(pinned)).toBe(true)
    // Over budget, but the pin is honoured: correctness beats the budget.
    expect(store.bytes).toBe(MB)
    expect(store.bytes).toBeGreaterThan(store.byteBudget)
  })

  it('does nothing when the store is already inside the budget', () => {
    const store = new AssetStore()
    const a = asset(100, 100)
    store.add(a)
    expect(store.evictToBudget()).toEqual([])
    expect(a.close).not.toHaveBeenCalled()
  })

  it('falls back to the default budget for a nonsensical one', () => {
    const store = new AssetStore()
    store.setByteBudget(0)
    expect(store.byteBudget).toBe(512 * MB)
    store.setByteBudget(Number.NaN)
    expect(store.byteBudget).toBe(512 * MB)
  })
})
