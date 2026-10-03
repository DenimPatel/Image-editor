import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { ToolName } from './fixtures'

/**
 * The desktop shell is a two-column app: a full-width top bar, the canvas beside
 * an inspector, and a full-width tool tab bar.
 *
 * This spec exists because for a while it was not. `BottomSheet` was
 * `position: fixed` with `top: 0; bottom: 0` at every width, so with any tool
 * open it covered the top bar's right-hand buttons and the right-hand tool tabs
 * — More options / Done were unreachable, and Export rendered as "Ex". Two
 * independent agents hit the same thing as `sheet intercepts pointer events`,
 * which is how a dozen e2e specs went red before anybody looked at a
 * screenshot.
 *
 * So every assertion here is a measurement of where a thing actually is and
 * what is actually on top of it: bounding boxes, `document.elementFromPoint`,
 * and `scrollTop`. Nothing here can be satisfied by a layout that is broken in
 * a way a user would call broken — a panel that is 360px wide, sits between the
 * bars, and never covers them.
 */

/** Every tool the tab bar offers. All thirteen, because thirteen is the answer. */
const TOOLS: ToolName[] = [
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
]

/**
 * What a person gets when they click the middle of this control: the topmost
 * element at that point, and whether it is this control or something it
 * contains. A control that is merely *visible* can still be dead under an
 * overlay, and `toBeVisible` says nothing about that — this is the assertion
 * that would have caught the fixed sheet.
 */
async function hitsAtItsOwnCentre(target: Locator): Promise<boolean> {
  return target.evaluate((node: HTMLElement) => {
    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return false
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return hit !== null && (hit === node || node.contains(hit))
  })
}

/** On screen, and wholly inside the viewport — not scrolled off, not clipped. */
async function expectFullyOnScreen(target: Locator, viewport: { width: number; height: number }) {
  const box = await target.boundingBox()
  expect(box, 'the control has no box at all').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
  expect(await hitsAtItsOwnCentre(target), 'the control is covered, not clickable').toBe(true)
}

const toolTab = (page: Page, name: ToolName) =>
  page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', { name, exact: true })

/**
 * The scrollable body of whatever panel is open, found by its computed overflow
 * rather than by a CSS-module class — same reasoning as `journey.mobile.spec.ts`:
 * a class name says nothing about whether the thing scrolls.
 */
function panelScroller(page: Page) {
  return page
    .locator('section[role="dialog"]')
    .first()
    .locator('xpath=*')
    .evaluateAll((nodes: Element[]) => {
      const scroller = nodes.find((node) => {
        const style = getComputedStyle(node)
        return (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight
        )
      })
      if (!scroller) return null
      scroller.setAttribute('data-e2e-scroller', '')
      return scroller.scrollTop
    })
}

/** Has focus left whatever dialog contains it? */
function focusIsOutsideAnyDialog(page: Page) {
  return page.evaluate(() => !document.activeElement?.closest('[role="dialog"]'))
}

/**
 * Focus the first and last tab stop inside the panel and mark them.
 *
 * The trap and the absence of a trap are both claims about the two *ends* of the
 * list, so those are the two elements the assertions need. Counting presses
 * instead would be measuring the length of the panel, and WebKit's own Tab
 * behaviour on a focus wrap is not something this suite should be asserting.
 */
async function markPanelEnds(panel: Locator, focus: 'first' | 'last') {
  await panel.evaluate((node: HTMLElement, which: 'first' | 'last') => {
    const stops = Array.from(
      node.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (candidate) => !candidate.hasAttribute('disabled') && candidate.getClientRects().length,
    )
    if (stops.length < 2) throw new Error('the panel has fewer than two tab stops')
    const target = which === 'first' ? stops[0] : stops[stops.length - 1]
    stops[0].setAttribute('data-e2e-first-stop', '')
    stops[stops.length - 1].setAttribute('data-e2e-last-stop', '')
    target.focus()
  }, focus)
}

