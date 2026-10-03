import type { Locator, Page } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import { writePng } from './scene'

/**
 * Layout at the widths where the chrome and a panel compete for the same pixels.
 *
 * Four defects lived here, and all four were the same mistake in four costumes:
 * something that is always on screen — a sheet, a chip row, a toast — was laid
 * out without asking where the two bars already are.
 *
 *   1. On a phone, `BottomSheet` was `position: fixed` with `bottom: 0`, so a
 *      panel's bottom edge was the *viewport's* bottom edge — the tool tab bar's.
 *      All thirteen tabs, and `Done`, and `More options`, were under a sheet and
 *      under its backdrop. The desktop inspector had already been moved into a
 *      grid column beside the canvas for exactly this reason
 *      (`e2e/journey.inspector-layout.spec.ts`); the mobile sheet was left
 *      `fixed`, and a tool you cannot open is a tool that does not exist.
 *   2. The crop and passport chip rows scrolled sideways inside a 360px column
 *      with a 34px fade over the trailing edge — a fade narrower than the label
 *      it covers, so the affordance saying "there is more" was also what made a
 *      chip read as a truncated word.
 *   3. The Adjust panel's parameter rings did the same with no fade at all, and
 *      "Contrast" arrived as "Con".
 *   4. The toast stack sat at the bottom of the viewport, which on this app is
 *      chrome and panel, so an error message landed on the control it was about.
 *
 * Every assertion here is a *measurement in a real browser*, and that is not
 * politeness. jsdom lays nothing out: `scrollWidth` and `clientWidth` are both
 * `0` for every element, so a jsdom assertion of `scrollWidth <= clientWidth`
 * passes on a row that overflows by 780px — which is exactly what a browser
 * assertion in this file exists to make impossible. Where the claim is "you can
 * press it", the assertion is `document.elementFromPoint` at the control's own
 * centre, because a control can be visible, in the accessibility tree, and dead
 * under an overlay, and only a hit test knows.
 */

/** Every tool the tab bar offers. Thirteen, because thirteen is the answer. */
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

/**
 * The appearance settings a layout has to survive.
 *
 * Density, text size and icon size are not a skin: they move hit heights, type
 * and glyphs inside the bars and inside every panel, and they are real settings
 * a reader can pick. A layout that only fits at the default is broken for the
 * people who needed the setting, so each of these is walked with the bar hit
 * testing below rather than assumed from a measurement taken at default.
 */
const APPEARANCES: {
  name: string
  stored: Record<string, string>
  density: string | null
  text: string | null
}[] = [
  { name: 'default', stored: {}, density: null, text: null },
  { name: 'roomy', stored: { density: 'roomy' }, density: 'roomy', text: null },
  { name: 'xlarge text', stored: { textScale: 'xlarge' }, density: null, text: 'xlarge' },
  {
    name: 'roomy and xlarge',
    stored: { density: 'roomy', textScale: 'xlarge', iconScale: 'xlarge' },
    density: 'roomy',
    text: 'xlarge',
  },
]

/** The tab bar, addressed by the navigation landmark's name. */
const tabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Editor tools' }).getByRole('button')

/**
 * Pick an appearance the way a reader does: by setting it and letting the app
 * boot into it.
 *
 * The stored payload is deliberately partial. `coerceAppearance` fills every
 * field it is not given from the defaults, so this writes the two keys under test
 * and leaves the other four — theme, motion, accent and the rest — alone.
 *
 * Called *before* the sample is loaded, which is not tidiness. Appearance is read
 * at boot, so getting it onto the page needs a reload; and a reload after a sample
 * is loaded lands on the import screen rather than the editor, because the app
 * restores from its own `localStorage` mirror, which is written on a debounce.
 * Setting the preference first and then loading the photo keeps both in the order
 * a reader does them and needs no second reload.
 */
async function setAppearance(page: Page, stored: Record<string, string>): Promise<void> {
  if (Object.keys(stored).length === 0) return
  await page.evaluate((value: Record<string, string>) => {
    localStorage.setItem('image-editor-appearance', JSON.stringify(value))
  }, stored)
  await page.reload()
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
}

