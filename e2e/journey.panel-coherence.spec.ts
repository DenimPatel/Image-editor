import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * D10-F01 — the seams between panels, checked where they meet.
 *
 * Each case here is a measurement a user would make with their eyes and this
 * suite makes with `getComputedStyle`. None of it can be asserted in jsdom, which
 * reports `scrollWidth === clientWidth === 0` for every element and would answer
 * "no overflow" to a layout that is entirely broken — the failure mode this file
 * exists to avoid is the opposite one, a test that passes on a defect.
 *
 * Three seams:
 *
 * 1. **A control that is not wearing the product.** `.grow` is the width every
 *    tool panel's own field shares, and the skin for it was written as
 *    `.grow[type='text'], .grow[type='number']` — an *attribute* selector. A
 *    `<textarea>` and a `<select>` carry no `type`, so the five of them in the
 *    Text and Watermark inspectors were the only user-agent widgets in the
 *    product: `#3b3b3b` on a near-black sheet, a `#858585` border, and 13.33px
 *    type in Arial for the two font pickers and in monospace for the two text
 *    fields. The one control whose whole subject is *which typeface this layer is
 *    set in* was offering its choices in a face that is not one of them.
 * 2. **A swatch that reads as a failed load.** The Appearance panel's three
 *    theme previews paint literal hexes, so on the editor — dark in every theme,
 *    and so the only surface most readers ever open that panel on — the Dark
 *    option was a near-black rectangle against a near-black panel at 1.00:1,
 *    framed in the 12%-white hairline every border in that panel uses. It
 *    rendered as an empty box with a caption under it, next to two that plainly
 *    worked.
 * 3. **A panel that will not say what is applied.** Twenty-four looks in four
 *    families is more chips than the sheet is tall, so the sheet opens at the
 *    top; a document carrying a look from the last family reopened into a panel
 *    with no lit chip and no readable name, and the canvas was the only evidence.
 */

/** The product's own typeface, read out of the panel rather than written down
 * here, so a font-stack change does not turn this into a stale literal. */
async function productFont(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.querySelector('section[role="dialog"]')
    if (!probe) throw new Error('no tool panel is open to read the product typeface from')
    return getComputedStyle(probe).fontFamily
  })
}

