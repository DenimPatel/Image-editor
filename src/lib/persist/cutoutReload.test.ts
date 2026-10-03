import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb'
import { bytesForSource, REPLACEMENT_MIME } from './sourceBytes'
import type { SourceBytes } from './session'

/**
 * D2-F12 — "a cut-out survives a reload", end to end, without the model.
 *
 * The gap this closes is that the storage layer was proven (bytes are keyed to
 * the asset the document points at; a mismatched id is refused) and the claim
 * was not. Proving the claim needs a background removal, and a real one pulls
 * ~42 MB of ONNX weights from a CDN, which `AGENTS.md` forbids a test from
 * doing.
 *
 * The download is the only part that needs a network. What the claim is about
 * is everything after it, and all of that is reachable: a matte is *a different
 * set of pixels under a different asset id*, and the editor's own
 * `BackgroundPanel` commit is a `Doc` update plus an `assetStore.add`. So this
 * installs exactly that commit — a synthetic second asset, the real
 * `beginInteraction`/`update`/`endInteraction` group, the real `bytesForSource`
 * re-encode, the real `saveSession` — then tears the whole module graph down
 * and rebuilds it, which is what a reload does, and checks the bytes that come
 * back are the *second* asset's and not the imported file's.
 *
 * The two things the earlier test did not do, and the two that make this the
 * end-to-end claim: it compares decoded **bytes** rather than object identity
 * (the fake IndexedDB stores records by reference, so identity is trivially
 * true inside one module instance), and it runs the round trip across a
 * `vi.resetModules()` boundary with an empty asset store, so nothing can be
 * answered out of memory.
 */

type SessionModule = typeof import('./session')
type DocStoreModule = typeof import('../../store/docStore')
type AssetsModule = typeof import('../../model/assetsSingleton')

let fake: FakeIndexedDb
let session: SessionModule
let docStore: DocStoreModule
let assets: AssetsModule

/** A stand-in for a decoded `ImageBitmap`: sized, closable, and distinguishable. */
function fakeAsset(label: string, width = 40, height = 30) {
  return { label, width, height, close: () => {} }
}

/**
 * jsdom's `Blob` implements no reader at all — not `text()`, not
 * `arrayBuffer()`, not `stream()` — and `Response` does not recognise a jsdom
 * `Blob` either, so `FileReader` is the only way to the actual bytes.
 */
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsText(blob)
  })
}

const ORIGINAL_BYTES = 'ORIGINAL-FILE-BYTES'
const MATTE_BYTES = 'MATTE-BYTES-WITH-ALPHA'

/** The autosave's own `save`, copied from `Editor.tsx` rather than reimplemented. */
async function runAutosaveSave(known: SourceBytes | null): Promise<SourceBytes | null> {
  const doc = docStore.useDocStore.getState().present
  const source = doc.source
  const bitmap = source ? (assets.assetStore.get(source.assetId) as ImageBitmap | undefined) : null
  const bytes = await bytesForSource({
    doc,
    bitmap: bitmap ?? null,
    known,
    // Real re-encode, minus the encoder: the identity of the bytes is the
    // point, and the encoder is already covered in `sourceBytes.test.ts`.
    encode: async (input: ImageBitmap) => {
      const label = (input as unknown as { label?: string }).label ?? 'unknown'
      return new Blob([MATTE_BYTES, `:${label}`], { type: REPLACEMENT_MIME })
    },
  })
  return bytes
}

/** Drop every module in the graph and import it again: a fresh process. */
async function reload(): Promise<void> {
  vi.resetModules()
  session = await import('./session')
  docStore = await import('../../store/docStore')
  assets = await import('../../model/assetsSingleton')
}

