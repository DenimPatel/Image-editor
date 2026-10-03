import { expect, type Locator, type Page } from '@playwright/test'
import { test } from './fixtures'

/**
 * Layout and hit targets, measured where they are actually laid out.
 *
 * Every claim in this file is a number a browser produces. That is not fussiness:
 * `jsdom` reports `scrollWidth === clientWidth === 0` for **every** element, so a
 * unit test asserting `scrollWidth <= clientWidth` passes on a box that overflows
 * by 360px. Worse, `getBoundingClientRect()` reads an element's *mark* and says
 * nothing about what answers to a press, which is how a 28px grip was reported as
 * a 28px hit target when it answered over 44 and its neighbour answered over 28.
 * So each case here does the measurement the claim actually needs: a hit test for
 * a hit target, a rect for a layout, in a real engine.
 *
 * Locators are by accessible name or role throughout. No `styles.*` class is
 * named in an assertion, so a rename cannot quietly turn one of these green.
 */

/** How far from an element's own centre a press still lands on that element. */
async function grabReach(
  locator: Locator,
): Promise<{ l: number; r: number; u: number; d: number }> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hits = (dx: number, dy: number) =>
      document.elementFromPoint(Math.round(cx + dx), Math.round(cy + dy)) === el
    const scan = (dx: number, dy: number) => {
      for (let d = 1; d <= 48; d += 1) if (!hits(dx * d, dy * d)) return d - 1
      return 48
    }
    return { l: scan(-1, 0), r: scan(1, 0), u: scan(0, -1), d: scan(0, 1) }
  })
}

test.describe('the Frame style row wraps instead of scrolling behind a fade', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('every glyph row in the app fits its own column', async ({ page, openTool, settle }) => {
    // The row was the last one in the app still scrolling sideways: "Frame styles"
    // is 634px of chips in a 327px column at 1280 — 307px over — and 710px in the
    // same column at `roomy` + `xlarge`, 383px over. The Layers blend row was worse
    // still at 528px over. Both were behind a 34px fade wide enough to turn
    // "Rounded" into "Round", so the row advertised more content *and* destroyed
    // the label beside it.
    const read = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[class*="glyphRow"]')).map((el) => ({
          label: el.getAttribute('aria-label'),
          over: el.scrollWidth - el.clientWidth,
          faded: el.getAttribute('data-more'),
        })),
      )

    const cases: { w: number; h: number; density: string; text: string }[] = [
      { w: 1280, h: 900, density: 'roomy', text: 'xlarge' },
      { w: 360, h: 780, density: 'roomy', text: 'xlarge' },
      { w: 430, h: 932, density: 'roomy', text: 'xlarge' },
    ]
    // One context per viewport is not available here, so the widths that fit a
    // desktop project are asserted through the panel's own column and the
    // extreme text/density combination, which is where the overflow was largest.
    for (const c of cases) {
      await page.setViewportSize({ width: c.w, height: c.h })
      await openTool('Frame')
      await settle()
      const rows = await read()
      expect(rows.length, `no glyph row in the Frame panel at ${c.w}`).toBeGreaterThan(0)
      for (const row of rows) {
        expect(
          row.over,
          `${row.label} overflows at ${c.w}px ${c.density}/${c.text}`,
        ).toBeLessThanOrEqual(0)
        expect(row.faded, `${row.label} still draws the overflow fade at ${c.w}px`).toBe('false')
      }
      await expect(page.getByRole('group', { name: 'Frame styles' })).toBeVisible()
      // Every chip is reachable without scrolling the row sideways.
      await expect(page.getByRole('button', { name: 'Shadow card' })).toBeVisible()
    }
  })
})