/** Open a tool by its accessible name, and wait for the tab to say so. */
async function openTool(page: Page, name: string): Promise<void> {
  const tab = page
    .getByRole('navigation', { name: 'Editor tools' })
    .getByRole('button', { name, exact: true })
  await tab.click()
  await expect(tab, `${name} did not open`).toHaveAttribute('aria-current', 'true')
}

/**
 * One tab, measured the way a finger finds it.
 *
 * `scrollLeft` is set rather than left to `scrollIntoView` so the row's scroll
 * position is a fact this test chose, not a browser default that could change;
 * the measurement then asks the only question that matters — *is the topmost
 * element at this point this tab?* — and records whether the tab is inside the
 * viewport at all, which is the difference between "reachable" and "present".
 */
async function probeTab(
  page: Page,
  index: number,
): Promise<{
  name: string
  fullyOnScreen: boolean
  selfHit: boolean
  labelOverflow: number
}> {
  const tab = tabs(page).nth(index)
  return tab.evaluate((node: HTMLElement) => {
    const row = node.parentElement as HTMLElement
    const rowBox = row.getBoundingClientRect()
    // Scroll the row so this tab sits at its left edge, clamped to the row's own
    // scroll range — the same thing a thumb drag does. The target is *absolute*
    // (current scroll plus the tab's offset within the visible box), because the
    // box a `getBoundingClientRect` reports is already scroll-adjusted and adding
    // it as a delta drifts by the previous tab's scroll every time round.
    const offsetInView = node.getBoundingClientRect().left - rowBox.left
    row.scrollLeft = Math.max(
      0,
      Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + offsetInView - 8),
    )
    const box = node.getBoundingClientRect()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const hit = document.elementFromPoint(cx, cy)
    return {
      name: (node.textContent ?? '').trim(),
      fullyOnScreen:
        box.x >= 0 &&
        box.right <= window.innerWidth &&
        box.y >= 0 &&
        box.bottom <= window.innerHeight,
      selfHit: hit !== null && (hit === node || node.contains(hit)),
      // A tab whose own label is wider than the tab is a name that has been cut
      // off, and "Background" was: 68px of text in a 46px content box, clipped at
      // both ends by the tab's own `overflow: hidden`. Reachable and unreadable is
      // still unreadable, so the hit test above is not enough on its own.
      labelOverflow: node.scrollWidth - node.clientWidth,
    }
  })
}

/**
 * Chip rows in the Crop and Passport panels are the ones this change owns the
 * layout of, and `measureChipRows` measures *every* `[role="group"]` in whichever
 * panel is open — so scoping happens by which panel is opened, not by a selector
 * list that could fall behind. One row in the Frame panel still scrolls sideways
 * in a file this change does not touch (see the handoff), and a gate that fails
 * for a reason nobody is fixing is a gate that gets disabled.
 */