beforeEach(async () => {
  fake = installFakeIndexedDb()
  await reload()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('D2-F12: a cut-out survives a reload', () => {
  it('reloads onto the replacement asset’s bytes, not the imported file’s', async () => {
    // 1. Import a file, the way `handleSample` does.
    const originalId = assets.assetStore.add(fakeAsset('original') as never)
    docStore.useDocStore.getState().load({
      ...(await import('../../model/defaults')).createDoc(),
      source: { assetId: originalId, width: 40, height: 30, name: 'photo', mime: 'image/jpeg' },
    })
    let known: SourceBytes | null = {
      assetId: originalId,
      blob: new Blob([ORIGINAL_BYTES], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
    }
    // The first save writes the imported file under the imported asset's id.
    expect(await session.saveSession(docStore.useDocStore.getState().present, known, 'thumb')).toBe(
      'ok',
    )

    // 2. Background removal commits: a cut-out bitmap enters the store under a
    //    *new* id and the document is repointed at it. This is the whole of
    //    what `BackgroundPanel` does once the weights have loaded.
    const mattedId = assets.assetStore.add(fakeAsset('matted') as never)
    const store = docStore.useDocStore.getState()
    store.beginInteraction('background:remove')
    store.update((doc) => ({
      ...doc,
      source: { ...doc.source!, assetId: mattedId, mime: REPLACEMENT_MIME },
      background: { ...doc.background, removed: true },
    }))
    store.endInteraction()
    expect(docStore.useDocStore.getState().present.source?.assetId).toBe(mattedId)

    // 3. The autosave re-encodes for the new asset, so the bytes that go to
    //    storage are the cut-out's, and stores them under *its* id.
    known = await runAutosaveSave(known)
    expect(known?.assetId).toBe(mattedId)
    expect(known?.mime).toBe(REPLACEMENT_MIME)
    expect(await session.saveSession(docStore.useDocStore.getState().present, known, 'thumb')).toBe(
      'ok',
    )
    // The imported file's row is gone: nothing still references it.
    expect(fake.keys('assets')).toEqual([mattedId])

    // 4. Reload. New module graph, empty asset store, nothing in memory.
    await reload()
    expect(assets.assetStore.size).toBe(0)

    // 5. What the resume card would offer.
    const loaded = await session.loadSession()
    expect(loaded).not.toBeNull()
    const restoredSource = loaded?.source ?? null
    expect(restoredSource).not.toBeNull()
    // Bytes, not identity: this is the cut-out, and the imported file's bytes
    // are nowhere in the answer.
    expect(await blobText(restoredSource!)).toBe(`${MATTE_BYTES}:matted`)
    expect(await blobText(restoredSource!)).not.toContain(ORIGINAL_BYTES)

    // 6. And the document that comes back with them is the cut-out document.
    expect(docStore.useDocStore.getState().loadUnknown(loaded?.doc)).toBe(true)
    const resumed = docStore.useDocStore.getState().present
    expect(resumed.source?.assetId).toBe(mattedId)
    expect(resumed.background.removed).toBe(true)
    // The id the document names and the id the bytes were stored under agree —
    // which is the whole contract `session.ts` enforces on write.
    expect(session.readSourceAssetId(loaded?.doc)).toBe(mattedId)
  })

  it('needs no re-encode after the reload — the restored bytes are already the matte’s', async () => {
    const originalId = assets.assetStore.add(fakeAsset('original') as never)
    const { createDoc } = await import('../../model/defaults')
    docStore.useDocStore.getState().load({
      ...createDoc(),
      source: { assetId: originalId, width: 40, height: 30, name: 'photo', mime: 'image/jpeg' },
    })
    const mattedId = assets.assetStore.add(fakeAsset('matted') as never)
    const store = docStore.useDocStore.getState()
    store.beginInteraction('background:remove')
    store.update((doc) => ({
      ...doc,
      source: { ...doc.source!, assetId: mattedId, mime: REPLACEMENT_MIME },
      background: { ...doc.background, removed: true },
    }))
    store.endInteraction()
    const bytes = await runAutosaveSave({
      assetId: originalId,
      blob: new Blob([ORIGINAL_BYTES], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
    })
    await session.saveSession(docStore.useDocStore.getState().present, bytes, null)

    await reload()
    const loaded = await session.loadSession()
    docStore.useDocStore.getState().loadUnknown(loaded?.doc)
    // The editor's resume path decodes the stored bytes and hands them back to
    // `bytesForSource` as `known` under the document's own asset id. A second
    // encode here would mean the reload is producing a different image from the
    // one that was saved.
    const encode = vi.fn(async () => new Blob(['re-encoded'], { type: REPLACEMENT_MIME }))
    const after = await bytesForSource({
      doc: docStore.useDocStore.getState().present,
      bitmap: null,
      known: { assetId: mattedId, blob: loaded!.source!, mime: REPLACEMENT_MIME },
      encode,
    })
    expect(after?.assetId).toBe(mattedId)
    expect(encode).not.toHaveBeenCalled()
    expect(await blobText(after!.blob)).toBe(`${MATTE_BYTES}:matted`)
  })
})
