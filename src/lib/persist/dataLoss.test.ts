import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import { migrateDoc } from '../../model/migrate'
import { DOC_SCHEMA, type Doc } from '../../model/types'
import { installFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb'
import { MIRROR_KEY, readMirror, writeMirror } from './mirror'
import { applyPreset, listPresets, readPreset, savePreset } from './recipes'
import { readRetention, writeRetention, RETENTION_KEY } from './retention'
import type { SourceBytes, StoredSession } from './session'

/**
 * Every path by which this app can lose a user's photograph or their presets,
 * one test each, each asserting that the data *survives*.
 *
 * The list came from reading the two directories that own durable state —
 * `src/lib/persist/` and `src/store/` — rather than from the feature list, and
 * each entry says what the answer is. The one that used to be a loss is the
 * age rule, which is why it is here too: it is the only one that was silent,
 * and silence is the property that made it a data-loss path rather than a
 * cleanup job.
 */

type SessionModule = typeof import('./session')

let fake: FakeIndexedDb
let session: SessionModule
let docStore: typeof import('../../store/docStore')

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
  // The stub comes off first: a blocked `localStorage` refuses `clear()` too, and
  // the next test needs a real one.
  vi.unstubAllGlobals()
  localStorage.clear()
  vi.restoreAllMocks()
})

function docWithSource(assetId: string, exposure = 0): Doc {
  return createDoc({
    source: { assetId, width: 4032, height: 6048, name: 'a.jpg', mime: 'image/jpeg' },
    adjust: { ...createDoc().adjust, exposure },
  })
}

function bytes(assetId: string, text: string): SourceBytes {
  return { assetId, blob: new Blob([text], { type: 'image/jpeg' }), mime: 'image/jpeg' }
}

/** A stored row the way a save leaves it, so a test can age it or reshape it. */
function mutateStoredRow(mutate: (row: StoredSession) => void): void {
  const row = fake.read<StoredSession>('sessions', 'current')
  if (!row) throw new Error('no stored session')
  mutate(row)
}

async function storeWork(assetId = 'asset_a', exposure = 1.4): Promise<void> {
  expect(
    await session.saveSession(docWithSource(assetId, exposure), bytes(assetId, 'pixels'), null),
  ).toBe('ok')
}

/** A `localStorage` that refuses every call, the way a locked-down profile does. */
function blockedStorage(): Storage {
  const deny = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  return {
    get length(): number {
      return deny()
    },
    clear: deny,
    getItem: deny,
    key: deny,
    removeItem: deny,
    setItem: deny,
  } as Storage
}

describe('a document nothing can read', () => {
  it('is refused by the migration chain and left on disk', async () => {
    // The claim several agents have made about this chain, tested: a row that is
    // not a document is *rejected*, not *destroyed*. `loadSession` never deletes
    // a row it cannot read, so a hand-edited or truncated row is still there for
    // a build that can read it.
    await storeWork()
    mutateStoredRow((row) => {
      row.doc = { nothing: true }
    })

    const loaded = await session.loadSession()
    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(false)
    expect(fake.read<StoredSession>('sessions', 'current')).toBeDefined()
    expect(fake.keys('assets')).toEqual(['asset_a'])
    // A second read is the same answer, so a failed load is not self-erasing.
    expect((await session.loadSession())?.doc).toEqual({ nothing: true })
  })

  it('leaves the image alone even when the row that names it is gone', async () => {
    // The row can be lost by a browser eviction; the image row is separate, and
    // nothing in the read path reaches for it once there is no row to resolve.
    await storeWork()
    fake.write('sessions', 'current', undefined)
    expect(await session.loadSession()).toBeNull()
    expect(fake.keys('assets')).toEqual(['asset_a'])
  })
})

