import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { waitForEstimate } from './scene'

/**
 * D1-F13 — the Retouch panel, on the claim that made the tab a problem.
 *
 * The render pipeline has applied `doc.retouch` since the kernel landed: both
 * backends run `retouch`, `heal` and `redeye`, and `src/render/parity.test.ts`
 * holds GL and CPU to 2/255. Until this panel existed nothing in the app wrote
 * the fields, so the tab opened a paragraph saying so — honest copy on a tab
 * shaped exactly like a peer of Crop. This spec is the other half of that: the
 * panel has to change the photo, in the exported bytes, or the tab is still a
 * lie with a slider in it.
 *
 * So the assertions that matter are on decoded pixels from a real `canvas.toBlob`
 * PNG export — not on a store value and not on a label. And a heal spot has to
 * change the pixels *where it was placed and nowhere else*, because that is the
 * claim a placement surface makes: a panel that smoothed the whole frame would
 * pass a "did anything change" check while being useless.
 */

/** Mean |a-b| per channel in 0..255, split by whether the pixel is in the spot. */
type Diff = { mean: number; inside: number; outside: number; changed: number; pixels: number }

function diffExpression(
  a: string,
  b: string,
  spot: { x: number; y: number; radius: number },
): string {
  return `(async () => {
  const load = async (b64) => {
    const raw = atob(b64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    const bitmap = await createImageBitmap(new Blob([bytes]))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0)
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
    }
  }
  const before = await load(${JSON.stringify(a)})
  const after = await load(${JSON.stringify(b)})
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error('the two exports are different sizes')
  }
  const spot = ${JSON.stringify(spot)}
  // The frame is the whole export, and the retouch kernels read its normalized
  // coordinates, so the spot's disc is measured in the export's own pixels with
  // the width-relative radius the shader compares against.
  const cx = spot.x * before.width
  const cy = spot.y * before.height
  const r = Math.max(1, spot.radius * before.width)
  let total = 0, inside = 0, outside = 0, changed = 0
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const i = (y * before.width + x) * 4
      let delta = 0
      for (let c = 0; c < 3; c += 1) delta += Math.abs(before.data[i + c] - after.data[i + c])
      delta /= 3
      total += delta
      if (delta > 1) changed += 1
      const dx = x - cx, dy = y - cy
      if (dx * dx + dy * dy <= r * r) inside += delta
      else outside += delta
    }
  }
  const pixels = before.width * before.height
  return { mean: total / pixels, inside, outside, changed, pixels }
})()`
}

function pixelDiff(
  page: Page,
  before: Buffer,
  after: Buffer,
  spot = { x: -1, y: -1, radius: 0 },
): Promise<Diff> {
  return page.evaluate(
    diffExpression(before.toString('base64'), after.toString('base64'), spot),
  ) as Promise<Diff>
}

/** The two fixtures an export needs, named so the helpers below can take them. */
type ExportCtx = {
  openTool: (name: 'Export') => Promise<Locator>
  downloadFrom: (action: Locator) => Promise<{ bytes: Buffer; name: string }>
}

/** Export the document as a lossless PNG, so a difference is the edit and not the encoder. */
async function exportPng({ openTool, downloadFrom }: ExportCtx): Promise<Buffer> {
  const sheet = await openTool('Export')
  const format = sheet.getByRole('button', { name: 'PNG', exact: true })
  if ((await format.getAttribute('aria-pressed')) !== 'true') await format.click()
  await waitForEstimate(sheet)
  return (await downloadFrom(sheet.getByRole('button', { name: 'Download', exact: true }))).bytes
}

