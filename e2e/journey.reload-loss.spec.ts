import { MIRROR_KEY } from '../src/lib/persist/mirror'
import { test, expect } from './fixtures'

/**
 * D2-F11 — an edit made just before a hard reload is not lost.
 *
 * The autosave scheduler was already right about *when* to save: a trailing
 * debounce, a `maxWait` deadline, and a `flush()` on `pagehide` and on
 * `visibilitychange`. It could not be right about the last 150 ms, and the
 * reason is structural rather than a bug in the scheduler. An IndexedDB write
 * is a transaction: it needs the event loop to keep turning so the request can
 * be dispatched and the transaction can commit. A hard reload fires `pagehide`
 * — so the flush *does* start — and then tears the page down, and the
 * transaction dies with it. Backgrounding the tab worked, which is what made
 * the residual easy to miss.
 *
 * So the document is also written to `localStorage`, synchronously, on the same
 * throttle. `setItem` has the opposite property to a transaction: it completes
 * inside the handler, whatever happens to the page afterwards.
 *
 * The test is built so that the timing is a *fact it measures* rather than a
 * race it hopes to win:
 *
 *   1. a first save lands, so a session row and its bytes exist;
 *   2. a crop handle is moved and the page is reloaded with nothing in between;
 *   3. the row in IndexedDB is asserted to still be the *pre-edit* document —
 *      this is the proof the reload beat the debounce, and the assertion that
 *      would fail if the test were quietly measuring something else;
 *   4. the resume card is followed and the edit is asserted to be there.
 */

/**
 * Playwright WebKit aborts the assets write transaction, so no session row ever
 * lands. The mirror itself is `localStorage` and WebKit handles that fine; the
 * test needs the *IndexedDB* row as its baseline — both to have bytes to resume
 * from and to prove the reload beat the debounce — so it is blocked on the same
 * limitation `journey.import-edit-export.spec.ts` already skips for, and for
 * the same reason.
 */
const NO_BLOB_STORAGE =
  'Playwright WebKit cannot store a Blob in IndexedDB (the assets write transaction aborts); the same write succeeds in Chromium'

test.describe('an edit made just before a hard reload', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('survives a reload fired inside the autosave debounce', async ({
    page,
    openTool,
    readDoc,
    persistedDoc,
  }) => {
    // 1. Wait for the session to exist at all, so there are bytes to resume
    //    from. Without this the resume card would be a first-import screen and
    //    the test would prove nothing.
    await expect.poll(async () => (await persistedDoc()).source?.assetId).toBeTruthy()

    await openTool('Crop')
    const handle = page.getByRole('slider', { name: 'Crop se handle' })
    await expect(handle).toHaveAttribute('aria-valuenow', '100')

    // 2. One keystroke, one read of the value it produced, then the reload.
    //    Nothing that costs a round trip sits between the edit and the teardown.
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    const cropPercent = Number(await handle.getAttribute('aria-valuenow'))
    expect(cropPercent).toBeLessThan(100)
    await page.reload()

    // 3. The durable row is untouched: the transaction the flush started died
    //    with the page, which is exactly the gap being closed.
    const stored = await persistedDoc()
    expect(stored.geometry.crop.width).toBe(1)
    expect(stored.geometry.crop.height).toBe(1)

    // 4. The mirror brought the edit back.
    const resume = page.getByRole('button', { name: 'Resume' })
    await expect(resume).toBeVisible()
    await resume.click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()

    const resumed = await readDoc()
    expect(resumed.source?.assetId).toBe(stored.source?.assetId)
    expect(resumed.geometry.crop.width).toBeLessThan(1)
    expect(Math.round(resumed.geometry.crop.width * 100)).toBe(cropPercent)
  })

  test('discarding a session takes the mirror with it', async ({
    page,
    openTool,
    persistedDoc,
  }) => {
    await expect.poll(async () => (await persistedDoc()).source?.assetId).toBeTruthy()

    // Edit, reload so the mirror holds the only copy of the edit, then throw
    // the whole thing away.
    await openTool('Crop')
    const handle = page.getByRole('slider', { name: 'Crop se handle' })
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    await page.getByRole('button', { name: 'Discard' }).click()

    // A mirror is a second copy of the document, so a discard that cleared only
    // IndexedDB would silently re-offer what the user just threw away.
    expect(await page.evaluate((key) => localStorage.getItem(key), MIRROR_KEY)).toBeNull()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0)
  })
})
