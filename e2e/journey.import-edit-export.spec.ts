import { test, expect, readImageHeader } from './fixtures'

/** The bundled sample the import journey uses, from `src/lib/accept.ts`. */
const SAMPLE_FILE = 'pexels-cesar-o-neill-26650613-34630144.jpg'

/**
 * Playwright's WebKit build cannot store a `Blob` in IndexedDB: a 4 KB blob
 * fails the `assets` write transaction with a null error, so any session save
 * aborts. Verified directly, not inferred — the same probe succeeds in Chromium
 * on the same page. Everything else about persistence works in WebKit
 * (`saveSession` with no source returns `'ok'`, and `loadSession` reads back
 * fine), so the two tests below skip rather than fail.
 *
 * This is a limitation of the bundled WebKit build, not a claim about Safari;
 * `src/lib/persist/session.test.ts` runs against `fakeIndexedDb` and so never
 * exercised a real browser here.
 */
const NO_BLOB_STORAGE =
  'Playwright WebKit cannot store a Blob in IndexedDB (the assets write transaction aborts); the same write succeeds in Chromium'

/**
 * D9-F01 — the round trip every user takes: import, adjust, undo, redo, export.
 *
 * The export assertions read the *bytes*. A download that is merely non-empty
 * proves nothing: the interesting failures are "a JPEG extension containing PNG
 * bytes" and "the right format at the wrong dimensions", and only the header can
 * tell them apart from a success.
 */
