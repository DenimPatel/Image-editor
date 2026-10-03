import type { SaveResult } from './session'

/**
 * Autosave scheduler.
 *
 * The editor's edits arrive at frame rate, so a plain trailing debounce never
 * fires during a drag: every `schedule()` clears and re-arms the timer, and a
 * tab closed a second after the last change saves nothing. This scheduler
 * bounds the wait two ways — a trailing debounce for typing, and a `maxWait`
 * deadline for continuous input — and exposes an explicit `flush()` so an
 * unload handler can force the write.
 *
 * Writes never overlap: a `schedule()` that lands mid-write is coalesced into
 * exactly one follow-up write once the current one settles, so a slow `put`
 * cannot be immediately followed by another.
 *
 * Neither the timer nor `flush()` is enough on its own. A reload inside the
 * debounce window fires `pagehide`, `flush()` starts a write, and the teardown
 * that triggered the flush kills the transaction. The `mirror` hook is the way
 * out: it runs synchronously, on the same throttle, and lands anyway.
 */

export type AutosaveOptions = {
  /** Quiet period before a save. */
  debounceMs?: number
  /** Longest a change may wait, however busy the editor is. */
  maxWaitMs?: number
}

export type AutosaveDeps = {
  save: () => Promise<SaveResult>
  /**
   * A synchronous side-channel, called before `save` is ever started and again
   * at the top of `flush()`. It exists because a `pagehide` flush cannot rely
   * on an async write finishing: the teardown that motivated the flush also
   * kills the transaction. Anything this hook does must therefore be
   * synchronous and must not throw. See `persist/mirror.ts`.
   */
  mirror?: () => void
  onResult?: (result: SaveResult) => void
  setTimer?: (callback: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
  now?: () => number
}

export type Autosave = {
  /** Mark the document dirty. Cheap and safe to call on every edit. */
  schedule: () => void
  /** Write now if anything is pending; resolves when the write has settled. */
  flush: () => Promise<void>
  /** Drop pending work and release the timer. */
  dispose: () => void
  pending: () => boolean
}

export const AUTOSAVE_DEBOUNCE_MS = 1000
export const AUTOSAVE_MAX_WAIT_MS = 5000

export function createAutosave(deps: AutosaveDeps, options: AutosaveOptions = {}): Autosave {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS
  const maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS
  const setTimer =
    deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms) as unknown as number)
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle))
  const now = deps.now ?? (() => Date.now())

  let timer: number | null = null
  let dirtySince: number | null = null
  let inFlight: Promise<void> | null = null
  let queued = false
  let disposed = false

  const cancelTimer = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  const arm = () => {
    if (disposed || dirtySince === null || inFlight !== null) return
    const remaining = Math.max(0, dirtySince + maxWaitMs - now())
    const delay = Math.min(debounceMs, remaining)
    cancelTimer()
    timer = setTimer(() => {
      timer = null
      void run()
    }, delay)
  }

  const mirror = () => {
    try {
      deps.mirror?.()
    } catch {
      // The mirror is a safety net; it must never be the reason a save fails.
    }
  }

  const run = async (mirrored = false): Promise<void> => {
    if (disposed || dirtySince === null) return
    if (inFlight) {
      // A write is already running; the change that arrived during it rides
      // along on one follow-up write instead of starting a parallel one.
      queued = true
      return
    }
    dirtySince = null
    queued = false
    cancelTimer()
    // Same throttle as the IndexedDB write it shadows: the mirror is stamped
    // first so it can only ever be *ahead* of the durable row, never behind.
    // `flush()` passes `mirrored` because it has already stamped it, and two
    // synchronous writes of the same document per teardown is one too many.
    if (!mirrored) mirror()
    inFlight = deps
      .save()
      .then((result) => deps.onResult?.(result))
      .catch(() => deps.onResult?.('error'))
    try {
      await inFlight
    } finally {
      inFlight = null
    }
    if (queued) void run()
    else arm()
  }

  return {
    schedule: () => {
      if (disposed) return
      dirtySince ??= now()
      arm()
    },
    flush: async () => {
      if (disposed) return
      cancelTimer()
      // Before the first `await`, deliberately: this is the only code that runs
      // while the page is being torn down, and an async write started here is an
      // async write that will not finish. See `persist/mirror.ts`.
      mirror()
      if (inFlight) await inFlight
      if (dirtySince === null) return
      await run(true)
    },
    dispose: () => {
      disposed = true
      dirtySince = null
      cancelTimer()
    },
    pending: () => dirtySince !== null || inFlight !== null,
  }
}

type FlushTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>

/**
 * Flush on the two events a mobile browser actually gives an app before it
 * discards the page — `pagehide`, and a `visibilitychange` to hidden.
 * `beforeunload` is deliberately not used: it is suppressed without a user
 * gesture and blocks the back/forward cache. Returns a detach function.
 */
export function attachUnloadFlush(
  target: FlushTarget,
  flush: () => void,
  view?: Document,
): () => void {
  const doc = view ?? (typeof document === 'undefined' ? null : document)
  const onPageHide = () => flush()
  const onVisibilityChange = () => {
    if (doc?.visibilityState === 'hidden') flush()
  }
  target.addEventListener('pagehide', onPageHide)
  doc?.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    target.removeEventListener('pagehide', onPageHide)
    doc?.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
