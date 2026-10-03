import { expect, test, type ToolName } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * The audit's nine findings, and the four of them whose fix is a *layout* claim.
 *
 * Everything here is measured in a real browser. jsdom reports
 * `scrollWidth === clientWidth === 0` for every element and computes no layout at
 * all, so a unit test could pass on an orphaned segment, a clipped help overlay or a
 * title ellipsis sitting inside a menu button — the failure mode of this file is the
 * opposite one: a check that is green on a defect.
 *
 * The four claims:
 *
 *  1. **No segmented control orphans a segment** at 1280x900 or at 390. The audit
 *     found `Export`'s SIZE row as four options and a lone `Percent` — at the primary
 *     desktop width — and `Background`'s mode row as three and a lone `Image` at
 *     390. `data-segmented` carries the row count the component chose, so the
 *     assertion is about the decision *and* about the pixels, and the two are
 *     compared: a control that says two rows must have two rows of pixels.
 *  2. **The help overlay does not look like an error box and says it scrolls.** The
 *     ring was a permanent 2px accent outline on a container focused by script; the
 *     content was 1373px in an 850px box with the last line cut mid-glyph.
 *  3. **The retouch pad and the canvas are the same photograph.** With a crop set
 *     and Retouch open, the canvas is the crop, so there is nothing for an anchor
 *     to mark. A rectangle used to be drawn over the canvas, because the canvas
 *     was the whole frame — no frame had run, and the anchor was explaining a
 *     lie. It was removed with the component that drew it.
 *  4. **The top bar's title truncates at the end on a narrow phone and at the start
 *     everywhere else.** The long-filename behaviour is not to be broken by the fix
 *     for the ellipsis landing beside the overflow button's own three dots.
 *
 * Plus the crop panel's platform section: the audit measured the working Straighten
 * dial 1397px down a 468px window at 390x844, all of it chips, and the disclosure is
 * the reason it is not.
 */

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
 * Every segmented control on screen, with the rows its buttons actually occupy.
 *
 * Rows come from `getBoundingClientRect().top`, rounded, so this is the *rendered*
 * layout and not the component's own decision — which is why `data-segmented` is
 * compared against it rather than trusted.
 */
async function segmentedRows(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-segmented]')).map((group) => {
      const buttons = Array.from(group.querySelectorAll(':scope > button, :scope > * > button'))
      const rows = new Map<number, number>()
      for (const button of buttons) {
        const top = Math.round(button.getBoundingClientRect().top)
        rows.set(top, (rows.get(top) ?? 0) + 1)
      }
      return {
        label: group.getAttribute('aria-label'),
        declared: group.getAttribute('data-segmented'),
        count: buttons.length,
        rows: [...rows.values()],
      }
    }),
  )
}