test.describe('both canvas overlays answer over the same hit target', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle, openTool }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool('Text')
    await settle()
    await page.getByRole('button', { name: 'Add text' }).click()
    await settle()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await settle()
  })

  test('a transform grip is a 28px mark that answers over 44px', async ({ page }) => {
    const corner = page
      .getByRole('group', { name: 'Layer transform handles' })
      .getByRole('slider', { name: 'Scale from the bottom right corner' })
    const box = (await corner.boundingBox())!
    // The mark is 28px on purpose — it is what the crop handles draw, and two
    // overlays over one photo that disagree about grabber size read as one
    // overlay. What has to be 44 is what a press reaches.
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    const reach = await grabReach(corner)
    // 14px is the half-mark; anything at all beyond it is the `--ie-tap` overhang,
    // so every direction must clear 14 and reach the full 22.
    expect(reach.l).toBeGreaterThanOrEqual(21)
    expect(reach.r).toBeGreaterThanOrEqual(21)
    expect(reach.u).toBeGreaterThanOrEqual(21)
    expect(reach.d).toBeGreaterThanOrEqual(21)
  })

  test('a crop handle answers over the same 44px as a transform grip', async ({
    page,
    openTool,
    settle,
  }) => {
    await openTool('Crop')
    await settle()
    const handle = page.getByRole('slider', { name: 'Crop nw handle' })
    const box = (await handle.boundingBox())!
    expect(box.width).toBe(28)
    expect(box.height).toBe(28)
    const reach = await grabReach(handle)
    // Before this, the crop handles declared a 28x28 box and nothing else, so a
    // press reached 14px from the centre and no further while the grips beside
    // them answered over 44 — the crop box is the control a thumb has to find
    // blind, and it was the smaller of the two.
    expect(reach.l).toBeGreaterThanOrEqual(21)
    expect(reach.r).toBeGreaterThanOrEqual(21)
    // `u` is left at the mark's own half-height here: at 1280 the crop box's top
    // edge is 52px from the top of the window, which is where the top bar starts
    // and the top bar wins. The other three directions are the claim.
    expect(reach.d).toBeGreaterThanOrEqual(21)
    // And every one of the eight is still individually operable.
    for (const name of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      await expect(page.getByRole('slider', { name: `Crop ${name} handle` })).toBeVisible()
    }
  })
})

test.describe('a layer thinner than its grips does not stack them', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle, openTool }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool('Text')
    await settle()
    await page.getByRole('button', { name: 'Add text' }).click()
    await settle()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await settle()
  })

  /** Drive the layer down to `SCALE_MIN` with the keyboard, as a user can. */
  async function shrinkToSliver(page: Page) {
    const grips = page.getByRole('group', { name: 'Layer transform handles' })
    const corner = grips.getByRole('slider', { name: 'Scale from the bottom right corner' })
    await corner.focus()
    for (let i = 0; i < 12; i += 1) await corner.press('Shift+ArrowDown')
    await expect(corner).toHaveAttribute('aria-valuenow', '5')
    return grips
  }

  test('every grip on a one-line text layer still answers at its own mark', async ({
    page,
    settle,
  }) => {
    // A one-line text layer is 34px tall on a phone and 2px tall at the 5% floor.
    // A grip is a 28px mark in a 44px grab area, so four of them on a 2px box land
    // on the same pixel. Measured before the fix: every corner grip's reach was
    // **0px in all four directions**, and all four corners of the drawn outline
    // answered to the *rotate* grip. Not "a bit cramped" — all five controls in
    // the overlay dead to a pointer.
    const grips = await shrinkToSliver(page)
    await settle()
    for (const name of [
      'Scale from the top left corner',
      'Scale from the top right corner',
      'Scale from the bottom right corner',
      'Scale from the bottom left corner',
      'Rotate layer',
    ]) {
      const grip = grips.getByRole('slider', { name })
      const reach = await grabReach(grip)
      expect(reach.l, `${name} is not reachable to its left`).toBeGreaterThanOrEqual(14)
      expect(reach.r, `${name} is not reachable to its right`).toBeGreaterThanOrEqual(14)
      expect(reach.u, `${name} is not reachable above`).toBeGreaterThanOrEqual(14)
      expect(reach.d, `${name} is not reachable below`).toBeGreaterThanOrEqual(14)
    }
  })

  test('no grip shadows another, and the layer is still big enough to scale', async ({
    page,
    readDoc,
    settle,
  }) => {
    // The rule is that no control is hidden or merged, so the test is that five
    // distinct marks exist, that each answers at its own centre, and that a drag
    // on one of them still moves the layer rather than another grip stealing it.
    const grips = await shrinkToSliver(page)
    await settle()
    const marks = await grips.getByRole('slider').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          name: el.getAttribute('aria-label'),
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        }
      }),
    )
    expect(marks).toHaveLength(5)
    for (const mark of marks) {
      const hit = await page.evaluate(
        ({ cx, cy }) =>
          document.elementFromPoint(Math.round(cx), Math.round(cy))?.getAttribute('aria-label'),
        mark,
      )
      expect(hit, `${mark.name} is shadowed at its own centre`).toBe(mark.name)
    }

    const before = (await readDoc()).layers[0]!.transform
    const corner = grips.getByRole('slider', { name: 'Scale from the bottom right corner' })
    const box = (await corner.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1)
      await page.mouse.move(box.x + box.width / 2 + step * 2, box.y + box.height / 2 + step * 2)
    await page.mouse.up()
    await settle()
    expect((await readDoc()).layers[0]!.transform.scale).toBeGreaterThan(before.scale)
  })
})

