import { MIRROR_KEY } from '../src/lib/persist/mirror'
import { test, expect } from './fixtures'

/**
 * IMP-001 / IMP-006 — "if a user selects one stock image and starts editing, how to
 * go back and select/upload new option?"
 *
 * `Editor.tsx` unmounted `ImportScreen` permanently the moment a document existed,
 * and the More menu offered seven rows, none of which changed the photograph. The
 * only way back was a full browser reload, and the only two things after that were
 * Resume or Discard. So this file drives the whole round trip the owner asked for:
 * load a stock image, make an edit, ask for a new one, pick a different one, and
 * check that neither the store nor the two durable copies still claim to be the
 * photograph that was replaced.
 *
 * The properties worth having in a real browser rather than in jsdom:
 *
 * - the confirmation is *asked*, and Escape really answers it;
 * - a reload is a real teardown, so "the IndexedDB transaction died with the page"
 *   is the thing being tested rather than a promise the test made itself;
 * - the assertions are on `readDoc()` and on the bytes in IndexedDB, never on a
 *   value the test carried in.
 */

/**
 * Playwright WebKit aborts the assets write transaction, so no session row ever lands
 * there and there is no durable copy to clear. The mirror itself is `localStorage`
 * and WebKit handles that fine — so the round trip is real on WebKit and only its
 * IndexedDB half is missing. Skipped for the same reason, and the same way, as
 * `journey.reload-loss.spec.ts`: a case that cannot run has to say so in the report
 * rather than pass vacuously.
 */
const NO_BLOB_STORAGE =
  'Playwright WebKit cannot store a Blob in IndexedDB (the assets write transaction aborts); the same write succeeds in Chromium'

/** Open the overflow menu and return its trigger, for the focus assertions. */
async function openMore(page: import('@playwright/test').Page) {
  const trigger = page.getByRole('button', { name: 'More options' })
  await trigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  return trigger
}

/**
 * One undoable edit, so the confirmation has something to count.
 *
 * A crop handle rather than an "Adjust" slider because the fixture reads the value
 * the keystroke produced, which is what proves the document actually changed before
 * the dialog's count is checked against anything.
 */
async function makeOneEdit(page: import('@playwright/test').Page): Promise<number> {
  const tab = page
    .getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'Crop', exact: true })
  await tab.click()
  const handle = page.getByRole('slider', { name: 'Crop se handle' })
  await expect(handle).toHaveAttribute('aria-valuenow', '100')
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  const percent = Number(await handle.getAttribute('aria-valuenow'))
  expect(percent).toBeLessThan(100)
  return percent
}

/**
 * Whether a session row exists, read without polling.
 *
 * `persistedDoc()` waits twenty seconds for a row and throws when none arrives,
 * which is the wrong shape for "the row must be gone": here the absence *is* the
 * assertion, and a twenty-second wait for it would make a passing test slow and a
 * failing one indistinguishable from a timeout.
 */
function storedRowExists(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(
    `(async () => {
      return await new Promise((resolve) => {
        const open = indexedDB.open('image-editor', 1)
        open.onerror = () => resolve(false)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains('sessions')) { db.close(); return resolve(false) }
          const request = db.transaction('sessions', 'readonly').objectStore('sessions').get('current')
          request.onsuccess = () => { const row = request.result; db.close(); resolve(Boolean(row)) }
          request.onerror = () => { db.close(); resolve(false) }
        }
      })
    })()`,
  )
}

/**
 * The asset ids the live store still holds pixels for, plus the document's source.
 *
 * Resolved out of the resource list for the same reason `readDoc` is: on a warm dev
 * server the bare `src/store/docStore.ts` specifier is a *different* URL from the
 * one the app loaded, and importing it builds a second, empty store. A test that
 * asserted on that would be asserting on nothing at all.
 */
function liveDocument(page: import('@playwright/test').Page): Promise<{
  sourceAssetId: string | null
  liveAssetIds: string[]
}> {
  // The app is served under a `base`, so the module path has to carry it: the same
  // join the fixture's own `appBase` does, or the import is a 404 that reads as an
  // empty store rather than as a wrong URL.
  const base = new URL(page.url()).pathname.slice(
    0,
    new URL(page.url()).pathname.lastIndexOf('/') + 1,
  )
  return page.evaluate(`(async () => {
    const bare = ${JSON.stringify(`${base}src/store/docStore.ts`)}
    const live = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.startsWith(bare))
    const mod = await import(live ?? bare)
    const store = mod.useDocStore.getState()
    return { sourceAssetId: store.present.source?.assetId ?? null, liveAssetIds: [...mod.liveAssetIds()] }
  })()`)
}

