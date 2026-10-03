import { openDB, type IDBPDatabase } from 'idb'
import { activeAssetIds } from '../../model/selectors'
import type { AssetId, Doc } from '../../model/types'
import {
  readRetention,
  shouldWarn,
  type RetentionOptions,
  type RetentionStorage,
} from './retention'

/**
 * IndexedDB session persistence. Only the JSON `Doc` and the encoded bytes of
 * the *current* source are stored — never decoded pixels — so a session written
 * by an old build still loads after a deploy. Every call is defensive because
 * Safari private mode throws on storage access, but no failure is silent: each
 * one resolves to a `SaveResult` the editor can report.
 *
 * Nothing here expires anything. An earlier version deleted the session row and
 * the image bytes the first time a row older than a week was read, with no
 * prompt, no warning and no way to get the photo back; `persist/retention.ts`
 * holds the reasoning and the replacement, and the only deletion in this file is
 * `forgetSession`, which is called from a button the user pressed.
 */

export const SESSION_DB_NAME = 'image-editor'
const DB_VERSION = 1
const SESSION_ID = 'current'

/**
 * The horizon a session older than this is no longer offered under, and the
 * only way one is ever dropped. It is exported so the card can count down to it
 * without a second copy of the number, and so a test can hold the copy and this
 * to the same value.
 */
export const SESSION_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

/** Where the last retention warning was acknowledged, so a warning is not repeated. */
const RETENTION_ACK_KEY = 'ie-retention-ack'

export type StoredSession = {
  id: string
  doc: unknown
  updatedAt: number
  thumb: string | null
}

export type StoredAsset = {
  id: AssetId
  blob: Blob
  mime: string
}

/**
 * The encoded bytes that produced one asset id. The id is part of the payload
 * because the pairing is the whole contract: storing the original file's bytes
 * under a replacement asset's id (what a background cut-out produces) silently
 * reverts the cut-out on reload.
 */
export type SourceBytes = {
  assetId: AssetId
  blob: Blob
  mime: string
}

export type SaveResult = 'ok' | 'mismatch' | 'quota' | 'unavailable' | 'error'

/**
 * A stored session. `doc` is `unknown` on purpose — a row can have been written
 * by any older build, so it has to go through `migrateDoc` (via the store's
 * `loadUnknown`) before it is a `Doc` again. `source` is null when the asset
 * row is missing or the stored doc points at no asset.
 */
export type LoadedSession = {
  doc: unknown
  updatedAt: number
  thumb: string | null
  source: Blob | null
  /**
   * Whether this load is the one to say, *before* anything else, that the
   * session is close enough to its horizon to be worth a warning. False for a
   * choice of `forever`, and false for a session that has already been warned
   * about inside the interval. A caller that renders this is the retention
   * notice; the alternative is deleting the user's photo and telling them after.
   */
  warnRetention: boolean
}

type Schema = {
  sessions: StoredSession
  assets: StoredAsset
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null
function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(SESSION_DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('sessions'))
        database.createObjectStore('sessions', { keyPath: 'id' })
      if (!database.objectStoreNames.contains('assets'))
        database.createObjectStore('assets', { keyPath: 'id' })
    },
  }).catch((error: unknown) => {
    // A failed open must not be cached: Safari private mode rejects once, and
    // the user can grant storage without a reload.
    dbPromise = null
    throw error
  })
  return dbPromise
}

function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

