import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc, DOC_SCHEMA } from '../../model/defaults'
import { migrateDoc } from '../../model/migrate'
import type { Doc } from '../../model/types'
import { installFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb'
import { writeRetention } from './retention'
import { bytesForSource } from './sourceBytes'
import { SESSION_MAX_AGE_MS, type SourceBytes, type StoredSession } from './session'

type SessionModule = typeof import('./session')
type DocStoreModule = typeof import('../../store/docStore')

let fake: FakeIndexedDb
let session: SessionModule
let docStore: DocStoreModule

async function loadModules(): Promise<void> {
  fake = installFakeIndexedDb()
  vi.resetModules()
  session = await import('./session')
  docStore = await import('../../store/docStore')
}

beforeEach(async () => {
  localStorage.clear()
  await loadModules()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function docWithSource(assetId: string, patch: Partial<Doc> = {}): Doc {
  return createDoc({
    source: { assetId, width: 100, height: 80, name: 'image', mime: 'image/jpeg' },
    ...patch,
  })
}

function bytes(assetId: string, text: string, mime = 'image/jpeg'): SourceBytes {
  return { assetId, blob: new Blob([text], { type: mime }), mime }
}

/** `saveSession` stores the object it is given, so a legacy row can be rewritten in place. */
function mutateStoredRow(mutate: (row: StoredSession) => void): void {
  const row = fake.read<StoredSession>('sessions', 'current')
  if (!row) throw new Error('no stored session')
  mutate(row)
}

describe('saveSession / loadSession', () => {
  it('D2-F12: persists the bytes of the asset the doc points at, so a cut-out survives a reload', async () => {
    const original = docWithSource('asset_original')
    const originalBytes = bytes('asset_original', 'original-file-bytes')
    expect(await session.saveSession(original, originalBytes, 'thumb')).toBe('ok')

    // Background removal hands the document a new asset; the editor re-encodes
    // the matte for that id instead of reusing the imported file.
    const matted = docWithSource('asset_matted', {
      source: { assetId: 'asset_matted', width: 100, height: 80, name: 'image', mime: 'image/png' },
      background: { ...original.background, removed: true },
    })
    const matteBytes = await bytesForSource({
      doc: matted,
      bitmap: {} as ImageBitmap,
      known: originalBytes,
      encode: async () => new Blob(['matte-bytes'], { type: 'image/png' }),
    })
    expect(matteBytes?.assetId).toBe('asset_matted')
    expect(await session.saveSession(matted, matteBytes, 'thumb')).toBe('ok')

    const loaded = await session.loadSession()
    expect(loaded).not.toBeNull()
    expect(loaded?.updatedAt).toBeGreaterThan(0)
    // Identity, not size: the bytes that come back are the matte's, not the
    // original file's.
    expect(loaded?.source).toBe(matteBytes?.blob)
    // The imported file is no longer referenced by anything, so its row is gone.
    expect(fake.keys('assets')).toEqual(['asset_matted'])

    // And the restored document still claims the cut-out, with the right pixels.
    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(true)
    const restored = docStore.useDocStore.getState().present
    expect(restored.background.removed).toBe(true)
    expect(restored.source?.assetId).toBe('asset_matted')
  })

  it('D2-F12: refuses to write bytes that belong to a different asset', async () => {
    const result = await session.saveSession(
      docWithSource('asset_matted'),
      bytes('asset_original', 'original-file-bytes'),
      null,
    )
    expect(result).toBe('mismatch')
    expect(fake.keys('assets')).toEqual([])
    expect(fake.read('sessions', 'current')).toBeUndefined()
  })

  it('D2-F11/F12: a doc with no source stores the session without an asset row', async () => {
    expect(await session.saveSession(createDoc(), null, null)).toBe('ok')
    const loaded = await session.loadSession()
    expect(loaded?.source).toBeNull()
  })

  it('D2-F10: a row from an older build is returned untrusted and migrated on the way in', async () => {
    const legacy = {
      ...createDoc(),
      schema: 2,
      source: {
        assetId: 'asset_original',
        width: 100,
        height: 80,
        name: 'image',
        mime: 'image/jpeg',
      },
      geometry: { ...createDoc().geometry, straighten: 999 },
    } as unknown as Doc
    expect(
      await session.saveSession(legacy, bytes('asset_original', 'original-file-bytes'), null),
    ).toBe('ok')
    mutateStoredRow((row) => {
      row.doc = legacy
    })

    const loaded = await session.loadSession()
    expect((loaded?.doc as { schema: number }).schema).toBe(2)
    expect(loaded?.source?.size).toBe('original-file-bytes'.length)

    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(true)
    const present = docStore.useDocStore.getState().present
    expect(present.schema).toBe(DOC_SCHEMA)
    expect(present.geometry.straighten).toBe(45)
    expect(present.source?.assetId).toBe('asset_original')
  })

  it('D2-F10: a row that is not a document at all is rejected by the migration chain', async () => {
    const doc = docWithSource('asset_original')
    expect(await session.saveSession(doc, bytes('asset_original', 'bytes'), null)).toBe('ok')
    mutateStoredRow((row) => {
      row.doc = { nothing: true }
    })
    const loaded = await session.loadSession()
    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(false)
  })

  it('D2-F13: a full disk resolves to a quota result instead of silence', async () => {
    fake.failNextWrite('sessions', 'QuotaExceededError')
    expect(await session.saveSession(docWithSource('a'), bytes('a', 'x'), null)).toBe('quota')
  })

  it('D2-F13: a failed blob write does not leave a half-written asset row', async () => {
    const doc = docWithSource('a')
    fake.failNextWrite('assets', 'QuotaExceededError')
    expect(await session.saveSession(doc, bytes('a', 'x'), null)).toBe('quota')
    expect(fake.keys('assets')).toEqual([])
  })

  it('D2-F13: blocked storage is reported as unavailable and retried later', async () => {
    fake.failNextOpen('storage disabled')
    expect(await session.saveSession(docWithSource('a'), bytes('a', 'x'), null)).toBe('unavailable')
    expect(await session.loadSession()).toBeNull()
    // The rejected open is not cached: the next attempt tries storage again.
    expect(await session.saveSession(docWithSource('a'), bytes('a', 'x'), null)).toBe('ok')
  })

  it('D2-F13: loading a second image drops the first image’s bytes', async () => {
    expect(
      await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'first'), null),
    ).toBe('ok')
    expect(fake.keys('assets')).toEqual(['asset_a'])
    expect(
      await session.saveSession(docWithSource('asset_b'), bytes('asset_b', 'second'), null),
    ).toBe('ok')
    expect(fake.keys('assets')).toEqual(['asset_b'])
  })

  it('D2-F13: an expired session row and its bytes are kept, because a read is not a delete', async () => {
    // This test used to read "an expired session row and its bytes are deleted
    // when it is read" and assert that both rows were gone. That was the defect:
    // eight days away with the laptop shut, and the photo and every edit
    // destroyed by a wall clock with no prompt, no warning and nothing to report.
    // The row is now offered whatever its age, and the horizon is something the
    // card counts down to rather than a trigger.
    const doc = docWithSource('asset_a')
    expect(await session.saveSession(doc, bytes('asset_a', 'x'), null)).toBe('ok')
    mutateStoredRow((row) => {
      row.updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000
    })

    const loaded = await session.loadSession()
    expect(loaded).not.toBeNull()
    expect(loaded?.source).toBeInstanceOf(Blob)
    expect(loaded?.source?.size).toBe(1)
    // Still on disk, and still the same bytes: the row was not deleted, and the
    // image it points at was not deleted with it.
    expect(fake.read<StoredSession>('sessions', 'current')).toBeDefined()
    expect(fake.keys('assets')).toEqual(['asset_a'])
  })

  it('a session eight days old is the case the horizon is measured from', async () => {
    // The old default was seven days, so eight days is the shortest absence that
    // used to destroy the work. It is pinned as its own test because it is the
    // case from the bug report, not a boundary nobody reported.
    expect(SESSION_MAX_AGE_MS).toBe(180 * 24 * 60 * 60 * 1000)
    expect(session.SESSION_MAX_AGE_MS).toBeGreaterThan(8 * 24 * 60 * 60 * 1000)
  })

  it('a session is offered at any age the clock can be wound back to', async () => {
    expect(await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)).toBe(
      'ok',
    )
    mutateStoredRow((row) => {
      row.updatedAt = Date.now() - 3_650 * 24 * 60 * 60 * 1000
    })
    expect(await session.loadSession()).not.toBeNull()
    expect(fake.keys('assets')).toEqual(['asset_a'])
  })

  it('warns once the session is inside the last three days, and not before', async () => {
    expect(await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)).toBe(
      'ok',
    )
    expect((await session.loadSession())?.warnRetention).toBe(false)

    const now = Date.now()
    mutateStoredRow((row) => {
      row.updatedAt = now - (SESSION_MAX_AGE_MS - 2 * 24 * 60 * 60 * 1000)
    })
    expect((await session.loadSession({ now: () => now }))?.warnRetention).toBe(true)

    // The notice is shown once, not on every open. Acknowledging it, then reading
    // again inside the interval, is quiet.
    //
    // The clock is passed rather than left to `Date.now`, because the interval is
    // measured between the stamp written here and the one `loadSession` compares
    // it against. With the stamp taken from the real clock, `now` above is already
    // in the past by however long this test took to get here, and the boundary
    // below lands on the wrong side of `>=` whenever that gap is a single
    // millisecond — which is most runs, and none of them reproducibly. Both reads
    // now come from one clock, so the boundary is a fact rather than a race.
    session.acknowledgeRetentionWarning({ now: () => now })
    expect((await session.loadSession({ now: () => now }))?.warnRetention).toBe(false)

    // One millisecond short of the interval is still inside it.
    expect(
      (await session.loadSession({ now: () => now + 24 * 60 * 60 * 1000 - 1 }))?.warnRetention,
    ).toBe(false)

    // And it speaks again once the user has been away long enough to be worth
    // repeating it to — at the interval exactly, not at some margin past it.
    expect(
      (await session.loadSession({ now: () => now + 24 * 60 * 60 * 1000 }))?.warnRetention,
    ).toBe(true)
  })

  it('a choice of forever is never warned about, because there is no horizon', async () => {
    writeRetention('forever')
    expect(await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)).toBe(
      'ok',
    )
    const now = Date.now()
    mutateStoredRow((row) => {
      row.updatedAt = now - (SESSION_MAX_AGE_MS - 1000)
    })
    expect((await session.loadSession({ now: () => now }))?.warnRetention).toBe(false)
  })

  it('forgetSession is the only delete, and it takes the bytes with it', async () => {
    expect(await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)).toBe(
      'ok',
    )
    expect(await session.loadSession()).not.toBeNull()
    await session.forgetSession()
    expect(fake.read('sessions', 'current')).toBeUndefined()
    expect(fake.keys('assets')).toEqual([])
  })

  it('a save never advances the session to a document whose image is not stored', async () => {
    // The race this closes: a tool swaps the document onto a new asset id, the
    // re-encode of the new bytes is still in flight, and the autosave for the
    // document that no longer mentions the old image lands in the gap. The old
    // writer replaced the row *and* deleted the old image's bytes, so the photo
    // was destroyed and every later load reported "that image is no longer
    // stored". A half-saved session is worse than an unsaved one: it looks saved.
    expect(
      await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'first'), null),
    ).toBe('ok')
    const cutout = docWithSource('asset_matted', {
      source: {
        assetId: 'asset_matted',
        width: 100,
        height: 80,
        name: 'image',
        mime: 'image/png',
      },
    })

    // The save in the gap: a new document, no bytes for it yet.
    expect(await session.saveSession(cutout, null, null)).toBe('mismatch')
    let loaded = await session.loadSession()
    expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_a')
    expect(loaded?.source?.size).toBe('first'.length)
    expect(fake.keys('assets')).toEqual(['asset_a'])

    // The replacement lands, and the old image goes in the same transaction.
    expect(await session.saveSession(cutout, bytes('asset_matted', 'matte'), null)).toBe('ok')
    loaded = await session.loadSession()
    expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_matted')
    expect(loaded?.source?.size).toBe('matte'.length)
    expect(fake.keys('assets')).toEqual(['asset_matted'])
  })

  it('a document with no source still saves, because it is not a photo', async () => {
    expect(await session.saveSession(createDoc(), null, null)).toBe('ok')
    expect((await session.loadSession())?.source).toBeNull()
  })

  it('a quota-exceeded write leaves the previous session exactly as it was', async () => {
    // Asserted on the rows, which the fake only gets right because a readwrite
    // transaction rolls back: a request that ran before its sibling threw must
    // not stay applied, or this would be asserting the fixture rather than the
    // store. Both failure points are tried, because the document put and the
    // image put share one transaction and either can be the one that throws.
    expect(
      await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'first'), null),
    ).toBe('ok')
    for (const store of ['sessions', 'assets']) {
      expect(
        await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'first'), null),
      ).toBe('ok')
      fake.failNextWrite(store, 'QuotaExceededError')
      expect(
        await session.saveSession(docWithSource('asset_b'), bytes('asset_b', 'second'), null),
      ).toBe('quota')

      const loaded = await session.loadSession()
      expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_a')
      expect(loaded?.source?.size).toBe('first'.length)
      expect(fake.keys('assets')).toEqual(['asset_a'])
    }
  })

  it('returns null when nothing has been stored', async () => {
    expect(await session.loadSession()).toBeNull()
  })

  it('clearSession drops the session and every asset row', async () => {
    await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)
    await session.clearSession()
    expect(await session.loadSession()).toBeNull()
    expect(fake.keys('assets')).toEqual([])
  })
})