for (const width of [1280, 1000]) {
  test.describe(`at ${width}x900, with a tool open`, () => {
    test.slow()

    test('the top bar and all thirteen tool tabs stay reachable, one tool at a time', async ({
      page,
      goto,
      loadSample,
      openTool,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await goto('/editor')
      await loadSample('Sample 1')

      const viewport = page.viewportSize()!
      const topBar = page.getByRole('banner')
      await expect(topBar).toBeVisible()

      for (const tool of TOOLS) {
        await openTool(tool)
        const where = `${tool} at ${width}px`

        // The bars themselves are still where they were.
        await expectFullyOnScreen(topBar, viewport)
        await expectFullyOnScreen(page.getByRole('navigation', { name: 'Editor tools' }), viewport)

        // Every control in the top bar is clickable, not merely painted. These
        // are the ones the fixed sheet used to sit on top of: More options and
        // Done are on the right, Undo and Redo survived only by accident.
        const barButtons = topBar.getByRole('button')
        expect(await barButtons.count(), `${where}: top bar buttons`).toBeGreaterThan(0)
        for (const name of ['Close editor', 'Undo', 'Redo', 'More options', 'Done']) {
          const button = topBar.getByRole('button', { name })
          await expect(button, `${where}: ${name} exists`).toBeVisible()
          await expectFullyOnScreen(button, viewport)
        }

        // And all thirteen tabs, hit-tested at their own centres. `toBeVisible`
        // passes for a tab painted under a sheet; `elementFromPoint` does not.
        const tabs = page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button')
        expect(await tabs.count(), `${where}: tool tabs`).toBe(TOOLS.length)
        for (const name of TOOLS) {
          const tab = toolTab(page, name)
          await expectFullyOnScreen(tab, viewport)
        }
      }

      await page.screenshot({ path: `.playwright-mcp/e2e-inspector-${width}.png` })
    })
  })
}

test.describe('the desktop inspector is a panel, not a modal', () => {
  test('Tab leaves it, and Shift-Tab leaves it the other way', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    const panel = await openTool('Adjust')

    await expect(panel).not.toHaveAttribute('aria-modal', 'true')

    // Forwards. A trap holds focus for ever, so a bounded walk that
    // comes out is the claim, and it has to come out in *some* direction: the
    // canvas before the panel and the tool tab bar after it are both outside it.
    await panel.getByRole('button', { name: 'Auto' }).focus()
    let escapedForwards = false
    for (let i = 0; i < 40 && !escapedForwards; i += 1) {
      await page.keyboard.press('Tab')
      escapedForwards = await focusIsOutsideAnyDialog(page)
    }
    expect(escapedForwards, 'Tab never left the inspector').toBe(true)

    // Backwards, from the panel's own first control: Shift-Tab has to reach the
    // canvas rather than wrapping round to the panel's last control.
    await panel.getByRole('button', { name: 'Close' }).focus()
    await page.keyboard.press('Shift+Tab')
    expect(await focusIsOutsideAnyDialog(page), 'Shift-Tab wrapped inside the panel').toBe(true)
  })

  test('there is no backdrop to click off, because nothing is modal', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Adjust')
    // The backdrop is what makes a sheet modal. It is `position: fixed; inset: 0`
    // whenever it exists, so "no element with that behaviour is on screen" is
    // the assertion — not "a class is absent".
    const backdrop = await page.evaluate(() =>
      Array.from(document.querySelectorAll('body *')).some((node) => {
        const style = getComputedStyle(node)
        return (
          style.position === 'fixed' && style.inset === '0px' && node.hasAttribute('aria-hidden')
        )
      }),
    )
    expect(backdrop).toBe(false)
  })
})

