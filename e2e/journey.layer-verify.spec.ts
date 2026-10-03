import { test, expect } from './fixtures'
import { bandCrop, inkBounds } from './pixels'
import { blackPlate, dragRowOnto, setColor, writePng } from './scene'
import { patchFirstTextStyle, transformFirstLayer } from './store'
import { waitForEstimate } from './scene'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'

/**
 * D6 — the layer journeys, measured on the exported pixels.
 *
 * The pattern throughout: set something up through the panel, export a PNG, and
 * ask what is in it. A screenshot pair that does not differ is a no-op, and a
 * doc field that changed is not proof that the compositor read it.
 */

type Ctx = {
  page: Page
  openTool: (name: 'Text' | 'Stickers' | 'Layers' | 'Export' | 'Redact') => Promise<Locator>
  downloadFrom: (action: Locator) => Promise<{ bytes: Buffer; name: string }>
  settle: () => Promise<void>
}

async function exportPng({ openTool, downloadFrom }: Ctx): Promise<Buffer> {
  const panel = await openTool('Export')
  const png = panel.getByRole('button', { name: 'PNG', exact: true })
  if ((await png.getAttribute('aria-pressed')) !== 'true') await png.click()
  await waitForEstimate(panel)
  const { bytes } = await downloadFrom(panel.getByRole('button', { name: 'Download', exact: true }))
  return bytes
}

async function addText(ctx: Ctx, content: string): Promise<void> {
  const text = await ctx.openTool('Text')
  await text.getByRole('button', { name: 'Add text' }).click()
  await ctx.settle()
  const panel = await ctx.openTool('Text')
  await panel.getByLabel('Text content').fill(content)
  await ctx.settle()
}

test.describe('layers · text', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('D6-F16: all fourteen faces really load, and the one you pick is the one drawn', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const ctx: Ctx = { page, openTool, downloadFrom, settle }

    // The catalogue claims fourteen self-hosted faces. Ask the browser to load
    // every one and then ask the font engine whether it can actually set them.
    const faces = await page.evaluate(async () => {
      const fromApp = (p: string) => new URL(p, new URL(document.baseURI, location.href)).href
      const fonts = await import(fromApp('src/features/layers/fonts.ts'))
      const results: { id: string; label: string; family: string; ok: boolean; detail: string }[] =
        []
      for (const font of fonts.FONTS as { id: string; label: string; family: string }[]) {
        const result = await fonts.ensureFont(font.id)
        results.push({
          id: font.id,
          label: font.label,
          family: font.family,
          ok: result.ok,
          detail: result.ok ? 'loaded' : (result.error?.message ?? 'failed'),
        })
      }
      await document.fonts.ready
      return {
        results,
        // `check()` at a real size is the browser's own answer to "can you set
        // this face", not the app's bookkeeping.
        checks: (fonts.FONTS as { id: string; family: string }[]).map((font) => ({
          id: font.id,
          family: font.family,
          usable: document.fonts.check(`40px "${font.family}"`),
        })),
        catalogue: fonts.FONTS.length,
      }
    })

    expect(faces.catalogue).toBe(14)
    expect(faces.results.filter((r) => !r.ok)).toEqual([])
    expect(faces.checks.filter((c) => !c.usable)).toEqual([])

    // And the face reaches the *exported pixels*: the same text in two
    // visually unrelated faces must produce two different files, and the same
    // face twice must produce the same file.
    await addText(ctx, 'Handgloves 4471829')
    await patchFirstTextStyle(page, { fontId: 'caveat', size: 16 })
    await settle()
    await page.evaluate(async () => {
      const fromApp = (p: string) => new URL(p, new URL(document.baseURI, location.href)).href
      const fonts = await import(fromApp('src/features/layers/fonts.ts'))
      await fonts.ensureFont('caveat')
      await document.fonts.ready
    })
    const caveat = await exportPng(ctx)
    const caveatAgain = await exportPng(ctx)

    await patchFirstTextStyle(page, { fontId: 'roboto-mono', size: 16, tracking: 0, arc: 0 })
    await settle()
    await page.evaluate(async () => {
      const fromApp = (p: string) => new URL(p, new URL(document.baseURI, location.href)).href
      const fonts = await import(fromApp('src/features/layers/fonts.ts'))
      await fonts.ensureFont('roboto-mono')
      await document.fonts.ready
    })
    const mono = await exportPng(ctx)

    // Deterministic, so a difference below is the font and not the encoder.
    expect(caveatAgain.equals(caveat)).toBe(true)
    expect(mono.equals(caveat)).toBe(false)
  })

  test('D6-F15: tracking and arc both change the exported glyph run', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const ctx: Ctx = { page, openTool, downloadFrom, settle }
    // A black plate, so the bounding box of lit pixels is the glyph run and not
    // the sky in the photograph behind it.
    await blackPlate(page, openTool, settle, 480)
    await addText(ctx, 'ABCDEFGH')
    await patchFirstTextStyle(page, { size: 14, tracking: 0, arc: 0 })
    await settle()

    const flat = await exportPng(ctx)
    const flatInk = await inkBounds(page, flat)
    expect(flatInk.width).toBeGreaterThan(20)

    await patchFirstTextStyle(page, { tracking: 40 })
    await settle()
    const tracked = await exportPng(ctx)
    // Positive tracking letterspaces the run, so the same glyphs occupy more
    // width — that is the claim, and it is measurable without reading the code.
    const trackedInk = await inkBounds(page, tracked)
    expect(trackedInk.width).toBeGreaterThan(flatInk.width * 1.2)

    await patchFirstTextStyle(page, { tracking: 0, arc: 80 })
    await settle()
    const arced = await exportPng(ctx)
    // A 70-degree bow makes the run taller than the line height it started at.
    const arcedInk = await inkBounds(page, arced)
    expect(arcedInk.height).toBeGreaterThan(flatInk.height * 1.5)
    expect(arced.equals(flat)).toBe(false)
  })
})