function classify(error: unknown): SaveResult {
  const name = errorName(error)
  if (name === 'QuotaExceededError') return 'quota'
  if (name === 'SecurityError' || name === 'InvalidStateError') return 'unavailable'
  return 'error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The asset the stored doc points at, without trusting the row's shape.
 *
 * Schema 1 wrote `source` as a bare asset-id string, and `migrateDoc` knows how
 * to remap that (`remapV1Source`). The byte lookup happens *before* migration,
 * on the raw row, so refusing the string form made every genuinely old session
 * report "that image is no longer stored" and threw away the crop and every
 * edit the migration would otherwise have recovered.
 */
export function readSourceAssetId(doc: unknown): AssetId | null {
  if (!isRecord(doc)) return null
  if (typeof doc.source === 'string') return doc.source
  if (!isRecord(doc.source)) return null
  return typeof doc.source.assetId === 'string' ? doc.source.assetId : null
}

/** Asset rows no longer referenced by the document, so loading a new image drops the last one's bytes. */
async function staleAssetIds(
  database: IDBPDatabase<Schema>,
  keep: ReadonlySet<AssetId>,
): Promise<AssetId[]> {
  const keys = await database.getAllKeys('assets')
  return keys.map(String).filter((key) => !keep.has(key))
}

/**
 * A save advances the session to `doc` and stores the bytes that document needs,
 * or it does not happen at all.
 *
 * The rule exists because of one specific loss. A tool that replaces the source —
 * background removal is the only one today — swaps the document onto a new asset
 * id immediately, and the re-encode of the new image is asynchronous. The
 * autosave that lands in the gap is handed a document pointing at an asset that
 * has no bytes anywhere, and the old writer accepted that: it replaced the row
 * *and* deleted the image the row had been holding, so the user's photo was gone
 * and every later load answered "that image is no longer stored". A half-saved
 * session is worse than an unsaved one, because it looks saved.
 *
 * So the row is only advanced to a document whose source bytes are written in the
 * same transaction. Bytes for a different asset, or no bytes at all for a
 * document that has a source, both resolve to `'mismatch'` and leave the previous
 * session — document and image together — exactly as it was.
 */
export async function saveSession(
  doc: Doc,
  source: SourceBytes | null,
  thumb: string | null,
): Promise<SaveResult> {
  if (source && source.assetId !== doc.source?.assetId) return 'mismatch'
  if (doc.source && !source) return 'mismatch'
  try {
    const database = await db()
    const stale = await staleAssetIds(database, new Set(activeAssetIds(doc)))
    const transaction = database.transaction(['sessions', 'assets'], 'readwrite')
    const writes: Promise<unknown>[] = [
      transaction
        .objectStore('sessions')
        .put({ id: SESSION_ID, doc, updatedAt: Date.now(), thumb }),
    ]
    if (source) {
      writes.push(
        transaction
          .objectStore('assets')
          .put({ id: source.assetId, blob: source.blob, mime: source.mime }),
      )
    }
    for (const id of stale) writes.push(transaction.objectStore('assets').delete(id))
    // Every request promise is awaited, so a rejected write is never an
    // unhandled rejection on top of the `done` the transaction already reports.
    await Promise.all([...writes, transaction.done])
    return 'ok'
  } catch (error) {
    return classify(error)
  }
}

/**
 * Where the "you have been told" stamp lives. It is a preference about storage,
 * not a document, so it sits beside the retention choice and is written through
 * the same guarded accessor — a browser that refuses one refuses both.
 */
function retentionAckStore(options: RetentionOptions = {}): RetentionStorage | null {
  if (options.storage !== undefined) return options.storage
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/**
 * How long ago the user was last shown the retention notice, if they have seen
 * one. A broken value reads as "never told", which repeats a warning rather than
 * swallowing one.
 */
function readRetentionAck(options: RetentionOptions = {}): number | null {
  const storage = retentionAckStore(options)
  if (!storage) return null
  try {
    const raw = storage.getItem(options.key ?? RETENTION_ACK_KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export type LoadOptions = RetentionOptions & { now?: () => number }

/**
 * Record that the notice was shown, so it is not shown again inside its interval.
 *
 * `now` is the same seam `loadSession` reads, and it has to be. The interval is
 * an interval between two stamps — the one written here and the one
 * `shouldWarn` compares against — and if those two come from different clocks the
 * interval cannot be reasoned about at all. In the app both are `Date.now`, so
 * this changes nothing there; what it removes is the one-millisecond race a
 * caller that injects a clock into `loadSession` would otherwise be playing
 * against a hardcoded `Date.now` in here, which is a coin flip that only ever
 * resolves one way when the caller sits exactly on the interval boundary.
 */
export function acknowledgeRetentionWarning(options: LoadOptions = {}): void {
  const storage = retentionAckStore(options)
  if (!storage) return
  try {
    const now = options.now ?? Date.now
    storage.setItem(options.key ?? RETENTION_ACK_KEY, JSON.stringify(now()))
  } catch {
    // Worst case the notice is offered twice. A refused write must never be the
    // reason the user is not told.
  }
}

export async function loadSession(options: LoadOptions = {}): Promise<LoadedSession | null> {
  const now = options.now ?? Date.now
  try {
    const database = await db()
    const session = await database.get('sessions', SESSION_ID)
    if (!session) return null
    const assetId = readSourceAssetId(session.doc)
    // A row is offered whatever its age. It is the user's photograph; the
    // horizon is something the card counts down to, not a trigger that destroys
    // it, and nothing but `forgetSession` may delete it.
    const asset = assetId ? await database.get('assets', assetId) : undefined
    return {
      doc: session.doc,
      updatedAt: session.updatedAt,
      thumb: session.thumb,
      source: asset?.blob ?? null,
      warnRetention: shouldWarn(session.updatedAt, readRetention(options), now(), {
        lastWarnedAt: readRetentionAck(),
      }),
    }
  } catch {
    return null
  }
}

/**
 * The one call in this file that deletes a session, and the only one a user can
 * reach. `clearSession` was two: it took the row *and* every asset row, so the
 * asset rows a pending save had not replaced yet went with it.
 */
export async function forgetSession(): Promise<void> {
  await clearSession()
}

/**
 * Drop the session. Every asset row goes, because every asset row exists to
 * serve the session — there is exactly one session per origin, and an asset
 * belonging to no document is a few megabytes nobody asked to keep.
 *
 * Reached from the resume card's "Discard" and from the error screen's "start
 * over", both of which show the user what is being thrown away first.
 */
export async function clearSession(): Promise<void> {
  try {
    const database = await db()
    await database.delete('sessions', SESSION_ID)
    const keys = await database.getAllKeys('assets')
    await Promise.all(keys.map((key) => database.delete('assets', key)))
  } catch {
    // ignore
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

/** Create a small thumbnail data URL from a decoded source. */
export function createThumbnail(source: ImageBitmap, maxEdge = 160): string | null {
  try {
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.width * scale))
    canvas.height = Math.max(1, Math.round(source.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return null
  }
}
