import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ACCENTS, ACCENT_IDS, DEFAULT_APPEARANCE } from '../src/lib/appearance'
import { shortcutRows } from '../src/components/ui/shortcuts'
import { licencesSummary } from '../src/lib/licenses'

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

/**
 * The appearance settings, proved to change the app.
 *
 * A unit test can prove a radio is labelled, that it is checked, and that it
 * writes the right key. It cannot prove the user can see a difference, because
 * jsdom has no cascade. So every assertion here reads a **computed style** off a
 * real element: `getComputedStyle(el).minHeight`, `.fontSize`, `.color`. A class
 * that toggled without moving a computed value would fail, which is the point —
 * "the control works" and "the app changed" are two different claims, and only
 * the second one is the one a user can see.
 *
 * Two engines, both real browsers, the same assertions on each: an appearance
 * system that works in Chromium and not in WebKit is not an appearance system.
 */

/**
 * WebKit on macOS runs with Safari's "Press Tab to highlight each item on a
 * webpage" preference OFF, which Playwright's `Desktop Safari` descriptor does
 * not turn on. In that mode WebKit's sequential focus navigation reaches form
 * controls — the radio inputs here — and skips `<button>`, so a "the next Tab
 * lands on the Close button" claim cannot hold there no matter what the app does.
 * `journey.shell.spec.ts` and `journey.a11y-keys.spec.ts` scope the same class of
 * assertion the same way; the *behaviour* claims these tests make — the settings
 * are reachable, arrows choose, Escape closes and focus comes back — are
 * asserted on both engines.
 */
const FULL_TAB_NAVIGATION = /^chromium$|Desktop Chrome/

const APPEARANCE = 'Appearance'
const panel = (page: Page) => page.getByRole('dialog', { name: APPEARANCE })
/** By accessible name only. `exact: true` matters: three settings are all
 *  offered as "Default", and the legend is what tells them apart. */
const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true })

async function openFromNav(page: Page) {
  await page.getByRole('button', { name: APPEARANCE, exact: true }).click()
  await expect(panel(page)).toBeVisible()
}

async function openFromEditor(page: Page) {
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitem', { name: 'Appearance…' }).click()
  await expect(panel(page)).toBeVisible()
}

async function setDensity(page: Page, name: 'Density: Compact' | 'Density: Roomy') {
  await openFromEditor(page)
  await radio(page, name).check()
  await page.keyboard.press('Escape')
}

/**
 * `menu.module.css` writes `min-height: calc(42px * var(--density-factor))` on
 * every overflow-menu entry, so this is a measured consumer of the multiplier
 * rather than something on screen that happens to be nearby.
 */
async function menuItemMinHeight(page: Page) {
  await page.getByRole('button', { name: 'More options' }).click()
  const item = page.getByRole('menuitem', { name: 'Reset all edits' })
  const height = await item.evaluate((element: Element) => getComputedStyle(element).minHeight)
  await page.keyboard.press('Escape')
  return parseFloat(height)
}

/**
 * The attribute the app *actually* has, resolving an absent one to the default.
 * The model omits a default rather than writing it as a literal — that is what
 * lets `:root:not([data-accent])` fall through to the first token — so "the
 * setting is `green`" is expressed by the attribute's *absence*, and a test that
 * only ever looked for presence would fail on exactly the value that needs no
 * write.
 */
async function effective(page: Page, key: keyof typeof DEFAULT_APPEARANCE) {
  const found = await page.evaluate(
    (name) => document.documentElement.getAttribute(`data-${name}`),
    key,
  )
  return found ?? DEFAULT_APPEARANCE[key]
}

