import type { Locator } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Break the export path the way a struggling device does: it will run the
 * render, but the detached full-resolution canvas it draws into never hands
 * back a readable surface. The 256px graph canvas is in the document, so the
 * graph itself stays paintable — which is the whole point of the degradation.
 *
 * `getContext` is *saved* rather than deleted afterwards, so the engine's own
 * method is restored instead of an own property being removed that may never
 * have been one.
 */
const BROKEN_CANVAS = `(() => {
  const proto = HTMLCanvasElement.prototype
  if (typeof window.__realGetContext !== 'function') {
    window.__realGetContext = proto.getContext
    proto.getContext = function patched(type, ...rest) {
      if (type === '2d' && !this.isConnected) return null
      return window.__realGetContext.call(this, type, ...rest)
    }
  }
})()`

const RESTORED_CANVAS = `(() => {
  const proto = HTMLCanvasElement.prototype
  if (typeof window.__realGetContext === 'function') {
    proto.getContext = window.__realGetContext
    delete window.__realGetContext
  }
})()`

/**
 * The two silent failures, and the strings that are load-bearing.
 *
 * Both of these panels used to fail *quietly*, which in an editor that markets
 * itself as honest is worse than crashing: a blank histogram box and a
 * vanishing file size both read as "this panel is broken" rather than "this
 * device could not do this one thing". The assertions below are about the
 * degradation, not about the happy path — the happy path was already covered,
 * and it is the failure path that had no coverage at all.
 *
 * Everything is located by accessible name or role. There is no CSS-module
 * selector in this file, and no value copied out of the app: the readout is read
 * off the live panel text.
 */
test.describe('the histogram never leaves a blank box with no explanation', () => {
  test.beforeEach(async ({ goto, loadSample }) => {
    await goto('/editor')
    await loadSample('Sample 1')
  })

  test('draws a graph and says nothing when it works', async ({ openTool, panel }) => {
    await openTool('Adjust')
    const sheet = panel('Adjust')
    // The canvas is `aria-hidden`, so the *absence* of a status line is the only
    // evidence a screen-reader user gets that nothing is wrong.
    await expect(sheet.locator('canvas')).toHaveCount(1)
    await expect(sheet.getByRole('status')).toHaveCount(0)
  })

  test('names the reason and disowns the stale graph when a pass fails', async ({
    page,
    openTool,
    panel,
  }) => {
    await openTool('Adjust')
    const sheet = panel('Adjust')
    // A good pass first, so the failure has a previous graph to disown — the
    // state that matters, because "the graph is out of date" is a different
    // sentence from "there is no graph" and only one of them is honest in each
    // situation.
    await expect(sheet.getByRole('status')).toHaveCount(0)
    await page.waitForTimeout(1500)

    // A device that will run the render but cannot hand back a readable surface
    // for the detached export canvas. The 256px graph canvas is in the document,
    // so the graph itself is still paintable — which is the point.
    await page.evaluate(BROKEN_CANVAS)

    const exposure = sheet.getByRole('slider').first()
    await exposure.focus()
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight')

    const status = sheet.getByRole('status')
    await expect(status).toBeVisible()
    await expect(status).toContainText('Histogram out of date')
    // The engine's own words, not an inference about the cause.
    await expect(status).toContainText('Canvas 2D unavailable for the export')
    await expect(status).toContainText('The graph above is from an earlier edit.')
    // And it must not quietly become an emergency.
    await expect(sheet.getByRole('alert')).toHaveCount(0)
  })

  test('says so the moment a pass succeeds again', async ({ page, openTool, panel }) => {
    await openTool('Adjust')
    const sheet = panel('Adjust')
    await page.waitForTimeout(1500)
    await page.evaluate(BROKEN_CANVAS)
    const exposure = sheet.getByRole('slider').first()
    await exposure.focus()
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight')
    await expect(sheet.getByRole('status')).toBeVisible()

    // Unbreak the device and touch the document again. The panel shows one
    // slider — the selected parameter's — so the same one moves, downwards.
    await page.evaluate(RESTORED_CANVAS)
    // The panel shows one slider — the selected parameter's — so the same one
    // moves, the other way, far enough not to be sitting on a clamp.
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft')
    await expect(sheet.getByRole('status')).toHaveCount(0)
  })
})