test.describe('no segmented control leaves one option on a row of its own', () => {
  for (const [width, height] of [
    [1280, 900],
    [390, 844],
  ] as const) {
    test(`none of the thirteen panels orphans a segment at ${width}px`, async ({
      page,
      goto,
      loadSample,
      openTool,
    }) => {
      await page.setViewportSize({ width, height })
      await goto('/editor')
      await loadSample('Sample 1')

      const orphans: string[] = []
      const wrong: string[] = []
      for (const tool of TOOLS) {
        await openTool(tool)
        for (const control of await segmentedRows(page)) {
          const name = `${tool} / ${control.label ?? '(unlabelled)'}`
          if (control.rows.length > 1 && control.rows[control.rows.length - 1] === 1) {
            orphans.push(`${name}: ${control.rows.join('+')} of ${control.count}`)
          }
          // The component's own row count has to be the number of rows on screen, or
          // the balance is being decided from a measurement the paint disagrees with.
          if (Number(control.declared) !== control.rows.length) {
            wrong.push(`${name}: said ${control.declared}, painted ${control.rows.length}`)
          }
          expect(
            control.rows.reduce((a, b) => a + b, 0),
            name,
          ).toBe(control.count)
        }
      }
      expect(wrong, 'the declared row count and the painted one disagree').toEqual([])
      expect(orphans, 'a row holding one option').toEqual([])
    })
  }

  test('the Export SIZE row is three and two at 1280x900, where it was four and one', async ({
    page,
    goto,
    loadSample,
    openTool,
    panel,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Export')
    const size = (await segmentedRows(page)).find((control) => control.label === 'Resize mode')
    expect(size).toBeDefined()
    // Five options: No resize, Width, Height, Long edge, Percent. The audit's
    // screenshot showed `Percent` alone on row two, stretched to the full column.
    expect(size?.count).toBe(5)
    expect(size?.rows).toEqual([3, 2])
    expect(size?.declared).toBe('2')
    // And nothing in the row is a full-width bar. The buttons share each row evenly,
    // so row one is three narrow and row two is two wide; what must not happen is a
    // row of one, and the width of the widest button against the control's own is the
    // only way to see that in pixels rather than in the row count.
    const control = await panel('Export').locator('[aria-label="Resize mode"]').boundingBox()
    const widths = await panel('Export')
      .locator('[aria-label="Resize mode"] button')
      .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width))
    expect(control).not.toBeNull()
    expect(Math.min(...widths)).toBeGreaterThan(40)
    expect(Math.max(...widths)).toBeLessThan(control!.width - 60)
  })
})

