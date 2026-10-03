import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * D7 — the export sheet has to fit the column it is given.
 *
 * The export panel is the widest thing in the app: a format row, a size
 * selector, a quality slider, a multi-width list, a metadata section and an
 * estimate, side by side. It was laid out on the width it happened to be given
 * during development and shipped **690px of content into a 360px column** — the
 * panel scrolled sideways, and the controls past the fold (the multi-width
 * choices, the metadata policy) were reachable only by dragging a scrollbar
 * that has no visible affordance. On a phone that is most of the panel.
 *
 * ## Why no unit test could have caught this
 *
 * jsdom has no layout engine. It reports `scrollWidth === clientWidth === 0` for
 * every element, so an assertion of the form `expect(scroller.scrollWidth).toBe(
 * scroller.clientWidth)` passes on a panel that is 690px wide inside a 360px
 * one, and passes on a correct one, and distinguishes nothing. `ResizeObserver`
 * never fires. The only place the number exists is a real browser, which is what
 * this file is.
 *
 * So every assertion here is a measurement taken in the page: real
 * `getBoundingClientRect`, real `scrollWidth`/`clientWidth`, real `offsetWidth`,
 * on a real viewport that has actually been resized. Nothing is asserted about a
 * number copied into the test.
 */

/**
 * The width that matters.
 *
 * 360 is the narrowest column the editor ever puts a panel in, and it is the
 * width the defect was found at. The other widths in the loop are there so a
 * regression that only appears when there is *room* — a row that stops wrapping
 * once it has space, a control that is pinned to a fixed pixel offset — is
 * caught too, but this is the one that has to hold.
 */
const WIDTHS = [
  { width: 360, height: 780, label: 'the narrow column' },
  { width: 390, height: 844, label: 'a phone' },
  { width: 768, height: 900, label: 'a tablet in portrait' },
  { width: 1280, height: 900, label: 'the desktop shell' },
]

/** Tolerance for subpixel layout. One device pixel, not a layout budget. */
const EPSILON = 1

/**
 * The widest thing inside `root` that is not allowed to spill, with the reason
 * it is the widest.
 *
 * Deliberately *not* a class selector. The question this file asks is "does
 * anything stick out of the panel", and the answer has to keep being the answer
 * after someone renames a class, adds a wrapper or restyles a row.
 */