describe('a document written by a newer build', () => {
  it('is refused by this build and still there afterwards', async () => {
    // `migrateDoc` returns null for a schema it does not know, which is the safe
    // direction: refusing is inconvenient, overwriting is unrecoverable. The
    // test is the sequence a deploy actually runs — the older build reads, does
    // not understand, and writes nothing back.
    const newer = {
      ...createDoc(),
      schema: DOC_SCHEMA + 1,
      // A field this build has never heard of, holding work.
      futureFeature: { enabled: true, strength: 0.6 },
    } as unknown as Doc
    await storeWork('asset_a', 1.4)
    mutateStoredRow((row) => {
      row.doc = newer
    })

    const loaded = await session.loadSession()
    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(false)

    // Nothing was written back, so the row is byte-for-byte what the newer build
    // left, edits and unknown fields included.
    const after = fake.read<StoredSession>('sessions', 'current')
    expect(after?.doc).toEqual(newer)
    expect(after?.updatedAt).toBeGreaterThan(0)
    expect(fake.keys('assets')).toEqual(['asset_a'])

    // And when the build that wrote it is serving again, it is all still there.
    expect((after?.doc as { futureFeature: { strength: number } }).futureFeature.strength).toBe(0.6)
  })

  it('a row from a much older build keeps its edits through the chain', async () => {
    // The other direction, because the claim is about the whole chain: schema 1,
    // the 0..1000 crop grid, a bare asset id and the old slider names.
    const legacy = {
      schema: 1,
      source: 'asset_legacy',
      crop: { x: 100, y: 100, width: 500, height: 500 },
      adjust: { brightness: 130, temperature: 20 },
      format: 'png',
    }
    expect(migrateDoc(legacy)?.geometry.crop).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
    expect(migrateDoc(legacy)?.adjust.brightness).toBe(30)
    expect(migrateDoc(legacy)?.adjust.warmth).toBe(20)
    // A schema-1 row carried no output format at all, so there is nothing here to
    // recover: the default is the honest answer, not a guess.
    expect(migrateDoc(legacy)?.output.format).toBe('jpeg')

    // And through the real store, from a real row.
    await storeWork('asset_legacy', 0)
    mutateStoredRow((row) => {
      row.doc = legacy
    })
    const loaded = await session.loadSession()
    expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_legacy')
    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(true)
    const present = docStore.useDocStore.getState().present
    expect(present.adjust.brightness).toBe(30)
    expect(present.geometry.crop.width).toBe(0.5)
  })

  it('the flat EditorState that predates every schema still loads', () => {
    const flat = { brightness: 90, contrast: 110, rotation: 90, outWidth: 1600, source: 'asset_x' }
    const migrated = migrateDoc(flat)
    expect(migrated?.adjust.brightness).toBe(-10)
    expect(migrated?.adjust.contrast).toBe(10)
    expect(migrated?.geometry.orientation.quarterTurns).toBe(1)
    expect(migrated?.output.resize).toEqual({ mode: 'width', width: 1600 })
    expect(migrated?.source?.assetId).toBe('asset_x')
  })
})

describe('a corrupt localStorage payload', () => {
  it('leaves the IndexedDB session exactly as it was', async () => {
    // The mirror is the fragile copy — hand-edited, truncated by a bad writer,
    // left by a build that changed shape — so the rule is that nothing it says
    // can cost the durable row. A mirror that will not parse is discarded; the
    // session it was shadowing is not touched.
    await storeWork()
    writeMirror(docWithSource('asset_a', 2.5))
    for (const junk of ['{not json', '', '[]', 'null', '{"schema":99,"updatedAt":0,"doc":{}}']) {
      localStorage.setItem(MIRROR_KEY, junk)
      const loaded = await session.loadSession()
      expect(loaded, junk).not.toBeNull()
      expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_a')
      expect(loaded?.source?.size).toBe('pixels'.length)
      expect(readMirror()).toBeNull()
    }
    expect(fake.read<StoredSession>('sessions', 'current')).toBeDefined()
  })

  it('leaves the session loadable when the retention choice is unreadable', async () => {
    // The policy is a preference. A preference that cannot be parsed falls back
    // to the default horizon, and a default horizon is not a reason to refuse a
    // document.
    for (const junk of ['{', '"forever "', '0d', 'null', '[]']) {
      localStorage.setItem(RETENTION_KEY, junk)
      expect(readRetention()).toBe('180d')
      await storeWork()
      const loaded = await session.loadSession()
      expect(loaded, junk).not.toBeNull()
      expect(loaded?.source?.size).toBe('pixels'.length)
      fake.write('sessions', 'current', undefined)
    }
  })

  it('keeps the presets that can be read when one of them cannot', async () => {
    expect(savePreset('Good', docWithSource('asset_a', 1))).toBe('ok')
    expect(savePreset('Also good', docWithSource('asset_a', -1))).toBe('ok')
    localStorage.setItem('ie-preset:Broken', '{not json')

    expect(listPresets()).toEqual(['Also good', 'Broken', 'Good'])
    // The unreadable one refuses to apply, and refuses to take the others with it.
    expect(applyPreset('Broken', createDoc())).toBeNull()
    expect(readPreset('Broken')).toBe('{not json')
    expect((applyPreset('Good', createDoc()) as Doc).adjust.exposure).toBe(1)
  })
})

