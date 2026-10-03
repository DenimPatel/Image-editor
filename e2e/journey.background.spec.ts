import { test, expect } from './fixtures'

/**
 * D9-F01 — background removal, without the 42 MB download.
 *
 * `@imgly/background-removal` fetches its weights from the imgly CDN on first
 * use, so a test that clicks "Remove background" is a test that depends on a
 * third-party CDN being up, being fast, and not rate-limiting CI. This file
 * therefore asserts the paths that are honest *without* a network: the panel
 * states the cost and where the weights come from, the manual replacement modes
 * work offline, and the transparent-PNG shortcut is a real document edit.
 *
 * The download-dependent run is behind `E2E_MATTING=1`. It is not in the CI
 * matrix on purpose — see the report in this file's tail comment.
 */

test.describe('background panel without the matting model', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('discloses the model size and its origin before anything is downloaded', async ({
    openTool,
  }) => {
    const panel = await openTool('Background')
    await expect(panel.getByRole('button', { name: 'Remove background' })).toBeEnabled()
    // The weight size and the fact that it comes off a CDN are stated up front;
    // if either string regresses, the user is about to be surprised by a
    // surprise download and this fails.
    await expect(panel.getByText(/MB|GB/, { exact: false }).first()).toBeVisible()
    await expect(panel.getByText(/imgly CDN on first use/)).toBeVisible()
    await expect(panel.getByText('(cached)')).toHaveCount(0)
  })

  test('a replacement colour is a real document edit, with no model needed', async ({
    openTool,
    readDoc,
    settle,
    page,
  }) => {
    const panel = await openTool('Background')
    expect((await readDoc()).background.mode).toBe('none')
    const original = (await readDoc()).background.color

    await panel.getByRole('button', { name: 'Colour' }).click()
    await settle()
    expect((await readDoc()).background.mode).toBe('color')
    await expect(panel.getByLabel('Colour')).toBeVisible()

    // The colour input is a real control, not a dead swatch.
    const field = panel.getByLabel('Colour')
    await field.fill('#3366ff')
    await field.dispatchEvent('change')
    await settle()
    expect((await readDoc()).background.color).toBe('#3366ff')

    // Each of those is its own undo step, in the order a user made them.
    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    expect((await readDoc()).background.color).toBe(original)

    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    expect((await readDoc()).background.mode).toBe('none')
  })

  test('Keep transparency switches the export to PNG so alpha survives, without claiming a matte', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    expect((await readDoc()).output.format).toBe('jpeg')

    const panel = await openTool('Background')
    await expect(panel.getByText('Current output: JPEG')).toBeVisible()
    await panel.getByRole('button', { name: 'Keep transparency (PNG)' }).click()
    await settle()

    const doc = await readDoc()
    expect(doc.output.format).toBe('png')
    expect(doc.output.matte).toBe('transparent')
    expect(doc.background.mode).toBe('none')
    // Not `true`, which is what this asserted until the button was measured on a
    // JPEG: nothing has cut a matte out of this photo, and writing `removed`
    // anyway switched off the panel's own warning that a replacement background
    // has nothing to show through.
    expect(doc.background.removed).toBe(false)
    await expect(panel.getByText('Current output: PNG')).toBeVisible()
  })

  test('a matte warning survives the transparency route, because nothing was cut out', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const panel = await openTool('Background')

    // The transparency route first: it picks PNG and leaves the alpha alone.
    await panel.getByRole('button', { name: 'Keep transparency (PNG)' }).click()
    await settle()
    expect((await readDoc()).background.removed).toBe(false)

    // Now ask for a replacement background behind the photo. Nothing has been
    // cut out of this JPEG, so there is nothing for the colour to show through
    // — and the panel has to say so rather than take the click and change
    // nothing. Before the fix `removed` was `true` after the first click, this
    // warning did not appear, and the canvas did not move by a pixel.
    await panel.getByRole('button', { name: 'Colour' }).click()
    await settle()
    await expect(panel.getByText(/Nothing has been removed from the background yet/)).toBeVisible()
  })

  test('gradient mode exposes both stops and an angle', async ({ openTool, readDoc, settle }) => {
    const panel = await openTool('Background')
    await panel.getByRole('button', { name: 'Gradient' }).click()
    await settle()
    expect((await readDoc()).background.mode).toBe('gradient')
    await expect(panel.getByLabel('From')).toBeVisible()
    await expect(panel.getByLabel('To')).toBeVisible()
    await expect(panel.getByRole('slider', { name: /^Angle/ })).toBeVisible()
  })

  test('downloads the model and produces a matte with alpha', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    // Opt in with E2E_MATTING=1. The default is a skip rather than a pass, and
    // the reason lands in the report so nobody mistakes it for coverage.
    test.skip(
      !process.env.E2E_MATTING,
      'E2E_MATTING is unset: the real matte needs the ~42 MB imgly CDN fetch',
    )
    const panel = await openTool('Background')
    await panel.getByRole('button', { name: 'Remove background' }).click()
    // The model fetch is slow and network-bound; the editor's own toast is the
    // signal that it finished.
    await expect(page.getByText('Background removed')).toBeVisible({ timeout: 180_000 })
    await settle()
    expect((await readDoc()).background.removed).toBe(true)
  })
})