test.describe('the bars survive a panel', () => {
  test.slow()

  for (const look of APPEARANCES) {
    test(`at 390x844 every one of the thirteen tool tabs can be pressed with a panel open (${look.name})`, async ({
      goto,
      loadSample,
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await goto('/editor')
      await setAppearance(page, look.stored)
      await loadSample()
      if (look.density)
        await expect(page.locator('html')).toHaveAttribute('data-density', look.density)
      if (look.text) await expect(page.locator('html')).toHaveAttribute('data-text', look.text)

      // Thirteen, read out of the DOM rather than written here, so this file
      // cannot go stale when a tool is renamed — but still *counted*, because
      // "thirteen tabs are reachable" is a claim about thirteen.
      await expect(tabs(page)).toHaveCount(TOOLS.length)

      // The state under test: a tool is already open, so the panel is already
      // competing for the space. Passport is the tallest panel in the app, which
      // is why it is the one the defect was found with.
      await openTool(page, 'Passport')
      await expect(page.getByRole('dialog', { name: 'Passport' })).toBeVisible()

      for (let index = 0; index < TOOLS.length; index += 1) {
        const probe = await probeTab(page, index)
        expect(probe.name, 'the tab bar has thirteen tabs, in order').toBe(TOOLS[index])
        expect(
          probe.fullyOnScreen,
          `${probe.name}: the tab is off the screen at ${look.name}`,
        ).toBe(true)
        expect(probe.selfHit, `${probe.name}: something is on top of the tab at ${look.name}`).toBe(
          true,
        )
        expect(
          probe.labelOverflow,
          `${probe.name}: the tab's own label is cut off at ${look.name}`,
        ).toBeLessThanOrEqual(1)

        // And then actually press it, which is Playwright's own hit test plus a
        // `click`, so the measurement above and the thing a person does agree.
        await tabs(page).nth(index).click()
        await expect(tabs(page).nth(index), `${probe.name} did not open`).toHaveAttribute(
          'aria-current',
          'true',
        )
      }

      await page.screenshot({
        path: `.playwright-mcp/responsive-tabs-390-${look.name.replace(/\s+/g, '-')}.png`,
      })
    })
  }

  test('the sheet and its scrim stop at the tab bar, and the top bar stays lit and clickable', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample()
    await openTool(page, 'Passport')

    const bars = await page.evaluate(() => {
      const box = (node: Element | null) => {
        if (!node) return null
        const b = node.getBoundingClientRect()
        return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }
      }
      const nav = document.querySelector('nav[aria-label="Editor tools"]')
      const header = document.querySelector('header')
      const sheet = document.querySelector('section[role="dialog"]')
      const scrim = Array.from(document.querySelectorAll('body *')).find((node) => {
        const style = getComputedStyle(node)
        return style.zIndex === '40' && style.background.includes('0.45')
      })
      const doneEl: HTMLButtonElement | null =
        Array.from(header?.querySelectorAll('button') ?? []).find(
          (b) => (b.textContent ?? '').trim() === 'Done',
        ) ?? null
      const doneBox = doneEl ? doneEl.getBoundingClientRect() : null
      const doneHit = doneBox
        ? document.elementFromPoint(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2)
        : null
      return {
        nav: box(nav ?? null),
        header: box(header ?? null),
        sheet: box(sheet ?? null),
        scrim: box(scrim ?? null),
        doneIsItsOwnHitTest:
          doneEl !== null && doneHit !== null && (doneHit === doneEl || doneEl.contains(doneHit)),
      }
    })

    // The sheet's bottom edge *is* the tab bar's top edge. Not "near" it, and
    // not with a token somewhere that could drift from the bar it clears.
    expect(bars.sheet?.bottom).toBeCloseTo(bars.nav?.top ?? -1, 0)
    // And the scrim covers the canvas region only, so the bars are not dimmed
    // either — the same statement, made about the veil rather than the panel.
    expect(bars.scrim?.bottom).toBeCloseTo(bars.nav?.top ?? -1, 0)
    expect(bars.scrim?.top).toBeCloseTo(bars.header?.bottom ?? -1, 0)
    // `Done` and the tab bar are the topmost things at their own centres. The
    // tab is probed through `probeTab`, which scrolls the row first — the bar is a
    // horizontal scroller, so tab zero can be half off the screen after a tap on
    // tab twelve, and a hit test at a point that is not on the screen proves
    // nothing either way.
    expect(bars.doneIsItsOwnHitTest, 'Done is covered').toBe(true)
    const firstTab = await probeTab(page, 0)
    expect(firstTab.selfHit, 'the tab bar is covered').toBe(true)
  })
})

test.describe('no label is cut off at any width the app is used at', () => {
  test.slow()

  for (const width of [360, 390, 430, 1280]) {
    test(`every chip label in the crop and passport panels is whole at ${width}px`, async ({
      goto,
      loadSample,
      page,
    }) => {
      await page.setViewportSize({ width, height: width < 900 ? 844 : 900 })
      await goto('/editor')
      await loadSample()

      await openTool(page, 'Crop')
      await measureChipRows(page)
      await openTool(page, 'Passport')
      await measureChipRows(page)
    })
  }

  test('and the panel itself never has to be scrolled sideways to reach a control', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await goto('/editor')
    await loadSample()

    for (const name of ['Crop', 'Passport', 'Adjust', 'Export']) {
      await openTool(page, name)
      const sheet = page.getByRole('dialog')
      const overflow = await sheet.evaluate((node) => node.scrollWidth - node.clientWidth)
      expect(overflow, `${name}: the whole panel scrolls sideways`).toBeLessThanOrEqual(1)
    }
  })
})