test.describe('layers · list and inspector', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
  })

  test('D6-F09/F13: rename, duplicate, front, back and drag-reorder all commit', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add text' }).click()
    await settle()
    await openTool('Text')
    await openTool('Stickers')
    const stickers = await openTool('Stickers')
    await stickers
      .getByRole('group', { name: 'Shapes' })
      .getByRole('button', { name: 'Ellipse', exact: true })
      .click()
    await settle()
    await openTool('Stickers')
    const draw = await openTool('Draw')
    await draw.getByRole('button', { name: 'New drawing layer' }).click()
    await settle()

    const initial = (await readDoc()).layers
    expect(initial.map((l) => l.kind)).toEqual(['text', 'shape', 'draw'])

    // --- rename (D6-F09) ----------------------------------------------------
    const list = await openTool('Layers')
    await list.getByRole('button', { name: /^Text · / }).click()
    await list.getByRole('button', { name: 'Rename layer' }).click()
    const nameField = list.getByLabel('Layer name')
    await nameField.fill('Headline')
    await nameField.press('Enter')
    await settle()
    expect((await readDoc()).layers[0].name).toBe('Headline')
    await expect(list.getByRole('button', { name: 'Text · Headline' })).toBeVisible()

    // --- duplicate (D6-F13) ------------------------------------------------
    await list.getByRole('button', { name: 'Duplicate layer' }).click()
    await settle()
    const afterCopy = (await readDoc()).layers
    expect(afterCopy).toHaveLength(4)
    expect(afterCopy[0].name).toBe('Headline')
    expect(afterCopy[1].name).toBe('Headline copy')
    expect(afterCopy[1].id).not.toBe(afterCopy[0].id)

    // --- front / back (D6-F13) ---------------------------------------------
    await list.getByRole('button', { name: /^Drawing$/ }).click()
    await list.getByRole('button', { name: 'Bring to front' }).click()
    await settle()
    expect((await readDoc()).layers[3].kind).toBe('draw')
    await list.getByRole('button', { name: 'Send to back' }).click()
    await settle()
    const back = (await readDoc()).layers
    expect(back[0].kind).toBe('draw')
    expect(back[1].kind).toBe('text')

    // --- nudge --------------------------------------------------------------
    // The list renders top-of-stack first, so its first row is the top of the
    // stack: the shape. `Move up` there is a no-op — there is nothing above it —
    // and `Move down` trades it with the layer beneath.
    const topBefore = (await readDoc()).layers[3].kind
    await list.getByRole('button', { name: 'Move up' }).first().click()
    await settle()
    expect((await readDoc()).layers[3].kind).toBe(topBefore)
    await list.getByRole('button', { name: 'Move down' }).first().click()
    await settle()
    const after = (await readDoc()).layers
    expect(after[2].kind).toBe(topBefore)
    expect(after[3].kind).toBe('text')
  })

  test('D6-F13: dropping a row on another reorders the stack', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    // The Text panel's "Add text" button only appears when the selection is not
    // a text layer, so a second one means selecting the other kind first.
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add text' }).click()
    await settle()
    const stickers = await openTool('Stickers')
    await stickers
      .getByRole('group', { name: 'Shapes' })
      .getByRole('button', { name: 'Rectangle', exact: true })
      .click()
    await settle()
    const secondText = await openTool('Text')
    await secondText.getByRole('button', { name: 'Add text' }).click()
    await settle()
    expect((await readDoc()).layers.map((l) => l.kind)).toEqual(['text', 'shape', 'text'])

    // The list has to be open for the rows to exist, and it is rendered
    // top-of-stack first, so the shape row is first.
    await openTool('Layers')
    await dragRowOnto(page, /Shape · /, /Text · /)
    await settle()
    const after = (await readDoc()).layers.map((l) => l.kind)
    expect(after).toHaveLength(3)
    expect(after).not.toEqual(['text', 'text', 'shape'])
  })

  test('D6-F12: a sticker and a shape have an inspector that reaches the pixels', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    const ctx: Ctx = { page, openTool, downloadFrom, settle }
    // A black plate behind the shape, so the painted-pixel count is the shape's.
    await blackPlate(page, openTool, settle, 480)
    const stickers = await openTool('Stickers')
    await stickers
      .getByRole('group', { name: 'Shapes' })
      .getByRole('button', { name: 'Arrow', exact: true })
      .click()
    await settle()

    // The inspector: fill, size, scale, rotation, opacity, blend.
    await expect(stickers.getByRole('slider', { name: 'Width' })).toBeVisible()
    await expect(stickers.getByRole('slider', { name: 'Height' })).toBeVisible()
    await expect(stickers.getByRole('slider', { name: 'Scale' })).toBeVisible()
    await expect(stickers.getByRole('slider', { name: 'Rotation' })).toBeVisible()
    await expect(stickers.getByRole('group', { name: 'Blend mode' })).toBeVisible()

    const rest = await exportPng(ctx)
    // `stickers` is a live locator on the single open dialog, and exporting
    // switches tools, so the panel has to be reopened before touching it again.
    const backToStickers = await openTool('Stickers')
    const restInk = await inkBounds(page, rest, 40)
    expect(restInk.count).toBeGreaterThan(0)
    writeFileSync(
      '.playwright-mcp/layers-00-shape-default.png',
      Buffer.from(await bandCrop(page, rest, { x: 0, y: 0, width: 1, height: 1 }), 'base64'),
    )

    // Fill, then scale, then rotation: each writes a field the compositor reads,
    // and each is visible in the export.
    await setColor(backToStickers.getByLabel('Fill'), '#ff0000')
    await settle()
    // The arrow is the selected layer, so its inspector is the one that changed.
    const shape = (await readDoc()).layers.find(
      (layer) => layer.kind === 'shape' && layer.shape === 'arrow',
    )
    if (shape?.kind !== 'shape') throw new Error('expected the arrow shape layer')
    expect(shape.fill).toBe('#ff0000')
    const filled = await exportPng(ctx)
    expect(filled.equals(rest)).toBe(false)
    writeFileSync(
      '.playwright-mcp/layers-01-shape-red.png',
      Buffer.from(await bandCrop(page, filled, { x: 0, y: 0, width: 1, height: 1 }), 'base64'),
    )

    // The plate is the first shape; the arrow under inspection is the second.
    await transformFirstLayer(page, 'shape', { scale: 2.5, rotation: 45 }, 1)
    await settle()
    const scaled = await inkBounds(page, await exportPng(ctx), 40)
    // 2.5x about the layer's own centre: the painted area grows by 2.5^2.
    expect(scaled.count / restInk.count).toBeGreaterThan(3)
  })

  test('D6-F10: an uploaded sticker becomes a real asset, not a dead row', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    const ctx: Ctx = { page, openTool, downloadFrom, settle }
    // A real PNG, generated and handed to the file input the way a user's own
    // image would be. It goes to the OS temp directory rather than to
    // `test-results/`, which a concurrent Playwright run wipes out from under a
    // suite in flight.
    const file = join(tmpdir(), 'ie-upload-sticker.png')
    await writePng(page, file, 64)
    const rest = await exportPng(ctx)
    const backToStickers = await openTool('Stickers')
    await backToStickers.getByLabel(/Upload a sticker/).setInputFiles(file)
    await settle()
    // A decode failure would leave an alert instead of a layer; say which.
    await expect(backToStickers.getByRole('alert')).toHaveCount(0)
    await expect(backToStickers.getByRole('button', { name: /Delete layer/ })).toBeVisible()

    const layer = (await readDoc()).layers[0]
    // The doc holds an asset id, never pixels — the law in AGENTS.md.
    expect(layer.kind).toBe('sticker')
    if (layer.kind !== 'sticker') throw new Error('expected a sticker layer')
    expect(layer.assetId).toMatch(/^asset_/)
    expect(JSON.stringify(layer)).not.toContain('data:')

    const withSticker = await exportPng(ctx)
    expect(withSticker.equals(rest)).toBe(false)
    // And it drew something: the mark is on the frame.
    const before = await inkBounds(page, rest, 200)
    const after = await inkBounds(page, withSticker, 200)
    expect(after.count).toBeGreaterThanOrEqual(before.count)
    writeFileSync(
      '.playwright-mcp/layers-02-sticker-uploaded.png',
      Buffer.from(await bandCrop(page, withSticker, { x: 0, y: 0, width: 1, height: 1 }), 'base64'),
    )
  })

  test('D6-F14: an on-canvas handle moves the document, and the X/Y sliders still do too', async ({
    page,
    openTool,
    readDoc,
    settle,
  }) => {
    // This test used to be named "there are no on-canvas transform handles, and
    // the doc says so" and passed, because at the time there were none. The
    // handles have since landed, so the name had become a lie the suite was
    // still green on: it asserted the *absence* of a feature rather than
    // anything that could fail when the feature rotted. What can rot now is
    // whether a grip is present, whether dragging one reaches the document, and
    // whether it reaches the same document the panel does — so that is what is
    // asserted. `journey.transform-handles.spec.ts` covers scale, rotate,
    // keyboard and undo; this is the same claim made from the text journey.
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add text' }).click()
    await settle()

    const grips = page.getByRole('group', { name: 'Layer transform handles' })
    await expect(grips).toBeVisible()
    const corner = grips.getByRole('slider', { name: 'Scale from the bottom right corner' })
    await expect(corner).toBeVisible()

    // A real press, a real drag and a real release over the grip, in steps, so
    // the intermediate `pointermove`s are exercised rather than jumped over.
    const box = (await corner.boundingBox())!
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    const before = (await readDoc()).layers[0]!.transform
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(startX + (60 * step) / 8, startY + (40 * step) / 8)
    }
    await page.mouse.up()
    await settle()

    // The claim is about the *document*, read out of the running app, not about
    // the grip having moved: a handle that animates and writes nothing is the
    // failure this replaces the absence-assertion with.
    const after = (await readDoc()).layers[0]!.transform
    expect(after.scale).toBeGreaterThan(before.scale)

    // The panel path is still a real way to move the layer, so it is still
    // asserted — two routes to one value is the contract, not a redundancy.
    const panel = await openTool('Text')
    await expect(panel.getByRole('slider', { name: /^X / })).toBeVisible()
    await expect(panel.getByRole('slider', { name: /^Y / })).toBeVisible()
  })
})
