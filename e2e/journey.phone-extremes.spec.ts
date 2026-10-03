import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * D9-F17 — the phone at its worst, and the safe area at its widest.
 *
 * Three things no other file in this suite claims, each of which has already
 * been true at some point:
 *
 * - **Safe areas are proved by layout, not by string.** `appShell.test.ts` reads
 *   the tab bar's `padding` shorthand and asserts the right-hand value names
 *   `--ie-safe-right`. That is the guard that caught a swap which shipped
 *   through a four-value shorthand. It is a *string* check, so it says the
 *   declaration is right and not that the box came out right — and a swap in any
 *   other consumer's shorthand, or one that survives to layout, is invisible to
 *   it. Below, the insets are made deliberately asymmetric and the resulting
 *   boxes are measured: a swap cannot survive being asked which side moved.
 * - **`xlarge` text at 360px.** The worst case in the product, and no file
 *   sweeps every panel at it.
 * - **320×568 and landscape.** A small old phone, and the editor turned on its
 *   side, where the vertical budget collapses to 390px.
 */

/**
 * Engines that put a link in the tab order without the reader asking for it.
 *
 * WebKit only Tabs to links when "Press Tab to highlight each item on a
 * webpage" is switched on, which it is not by default. A skip link is an `<a>`,
 * so there the first Tab goes to whatever focusable element comes next instead —
 * the editor's `main`, which carries a `tabindex` because it is the skip
 * *target*. That is the engine's preference rather than a defect in the page,
 * which is why `journey.a11y-keys.spec.ts` and `journey.shell.spec.ts` each
 * carry the same guard for the same reason.
 *
 * It is a guard and not a deletion: on an engine that does Tab to links, the
 * assertion below still runs and still has to hold. Skipping it everywhere
 * would be the same as not having it.
 */
const FULL_TAB_NAVIGATION = /^chromium$|Desktop Chrome/

/** The thirteen tools, in tab-bar order. */
const TOOLS = [
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

const setAppearance = async (page: Page, stored: Record<string, string>) => {
  if (Object.keys(stored).length === 0) return
  await page.evaluate((value: Record<string, string>) => {
    localStorage.setItem('image-editor-appearance', JSON.stringify(value))
  }, stored)
  await page.reload()
  await expect(page.locator('#root')).not.toBeEmpty()
}

const openTool = async (page: Page, name: string) => {
  const tab = page
    .getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name, exact: true })
  await tab.click()
  await expect(tab, `${name} did not open`).toHaveAttribute('aria-current', 'true')
  await page.waitForTimeout(300)
}

/**
 * Everything that is *clipped* — painted where it cannot be reached.
 *
 * Comparing against the viewport is not enough and in fact reports nothing
 * useful here: the tab bar is a horizontal scroll container, so five of its
 * thirteen tabs sit outside the window by design, and the skip link sits at
 * `left: -9999px` until it is focused. Both are correct, and both are what a
 * naive sweep reports as breakage.
 *
 * So each element is measured against the nearest ancestor that actually clips
 * it — the first one up the tree with an `overflow` other than `visible` — and
 * only an element that escapes *that* is a defect. An element inside a
 * scrollable ancestor is reachable by scrolling it, so it is not reported.
 */
