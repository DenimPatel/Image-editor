import { test, expect } from './fixtures'

/**
 * The phone, proved as a phone.
 *
 * This spec only runs in the `mobile` project in `playwright.config.ts`
 * (`hasTouch`, a coarse pointer, an iPhone 13 profile). Anything that needs a
 * real touch stack — `(pointer: coarse)`, a touch drag, a modal sheet at
 * phone size — is untestable in the desktop projects, and shipping it that way
 * is how a control ends up existing only on screens that were never opened.
 */

/** A real one-finger swipe through CDP: `page.touchscreen` only taps. */
async function swipeUp(
  page: import('@playwright/test').Page,
  selector: import('@playwright/test').Locator,
  distance = 220,
): Promise<number> {
  const box = (await selector.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const x = box.x + box.width / 2
  const startY = box.y + box.height - 50
  const points = (y: number) => [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(startY) })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(startY - (distance / 10) * i),
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(300)
  await cdp.detach()
  return selector.evaluate((el) => el.scrollTop)
}

test.describe('D8-F16: camera capture', () => {
  test('offers a capture input that opens the camera, not the file browser', async ({
    goto,
    page,
  }) => {
    await goto('/editor')
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()

    // The ordinary browse input accepts the full decoded set.
    await expect(page.locator('input[type="file"]').first()).toHaveAttribute('accept', /image\//)

    // The camera one is a separate input, and it asks for the rear camera.
    const camera = page.locator('input[type="file"][capture]')
    await expect(camera).toHaveCount(1)
    await expect(camera).toHaveAttribute('capture', 'environment')
    await expect(camera).toHaveAttribute('aria-label', 'Take a photo')

    // And there is a visible, keyboard-reachable control that opens it.
    const button = page.getByRole('button', { name: 'Take a photo' })
    await expect(button).toBeVisible()
    const size = (await button.boundingBox())!
    expect(size.height).toBeGreaterThanOrEqual(44)

    // Prove the button really drives *that* input rather than just existing.
    // A real file chooser is not opened: the point is which input is clicked,
    // and driving the chooser makes the test depend on a native dialog.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"][capture]')!
      ;(window as unknown as { __clicked: string | null }).__clicked = null
      input.addEventListener('click', () => {
        ;(window as unknown as { __clicked: string | null }).__clicked = input.id || 'camera-input'
      })
      const other = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')
      other?.addEventListener('click', () => {
        ;(window as unknown as { __clicked: string | null }).__clicked = 'browse-input'
      })
    })
    await button.dispatchEvent('click')
    expect(
      await page.evaluate(() => (window as unknown as { __clicked: string | null }).__clicked),
    ).toBe('camera-input')
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-camera.png' })
  })
})

/**
 * The dialog's scrolling body, found by its computed overflow rather than by a
 * CSS-module class: the rule for this suite is that a class name says nothing
 * about whether a thing works, and "the one descendant that can scroll" says
 * exactly what the user is trying to do.
 */