/**
 * The top bar's title, measured from the painted line.
 *
 * Which end of the name survived is read with a `Range` over the first and last
 * character rather than off the string: `text-overflow` never changes
 * `textContent`, so the string is the same before and after and only the painted
 * line differs. A range's client rect is the browser's own answer to "where did
 * you put this character", which is the question.
 *
 * `scrollWidth - clientWidth` is deliberately **not** how "is it cut" is decided,
 * and its absence is the fix rather than an omission. Both are integers, so a
 * real 1.36px clip reports as `1`: at 360px with Extra-large text and default
 * density the box is 74.12px, the name wants 75.48px, `cut` reads `0`, and a test
 * that believes it has to see the last character whole fails on a name the
 * browser has already ellipsised ("Sampl…", measured). Two precisions disagreed
 * and the coarser one decided. Both ends painted is whole, and that is a
 * statement about the same geometry every assertion below is made of.
 */
async function measureTitle(bar: Locator, name: string) {
  return bar.evaluate((node, expected) => {
    // Found by the text it carries rather than by `title`, so that a bar
    // without the tooltip still gets measured: the claim being tested is
    // where the clip falls, and a test that cannot find the element cannot
    // tell "truncated in the wrong place" from "not there".
    const title = Array.from(node.querySelectorAll('span')).find(
      (span) => (span.textContent ?? '').trim() === expected,
    )
    if (!title) throw new Error(`the top bar does not show ${expected}`)
    const run = (title.querySelector('bdi') ?? title).firstChild
    if (!run || run.nodeType !== Node.TEXT_NODE) throw new Error('the title has no text run')
    const text = run as Text
    const box = title.getBoundingClientRect()
    const style = getComputedStyle(title)
    const range = document.createRange()
    const rectAt = (from: number, to: number) => {
      range.setStart(text, from)
      range.setEnd(text, to)
      const r = range.getBoundingClientRect()
      return { left: r.left - box.left, right: r.right - box.left }
    }
    const inside = (r: { left: number; right: number }) =>
      r.left >= -0.5 && r.right <= box.width + 0.5
    /**
     * Whether a character is painted, which is a question about its advance and
     * not only about where its box landed. Both halves are needed and the
     * asymmetry is the bug this replaced: the two engines spell "not painted"
     * differently — Chromium puts a clipped character's rect *outside* the box
     * (−179.8 … −168.3 for the “S” of a long name at 430) while WebKit collapses
     * it to no advance at the clip edge (52.12 … 52.12, inside the box). A rule
     * that tested only the head's position therefore read WebKit's clipped tail
     * as surviving, and a name cut at its end passed as whole. Advance is the
     * half both engines agree on, so both ends get both halves.
     */
    const painted = (from: number, to: number) => {
      const r = rectAt(from, to)
      return inside(r) && r.right - r.left >= 1
    }
    return {
      text: (title.textContent ?? '').trim(),
      title: title.getAttribute('title'),
      direction: style.direction,
      align: style.textAlign,
      overflow: style.textOverflow,
      width: box.width,
      clientWidth: title.clientWidth,
      // The first and last character of the name, in the title's own box.
      head: rectAt(0, 1),
      tail: rectAt(text.length - 1, text.length),
      headPainted: painted(0, 1),
      tailPainted: painted(text.length - 1, text.length),
    }
  }, name)
}

/**
 * The two ends a name may be cut at, and the width each belongs to.
 *
 * `.topBarTitle` is an RTL box with a `<bdi>` in it, so `text-overflow` puts the
 * ellipsis at the *start* and the tail — the part of a file name that tells it
 * from its neighbours — is what survives. At 360px with Roomy density and
 * Extra-large text it paints "…le 1", and the overflow button's own three dots
 * are 8px away: `…le 1` `•••` reads as one control rather than as a name and a
 * menu. That is a measured defect, not a preference, so the stylesheet flips the
 * box to LTR below 420px and the name is cut at its end there instead. The cost
 * is real and is asserted rather than hidden: at 360px the same long name reads
 * "Scr…", which identifies nothing.
 *
 * So the claim this file makes is not "the ellipsis is at the start" — it is
 * "the ellipsis is at the end this width can afford, and the name cannot be cut
 * at the wrong one". Both widths are measured on the *same* document below, so
 * the two fixes cannot be quietly traded for one another.
 */