const clipped = (page: Page) =>
  page.evaluate(() => {
    const clipper = (node: Element): Element => {
      for (let n = node.parentElement; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).overflowX !== 'visible') return n
      }
      return document.body
    }
    const out: string[] = []
    for (const node of Array.from(document.querySelectorAll('body *'))) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      // The skip link parks itself at `left: -9999px` until it takes focus; that
      // is the reveal mechanism, not a clipping defect. `xlarge` at 360px is
      // exactly where it matters, so the sweep excludes it here and the test
      // below asserts positively that it comes on screen when focused.
      if (box.left < -1000) continue
      const host = clipper(node)
      const hostBox = host.getBoundingClientRect()
      // A scrollable host means its content is reachable by scrolling it.
      if (host.scrollWidth > host.clientWidth + 1) continue
      const label =
        `${node.tagName.toLowerCase()}[${node.getAttribute('role') ?? ''}]` +
        `${node.getAttribute('aria-label') ?? ''} "${(node.textContent ?? '').trim().slice(0, 18)}"`
      if (box.right > hostBox.right + 1) {
        out.push(`${label} overflows its clipper by ${Math.round(box.right - hostBox.right)}px`)
      } else if (box.left < hostBox.left - 1) {
        out.push(
          `${label} is cut off its clipper's left by ${Math.round(hostBox.left - box.left)}px`,
        )
      }
    }
    return {
      vw: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      offenders: out.slice(0, 6),
      offenderCount: out.length,
    }
  })

test.describe('the safe area is a layout fact, not a declaration', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('an asymmetric inset widens the correct sides of both bars', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')

    const read = () =>
      page.evaluate(() => {
        const top = document.querySelector('header')!
        const bottom = document.querySelector('nav[aria-label="Editor tools"]')!
        const t = getComputedStyle(top)
        const b = getComputedStyle(bottom)
        const box = (n: Element) => {
          const r = n.getBoundingClientRect()
          return {
            left: Math.round(r.left),
            right: Math.round(r.right),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
          }
        }
        return {
          topBar: {
            padTop: t.paddingTop,
            padRight: t.paddingRight,
            padBottom: t.paddingBottom,
            padLeft: t.paddingLeft,
            box: box(top),
          },
          tabBar: {
            padTop: b.paddingTop,
            padRight: b.paddingRight,
            padBottom: b.paddingBottom,
            padLeft: b.paddingLeft,
            box: box(bottom),
          },
        }
      })

    const before = await read()
    expect(before.topBar.padTop, 'the tokens are already non-zero before injection').toMatch(
      /^0px$/,
    )

    // Asymmetric on purpose: 44 on the left and nothing on the right is the
    // notch in landscape on a phone that has one there, and it is the only shape
    // that can tell the two sides apart.
    await page.addStyleTag({
      content:
        ':root { --ie-safe-top: 47px; --ie-safe-right: 0px; --ie-safe-bottom: 34px; --ie-safe-left: 44px; }',
    })
    await page.waitForTimeout(250)
    const after = await read()

    expect(after.topBar.padTop, 'the top bar does not clear the notch').toBe('47px')
    expect(
      after.topBar.padBottom,
      'the top bar clears an inset at the bottom it has no inset for',
    ).toBe('0px')
    expect(after.tabBar.padBottom, 'the tab bar does not clear the home indicator').toBe('40px')

    // The load-bearing half: the left inset lands on the left, on both bars.
    expect(parseFloat(after.topBar.padLeft), 'the top bar ignores the left inset').toBe(
      parseFloat(before.topBar.padLeft) + 44,
    )
    expect(parseFloat(after.topBar.padRight), 'the top bar put the left inset on its right').toBe(
      parseFloat(before.topBar.padRight),
    )
    expect(parseFloat(after.tabBar.padLeft), 'the tab bar ignores the left inset').toBe(
      parseFloat(before.tabBar.padLeft) + 44,
    )
    expect(parseFloat(after.tabBar.padRight), 'the tab bar put the left inset on its right').toBe(
      parseFloat(before.tabBar.padRight),
    )
  })

  test('the bars sit inside the notch, not under it, once the insets are real', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    await page.addStyleTag({
      content:
        ':root { --ie-safe-top: 47px; --ie-safe-right: 0px; --ie-safe-bottom: 34px; --ie-safe-left: 44px; }',
    })
    await page.waitForTimeout(250)

    const geometry = await page.evaluate(() => {
      const safeTop = 47
      const safeBottom = 34
      const safeLeft = 44
      const top = document.querySelector('header')!.getBoundingClientRect()
      const tabs = document.querySelector('nav[aria-label="Editor tools"]')!.getBoundingClientRect()
      const first = document.querySelector('header button')!.getBoundingClientRect()
      const last = document
        .querySelector('nav[aria-label="Editor tools"] button:last-of-type')!
        .getBoundingClientRect()
      return {
        topBarTop: Math.round(top.top),
        tabBarBottom: Math.round(tabs.bottom),
        firstControlTop: Math.round(first.top),
        lastControlBottom: Math.round(last.bottom),
        safeTop,
        safeBottom,
        safeLeft,
        firstControlLeft: Math.round(first.left),
        viewportHeight: window.innerHeight,
      }
    })

    // The bars are flush to the window — that is what `viewport-fit=cover` means
    // — so what has to clear the notch is the *first control inside* them.
    expect(
      geometry.firstControlTop,
      'the first control in the top bar sits under the notch',
    ).toBeGreaterThanOrEqual(geometry.safeTop)
    expect(
      geometry.lastControlBottom,
      'the last control in the tab bar sits under the home indicator',
    ).toBeLessThanOrEqual(geometry.viewportHeight - geometry.safeBottom)
    expect(
      geometry.firstControlLeft,
      'the first control in the top bar sits under the left inset',
    ).toBeGreaterThanOrEqual(geometry.safeLeft)
  })
})

