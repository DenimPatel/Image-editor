import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc } from '../../model/types'
import { installFakeIndexedDb, type FakeIndexedDb } from './fakeIndexedDb'
import { forgetStoredDocument } from './forget'
import { MIRROR_KEY, readMirror, writeMirror } from './mirror'
import { loadSession, saveSession } from './session'

/**
 * One operation, two copies.
 *
 * A document survives the page in the `sessions` row and in the mirror. They are
 * written together and read together, and the two directions of "half of it
 * survives" are *not* equally bad:
 *
 * - a **mirror with no row** is inert. `resolveResumableSession` returns `null`
 *   when the stored row is missing, because a mirror carries edits and no pixels
 *   and so cannot resume on its own.
 * - a **row with no mirror** is what comes back. `resolveResumableSession` returns
 *   `stored` unchanged when there is no mirror, so a reload offers the document
 *   that was replaced.
 *
 * That asymmetry is why this clears both rather than one: it is the row that has
 * to go, and the mirror goes with it because a pair where only one half was
 * cleared is a state neither writer has an answer for. The claim below used to be
 * stated the other way round — that clearing the row alone re-offers the photo —
 * and it was false.
 */

let fake: FakeIndexedDb

const docFor = (assetId: string): Doc =>
  createDoc({ source: { assetId, width: 8, height: 8, name: assetId, mime: 'image/png' } })

async function storedSession(): Promise<Doc> {
  const doc = docFor('asset_stored')
  const result = await saveSession(
    doc,
    {
      assetId: 'asset_stored',
      blob: new Blob(['bytes'], { type: 'image/png' }),
      mime: 'image/png',
    },
    null,
  )
  if (result !== 'ok') throw new Error(`could not store a session: ${result}`)
  return doc
}

// One database for the file, as `dataLoss.test.ts` does: `clearSession` deletes
// every row in `sessions` *and* every row in `assets`, so each case starts from the
// same full origin rather than from whatever the previous one left behind.
installFakeIndexedDb()

beforeEach(async () => {
  localStorage.clear()
  fake = installFakeIndexedDb()
  await storedSession()
  writeMirror(docFor('asset_mirrored'))
})

afterEach(() => {
  localStorage.clear()
})

describe('forgetStoredDocument', () => {
  it('takes the durable row, its bytes and the mirror', async () => {
    // All three at once. The bytes matter on their own account: a clear that took
    // the row but not them would leave the document's pixels on disk with nothing
    // pointing at them. The mirror is taken because the row is — see the file
    // header for which half of the pair is the dangerous one.
    expect(await loadSession()).not.toBeNull()
    expect(readMirror()).not.toBeNull()

    await forgetStoredDocument()

    expect(await loadSession()).toBeNull()
    expect(readMirror()).toBeNull()
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
    expect(fake.keys('assets')).toEqual([])
  })

  it('is a no-op on an origin that has nothing stored', async () => {
    // Pressing it twice must not be a second failure: "New image" on an empty editor
    // asks no question and still clears.
    await forgetStoredDocument()
    await expect(forgetStoredDocument()).resolves.toBeUndefined()
    expect(readMirror()).toBeNull()
  })

  it('reports a refused mirror write rather than throwing', async () => {
    // A storage that denies every call is a blocked third-party context, and the
    // replacement still has to go through — the in-memory document is what the user
    // sees, and a refused delete is not a reason to keep their photograph on screen.
    await expect(
      forgetStoredDocument({
        storage: {
          getItem: () => {
            throw new DOMException('denied', 'SecurityError')
          },
          setItem: () => {
            throw new DOMException('denied', 'SecurityError')
          },
          removeItem: () => {
            throw new DOMException('denied', 'SecurityError')
          },
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('leaves a document the user never stored alone — there is nothing to forget', async () => {
    // The mirror may legitimately hold a document the row does not: an import inside
    // the save debounce writes it and the reload window resolves nothing, because
    // `resolveResumableSession` needs the row. Forgetting must still be harmless
    // when the mirror is the only copy, which is exactly the import case.
    await forgetStoredDocument()
    writeMirror(docFor('asset_only_mirrored'))
    expect(readMirror()?.doc).toEqual(docFor('asset_only_mirrored'))
    expect(await loadSession()).toBeNull()
  })
})
