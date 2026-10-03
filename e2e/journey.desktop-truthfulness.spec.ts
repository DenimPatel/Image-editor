import { expect, test } from './fixtures'

/**
 * D13-F01..F08: the desktop journey, walked for truth rather than for presence.
 *
 * Every other file in this suite asks whether a control *works*. This one asks
 * the questions that a green click cannot answer on its own:
 *
 *  - is the state a user is in **shown** anywhere, or only announced to a screen
 *    reader / held in `aria-busy`?
 *  - do the words on screen **agree with each other** — a green "pass" beside a
 *    grey "Not measured", a chip lit while the copy says nothing is chosen?
 *  - is every control **reachable twice**, or does adding one layer make the way
 *    to add a second one disappear?
 *  - does a box that claims to be a dialog behave like one?
 *
 * The layout claims are here and not in jsdom because jsdom reports
 * `scrollWidth === clientWidth === 0` for every element: only a real browser can
 * say whether a layer row wraps or a popover is 713 px wide.
 */

/* ------------------------------------------------------------------ *
 * The pending state has to be visible, not merely announced
 * ------------------------------------------------------------------ */

test.describe('the import screen shows that it is opening something', () => {
  test('says "Opening image…" inside the viewport while the decode runs', async ({
    page,
    goto,
    clearStorage,
  }) => {
    await goto('/editor')
    await clearStorage()

    // The decode of a 6-megapixel JPEG through `createImageBitmap` is tens of
    // milliseconds — fast enough that a screenshot taken "after the click"
    // usually shows the finished editor, which is how a pending state that was
    // never painted went unnoticed. The network is held instead, so the state is
    // on screen while the assertion runs.
    await page.route('**/sample-images/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000))
      await route.continue()
    })

    await page.getByRole('button', { name: /^Sample 2\b/ }).click()

    const status = page.getByText('Opening image…')
    await expect(status).toBeVisible()

    // "Visible" only means laid out and not `visibility: hidden`. The sentence
    // used to render as a sibling of `<main>`, below an import screen that filled
    // the viewport with nothing to scroll, so it was laid out and never painted.
    // The box has to be inside the window, not merely in the document.
    const box = await status.boundingBox()
    const size = page.viewportSize()
    expect(box, 'the pending sentence has a box').not.toBeNull()
    expect(size).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(size!.height)

    // And it is the same element a screen reader is told about, not a second
    // copy of the sentence somewhere else.
    await expect(page.getByRole('status').filter({ hasText: 'Opening image…' })).toHaveCount(1)

    await page.unroute('**/sample-images/**')
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible()
  })

  test('the HEIC note sits with the format list, not below the sample tiles', async ({
    page,
    goto,
  }) => {
    await goto('/editor')
    const zone = page.getByRole('button', { name: /Drop an image here/ })
    const zoneBox = await zone.boundingBox()
    const heic = page.getByText(/HEIC\/HEIF/)
    await expect(heic).toBeVisible()
    // The note is the exception to the list of accepted formats, so it has to be
    // inside the same box that lists them. It used to be the last paragraph on
    // the screen, under the sample tiles and the attribution.
    const heicBox = await heic.boundingBox()
    expect(heicBox!.y).toBeGreaterThanOrEqual(zoneBox!.y)
    expect(heicBox!.y + heicBox!.height).toBeLessThanOrEqual(zoneBox!.y + zoneBox!.height)
  })

  test('the sample captions describe the photo, not the test suite', async ({ page, goto }) => {
    await goto('/editor')
    for (const label of ['Sample 1', 'Sample 2', 'Sample 3']) {
      const tile = page.getByRole('button', { name: new RegExp(`^${label}\\b`) })
      await expect(tile).not.toContainText(/\btest\b/i)
    }
  })

  test('the lede does not promise a tool that is not built', async ({ page, goto }) => {
    await goto('/editor')
    // Retouch is one of the thirteen tabs. Its panel used to say nothing there
    // changed the photo, and the lede listed it anyway; the panel now writes the
    // document, so this is no longer the trap it was — but a lede is a list of
    // what the editor does, and this one is not the place a tool gets announced,
    // so the assertion stands on its own rather than on Retouch's state.
    const lede = page.locator('p').filter({ hasText: 'A photo editor that runs in your browser' })
    await expect(lede).toHaveCount(1)
    await expect(lede).not.toContainText(/retouch/i)
  })
})

/* ------------------------------------------------------------------ *
 * "Save preset" opened something that was not a dialog
 * ------------------------------------------------------------------ */

