import type { Locator, Page } from '@playwright/test'
import { test, expect, readImageHeader } from './fixtures'

/**
 * D9-F01 — crop.
 *
 * Two independent claims are checked, because either alone is satisfiable by a
 * broken editor: the *readout* must move when the corner moves, and the
 * *exported bytes* must be the size the readout promised. A readout that lies,
 * and a crop that only relabels itself, each fail one of the two.
 *
 * The third block is IMP-041: the readout has to be somewhere other than on top
 * of the crop box. It used to be painted over the bottom-centre of the frame,
 * which put the `s` handle — and the ring a keyboard user gets for focusing it —
 * under a caption.
 */

/** The overlay's dimension line, e.g. `1271 × 1920 px · 2:3`. */
const READOUT = /^\d+ × \d+ px/

/** The four edge handles, and `s` is the one the readout used to cover. */
const EDGE_HANDLES = ['n', 'e', 's', 'w'] as const

/** `AUTOSAVE_DEBOUNCE_MS` is 1000; the failure is reported after that, not before. */
const AUTOSAVE_SETTLE_MS = 1400

type Box = { x: number; y: number; width: number; height: number }

/**
 * Area shared by two boxes, in px². Zero is the claim; `z-index` cannot make it
 * zero, only decide which of the two is on top, and the defect was the overlap.
 */
function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

async function box(locator: Locator, what: string): Promise<Box> {
  const found = await locator.boundingBox()
  if (!found) throw new Error(`${what} has no box in the viewport`)
  return found
}

/**
 * What answers to a press at the centre of `handle`: the handle itself, a
 * descendant of it, or the name of whatever got there instead. A `boundingBox()`
 * says where a mark is drawn; only a hit test says what a press reaches.
 */
async function answerAtCentre(handle: Locator): Promise<string> {
  return handle.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!at) return 'nothing at all'
    return el === at || el.contains(at) ? 'the handle' : `${at.tagName}.${at.className}`
  })
}

/**
 * Clear the app's error log, which is surfaced as a fixed panel over the editor.
 *
 * WebKit's test browser reports "Could not save this session" for every document
 * it opens, and `.toastStack` parks that panel at the top centre — which at
 * 390 × 844 is where the `n` handle is, so it answers to a press aimed at the
 * handle. A real occlusion, from IndexedDB having nothing to do with the readout.
 * Cleared here so this case measures the readout and nothing else; the defect is
 * written up in `.improve/reports/discovered-IMP-041.md` rather than fixed here.
 */
async function dismissErrorLog(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: 'Recent problems' })
  const clear = region.getByRole('button', { name: 'Delete these' })
  // The panel is written when a save *fails*, and autosave is a 1 s trailing
  // debounce, so clearing straight after `settle()` would clear nothing and the
  // panel would arrive in the middle of the hit tests. Wait past the debounce,
  // then clear until it stays clear.
  await page.waitForTimeout(AUTOSAVE_SETTLE_MS)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await clear.count()) === 0) return
    await clear.first().click()
    await page.waitForTimeout(250)
  }
  await expect(region, 'the error panel would sit over the handles under test').toHaveCount(0)
}

async function readout(page: Page): Promise<{ text: string; width: number; height: number }> {
  const text = (await page.getByText(READOUT).first().textContent())?.trim() ?? ''
  const match = /^(\d+) × (\d+) px/.exec(text)
  if (!match) throw new Error(`no crop readout found (got ${JSON.stringify(text)})`)
  return { text, width: Number(match[1]), height: Number(match[2]) }
}

test.describe('crop', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('dragging the south-east handle shrinks the crop and the export', async ({
    page,
    openTool,
    readDoc,
    settle,
    downloadFrom,
  }) => {
    const source = (await readDoc()).source
    expect(source).not.toBeNull()

    await openTool('Crop')
    const before = await readout(page)
    expect(before.width).toBe(source!.width)
    expect(before.height).toBe(source!.height)

    const handle = page.getByRole('slider', { name: 'Crop se handle' })
    await expect(handle).toHaveAttribute('aria-valuenow', '100')
    const box = await handle.boundingBox()
    if (!box) throw new Error('the south-east crop handle has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 150, box.y - 220, { steps: 14 })
    await page.mouse.up()
    await settle()

    const after = await readout(page)
    expect(after.text).not.toBe(before.text)
    expect(after.width).toBeLessThan(before.width)
    expect(after.height).toBeLessThan(before.height)

    const doc = await readDoc()
    expect(doc.geometry.crop.width).toBeLessThan(1)
    expect(doc.geometry.crop.height).toBeLessThan(1)

    const exportPanel = await openTool('Export')
    await expect(
      exportPanel.getByText(new RegExp(`Output: ${after.width} × ${after.height} px`)),
    ).toBeVisible()

    const { bytes } = await downloadFrom(
      exportPanel.getByRole('button', { name: 'Download', exact: true }),
    )
    const header = readImageHeader(bytes)
    expect(header.format).toBe('jpeg')
    expect(header.width).toBe(after.width)
    expect(header.height).toBe(after.height)
  })

  test('the corner handle is keyboard operable and the readout follows', async ({
    page,
    openTool,
    settle,
  }) => {
    await openTool('Crop')
    const before = await readout(page)

    const handle = page.getByRole('slider', { name: 'Crop se handle' })
    await handle.focus()
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowLeft')
    await settle()

    const after = await readout(page)
    expect(after.width).toBeLessThan(before.width)
    expect(await handle.getAttribute('aria-valuenow')).not.toBe('100')
  })

  test('Reset crop restores the full frame', async ({ page, openTool, settle }) => {
    await openTool('Crop')
    const original = await readout(page)

    const handle = page.getByRole('slider', { name: 'Crop nw handle' })
    await handle.focus()
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowRight')
    await settle()
    expect((await readout(page)).width).toBeLessThan(original.width)

    await page.getByRole('button', { name: 'Reset crop' }).click()
    await settle()
    const reset = await readout(page)
    expect(reset.width).toBe(original.width)
    expect(reset.height).toBe(original.height)
  })
})