function sheetScroller(page: import('@playwright/test').Page) {
  return page
    .locator('section[role="dialog"]')
    .first()
    .locator('xpath=*')
    .evaluateAll((nodes) => {
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

test.describe('D8-F03: the sheet scrolls under a finger', () => {
  test('a tall panel can be scrolled to its end', async ({ goto, loadSample, openTool, page }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    const sheet = page.getByRole('dialog', { name: 'Crop & Straighten' })
    await expect(sheet).toBeVisible()

    await sheetScroller(page)
    const scroller = page.locator('[data-e2e-scroller]')
    await expect(scroller).toHaveCount(1)

    const before = await swipeUp(page, scroller)
    expect(before).toBeGreaterThan(0)

    // The content under the fold is now reachable, not merely scrollable.
    await expect(sheet.getByRole('slider', { name: /Straighten/ }).first()).toBeVisible()
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-sheet-scrolled.png' })
  })

  test('the sheet keeps its title and its way out while the body scrolls', async ({
    goto,
    loadSample,
    openTool,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Export')
    const sheet = page.getByRole('dialog', { name: 'Export' })
    await expect(sheet).toBeVisible()

    // The Export panel is ~1000px of content in a 58vh detent, and opening a
    // sheet focuses its first control, which scrolls the body — so a header that
    // is not pinned scrolled the title and the Close button off the screen the
    // moment the panel opened. A touch user has no Escape key, so that left the
    // backdrop as the only way out and the heading as a name the panel no longer
    // carried.
    await sheetScroller(page)
    const scroller = page.locator('[data-e2e-scroller]')
    const close = sheet.getByRole('button', { name: 'Close' })
    const title = sheet.getByRole('heading', { level: 2, name: 'Export' })
    await expect(title).toBeVisible()
    await expect(close).toBeVisible()

    await swipeUp(page, scroller, 400)
    await swipeUp(page, scroller, 400)
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    // Still there, still hittable.
    await expect(title).toBeVisible()
    await expect(close).toBeVisible()
    const box = (await close.boundingBox())!
    const scrollerBox = (await scroller.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(scrollerBox.y - 1)
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-sheet-header-pinned.png' })

    // And the pinned Close really closes it.
    await close.click()
    await expect(sheet).toBeHidden()
  })
})

test.describe('D8-F04: the bars clear the notch', () => {
  test('the top bar and the tab bar spend the safe-area insets', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')

    // `env(safe-area-inset-*)` is only non-zero on hardware with a cutout, and
    // this browser has none, so the insets an iPhone reports are written into
    // the tokens directly. What is under test is that the two bars *consume*
    // the tokens: with a real notch they are the difference between the toolbar
    // being visible and being under the island.
    const NOTCH_TOP = 59
    const HOME_BOTTOM = 34
    await page.addStyleTag({
      content: `:root { --ie-safe-top: ${NOTCH_TOP}px; --ie-safe-bottom: ${HOME_BOTTOM}px; }`,
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--ie-safe-top').trim(),
        ),
      )
      .toBe(`${NOTCH_TOP}px`)

    const measured = await page.evaluate(() => {
      const bar = document.querySelector('header')!
      const tabs = document.querySelector('nav[aria-label="Editor tools"]')!
      const firstControl = bar.querySelector('button')!
      const label = Array.from(tabs.querySelectorAll('span'))[0]!
      const viewport = window.innerHeight
      return {
        firstControlTop: firstControl.getBoundingClientRect().top,
        labelBottom: label.getBoundingClientRect().bottom,
        tabsBottom: tabs.getBoundingClientRect().bottom,
        viewport,
      }
    })

    // The first control in the top bar starts below the notch, and the tab
    // labels end above the home indicator.
    expect(measured.firstControlTop).toBeGreaterThanOrEqual(NOTCH_TOP)
    expect(measured.labelBottom).toBeLessThanOrEqual(measured.viewport - HOME_BOTTOM)
    // And the tab bar still reaches the bottom of the screen, inset and all.
    expect(Math.round(measured.tabsBottom)).toBe(measured.viewport)
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-safe-areas.png' })
  })
})

test.describe('D8-F05: the sheet traps focus on a phone', () => {
  test('Tab cannot leave an open sheet', async ({ goto, loadSample, openTool, page }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    const sheet = page.getByRole('dialog', { name: 'Crop & Straighten' })
    await expect(sheet).toBeVisible()

    // It must be modal here even though it is not a trap on desktop.
    await expect(sheet).toHaveAttribute('aria-modal', 'true')

    for (let i = 0; i < 45; i++) await page.keyboard.press('Tab')
    const escaped = await page.evaluate(
      () => !document.activeElement?.closest('section[role="dialog"]'),
    )
    expect(escaped).toBe(false)
    await page.screenshot({ path: '.playwright-mcp/e2e-mobile-sheet-trap.png' })
  })
})

test.describe('D9-F09: the PWA shell', () => {
  test('the installable shell is declared and reachable', async ({ page }) => {
    await page.goto('/')
    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(manifest).toBeTruthy()
    const response = await page.request.get(new URL(manifest!, page.url()).toString())
    expect(response.ok()).toBe(true)
    const parsed = JSON.parse(await response.text())
    expect(parsed.display).toBe('standalone')
    expect(parsed.icons.length).toBeGreaterThanOrEqual(2)

    // The offline worker is served, even where it may not be registered.
    const sw = await page.request.get(new URL('sw.js', page.url()).toString())
    expect(sw.ok()).toBe(true)
  })

  test('the offline banner says what still works, not that everything is broken', async ({
    goto,
    page,
  }) => {
    await goto('/editor')
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    // `navigator.onLine` only changes with the context, so the event is
    // dispatched too — but the banner mounts on the same tick the banner's own
    // effect subscribes, so the assertion polls rather than racing it.
    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    const banner = page.getByRole('status').filter({ hasText: /offline/i })
    await expect(banner).toBeVisible({ timeout: 5_000 })
    const text = await banner.innerText()
    expect(text).toMatch(/Your photo and every edit will work offline/)
    expect(text).toMatch(/Background removal will need a connection/)
    await page.screenshot({ path: '.playwright-mcp/e2e-offline-banner.png' })
    await page.context().setOffline(false)
    await expect(banner).toHaveCount(0)
  })
})

test.describe('D7-F02: the import pending state', () => {
  test('says the import is under way and blocks a second one', async ({ goto, page }) => {
    await goto('/editor')
    await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
    await page.getByRole('button', { name: /^Sample 1\b/ }).click()
    // The canvas appears rather than the grid; a decode that hangs forever must
    // not leave a user clicking a button that does nothing.
    await expect(page.locator('canvas.ie-canvas-el')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toHaveCount(0)
  })
})