test.describe('the preset list is a dialog', () => {
  test.beforeEach(async ({ page, goto, loadSample, clearStorage }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample()
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Save preset…' }).click()
  })

  test('is a surface on screen, not a bare input over the canvas', async ({ page, canvas }) => {
    const dialog = page.getByRole('dialog', { name: 'Presets' })
    await expect(dialog).toBeVisible()

    // It was a div whose `className` resolved to `undefined` (`.moreMenu` is not
    // a class in the editor's stylesheet), so the dialog rendered with no styles
    // at all: a raw input across the full width of the page at the top-left
    // corner, painted over the canvas. The tell is that the dialog was *wider
    // than the popover it is* and reached past the editor's own chrome.
    const box = await dialog.boundingBox()
    const size = page.viewportSize()
    expect(box!.width).toBeLessThan(size!.width / 2)
    expect(box!.width).toBeGreaterThan(200)
    expect(box!.x).toBeGreaterThan(size!.width / 2)

    // It has to be a filled, bordered surface rather than a transparent box:
    // the one thing the old markup could not have, because it had no classes.
    const fill = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(fill).not.toBe('rgba(0, 0, 0, 0)')
    const border = await dialog.evaluate((el) => getComputedStyle(el).borderTopWidth)
    expect(Number.parseFloat(border)).toBeGreaterThan(0)

    // And it does not cover the canvas it belongs to.
    const canvasBox = await canvas().boundingBox()
    expect(box!.x).toBeGreaterThan(canvasBox!.x)
  })

  test('can be left with Escape, with a press outside it, and from the keyboard alone', async ({
    page,
  }) => {
    const dialog = page.getByRole('dialog', { name: 'Presets' })
    // Arriving with the caret in the field is what makes this usable without a
    // mouse: the dialog exists to be typed into.
    await expect(page.getByRole('textbox', { name: 'Preset name' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Save preset…' }).click()
    await expect(dialog).toBeVisible()
    // A raw press outside it rather than a click on a locator: the popover hangs
    // over the canvas, and the canvas has a gesture layer over it that would
    // refuse the click for reasons of its own. What is under test is that *any*
    // press elsewhere dismisses.
    await page.mouse.click(400, 450)
    await expect(dialog).toHaveCount(0)
  })

  test('saves a named preset from the keyboard', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Preset name' }).fill('Warm film')
    await page.getByRole('textbox', { name: 'Preset name' }).press('Enter')
    await expect(page.getByRole('dialog', { name: 'Presets' })).toHaveCount(0)
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Save preset…' }).click()
    await expect(page.getByRole('button', { name: 'Warm film', exact: true })).toBeVisible()
  })
})

/* ------------------------------------------------------------------ *
 * Adding one text layer took the way to add a second one away
 * ------------------------------------------------------------------ */

test.describe('the Text panel is reachable from every state', () => {
  test.beforeEach(async ({ page, goto, loadSample, clearStorage, openTool }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample()
    await openTool('Text')
    await page.getByRole('button', { name: 'Add text', exact: true }).click()
    await page.getByRole('dialog', { name: 'Text' }).waitFor()
  })

  test('a second text layer can be added while the first is selected', async ({
    page,
    readDoc,
  }) => {
    const sheet = page.getByRole('dialog', { name: 'Text' })
    // The panel became the first layer's inspector: no "Add text", no "Add
    // watermark", no route back. The Layers panel has no add control either, so
    // one text layer was the most a document could ever hold.
    await expect(sheet.getByRole('button', { name: 'Add text', exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Add text', exact: true }).click()

    await expect
      .poll(async () => (await readDoc()).layers.filter((layer) => layer.kind === 'text').length)
      .toBe(2)
  })

  test('a watermark can be added while a text layer is selected', async ({ page, readDoc }) => {
    const sheet = page.getByRole('dialog', { name: 'Text' })
    await sheet.getByRole('button', { name: 'Add watermark' }).click()
    await expect
      .poll(
        async () => (await readDoc()).layers.filter((layer) => layer.kind === 'watermark').length,
      )
      .toBe(1)
    // And the panel is still the text list, so the text layer is still there.
    await expect(sheet.getByRole('button', { name: 'Add text', exact: true })).toBeVisible()
  })

  test('the size slider says how big the type is in pixels', async ({ page }) => {
    // "Size 8%" next to "Scale 100%" is two size controls and neither number
    // means anything alone: `style.size` is a percentage of the *shorter edge*.
    const hint = page.getByRole('dialog', { name: 'Text' }).getByText(/of the shorter edge/)
    await expect(hint).toBeVisible()
    await expect(hint).toContainText(/\d+ px of type/)
  })
})

/* ------------------------------------------------------------------ *
 * The layer rows
 * ------------------------------------------------------------------ */

test.describe('the Layers panel rows', () => {
  test('fit one line at 1280px, and keep the reorder pair on every row', async ({
    page,
    goto,
    loadSample,
    clearStorage,
    openTool,
    readDoc,
  }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample()

    await openTool('Draw')
    await page.getByRole('button', { name: 'New drawing layer' }).click()
    await openTool('Stickers')
    await page
      .getByRole('dialog', { name: 'Stickers' })
      .getByRole('button', { name: /^Star/ })
      .click()
    await openTool('Layers')

    const sheet = page.getByRole('dialog', { name: 'Layers' })
    await expect.poll(async () => (await readDoc()).layers.length).toBe(2)

    const rows = sheet.getByRole('button', { name: 'Move up' })
    const measured = await rows.evaluateAll((buttons) =>
      buttons.map((button) => {
        const row = button.parentElement as HTMLElement
        return {
          height: Math.round(row.getBoundingClientRect().height),
          // The selected row is the one that carries the rename control, so this
          // reads the row's own state instead of a stylesheet class.
          selected: row.querySelector('[aria-label="Rename layer"]') !== null,
        }
      }),
    )
    const unselected = measured.filter((row) => !row.selected)
    expect(unselected.length, 'some rows are not selected').toBeGreaterThan(0)
    // `.listItem` is `flex-wrap: wrap`, so a row whose children do not fit comes
    // out two lines tall — which is what every unselected row did: eye, name, up
    // and down on the first line and Delete orphaned on the second.
    for (const row of unselected) {
      expect(row.height, 'an unselected row is one line tall').toBeLessThan(70)
    }

    // Reorder is the reversible action and stays on every row; delete moved in
    // with the rest of the selected row's actions.
    await expect(sheet.getByRole('button', { name: 'Move up' })).toHaveCount(2)
    await expect(sheet.getByRole('button', { name: 'Move down' })).toHaveCount(2)
    await expect(sheet.getByRole('button', { name: 'Delete layer' })).toHaveCount(1)
    await expect(sheet.getByRole('button', { name: 'Rename layer' })).toHaveCount(1)
  })
})

/* ------------------------------------------------------------------ *
 * The passport checks
 * ------------------------------------------------------------------ */

test.describe('the passport checks do not grade what they did not measure', () => {
  test.beforeEach(async ({ goto, loadSample, clearStorage, openTool }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample()
    await openTool('Passport')
  })

  test('a rule that was not measured carries no pass or fail', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: 'Passport' })
    await sheet.locator('[class*="sheetBody"]').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await expect(sheet.getByText('Photo checks')).toBeVisible()

    // The head, eye-line and centring rules are read off the spec's own example
    // figure until a face measurement lands. They used to print a green `pass`
    // pill beside the grey "Not measured" badge — two labels disagreeing about
    // one line, one of them wearing the colour a reader trusts. `innerText`
    // lays a flex row out one box per line, so the pill, the name and the badge
    // are three consecutive lines and the check is "no status line within reach
    // of a 'Not measured'".
    const lines = (await sheet.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    expect(lines.filter((line) => line === 'Not measured').length).toBeGreaterThan(0)
    lines.forEach((line, index) => {
      if (!/^(pass|fail|warn)$/.test(line)) return
      expect(
        lines.slice(index, index + 3),
        `"${line}" is printed beside a rule that was not measured`,
      ).not.toContain('Not measured')
    })
  })

  test('every check is either graded or explicitly not measured', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: 'Passport' })
    const text = (await sheet.innerText()).replace(/\s+/g, ' ')
    const lines = (await sheet.innerText())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const total = Number((text.match(/of (\d+) checks/) ?? [])[1])
    expect(total, 'the verdict names the total').toBeGreaterThan(0)

    // The invariant that makes the verdict countable at all: of the eight rules,
    // each is either graded — one status pill — or says out loud that it was not
    // measured. Before, the three rules read off the spec's example figure
    // carried a `pass` pill *as well as* the badge, so pills + badges came to
    // eleven against a total of eight, and the verdict's "4 of 8 checks pass"
    // was arithmetically consistent with the screen and still false.
    const grades: number[] = []
    for (const status of ['pass', 'warn', 'fail']) {
      grades.push(await sheet.getByText(status, { exact: true }).count())
    }
    const graded = grades.reduce((sum, count) => sum + count, 0)
    const unmeasured = lines.filter((line) => line === 'Not measured').length
    expect(unmeasured, 'there is something it could not measure').toBeGreaterThan(0)
    expect(graded + unmeasured, 'every rule is graded or says it was not').toBe(total)
    expect(text).toMatch(/could not be measured/)
  })

  test('no document chip is lit while the panel says nothing is chosen', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: 'Passport' })
    await expect(sheet.getByText('Nothing chosen yet')).toBeVisible()
    // The checks fall back to the US passport so there is a spec to read
    // against, and that fallback used to light its chip — so the panel said
    // "Nothing chosen yet" under a highlighted "US passport". Scoped to the
    // document rows: the print-orientation and sheet controls are `aria-pressed`
    // too, and they *are* chosen.
    const documentChips = sheet.locator(
      '[aria-label="Passport photos"], [aria-label="Visa and card photos"], [aria-label="Other ID photos"]',
    )
    await expect(documentChips.locator('[aria-pressed="true"]')).toHaveCount(0)

    await sheet.getByRole('button', { name: /^UK passport/ }).click()
    await expect(sheet.getByRole('button', { name: /^UK passport/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(documentChips.locator('[aria-pressed="true"]')).toHaveCount(1)
  })
})
