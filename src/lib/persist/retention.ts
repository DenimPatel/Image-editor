/**
 * How long a session survives, and who decides.
 *
 * The rule this replaces deleted the session row *and* the encoded image the
 * moment either was read more than seven days after its last save, with nothing
 * said and nothing to choose. That is a wall-clock rule applied to a person's
 * photograph: it fires hardest on exactly the user who took a week off, and the
 * one thing they cannot do is report it afterwards, because nothing happened as
 * far as the app is concerned. Storage is not the cost here — an abandoned row
 * is a few kilobytes of JSON plus one encoded image, and browsers evict
 * origin storage on their own schedule when it matters. Age is a proxy for
 * disinterest, and it is a poor one: a holiday is not disinterest.
 *
 * The rule now:
 *
 * 1. **Nothing is deleted on a read.** `loadSession` hands back whatever is on
 *    disk, however old. A reader is not a garbage collector.
 * 2. **Retention is the user's choice**, read from durable storage and honoured
 *    by `loadSession`, `readMirror` and the mirror's size cap.
 * 3. **The default horizon is 180 days**, and it is only a horizon if the user
 *    takes an action that needs one — the app offers a session on its own, and
 *    "Discard" is a button the user presses with the photo on screen.
 * 4. **Forgetting is explicit and reversible-in-intent**: `forgetSession` is a
 *    separate call that discards the photo and the edits together, and is only
 *    ever reached from a user gesture.
 *
 * The horizon therefore still has a job — it is the ceiling the card counts
 * down to, so "this will not last forever" stays honest — but it is not a
 * trigger. Nothing happens to a session because a number was crossed.
 *
 * There is no "abandoned" signal available and inventing one would be worse
 * than not having it: the app has no server, no account, no engagement data, and
 * no way to ask a closed laptop what it meant. The honest reading of a session
 * that has not been touched in a long time is "the user has not been here", and
 * the cheap honest answer to that is to keep the bytes and let the browser's own
 * storage pressure take them.
 */

/** One day, in milliseconds. */
export const RETENTION_DAY_MS = 24 * 60 * 60 * 1000

/**
 * `forever` is the absence of a horizon, not a large number: no read, no mirror
 * and no cap is bounded by it, so a document a user chose to keep is not at the
 * mercy of a wall clock. It is not the default, because a horizon the card can
 * count down to is the one thing that tells a user their work is not permanent.
 */
export type RetentionChoice = 'forever' | `${number}d`

/**
 * The policy a browser with no stored choice gets.
 *
 * Six months: long enough that a week off, a fortnight off and a hospital stay
 * all come back intact, short enough that "kept for six months" is a sentence
 * about this device rather than a promise about the user's life.
 */
export const DEFAULT_RETENTION_DAYS = 180

export const DEFAULT_RETENTION: RetentionChoice = `${DEFAULT_RETENTION_DAYS}d`

/** The shortest horizon a user can choose. Below a week, "retention" is a timer. */
export const MIN_RETENTION_DAYS = 7

/** A horizon long enough that the difference between it and forever is a rounding step. */
export const MAX_RETENTION_DAYS = 3650

/** Where the choice lives. Namespaced apart from the mirror, which is not a preference. */
export const RETENTION_KEY = 'ie-retention'

/** A file:// origin, or a browser with storage blocked, has nowhere to keep a choice. */
function defaultStore(): RetentionStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

/**
 * The three `Storage` calls a choice needs. Narrower than `Storage` on purpose,
 * so the mirror's own storage seam — and a test double standing in for a
 * browser that throws on access — can be handed straight to these functions.
 */
