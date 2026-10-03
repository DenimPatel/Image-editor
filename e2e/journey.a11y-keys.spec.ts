import { test, expect } from './fixtures'

/**
 * D8 — the shell's keyboard and landmark contract.
 *
 * Every check here presses real keys and then reads the *live* `Doc` or the
 * accessible tree, because "the control renders" and "the control works" are
 * different claims. Locators are by role and accessible name only: a
 * CSS-module class would say nothing about whether a keyboard or screen-reader
 * user can reach the thing.
 */

/** Tab from the document root until `reached` returns true, or the cap is hit. */
async function tabUntil(
  page: import('@playwright/test').Page,
  reached: (active: { label: string; inSheet: boolean }) => boolean,
  cap = 320,
): Promise<{ label: string; inSheet: boolean }> {
  const seen: string[] = []
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
  })
  for (let i = 0; i < cap; i++) {
    await page.keyboard.press('Tab')
    const active = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return {
        label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60),
        inSheet: !!el.closest('section[role="dialog"]'),
      }
    })
    seen.push(active.label)
    if (reached(active)) return active
  }
  throw new Error(
    `Tab never reached the target in ${cap} presses. Trail: ${seen.slice(-12).join(' | ')}`,
  )
}

/**
 * WebKit on macOS runs with Safari's "Press Tab to highlight each item on a
 * webpage" preference OFF, which Playwright's `Desktop Safari` descriptor does
 * not turn on. In that mode WebKit's sequential focus navigation reaches form
 * controls and anything with an explicit `tabindex`, and skips `<button>` and
 * `<a>` entirely — so a "the first Tab lands on this button" claim cannot hold
 * there no matter what the app does. Those assertions are scoped to the engine
 * that tab-reaches every control; the *behaviour* claims they make (focus is
 * not trapped, focus really moves) are asserted everywhere.
 */
const FULL_TAB_NAVIGATION = /^chromium$|Desktop Chrome/

test.describe('D8-F14: landmarks and a way past the chrome', () => {
  test('the hub skip link is the first tab stop and moves focus into main', async ({
    goto,
    page,
    browserName,
  }) => {
    await goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toHaveCount(1)

    // First in the tab order by construction, which is engine-independent.
    const firstFocusable = page.locator('a, button, input, [tabindex]').first()
    await expect(firstFocusable).toHaveAttribute('href', '#main')

    // Off-screen until focused, so it cannot be clicked by accident. An
    // off-screen element still has a box — it is parked at x = -9999.
    expect((await skip.boundingBox())!.x).toBeLessThan(-1000)

    test.skip(
      !FULL_TAB_NAVIGATION.test(browserName),
      "WebKit only Tabs to form controls unless Safari's full keyboard access is on",
    )
    // The very first Tab on a fresh document, before anything has been focused.
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    expect((await skip.boundingBox())!.x).toBeGreaterThanOrEqual(0)

    await page.keyboard.press('Enter')
    // Focus really moves: fragment navigation alone would not do it.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe('main')
  })

  test('activating the hub skip link moves focus into main on every engine', async ({
    goto,
    page,
  }) => {
    await goto('/')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await skip.focus()
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toBe('main')
  })

  test('the editor has a main landmark and its own skip link', async ({
    goto,
    loadSample,
    settle,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()

    const main = page.getByRole('main')
    await expect(main).toHaveCount(1)
    await expect(main).toBeVisible()
    // The canvas lives inside the landmark, not beside it.
    await expect(main.locator('canvas.ie-canvas-el')).toHaveCount(1)

    const skip = page.getByRole('link', { name: 'Skip to the canvas' })
    expect((await skip.boundingBox())!.x).toBeLessThan(-1000)
    await skip.focus()
    await expect(skip).toBeFocused()
    expect((await skip.boundingBox())!.x).toBeGreaterThanOrEqual(0)
    await page.keyboard.press('Enter')
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
      .toBe('editor-main')
  })

  test('the import screen is inside a main landmark too', async ({ goto, page }) => {
    await goto('/editor')
    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
    const main = page.getByRole('main')
    await expect(main).toHaveCount(1)
    await expect(main.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
  })

  test('every route has its own document title', async ({ goto, page }) => {
    await goto('/')
    expect(await page.title()).toMatch(/Interactive Image Editor/)
    await goto('/editor')
    expect(await page.title()).toMatch(/^Editor/)
    await goto('/nowhere')
    // The 404 is the router's own errorElement, not a blank page.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.title()).toMatch(/Interactive Image Editor|Editor|Not/)
  })
})

test.describe('D8-F10: the curve graph is editable with a keyboard alone', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, openTool, settle, page }) => {
    await goto('/editor')
    // A resumed session carries whatever the last test left in the document, so
    // the curve assertions need a clean one.
    await clearStorage()
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
    await openTool('Adjust')
    await page.getByRole('button', { name: 'Curves', exact: true }).click()
    await expect(page.getByRole('group', { name: /curves/i })).toBeVisible()
  })

  test('the graph is not role="application", which used to mute the screen reader', async ({
    page,
  }) => {
    const graph = page.getByRole('group', { name: /curves/i })
    await expect(graph).toHaveAttribute('role', 'group')
    await expect(graph).toHaveAttribute('tabindex', '0')
  })

  test('Enter on the graph adds a point, the arrows nudge it, Delete removes it', async ({
    page,
    readDoc,
    settle,
  }) => {
    const graph = page.getByRole('group', { name: /curves/i })
    expect((await readDoc()).curves.rgb).toHaveLength(2)

    await graph.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readDoc()).curves.rgb.length).toBe(3)
    expect((await readDoc()).curves.rgb[1]).toEqual({ x: 128, y: 128 })

    // Focus followed the new point, so the arrows go straight to work. Polled
    // rather than assumed: the point's circle only exists after the store
    // write has committed, so the focus move is one commit behind the click.
    await expect(page.getByRole('button', { name: /curve point 2 of 3/ })).toBeFocused()

    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await readDoc()).curves.rgb[1].y).toBe(130)

    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(async () => (await readDoc()).curves.rgb[1].x).toBe(138)

    // The edit has to reach the canvas, not just the store.
    await settle()

    await page.keyboard.press('Delete')
    await expect.poll(async () => (await readDoc()).curves.rgb.length).toBe(2)
  })

  test('every point is a focusable button that announces where it is', async ({ page }) => {
    const points = page.getByRole('button', { name: /curve point \d+ of \d+/ })
    await expect(points).toHaveCount(2)
    await expect(points.first()).toHaveAttribute('tabindex', '0')
    await expect(points.first()).toHaveAttribute('aria-label', /input 0, output 0/)
    await expect(points.last()).toHaveAttribute('aria-label', /input 255, output 255/)
  })

  test('the keyboard edit is its own undo step per press', async ({ page, readDoc }) => {
    const graph = page.getByRole('group', { name: /curves/i })
    await graph.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readDoc()).curves.rgb.length).toBe(3)
    await expect(page.getByRole('button', { name: /curve point 2 of 3/ })).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await readDoc()).curves.rgb[1].y).toBe(129)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await readDoc()).curves.rgb[1].y).toBe(128)
  })
})

