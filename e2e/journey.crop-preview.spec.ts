import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { effectiveOutputSize } from '../src/model/selectors'
import type { Doc } from '../src/model/types'

/**
 * The crop reaches the canvas.
 *
 * `LoopKey` — the thing the rAF loop compares frame to frame — had no field for
 * *whether the crop is being edited*. The crop itself is in the document and so
 * was in the key by way of `revision`; the fact that the Crop tool is open is
 * not in the document at all. So setting a 1:1 crop and then closing the Crop
 * tool changed every field of the key to the value it already had,
 * `shouldRenderFrame` said no, and **no frame ran**. The canvas kept the whole
 * frame: element and painted bytes together, at the source's 2:3 rather than the
 * crop's 1:1. It stayed that way until a window resize changed `containerSize`
 * and forced the frame nobody had asked for — which is what made it read as a
 * layout quirk rather than a crop that had been silently dropped.
 *
 * ## Why these assertions are about pixels
 *
 * The element and its pixels went stale *together*, so a test on `boundingBox()`
 * alone would have gone green on the defect: `applyLayout` runs inside the skipped
 * frame, so the box was exactly as stale as the image. Everything below reads the
 * painted bytes off the canvas backing store.
 *
 * The decisive one is `gridDiff(…, afterForcedRepaint(…))`: the preview straight
 * after the panel switch is compared, sample by sample, against the preview after
 * the resize that used to be the only thing that fixed it. Before the fix those are
 * two different photographs — the whole frame and the crop — and the difference is
 * in the tens. After it they are the same photograph at two proxy sizes, and it is
 * under three units of resampling noise. That is the audit's "byte-identical to
 * the uncropped render" measurement turned round to point the other way.
 */

type Painted = {
  /** The backing store, which is what `drawImage` wrote. */
  width: number
  height: number
  /** The CSS box, which `applyLayout` wrote. Asserted alongside, never instead. */
  boxWidth: number
  boxHeight: number
  /** 24x24 mean-luma grid of the painted bytes. */
  grid: number[]
}

const GRID = 24

/**
 * Read the presentation canvas the way the user sees it.
 *
 * Downsampled through a scratch 2D canvas rather than read at full size: a
 * 1500x1500 `getImageData` is nine megabytes per call, and the grid is what the
 * comparisons actually need.
 */
async function painted(canvas: Locator): Promise<Painted> {
  return (await canvas.evaluate((node, grid) => {
    const el = node as HTMLCanvasElement
    const scratch = document.createElement('canvas')
    scratch.width = grid
    scratch.height = grid
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context for the readback')
    ctx.drawImage(el, 0, 0, grid, grid)
    const { data } = ctx.getImageData(0, 0, grid, grid)
    const out = new Array(grid * grid).fill(0)
    for (let y = 0; y < grid; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const i = (y * grid + x) * 4
        out[y * grid + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      }
    }
    const rect = el.getBoundingClientRect()
    return {
      width: el.width,
      height: el.height,
      boxWidth: Math.round(rect.width),
      boxHeight: Math.round(rect.height),
      grid: out,
    }
  }, GRID)) as Painted
}

/**
 * The preview after the only thing that used to fix it: a resize, which changes
 * `containerSize` and so the key's `size` field whatever else the key is missing.
 *
 * Polled on the element's box rather than slept for, so a slow frame costs a wait
 * and not a flake — and on the *box* rather than the backing store, because
 * `computeProxySize` clamps its long edge at 2048 and on a 2x display both sizes
 * clamp to the same number, so "the backing store changed" is a signal that only
 * exists on a 1x one.
 *
 * Measured on the sample at 1280x900, the two things this compares are:
 *
 *     the same photograph at two proxy sizes   mean per-channel difference  0.15
 *     the whole frame against the 1:1 crop     mean per-channel difference 24.19
 *
 * So the 3 below is twenty times the noise and eight times smaller than the thing
 * it is standing in for.
 */
async function afterForcedRepaint(
  page: Page,
  canvas: Locator,
  size: { width: number; height: number },
  before: Painted,
): Promise<Painted> {
  await page.setViewportSize({ width: size.width, height: size.height - 80 })
  await expect
    .poll(async () => (await painted(canvas)).boxWidth, { timeout: 5000 })
    .not.toBe(before.boxWidth)
  return painted(canvas)
}

/** Mean per-channel difference between two mean-luma grids, in 0..255 units. */
function gridDiff(a: readonly number[], b: readonly number[]): number {
  const total = a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0)
  return total / a.length
}

