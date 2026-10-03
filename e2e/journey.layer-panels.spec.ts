import { expect } from '@playwright/test'
import { test, type ToolName } from './fixtures'

/**
 * The layer panels read as instructions, not as a wall of identifiers.
 *
 * Six panels, and until now two of them — the two a first-time user opens first
 * — said nothing at all, while the other four printed the identifier the model
 * stores (`solid`, `pen`, `rect`, `text · `) instead of the word. This spec is
 * the browser-level half of the fix: it asserts what a screen-reader and a
 * keyboard user get, which is the thing `panels.test.tsx` asserts in jsdom, and
 * it does it against the running app rather than a render.
 *
 * Every locator is by accessible name or role, and there is not one CSS-module
 * class in this file. A chip that is renamed to something that is no longer a
 * `<button>` has to fail here, and so does a chip that kept its name but lost
 * its selection state.
 */

/**
 * The five panels that can be empty, and the sentence each one opens with. Draw
 * is the pattern the other four were measured against: it named the absence,
 * then said what creating one does, in one sentence.
 */
const EMPTY_STATE = {
  Text: 'No text layer yet',
  Draw: 'No drawing layer yet',
  Redact: 'No redaction yet',
  Layers: 'No layers yet',
  Frame: 'No frame yet',
} satisfies Partial<Record<ToolName, string>>