test.describe('the controls that are not wearing the product', () => {
  test.beforeEach(async ({ goto, loadSample, clearStorage }) => {
    // `clearStorage` reads IndexedDB, and IndexedDB is denied on `about:blank`,
    // so the origin has to exist first.
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 2')
  })

  test('a text layer and a watermark are set in the product typeface, not the browser default', async ({
    page,
    openTool,
  }) => {
    await openTool('Text')
    await page.getByRole('button', { name: 'Add text' }).click()
    // The field and the picker, both addressed the way a screen reader reaches
    // them: the textarea by its `aria-label`, the select by its `<label for>`.
    await expect(page.getByRole('textbox', { name: 'Text content' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Font' })).toBeVisible()

    const font = await productFont(page)
    // The UA textarea stack is `monospace` and the UA select stack is the
    // platform's default serif/sans — neither is the app's, so this is the
    // assertion that fails on a control that was never skinned.
    for (const stack of ['monospace', 'Arial', 'Times']) {
      expect(font).not.toContain(stack)
    }

    for (const control of [
      page.getByRole('textbox', { name: 'Text content' }),
      page.getByRole('combobox', { name: 'Font' }),
    ]) {
      const style = await control.evaluate((node) => {
        const computed = getComputedStyle(node)
        return {
          fontFamily: computed.fontFamily,
          fontSize: computed.fontSize,
          background: computed.backgroundColor,
          border: computed.borderTopColor,
          borderStyle: computed.borderTopStyle,
        }
      })
      // The four the user agent paints on a bare field, and the four the panel
      // paints everywhere else. WebKit clamps a native select's corner radius to
      // 5px whatever the cascade says, so the radius is deliberately not in this
      // list: it is an engine's rendering detail, not evidence of anything.
      expect(style.fontFamily, `${control} is set in the browser default typeface`).toBe(font)
      // 13.33px is the UA default. The panel's own scale is `0.8125rem`.
      expect(parseFloat(style.fontSize)).toBeCloseTo(13, 1)
      expect(style.background, `${control} is on the browser default ground`).not.toBe(
        'rgb(59, 59, 59)',
      )
      expect(style.border, `${control} has the browser default border`).not.toBe(
        'rgb(133, 133, 133)',
      )
      expect(style.borderStyle, `${control} has the browser default inset border`).toBe('solid')
    }

    // And the same three controls on the watermark inspector, which is where the
    // other two of the five live — including its own Anchor picker.
    await page.getByRole('button', { name: 'Add watermark' }).click()
    await expect(page.getByRole('textbox', { name: 'Watermark text' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Font' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Anchor' })).toBeVisible()

    for (const control of [
      page.getByRole('textbox', { name: 'Watermark text' }),
      page.getByRole('combobox', { name: 'Font' }),
      page.getByRole('combobox', { name: 'Anchor' }),
    ]) {
      const style = await control.evaluate((node) => {
        const computed = getComputedStyle(node)
        return {
          fontFamily: computed.fontFamily,
          background: computed.backgroundColor,
          border: computed.borderTopColor,
        }
      })
      expect(style.fontFamily, `${control} is set in the browser default typeface`).toBe(font)
      expect(style.background).not.toBe('rgb(59, 59, 59)')
      expect(style.border).not.toBe('rgb(133, 133, 133)')
    }
  })
})

/**
 * Relative luminance of an sRGB triple, and the contrast ratio between two.
 * Both are WCAG's definitions, written out here because `getComputedStyle`
 * answers `rgba()` and the frame has to be composited over what is behind it
 * before it can be compared to anything.
 */
function luminance(red: number, green: number, blue: number): number {
  const channel = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.04045 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const first = luminance(...a)
  const second = luminance(...b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Parse `rgb()` / `rgba()` into channels and an alpha. */
function parse(colour: string): { rgb: [number, number, number]; alpha: number } {
  const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]
  return {
    rgb: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    alpha: parts.length > 3 ? (parts[3] ?? 1) : 1,
  }
}

/** `over` painted on top of `under`, which is what a translucent border does. */
function composite(over: string, under: string): [number, number, number] {
  const top = parse(over)
  const bottom = parse(under)
  const alpha = top.alpha
  return [
    top.rgb[0] * alpha + bottom.rgb[0] * (1 - alpha),
    top.rgb[1] * alpha + bottom.rgb[1] * (1 - alpha),
    top.rgb[2] * alpha + bottom.rgb[2] * (1 - alpha),
  ]
}

test.describe('the Appearance panel previews what it previews', () => {
  test.beforeEach(async ({ goto, loadSample, clearStorage }) => {
    // `clearStorage` reads IndexedDB, and IndexedDB is denied on `about:blank`,
    // so the origin has to exist first.
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 2')
  })

  test('every theme preview has a frame you can see on the panel behind it', async ({ page }) => {
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Appearance…' }).click()

    const panel = page.getByRole('dialog', { name: 'Appearance' })
    await expect(panel).toBeVisible()
    const ground = await panel.evaluate(
      (node) => getComputedStyle(node).backgroundColor ?? 'rgb(0, 0, 0)',
    )
    const behind: [number, number, number] = parse(ground).rgb

    // Three themes, and the test says which one failed rather than only that
    // something did: "Dark" was the invisible one on a dark editor and "Light"
    // was the invisible one on a white Hub.
    //
    // The radio is addressed by its accessible name and the frame is read off
    // the element that draws it — the miniature page, which is the radio's first
    // following sibling. Locating the input alone would measure the input, which
    // is a transparent overlay and draws nothing.
    for (const theme of ['Light', 'Dark', 'Match system']) {
      const swatch = panel.getByLabel(`Theme: ${theme}`).locator('xpath=following-sibling::*[1]')
      const frame = await swatch.evaluate((node) => {
        const computed = getComputedStyle(node)
        return {
          colour: computed.borderTopColor,
          width: parseFloat(computed.borderTopWidth),
        }
      })
      expect(frame.width, `the ${theme} theme preview has no frame at all`).toBeGreaterThanOrEqual(
        1,
      )
      const contrast = ratio(composite(frame.colour, ground), behind)
      // 3:1 is the non-text threshold this project already applies to `--ie-ink`
      // on the editor. A hairline is a shape, not a tint: below it, the swatch
      // is not legible as a swatch at all, and a panel whose swatches do not
      // read is a panel whose setting does not either.
      expect(
        contrast,
        `the ${theme} theme preview is ${contrast.toFixed(2)}:1 against this panel, so it reads as an empty box with a caption under it`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

/**
 * The tool sheet's own scroller, found the way `journey.inspector-layout` finds
 * it: the descendant that both scrolls and has something to scroll, marked so
 * the assertion can hold on to it.
 */
async function panelScroller(page: Page) {
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
      scroller?.setAttribute('data-e2e-scroller', '')
      return Boolean(scroller)
    })
}

test.describe('a panel says what is applied', () => {
  test.beforeEach(async ({ goto, loadSample, clearStorage }) => {
    // `clearStorage` reads IndexedDB, and IndexedDB is denied on `about:blank`,
    // so the origin has to exist first.
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 2')
  })

  test('reopening Looks shows the look that is on the photo', async ({
    page,
    openTool,
    readDoc,
  }) => {
    // `Vivid` is the last chip of the last family, so it is the one a look
    // applied and then forgotten about is most likely to be hiding behind.
    await openTool('Looks')
    const vivid = page.getByRole('button', { name: 'Vivid', exact: true })
    await vivid.scrollIntoViewIfNeeded()
    await vivid.click()
    await expect(vivid).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(vivid).toHaveCount(0)

    // Reopening is the moment under test: a user who has forgotten which look is
    // on opens this panel to find out.
    await openTool('Looks')
    const lit = page.getByRole('button', { name: 'Vivid', exact: true })
    await expect(lit).toHaveAttribute('aria-pressed', 'true')
    expect(await panelScroller(page)).toBe(true)

    // The chip is not merely present — it is inside the part of the panel a
    // reader can see, which is the whole claim.
    const visible = await lit.evaluate((node) => {
      const chip = node.getBoundingClientRect()
      const scroller = node.closest('[data-e2e-scroller]')
      if (!scroller) return null
      const view = scroller.getBoundingClientRect()
      return chip.top >= view.top - 1 && chip.bottom <= view.bottom + 1
    })
    expect(
      visible,
      'the applied look is off the bottom of the panel, so reopening the panel says nothing about what is on the photo',
    ).toBe(true)

    // And the panel's claim is true rather than merely legible: the document
    // really does carry that look, read out of the running store.
    const doc = await readDoc()
    expect(doc.look.id).toBe('vivid')
    expect(doc.look.amount).toBeGreaterThan(0)
  })
})