test.describe('the export size estimate never disappears without a reason', () => {
  test.beforeEach(async ({ goto, loadSample }) => {
    await goto('/editor')
    await loadSample('Sample 1')
  })

  /** The one line that carries the output size, read out of the live panel. */
  function readout(sheet: Locator) {
    return sheet.getByText(/^Output: /)
  }

  test('reports a size, and never claims it is estimating forever', async ({ openTool, panel }) => {
    await openTool('Export')
    const sheet = panel('Export')
    await expect(readout(sheet)).toContainText('· ~')
    await expect(sheet.getByRole('status')).toHaveCount(0)
  })

  test('keeps the dimensions and names the size unknown, instead of dropping the clause', async ({
    page,
    openTool,
    panel,
  }) => {
    await openTool('Export')
    const sheet = panel('Export')
    await expect(readout(sheet)).toContainText('· ~')

    // Break the full-resolution export canvas the estimate renders through.
    await page.evaluate(BROKEN_CANVAS)
    await sheet.getByRole('button', { name: 'PDF', exact: true }).click()

    // The size is now named rather than missing. A blank clause is the defect:
    // it is indistinguishable from "no size information applies here", which is a
    // different and wrong claim.
    await expect(readout(sheet)).toContainText('size unknown')
    await expect(readout(sheet)).toContainText('300 DPI')

    const status = sheet.getByRole('status')
    await expect(status).toContainText('The size estimate failed')
    await expect(status).toContainText('Canvas 2D unavailable for the export')
    // The load-bearing sentence: the estimate and the download are the same
    // encode, so promising the download is fine would be a new lie.
    await expect(status).toContainText('Downloading runs the same encode')
    await expect(status).not.toContainText('still works')
  })

  test('keeps the previous figure while a new one is computed, rather than flashing blank', async ({
    openTool,
    panel,
  }) => {
    await openTool('Export')
    const sheet = panel('Export')
    const line = readout(sheet)
    await expect(line).toContainText('· ~')
    const before = await line.innerText()

    await sheet.getByRole('button', { name: 'PNG', exact: true }).click()
    // The debounce is 350 ms; the moment after the click is the window in which
    // the old code rendered `''` for the size.
    await expect(line).toContainText('estimating…')
    await expect(line).toContainText('· ~', { timeout: 30_000 })
    expect(await line.innerText()).not.toBe(before)
  })
})

test.describe('the tool bar and the sheets it opens say the same thing', () => {
  test.beforeEach(async ({ goto, loadSample }) => {
    await goto('/editor')
    await loadSample('Sample 1')
  })

  test('no tab is an abbreviation of the panel it opens', async ({ page }) => {
    // "BG" was the only abbreviation in the product, and the sheet it opened was
    // called "Background" — one surface, two names, and the shorter one was the
    // one a user had to remember.
    const tabs = page.getByRole('navigation', { name: 'Editor tools' })
    const labels = await tabs.getByRole('button').allTextContents()
    expect(labels).toEqual([
      'Crop',
      'Adjust',
      'Looks',
      'Retouch',
      'Background',
      'Text',
      'Draw',
      'Stickers',
      'Redact',
      'Frame',
      'Layers',
      'Passport',
      'Export',
    ])
  })

  test('every tab opens a sheet that names itself, and none is left out', async ({
    page,
    openTool,
  }) => {
    const names = [
      'Crop',
      'Adjust',
      'Looks',
      'Retouch',
      'Background',
      'Text',
      'Draw',
      'Stickers',
      'Redact',
      'Frame',
      'Layers',
      'Passport',
      'Export',
    ] as const
    for (const name of names) {
      await openTool(name)
      const sheet = page.getByRole('dialog')
      await expect(sheet, name).toBeVisible()
      // One name, one string: the tab's own word, with the single documented
      // exception of Crop, whose panel really does ship a straighten dial.
      const expected = name === 'Crop' ? 'Crop & Straighten' : name
      await expect(sheet, name).toHaveAttribute('aria-label', expected)
      await page.keyboard.press('Escape')
    }
  })

  test('the tab that used to admit it had no panel now has one', async ({ openTool, panel }) => {
    // This used to assert the opposite, and pin it: Retouch's sheet carried a
    // named "Retouch is not built yet" region, and a test held the placeholder in
    // place. True in both halves, and still a tab that did nothing. So the sheet
    // is now checked the other way round — controls, no placeholder copy, and the
    // empties it does have are inert named regions.
    await openTool('Retouch')
    const sheet = panel('Retouch')
    await expect(sheet.getByText('Retouch is not built yet')).toHaveCount(0)
    await expect(sheet.getByText(/placeholder/i)).toHaveCount(0)
    await expect(sheet.getByRole('group', { name: 'No heal spots' })).toBeVisible()
    // An empty state is not an alert, and it must not steal focus.
    await expect(sheet.getByRole('alert')).toHaveCount(0)
    await expect(sheet.getByRole('status')).toHaveCount(0)
    // The three things the old paragraph said could not be reached, reached.
    await expect(sheet.getByRole('slider', { name: /^Smoothing/ })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^Add heal spot$/ })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^Red-eye$/ })).toBeVisible()
  })
})
