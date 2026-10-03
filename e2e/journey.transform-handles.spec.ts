import type { Locator, Page } from '@playwright/test'
import { test, expect, type ToolName } from './fixtures'

/**
 * D6-F14 — the transform handles, on the layer rather than in a side panel.
 *
 * Every layer kind has a full transform model and `drawLayers` honours all of it,
 * but until these handles the only way to change `transform.scale` or
 * `transform.rotation` was a slider in the inspector, on a photo you are looking
 * at the layer of. The claims here are the ones a unit test cannot make: that a
 * real pointer drag on a real grip moves the layer without also moving it
 * somewhere else, that the whole gesture is one undo, and that a keyboard can
 * reach every grip.
 *
 * Every locator is by accessible name or role, and every assertion is on the live
 * document rather than on a number copied into the test.
 */

const GROUP = 'Layer transform handles'
const CORNER = 'Scale from the bottom right corner'
const ROTATE = 'Rotate layer'

/**
 * A press, a drag and a release over a grip. Several small steps rather than one
 * leap: a single jump would not exercise the intermediate `pointermove`s, and the
 * claim under test is that all of them land in one history entry.
 */
async function dragFrom(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(x + (dx * step) / 8, y + (dy * step) / 8)
  }
  await page.mouse.up()
}

test.describe('D6-F14: on-canvas transform handles', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  async function addText(openTool: (name: ToolName) => Promise<Locator>) {
    const panel = await openTool('Text')
    await panel.getByRole('button', { name: 'Add text' }).click()
  }

  test('a corner grip scales the layer, and one undo takes the whole gesture back', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    await addText(openTool)
    await settle()
    const before = (await readDoc()).layers[0]!.transform

    const grips = page.getByRole('group', { name: GROUP })
    await expect(grips).toBeVisible()
    const corner = grips.getByRole('slider', { name: CORNER })
    await expect(corner).toBeVisible()
    // The grip is a control with a value, not a drawn box.
    await expect(corner).toHaveAttribute('aria-valuenow', '100')

    await dragFrom(page, (await corner.boundingBox())!, 60, 40)
    await settle()

    const after = (await readDoc()).layers[0]!.transform
    expect(after.scale).toBeGreaterThan(before.scale)
    // The default mode holds the pivot, so a scale drag does not also move the
    // layer — which is the other half of "it cannot jump on the first move".
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    await expect(corner).toHaveAttribute('aria-valuenow', String(Math.round(after.scale * 100)))

    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    const undone = (await readDoc()).layers[0]!.transform
    expect(undone.scale).toBeCloseTo(before.scale, 6)
    expect(undone.x).toBeCloseTo(before.x, 6)
    expect(undone.y).toBeCloseTo(before.y, 6)
  })

  test('the rotate grip turns the layer about its own centre, and is one undo step', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    await addText(openTool)
    await settle()
    const before = (await readDoc()).layers[0]!.transform

    const rotate = page.getByRole('group', { name: GROUP }).getByRole('slider', { name: ROTATE })
    const box = (await rotate.boundingBox())!
    // The grip starts directly above the box, so a turn is made by swinging it
    // sideways: straight down would pass through the centre, which is half a turn.
    // Whatever it does, it has to move `rotation` and nothing else.
    await dragFrom(page, box, 160, 0)
    await settle()

    const after = (await readDoc()).layers[0]!.transform
    expect(after.rotation).toBeGreaterThan(10)
    expect(after.rotation).toBeLessThan(90)
    expect(after.scale).toBeCloseTo(before.scale, 6)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)

    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    expect((await readDoc()).layers[0]!.transform.rotation).toBeCloseTo(before.rotation, 6)
  })

  test('a keyboard can reach every grip and move it, coarse with Shift', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    await addText(openTool)
    await settle()
    const before = (await readDoc()).layers[0]!.transform

    const group = page.getByRole('group', { name: GROUP })
    const corner = group.getByRole('slider', { name: CORNER })
    await corner.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await settle()
    expect((await readDoc()).layers[0]!.transform.scale).toBeCloseTo(before.scale + 0.02, 6)

    await page.keyboard.press('Shift+ArrowUp')
    await settle()
    expect((await readDoc()).layers[0]!.transform.scale).toBeCloseTo(before.scale + 0.12, 6)

    // One undo is one key press, not one nudge swallowed by a coalescing window.
    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    expect((await readDoc()).layers[0]!.transform.scale).toBeCloseTo(before.scale + 0.02, 6)

    // The rotation grip is the next control in the same group.
    const rotate = group.getByRole('slider', { name: ROTATE })
    await rotate.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Shift+ArrowUp')
    await settle()
    expect((await readDoc()).layers[0]!.transform.rotation).toBeCloseTo(16, 6)
    await expect(rotate).toHaveAttribute('aria-valuenow', '16')
  })

  test('a layer the compositor cannot transform in place gets no grips', async ({
    page,
    openTool,
    settle,
  }) => {
    // A frame is drawn from its own geometry — a band round the edge — so
    // `drawLayers` never applies its transform, and a grip on it would be a
    // control that visibly does nothing.
    const panel = await openTool('Frame')
    await panel.getByRole('button', { name: 'Solid' }).click()
    await settle()
    await expect(page.getByRole('group', { name: GROUP })).toHaveCount(0)
  })

  test('the crop tool takes the frame for itself', async ({ page, openTool, settle }) => {
    await addText(openTool)
    await settle()
    await expect(page.getByRole('group', { name: GROUP })).toBeVisible()

    await openTool('Crop')
    await settle()
    await expect(page.getByRole('group', { name: GROUP })).toHaveCount(0)
    // The crop box is the overlay that owns the canvas while the crop tool is up.
    await expect(page.getByRole('slider', { name: /^Crop / })).toHaveCount(8)
  })
})