/**
 * IMP-041 — the readout has to be off the crop box.
 *
 * `z-index` is not the fix, which is why neither case below reaches for it: an
 * outline changes which of two overlapping boxes is painted on top and leaves
 * both of them under the reader's finger. The claim here is two rectangles with
 * nothing in common, plus a hit test at the centre of every edge handle — the
 * readout used to hold `560 px²` of the `s` handle at 1280 × 800, in the middle
 * of the box a press aims at.
 *
 * Both viewports are in one file on purpose. The mobile *project* owns the
 * `journey.mobile*` specs and this is not one of them, so the phone width is set
 * per test here and the two cases run on chromium and webkit alike rather than
 * one of them going unmeasured.
 */
test.describe('the crop readout is not painted over the crop handles', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    test(`no edge handle shares any area with the readout at ${viewport.width} × ${viewport.height}`, async ({
      page,
      openTool,
      settle,
    }) => {
      await page.setViewportSize(viewport)
      await openTool('Crop')
      await settle()

      const line = page.getByText(READOUT).first()
      await expect(line).toBeVisible()
      await dismissErrorLog(page)
      // The whole of the readout, not just the caption: two named buttons and the
      // dimension line, each located by its accessible name or role.
      const parts: [string, Box][] = []
      for (const name of ['Reset crop', 'Perspective']) {
        parts.push([name, await box(page.getByRole('button', { name, exact: true }), name)])
      }
      parts.push(['the readout', await box(line, 'the readout')])

      for (const id of EDGE_HANDLES) {
        const label = `Crop ${id} handle`
        const handle = page.getByRole('slider', { name: label })
        const handleBox = await box(handle, label)
        for (const [what, part] of parts) {
          expect(
            overlapArea(part, handleBox),
            `${what} overlaps ${label} at ${viewport.width} × ${viewport.height}`,
          ).toBe(0)
        }
        expect(
          await answerAtCentre(handle),
          `a press at the centre of ${label} does not reach ${label}`,
        ).toBe('the handle')
      }
    })
  }

  test('the readout still reports the crop, and both overlay buttons still work', async ({
    page,
    openTool,
    settle,
  }) => {
    await openTool('Crop')
    const before = await readout(page)

    // The live numbers and the ratio, from the doc rather than from a copy.
    expect(before.text).toMatch(/^\d+ × \d+ px · \d+(:\d+)?$/)

    const south = page.getByRole('slider', { name: 'Crop s handle' })
    const before1 = await box(south, 'the south handle')
    await page.mouse.move(before1.x + before1.width / 2, before1.y + before1.height / 2)
    await page.mouse.down()
    await page.mouse.move(before1.x, before1.y - 200, { steps: 12 })
    await page.mouse.up()
    await settle()
    expect((await readout(page)).height).toBeLessThan(before.height)

    const perspective = page.getByRole('button', { name: 'Perspective', exact: true })
    await expect(perspective).toHaveAttribute('aria-pressed', 'false')
    await perspective.click()
    await expect(perspective).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Reset crop' }).click()
    await settle()
    const reset = await readout(page)
    expect(reset.width).toBe(before.width)
    expect(reset.height).toBe(before.height)
  })

  test('focusing the south handle draws its ring inside the handle, not over it', async ({
    page,
    openTool,
    settle,
  }) => {
    await openTool('Crop')
    await settle()

    const south = page.getByRole('slider', { name: 'Crop s handle' })
    // `:focus-visible` is a modality heuristic, and a bare programmatic focus is
    // one the two engines answer differently: Chromium keeps the ring, WebKit drops
    // it. One real Tab press settles it on both — it puts the keyboard modality
    // behind the focus the next line moves.
    await page.keyboard.press('Tab')
    await south.focus()
    await expect(south).toBeFocused()

    const ring = await south.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
        offset: Number.parseFloat(style.outlineOffset),
        color: style.outlineColor,
      }
    })
    expect(ring.style, 'the focused handle draws no outline at all').not.toBe('none')
    expect(ring.width).toBeGreaterThan(0)
    expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
    // An outline is painted outward from `border edge + offset`, so the whole ring
    // lies inside the handle's own 28px box exactly when `offset + width <= 0`.
    // The global rule in `base.css` is `offset 2` on a `2px` ring, which puts it
    // 4px outside the mark — in the band of photograph the readout was painted on.
    expect(
      ring.offset + ring.width,
      'the focus ring is drawn outside the handle, where a neighbour can cover it',
    ).toBeLessThanOrEqual(0)
  })
})