test.describe('starting a new image from the editor', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })
  test('every stop in the confirmation has a visible focus ring', async ({ page }) => {
    // `.confirmPanel` was `outline: none`, copied from `.helpPanel`. The help panel
    // can afford it — it has one control, so the first Tab lands on a button that
    // paints its own ring. The confirmation has three stops and the panel itself is
    // one of them (`focusTrap` puts it in the cycle so Tab wraps from the last
    // button back to the top), so a keyboard user could reach an element with no
    // indicator at all of where they were.
    //
    // Asserted on the computed style in a real browser rather than in jsdom: jsdom
    // resolves no CSS from a stylesheet, so a unit test on this would pass against a
    // rule that had been deleted.
    await makeOneEdit(page)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'New image' }).click()

    const panel = page.getByRole('dialog', { name: 'Start a new image?' })
    await expect(panel).toBeVisible()

    // Forward from Cancel: Commit → panel → Cancel. The panel is the third stop.
    await panel.getByRole('button', { name: 'Cancel' }).focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    const ringed = await panel.evaluate((node) => {
      const style = getComputedStyle(node)
      return {
        isFocused: node === document.activeElement,
        width: Number.parseFloat(style.outlineWidth),
        style: style.outlineStyle,
      }
    })
    expect(ringed.isFocused).toBe(true)
    expect(ringed.style).not.toBe('none')
    expect(ringed.width).toBeGreaterThan(0)
  })

  test('the row is in the overflow menu, where the other document actions are', async ({
    page,
    readDoc,
  }) => {
    const before = await readDoc()
    expect(before.source?.assetId).toBeTruthy()

    await openMore(page)
    const row = page.getByRole('menuitem', { name: 'New image' })
    await expect(row).toBeVisible()
    // Enabled on a document with nothing to lose, and its name says what it does.
    // `aria-disabled` is absent rather than "false" while it can be pressed: the
    // attribute is there for the state that needs saying.
    await expect(row).toBeEnabled()
    await expect(row).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('it asks before discarding edits, and Escape keeps the document', async ({
    page,
    readDoc,
  }) => {
    await makeOneEdit(page)
    const before = await readDoc()

    await openMore(page)
    await page.getByRole('menuitem', { name: 'New image' }).click()

    // A modal question, named by its heading, described by what it costs.
    const dialog = page.getByRole('dialog', { name: 'Start a new image?' })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('heading', { name: 'Start a new image?' })).toBeVisible()
    // The count is the number of undo steps, which a reader can check afterwards.
    await expect(dialog).toContainText('1 edit')
    // The safe control is the one that has focus, so Enter cannot throw the photo away.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    // The committing control names the action rather than saying "OK".
    await expect(dialog.getByRole('button', { name: 'Start new image' })).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    // Focus came back to the control that opened it, not to the top of the document.
    await expect(page.getByRole('button', { name: 'More options' })).toBeFocused()
    const after = await readDoc()
    expect(after.source?.assetId).toBe(before.source?.assetId)
    expect(after.geometry.crop.width).toBe(before.geometry.crop.width)
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
  })

  test('it replaces the document: a different source, the default layers, no history', async ({
    page,
    readDoc,
  }) => {
    await makeOneEdit(page)
    const before = await readDoc()

    await openMore(page)
    await page.getByRole('menuitem', { name: 'New image' }).click()
    await page
      .getByRole('dialog', { name: 'Start a new image?' })
      .getByRole('button', { name: 'Start new image' })
      .click()

    // The import screen is back, which is the whole point of the row.
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    await expect(page.locator('canvas.ie-canvas-el')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Editor tools' })).toHaveCount(0)

    await page.getByRole('button', { name: /^Sample 2\b/ }).click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()

    const after = await readDoc()
    expect(after.source?.assetId).not.toBe(before.source?.assetId)
    expect(after.source?.name).toBe('Sample 2')
    // A new document's state, not the previous one's with the source swapped.
    expect(after.geometry.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(after.layers).toEqual([])
    expect(after.adjust.exposure).toBe(0)
    // Only the new photograph's pixels are still held: the replaced one was
    // unreferenced the moment the history went, so it can be released.
    const live = await liveDocument(page)
    expect(live.liveAssetIds).toEqual([after.source?.assetId])
  })

  test('a document with nothing to lose is replaced without asking', async ({
    page,
    readDoc,
    persistedDoc,
  }) => {
    // The case that must not have a dialog: a confirmation in front of an action
    // that destroys nothing is the dialog that teaches people to press through
    // dialogs. The row waits for the autosave to land so the "nothing to lose"
    // claim is about a *saved* document, not one that has not written yet.
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)
    await expect.poll(async () => (await persistedDoc()).source?.assetId).toBeTruthy()
    await makeOneEdit(page)
    await page.getByRole('button', { name: 'Undo' }).click()
    const before = await readDoc()

    await openMore(page)
    await page.getByRole('menuitem', { name: 'New image' }).click()

    await expect(page.getByRole('dialog', { name: 'Start a new image?' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    // `readDoc()` cannot be the assertion here: it refuses a document with no source
    // on purpose, because a store that answers with an empty document is usually the
    // *wrong module*. So the live store is read directly, and the answer it must give
    // is "no photograph", not "a default document".
    expect((await liveDocument(page)).sourceAssetId).toBeNull()
    expect(before.source?.assetId).toBeTruthy()
  })

  test('it clears the stored row and the mirror, so a reload cannot resurrect it', async ({
    page,
    readDoc,
    persistedDoc,
  }) => {
    // IMP-006. The mirror alone was not enough: `resolveResumableSession` only
    // adopts a mirror when the row it shadows exists, so clearing one and keeping
    // the other left a reload offering the photograph that had just been replaced.
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)
    await expect.poll(async () => (await persistedDoc()).source?.assetId).toBeTruthy()
    await makeOneEdit(page)
    expect(await page.evaluate((key) => localStorage.getItem(key), MIRROR_KEY)).not.toBeNull()
    const replaced = (await readDoc()).source?.assetId
    expect(replaced).toBeTruthy()

    await openMore(page)
    await page.getByRole('menuitem', { name: 'New image' }).click()
    await page
      .getByRole('dialog', { name: 'Start a new image?' })
      .getByRole('button', { name: 'Start new image' })
      .click()
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()

    expect(await storedRowExists(page)).toBe(false)
    expect(await page.evaluate((key) => localStorage.getItem(key), MIRROR_KEY)).toBeNull()

    // And a real teardown, which is where the unmirrored transaction would have
    // died: what comes back is the import screen with nothing to resume.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0)
    await expect(page.locator('canvas.ie-canvas-el')).toHaveCount(0)
  })

  test('"Reset all edits" acts on one press, and Undo brings the edits back', async ({
    page,
    readDoc,
  }) => {
    // The first control that predates the dialog, and the one this convention has to
    // get right in the other direction. `docStore.reset` pushes an undo step of its
    // own, so `Ctrl+Z` returns the whole edit stack *and* the stack — it is the most
    // recoverable control in the app, and a dialog in front of it is the confirmation
    // people learn to press through. So: no dialog, the reset has happened, and one
    // Undo puts it all back.
    await makeOneEdit(page)
    const before = await readDoc()
    expect(before.geometry.crop.width).toBeLessThan(1)

    await openMore(page)
    await page.getByRole('menuitem', { name: 'Reset all edits' }).click()
    // No confirmation, named by the question it would have asked — not a blanket
    // `getByRole('dialog')`, because the open Crop tool panel is a dialog too and
    // this assertion is about the confirmation rather than about the panel.
    await expect(page.getByRole('dialog', { name: 'Reset all edits?' })).toHaveCount(0)

    const after = await readDoc()
    expect(after.geometry.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(after.adjust.exposure).toBe(0)
    // The canvas is still the photograph — a reset is not a replacement, which is
    // the difference between it and "New image" two rows up.
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()

    // One press, and the edit is back: the recovery the press relies on.
    await page.getByRole('button', { name: 'Undo' }).click()
    expect((await readDoc()).geometry.crop.width).toBe(before.geometry.crop.width)
  })

  test('"Delete preset" asks, and the body says there is no second copy', async ({ page }) => {
    await makeOneEdit(page)
    // Save a preset through the app's own controls, then delete it. "Presets" is a
    // `role="dialog"` and the only way in is the More menu's "Save preset…" row;
    // everything here is located by accessible name, never by a `styles.*` class.
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Save preset…' }).click()
    await page.getByLabel('Preset name').fill('Studio warm')
    await page.getByRole('button', { name: 'Save preset' }).click()
    // Saving closes the popover on purpose — `PresetPopover.tsx` documents why, and
    // the reason is a focus problem rather than a convenience one. So it is reopened
    // through the app's own control rather than by reaching into component state.
    await expect(page.getByRole('dialog', { name: 'Presets' })).toBeHidden()

    await openMore(page)
    await page.getByRole('menuitem', { name: 'Save preset…' }).click()
    await page.getByRole('button', { name: 'Delete Studio warm' }).click()

    const dialog = page.getByRole('dialog', { name: 'Delete “Studio warm”?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('no second copy')
    await expect(dialog.getByRole('button', { name: 'Delete preset' })).toBeVisible()
    // And it still exists, because nothing was answered yet.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Delete Studio warm' })).toBeVisible()
  })

  test('the new photograph is the one a reload offers, not the one it replaced', async ({
    page,
    readDoc,
    persistedDoc,
  }) => {
    // The other half of the same property. Clearing the old row is only half the
    // story: if the replacement never saves, the user has replaced their photo with
    // nothing at all.
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)
    await makeOneEdit(page)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'New image' }).click()
    await page
      .getByRole('dialog', { name: 'Start a new image?' })
      .getByRole('button', { name: 'Start new image' })
      .click()
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()

    await page.getByRole('button', { name: /^Sample 2\b/ }).click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
    const second = await readDoc()
    expect(second.source?.assetId).toBeTruthy()

    await expect
      .poll(async () => (await persistedDoc()).source?.assetId, { timeout: 20_000 })
      .toBe(second.source?.assetId)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
    await page.getByRole('button', { name: 'Resume' }).click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
    expect((await readDoc()).source?.assetId).toBe(second.source?.assetId)
  })
})