test.describe('the top bar holds its file name at 360px', () => {
  /**
   * The one thing in the bar that is a *label* rather than a control.
   *
   * At 360px the bar holds five `--ie-tap` controls — 49.5px each under Roomy
   * density, with a word of "Done" at 71.9px beside them — and 32px of padding
   * and gaps, which leaves 52.1px of the 75px "Sample 1" needs at Extra-large
   * text. The name is the only flexible item, so it absorbed the whole 23px.
   *
   * The name cannot be made to *fit* at that size — measured, showing all 75px
   * puts the right-hand group at x=375 in a 360px viewport, so the primary
   * action leaves the screen, which is the trade this must not make. So what is
   * asserted is that the clip falls at the end 360px can afford, that the
   * characters that survive are the ones that width keeps, and that the whole
   * name is one hover away.
   */
  test.slow()

  for (const look of APPEARANCES) {
    test(`the name is whole, or cut at its end, and the action is never the one cut (${look.name})`, async ({
      goto,
      loadSample,
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 780 })
      await goto('/editor')
      await setAppearance(page, look.stored)
      await loadSample()
      if (look.density)
        await expect(page.locator('html')).toHaveAttribute('data-density', look.density)
      if (look.text) await expect(page.locator('html')).toHaveAttribute('data-text', look.text)

      const name = 'Sample 1'
      const bar = page.locator('header')
      await expect(bar).toContainText(name)
      const measured = await measureTitle(bar, name)

      // The name is intact as a string in every appearance: `<bdi>` isolates it
      // from the box's own direction rather than reordering the characters,
      // which is why this is an equality and not a "contains".
      expect(measured.text).toBe(name)
      expect(measured.overflow).toBe('ellipsis')
      expect(measured.width, 'the title has a box at all').toBeGreaterThan(0)

      // Taken before the assertions rather than after them, so a look that fails
      // leaves the picture of what it painted next to the failure. A test that
      // only screenshots its own success has no evidence for its own defect.
      await page.screenshot({
        path: `.playwright-mcp/topbar-360-${look.name.replace(/\s+/g, '-')}.png`,
      })

      // Whole is *both* ends painted, which is the same geometry the claims
      // below are made of. See `measureTitle` for why `scrollWidth` cannot
      // answer it: it rounds a 1.36px clip down to "no clip".
      if (measured.headPainted && measured.tailPainted) {
        // There was room, so nothing may be cut and the name is whole.
        expect(measured.title, 'the whole name is one hover away').toBe(name)
        return
      }

      // There was not, and 360px is a narrow phone: the end that may be cut is
      // the *end*. The head — "Sampl…" of a name that is not four characters
      // long — is the wrong end here for a reason that is measured rather than
      // argued, in the block above, and the long-name case below asserts the
      // other half of the same trade on the same document at another width.
      expect(measured.tailPainted, `the name's tail was the part cut off (${look.name})`).toBe(
        false,
      )
      expect(measured.headPainted, `the name's head is the part still shown (${look.name})`).toBe(
        true,
      )
      // And the mechanism is named, so a fix that happens to work today cannot
      // quietly stop working: an LTR box below 420px, which puts the ellipsis
      // after the word instead of before it. The alternative at this width paints
      // "…le 1" against the overflow button's three dots, and the two read as one
      // control. A centred line is the one outcome with no characters in it at
      // all, at either direction, so the alignment is pinned too.
      expect(measured.direction, 'a narrow phone clips the end').toBe('ltr')
      expect(measured.align, 'a centred line is clipped at both ends').toBe('left')
      // Last, because it is the weakest of these claims and asserting it first
      // would hide the one that matters behind "there is no tooltip".
      expect(measured.title, 'the whole name is one hover away').toBe(name)
    })
  }

  test('and a long name keeps the end that identifies it, at every width but a phone’s', async ({
    goto,
    canvas,
    page,
  }) => {
    // "Screenshot 2026-10-03 at 14.22.51" shares its head with every other
    // screenshot taken that day and differs only at the end, so a name cut at
    // its start is a name that cannot be told from its neighbours. That is what
    // the RTL box with a `<bdi>` is for, and it is why the front ellipsis has to
    // be asserted *on pixels*: `journey.panel-seams.spec.ts` checks the computed
    // `direction` at 430 and 1280, which is the mechanism, and a box can be RTL
    // and still paint the wrong end of the string.
    //
    // The same document is then measured at 360, where the product deliberately
    // cuts at the other end — the trade the block above records. Asserting both
    // widths from one document is the point: a fix for the ellipsis landing on
    // the menu's dots that took the front ellipsis with it would pass every
    // direction check in the suite and fail this one.
    //
    // A real file, not a sample tile: the top bar's title is the name the user
    // brought with them, and a sample is called "Sample 1" whatever the viewport
    // does. The extension is dropped on the way in — `Editor.tsx` strips it before
    // the name reaches the bar — so the expected string has none.
    const file = join(tmpdir(), 'Screenshot 2026-10-03 at 14.22.51.png')
    const name = 'Screenshot 2026-10-03 at 14.22.51'

    for (const width of [430, 360]) {
      await page.setViewportSize({ width, height: width < 900 ? 844 : 900 })
      await goto('/editor')
      await writePng(page, file, 64)
      // The first file input is the import screen's; the second is the camera
      // row's and only exists on a touch device, so it cannot be what is set.
      await page.locator('input[type="file"]').first().setInputFiles(file)
      await expect(canvas()).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Editor tools' })).toBeVisible()

      const measured = await measureTitle(page.locator('header'), name)
      expect(measured.text, `${width}px: the bar shows the file's name`).toBe(name)
      expect(measured.title, `${width}px: the whole name is one hover away`).toBe(name)
      // 302px of name in a 122px box at 430 and a 52px one at 360, so this is a
      // cut in both cases and the assertions below are about a real one.
      expect(
        measured.headPainted && measured.tailPainted,
        `${width}px: this name is long enough to have to be cut`,
      ).toBe(false)

      if (width > 420) {
        expect(measured.direction, `${width}px: the name is clipped from the start`).toBe('rtl')
        expect(
          measured.tailPainted,
          `${width}px: the identifying end is the part still shown`,
        ).toBe(true)
        expect(measured.headPainted, `${width}px: the shared head is the part cut off`).toBe(false)
      } else {
        expect(measured.direction, `${width}px: a phone clips at the end`).toBe('ltr')
        expect(measured.headPainted, `${width}px: the head is the part still shown`).toBe(true)
      }
    }
  })

  test('and Done is still on the screen at the tightest appearance', async ({
    goto,
    loadSample,
    page,
  }) => {
    // The counterpart to the trade above, and the reason the name truncates at
    // all: at 360 with Roomy density and Extra-large text the bar is 15px wider
    // than the viewport if the name is whole. Whichever element gives, the
    // primary action does not.
    await page.setViewportSize({ width: 360, height: 780 })
    await goto('/editor')
    await setAppearance(page, { density: 'roomy', textScale: 'xlarge' })
    await loadSample()

    const done = page.locator('header').getByRole('button', { name: 'Done', exact: true })
    await expect(done).toBeVisible()
    const measured = await done.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return {
        left: box.left,
        right: box.right,
        innerWidth: window.innerWidth,
        selfHit: hit !== null && (hit === node || node.contains(hit)),
      }
    })
    expect(measured.left).toBeGreaterThanOrEqual(0)
    expect(measured.right, 'Done is pushed off the right of the screen').toBeLessThanOrEqual(
      measured.innerWidth,
    )
    expect(measured.selfHit, 'something is painted over Done').toBe(true)
  })
})

