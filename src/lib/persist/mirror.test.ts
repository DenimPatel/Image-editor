import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc } from '../../model/types'
import {
  MIRROR_FOREVER_MAX_BYTES,
  MIRROR_KEY,
  MIRROR_MAX_BYTES,
  MIRROR_SCHEMA,
  clearMirror,
  readMirror,
  resolveResumableSession,
  writeMirror,
  type MirrorStorage,
} from './mirror'
import { SESSION_MAX_AGE_MS, type LoadedSession } from './session'

function docFor(assetId: string, exposure = 0): Doc {
  return createDoc({
    source: { assetId, width: 100, height: 80, name: 'image', mime: 'image/jpeg' },
    adjust: { ...createDoc().adjust, exposure },
  })
}

function session(doc: unknown, updatedAt: number, source: Blob | null = null): LoadedSession {
  return { doc, updatedAt, thumb: null, source, warnRetention: false }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('writeMirror / readMirror', () => {
  it('D2-F11: round-trips the document with a schema stamp and a timestamp', () => {
    expect(writeMirror(docFor('asset_a', -12))).toBe('ok')
    const entry = readMirror()
    expect(entry?.schema).toBe(MIRROR_SCHEMA)
    expect(entry?.updatedAt).toBeGreaterThan(0)
    expect((entry?.doc as Doc).adjust.exposure).toBe(-12)
    expect((entry?.doc as Doc).source?.assetId).toBe('asset_a')
  })

  it('D2-F11: the write is synchronous — no promise, no callback to wait on', () => {
    writeMirror(docFor('asset_a'))
    // Read the key directly rather than through `readMirror`, so a mirror that
    // only populated itself after a microtask could not pass.
    expect(localStorage.getItem(MIRROR_KEY)).toContain('"schema":1')
  })

  it('D2-F11: a document over the size cap is refused and the good entry survives', () => {
    // This test used to assert the opposite — that the cap *deletes* the
    // previous entry. That behaviour was the defect: a document which grew too
    // large to mirror destroyed the last snapshot that had fit, so the attempt
    // to save a newer one cost the user the only copy the safety net held.
    writeMirror(docFor('asset_a', -12))
    const before = localStorage.getItem(MIRROR_KEY)
    const huge = { ...docFor('asset_b'), padding: 'x'.repeat(MIRROR_MAX_BYTES) }
    expect(writeMirror(huge)).toBe('too-large')
    // Untouched: still the previous document, still readable, still stamped with
    // the timestamp that lets a caller tell it apart from a newer one.
    expect(localStorage.getItem(MIRROR_KEY)).toBe(before)
    const entry = readMirror()
    expect(entry?.doc).toEqual(docFor('asset_a', -12))
    expect((entry?.doc as Doc).adjust.exposure).toBe(-12)
  })

  it('the refused write never issues a remove, whatever the state of the key', () => {
    const remove = vi.spyOn(Storage.prototype, 'removeItem')
    try {
      writeMirror(docFor('asset_a'))
      expect(writeMirror({ ...docFor('asset_b'), padding: 'x'.repeat(MIRROR_MAX_BYTES) })).toBe(
        'too-large',
      )
      expect(remove).not.toHaveBeenCalled()
    } finally {
      remove.mockRestore()
    }
  })

  it('a refused write is reported rather than swallowed, so the user can be told', () => {
    // The result is the only signal the editor gets. Silently keeping the old
    // entry while reporting success would be a lie about what was saved.
    writeMirror(docFor('asset_a'))
    expect(writeMirror({ ...docFor('asset_b'), padding: 'x'.repeat(MIRROR_MAX_BYTES) })).toBe(
      'too-large',
    )
    expect(readMirror()?.doc).toEqual(docFor('asset_a'))
  })

  it('a storage that refuses the write also keeps the previous entry', () => {
    // A full origin: `setItem` throws. The newest snapshot is lost, which is
    // unavoidable, and the last good one is not.
    let refused = false
    const storage: MirrorStorage = {
      getItem: (key) => (refused ? null : localStorage.getItem(key)),
      setItem: (key, value) => {
        if (refused) throw new DOMException('full', 'QuotaExceededError')
        localStorage.setItem(key, value)
      },
      removeItem: (key) => localStorage.removeItem(key),
    }
    expect(writeMirror(docFor('asset_a'), { storage })).toBe('ok')
    refused = true
    expect(writeMirror(docFor('asset_a', -9), { storage })).toBe('unavailable')
    refused = false
    expect(readMirror({ storage })?.doc).toEqual(docFor('asset_a'))
  })

  it('D2-F11: the cap refuses an oversized document and accepts a normal one', () => {
    const doc = docFor('asset_a')
    const padded = { ...doc, padding: 'x'.repeat(4096) }
    expect(writeMirror(padded, { maxBytes: 64 * 1024 })).toBe('ok')
    const good = localStorage.getItem(MIRROR_KEY)
    expect(writeMirror(padded, { maxBytes: 1024 })).toBe('too-large')
    // The refused write changed nothing, so the entry still holds the document
    // that did fit rather than nothing at all.
    expect(localStorage.getItem(MIRROR_KEY)).toBe(good)
    expect(readMirror()?.doc).toEqual(padded)
  })

  it('D2-F11: the cap is generous for a real document, which carries no pixels', () => {
    // 40 megapixels is one `AssetId` in the document; the cap is about what an
    // ordinary document costs, not about image size.
    const bytes = JSON.stringify(docFor('asset_a')).length
    expect(bytes * 10).toBeLessThan(MIRROR_MAX_BYTES)
  })

  it('D2-F11: unparseable JSON is discarded rather than thrown on', () => {
    localStorage.setItem(MIRROR_KEY, '{not json')
    expect(readMirror()).toBeNull()
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
  })

  it('D2-F11: an entry stamped by another build is discarded, not migrated blindly', () => {
    localStorage.setItem(
      MIRROR_KEY,
      JSON.stringify({ schema: MIRROR_SCHEMA + 1, updatedAt: Date.now(), doc: docFor('a') }),
    )
    expect(readMirror()).toBeNull()
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
  })

  it('D2-F11: a malformed entry is discarded field by field', () => {
    for (const entry of [
      { schema: MIRROR_SCHEMA, updatedAt: Date.now() },
      { schema: MIRROR_SCHEMA, updatedAt: 'soon', doc: docFor('a') },
      { schema: MIRROR_SCHEMA, updatedAt: Number.NaN, doc: docFor('a') },
      { schema: MIRROR_SCHEMA, updatedAt: Date.now(), doc: 'a document, honest' },
      [MIRROR_SCHEMA, Date.now()],
    ]) {
      localStorage.setItem(MIRROR_KEY, JSON.stringify(entry))
      expect(readMirror()).toBeNull()
      expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
    }
  })

  it('D2-F11: an entry older than the session horizon is dropped', () => {
    localStorage.setItem(
      MIRROR_KEY,
      JSON.stringify({
        schema: MIRROR_SCHEMA,
        updatedAt: Date.now() - SESSION_MAX_AGE_MS - 1,
        doc: docFor('asset_a'),
      }),
    )
    expect(readMirror()).toBeNull()
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
  })

  it('the horizon is the same number the session row uses', () => {
    // Two constants for one policy is how a mirror ends up offering edits the
    // durable row has already forgotten. Asserted through the behaviour rather
    // than by comparing a pair of literals, so a constant that drifts apart from
    // the row fails here instead of being noticed a year later.
    const now = 1_800_000_000_000
    const entry = (updatedAt: number) =>
      JSON.stringify({ schema: MIRROR_SCHEMA, updatedAt, doc: docFor('asset_a') })
    localStorage.setItem(MIRROR_KEY, entry(now - SESSION_MAX_AGE_MS))
    expect(readMirror({ now: () => now })).not.toBeNull()
    localStorage.setItem(MIRROR_KEY, entry(now - SESSION_MAX_AGE_MS - 1))
    expect(readMirror({ now: () => now })).toBeNull()
  })

  it('honours the retention horizon at its boundary: under, at, and over', () => {
    const now = Date.now() - 7 * 24 * 60 * 60 * 1000
    const entry = (updatedAt: number) =>
      JSON.stringify({ schema: MIRROR_SCHEMA, updatedAt, doc: docFor('asset_a') })

    localStorage.setItem(MIRROR_KEY, entry(now - 1))
    expect(readMirror({ now: () => now, retention: '7d' })).not.toBeNull()

    localStorage.setItem(MIRROR_KEY, entry(now - 7 * 24 * 60 * 60 * 1000))
    expect(readMirror({ now: () => now, retention: '7d' })).not.toBeNull()

    localStorage.setItem(MIRROR_KEY, entry(now - 7 * 24 * 60 * 60 * 1000 - 1))
    expect(readMirror({ now: () => now, retention: '7d' })).toBeNull()
  })

  it('a choice of forever lifts the horizon and the byte cap', () => {
    const ancient = Date.now() - SESSION_MAX_AGE_MS * 2
    const entry = () =>
      JSON.stringify({ schema: MIRROR_SCHEMA, updatedAt: ancient, doc: docFor('asset_a') })

    // Past the default horizon a read drops it, so the entry has to be put back
    // before the choice that keeps it can be tried.
    localStorage.setItem(MIRROR_KEY, entry())
    expect(readMirror({ retention: '180d' })).toBeNull()
    localStorage.setItem(MIRROR_KEY, entry())
    expect(readMirror({ retention: 'forever' })).not.toBeNull()

    // A project with a long layer list stops being refused by a 64 kB ceiling
    // once the user has said they want it kept.
    const padded = { ...docFor('asset_a'), padding: 'x'.repeat(MIRROR_MAX_BYTES + 1) }
    expect(writeMirror(padded, { retention: '180d' })).toBe('too-large')
    expect(writeMirror(padded, { retention: 'forever' })).toBe('ok')
  })

  it('the cap the two choices imply is a real ceiling, not an accidental one', () => {
    expect(MIRROR_FOREVER_MAX_BYTES).toBeGreaterThan(MIRROR_MAX_BYTES)
  })

  it('D2-F11: blocked storage reports itself and never throws', () => {
    const blocked: MirrorStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    expect(writeMirror(docFor('a'), { storage: blocked })).toBe('unavailable')
    expect(readMirror({ storage: blocked })).toBeNull()
    expect(() => clearMirror({ storage: blocked })).not.toThrow()
    expect(writeMirror(docFor('a'), { storage: null })).toBe('unavailable')
  })

  it('clearMirror removes the entry', () => {
    writeMirror(docFor('a'))
    clearMirror()
    expect(readMirror()).toBeNull()
  })
})

describe('resolveResumableSession', () => {
  const stored = session(docFor('asset_a', 0), 1_000)
  const storedWithBytes = session(docFor('asset_a', 0), 1_000, new Blob(['bytes']))

  it('D2-F11: a newer mirror over the same asset is adopted, with the stored bytes', () => {
    const resolved = resolveResumableSession(storedWithBytes, {
      schema: MIRROR_SCHEMA,
      updatedAt: 2_000,
      doc: docFor('asset_a', -30),
    })
    expect((resolved?.doc as Doc).adjust.exposure).toBe(-30)
    expect(resolved?.updatedAt).toBe(2_000)
    // Pixels still come from IndexedDB. The mirror has none, and never will.
    expect(resolved?.source).toBe(storedWithBytes.source)
    expect(resolved?.thumb).toBe(storedWithBytes.thumb)
  })

  it('D2-F11: a mirror that is not newer loses to the stored row', () => {
    const same = resolveResumableSession(stored, {
      schema: MIRROR_SCHEMA,
      updatedAt: 1_000,
      doc: docFor('asset_a', -30),
    })
    expect(same).toBe(stored)
    const older = resolveResumableSession(stored, {
      schema: MIRROR_SCHEMA,
      updatedAt: 999,
      doc: docFor('asset_a', -30),
    })
    expect(older).toBe(stored)
  })

  it('D2-F12: a mirror naming a different asset is refused — those bytes are not stored', () => {
    // The doc moved to a replacement asset (a cut-out) and the bytes for that
    // id never made it out of IndexedDB. Adopting it would resume a document
    // whose pixels are not on disk.
    const resolved = resolveResumableSession(storedWithBytes, {
      schema: MIRROR_SCHEMA,
      updatedAt: 2_000,
      doc: docFor('asset_matted', -30),
    })
    expect(resolved).toBe(storedWithBytes)
    expect((resolved?.doc as Doc).adjust.exposure).toBe(0)
  })

  it('D2-F11: no stored row means no pixels, so there is nothing to resume', () => {
    const mirrored = { schema: MIRROR_SCHEMA, updatedAt: 2_000, doc: docFor('asset_a', -30) }
    expect(resolveResumableSession(null, mirrored)).toBeNull()
    expect(resolveResumableSession(null, null)).toBeNull()
  })

  it('D2-F11: no mirror means the stored row is used exactly as it was', () => {
    expect(resolveResumableSession(storedWithBytes, null)).toBe(storedWithBytes)
  })
})