test.describe('xlarge text at 360px, which is the worst case', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('every panel stays inside the viewport', async ({ goto, loadSample, page }) => {
    await goto('/editor')
    await setAppearance(page, { density: 'roomy', textScale: 'xlarge', iconScale: 'xlarge' })
    await loadSample('Sample 1')

    const found: Record<
      string,
      { vw: number; offenderCount: number; offenders: string[]; documentScrollWidth: number }
    > = {}
    for (const tool of TOOLS) {
      await openTool(page, tool)
      // A panel can only be wrong about its width if it is wider than the
      // window, so the measurement is of the whole document: `scrollWidth`
      // growing past `clientWidth` is the one symptom that is never fine.
      const result = await clipped(page)
      found[tool] = result
    }

    // Overflow a scroll container can absorb is not the same as overflow it
    // hides. Every control in the panel has to be *reachable* — inside the
    // window, or inside an ancestor that can be scrolled to bring it inside.
    // A chip row that scrolls sideways is fine; a chip row that is clipped by an
    // `overflow: hidden` box and cannot be scrolled is a control that does not
    // exist, and it is the failure mode a width-only sweep cannot see.
    const unreachable: string[] = []
    for (const tool of TOOLS) {
      await openTool(page, tool)
      const lost = await page.evaluate(() => {
        const canReach = (node: Element) => {
          const box = node.getBoundingClientRect()
          const vw = document.documentElement.clientWidth
          if (box.left >= -1 && box.right <= vw + 1) return true
          for (let n = node.parentElement; n && n !== document.body; n = n.parentElement) {
            if (n.scrollWidth > n.clientWidth + 1) return true
          }
          return false
        }
        const out: string[] = []
        const sheet = document.querySelector('section[role="dialog"]')
        if (!sheet) return out
        for (const node of Array.from(
          sheet.querySelectorAll(
            'button, a[href], input, select, textarea, [role="slider"], [role="radio"]',
          ),
        )) {
          const box = node.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          if (!canReach(node)) {
            out.push(
              `${node.tagName.toLowerCase()}[${node.getAttribute('role') ?? ''}]` +
                `${node.getAttribute('aria-label') ?? ''} "${(node.textContent ?? '').trim().slice(0, 18)}"` +
                ` left=${Math.round(box.left)} right=${Math.round(box.right)}`,
            )
          }
        }
        return out.slice(0, 4)
      })
      if (lost.length > 0) unreachable.push(`${tool}: ${lost.join(' | ')}`)
    }
    expect(unreachable, 'panel controls that cannot be scrolled to at 360px and xlarge').toEqual([])

    const broken = Object.entries(found)
      .filter(([, value]) => value.offenderCount > 0 || value.documentScrollWidth > value.vw)
      .map(
        ([tool, value]) =>
          `${tool}: scrollWidth ${value.documentScrollWidth} vs ${value.vw}; ${value.offenders.join(' | ')}`,
      )
    expect(broken, 'panels that do not fit 360px at roomy + xlarge').toEqual([])
  })

  // Its own test, on its own document, for the reason `journey.a11y-keys.spec.ts`
  // already knows: the claim is that the skip link is the *first* tab stop, which
  // is a property of the document. When it was asserted at the end of the sweep
  // above it was a property of wherever a click had left the sequential-focus
  // starting point, and WebKit keeps that point where the last click was, so the
  // first Tab measured the sheet the sweep had left open. The `Tab` walk is
  // engine-gated for the same reason as on the Hub — WebKit only Tabs to links
  // when full keyboard access is on — and the ordering claim itself is asserted
  // engine-independently from DOM position, which is what it actually is.
  test('the skip link is the first tab stop, and it fits at xlarge', async ({
    goto,
    page,
    browserName,
  }) => {
    test.skip(
      !FULL_TAB_NAVIGATION.test(browserName),
      'WebKit does not Tab to links unless the reader turns full keyboard access on',
    )
    await goto('/editor')
    await setAppearance(page, { density: 'roomy', textScale: 'xlarge', iconScale: 'xlarge' })
    const skip = page.getByRole('link', { name: 'Skip to the canvas' })
    await expect(skip).toHaveCount(1)
    await expect(page.locator('a, button, input, [tabindex]').first()).toHaveAttribute(
      'href',
      '#editor-main',
    )
    // `#root` is not empty while the route is still resolving — it holds
    // `route-fallback`, an `aria-busy` status region — so waiting on the root
    // alone races the router and the first Tab lands inside the fallback.
    await expect(skip).toBeAttached()
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    // Parked off-screen at x = -9999 until focused, and at `xlarge` it is the
    // longest string on the page, so the reveal has to clear the window too.
    const box = (await skip.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(
      (await page.evaluate(() => document.documentElement.clientWidth)) + 1,
    )
  })
})

