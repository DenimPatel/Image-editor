import { test, expect } from './fixtures'

/**
 * IMP-005 — a door into the editor means what it says, and it never shows a
 * photograph nobody asked for.
 *
 * `useDocStore` is a module singleton, which is the right design for "there is one
 * document, and it is undoable" and the wrong one for "this page was reached by
 * pressing a button that said something". The Hub's eight doors and the nav's "Open
 * Editor" all reopened whatever the singleton happened to hold, and the crash screen's
 * "Start over" reopened it too — so the button that promises to delete your photo and
 * edits landed on the same broken document and put the error back on top of itself.
 *
 * The properties, in the order a user meets them:
 *
 * - two entries into the editor in one session open the photograph each of them
 *   left behind, and after a replacement the second is a *different* one rather
 *   than the first again;
 * - a door that names a tool opens that tool, and keeps the photograph it
 *   inherited rather than substituting one;
 * - a document whose pixels the store cannot produce is an explicit error naming
 *   the asset, never a different photograph;
 * - and "Start over" really starts over, after asking.
 */

/**
 * One undoable edit, so the replacement has something to ask about.
 *
 * The journey this file is about is the one a person takes *after* they have started
 * editing, not after they have just opened a stock image — so the document here
 * carries an edit when it is asked to be replaced.
 */
async function editOnce(page: import('@playwright/test').Page): Promise<void> {
  const tab = page
    .getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name: 'Crop', exact: true })
  await tab.click()
  const handle = page.getByRole('slider', { name: 'Crop se handle' })
  await handle.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(handle).not.toHaveAttribute('aria-valuenow', '100')
}

/**
 * Point the live document at an asset that was never put in the store, through the
 * store's own `load`.
 *
 * Written that way rather than into the DOM so it goes down the same path a
 * photograph does, and written through the *live* module URL for the reason
 * `readDoc` does: a bare `src/store/docStore.ts` on a warm dev server is a different
 * URL from the one the app loaded, and importing it builds a second, empty store —
 * which would answer `true` while the page kept painting the real photograph.
 *
 * The asset id is the one the editor's own error names, so this reaches the
 * documented failure rather than inventing one: a session row whose bytes a browser
 * evicted from the origin, which is a state a real user arrives in.
 */
function pointAtMissingAsset(
  page: import('@playwright/test').Page,
  assetId: string,
): Promise<void> {
  const path = new URL(page.url()).pathname
  const base = path.slice(0, path.lastIndexOf('/') + 1)
  return page.evaluate(`(async () => {
    const bare = ${JSON.stringify(`${base}src/store/docStore.ts`)}
    const live = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.startsWith(bare))
    const mod = await import(live ?? bare)
    const store = mod.useDocStore.getState()
    store.load({ ...store.present, source: { ...store.present.source, assetId: ${JSON.stringify(assetId)} } })
  })()`)
}