test.describe('layer panels', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('an empty panel explains itself before it offers an action', async ({ openTool }) => {
    for (const [tool, sentence] of Object.entries(EMPTY_STATE) as [ToolName, string][]) {
      const panel = await openTool(tool)
      await expect(panel.getByText(sentence), tool).toBeVisible()
    }
  })

  test('an explanation is replaced by the thing it described, not kept beside it', async ({
    openTool,
    settle,
  }) => {
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add text' }).click()
    await settle()
    const list = await openTool('Layers')
    await expect(list.getByText(EMPTY_STATE.Layers)).toHaveCount(0)
    // And the row is named in words, not in the `kind` the model stores.
    await expect(list.getByRole('button', { name: 'Text · Edit this text' })).toBeVisible()
    const textAgain = await openTool('Text')
    await expect(textAgain.getByText(EMPTY_STATE.Text)).toHaveCount(0)
  })

  test('a chip keeps its word when the drawing arrives', async ({ openTool, settle }) => {
    const frame = await openTool('Frame')
    const styles = frame.getByRole('group', { name: 'Frame styles' })
    for (const word of ['Solid', 'Inset', 'Polaroid', 'Film strip', 'Rounded', 'Shadow card']) {
      const chip = styles.getByRole('button', { name: word, exact: true })
      await expect(chip, word).toBeVisible()
      // The drawing is inside the chip and hidden from the name, so it adds
      // without renaming: the accessible name is still exactly the word.
      await expect(chip.locator('svg')).toHaveAttribute('aria-hidden', 'true')
    }

    await styles.getByRole('button', { name: 'Polaroid', exact: true }).click()
    await settle()
    await expect(styles.getByRole('button', { name: 'Polaroid', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The frame row is named after the style, so two frames of different styles
    // are two distinguishable rows rather than two identical ones.
    const list = await openTool('Layers')
    await expect(list.getByRole('button', { name: 'Frame · Polaroid' })).toBeVisible()
  })

  test('every brush and redaction mode is named and drawn', async ({ openTool, settle }) => {
    const draw = await openTool('Draw')
    await draw.getByRole('button', { name: 'New drawing layer' }).click()
    await settle()
    const brushes = draw.getByRole('group', { name: 'Brush' })
    for (const word of ['Pen', 'Marker', 'Highlighter', 'Neon', 'Eraser']) {
      await expect(
        brushes.getByRole('button', { name: word, exact: true }).locator('svg'),
      ).toHaveCount(1)
    }
    await brushes.getByRole('button', { name: 'Highlighter', exact: true }).click()
    await settle()
    await expect(brushes.getByRole('button', { name: 'Highlighter', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const redact = await openTool('Redact')
    await redact.getByRole('button', { name: 'Add redaction' }).click()
    await settle()
    const modes = redact.getByRole('group', { name: 'Redaction mode' })
    for (const word of ['Pixelate', 'Blur', 'Solid', 'Emoji']) {
      await expect(
        modes.getByRole('button', { name: word, exact: true }).locator('svg'),
      ).toHaveCount(1)
    }
  })

  test('the blend row is as long as the factory says, and every chip is named', async ({
    openTool,
    settle,
  }) => {
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add text' }).click()
    await settle()
    const blend = text.getByRole('group', { name: 'Blend mode' })
    const words = ['Normal', 'Multiply', 'Screen', 'Overlay', 'Darken', 'Lighten', 'Soft', 'Hard']
    await expect(blend.getByRole('button')).toHaveCount(words.length)
    for (const word of words) {
      await expect(
        blend.getByRole('button', { name: word, exact: true }).locator('svg'),
      ).toHaveCount(1)
    }
    // The two abbreviated chips say their full name on hover without renaming.
    await expect(blend.getByRole('button', { name: 'Soft', exact: true })).toHaveAttribute(
      'title',
      'Soft light',
    )
    await expect(blend.getByRole('button', { name: 'Hard', exact: true })).toHaveAttribute(
      'title',
      'Hard light',
    )
  })

  test('a watermark has an inspector, and its position sliders say what they move', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add watermark' }).click()
    await settle()
    expect((await readDoc()).layers[0].kind).toBe('watermark')

    // Everything the compositor honours for a watermark, reachable.
    await expect(text.getByLabel('Watermark text')).toHaveValue('© Your Name')
    await expect(text.getByLabel('Anchor')).toHaveValue('bottom-right')
    await expect(text.getByRole('button', { name: 'Tile across the image' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    for (const slider of ['Offset X', 'Offset Y', 'Scale', 'Rotation', 'Opacity']) {
      await expect(text.getByRole('slider', { name: new RegExp(`^${slider}`) })).toBeVisible()
    }
    await expect(text.getByRole('group', { name: 'Blend mode' })).toBeVisible()
    // And it is *not* labelled X/Y, because for this kind the number is a
    // distance from the anchor rather than a place on the canvas.
    await expect(text.getByRole('slider', { name: /^X/ })).toHaveCount(0)

    const before = (await readDoc()).layers[0].transform
    await text.getByRole('slider', { name: /^Offset X/ }).fill('20')
    await settle()
    expect((await readDoc()).layers[0].transform.x).toBeCloseTo(before.x + 0.2, 6)

    await text.getByRole('button', { name: 'Delete layer' }).click()
    await settle()
    expect((await readDoc()).layers).toHaveLength(0)
    await expect(text.getByText(EMPTY_STATE.Text)).toBeVisible()
  })

  test('a shape and a sticker are named by what they are, not by their id', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const stickers = await openTool('Stickers')
    // Scoped by group, not bare: the built-in sticker `arrow` is labelled
    // "Arrow" and so is the shape, so a bare `exact: true` on the name is two
    // controls. The groups are what make each name unique in its own context,
    // for a screen reader as much as for a locator.
    await stickers
      .getByRole('group', { name: 'Shapes' })
      .getByRole('button', { name: 'Rectangle', exact: true })
      .click()
    await settle()
    await stickers
      .getByRole('group', { name: 'Stickers' })
      .getByRole('button', { name: 'Star', exact: true })
      .click()
    await settle()

    // The document keeps the id; only the words on screen changed.
    expect((await readDoc()).layers.map((layer) => layer.kind)).toEqual(['shape', 'sticker'])

    const list = await openTool('Layers')
    await expect(list.getByRole('button', { name: 'Shape · Rectangle' })).toBeVisible()
    await expect(list.getByRole('button', { name: 'Sticker · Star' })).toBeVisible()
    // Nothing in the list still prints an identifier as the prefix.
    await expect(list.getByRole('button', { name: /^shape / })).toHaveCount(0)
    await expect(list.getByRole('button', { name: /^sticker / })).toHaveCount(0)
  })
})