describe('a browser with storage switched off', () => {
  it('loads the IndexedDB session and reports that the mirror is unavailable', async () => {
    await storeWork()
    vi.stubGlobal('localStorage', blockedStorage())
    expect(readMirror()).toBeNull()
    expect(writeMirror(docWithSource('asset_a', 3))).toBe('unavailable')
    expect(readRetention()).toBe('180d')
    expect(writeRetention('forever')).toBe('forever')
    expect(() => session.acknowledgeRetentionWarning()).not.toThrow()

    const loaded = await session.loadSession()
    expect(loaded).not.toBeNull()
    expect(loaded?.source?.size).toBe('pixels'.length)
  })

  it('refuses a preset rather than throwing, and leaves the others alone', async () => {
    expect(savePreset('Kept', docWithSource('asset_a', 1))).toBe('ok')
    vi.stubGlobal('localStorage', blockedStorage())
    expect(savePreset('New', docWithSource('asset_a', 2))).toBe('unavailable')
    expect(listPresets()).toEqual([])
    expect(readPreset('Kept')).toBeNull()
    expect(applyPreset('Kept', createDoc())).toBeNull()
    vi.unstubAllGlobals()
    // The refusal did not damage what was already stored.
    expect(listPresets()).toEqual(['Kept'])
  })

  it('keeps saving to IndexedDB, because the two are independent', async () => {
    await storeWork('asset_a', 1)
    vi.stubGlobal('localStorage', blockedStorage())
    expect(
      await session.saveSession(docWithSource('asset_b', 2), bytes('asset_b', 'more'), null),
    ).toBe('ok')
    const loaded = await session.loadSession()
    expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_b')
    expect(loaded?.source?.size).toBe('more'.length)
  })
})

describe('a write the browser refuses', () => {
  it('a full disk leaves the previous session and the presets alone', async () => {
    await storeWork()
    writeMirror(docWithSource('asset_a', 1.4))
    expect(savePreset('Before the disk filled', docWithSource('asset_a', 1.4))).toBe('ok')

    fake.failNextWrite('assets', 'QuotaExceededError')
    expect(
      await session.saveSession(docWithSource('asset_b', 9), bytes('asset_b', 'x'), null),
    ).toBe('quota')

    const loaded = await session.loadSession()
    expect(session.readSourceAssetId(loaded?.doc)).toBe('asset_a')
    expect(loaded?.source?.size).toBe('pixels'.length)
    // The mirror still holds the newest document, so a hard reload in this state
    // is still resumable even though the durable write did not land.
    expect((readMirror()?.doc as Doc).adjust.exposure).toBe(1.4)
    expect((applyPreset('Before the disk filled', createDoc()) as Doc).adjust.exposure).toBe(1.4)
  })

  it('blocked storage is retried on the next save, not remembered as a failure', async () => {
    fake.failNextOpen('storage disabled')
    expect(await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)).toBe(
      'unavailable',
    )
    expect(await session.saveSession(docWithSource('asset_a'), bytes('asset_a', 'x'), null)).toBe(
      'ok',
    )
    expect((await session.loadSession())?.source?.size).toBe(1)
  })
})

describe('the retention rule itself', () => {
  it('does not delete anything, however long the laptop was shut', async () => {
    // The case from the bug report, kept as a test of its own because it is the
    // one that used to destroy a photo and every edit with no prompt, no warning
    // and nothing the user could report afterwards.
    await storeWork('asset_a', 1.4)
    writeMirror(docWithSource('asset_a', 1.4))
    for (const days of [7, 8, 30, 365, 3650]) {
      mutateStoredRow((row) => {
        row.updatedAt = Date.now() - days * 24 * 60 * 60 * 1000
      })
      const loaded = await session.loadSession()
      expect(loaded, `${days} days`).not.toBeNull()
      expect(loaded?.source, `${days} days`).not.toBeNull()
      expect(fake.read<StoredSession>('sessions', 'current'), `${days} days`).toBeDefined()
      expect(fake.keys('assets'), `${days} days`).toEqual(['asset_a'])
    }
    // Even after a year the mirror is still readable — it is the newest document
    // and its own horizon is six months, so at a year it is dropped, but only
    // after the durable row has been read and found.
    expect(readMirror({ retention: 'forever' })).not.toBeNull()
  })

  it('is a horizon the card counts down to, and not a trigger', () => {
    // One number, exported, and the card is told to read it from here rather
    // than restate it — a second copy of a retention policy is how the copy and
    // the behaviour come to disagree.
    expect(session.SESSION_MAX_AGE_MS).toBe(180 * 24 * 60 * 60 * 1000)
  })

  it('forgetting is a separate, explicit call', async () => {
    await storeWork()
    // Nothing in the read path can be made to forget: the only delete in the
    // module is the one a button is wired to.
    for (let read = 0; read < 3; read += 1) expect(await session.loadSession()).not.toBeNull()
    expect(fake.read<StoredSession>('sessions', 'current')).toBeDefined()
    await session.forgetSession()
    expect(await session.loadSession()).toBeNull()
  })
})