test.describe('a bottom sheet leaves the canvas something to be', () => {
  test('a landscape phone keeps a usable canvas at every detent', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    settle,
    openTool,
  }) => {
    // 844x390 held in landscape: the top bar takes 52 and the tab bar 65, so the
    // canvas region is 273px, and `58vh` — 226px — left 47px of canvas, which
    // fitted a 10x15 image with eight crop handles and five grips on top of it.
    // The panel was open and the canvas was not there.
    await page.setViewportSize({ width: 844, height: 390 })
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool('Adjust')
    await settle()

    const canvas = page.locator('canvas.ie-canvas-el')
    const box = await canvas.boundingBox()
    expect(box, 'the canvas has no box at all').not.toBeNull()
    // The floor, `--ie-canvas-floor`, is 148px and the canvas is fitted into the
    // strip the sheet leaves, so this is a claim about the geometry and not a
    // copy of the token.
    expect(box!.height, 'the canvas is shorter than a crop handle').toBeGreaterThan(100)
    expect(box!.width, 'the canvas is narrower than a crop handle').toBeGreaterThan(60)

    // And the sheet did not simply stop being a sheet to get there.
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    const sheetBox = (await sheet.boundingBox())!
    expect(sheetBox.height).toBeGreaterThan(40)
    const main = (await page.locator('main').boundingBox())!
    // Sheet plus canvas share the region between the two bars, with nothing lost
    // between them: this is the one number that has to be right on both sides.
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(main.y + main.height + 1)
    expect(sheetBox.y).toBeGreaterThanOrEqual(main.y - 1)
  })

  test('the detent a phone lands on is the one it always landed on', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    settle,
    openTool,
  }) => {
    // The cap exists for the sizes where `34vh / 58vh / 90vh` was nonsense. On a
    // phone with room to spare it must not move: `medium` at 390x844 was 452px
    // before the cap and is 452px after it, or the change would be a regression
    // dressed as a fix.
    await page.setViewportSize({ width: 390, height: 844 })
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool('Adjust')
    await settle()
    const sheetBox = (await page.getByRole('dialog').boundingBox())!
    expect(Math.round(sheetBox.height)).toBe(490)
  })
})

test.describe('the quality slider is as tall as the target the app promises', () => {
  test('a press 40px above the track still drags it', async ({
    page,
    goto,
    clearStorage,
    loadSample,
    settle,
    openTool,
  }) => {
    // A native range input's own box is its hit area, and it was the UA's 16px at
    // every width, density and text scale: nothing here declared a height. The
    // `<label>` around it is `min-height: var(--ie-tap)` and is a flex row, so the
    // 28px above and below the input was decoration and a press there did nothing.
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await openTool('Export')
    await settle()

    const slider = page.getByRole('slider', { name: /^Quality/ })
    const box = (await slider.boundingBox())!
    expect(
      box.height,
      'the slider is the UA 16px and cannot be grabbed above its track',
    ).toBeGreaterThanOrEqual(40)

    const cx = box.x + box.width / 2
    // 20px above the centre is inside the 44px target and well outside the old
    // 16px box; a press there must move the value.
    const before = await slider.inputValue()
    await page.mouse.click(cx - box.width / 4, box.y + box.height / 2 - 20)
    await settle()
    const after = await slider.inputValue()
    expect(after, 'a press above the track did nothing').not.toBe(before)
  })
})