test.describe('a set crop reaches the canvas', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  /**
   * The audit measured this with Retouch open and then again with Layers open, and
   * the second measurement is the one that says what it is: a fix that holds for
   * only one panel is a fix for the panel, not for the loop. Both go through
   * `openTool`, which writes `activeTool` to the ui store and nothing else.
   */
  for (const panel of ['Retouch', 'Layers'] as const) {
    test(`the canvas paints the crop, not the whole frame, with ${panel} open`, async ({
      page,
      openTool,
      canvas,
      settle,
      readDoc,
    }) => {
      await openTool('Crop')
      await page.getByRole('button', { name: '1:1', exact: true }).first().click()
      await settle()

      const cropped: Doc = await readDoc()
      const expected = effectiveOutputSize(cropped)
      expect(expected.width).toBe(expected.height)

      await openTool(panel)
      await settle()

      const shown = await painted(canvas())
      // The bytes, read back out of the canvas: the crop's proportions and not the
      // source's. The sample is 2:3, so a whole frame cannot pass this.
      expect(shown.width / shown.height).toBeCloseTo(expected.width / expected.height, 1)
      expect(shown.width).toBe(shown.height)
      // The box agrees — it did before the fix too, which is why it is not the
      // assertion. Here so a later change cannot quietly move one without the other.
      expect(shown.boxWidth).toBe(shown.boxHeight)

      const repainted = await afterForcedRepaint(
        page,
        canvas(),
        { width: 1280, height: 900 },
        shown,
      )
      expect(gridDiff(shown.grid, repainted.grid)).toBeLessThan(3)
    })
  }

  test('reopening the Crop tool puts the whole frame back under the box', async ({
    page,
    openTool,
    canvas,
    settle,
    readDoc,
  }) => {
    // The other direction, and the one with hands on it. While the Crop tool is
    // open the preview deliberately drops the crop so the box has the pixels it
    // discards around it, and `CropOverlay` computes that box in whole-frame
    // coordinates. On the stale frame the canvas was the *crop* while the overlay
    // still assumed the whole frame, so the box was drawn half the width of the
    // image and every corner handle sat on the wrong pixel.
    await openTool('Crop')
    await page.getByRole('button', { name: '1:1', exact: true }).first().click()
    await settle()
    await openTool('Adjust')
    await settle()
    const cropped = await painted(canvas())
    expect(cropped.width).toBe(cropped.height)

    await openTool('Crop')
    await settle()
    const whole = await painted(canvas())
    const source = (await readDoc()).source!
    expect(whole.width / whole.height).toBeCloseTo(source.width / source.height, 1)
    expect(whole.height).toBeGreaterThan(whole.width)

    // A 1:1 crop of a 2:3 picture is full width and 66% of the height, and the box
    // is drawn in the frame's own coordinates — so on the whole frame it spans the
    // canvas edge to edge and stops two thirds of the way down. The handle squares
    // straddle the corners, so their centres are the corners; measured at 1280x900,
    // `nw` sits on `frame.x` and `se` on `frame.x + frame.width`, to the pixel.
    //
    // Both ratios are false on the crop-sized canvas the stale frame left behind,
    // and the width ratio is the one that discriminates: the overlay drew a box the
    // full frame's width on a canvas showing the crop, so it came out 0.66 of the
    // canvas rather than all of it.
    const frame = await canvas().boundingBox()
    const nw = await page.getByRole('slider', { name: 'Crop nw handle' }).boundingBox()
    const se = await page.getByRole('slider', { name: 'Crop se handle' }).boundingBox()
    expect(frame).not.toBeNull()
    expect(nw).not.toBeNull()
    expect(se).not.toBeNull()
    const nwCorner = { x: nw!.x + nw!.width / 2, y: nw!.y + nw!.height / 2 }
    const seCorner = { x: se!.x + se!.width / 2, y: se!.y + se!.height / 2 }
    expect(Math.abs(nwCorner.x - frame!.x)).toBeLessThan(2)
    expect(Math.abs(seCorner.x - (frame!.x + frame!.width))).toBeLessThan(2)
    expect(Math.abs((seCorner.x - nwCorner.x) / frame!.width - 1)).toBeLessThan(0.01)
    expect(Math.abs((seCorner.y - nwCorner.y) / frame!.height - 0.662)).toBeLessThan(0.01)

    const repainted = await afterForcedRepaint(page, canvas(), { width: 1280, height: 900 }, whole)
    expect(gridDiff(whole.grid, repainted.grid)).toBeLessThan(3)
  })

  test('the heal pad and the canvas are the same photograph, so there is nothing to anchor', async ({
    page,
    openTool,
    canvas,
    settle,
  }) => {
    await openTool('Crop')
    await page.getByRole('button', { name: '1:1', exact: true }).first().click()
    await settle()
    await openTool('Retouch')
    await settle()

    // `CropRegionOverlay` exists to draw the crop rectangle when the canvas is
    // showing the whole frame, because the heal pad shows the crop and a reader
    // had no way to tell the two apart. That state *was* the bug: the canvas was
    // showing the whole frame because no frame had run. With the canvas the crop,
    // the rectangle would coincide with the visible frame — a decoration
    // pretending to be an explanation — so it draws nothing.
    await expect(page.locator('[data-crop-region]')).toHaveCount(0)

    // Which only says anything because the canvas really is the crop, asserted on
    // its bytes rather than on the absence of an element.
    const shown = await painted(canvas())
    expect(shown.width).toBe(shown.height)
  })
})
