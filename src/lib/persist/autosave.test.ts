import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachUnloadFlush, createAutosave, type Autosave } from './autosave'
import type { SaveResult } from './session'

type Harness = {
  autosave: Autosave
  /** Live counters: a save can land after the harness is built. */
  stats: { saves: number; results: SaveResult[] }
  /** Release a held write. */
  settle: () => void
}

function harness(options: { debounceMs?: number; maxWaitMs?: number } = {}, hold = false): Harness {
  const stats = { saves: 0, results: [] as SaveResult[] }
  let release: (() => void) | null = null
  const autosave = createAutosave(
    {
      save: async () => {
        stats.saves += 1
        if (hold) await new Promise<void>((resolve) => (release = resolve))
        return 'ok' as SaveResult
      },
      onResult: (result) => stats.results.push(result),
    },
    options,
  )
  return { autosave, stats, settle: () => release?.() }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createAutosave', () => {
  it('D2-F11: 100 edits over 10 s write on the maxWait deadline, not never', async () => {
    const { autosave, stats } = harness({ debounceMs: 1000, maxWaitMs: 2000 })
    for (let edit = 0; edit < 100; edit += 1) {
      autosave.schedule()
      await vi.advanceTimersByTimeAsync(100)
    }
    // A pure trailing debounce is still sitting on zero writes at this point.
    expect(stats.saves).toBeGreaterThanOrEqual(4)
    expect(stats.saves).toBeLessThanOrEqual(6)
  })

  it('D2-F11: flush writes immediately even in the middle of a stream', async () => {
    const { autosave, stats } = harness({ debounceMs: 1000, maxWaitMs: 5000 })
    autosave.schedule()
    for (let edit = 0; edit < 5; edit += 1) {
      await vi.advanceTimersByTimeAsync(100)
      autosave.schedule()
    }
    expect(stats.saves).toBe(0)
    await autosave.flush()
    expect(stats.saves).toBe(1)
    // Nothing changed since, so a second flush is not another write.
    await autosave.flush()
    expect(stats.saves).toBe(1)
    expect(autosave.pending()).toBe(false)
  })

  it('D2-F11: a slow write is followed by exactly one write, never two in parallel', async () => {
    const { autosave, stats, settle } = harness({ debounceMs: 10, maxWaitMs: 10 }, true)
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(stats.saves).toBe(1)
    for (let edit = 0; edit < 8; edit += 1) {
      autosave.schedule()
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(stats.saves).toBe(1)
    settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(stats.saves).toBe(2)
    settle()
    await vi.advanceTimersByTimeAsync(20)
    expect(stats.saves).toBe(2)
  })

  it('D2-F11: a rejected write is reported, not left unhandled', async () => {
    const results: SaveResult[] = []
    const autosave = createAutosave(
      {
        save: () => Promise.reject(new Error('idb exploded')),
        onResult: (result) => results.push(result),
      },
      { debounceMs: 10 },
    )
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(results).toEqual(['error'])
    expect(autosave.pending()).toBe(false)
  })

  it('dispose drops pending work', async () => {
    const { autosave, stats } = harness({ debounceMs: 100 })
    autosave.schedule()
    autosave.dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(stats.saves).toBe(0)
    expect(autosave.pending()).toBe(false)
  })
})

/**
 * The residual the debounce and `flush()` could not close: an IndexedDB write
 * is a transaction, and a hard reload fires `pagehide` and then stops turning
 * the event loop before the transaction can commit. Every `save` below never
 * settles, which is exactly what the page does to it.
 */