async function overflowing(
  page: Page,
  root: Locator,
  epsilon: number,
): Promise<{ tag: string; label: string; width: number; right: number }[]> {
  return root.evaluate((node, tolerance) => {
    const panel = node.getBoundingClientRect()
    const out: { tag: string; label: string; width: number; right: number }[] = []
    for (const child of Array.from(node.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(child)
      // A deliberately scrollable strip is allowed to be wider than its box: that
      // is what `overflow-x: auto` is for. What is not allowed is the *content*
      // of a row that was supposed to wrap overflowing the panel, so the check
      // is against the element that was given the panel's width.
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue
      if (style.position === 'absolute' || style.position === 'fixed') continue
      const box = child.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (box.right - panel.right > tolerance) {
        out.push({
          tag: child.tagName.toLowerCase(),
          label: (child.getAttribute('aria-label') ?? child.textContent ?? '').trim().slice(0, 60),
          width: Math.round(box.width),
          right: Math.round(box.right),
        })
      }
    }
    return out
  }, epsilon)
}

/** The scroller that holds the panel's rows, found by its computed overflow. */
function panelScroller(page: Page): Locator {
  return page.locator('[data-e2e-export-scroller]')
}

/**
 * Mark the panel's own vertical scroller.
 *
 * Found by computed overflow rather than by a CSS-module class, for the reason
 * every locator in this suite is by role or name: a class name says nothing
 * about whether the thing actually scrolls.
 */
async function markScroller(page: Page): Promise<void> {
  const found = await page
    .locator('section[role="dialog"]')
    .first()
    .locator('xpath=*')
    .evaluateAll((nodes: Element[]) => {
      for (const node of nodes) {
        const style = getComputedStyle(node)
        if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
        node.setAttribute('data-e2e-export-scroller', '')
        return true
      }
      return false
    })
  expect(found, 'the export panel has no scrollable body').toBe(true)
}

test.describe('the export sheet fits the column it is given', () => {
  test.slow()

  for (const { width, height, label } of WIDTHS) {
    test(`nothing overflows at ${width}px — ${label}`, async ({
      page,
      goto,
      clearStorage,
      loadSample,
      openTool,
      settle,
    }) => {
      await page.setViewportSize({ width, height })
      await goto('/editor')
      await clearStorage()
      await loadSample('Sample 1')
      await settle()

      const sheet = await openTool('Export')
      await settle()
      await expect(sheet.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
      await markScroller(page)
      const scroller = panelScroller(page)
      await expect(scroller).toBeVisible()

      // 1. The scroller does not scroll sideways. This is the assertion the
      //    defect made impossible to write in jsdom, and the direct reading of
      //    the bug: 690px of content in a 360px column.
      const measured = await scroller.evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        offsetWidth: (node as HTMLElement).offsetWidth,
      }))
      expect(
        measured.scrollWidth,
        `the export panel scrolls sideways at ${width}px`,
      ).toBeLessThanOrEqual(measured.clientWidth + EPSILON)

      // 2. Nothing inside it sticks out past the panel's right edge. Belt and
      //    braces on (1): a wrapper with `overflow: hidden` reports no sideways
      //    scroll while its children are still off the edge, and clipped
      //    controls are exactly as unreachable as scrolled ones.
      const spill = await overflowing(page, scroller, EPSILON)
      expect(
        spill,
        `these overflow the panel at ${width}px: ${JSON.stringify(spill, null, 2)}`,
      ).toEqual([])

      // 3. The panel is not wider than the viewport, which is the other way a
      //    360px column ends up holding 690px: the sheet itself is too wide and
      //    the page scrolls, taking the tab bar with it.
      const panelBox = await page
        .locator('section[role="dialog"]')
        .first()
        .evaluate((node) => {
          const box = node.getBoundingClientRect()
          return { width: box.width, left: box.left, right: box.right }
        })
      expect(panelBox.width, 'the sheet is wider than the viewport').toBeLessThanOrEqual(
        width + EPSILON,
      )
      expect(panelBox.left, 'the sheet hangs off the left edge').toBeGreaterThanOrEqual(-EPSILON)

      await page.screenshot({
        path: `.playwright-mcp/e2e-export-width-${width}.png`,
        fullPage: false,
      })
    })
  }

  test('the controls past the fold are still reachable without a horizontal drag', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    openTool,
    settle,
  }) => {
    // The narrow column specifically, and the thing the defect actually cost a
    // user: the bottom of the sheet. If the panel fits, everything in it is
    // reachable by scrolling down, which is the one gesture the sheet invites.
    await page.setViewportSize({ width: 360, height: 780 })
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()

    const panel = await openTool('Export')
    await settle()
    await markScroller(page)
    const scroller = panelScroller(page)

    // Scroll the sheet down to its end, which is the one gesture a bottom sheet
    // invites and the only one a user should need. If the panel fits its column,
    // scrolling *down* reaches everything; if it does not, no amount of vertical
    // scrolling brings the right-hand controls back.
    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect
      .poll(() => scroller.evaluate((node) => Math.round(node.scrollTop)))
      .toBeGreaterThan(0)

    // Download is the last thing in the sheet, so it is the canary: it is what a
    // user came for, and it is what the sideways scroll pushed off the screen.
    //
    // `toBeVisible` alone is not the assertion — it passes for a control that is
    // off the right edge, because Playwright scrolls it into view first, and the
    // horizontal scroll that brings it back is exactly the gesture the defect
    // added. So it is measured against the viewport, after a purely vertical
    // scroll, and nothing is allowed to scroll it back into place.
    const download = panel.getByRole('button', { name: 'Download', exact: true })
    await expect(download).toBeVisible()
    const box = (await download.boundingBox())!
    expect(box.x, 'Download starts off the left of the screen').toBeGreaterThanOrEqual(-EPSILON)
    expect(
      box.x + box.width,
      'Download ends off the right of the screen, so it needs a horizontal drag to reach',
    ).toBeLessThanOrEqual(360 + EPSILON)

    // And visible means on screen and clickable, not painted under something
    // else — the same `elementFromPoint` check the inspector spec uses, because
    // `toBeVisible` passes for a control that is behind the sticky footer.
    const hits = await download.evaluate((node: HTMLElement) => {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return false
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return hit !== null && (hit === node || node.contains(hit))
    })
    expect(hits, 'Download is covered, not clickable').toBe(true)
  })
})