test.describe('the help overlay is a help overlay', () => {
  test('carries no focus ring on its container, and is still a focused dialog', async ({
    page,
    goto,
    loadSample,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click()

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(dialog).toBeFocused()
    // The panel is `tabIndex={-1}` and focused by script, so the app's global
    // `[tabindex]:focus-visible` rule matched it and drew a permanent accent ring
    // around the whole modal — an accent hairline inset on a dark box, which reads as
    // an error box. Nothing may draw an outline on the container.
    const outline = await dialog.evaluate((node) => {
      const style = getComputedStyle(node)
      return { width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor }
    })
    expect(outline.style === 'none' || parseFloat(outline.width) === 0).toBe(true)
    // The affordance is not lost: the first Tab lands on a real control inside it.
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  })

  test('says it has more below, and stops saying so at the end', async ({
    page,
    goto,
    loadSample,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click()

    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    const extents = await dialog.evaluate((node) => ({
      client: node.clientHeight,
      scroll: node.scrollHeight,
    }))
    // The audit's measurement: 1373px of content in an 850px box, last line cut
    // mid-glyph with nothing on screen to say there was more.
    expect(extents.scroll).toBeGreaterThan(extents.client)
    await expect(page.locator('[class*="helpFadeBottom"]')).toHaveCount(1)
    await expect(page.locator('[class*="helpFadeTop"]')).toHaveCount(0)

    await dialog.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(page.locator('[class*="helpFadeBottom"]')).toHaveCount(0)
    await expect(page.locator('[class*="helpFadeTop"]')).toHaveCount(1)
  })

  test('the overflow menu and the appearance panel are the same surface', async ({
    page,
    goto,
    loadSample,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    await page.getByRole('button', { name: 'More options' }).click()

    const menu = page.getByRole('menu', { name: 'More options' })
    await expect(menu).toBeVisible()
    // Grouped, so a reader does not have to read seven words to find one, and every
    // row is marked, so the labels line up as a column instead of a paragraph.
    const separators = await menu.locator('[role="separator"]').count()
    expect(separators).toBeGreaterThan(0)
    const rows = menu.locator('[role="menuitem"]')
    await expect(rows).toHaveCount(7)
    const marked = await menu
      .locator('[role="menuitem"] svg, [role="menuitem"] > span[class*="menuItemIcon"]')
      .count()
    expect(marked).toBe(7)
    // Three surfaces, one radius and one hairline. The help panel was `--radius-xl`
    // where the other two are `--radius-md`, which is the clearest signal that three
    // designs shipped where one was meant.
    const surfaces = await page.evaluate(() => {
      const read = (node: Element | null) =>
        node
          ? {
              radius: getComputedStyle(node).borderTopLeftRadius,
              border: getComputedStyle(node).borderTopWidth,
            }
          : null
      return {
        menu: read(document.querySelector('[role="menu"]')),
        appearance: read(document.querySelector('[role="dialog"][aria-labelledby]')),
      }
    })
    expect(surfaces.menu).not.toBeNull()
    expect(surfaces.appearance).toBeNull()
    await page.getByRole('menuitem', { name: /Appearance/ }).click()
    const appearance = page.locator('[role="dialog"][aria-labelledby]')
    await expect(appearance).toBeVisible()
    const both = await page.evaluate(() => {
      const read = (node: Element | null) =>
        node
          ? {
              radius: getComputedStyle(node).borderTopLeftRadius,
              border: getComputedStyle(node).borderTopWidth,
            }
          : null
      return { appearance: read(document.querySelector('[role="dialog"][aria-labelledby]')) }
    })
    expect(both.appearance).toEqual(surfaces.menu)
  })
})

test.describe('the retouch pad and the canvas are the same photograph', () => {
  test('nothing is drawn over the canvas while Retouch is open, because there is nothing to anchor', async ({
    page,
    goto,
    loadSample,
    openTool,
    canvas,
    settle,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await loadSample('Sample 1')
    // No crop: nothing to anchor, and a rectangle coinciding with the frame would
    // be a decoration pretending to be an explanation.
    await openTool('Retouch')
    await expect(page.locator('[data-crop-region]')).toHaveCount(0)

    await openTool('Crop')
    await page.getByRole('button', { name: '1:1', exact: true }).first().click()
    await openTool('Retouch')
    await settle()

    // A rectangle used to be asserted here, and the rectangle was the defect: it
    // was drawn when the canvas was showing the whole frame, and the canvas was
    // showing the whole frame because no frame had run — `LoopKey` had no field
    // for whether the crop was being edited, so closing the Crop tool produced a
    // key identical to the open one and nothing repainted. The anchor was drawn
    // to explain a canvas that was lying.
    //
    // With the frame running, the canvas is the crop and the pad is the crop, and
    // a rectangle on the canvas would coincide with the visible frame. The canvas
    // is the thing under test here, so the pixels are asserted; the absence of the
    // element on its own would pass on a canvas that had stopped drawing at all.
    await expect(page.locator('[data-crop-region]')).toHaveCount(0)
    const painted = await canvas().evaluate((node) => {
      const el = node as HTMLCanvasElement
      return { width: el.width, height: el.height, box: el.getBoundingClientRect().width }
    })
    expect(painted.width).toBe(painted.height)

    // And the panel's caption, which used to promise "The rectangle drawn on the
    // canvas is that same region" — a description of a rectangle that is not
    // drawn, which is the same defect as the rectangle was. It was left unasserted
    // while the `.tsx` that owned it was out of reach, on the grounds that
    // asserting the false sentence would make this test green on a product that
    // lies. It is asserted now, in full, because the sentence is the one this test
    // makes true: the pad and the canvas are the same region, which is what the
    // bytes above show.
    const caption = page.locator('section[role="dialog"] p', { hasText: 'The pad is the crop' })
    await expect(caption).toHaveText(
      'The pad is the crop. The pad and the canvas are the same region, so a spot lands where you can see it.',
    )
  })
})

test.describe('the top bar title truncates where the ellipsis is readable', () => {
  const direction = (page: Page) =>
    page.evaluate(() => {
      const title = document.querySelector('header bdi')?.parentElement
      return title ? getComputedStyle(title).direction : null
    })

  test('ends the ellipsis on a narrow phone, where the overflow dots are', async ({
    page,
    goto,
    loadSample,
  }) => {
    // Roomy density and Extra-large text is the combination the audit caught it in,
    // written before the sample is loaded so there is no reload back to the import
    // screen part-way through.
    await page.addInitScript(() => {
      const raw = localStorage.getItem('image-editor-appearance')
      const parsed = raw ? JSON.parse(raw) : {}
      localStorage.setItem(
        'image-editor-appearance',
        JSON.stringify({
          ...parsed,
          theme: 'dark',
          accent: 'cobalt',
          motion: 'full',
          density: 'roomy',
          textScale: 'xlarge',
          iconScale: 'large',
        }),
      )
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample('Sample 1')
    await expect(page.locator('header bdi')).toBeVisible()
    expect(await direction(page)).toBe('ltr')

    // The ellipsis must not be the last thing on screen before the overflow button,
    // because that is what made `…le 2` read as part of the menu. With an LTR box the
    // clipped end is the right edge of the title, and the title's box ends before the
    // right-hand group begins.
    const gap = await page.evaluate(() => {
      const title = document.querySelector('header bdi')?.parentElement
      const group = document.querySelector('header > div:last-of-type')
      if (!title || !group) return null
      return group.getBoundingClientRect().left - title.getBoundingClientRect().right
    })
    expect(gap).not.toBeNull()
    expect(gap!).toBeGreaterThan(0)
  })

  test('keeps the front ellipsis everywhere else, because a filename ends in the part that identifies it', async ({
    page,
    goto,
    loadSample,
  }) => {
    for (const width of [430, 1280]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
      await goto('/editor')
      await loadSample('Sample 1')
      await expect(page.locator('header bdi')).toBeVisible()
      // `IMG_4821.HEIC` shares its head with every other `IMG_` and differs at the end.
      expect(await direction(page), `${width}px`).toBe('rtl')
    }
  })
})

test.describe('the crop panel puts the working control first', () => {
  test('the platform catalogue is folded, and the Straighten dial is reachable', async ({
    page,
    goto,
    loadSample,
    openTool,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await loadSample('Sample 1')
    await openTool('Crop')
    const crop = page.getByRole('dialog', { name: 'Crop & Straighten' })

    // A real disclosure, so it works and is announced without this component.
    const disclosure = crop.locator('details')
    await expect(disclosure).toHaveCount(1)
    await expect(disclosure).not.toHaveAttribute('open', '')
    // The count is in the summary: a closed section that says only "Platform" is a
    // section nobody can tell is worth opening.
    await expect(disclosure.locator('summary')).toContainText('22 sizes')

    // The audit measured 1397px from the panel's top to the dial, in a 468px window.
    const dial = await crop.getByRole('slider', { name: /Straighten/ }).evaluate((node) => {
      const panel = node.closest('section[role="dialog"]')
      if (!panel) return null
      const scroller = Array.from(panel.querySelectorAll('*')).find(
        (candidate) => candidate.scrollHeight > candidate.clientHeight + 4,
      )
      if (scroller) scroller.scrollTop = 0
      return node.getBoundingClientRect().top - (panel as HTMLElement).getBoundingClientRect().top
    })
    expect(dial).not.toBeNull()
    expect(dial!).toBeLessThan(900)

    // Opened, it is still the catalogue — the disclosure is a fold, not a deletion. The
    // safe-area presets are the only route to the overlay, so removing the section would
    // have been removing a feature.
    await disclosure.locator('summary').click()
    await expect(disclosure).toHaveAttribute('open', '')
    await expect(disclosure.getByRole('button', { name: 'Instagram Story 9:16' })).toBeVisible()
    await disclosure.getByRole('button', { name: 'Instagram Story 9:16' }).click()
    // The summary now names the one thing these chips add that the generic row cannot.
    await expect(disclosure.locator('summary')).toContainText('Story guides on')
  })
})
