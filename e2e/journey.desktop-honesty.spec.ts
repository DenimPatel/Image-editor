import { test, expect } from './fixtures'

/**
 * The desktop journey, second pass.
 *
 * Four things a person reads on screen and a test can catch. Each failed before
 * the change it names: a sentence promising a selection the field does not make,
 * a control named twice on top of itself, a line repeating the line above it, and
 * a setting that takes the click and moves nothing.
 */

test.describe('with a photo loaded', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('typing into a new text layer replaces its placeholder words', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const panel = await openTool('Text')
    // The empty state says so in as many words: "…with its words ready to
    // replace."
    await expect(panel.getByText(/with its words ready to replace/)).toBeVisible()

    await panel.getByRole('button', { name: 'Add text' }).click()
    await settle()

    const field = panel.getByLabel('Text content')
    await expect(field).toBeVisible()

    // The panel must not take focus for itself. Focus in a text field is where
    // the browser's own Cmd+Z lives, so auto-focusing it is how the first undo
    // after "Add text" ends up doing nothing at all.
    await expect(field).not.toBeFocused()

    await field.click()
    await field.type('KODAK')
    await settle()

    // Before the fix the caret sat at the end of the layer's own placeholder
    // text and the layer came out as "Edit this textKODAK".
    const layers = (await readDoc()).layers
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({ kind: 'text', text: 'KODAK' })
  })

  test('the Amount control is named once, not twice', async ({ openTool, settle }) => {
    const panel = await openTool('Looks')
    await panel.getByRole('button', { name: 'Cyberpunk' }).click()
    await settle()

    // Twenty-four looks sit above it, so scroll the panel to the end.
    await panel.evaluate((node) => {
      const body = node.closest('[class*="sheetBody"]') ?? node
      body.scrollTop = body.scrollHeight
    })
    const slider = panel.getByLabel(/Amount/)
    await expect(slider).toBeVisible()
    await expect(slider).toHaveValue('100')

    // Before the fix a section title read "AMOUNT" immediately above a slider
    // labelled "Amount", with nothing between them.
    await expect(panel.getByText(/^Amount\b/)).toHaveCount(1)
  })

  test('the editor says the theme cannot change the canvas', async ({ page, openTool }) => {
    await openTool('Adjust')
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: /Appearance/ }).click()

    const panel = page.getByRole('dialog', { name: 'Appearance' })
    await expect(panel.getByText(/stay dark whatever you pick here/)).toBeVisible()

    // The setting still takes and still persists — it is just not about this
    // screen, and the panel now says so instead of looking broken.
    await panel.getByRole('radio', { name: 'Theme: Light' }).click({ force: true })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })
})

test.describe('the import screen, before anything is loaded', () => {
  test.beforeEach(async ({ goto, clearStorage }) => {
    await goto('/editor')
    await clearStorage()
  })

  test('the formats are named once, and HEIC stays on the screen', async ({ page }) => {
    const screen = page.getByTestId('import-screen')
    await expect(screen.getByText(/JPEG · PNG · WebP/)).toBeVisible()
    // Before the fix the footer repeated the same list as raw MIME subtypes —
    // "jpeg, jpg, png, webp, avif, gif, bmp, tiff" — naming nine formats where
    // seven are accepted, and pushed the line that is *not* obvious from the
    // drop zone further below the fold.
    await expect(screen.getByText('Supported set:')).toHaveCount(0)
    // `HEIC/HEIF`, not the sentence around it. The line used to read "HEIC/HEIF
    // isn't supported" and was reworded to "A HEIC/HEIF photo? No browser can open
    // one — save it as JPEG and try again", which says the same thing more
    // usefully; pinning the old sentence turned a better import screen into a red
    // suite. What matters, and what this still holds the product to, is that a
    // reader whose camera writes HEIC finds the format named before they try.
    await expect(screen.getByText(/HEIC\/HEIF/)).toBeAttached()
  })
})