/** Set a range input the way a keyboard user would, and commit it. */
async function setSlider(page: Page, name: RegExp, value: number): Promise<void> {
  const slider = page.getByRole('slider', { name })
  await slider.focus()
  await slider.evaluate((node, next) => {
    const input = node as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await slider.blur()
}

const pad = (page: Page) =>
  page.getByRole('button', { name: /^Place a heal spot at|^Place a red-eye mark at/ })

/**
 * Playwright's WebKit build cannot store a `Blob` in IndexedDB, so the app's
 * autosave never lands a session there and `persistedDoc()` hangs rather than
 * returning. Verified rather than inferred: with no panel open and no retouch
 * edit in the document at all, the same read hangs on WebKit and returns the row
 * on Chromium — the same limitation `journey.import-edit-export.spec.ts` records
 * as `NO_BLOB_STORAGE` on its two persistence tests. The retouch fields are
 * ordinary `Doc` fields, so what WebKit cannot do here is save *anything*, and
 * the assertion below is about them being saved with the document rather than
 * beside it.
 */
const NO_BLOB_STORAGE =
  'Playwright WebKit cannot store a Blob in IndexedDB (the assets write transaction aborts); the same write succeeds in Chromium'

test.describe('the Retouch panel writes the document', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, openTool, settle, page }) => {
    await goto('/editor')
    await clearStorage()
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
    await openTool('Retouch')
    await expect(page.getByRole('dialog', { name: 'Retouch' })).toBeVisible()
  })

  test('the smoothing dial lands in doc.retouch', async ({ page, readDoc }) => {
    await setSlider(page, /^Smoothing/, 100)
    await expect.poll(async () => (await readDoc()).retouch.smooth, { timeout: 10_000 }).toBe(100)
  })

  test('a spot placed on the pad is stored at the position that was clicked', async ({
    page,
    readDoc,
  }) => {
    const target = pad(page)
    const box = await target.boundingBox()
    expect(box).not.toBeNull()
    // A third of the way across, half way up: texture, not a corner of the frame.
    await target.click({ position: { x: box!.width / 3, y: box!.height / 2 } })

    await expect
      .poll(async () => (await readDoc()).retouch.healSpots.length, { timeout: 10_000 })
      .toBe(1)
    const spot = (await readDoc()).retouch.healSpots[0]!
    // `HealSpot.at` is normalized whole-output space, so the stored point has to
    // be the pad's own fraction of the frame. That is only true if the pad draws
    // the crop, which is what the copy says it does.
    expect(spot.at.x).toBeGreaterThan(0.2)
    expect(spot.at.x).toBeLessThan(0.5)
    expect(spot.at.y).toBeGreaterThan(0.35)
    expect(spot.at.y).toBeLessThan(0.65)
    // The panel reports the same numbers the document holds.
    await expect(target).toHaveAttribute(
      'aria-label',
      new RegExp(`${Math.round(spot.at.x * 100)}% across, ${Math.round(spot.at.y * 100)}% up`),
    )
  })

  test('one undo takes back one edit, and only that edit', async ({ page, readDoc }) => {
    await setSlider(page, /^Smoothing/, 60)
    await expect.poll(async () => (await readDoc()).retouch.smooth).toBe(60)

    await page.getByRole('button', { name: /^Add heal spot$/ }).click()
    await expect.poll(async () => (await readDoc()).retouch.healSpots.length).toBe(1)

    const undo = page.getByRole('button', { name: 'Undo' })
    await undo.click()
    await expect.poll(async () => (await readDoc()).retouch.healSpots.length).toBe(0)
    // The dial is a different step. Two spots of a kind used to coalesce into one
    // history entry, so an undo after two placements took back both of them.
    expect((await readDoc()).retouch.smooth).toBe(60)

    await undo.click()
    await expect.poll(async () => (await readDoc()).retouch.smooth).toBe(0)
  })

  test('the whole panel is reachable and operable from the keyboard', async ({ page, readDoc }) => {
    const across = page.getByRole('slider', { name: /^Across/ })
    await across.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(across).toHaveValue('52')

    const up = page.getByRole('slider', { name: /^Up/ })
    await up.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(up).toHaveValue('48')

    // Enter on the pad places at the crosshair the keyboard just moved. A `click`
    // synthesised from a key carries no coordinates, so a pad that read them
    // would put the spot in the corner instead.
    const target = pad(page)
    await target.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readDoc()).retouch.healSpots.length).toBe(1)
    const spot = (await readDoc()).retouch.healSpots[0]!
    expect(spot.at.x).toBeCloseTo(0.52, 6)
    expect(spot.at.y).toBeCloseTo(0.48, 6)

    // The mode switch is a segmented control: one tab stop, arrow keys, and the
    // mode decides what the next placement writes.
    await page.getByRole('button', { name: /^Heal spot$/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: /^Red-eye$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: /^Add red-eye mark$/ }).click()
    await expect.poll(async () => (await readDoc()).retouch.redEye.length).toBe(1)
  })

  test('every control is either live or off, and none is a promise', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: 'Retouch' })
    await expect(sheet.getByRole('slider', { name: /^Smoothing/ })).toBeVisible()
    await expect(sheet.getByRole('slider', { name: /^Size/ })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /^Add heal spot$/ })).toBeVisible()
    // The copy that used to admit none of these could be reached.
    await expect(sheet.getByText(/not built yet/i)).toHaveCount(0)
    await expect(sheet.getByText(/placeholder/i)).toHaveCount(0)
    // Reset is off until there is something to reset: a live-looking control that
    // does nothing is the exact defect this panel replaced.
    await expect(sheet.getByRole('button', { name: 'Reset retouch' })).toBeDisabled()
    await setSlider(page, /^Smoothing/, 10)
    await expect(sheet.getByRole('button', { name: 'Reset retouch' })).toBeEnabled()
  })

  test('the retouch fields are in the document, so they are saved with it', async ({
    page,
    persistedDoc,
  }) => {
    test.skip(test.info().project.name === 'webkit', NO_BLOB_STORAGE)
    await setSlider(page, /^Smoothing/, 35)
    await page.getByRole('button', { name: /^Add heal spot$/ }).click()
    await expect
      .poll(async () => (await persistedDoc()).retouch.healSpots.length, { timeout: 20_000 })
      .toBe(1)
    expect((await persistedDoc()).retouch.smooth).toBe(35)
  })
})