test.describe('D8-F09: the crop handles are real controls', () => {
  test('arrow keys move a handle and change the document', async ({
    goto,
    loadSample,
    openTool,
    readDoc,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    const handle = page.getByRole('slider', { name: 'Crop nw handle' })
    await expect(handle).toBeVisible()
    await expect(handle).toHaveAttribute('aria-valuenow', '100')

    const before = (await readDoc()).geometry.crop
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await readDoc()).geometry.crop.x).toBeGreaterThan(before.x)
    await expect.poll(async () => (await readDoc()).geometry.crop.y).toBeGreaterThan(before.y)
    await expect(handle).not.toHaveAttribute('aria-valuenow', '100')
  })
})

test.describe('D8-F05: the inspector focus trap', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('on desktop a keyboard user can Tab out of the inspector, then on to the top bar', async ({
    goto,
    loadSample,
    openTool,
    page,
    browserName,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    await expect(page.getByRole('dialog', { name: 'Crop & Straighten' })).toBeVisible()

    // The sheet must not claim modality on desktop: a modal dialog that cannot
    // be escaped is a trap, and the inspector is not one.
    await expect(page.getByRole('dialog', { name: 'Crop & Straighten' })).not.toHaveAttribute(
      'aria-modal',
      'true',
    )

    test.skip(
      !FULL_TAB_NAVIGATION.test(browserName),
      "WebKit only Tabs to form controls unless Safari's full keyboard access is on",
    )
    const escaped = await tabUntil(page, (active) => !active.inSheet)
    expect(escaped.inSheet).toBe(false)

    // Out of the sheet is not the same as back at the top — keep going.
    const topBar = await tabUntil(
      page,
      (active) => !active.inSheet && /Close editor/.test(active.label),
    )
    expect(topBar.label).toBe('Close editor')
  })
})