export type RetentionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type RetentionOptions = {
  storage?: RetentionStorage | null
  key?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isChoice(value: unknown): value is RetentionChoice {
  if (value === 'forever') return true
  // `Number()` rather than `parseInt`, so `${7}d` is seven days and `7d` — which
  // `Number` refuses outright — is not silently read as seven.
  const days = typeof value === 'string' ? Number(value.slice(0, -1)) : Number.NaN
  return Number.isInteger(days) && days >= MIN_RETENTION_DAYS && days <= MAX_RETENTION_DAYS
}

/**
 * The stored choice, or the default.
 *
 * A hand-edited, truncated or foreign value is not a choice: it reads as the
 * default rather than as an error, because the only thing a wrong answer here
 * can cost is a horizon that is a bit longer or shorter than the user meant,
 * and refusing to start the app over it would be the worse trade.
 */
export function readRetention(options: RetentionOptions = {}): RetentionChoice {
  const storage = options.storage === undefined ? defaultStore() : options.storage
  if (!storage) return DEFAULT_RETENTION
  const key = options.key ?? RETENTION_KEY
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return DEFAULT_RETENTION
  }
  if (raw === null) return DEFAULT_RETENTION
  const parsed = safeParse(raw)
  // Three accepted shapes, in order of preference: the record this build writes,
  // the bare value a hand-edit or an older key left, and — when the payload is
  // not JSON at all — the payload itself, because `30d` is a choice written by
  // something that did not wrap it.
  const value = parsed === null ? raw : isRecord(parsed) ? parsed.retention : parsed
  return isChoice(value) ? value : DEFAULT_RETENTION
}

/** Persist a choice. `null`/`undefined` is not a choice and never clears the key. */
export function writeRetention(
  choice: RetentionChoice,
  options: RetentionOptions = {},
): RetentionChoice {
  if (!isChoice(choice)) return readRetention(options)
  const storage = options.storage === undefined ? defaultStore() : options.storage
  if (!storage) return choice
  try {
    storage.setItem(options.key ?? RETENTION_KEY, JSON.stringify({ retention: choice }))
  } catch {
    // A refused write leaves the previous choice in force, which is the
    // correct failure: the user's last stated preference beats no preference.
  }
  return choice
}

/** Forget the choice, so the default applies again. The choice is not the data. */
export function clearRetention(options: RetentionOptions = {}): void {
  const storage = options.storage === undefined ? defaultStore() : options.storage
  if (!storage) return
  try {
    storage.removeItem(options.key ?? RETENTION_KEY)
  } catch {
    // Nothing to do: a storage that refuses to remove reads as the default.
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** `forever` is `null`: no horizon is no number, and arithmetic on it is a bug. */
export function retentionMs(choice: RetentionChoice): number | null {
  if (choice === 'forever') return null
  const days = Number(choice.slice(0, -1))
  return Number.isFinite(days) ? days * RETENTION_DAY_MS : null
}

/**
 * How long a session stamped at `updatedAt` has left.
 *
 * `null` for a choice of `forever`. A stamp that is not a number, or one in the
 * future — a clock that moved backwards mid-save writes exactly that — is
 * reported as `0`, which is the reading that says "this is already over"
 * without computing a horizon for a date that cannot exist.
 */
export function msUntilExpiry(
  updatedAt: number,
  choice: RetentionChoice,
  now: number = Date.now(),
): number | null {
  const horizon = retentionMs(choice)
  if (horizon === null) return null
  if (!Number.isFinite(updatedAt)) return 0
  return Math.max(0, updatedAt + horizon - now)
}

/**
 * Whether this moment is the one to offer the user the last warning, if the app
 * is going to give one at all.
 *
 * True once per session, on the first load inside the warning window, and true
 * again only after the session has been left alone long enough to cross the
 * interval — so a user who opens the app twice in an hour is told once, and one
 * who has been away for a week is told when they come back rather than not at
 * all. A day is the interval because a day is how often anyone opens a photo
 * editor.
 */
export function shouldWarn(
  updatedAt: number,
  choice: RetentionChoice,
  now: number,
  options: { lastWarnedAt?: number | null; warnBeforeMs?: number; intervalMs?: number } = {},
): boolean {
  const horizon = retentionMs(choice)
  if (horizon === null) return false
  if (!Number.isFinite(updatedAt)) return false
  const warnBefore = options.warnBeforeMs ?? 3 * RETENTION_DAY_MS
  const interval = options.intervalMs ?? RETENTION_DAY_MS
  const remaining = updatedAt + horizon - now
  if (remaining > warnBefore) return false
  const last = options.lastWarnedAt
  if (typeof last !== 'number' || !Number.isFinite(last)) return true
  return now - last >= interval
}

/** A one-line account of what the current choice means, for a settings row. */
export function describeRetention(choice: RetentionChoice): string {
  if (choice === 'forever') return 'Kept until you discard it'
  const days = Number(choice.slice(0, -1))
  return days === 1
    ? 'Kept for a day after the last save'
    : `Kept for ${days} days after the last save`
}
