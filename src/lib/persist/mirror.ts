import { readRetention, retentionMs, type RetentionChoice } from './retention'
import { readSourceAssetId, type LoadedSession } from './session'

/**
 * A synchronous mirror of the last saved document, in `localStorage`.
 *
 * The autosave scheduler is not enough on its own. `pagehide` fires before the
 * page is torn down and `flush()` does start an IndexedDB write there, but a
 * write is a *transaction*: it needs the event loop to keep turning so the
 * request can be dispatched, the row can be serialised and the transaction can
 * commit. A hard reload inside the debounce window gives it none of that, and
 * the edit is gone. That is a structural limit of async storage, not a bug in
 * the scheduler.
 *
 * `localStorage.setItem` has the opposite property: it is synchronous, so it
 * completes inside the handler no matter what happens to the page afterwards.
 * Writing the `Doc` there costs a few kilobytes of JSON and closes the window.
 *
 * What it deliberately is *not*:
 *
 * - **Not a second source of truth.** It carries no pixels. A document cannot be
 *   rendered from it, so the mirror can only ever supply the *edits* for a
 *   session whose bytes IndexedDB already has; the resolver below refuses to
 *   adopt a mirror that names an asset nobody stored.
 * - **Not unbounded.** `MIRROR_MAX_BYTES` caps the serialised payload, so a
 *   pathological document cannot eat the origin's 5 MB `localStorage` budget —
 *   the budget the presets live in. A refused write **leaves the previous entry
 *   in place**: it used to delete it, on the reasoning that a stale snapshot
 *   reads as current, and so the attempt to save a newer document destroyed the
 *   last good one. That is the wrong order — failing a save must not cost you
 *   the last save that worked. A stale entry cannot mislead `readMirror`'s
 *   callers anyway, because it carries its own `updatedAt` and
 *   `resolveResumableSession` only adopts a mirror strictly newer than the
 *   stored row.
 * - **Not unversioned.** Every entry carries `MIRROR_SCHEMA`. A build that
 *   changes the shape bumps it, and an entry stamped with anything else is
 *   dropped unread.
 * - **Not silently trusted.** Every read is defensive: unparseable JSON, a
 *   missing field, a wrong stamp, an entry past the retention horizon and a
 *   storage that throws (Safari private mode) all resolve to "no mirror", and
 *   the bad entry is removed so the next load is not blocked by it.
 *
 * The horizon is the *user's*, not a constant: `readRetention` is asked for the
 * choice the same way `session.ts` asks, so a mirror can never disagree with the
 * row it is shadowing about what "recent" means. `forever` lifts the age limit
 * and the byte cap, because a user who has said they want the document kept has
 * answered the question the cap was asking.
 */

export const MIRROR_KEY = 'image-editor:doc-mirror'

/** Bumped whenever the stored shape changes. An entry with any other stamp is discarded. */
export const MIRROR_SCHEMA = 1

/**
 * Serialised-byte ceiling for one mirrored document. A `Doc` holds no pixels —
 * a 40-megapixel source is one `AssetId` — so an ordinary document is a few
 * kilobytes and this is roughly twenty times the largest realistic one. It
 * exists to bound the damage a single pathological document (a layer list grown
 * by a runaway script, a hand-edited entry) can do to a 5 MB origin budget.
 *
 * Nothing is lost by hitting it: the previous entry survives, and the
 * IndexedDB row this is a safety net for is untouched either way.
 */
export const MIRROR_MAX_BYTES = 64 * 1024

/**
 * The ceiling for a document the user has asked to keep indefinitely. Four
 * times the default: still a rounding error against a 5 MB origin, and large
 * enough that a real project with a long layer list stops being refused by a
 * rule that only existed to catch a runaway script.
 */
export const MIRROR_FOREVER_MAX_BYTES = 256 * 1024

/**
 * The horizon used when no choice is stored: the same number the session row
 * uses, so the two can never disagree about "recent" — which is what stops a
 * mirror offering edits the durable row has already forgotten. A stored choice of
 * `forever` replaces it with no limit at all, not with a large number.
 */
export function mirrorMaxAgeMs(choice: RetentionChoice): number {
  return retentionMs(choice) ?? Number.POSITIVE_INFINITY
}

export type MirrorEntry = {
  schema: number
  updatedAt: number
  doc: unknown
}

export type MirrorResult = 'ok' | 'too-large' | 'unavailable' | 'error'

export type MirrorStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type MirrorOptions = {
  storage?: MirrorStorage | null
  key?: string
  now?: () => number
  maxBytes?: number
  maxAgeMs?: number
  /** The user's retention choice. Read from `storage` when not given. */
  retention?: RetentionChoice
}

function defaultStorage(): MirrorStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Accessing `localStorage` itself throws when storage is blocked.
    return null
  }
}