describe('createAutosave — the synchronous mirror', () => {
  it('D2-F11: a teardown mid-write still lands the mirror, before any await', async () => {
    const mirror = vi.fn()
    const autosave = createAutosave(
      { save: () => new Promise<SaveResult>(() => {}), mirror },
      { debounceMs: 1000, maxWaitMs: 5000 },
    )
    autosave.schedule()
    expect(mirror).not.toHaveBeenCalled()

    // The `pagehide` handler: started, never awaited, exactly as the unload
    // hook calls it.
    void autosave.flush()

    expect(mirror).toHaveBeenCalledTimes(1)
  })

  it('D2-F11: pagehide lands the mirror even while a write is already in flight', async () => {
    const mirror = vi.fn()
    const held: { release: (() => void) | null } = { release: null }
    let calls = 0
    const autosave = createAutosave(
      {
        save: () => {
          calls += 1
          if (calls > 1) return Promise.resolve('ok')
          return new Promise<SaveResult>((resolve) => {
            held.release = () => resolve('ok')
          })
        },
        mirror,
      },
      { debounceMs: 10, maxWaitMs: 10 },
    )
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(mirror).toHaveBeenCalledTimes(1)

    // An edit lands during the write, so `flush()` has to await before it can
    // start the follow-up. The mirror must not wait for that.
    autosave.schedule()
    const flush = autosave.flush()
    expect(mirror).toHaveBeenCalledTimes(2)
    held.release?.()
    await flush
  })

  it('D2-F11: the mirror is stamped on the save throttle, not on every edit', async () => {
    const mirror = vi.fn()
    const saves: SaveResult[] = []
    const autosave = createAutosave(
      { save: async () => 'ok', mirror, onResult: (result) => saves.push(result) },
      { debounceMs: 1000, maxWaitMs: 1000 },
    )
    for (let edit = 0; edit < 20; edit += 1) {
      autosave.schedule()
      await vi.advanceTimersByTimeAsync(50)
    }
    // 20 edits, one save: the mirror follows the save, so it is one too.
    expect(saves).toHaveLength(1)
    expect(mirror).toHaveBeenCalledTimes(saves.length)
  })

  it('D2-F11: a teardown stamps the mirror exactly once, not once per layer', async () => {
    const mirror = vi.fn()
    const autosave = createAutosave(
      { save: async () => 'ok', mirror },
      { debounceMs: 1000, maxWaitMs: 5000 },
    )
    autosave.schedule()
    await autosave.flush()
    expect(mirror).toHaveBeenCalledTimes(1)
  })

  it('D2-F11: a mirror that throws cannot take the save down with it', async () => {
    const stats: SaveResult[] = []
    const autosave = createAutosave(
      {
        save: async () => 'ok',
        mirror: () => {
          throw new Error('localStorage is full')
        },
        onResult: (result) => stats.push(result),
      },
      { debounceMs: 10 },
    )
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(stats).toEqual(['ok'])
  })

  it('D2-F11: a disposed autosave mirrors nothing', () => {
    const mirror = vi.fn()
    const autosave = createAutosave({ save: async () => 'ok', mirror }, { debounceMs: 10 })
    autosave.schedule()
    autosave.dispose()
    void autosave.flush()
    expect(mirror).not.toHaveBeenCalled()
  })
})

describe('attachUnloadFlush', () => {
  it('D2-F11: pagehide flushes immediately', async () => {
    const { autosave, stats } = harness({ debounceMs: 1000, maxWaitMs: 5000 })
    const detach = attachUnloadFlush(window, () => void autosave.flush())
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(100)
    expect(stats.saves).toBe(0)
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)
    expect(stats.saves).toBe(1)
    detach()
  })

  it('D2-F11: a hidden tab flushes, a visible one does not', async () => {
    const { autosave, stats } = harness({ debounceMs: 1000, maxWaitMs: 5000 })
    const visibility = { value: 'visible' }
    const view = {
      get visibilityState() {
        return visibility.value
      },
      addEventListener: document.addEventListener.bind(document),
      removeEventListener: document.removeEventListener.bind(document),
    } as unknown as Document
    const detach = attachUnloadFlush(window, () => void autosave.flush(), view)
    autosave.schedule()
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(stats.saves).toBe(0)
    visibility.value = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(stats.saves).toBe(1)
    detach()
  })

  it('detaching stops the flush', () => {
    const flush = vi.fn()
    const detach = attachUnloadFlush(window, flush)
    detach()
    window.dispatchEvent(new Event('pagehide'))
    expect(flush).not.toHaveBeenCalled()
  })
})