test.describe('320x568, and the editor on its side', () => {
  test('a small old phone keeps the chrome and every tab reachable', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await goto('/editor')
    await loadSample('Sample 1')

    const bar = page.locator('header')
    const tabs = page.getByRole('navigation', { name: 'Editor tools' })
    const done = bar.getByRole('button', { name: 'Done' })
    const more = bar.getByRole('button', { name: 'More options' })

    for (const [name, locator] of [
      ['Done', done],
      ['More options', more],
    ] as const) {
      const box = (await locator.boundingBox())!
      const vp = page.viewportSize()!
      expect(box.x, `${name} runs off the left at 320px`).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width, `${name} runs off the right at 320px`).toBeLessThanOrEqual(vp.width)
      await locator.click()
      await page.waitForTimeout(150)
    }

    const unreachable: string[] = []
    for (const tool of TOOLS) {
      const tab = tabs.getByRole('button', { name: tool, exact: true })
      await tab.scrollIntoViewIfNeeded()
      try {
        await tab.click({ timeout: 2500 })
        await expect(tab).toHaveAttribute('aria-current', 'true')
      } catch {
        unreachable.push(tool)
      }
    }
    expect(unreachable, 'tool tabs a 320px phone cannot reach').toEqual([])
    await page.screenshot({ path: '.playwright-mcp/e2e-320-crop.png' })
  })

  test('landscape 844x390 keeps both bars and the canvas out of each other', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool(page, 'Crop')

    const geometry = await page.evaluate(() => {
      const top = document.querySelector('header')!.getBoundingClientRect()
      const tabs = document.querySelector('nav[aria-label="Editor tools"]')!.getBoundingClientRect()
      const sheet = document.querySelector('section[role="dialog"]')!.getBoundingClientRect()
      const canvas = document.querySelector('canvas.ie-canvas-el')!.getBoundingClientRect()
      return {
        topBar: { top: Math.round(top.top), bottom: Math.round(top.bottom) },
        tabBar: { top: Math.round(tabs.top), bottom: Math.round(tabs.bottom) },
        sheet: { top: Math.round(sheet.top), bottom: Math.round(sheet.bottom) },
        canvas: { height: Math.round(canvas.height), top: Math.round(canvas.top) },
        viewportHeight: window.innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }
    })

    expect(
      geometry.topBar.bottom,
      'the top bar runs into the tab bar in landscape',
    ).toBeLessThanOrEqual(geometry.tabBar.top)
    // The sheet hangs from the bottom of the canvas region, so what has to hold
    // is its *bottom* against the tab bar's top — the sheet is supposed to cover
    // the canvas above it, and asserting on `sheet.top` would be asserting that
    // it covers nothing at all.
    expect(
      geometry.sheet.bottom,
      'the sheet runs under the tool tab bar in landscape',
    ).toBeLessThanOrEqual(geometry.tabBar.top + 1)
    expect(geometry.canvas.height, 'the canvas has no height left in landscape').toBeGreaterThan(0)
    expect(
      geometry.documentScrollWidth,
      'the document scrolls sideways in landscape',
    ).toBeLessThanOrEqual(geometry.clientWidth)
    await page.screenshot({ path: '.playwright-mcp/e2e-landscape-crop.png' })
  })
})