/**
 * Every chip row in the open panel, measured.
 *
 * Three separate claims, because a row can fail any of them on its own:
 *
 *   · the row must not overflow — a wrapped row has `scrollWidth === clientWidth`,
 *     and a scrolled one does not;
 *   · the row must not *be* scrolled — a row at `scrollLeft: 120` is showing its
 *     middle, and its first chip is a fragment nobody can read;
 *   · no chip may overflow its own box — which is what "the label is truncated"
 *     means when a chip is `white-space: nowrap`.
 */
async function measureChipRows(page: Page): Promise<void> {
  const rows = await page.evaluate(() => {
    const sheet = document.querySelector('section[role="dialog"]')
    if (!sheet) return []
    return Array.from(sheet.querySelectorAll('[role="group"]')).map((row) => ({
      label: row.getAttribute('aria-label') ?? '',
      overflow: row.scrollWidth - row.clientWidth,
      scrollLeft: row.scrollLeft,
      chips: Array.from(row.querySelectorAll('button')).map((chip) => ({
        label: (chip.textContent ?? '').trim(),
        overflow: chip.scrollWidth - chip.clientWidth,
      })),
    }))
  })
  expect(rows.length, 'the panel has chip rows to measure').toBeGreaterThan(0)
  for (const row of rows) {
    expect(row.overflow, `${row.label}: the row scrolls sideways`).toBeLessThanOrEqual(1)
    expect(row.scrollLeft, `${row.label}: the row is scrolled`).toBe(0)
    expect(row.chips.length, `${row.label}: the row has chips`).toBeGreaterThan(0)
    for (const chip of row.chips) {
      expect(chip.overflow, `${row.label} · "${chip.label}" is cut off`).toBeLessThanOrEqual(1)
    }
  }
}