test.describe('D8-F02: the desktop inspector', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('is the column between the two bars, and does not cover the canvas', async ({
    goto,
    loadSample,
    openTool,
    canvas,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Adjust')
    const sheet = page.getByRole('dialog', { name: 'Adjust' })

    // Full height means "all the space between the two bars", not "all the
    // viewport". It used to assert `y <= 2` and `height >= 880`, which is the
    // *defect* written down: the panel was `position: fixed` over the window, so
    // it covered the top bar's right-hand buttons and the tool tab bar.
    const topBar = (await page.getByRole('banner').boundingBox())!
    const tabBar = (await page.getByRole('navigation', { name: 'Editor tools' }).boundingBox())!
    const box = (await sheet.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(topBar.y + topBar.height - 1)
    expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(Math.round(tabBar.y) + 1)
    expect(box.height).toBeGreaterThanOrEqual(760)

    const art = (await canvas().boundingBox())!
    // The artwork itself must not run under the inspector.
    expect(art.x + art.width).toBeLessThanOrEqual(box.x + 1)
  })
})

test.describe('D8-F15: the help overlay is a real dialog', () => {
  test.beforeEach(async ({ goto, loadSample, settle }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
  })

  test('opens, takes focus, closes on Escape and restores focus', async ({ page }) => {
    const opener = page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button', {
      name: 'Crop',
      exact: true,
    })
    await opener.focus()

    await page.keyboard.press('?')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeFocused()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // Tab is held inside: the dialog has exactly one control.
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('lists shortcuts the app actually binds', async ({ page, readDoc }) => {
    await page.keyboard.press('?')
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    const text = (await dialog.innerText()).replace(/\s+/g, ' ')
    for (const claimed of [
      'Undo',
      'Redo',
      'Export',
      'Rotate 90° anticlockwise',
      'Flip horizontally',
    ]) {
      expect(text).toContain(claimed)
    }

    // Every row the overlay shows has to be a key the hook really handles, so
    // two of them are exercised against the document rather than the text.
    await page.keyboard.press('Escape')
    await page
      .getByRole('navigation', { name: 'Editor tools' })
      .getByRole('button', {
        name: 'Adjust',
        exact: true,
      })
      .click()
    const exposure = page.getByRole('slider', { name: /^Exposure/ }).first()
    await exposure.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await readDoc()).adjust.exposure).toBeGreaterThan(0)

    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await readDoc()).adjust.exposure).toBe(0)
  })
})

test.describe('D8-F12 / D8-F13: focus rings and forced colours', () => {
  test('the editor chrome still has a visible focus ring in forced colours', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await page.emulateMedia({ forcedColors: 'active' })
    const undo = page.getByRole('button', { name: 'Undo' })
    await undo.focus()
    const outline = await undo.evaluate((el) => getComputedStyle(el).outlineWidth)
    expect(parseFloat(outline)).toBeGreaterThanOrEqual(2)
    await page.screenshot({ path: '.playwright-mcp/e2e-editor-forced-colors.png' })
  })

  test('reduced motion removes every transition, not only the hub reveal', async ({
    goto,
    loadSample,
    openTool,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Adjust')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(300)
    const offenders = await page.evaluate(() => {
      const out: string[] = []
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const cs = getComputedStyle(el)
        const longest = (value: string) =>
          Math.max(0, ...value.split(',').map((part) => parseFloat(part) || 0))
        if (longest(cs.transitionDuration) > 0.01) out.push(el.tagName + '.' + el.className)
        if (
          cs.animationName &&
          cs.animationName !== 'none' &&
          cs.animationPlayState === 'running'
        ) {
          out.push(el.tagName + '.' + el.className + ' animation')
        }
      }
      return out
    })
    expect(offenders).toEqual([])
  })
})

test.describe('D8-F04: safe areas', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('viewport-fit=cover is declared and the chrome clears a non-zero inset', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    // Without `viewport-fit=cover` every `env(safe-area-inset-*)` resolves to
    // 0px on iOS and the top bar sits under the notch.
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).toContain('viewport-fit=cover')

    await loadSample('Sample 1')
    const bar = page.locator('header')
    const tabs = page.getByRole('navigation', { name: 'Editor tools' })
    const before = {
      top: await bar.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop)),
      bottom: await tabs.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
    }

    // Chromium reports 0px for `env(safe-area-inset-*)` under automation, so
    // the inset is injected: this proves the chrome is wired to the tokens
    // rather than hard-coding its own padding.
    await page.addStyleTag({ content: ':root { --ie-safe-top: 47px; --ie-safe-bottom: 34px; }' })
    await page.waitForTimeout(200)

    expect(await bar.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))).toBe(
      before.top + 47,
    )
    expect(await tabs.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBe(
      before.bottom + 34,
    )
    await page.screenshot({ path: '.playwright-mcp/e2e-safe-area-inset.png' })
  })
})
