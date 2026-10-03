import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

/**
 * The crop panel's shape chips.
 *
 * Two claims, and either alone is satisfiable by a broken panel:
 *
 * 1. **A chip is reachable and says what it sets.** Located by accessible name
 *    throughout — never by a CSS-module class, which dies on the next rename and
 *    says nothing about whether a control can be reached at all.
 * 2. **A chip lights when the crop is the shape it claims, and stops when it is
 *    not.** The platform rows used to pass `value={null}`, so a user who picked
 *    "Instagram Story 9:16" saw nothing change anywhere in a panel whose generic
 *    row did light up. "Reset crop" is the second half of the same defect: the
 *    box went back to the photo's own proportion and the row kept claiming the
 *    ratio the lock was still holding.
 */

const readout = /^\d+ × \d+ px · /

/**
 * Open the crop panel's platform catalogue.
 *
 * The catalogue is a `<details>`, closed by default. It was not deleted — it is 600px
 * of twenty-two chips that used to sit inline in the panel and push the working
 * Straighten dial 1397px down a 468px window at 390x844, and these chips are the only
 * route to a safe-area preset, so removing the section would have removed a feature.
 * Every test below that addresses a platform row opens it first, which keeps each
 * test's original claim intact and puts the folding itself in
 * `journey.panel-seams.spec.ts`.
 */
async function openPlatformCatalogue(page: Page): Promise<void> {
  const disclosure = page.getByRole('dialog', { name: 'Crop & Straighten' }).locator('details')
  if ((await disclosure.getAttribute('open')) === null) {
    await disclosure.locator('summary').click()
  }
  await expect(disclosure).toHaveAttribute('open', '')
}

/** The current crop's size, read off the canvas overlay the way a reader sees it. */
async function shownCrop(page: Page): Promise<string> {
  const text = (await page.getByText(readout).first().textContent())?.trim() ?? ''
  const match = /px · ([\d.]+:\d+)/.exec(text)
  if (!match) throw new Error(`no crop readout found (got ${JSON.stringify(text)})`)
  return match[1] as string
}

/**
 * The two controls that have no label text on them, measured as drawn.
 *
 * `Swap ratio sides` is a button with an `aria-label` and nothing else inside it,
 * and `Custom aspect ratio` is a bare `<input>`. Neither can be checked by a
 * unit test: jsdom reports `0 × 0` for both of them and computes no style, so
 * "the glyph has a size" and "the field is not the browser's white box" are
 * claims about a real engine or they are not claims at all. Both were real
 * defects — the glyph resolved to `0 × 0` behind the button's accessible name,
 * and the field was an unstyled `#fff` input with a 2px inset on near-black
 * chrome, at 13px type that ignored the reader's "Extra large" text.
 */

/** `rgb(r, g, b)` and `rgba(r, g, b, a)`, or `null` for anything else. */
function parseCssColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = /^rgba?\(([^)]+)\)$/.exec(value)
  if (!match) return null
  const parts = (match[1] ?? '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null
  const [r, g, b, a] = parts
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: a ?? 1 }
}

/** The UA's default input background, in every spelling a browser reports it. */
function isOpaqueWhite(value: string): boolean {
  const colour = parseCssColor(value)
  return (
    colour !== null && colour.a === 1 && colour.r === 255 && colour.g === 255 && colour.b === 255
  )
}