describe('readSourceAssetId', () => {
  it('reads the id from a current document and refuses to guess at anything else', () => {
    expect(session.readSourceAssetId(docWithSource('asset_a'))).toBe('asset_a')
    expect(session.readSourceAssetId({ source: { assetId: 7 } })).toBeNull()
    expect(session.readSourceAssetId({ source: null })).toBeNull()
    expect(session.readSourceAssetId({ rotation: 90 })).toBeNull()
    expect(session.readSourceAssetId(null)).toBeNull()
  })

  it('D1-F04: finds the bytes behind a schema 1 row that wrote a bare id', () => {
    // `migrateDoc` can remap this shape; the byte lookup runs first, so it has
    // to agree or an old session is reported as "image no longer stored".
    expect(session.readSourceAssetId({ schema: 1, source: 'asset_legacy' })).toBe('asset_legacy')
  })

  it('loads the source bytes for a legacy row instead of dropping them', async () => {
    const migrated = migrateDoc({
      schema: 1,
      source: 'asset_legacy',
      crop: { x: 100, y: 100, width: 500, height: 500 },
    })
    expect(migrated?.source?.assetId).toBe('asset_legacy')
    // The asset row is under the id; only the session row is hand-edited back
    // to the schema 1 shape, and the bytes still have to be found.
    await session.saveSession(docWithSource('asset_legacy'), bytes('asset_legacy', 'x'), null)
    fake.write('sessions', 'current', {
      id: 'current',
      doc: { schema: 1, source: 'asset_legacy' },
      updatedAt: Date.now(),
      thumb: null,
    } satisfies StoredSession)

    const loaded = await session.loadSession()
    expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_legacy')
    expect(loaded?.source).not.toBeNull()
  })
})

describe('storageEstimate', () => {
  it('reports usage when the browser can, and null when it cannot', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 10, quota: 100 }) } })
    expect(await session.storageEstimate()).toEqual({ usage: 10, quota: 100 })
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } })
    expect(await session.storageEstimate()).toEqual({ usage: 0, quota: 0 })
    vi.unstubAllGlobals()
  })
})

describe('createThumbnail', () => {
  it('returns null when no 2d context is available instead of throwing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const bitmap = { width: 10, height: 10 } as ImageBitmap
    expect(session.createThumbnail(bitmap)).toBeNull()
    vi.restoreAllMocks()
  })
})