test.describe('the editor from the Hub', () => {
  test('two editor entries in one session: the second photograph is the one reopened', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    readDoc,
    settle,
  }) => {
    // What this case actually proves, stated so a reader can check the claims
    // against the assertions: the editor's document is a module singleton, so
    // *reaching the editor again* must not hand back whatever the singleton held
    // since the page loaded. The sequence is two entries into `/editor` and a
    // replacement in between, which is the only way to tell "reopened what it
    // should" from "never left, so it happened to be right".
    //
    // Note what is *not* claimed: that two Hub cards open two different
    // photographs. No Hub door names a photograph at all — each names a tool — so
    // the second source here comes from the import screen after "New image", not
    // from a door. An earlier title said otherwise and the e2e run could not
    // distinguish the two stories, which is what makes it worth naming precisely.
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()

    // First Hub entry, then a second one — with a replacement in between, because
    // that is the round trip the owner asked for: open the editor, go back, pick a
    // different stock image.
    const first = await readDoc()
    expect(first.source?.assetId).toBeTruthy()
    await editOnce(page)

    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'New image' }).click()
    await page
      .getByRole('dialog', { name: 'Start a new image?' })
      .getByRole('button', { name: 'Start new image' })
      .click()
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    await page.getByRole('button', { name: /^Sample 2\b/ }).click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
    const second = await readDoc()
    expect(second.source?.assetId).not.toBe(first.source?.assetId)
    expect(second.source?.name).toBe('Sample 2')

    // Back to the Hub, then in again through the front door.
    await page.getByRole('button', { name: 'Close editor' }).click()
    await expect(page.getByRole('link', { name: 'Start editing' })).toBeVisible()
    await page.getByRole('link', { name: 'Start editing' }).click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()

    // The document the editor actually holds, read out of the running app. It is the
    // second one, because that is the one in memory — and the point of the assertion
    // is that the singleton was told what the last door meant rather than answering
    // from whatever it had held since the page loaded.
    const reopened = await readDoc()
    expect(reopened.source?.assetId).toBe(second.source?.assetId)
  })

  test('a door that names a tool opens that tool, and keeps the photograph', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    readDoc,
    settle,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
    const held = await readDoc()

    await page.getByRole('button', { name: 'Close editor' }).click()
    await page
      .getByRole('link', { name: /Adjust/ })
      .first()
      .click()

    await expect(page.getByRole('dialog', { name: 'Adjust' })).toBeVisible()
    const tab = page
      .getByRole('navigation', { name: 'Editor tools' })
      .getByRole('button', { name: 'Adjust', exact: true })
    await expect(tab).toHaveAttribute('aria-current', 'true')
    // The tool is not the photograph: the document the door inherited is the one the
    // user had open, and swapping it for something else would be the silent
    // substitution this item is about.
    expect((await readDoc()).source?.assetId).toBe(held.source?.assetId)
  })

  test('a source the store cannot produce is an explicit error, not another photo', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    readDoc,
    settle,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
    const held = await readDoc()

    await pointAtMissingAsset(page, 'asset_vanished')

    // The error names the asset, so a report can be matched to a session, and the
    // photograph that *was* on screen is not still on it.
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('asset_vanished')
    await expect(page.locator('canvas.ie-canvas-el')).toHaveCount(0)
    expect(held.source?.assetId).toBeTruthy()
  })

  test('Start over reaches the editor instead of the error screen it came from', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    settle,
  }) => {
    // The loop this closes. Clearing the *stored* session was never enough on its own,
    // because the document is also in a module singleton that outlives the route:
    // navigating straight back into `/editor` remounted the page on the same document,
    // the render raised for the same reason, and the button that says "deletes your
    // photo and edits" put the error screen back on top of itself.
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()

    await pointAtMissingAsset(page, 'asset_vanished')
    await expect(page.locator('[role="alert"]')).toBeVisible()

    await page.getByRole('button', { name: /^Start over/ }).click()

    // It asks first. This is the one control in the app that deletes a stored
    // photograph *and* its edits in a single press, and the crash screen is exactly
    // where someone reaches for a button without reading it. `RouteError` mounts its
    // own `ConfirmDialog` because it renders *instead of* the editor, so the
    // primitive has a host here — without it the button would silently resolve
    // `false` and do nothing, which is the case this assertion exists to rule out.
    const dialog = page.getByRole('dialog', { name: 'Start over?' })
    await expect(dialog).toBeVisible()
    // Focus starts on the safe control.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()

    // Escape keeps the crash screen and the stored document, which is the case that
    // would go unnoticed if the button only worked when pressed twice.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: /^Start over/ })).toBeVisible()

    await page.getByRole('button', { name: /^Start over/ }).click()
    await dialog.getByRole('button', { name: 'Start over' }).click()

    // The import screen, once. Not the error screen, and not a canvas painting a
    // document whose pixels do not exist.
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    await expect(page.locator('[role="alert"]')).toHaveCount(0)
    await expect(page.locator('canvas.ie-canvas-el')).toHaveCount(0)
  })
})
