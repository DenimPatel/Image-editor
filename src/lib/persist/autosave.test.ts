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

describe('cancel', () => {
  it('drops a write that has not started, which is what a replacement needs', async () => {
    // "New image" replaces the document and deletes its stored row. A debounce still
    // armed for the *old* document would then commit that row again, and the reload
    // would offer back the photograph the user just replaced — which is the defect
    // this was added for, one layer down from where it used to be fixed.
    const { autosave, stats } = harness({ debounceMs: 1000, maxWaitMs: 5000 })
    autosave.schedule()
    expect(autosave.pending()).toBe(true)

    autosave.cancel()

    expect(autosave.pending()).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(stats.saves).toBe(0)
    autosave.dispose()
  })

  it('leaves the scheduler alive, so the next document is still saved', () => {
    // `dispose()` would have been the wrong tool here: it closes the scheduler for
    // the life of the editor, and the document the user picks next would never be
    // saved at all. That failure is silent — nothing on screen says "your next
    // photo is not being kept" — so it is asserted rather than assumed.
    const { autosave, stats } = harness({ debounceMs: 10, maxWaitMs: 50 })
    autosave.schedule()
    autosave.cancel()

    autosave.schedule()
    expect(autosave.pending()).toBe(true)
    void autosave.flush()
    expect(stats.saves).toBe(1)
    autosave.dispose()
  })

  it('leaves a write already in flight alone, and lets the follow-up through', async () => {
    // A transaction that has been dispatched cannot be recalled, and killing the
    // reference would only stop the replacement's own write from being scheduled.
    const { autosave, stats, settle } = harness({ debounceMs: 10, maxWaitMs: 10 }, true)
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(stats.saves).toBe(1)

    autosave.cancel()
    autosave.schedule()
    settle()
    await vi.advanceTimersByTimeAsync(10)
    expect(stats.saves).toBe(2)
    settle()
    await vi.advanceTimersByTimeAsync(20)
    expect(stats.saves).toBe(2)
    autosave.dispose()
  })

  it('drops the follow-up write a queued edit would fire behind an in-flight one', async () => {
    // The data-loss path this closes, at the layer it actually lives at.
    //
    // `run()` re-enters itself when `queued` is set: an edit that lands *while* a
    // write is in flight marks it, and the next line after the in-flight write
    // settles fires exactly one more write. "New image" replaces the document and
    // then deletes the stored row — so with the replacement's edits still queued,
    // that follow-up write commits the row a moment later, and the replaced
    // photograph is back in IndexedDB. Nothing wrote it afterwards, so it stayed.
    //
    // `cancel()` used to return early whenever a write was in flight, on the
    // reasonable-sounding grounds that an in-flight transaction cannot be recalled.
    // That reasoning is about the *current* write and says nothing about the queued
    // one, which is exactly the one that lands after the delete.
    const { autosave, stats, settle } = harness({ debounceMs: 10, maxWaitMs: 10 }, true)
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(stats.saves).toBe(1)

    // The edit that arrives mid-write and arms the follow-up.
    autosave.schedule()
    autosave.cancel()
    settle()
    await vi.advanceTimersByTimeAsync(50)

    expect(stats.saves).toBe(1)
    autosave.dispose()
  })

  it('idle() does not resolve until a write already in flight has settled', async () => {
    // Without this the caller deletes the stored row in the same tick and loses the
    // race: the transaction `cancel()` could not recall commits *after* the delete,
    // and the replaced photograph's row is recreated by the gesture that replaced
    // it. `replaceDocument` awaits `idle()` before `forgetStoredDocument` for
    // precisely this ordering, and this is the assertion that makes the ordering
    // load-bearing rather than incidental.
    const { autosave, stats, settle } = harness({ debounceMs: 10, maxWaitMs: 10 }, true)
    autosave.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(stats.saves).toBe(1)

    autosave.cancel()
    let resolved = false
    const waiting = autosave.idle().then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(resolved).toBe(false)

    settle()
    await waiting
    expect(resolved).toBe(true)
    autosave.dispose()
  })

  it('idle() resolves immediately when nothing is in flight, and after dispose', async () => {
    // `await`-ed from a click handler on the common path, so a promise that only
    // settles on the next write would hang the replacement for a document that has
    // never been saved.
    const { autosave } = harness({ debounceMs: 10, maxWaitMs: 10 })
    await expect(autosave.idle()).resolves.toBeUndefined()
    autosave.dispose()
    await expect(autosave.idle()).resolves.toBeUndefined()
  })

  it('does nothing on a disposed scheduler', () => {
    const { autosave } = harness({ debounceMs: 10, maxWaitMs: 10 })
    autosave.dispose()
    expect(() => autosave.cancel()).not.toThrow()
  })
})