test.describe('the appearance menu is reachable and the app changes', () => {
  test('density compact and roomy move a measured control in the editor', async ({
    page,
    goto,
    loadSample,
  }) => {
    await goto('/')
    await openFromNav(page)
    await expect(radio(page, 'Density: Default')).toBeChecked()
    await page.keyboard.press('Escape')

    await goto('/editor')
    await loadSample()
    const atDefault = await menuItemMinHeight(page)

    await setDensity(page, 'Density: Compact')
    expect(await effective(page, 'density')).toBe('compact')
    const atCompact = await menuItemMinHeight(page)

    await setDensity(page, 'Density: Roomy')
    expect(await effective(page, 'density')).toBe('roomy')
    const atRoomy = await menuItemMinHeight(page)

    // 0.875x and 1.125x, measured off a rendered element rather than asserted
    // from the model the app is built on.
    expect(atCompact).toBeCloseTo(atDefault * 0.875, 1)
    expect(atRoomy).toBeCloseTo(atDefault * 1.125, 1)
    expect(atCompact).toBeLessThan(atDefault)
    expect(atRoomy).toBeGreaterThan(atDefault)
  })

  test('text size xlarge changes a computed font-size on the Hub footer', async ({
    page,
    goto,
  }) => {
    await goto('/')
    const footer = page.locator('footer')
    const read = () =>
      footer.evaluate((element: Element) => parseFloat(getComputedStyle(element).fontSize))
    const baseline = await read()

    await openFromNav(page)
    await radio(page, 'Text size: Extra large').check()
    await expect(page.locator('html')).toHaveAttribute('data-text', 'xlarge')
    await page.keyboard.press('Escape')

    // `hub.css` writes `calc(0.84375rem * var(--text-scale))` on the footer.
    expect(await read()).toBeCloseTo(baseline * 1.25, 1)
  })

  test('every accent repaints the app, in light and in dark', async ({ page, goto }) => {
    await goto('/')
    // The footer's licences link takes `var(--accent)`, so it is a real consumer
    // of the token — located by role and name, and nothing here is a class.
    const link = page.getByRole('link', { name: /Licences and attribution/ })
    const read = () => link.evaluate((element: Element) => getComputedStyle(element).color)

    for (const theme of ['Light', 'Dark'] as const) {
      await openFromNav(page)
      await radio(page, `Theme: ${theme}`).check()
      await page.keyboard.press('Escape')
      expect(await effective(page, 'theme')).toBe(theme.toLowerCase())

      const seen: string[] = []
      for (const accent of ACCENTS) {
        await openFromNav(page)
        await radio(page, `Accent: ${accent.label}`).check()
        expect(await effective(page, 'accent'), `${accent.id} in ${theme}`).toBe(accent.id)
        await page.keyboard.press('Escape')
        seen.push(await read())
      }
      // Four accents have to look like four accents, in each theme. An
      // implementation that set the attribute and left the token resolving
      // produces four identical readings here.
      expect(new Set(seen).size, `distinct accents in ${theme}`).toBe(ACCENT_IDS.length)
    }
  })

  test('the choice survives a reload, so it is a preference and not a session', async ({
    page,
    goto,
  }) => {
    await goto('/')
    await openFromNav(page)
    await radio(page, 'Accent: Ember').check()
    expect(await effective(page, 'accent')).toBe('amber')
    await page.keyboard.press('Escape')

    // A preference that only lives in a mounted component is a preference that
    // disappears. This is the claim `Editor.tsx` mounts `useAppearance` for.
    await page.reload()
    expect(await effective(page, 'accent')).toBe('amber')
    await openFromNav(page)
    await expect(radio(page, 'Accent: Ember')).toBeChecked()
    await expect(radio(page, 'Accent: Evergreen')).not.toBeChecked()
  })

  test('Reset puts every setting back, and the reset survives a reload too', async ({
    page,
    goto,
  }) => {
    await goto('/')
    await openFromNav(page)
    await radio(page, 'Accent: Ember').check()
    await radio(page, 'Density: Roomy').check()
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled()

    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    // A default is not written as a literal: the attribute has to go, so that
    // `:root:not([data-accent])` can fall through to the first token.
    expect(await effective(page, 'accent')).toBe(DEFAULT_APPEARANCE.accent)
    expect(await effective(page, 'density')).toBe(DEFAULT_APPEARANCE.density)
    await expect(page.locator('html')).not.toHaveAttribute('data-accent', 'amber')
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()

    await page.reload()
    expect(await effective(page, 'accent')).toBe(DEFAULT_APPEARANCE.accent)
    expect(await effective(page, 'density')).toBe(DEFAULT_APPEARANCE.density)
  })
})