test.describe('import → adjust → undo → redo → export', () => {
  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/editor')
    await clearStorage()
  })

  test('exports a real image whose dimensions come from the document', async ({
    page,
    loadSample,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    await loadSample('Sample 1')
    await settle()

    const imported = await readDoc()
    expect(imported.source).not.toBeNull()
    const sourceWidth = imported.source!.width
    const sourceHeight = imported.source!.height
    expect(sourceWidth).toBeGreaterThan(0)
    expect(sourceHeight).toBeGreaterThan(0)

    const panel = await openTool('Adjust')
    // PageUp on the dial is step * 10 = 0.1 EV, so three presses is 0.3 EV.
    const exposure = panel.getByRole('slider', { name: 'Exposure' })
    await exposure.focus()
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('PageUp')
    await settle()
    await expect(exposure).toHaveAttribute('aria-valuetext', '+0.3 EV')
    expect((await readDoc()).adjust.exposure).toBeCloseTo(0.3, 5)

    const exportPanel = await openTool('Export')
    const download = exportPanel.getByRole('button', { name: 'Download', exact: true })
    const { bytes, name } = await downloadFrom(download)

    const header = readImageHeader(bytes)
    expect(header.format).toBe('jpeg')
    // Default output is the source size: no crop, no resize, no passport spec.
    expect(header.width).toBe(sourceWidth)
    expect(header.height).toBe(sourceHeight)
    expect(name).toMatch(/\.jpe?g$/)
    expect(bytes.length).toBeGreaterThan(1024)

    // The canvas really repainted: the WebGL presentation surface is sized.
    const painted = await page
      .locator('canvas.ie-canvas-el')
      .evaluate((c) => (c as HTMLCanvasElement).width)
    expect(painted).toBeGreaterThan(0)
  })

  test('a PNG export is a PNG, whatever the file is named', async ({
    loadSample,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    await loadSample('Sample 1')
    await settle()
    const source = (await readDoc()).source!

    const panel = await openTool('Export')
    await panel.getByRole('button', { name: 'PNG', exact: true }).click()
    await settle()
    await expect(panel.getByRole('button', { name: 'PNG', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const { bytes, name } = await downloadFrom(
      panel.getByRole('button', { name: 'Download', exact: true }),
    )
    const header = readImageHeader(bytes)
    expect(header.format).toBe('png')
    expect(name).toMatch(/\.png$/)
    expect(header.width).toBe(source.width)
    expect(header.height).toBe(source.height)
  })

  test('undo reverts the adjustment and redo restores it', async ({
    page,
    loadSample,
    openTool,
    readDoc,
    settle,
  }) => {
    await loadSample('Sample 1')
    await settle()
    expect((await readDoc()).adjust.exposure).toBe(0)

    const panel = await openTool('Adjust')
    const exposure = panel.getByRole('slider', { name: 'Exposure' })
    await exposure.focus()
    // Each discrete key press is its own undo step (the dial brackets the span
    // between keydown and keyup), so three presses is three steps to unwind.
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('PageUp')
    await settle()
    expect((await readDoc()).adjust.exposure).toBeCloseTo(0.3, 5)

    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('ControlOrMeta+z')
      await settle()
    }
    expect((await readDoc()).adjust.exposure).toBe(0)

    // Redo replays the undone edits in order, not in reverse.
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await settle()
    expect((await readDoc()).adjust.exposure).toBeCloseTo(0.1, 5)

    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await settle()
    }
    expect((await readDoc()).adjust.exposure).toBeCloseTo(0.3, 5)
  })

  test('a stored session comes back after a reload', async ({
    page,
    loadSample,
    openTool,
    readDoc,
    settle,
  }) => {
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)

    await loadSample('Sample 1')
    await settle()
    const panel = await openTool('Adjust')
    // Warmth is not the pre-selected parameter, so select its ring first — that
    // is how a user reaches it.
    await panel.getByRole('button', { name: /^Warmth\b/ }).click()
    const warmth = panel.getByRole('slider', { name: 'Warmth' })
    await warmth.focus()
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('PageUp')
    await settle()
    expect((await readDoc()).adjust.warmth).toBe(40)

    // The row is written through the app's own `saveSession`, not through the
    // autosave scheduler, so this test is about the *read* half — "does a stored
    // session come back?" — and stays independent of when the debounced write
    // fires. The write half is the next test. The source bytes are re-fetched
    // from the same bundled sample, which is exactly the pair `saveSession`
    // checks: the stored `doc.source.assetId` has to match the bytes' id or the
    // write is refused as a mismatch.
    const written = await page.evaluate(
      `(async () => {
        const fromApp = (path) => new URL(path, new URL(document.baseURI, location.href)).href
        const session = await import(fromApp('src/lib/persist/session.ts'))
        const store = await import(fromApp('src/store/docStore.ts'))
        const doc = store.useDocStore.getState().present
        const base = new URL(document.baseURI, location.href)
        const blob = await fetch(new URL('sample-images/' + SOURCE_FILE, base)).then((r) => r.blob())
        return session.saveSession(doc, { assetId: doc.source.assetId, blob, mime: doc.source.mime }, null)
      })()`.replace('SOURCE_FILE', JSON.stringify(SAMPLE_FILE)),
    )
    expect(written).toBe('ok')

    await page.reload()
    const resume = page.getByRole('button', { name: 'Resume', exact: true })
    await expect(resume).toBeVisible()
    await resume.click()
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
    await settle()
    expect((await readDoc()).adjust.warmth).toBe(40)
  })

  test('the autosave lands the current document in IndexedDB', async ({
    page,
    loadSample,
    openTool,
    readDoc,
    persistedDoc,
    settle,
  }) => {
    // Both persistence tests are blocked on the same browser limitation: the
    // app's autosave stores the source *bytes* alongside the document, and that
    // Blob write is what WebKit rejects. See NO_BLOB_STORAGE.
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)

    await loadSample('Sample 1')
    await settle()
    const panel = await openTool('Adjust')
    await panel.getByRole('button', { name: /^Warmth\b/ }).click()
    const warmth = panel.getByRole('slider', { name: 'Warmth' })
    await warmth.focus()
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('PageUp')
    await settle()
    expect((await readDoc()).adjust.warmth).toBe(40)

    // Debounced by AUTOSAVE_DEBOUNCE_MS, and the row can predate the edit, so
    // poll the stored value rather than reading it once.
    await expect
      .poll(async () => (await persistedDoc()).adjust.warmth, { timeout: 20_000 })
      .toBe(40)
  })
})