test.describe('the Adjust panel fits its own column', () => {
  test('the colour-band chips are all inside the grid at 1280x900, measured', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample()
    await openTool(page, 'Adjust')
    await page.getByRole('button', { name: 'Colour bands' }).click()

    const grid = page.getByRole('group', { name: 'Colour bands' })
    await expect(grid).toBeVisible()
    await grid.evaluate((node) => node.scrollIntoView({ block: 'center' }))

    const measured = await grid.evaluate((node) => {
      const box = node.getBoundingClientRect()
      return {
        overflow: node.scrollWidth - node.clientWidth,
        columns: getComputedStyle(node).gridTemplateColumns,
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        chips: Array.from(node.children).map((chip) => {
          const b = chip.getBoundingClientRect()
          return {
            label: (chip.textContent ?? '').trim(),
            left: b.left,
            right: b.right,
            top: b.top,
            bottom: b.bottom,
            width: b.width,
            height: b.height,
            overflow: chip.scrollWidth - chip.clientWidth,
          }
        }),
      }
    })

    expect(measured.overflow, 'the band grid scrolls sideways').toBeLessThanOrEqual(1)
    expect(measured.chips, 'eight bands').toHaveLength(8)
    for (const chip of measured.chips) {
      expect(chip.width, `"${chip.label}" has no width`).toBeGreaterThan(0)
      expect(chip.height, `"${chip.label}" has no height`).toBeGreaterThan(0)
      // Inside the grid's own box, to the pixel. A band whose right edge is past
      // the grid's is a band whose label runs off the edge of the column.
      expect(chip.left, `"${chip.label}" starts left of the grid`).toBeGreaterThanOrEqual(
        measured.box.left - 0.5,
      )
      expect(chip.right, `"${chip.label}" runs past the grid`).toBeLessThanOrEqual(
        measured.box.right + 0.5,
      )
      expect(chip.overflow, `"${chip.label}" is cut off inside its own chip`).toBeLessThanOrEqual(1)
    }

    await page.screenshot({ path: '.playwright-mcp/responsive-colour-bands-1280.png' })
  })

  test('all fifteen adjustment rings are whole, which is what "Con" was', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample()
    await openTool(page, 'Adjust')

    const rings = page.getByRole('toolbar', { name: 'Adjustment parameters' })
    await expect(rings).toBeVisible()
    await rings.evaluate((node) => node.scrollIntoView({ block: 'center' }))

    const measured = await rings.evaluate((node) => ({
      overflow: node.scrollWidth - node.clientWidth,
      scrollLeft: node.scrollLeft,
      chips: Array.from(node.querySelectorAll('button')).map((chip) => ({
        label: (chip.textContent ?? '').trim(),
        overflow: chip.scrollWidth - chip.clientWidth,
      })),
    }))

    expect(measured.overflow, 'the rings row scrolls sideways').toBeLessThanOrEqual(1)
    expect(measured.scrollLeft, 'the rings row is scrolled').toBe(0)
    expect(measured.chips.length, 'fifteen parameters').toBe(15)
    for (const chip of measured.chips) {
      expect(chip.overflow, `"${chip.label}" is cut off`).toBeLessThanOrEqual(1)
    }
    // And the one the report named, by its own accessible name — because
    // "Contrast" being reachable is the claim, and the ring is a button.
    await expect(page.getByRole('button', { name: /^Contrast/ })).toBeVisible()

    await page.screenshot({ path: '.playwright-mcp/responsive-adjust-rings-1280.png' })
  })
})