test.describe('the appearance panel is operable with only a keyboard', () => {
  test('Tab reaches every setting, arrows choose, Escape restores focus', async ({
    page,
    goto,
    browserName,
  }) => {
    test.skip(
      !FULL_TAB_NAVIGATION.test(browserName),
      "WebKit only Tabs to form controls unless Safari's full keyboard access is on",
    )
    await goto('/')
    const trigger = page.getByRole('button', { name: APPEARANCE, exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    // Focus lands on the panel itself, so the reader is inside the dialog before
    // the first Tab and the first thing they meet is the heading's control, not
    // the middle of a list.
    await expect(panel(page)).toBeFocused()

    // The head's Close is first in the tab order — a dismiss control above the
    // content is the convention, and it is a real control rather than a gesture.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused()

    // A native radio group is ONE tab stop — the checked option — and the arrow
    // keys walk the rest. That is the whole reason the control is a real radio
    // and not six buttons with a hand-rolled key handler.
    await page.keyboard.press('Tab')
    await expect(radio(page, 'Theme: Match system')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(radio(page, 'Theme: Light')).toBeChecked()
    await expect(radio(page, 'Theme: Light')).toBeFocused()
    expect(await effective(page, 'theme')).toBe('light')
    await page.keyboard.press('ArrowDown')
    await expect(radio(page, 'Theme: Dark')).toBeChecked()
    await page.keyboard.press('Space')
    expect(await effective(page, 'theme')).toBe('dark')

    // Every remaining group is one stop away, in reading order.
    for (const name of [
      'Accent: Evergreen',
      'Density: Default',
      'Text size: Default',
      'Motion: Animations on',
      'Icon size: Default',
    ]) {
      await page.keyboard.press('Tab')
      await expect(radio(page, name), name).toBeFocused()
    }
    // The last stop is the reset, and the one after it is outside the panel —
    // which closes it, so a keyboard user walks on down the page instead of
    // hitting a trap.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(panel(page)).toHaveCount(0)
  })

  test('arrows walk every option in a group and wrap at both ends', async ({ page, goto }) => {
    await goto('/')
    await openFromNav(page)
    await expect(page.getByRole('radio')).toHaveCount(19)
    // The APG order: the next option in the group, wrapping at both ends, and
    // from the middle option that is the *last* one, not the first.
    await radio(page, 'Density: Default').focus()
    for (const name of ['Density: Roomy', 'Density: Compact', 'Density: Default']) {
      await page.keyboard.press('ArrowDown')
      await expect(radio(page, name), name).toBeChecked()
    }
    expect(await effective(page, 'density')).toBe(DEFAULT_APPEARANCE.density)
    for (const name of ['Density: Compact', 'Density: Roomy']) {
      await page.keyboard.press('ArrowUp')
      await expect(radio(page, name), name).toBeChecked()
    }
    expect(await effective(page, 'density')).toBe('roomy')
    await expect(page.locator('html')).toHaveAttribute('data-density', 'roomy')
  })

  test('Escape closes the panel and hands focus back to the opener', async ({ page, goto }) => {
    await goto('/')
    const trigger = page.getByRole('button', { name: APPEARANCE, exact: true })
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
})

test.describe('the help overlay is a dialog a keyboard can leave', () => {
  test('opens, cycles, and closes on Escape, returning focus to the opener', async ({
    page,
    goto,
    loadSample,
  }) => {
    await goto('/editor')
    await loadSample()
    const opener = page.getByRole('button', { name: 'More options' })
    await opener.click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()

    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(help).toBeVisible()
    await expect(help).toHaveAttribute('aria-modal', 'true')
    await expect(help).toBeFocused()

    // Derived from the shortcut table rather than written down, so the sheet
    // and the table cannot be counted independently and drift.
    await expect(help.getByRole('term')).toHaveCount(shortcutRows('MacIntel').length)
    // No fit-to-screen shortcut exists anywhere in the product. The sheet used
    // to claim `0 / 1` was "Fit / 100%".
    await expect(help).not.toContainText('Fit to screen')

    // Tab and Shift+Tab both stay inside, in both directions.
    await page.keyboard.press('Tab')
    await expect(help.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(help).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(help.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(help).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(help).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})

test.describe('the chrome fits the width it is given, and keeps its footer on screen', () => {
  /**
   * Two layout claims that were both real defects, and both of which a jsdom or
   * a single-viewport assertion cannot make.
   *
   * `scrollWidth <= clientWidth` is the *whole* claim for the first one, and it is
   * also the claim most easily satisfied by nothing: inject a `min-width` wider
   * than the window and both numbers grow together, so the comparison passes on
   * a page that scrolls sideways exactly as far as before. That is why the
   * measurement below is anchored to `window.innerWidth` and to the width this
   * test asked for — an assertion that cannot be satisfied by changing the
   * numbers it compares is not a gate.
   *
   * Both are also viewport claims, so they run at 390×844 rather than at whatever
   * `Desktop Chrome` happens to be. A panel that fits 1280 is fitted to nothing.
   */
  const PHONE = { width: 390, height: 844 }

  test('the Hub nav fits 390px, measured against the width the test asked for', async ({
    page,
    goto,
  }) => {
    await page.setViewportSize(PHONE)
    await goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const measured = await page.evaluate(() => {
      const root = document.documentElement
      const nav = document.querySelector('header')
      // Every laid-out box inside the header, not a list of classes: a class this
      // test hard-codes is a class the next rename can empty, and the claim here
      // is about the widest thing the nav draws.
      const inside = nav ? [nav, ...Array.from(nav.querySelectorAll('*'))] : []
      const boxes = inside.map((node) => node.getBoundingClientRect())
      return {
        innerWidth: window.innerWidth,
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        navWidth: nav ? nav.getBoundingClientRect().width : 0,
        widestRight: boxes.reduce((widest, box) => Math.max(widest, box.right), 0),
        widestLeft: boxes.reduce((narrowest, box) => Math.min(narrowest, box.left), Infinity),
        drawnCount: boxes.filter((box) => box.width > 0 && box.height > 0).length,
      }
    })

    // The gate is about *this* viewport. Widening the document widens both sides
    // of the comparison, so a `min-width` injection passes a bare
    // `scrollWidth <= clientWidth`; these two lines are what stop it.
    expect(measured.innerWidth).toBe(PHONE.width)
    expect(measured.clientWidth).toBe(PHONE.width)
    // And there is chrome to overflow: the nav held 410px of items in a 334px box,
    // which is how the whole Hub page came to scroll sideways.
    expect(measured.drawnCount, 'the nav has boxes to measure').toBeGreaterThan(5)
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth)
    expect(measured.bodyScrollWidth).toBeLessThanOrEqual(measured.clientWidth)
    // The nav itself, and the furthest-right thing it draws, are both on screen.
    expect(measured.navWidth).toBeLessThanOrEqual(PHONE.width)
    expect(measured.widestRight).toBeLessThanOrEqual(PHONE.width)
    expect(measured.widestLeft).toBeGreaterThanOrEqual(0)
  })

  test('the appearance panel keeps "Reset to defaults" above the fold at 390px', async ({
    page,
    goto,
  }) => {
    await page.setViewportSize(PHONE)
    await goto('/')
    // Seeded rather than clicked: the panel's `max-height` is
    // `100dvh - --ie-panel-chrome`, and the only way to reach the case where the
    // cap is wrong is the settings that make the panel tallest. A partial payload
    // is deliberate — `coerceAppearance` fills the other four from the defaults.
    await page.evaluate(() => {
      localStorage.setItem(
        'image-editor-appearance',
        JSON.stringify({ density: 'roomy', textScale: 'xlarge' }),
      )
    })
    await page.reload()
    await expect(page.locator('#root')).not.toBeEmpty()
    await expect(page.locator('html')).toHaveAttribute('data-density', 'roomy')
    await expect(page.locator('html')).toHaveAttribute('data-text', 'xlarge')

    await openFromNav(page)
    const reset = page.getByRole('button', { name: 'Reset to defaults' })
    await expect(reset).toBeVisible()

    const measured = await reset.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return {
        bottom: box.bottom,
        top: box.top,
        innerHeight: window.innerHeight,
        // Visible, on screen and *pressable* are three claims. A footer that is
        // in the viewport with something painted over it is not above the fold.
        selfHit: hit !== null && (hit === node || node.contains(hit)),
      }
    })

    expect(measured.innerHeight).toBe(PHONE.height)
    expect(measured.top).toBeGreaterThan(0)
    expect(measured.bottom, 'the panel footer is under the fold').toBeLessThanOrEqual(
      measured.innerHeight,
    )
    expect(measured.selfHit, 'something is painted over the reset button').toBe(true)
  })
})

/**
 * The editor's appearance panel, which is not the Hub's.
 *
 * Two measured defects, and both of them are the panel borrowing the wrong
 * numbers from the surface it is not on:
 *
 *   1. `.editor` positioned itself at `calc(48px + --ie-safe-top)` against a
 *      **52px** top bar, so 4px of the panel sat under the bar. The bar's own
 *      height is already a token — `--ie-topbar-height`, declared on `.editor`
 *      in `editor.module.css` and inherited by the panel — and the rule
 *      hard-coded a third number that could not disagree with it, only be
 *      disagreed with.
 *   2. The panel's `max-height` is `100dvh - var(--ie-panel-chrome, 108px)`, and
 *      `108px` is the Hub's *fallback*: the editor never declared the variable,
 *      so the cap was sized for a nav that is not on this page. At 390×844 that
 *      put a 734px panel in a 736px box — two pixels of slack, which is not a
 *      design decision, it is the difference between a panel that grows and one
 *      that clips the moment the settings get a line taller.
 *
 * Both are asserted in a real browser because both are geometry: jsdom reports
 * `scrollWidth === clientWidth === 0` for every element, so a jsdom version of
 * the first assertion passes on a panel that overlaps the bar by any amount.
 */
test.describe("the editor's appearance panel clears the editor's own bar", () => {
  const PHONE = { width: 390, height: 844 }

  for (const look of [
    { name: 'default', stored: null as Record<string, string> | null },
    { name: 'roomy and xlarge', stored: { density: 'roomy', textScale: 'xlarge' } },
  ]) {
    test(`it starts below the top bar and is not 2px from clipping (${look.name})`, async ({
      page,
      goto,
      loadSample,
    }) => {
      await page.setViewportSize(PHONE)
      await goto('/editor')
      if (look.stored) {
        await page.evaluate((stored) => {
          localStorage.setItem('image-editor-appearance', JSON.stringify(stored))
        }, look.stored)
        await page.reload()
        await expect(page.locator('#root')).not.toBeEmpty()
      }
      await loadSample()

      await openFromEditor(page)
      const measured = await panel(page).evaluate((node) => {
        const bar = document.querySelector('header')
        const barBox = bar?.getBoundingClientRect()
        const box = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          innerHeight: window.innerHeight,
          barBottom: barBox?.bottom ?? null,
          barHeight: barBox?.height ?? null,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          maxHeight: style.maxHeight,
          // Read, not assumed: the fallback is the Hub's, and a declaration that
          // never lands is invisible to everything except this line.
          declaredChrome: style.getPropertyValue('--ie-panel-chrome').trim(),
        }
      })

      expect(measured.innerHeight).toBe(PHONE.height)
      expect(measured.barHeight, 'the editor top bar is 52px').toBe(52)
      // 1. Below the bar, not under it. The panel is 4px too low otherwise, and
      //    a panel whose own title row is 4px under a bar is a panel that reads
      //    as clipped even where nothing is clipped.
      expect(measured.top, 'the panel overlaps the top bar').toBeGreaterThanOrEqual(
        measured.barBottom ?? 0,
      )
      // 2. Sized from the editor's own chrome, not the Hub's fallback.
      expect(measured.declaredChrome, 'the editor never declared its own panel chrome').not.toBe('')
      // 3. The box has room for its content. `scrollHeight > clientHeight` on the
      //    panel itself — as opposed to its scrolling body — is content that
      //    cannot be reached at all.
      expect(
        measured.scrollHeight - measured.clientHeight,
        'the panel clips its own content',
      ).toBeLessThanOrEqual(0)
      // And it stays on the screen, which the cap above is what guarantees.
      expect(measured.bottom, 'the panel runs under the fold').toBeLessThanOrEqual(
        measured.innerHeight,
      )
    })
  }
})

test.describe('the licences are a page a user can actually reach', () => {
  test('the Hub footer links them and names the build', async ({ page, goto }) => {
    await goto('/')
    const footer = page.locator('footer')
    await expect(footer).toContainText('Licences and attribution')
    await expect(footer).toContainText(licencesSummary())
    // The one version string the app prints, and the one a bug report needs.
    // It is asserted against `package.json` rather than against `buildLabel()`:
    // the label's identifiers are compile-time substitutions, and the e2e
    // process is not the bundler, so importing it here would compare the browser
    // against `0.0.0-dev (unknown)` and prove nothing.
    await expect(footer).toContainText(PACKAGE_VERSION)
    await expect(footer).toContainText(/\((?:[0-9a-f]{7,}|unknown)\)/)

    await page.getByRole('link', { name: /Licences and attribution/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Licences and attribution')
    // The entry that changes what this project may ship, first among the rest.
    await expect(page.getByRole('rowheader', { name: /@imgly\/background-removal/ })).toBeVisible()
    await expect(page.getByRole('link', { name: '/fonts/OFL-1.1.txt' })).toBeVisible()
    await expect(page.getByRole('link', { name: '/fonts/Apache-2.0.txt' })).toBeVisible()
  })

  test('the licence texts are fetchable, because a link is not a copy', async ({ page }) => {
    // Not the `goto` fixture: it waits for the app's `#root` to fill, and this
    // document is deliberately a static file with no app in it — which is the
    // point, since it has to work from a crash screen.
    await page.goto('licenses.html')
    const ofl = await page.request.get('fonts/OFL-1.1.txt')
    expect(ofl.ok()).toBe(true)
    expect(await ofl.text()).toContain('SIL OPEN FONT LICENSE Version 1.1')
    const apache = await page.request.get('fonts/Apache-2.0.txt')
    expect(apache.ok()).toBe(true)
    expect(await apache.text()).toContain('Apache License')
  })
})