test.describe('below the breakpoint the same component is still a modal sheet', () => {
  test('it is aria-modal and it holds Tab', async ({ page, goto, loadSample, openTool }) => {
    // The phone-sized half of the contract, measured in a desktop project: what
    // is under test is the presentation branch, which `matchMedia` picks, and
    // that branch does not need a touch stack. `journey.mobile.spec.ts` proves
    // the same thing on a real phone with a real finger.
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample('Sample 1')
    const panel = await openTool('Crop')

    await expect(panel).toHaveAttribute('aria-modal', 'true')

    // The trap, stated as the two ends meeting: Tab from the last stop lands on
    // the first, and Shift-Tab from the first lands back on the last. Nothing
    // outside the sheet is ever reached, which is the promise `aria-modal`
    // makes, and it is a claim about two presses rather than about how many
    // controls the panel happens to have.
    await markPanelEnds(panel, 'last')
    await page.keyboard.press('Tab')
    await expect(page.locator('[data-e2e-first-stop]')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('[data-e2e-last-stop]')).toBeFocused()
  })

  test('the detent grabber is still the phone affordance', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    // Found by what it does, not by its class: a grabber is the panel's own
    // first child, spans its full width, and sits at the top of it.
    const grabber = await page.evaluate(() => {
      const sheet = document.querySelector('section[role="dialog"]')
      const first = sheet?.firstElementChild
      if (!sheet || !first) return null
      const box = first.getBoundingClientRect()
      const sheetBox = sheet.getBoundingClientRect()
      return {
        width: Math.round(box.width),
        sheetWidth: Math.round(sheetBox.width),
        height: Math.round(box.height),
        top: Math.round(box.y - sheetBox.y),
      }
    })
    expect(grabber).not.toBeNull()
    expect(grabber!.width).toBe(grabber!.sheetWidth)
    expect(grabber!.height).toBeGreaterThan(8)
    expect(grabber!.top).toBeLessThanOrEqual(1)
  })
})

test.describe('the inspector scrolls itself, and the page does not scroll at all', () => {
  test('at 1280x600 with the passport checklist open', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    // 600px tall is the shortest desktop window worth supporting, and the
    // passport panel is the tallest content in the app, so this is the case
    // where "the column is exactly as tall as the space between the bars" has
    // to mean "the column scrolls" rather than "the page grows a scrollbar".
    // The sample is opened at a taller window first: the import screen is not
    // the thing under test and at 600px it cannot be scrolled to.
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    await page.setViewportSize({ width: 1280, height: 600 })
    await openTool('Passport')

    const sheet = page.getByRole('dialog')
    const sheetBox = (await sheet.boundingBox())!
    const tabBar = await page.getByRole('navigation', { name: 'Editor tools' }).boundingBox()
    const topBar = await page.getByRole('banner').boundingBox()
    // It fits between the bars and nowhere else.
    expect(sheetBox.y).toBeGreaterThanOrEqual(topBar!.y + topBar!.height - 1)
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(tabBar!.y + 1)

    // The page itself has nothing to scroll: `.editor` is a fixed, clipped
    // frame, and a second scrollbar on the document is the symptom that says
    // the panel is sized by its content instead of by the space it was given.
    const pageScroll = await page.evaluate(() => {
      const scroller = document.scrollingElement
      return {
        scrollHeight: scroller?.scrollHeight ?? 0,
        clientHeight: scroller?.clientHeight ?? 0,
        scrollTop: scroller?.scrollTop ?? 0,
      }
    })
    expect(pageScroll.scrollHeight).toBe(pageScroll.clientHeight)

    // And the panel scrolls on its own, to its own end.
    await panelScroller(page)
    const scroller = page.locator('[data-e2e-scroller]')
    await expect(scroller).toHaveCount(1)
    const metrics = await scroller.evaluate((node: HTMLElement) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }))
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight + 40)

    await scroller.evaluate((node: HTMLElement) => {
      node.scrollTop = node.scrollHeight
    })
    expect(await scroller.evaluate((node: HTMLElement) => node.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop ?? -1)).toBe(0)

    // The bars have not moved a pixel while the body scrolled under them.
    expect((await page.getByRole('navigation', { name: 'Editor tools' }).boundingBox())!.y).toBe(
      tabBar!.y,
    )
    await page.screenshot({ path: '.playwright-mcp/e2e-inspector-scrolled-1280x600.png' })
  })
})
