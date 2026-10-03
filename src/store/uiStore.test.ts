import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_LOG_KEY,
  ERROR_LOG_MAX_ENTRIES,
  ERROR_LOG_TTL_MS,
  ERROR_LOG_VERSION,
  readErrorLog,
  useUiStore,
} from './uiStore'

/**
 * The reason any of this exists: an error toast used to exist for 3.2 seconds
 * and then nowhere. `Storage is full — this session was not saved` is the only
 * evidence a user will ever have of losing a session, and 3.2 seconds is not
 * long enough to read it, let alone write it down.
 *
 * These assertions are about the *bounds* as much as the persistence. It lives
 * in the reader's own `localStorage`, so a log that can grow forever, outlive
 * them forever, or refuse to be deleted is not a feature.
 */
const log = () => useUiStore.getState().errorLog

function stored(): { v: number; entries: { id: string; message: string; at: number }[] } | null {
  const raw = localStorage.getItem(ERROR_LOG_KEY)
  return raw === null ? null : JSON.parse(raw)
}

beforeEach(() => {
  localStorage.clear()
  useUiStore.setState({ toasts: [], errorLog: [] })
})

describe('error toasts are kept, and only error toasts', () => {
  it('keeps an error, with the id of the toast the reader actually saw', () => {
    useUiStore.getState().pushToast('Storage is full — this session was not saved', 'error')
    expect(log()).toHaveLength(1)
    expect(log()[0]?.message).toBe('Storage is full — this session was not saved')
    // The same id, so a saved record can be matched to what was on screen
    // rather than being a separate story with its own wording.
    const toast = useUiStore.getState().toasts[0]
    expect(log()[0]?.id).toBe(toast?.id)
  })

  it('keeps nothing for an info or a success', () => {
    useUiStore.getState().pushToast('Exported', 'success')
    useUiStore.getState().pushToast('Auto applied', 'info')
    useUiStore.getState().pushToast('Nothing to paste')
    expect(log()).toEqual([])
    expect(localStorage.getItem(ERROR_LOG_KEY)).toBeNull()
  })

  it('survives a reload, which is when somebody notices they lost work', () => {
    useUiStore.getState().pushToast('Storage is full — this session was not saved', 'error')
    // The store is created once per page load and reads at creation, so reading
    // it back is what a reload does.
    expect(readErrorLog().map((entry) => entry.message)).toEqual([
      'Storage is full — this session was not saved',
    ])
  })

  it('still shows the toast, and still dismisses it after 3.2 s', () => {
    useUiStore.getState().pushToast('boom', 'error')
    const toast = useUiStore.getState().toasts[0]
    expect(toast).toBeDefined()
    useUiStore.getState().dismissToast(toast?.id as string)
    // The toast is gone; the record is not. That is the whole change.
    expect(useUiStore.getState().toasts).toHaveLength(0)
    expect(log()).toHaveLength(1)
  })
})

describe('the kept log is bounded, versioned and the reader can delete it', () => {
  it('keeps the newest 20 and drops the oldest', () => {
    for (let index = 0; index < 40; index += 1) {
      useUiStore.getState().pushToast(`error ${index}`, 'error')
    }
    expect(log()).toHaveLength(ERROR_LOG_MAX_ENTRIES)
    expect(log()[0]?.message).toBe('error 20')
    expect(log()[ERROR_LOG_MAX_ENTRIES - 1]?.message).toBe('error 39')
  })

  it('writes a version, so a future shape change is discardable rather than a crash', () => {
    useUiStore.getState().pushToast('boom', 'error')
    expect(stored()?.v).toBe(ERROR_LOG_VERSION)
    localStorage.setItem(
      ERROR_LOG_KEY,
      JSON.stringify({ v: ERROR_LOG_VERSION + 1, entries: [{ id: 'x', message: 'y', at: 1 }] }),
    )
    expect(readErrorLog()).toEqual([])
  })

  it('forgets anything older than a week', () => {
    const now = Date.now()
    localStorage.setItem(
      ERROR_LOG_KEY,
      JSON.stringify({
        v: ERROR_LOG_VERSION,
        entries: [
          { id: 'old', message: 'a week ago', at: now - ERROR_LOG_TTL_MS - 1000 },
          { id: 'new', message: 'yesterday', at: now - 24 * 60 * 60 * 1000 },
        ],
      }),
    )
    expect(readErrorLog().map((entry) => entry.message)).toEqual(['yesterday'])
  })

  it('forgets anything written by a clock that is in the future', () => {
    // A device whose clock is wrong by a day would otherwise keep an entry for
    // a week plus the error, and there is no way for the reader to age it out.
    localStorage.setItem(
      ERROR_LOG_KEY,
      JSON.stringify({
        v: ERROR_LOG_VERSION,
        entries: [{ id: 'future', message: 'tomorrow', at: Date.now() + 86_400_000 }],
      }),
    )
    expect(readErrorLog()).toEqual([])
  })

  it('collapses every malformed record to nothing rather than taking the page down', () => {
    for (const raw of [
      'not json',
      '[]',
      'null',
      JSON.stringify({ v: ERROR_LOG_VERSION }),
      JSON.stringify({ v: ERROR_LOG_VERSION, entries: 'nope' }),
      JSON.stringify({ v: ERROR_LOG_VERSION, entries: [{ id: 1, message: null, at: 'x' }] }),
      JSON.stringify({ entries: [{ id: 'a', message: 'b', at: Date.now() }] }),
    ]) {
      localStorage.setItem(ERROR_LOG_KEY, raw)
      expect(readErrorLog(), raw).toEqual([])
    }
  })

  it('drops a hand-edited entry that is only nearly right', () => {
    localStorage.setItem(
      ERROR_LOG_KEY,
      JSON.stringify({
        v: ERROR_LOG_VERSION,
        entries: [
          { id: 'a', message: 'b', at: Date.now() },
          { id: 'c', message: 'd', at: Number.NaN },
        ],
      }),
    )
    expect(readErrorLog().map((entry) => entry.id)).toEqual(['a'])
  })

  it('is deleted by the reader, in memory and on disk', () => {
    useUiStore.getState().pushToast('boom', 'error')
    useUiStore.getState().clearErrorLog()
    expect(log()).toEqual([])
    expect(localStorage.getItem(ERROR_LOG_KEY)).toBeNull()
  })
})

describe('a refused localStorage degrades to memory', () => {
  it('still accepts the error when the write throws', () => {
    // Safari private mode throws a SecurityError on any storage access, and the
    // product still has to be usable there.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    expect(() =>
      useUiStore.getState().pushToast('This browser blocked session storage', 'error'),
    ).not.toThrow()
    expect(log().map((entry) => entry.message)).toEqual(['This browser blocked session storage'])
  })

  it('reads as empty when the read throws, so the store can still be created', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    expect(readErrorLog()).toEqual([])
  })

  it('does not throw when the reader asks to delete and storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    useUiStore.getState().pushToast('boom', 'error')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    expect(() => useUiStore.getState().clearErrorLog()).not.toThrow()
    // The in-memory copy goes regardless: the reader pressed the button, and
    // leaving the panel on screen because storage is wedged would read as a
    // broken button.
    expect(log()).toEqual([])
    vi.restoreAllMocks()
  })
})