function resolve(options: MirrorOptions): {
  storage: MirrorStorage | null
  key: string
  now: () => number
  maxBytes: number
  maxAgeMs: number
} {
  const storage = options.storage === undefined ? defaultStorage() : options.storage
  const retention = options.retention ?? readRetention({ storage })
  return {
    storage,
    key: options.key ?? MIRROR_KEY,
    now: options.now ?? (() => Date.now()),
    maxBytes:
      options.maxBytes ?? (retention === 'forever' ? MIRROR_FOREVER_MAX_BYTES : MIRROR_MAX_BYTES),
    maxAgeMs: options.maxAgeMs ?? mirrorMaxAgeMs(retention),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Store `doc` as a mirror entry. Synchronous by construction: no `await`
 * anywhere in here, so a caller inside a `pagehide` handler gets the write done
 * before the handler returns.
 */
export function writeMirror(doc: unknown, options: MirrorOptions = {}): MirrorResult {
  const { storage, key, now, maxBytes } = resolve(options)
  if (!storage) return 'unavailable'
  let payload: string
  try {
    payload = JSON.stringify({ schema: MIRROR_SCHEMA, updatedAt: now(), doc })
  } catch {
    // A `Doc` is JSON-serializable by contract; a cycle means the contract is
    // already broken, and there is nothing useful to store.
    return 'error'
  }
  if (payload.length > maxBytes) {
    // The previous entry is left exactly where it is. It used to be deleted
    // here, which meant a document that grew past the cap destroyed the last
    // snapshot that *had* fit — the one document the user was relying on to be
    // rescued by. `readMirror` stamps every entry with its own `updatedAt` and
    // `resolveResumableSession` only adopts one strictly newer than the stored
    // row, so a surviving older entry is inert rather than misleading.
    return 'too-large'
  }
  try {
    storage.setItem(key, payload)
    return 'ok'
  } catch {
    // A refused `setItem` leaves the previous entry in place too: the write is
    // rejected before anything is removed, so a full origin costs the newest
    // snapshot and not the last good one.
    return 'unavailable'
  }
}

/**
 * The mirrored document, or null.
 *
 * Every rejection path here removes the entry, and that is the asymmetry worth
 * stating: a read can tell the entry is unusable — unparseable, wrong schema,
 * past the horizon — so nothing is lost by dropping it. A *write* refusal is a
 * different thing, and `writeMirror` never removes anything for that.
 */
export function readMirror(options: MirrorOptions = {}): MirrorEntry | null {
  const { storage, key, now, maxAgeMs } = resolve(options)
  if (!storage) return null
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null
  const discard = () => {
    safeRemove(storage, key)
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return discard()
  }
  if (!isRecord(parsed)) return discard()
  if (parsed.schema !== MIRROR_SCHEMA) return discard()
  const updatedAt = parsed.updatedAt
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return discard()
  if (!isRecord(parsed.doc)) return discard()
  if (now() - updatedAt > maxAgeMs) return discard()
  return { schema: parsed.schema, updatedAt, doc: parsed.doc }
}

export function clearMirror(options: MirrorOptions = {}): void {
  const { storage, key } = resolve(options)
  if (!storage) return
  safeRemove(storage, key)
}

function safeRemove(storage: MirrorStorage, key: string): void {
  try {
    storage.removeItem(key)
  } catch {
    // Nothing to do: a storage that refuses to remove will be ignored on read.
  }
}

/**
 * The session to offer the user on the import screen.
 *
 * The mirror wins only when all three hold: it is *newer* than the stored row,
 * the stored row exists, and both name the *same* source asset. That last
 * condition is the whole point of the mirror — it carries edits, not pixels, so
 * a mirror naming an asset IndexedDB has no bytes for is a document that would
 * resume into a blank canvas. Preferring the stored row there costs nothing:
 * it is at worst the previous save, which is what the user would have got
 * anyway.
 *
 * With no stored row there is no byte source at all, so there is nothing to
 * resume. The mirror is deliberately *not* returned in that case and *not*
 * cleared: a document alone cannot be shown, and dropping the entry would throw
 * away the only record of the edit. The next successful save overwrites it.
 */
export function resolveResumableSession(
  stored: LoadedSession | null,
  mirrored: MirrorEntry | null,
): LoadedSession | null {
  if (!mirrored) return stored
  if (!stored) return null
  if (mirrored.updatedAt <= stored.updatedAt) return stored
  const storedAsset = readSourceAssetId(stored.doc)
  if (mirrored.doc && readSourceAssetId(mirrored.doc) !== storedAsset) return stored
  return {
    ...stored,
    doc: mirrored.doc,
    updatedAt: mirrored.updatedAt,
  }
}