test.describe('the icon-only controls are drawn, not merely named', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('the swap glyph has a size, because a 0×0 svg is a blank button', async ({
    openTool,
    page,
  }) => {
    await openTool('Crop')
    const swap = page.getByRole('button', { name: 'Swap ratio sides' })
    // The control is reachable and named whatever its artwork is doing — which is
    // exactly why the artwork needs its own assertion.
    await expect(swap).toBeVisible()

    const glyph = swap.locator('svg')
    await expect(glyph).toHaveCount(1)
    const box = await glyph.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    // Not "> 0": a rule that resolved to 1px would pass that and still be
    // invisible. `tools.module.css` sizes this glyph at 18 × `--icon-scale`, so
    // 8px is the floor a real render clears and a broken one cannot.
    expect(box.width, 'the swap glyph has no width').toBeGreaterThan(8)
    expect(box.height, 'the swap glyph has no height').toBeGreaterThan(8)

    // And the control is still hit-testable at its own centre: a glyph that
    // renders somewhere other than where the button is would pass the box above.
    const pressed = await swap.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return hit !== null && (hit === node || node.contains(hit))
    })
    expect(pressed, 'the swap button is covered by something').toBe(true)
  })

  test('the custom ratio field is styled by this app, not by the browser', async ({
    openTool,
    page,
  }) => {
    await openTool('Crop')
    const field = page.getByRole('textbox', { name: 'Custom aspect ratio' })
    await expect(field).toBeVisible()

    const measured = await field.evaluate((node) => {
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return {
        height: rect.height,
        background: style.backgroundColor,
        borderStyle: style.borderTopStyle,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderTopLeftRadius,
      }
    })

    // `min-height: calc(40px * var(--density-factor))` on `.grow[type='text']`.
    // The UA default was a 20px box, and a 40px one is the minimum a finger can
    // hit, so the floor is the product's own figure rather than a round guess.
    expect(measured.height, 'the W:H field is shorter than a finger').toBeGreaterThanOrEqual(40)
    // The defect was literally a white box: `background: #fff` on the editor's
    // near-black chrome, whichever spelling the engine reports it in.
    expect(isOpaqueWhite(measured.background), `the field is painted ${measured.background}`).toBe(
      false,
    )
    // The other half of the same UA default, and the reason it read as a
    // Windows text box rather than a field in this app: `border-style: inset`.
    expect(measured.borderStyle).not.toBe('inset')
    expect(parseFloat(measured.borderWidth)).toBeGreaterThanOrEqual(1)
    // A square-cornered box is the UA's, and it is the third tell.
    expect(parseFloat(measured.borderRadius)).toBeGreaterThan(0)
  })
})

