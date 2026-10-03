import { test, expect } from './fixtures'

/**
 * D9-F01 — text layers.
 *
 * The journey is the one a user takes with any layer editor: add it, put it
 * where you want it, name it something they will recognise tomorrow, blend it
 * into the photo. Every step is asserted against *both* the layer list a user
 * can see and the document the app actually committed, because a list that
 * renders stale data and a document that never changed are the same bug.
 */

test.describe('layers', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('add, move, rename and blend a text layer, and undo each step', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    // --- add -----------------------------------------------------------------
    const textPanel = await openTool('Text')
    await textPanel.getByRole('button', { name: 'Add text' }).click()
    await settle()

    const added = await readDoc()
    expect(added.layers).toHaveLength(1)
    expect(added.layers[0].kind).toBe('text')
    expect(added.layers[0].name).toBe('Edit this text')
    expect(added.layers[0].transform.blend).toBe('normal')
    const startX = added.layers[0].transform.x
    const startY = added.layers[0].transform.y

    // --- move ----------------------------------------------------------------
    // A real pointer drag on the canvas, which is the only way a layer moves
    // for a user; the X/Y sliders are asserted below to agree with it.
    const box = await page.locator('canvas.ie-canvas-el').boundingBox()
    if (!box) throw new Error('the editor canvas has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 12 })
    await page.mouse.up()
    await settle()

    const moved = (await readDoc()).layers[0].transform
    expect(moved.x).not.toBeCloseTo(startX, 3)
    expect(moved.y).not.toBeCloseTo(startY, 3)
    await expect(page.getByRole('slider', { name: /^X / })).toHaveValue(
      String(Math.round(moved.x * 100)),
    )

    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    const undone = (await readDoc()).layers[0].transform
    expect(undone.x).toBeCloseTo(startX, 3)
    expect(undone.y).toBeCloseTo(startY, 3)

    // --- rename --------------------------------------------------------------
    const list = await openTool('Layers')
    await expect(list.getByRole('button', { name: 'Text · Edit this text' })).toBeVisible()
    // The row is named after the layer, and "tap" is not a thing a desktop does.
    await expect(list.getByRole('button', { name: /Tap to edit/ })).toHaveCount(0)
    await list.getByRole('button', { name: 'Rename layer' }).click()
    const nameField = list.getByLabel('Layer name')
    await nameField.fill('Headline')
    await nameField.press('Enter')
    await settle()

    await expect(list.getByRole('button', { name: 'Text · Headline' })).toBeVisible()
    expect((await readDoc()).layers[0].name).toBe('Headline')

    // --- blend ---------------------------------------------------------------
    const blendPanel = await openTool('Text')
    const blend = blendPanel.getByRole('group', { name: 'Blend mode' })
    await expect(blend.getByRole('button', { name: 'Normal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await blend.getByRole('button', { name: 'Overlay' }).click()
    await settle()

    await expect(blend.getByRole('button', { name: 'Overlay' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect((await readDoc()).layers[0].transform.blend).toBe('overlay')

    // Switching tools and back must not lose the selection: reopening the text
    // panel shows the blend the document is actually holding.
    const listAgain = await openTool('Layers')
    await listAgain.getByRole('button', { name: 'Text · Headline' }).click()
    const reopened = await openTool('Text')
    await expect(
      reopened.getByRole('group', { name: 'Blend mode' }).getByRole('button', { name: 'Overlay' }),
    ).toHaveAttribute('aria-pressed', 'true')

    // --- undo ----------------------------------------------------------------
    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    expect((await readDoc()).layers[0].transform.blend).toBe('normal')
  })

  test('undo removes a freshly added text layer in one step', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    const textPanel = await openTool('Text')
    await textPanel.getByRole('button', { name: 'Add text' }).click()
    await settle()
    expect((await readDoc()).layers).toHaveLength(1)

    await page.keyboard.press('ControlOrMeta+z')
    await settle()
    expect((await readDoc()).layers).toHaveLength(0)
    // The panel falls back to its "add something" state.
    await expect(page.getByRole('dialog', { name: 'Text' })).toContainText('Add text')
  })

  test('hiding a layer is a document edit the list reflects', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const textPanel = await openTool('Text')
    await textPanel.getByRole('button', { name: 'Add text' }).click()
    await settle()

    const list = await openTool('Layers')
    await list.getByRole('button', { name: 'Hide layer' }).click()
    await settle()

    expect((await readDoc()).layers[0].visible).toBe(false)
    await expect(list.getByRole('button', { name: 'Show layer' })).toBeVisible()
  })

  test('the layer list reorders with bring-to-front', async ({ openTool, readDoc, settle }) => {
    const textPanel = await openTool('Text')
    await textPanel.getByRole('button', { name: 'Add text' }).click()
    await settle()
    const first = (await readDoc()).layers[0].id

    const list = await openTool('Layers')
    await list.getByRole('button', { name: 'Text · Edit this text' }).click()
    await list.getByRole('button', { name: 'Bring to front' }).click()
    await settle()
    expect((await readDoc()).layers[0].id).toBe(first)

    await list.getByRole('button', { name: 'Delete layer' }).click()
    await settle()
    expect((await readDoc()).layers).toHaveLength(0)
    await expect(list.getByText('No layers yet')).toBeVisible()
  })
})