test.describe('a toast lands where nothing is', () => {
  test('it covers no control in the tallest panel, and no control in the bars', async ({
    goto,
    loadSample,
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample()
    await openTool(page, 'Passport')

    const message = 'Could not export this file'
    // Raised through the app's own store, on the module URL the running app
    // imported, so this is the real toast rather than a copy of one. An error
    // toast also appends to the persisted error log, which brings the
    // diagnostics panel with it, and the diagnostics panel is *also* in the stack
    // — so the log is cleared straight after to leave the toast on its own.
    await page.evaluate(async (text: string) => {
      const mod = await import(new URL('src/store/uiStore.ts', document.baseURI).href)
      mod.useUiStore.getState().pushToast(text, 'error')
      mod.useUiStore.getState().clearErrorLog()
    }, message)

    // If the import above had resolved to a second copy of the store, there
    // would be no toast and every measurement below would pass vacuously.
    const live = page.locator('[aria-live="polite"]')
    await expect(live).toContainText(message)

    const measured = await page.evaluate(() => {
      const stack = document.querySelector('[aria-live="polite"]')
      if (!stack) throw new Error('the toast stack is gone')
      const stackBox = stack.getBoundingClientRect()
      const topBar = document.querySelector('header')
      const tabBar = document.querySelector('nav[aria-label="Editor tools"]')
      const sheet = document.querySelector('section[role="dialog"]')
      const overlaps = (b: DOMRect) =>
        b.width > 0 &&
        b.height > 0 &&
        b.left < stackBox.right &&
        b.right > stackBox.left &&
        b.top < stackBox.bottom &&
        b.bottom > stackBox.top
      const labelled = (node: Element) =>
        (node.getAttribute('aria-label') ?? node.textContent ?? node.tagName).trim().slice(0, 40)
      const CONTROLS = 'button, input, [role="slider"], [role="spinbutton"]'
      const panelControls = sheet ? Array.from(sheet.querySelectorAll(CONTROLS)) : []
      const chromeControls = [
        ...Array.from(topBar?.querySelectorAll('button') ?? []),
        ...Array.from(tabBar?.querySelectorAll('button') ?? []),
      ]
      return {
        stack: {
          top: stackBox.top,
          bottom: stackBox.bottom,
          left: stackBox.left,
          right: stackBox.right,
        },
        headerBottom: topBar?.getBoundingClientRect().bottom ?? null,
        navTop: tabBar?.getBoundingClientRect().top ?? null,
        panelCovered: panelControls
          .filter((node) => overlaps(node.getBoundingClientRect()))
          .map(labelled),
        chromeCovered: chromeControls
          .filter((node) => overlaps(node.getBoundingClientRect()))
          .map(labelled),
        panelControlCount: panelControls.length,
        chromeControlCount: chromeControls.length,
      }
    })

    // The stack starts below the top bar, which is what `--ie-topbar-height` is
    // for, and it is asserted against the *measured* bar rather than against the
    // token: a bar that grows past its token fails here instead of quietly
    // dropping the toast back under the panel.
    expect(measured.stack.top).toBeGreaterThanOrEqual(measured.headerBottom ?? 0)
    expect(measured.panelCovered, 'a toast is printed across a panel control').toEqual([])
    expect(measured.chromeCovered, 'a toast is printed across a bar control').toEqual([])
    // The negative assertions above are only worth something if there were
    // controls to cover in the first place.
    expect(measured.panelControlCount).toBeGreaterThan(10)
    expect(measured.chromeControlCount).toBeGreaterThan(10)

    await page.screenshot({ path: '.playwright-mcp/responsive-toast-390.png' })
  })
})