test.describe('the crop panel reads by shape', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('every platform preset is one tap away, under its own name', async ({ openTool, page }) => {
    await openTool('Crop')
    // The catalogue is behind a disclosure. It is a *fold*, not a deletion: it was
    // 600px of twenty-two chips inline in the panel, which pushed the working
    // Straighten dial 1397px down a 468px window at 390x844, and deleting it was not
    // available because these chips are the only route to a safe-area preset, which
    // `SafeAreaOverlay` and `PassportPanel` both read. So the test opens it and then
    // makes the same claim it made before.
    await openPlatformCatalogue(page)
    // Six shape rows — one per ratio the catalogue offers — where there used to
    // be seven headed groups, five of which held a single chip reading
    // "Square 1:1" and nothing else.
    for (const ratio of ['1:1', '4:5', '1.91:1', '9:16', '16:9', '2:3']) {
      await expect(page.getByRole('group', { name: `${ratio} presets`, exact: true })).toBeVisible()
    }

    // The seven square chips are one row of seven shapes now, and each still
    // carries the platform it belongs to. Matched as a *prefix* because a chip that
    // adds safe-area guides says so on its second line, and that line is part of the
    // accessible name: `TikTok 1:1 Reel guides`. The prefix is the platform and the
    // ratio, which is what this test is about.
    const squares = page.getByRole('group', { name: '1:1 presets', exact: true })
    for (const platform of [
      'Instagram',
      'TikTok',
      'LinkedIn',
      'X',
      'Facebook',
      'YouTube',
      'Pinterest',
    ]) {
      await expect(
        squares.getByRole('button', { name: new RegExp(`^${platform} 1:1`) }),
      ).toBeVisible()
    }

    // And a chip that says one thing cannot be found under another platform's
    // name, which is what makes a screenshot of one chip identifiable.
    await expect(squares.getByRole('button', { name: 'Instagram 4:5', exact: true })).toHaveCount(0)
  })

  test('a shape is drawn, and the text beside it is the ratio', async ({ openTool, page }) => {
    await openTool('Crop')
    const chip = page
      .getByRole('group', { name: 'Aspect ratio presets' })
      .getByRole('button', { name: '16:9', exact: true })
    // The viewfinder is an SVG on the shared 24 grid, drawn at the ratio's true
    // fractional positions. A Unicode box-drawing character was the alternative
    // and it renders as tofu on a screen full of rectangles.
    const frame = chip.locator('svg')
    await expect(frame).toHaveCount(1)
    expect(await frame.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(await frame.getAttribute('aria-hidden')).toBe('true')
    // The glyph carries no stroke of its own, so a 16:9 and a 1:1 in the same row
    // are the same optical weight.
    expect(await frame.locator('rect').first().getAttribute('vector-effect')).toBe(
      'non-scaling-stroke',
    )
    // And the frame is the ratio: 20px on the long edge, proportionally shorter
    // on the other, rather than a square box a shape is drawn inside.
    const box = await frame.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1)
  })

  test('a platform chip sets the crop, and one chip in the whole panel claims it', async ({
    openTool,
    page,
    settle,
  }) => {
    await openTool('Crop')
    await openPlatformCatalogue(page)
    await page
      .getByRole('group', { name: '9:16 presets', exact: true })
      // A prefix, not `exact: true`: a chip that adds guides says so on its second
      // line — `Instagram Story 9:16 Story guides` — and that line is part of the
      // accessible name, which is where a screen reader user hears it.
      .getByRole('button', { name: /^Instagram Story 9:16/ })
      .click()
    await settle()
    // Five presets are 9:16 and all five produce this crop, which is why this
    // used to light all five at once: six lit controls for one crop the user
    // chose once, and nothing on screen to say which of them was the selection.
    // Nothing in the document records that the crop *came from* Instagram —
    // `geometry.aspectLock` stores a number — so there is no state here to show.
    const row = page.getByRole('group', { name: '9:16 presets', exact: true })
    await expect(row.locator('[aria-pressed="true"]')).toHaveCount(0)
    // The claim moved to the one row whose labels are the shapes themselves, and
    // its label is the string the canvas overlay just printed.
    const presets = page.getByRole('group', { name: 'Aspect ratio presets' })
    await expect(presets.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(presets.locator('[aria-pressed="true"]')).toHaveText(await shownCrop(page))
    // The claim is about the panel, not about one row: at most one control in it
    // may be lit at all.
    await expect(page.getByRole('dialog').locator('[aria-pressed="true"]')).toHaveCount(1)
    // All five are still one tap away, which is the other half of the claim.
    await expect(row.getByRole('button')).toHaveCount(5)
  })

  test('a square crop lights exactly one control, and it is the one the canvas names', async ({
    openTool,
    page,
    settle,
  }) => {
    await openTool('Crop')
    await openPlatformCatalogue(page)
    const square = page.getByRole('group', { name: '1:1 presets', exact: true })
    await square.getByRole('button', { name: 'LinkedIn 1:1', exact: true }).click()
    await settle()

    // Seven platforms offer 1:1 and every one of them produces this crop. It
    // used to put seven lit chips in this row and an eighth in the row above —
    // eight selection controls for one shape.
    await expect.poll(() => shownCrop(page), { timeout: 10_000 }).toBe('1:1')
    const panel = page.getByRole('dialog', { name: 'Crop & Straighten' })
    const lit = panel.locator('[aria-pressed="true"]')
    await expect(lit).toHaveCount(1)
    await expect(lit).toHaveText('1:1')
    await expect(square.locator('[aria-pressed="true"]')).toHaveCount(0)
    // Nothing in the print row either: none of the five sizes is square, so a
    // square crop has no paper claim to make.
    await expect(
      panel.getByRole('group', { name: 'Print sizes' }).locator('[aria-pressed="true"]'),
    ).toHaveCount(0)

    // And the panel has to say this in words, because "nothing is lit" in a row
    // of twenty-two chips reads as a row that has stopped working.
    await expect(panel).toContainText(
      'Every chip here sets the same crop. The lit ratio above is the shape the canvas is showing.',
    )
  })

  test('"Reset crop" takes the claim off the ratio, because the crop left it', async ({
    openTool,
    page,
    settle,
  }) => {
    await openTool('Crop')
    await page
      .getByRole('group', { name: 'Aspect ratio presets' })
      .getByRole('button', { name: '16:9', exact: true })
      .click()
    const wide = page.getByRole('group', { name: '16:9 presets', exact: true })
    await expect(wide.locator('[aria-pressed="true"]')).toHaveCount(0)

    await page.getByRole('button', { name: 'Reset crop' }).click()
    await settle()
    // The box is the photo's own proportion again, so the canvas says so…
    expect(await shownCrop(page)).not.toBe('16:9')
    // …and no row claims otherwise any more. `geometry.aspectLock` is still
    // 16/9, because "Reset crop" moves the box and not the lock, and the panel
    // used to read the lock.
    const presets = page.getByRole('group', { name: 'Aspect ratio presets' })
    await expect(presets.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(presets.locator('[aria-pressed="true"]')).toHaveText(await shownCrop(page))
    // Sample 1's full frame is 3:2, and "Pinterest Pin 2:3" is a 2:3 chip that
    // used to light with it — so this used to be a panel with two lit *ratio*
    // controls and one shape. The count is scoped to the six platform rows plus
    // the generic one on purpose: the print row is not a claim about a ratio. A
    // print size is a size in millimetres, 152.4 / 101.6 is 1.5 exactly, and the
    // export will really be 4 × 6 in, so it stays lit — see the print case below.
    let litRatios = 0
    for (const row of [
      'Aspect ratio presets',
      '1:1 presets',
      '4:5 presets',
      '1.91:1 presets',
      '9:16 presets',
      '16:9 presets',
      '2:3 presets',
    ]) {
      litRatios += await page
        .getByRole('group', { name: row, exact: true })
        .locator('[aria-pressed="true"]')
        .count()
    }
    expect(litRatios, 'more than one chip claims the shape').toBe(1)
  })

  test('the W:H field stops claiming a ratio the readout no longer honours', async ({
    openTool,
    page,
    settle,
  }) => {
    await openTool('Crop')
    const field = page.getByRole('textbox', { name: 'Custom aspect ratio' })
    await field.fill('16:9')
    await settle()
    await expect(field).toHaveValue('16:9')

    await page.getByRole('button', { name: 'Reset crop' }).click()
    await settle()
    // The field is a control that writes a claim about the crop, so it has to
    // stop making that claim when the crop stops honouring it. The canvas
    // overlay is the readout; the field is not a second one.
    await expect(field).toHaveValue('')
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('a print chip is a sheet of paper with its millimetres, not a photo frame', async ({
    openTool,
    page,
    settle,
  }) => {
    await openTool('Crop')
    await openPlatformCatalogue(page)
    const prints = page.getByRole('group', { name: 'Print sizes' })
    const fourBySix = prints.getByRole('button', { name: /4 × 6 in/ })
    await expect(fourBySix).toContainText('101.6 × 152.4 mm')
    await expect(prints.getByRole('button', { name: /A4/ })).toContainText('210 × 297 mm')

    await fourBySix.click()
    await settle()
    await expect(fourBySix).toHaveAttribute('aria-pressed', 'true')
    // 4 × 6 in is 2:3 exactly, so the generic row claims the shape and the print
    // row claims the paper — two rows lit, two *different* facts. That is the
    // difference between this row and the platform block: a size in millimetres
    // is something the export will honour, and seven chips all reading "1:1" is
    // one fact said seven times. The platform row stays dark.
    await expect(
      page.getByRole('group', { name: 'Aspect ratio presets' }).locator('[aria-pressed="true"]'),
    ).toHaveText('2:3')
    await expect(
      page
        .getByRole('group', { name: '2:3 presets', exact: true })
        .getByRole('button', { name: 'Pinterest Pin 2:3', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
