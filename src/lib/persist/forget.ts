import { clearMirror, type MirrorOptions } from './mirror'
import { clearSession } from './session'

/**
 * Both copies of a stored document, gone in one call.
 *
 * A document outlives the page in two places: the `sessions` row in IndexedDB,
 * with the bytes behind it, and the synchronous mirror in `localStorage`. They are
 * written together and they are read together — `resolveResumableSession` refuses a
 * mirror unless the row it shadows is there — so *clearing* them apart is the one
 * operation that can leave the pair describing two different documents. That is
 * what `New image` used to do: it cleared the mirror, so a reload resolved to the
 * stored row and offered the photograph the user had just replaced.
 *
 * Order is not an implementation detail. The mirror goes first and synchronously,
 * because a synchronous write is the only one guaranteed to land before a page can
 * be torn down; the IndexedDB delete is a transaction and can wait for the event
 * loop. The other order leaves a window in which a teardown resurrects the mirror.
 *
 * It is its own module rather than a function in `mirror.ts` or `session.ts`
 * because each of those is imported by the other — `mirror.ts` reads the row's
 * source id through `session.ts` — so a "clear both" helper added to either would
 * make the pair circular. One module that names the pair is also the one place a
 * future third copy of a document has to be added to.
 */

/**
 * Delete the stored document: the session row, its bytes, and the mirror.
 *
 * Never throws, because neither half is allowed to: `clearSession` swallows its
 * own failures and `clearMirror` swallows a storage that refuses to remove, and a
 * caller on a UI thread cannot act on a rejection anyway. The consequence is that
 * a refused delete is invisible — `clearSession` reporting whether it managed is a
 * separate change to its signature, and inventing a boolean here would be a lie
 * about a call this module does not make.
 *
 * `await` is still part of the contract: the row delete is the part that has to be
 * observed before a caller can promise that a reload will not bring the document
 * back.
 */
export async function forgetStoredDocument(options: MirrorOptions = {}): Promise<void> {
  clearMirror(options)
  await clearSession()
}