test.describe('the retouch passes change the exported photo', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle, page }) => {
    await goto('/editor')
    await clearStorage()
    await goto('/editor')
    await loadSample('Sample 1')
    await settle()
    // The claim under test is about the shipped chain, and jsdom has no WebGL —
    // if this browser cannot run the real passes there is nothing here to measure.
    const webgl2 = await page.evaluate(
      () => document.createElement('canvas').getContext('webgl2') !== null,
    )
    expect(webgl2, 'a real WebGL2 context').toBe(true)
  })

  test('smoothing moves the whole frame', async ({ page, openTool, downloadFrom, readDoc }) => {
    const before = await exportPng({ openTool, downloadFrom })
    await openTool('Retouch')
    await setSlider(page, /^Smoothing/, 100)
    await expect.poll(async () => (await readDoc()).retouch.smooth, { timeout: 10_000 }).toBe(100)
    const after = await exportPng({ openTool, downloadFrom })

    const diff = await pixelDiff(page, before, after)
    // A smoothing pass over the frame moves a lot of pixels by more than one
    // level. The renderer dithers, so the floor is not zero — but a dither alone
    // would leave this under the threshold, and that is what it is there to catch.
    expect(diff.mean).toBeGreaterThan(0.5)
    expect(diff.changed).toBeGreaterThan(diff.pixels * 0.2)
  })

  test('a heal spot changes its own disc and leaves the rest of the photo alone', async ({
    page,
    openTool,
    downloadFrom,
    readDoc,
  }) => {
    const before = await exportPng({ openTool, downloadFrom })
    await openTool('Retouch')
    const target = pad(page)
    const box = await target.boundingBox()
    await target.click({ position: { x: box!.width / 3, y: box!.height / 2 } })
    await expect
      .poll(async () => (await readDoc()).retouch.healSpots.length, { timeout: 10_000 })
      .toBe(1)
    const spot = (await readDoc()).retouch.healSpots[0]!
    const after = await exportPng({ openTool, downloadFrom })

    const diff = await pixelDiff(page, before, after, {
      x: spot.at.x,
      y: spot.at.y,
      // The disc is measured a quarter larger than the spot's own radius: the
      // panel's own copy promises "the circle on the crop is that size", and the
      // point of this assertion is that a spot does its work *there*, not that it
      // stops on the last pixel of it.
      radius: spot.radius * 1.25,
    })
    expect(diff.inside, 'pixels inside the spot changed').toBeGreaterThan(0)
    expect(diff.outside, 'pixels outside the spot stayed put').toBeLessThan(diff.inside)
  })
})