test.describe('the keyboard reaches the menus', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the overflow menu opens, moves, and returns focus to its trigger', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    const trigger = page.getByRole('button', { name: 'More options' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    const first = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      const cs = a ? getComputedStyle(a) : null
      return {
        label: (a?.getAttribute('aria-label') ?? a?.textContent ?? '').trim().slice(0, 24),
        inMenu: !!a?.closest('[role="menu"]'),
        ring: !!cs && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
      }
    })
    expect(first.inMenu, 'opening the overflow menu did not move focus into it').toBe(true)
    expect(first.ring, 'the first overflow item has no visible focus ring').toBe(true)

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
      .toBe('More options')
  })

  test('the appearance menu is reachable from the editor and hands focus back', async ({
    goto,
    loadSample,
    page,
  }) => {
    await goto('/editor')
    await loadSample('Sample 1')
    const trigger = page.getByRole('button', { name: 'More options' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: /Appearance/ }).click()

    const panel = page.getByRole('dialog', { name: /Appearance/ })
    await expect(panel).toBeVisible()
    // The panel is named by `aria-labelledby`, so its accessible name comes from
    // the `<h2>` and it carries no `aria-label` to match on. The role is the
    // contract: the panel itself takes focus, not its first radio.
    const inside = await page.evaluate(
      () => document.activeElement?.getAttribute('role') === 'dialog',
    )
    expect(inside, 'the appearance panel did not take focus').toBe(true)

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
      .toBe('More options')
  })

  test('the licences page is reachable from the hub by keyboard alone', async ({ goto, page }) => {
    await goto('/')
    const link = page.getByRole('link', { name: /Licen[cs]e/i })
    await link.focus()
    const ring = await link.evaluate((node) => {
      const cs = getComputedStyle(node)
      return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    })
    expect(ring, 'the licences link has no visible focus ring').toBe(true)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/licen[cs]e/i)
    // A separate static document, not a dialog: it is dismissed by the browser's
    // own history, not by Escape, and asking for Escape here would be asserting
    // a key the page never claimed to bind.
    await page.goBack()
    await expect(page).not.toHaveURL(/licen[cs]e/i)
    await expect(page.getByRole('heading').first()).toBeVisible()
  })
})
