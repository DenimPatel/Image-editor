import { test, expect, readImageHeader } from './fixtures'
import { bandCrop, pearson, signatureOf, type Rect } from './pixels'
import { transformFirstLayer } from './store'
import { writeFileSync } from 'node:fs'
import type { Locator } from '@playwright/test'

/** Save the band a test just measured, so the report has something to look at. */
function saveBand(name: string, base64: string): void {
  writeFileSync(`.playwright-mcp/${name}.png`, Buffer.from(base64, 'base64'))
}

/**
 * D6-F05 / D6-F06 — redaction privacy, measured on the exported bytes.
 *
 * The defect this file exists for: a "blur" redaction used to read its source
 * rect from `(w, h)` on a `w x h` canvas, so the intersection was empty, nothing
 * was drawn, and the export shipped the unredacted pixels. Every assertion here
 * therefore decodes the *downloaded PNG* and asks what is in the pixels.
 *
 * The scene is a black plate with white text on it, so every pixel in the
 * redacted band is either near-black or near-white and any surviving ink is
 * unambiguous. Each mode is measured twice — once with no redaction (the control,
 * which proves the secret really is inside the band, so a later zero cannot be
 * explained by an empty region) and once with the redaction applied.
 */

const SECRET = 'SECRET 4471829'

/** The default redaction band: x 0.3..0.7, y 0.35..0.65. */
const BAND: Rect = { x: 0.3, y: 0.35, width: 0.4, height: 0.3 }

type Ctx = {
  openTool: (name: 'Export') => Promise<Locator>
  downloadFrom: (action: Locator) => Promise<{ bytes: Buffer }>
}

async function downloadPng({ openTool, downloadFrom }: Ctx): Promise<Buffer> {
  const exportPanel = await openTool('Export')
  const png = exportPanel.getByRole('button', { name: 'PNG', exact: true })
  if ((await png.getAttribute('aria-pressed')) !== 'true') await png.click()
  const { bytes } = await downloadFrom(
    exportPanel.getByRole('button', { name: 'Download', exact: true }),
  )
  expect(readImageHeader(bytes).format).toBe('png')
  return bytes
}

async function setRedactionMode(
  openTool: (name: 'Redact') => Promise<Locator>,
  mode: 'Pixelate' | 'Blur' | 'Solid' | 'Emoji',
  strength?: string,
): Promise<void> {
  const redact = await openTool('Redact')
  await redact.getByRole('button', { name: 'Add redaction' }).click()
  await redact
    .getByRole('group', { name: 'Redaction mode' })
    .getByRole('button', { name: mode })
    .click()
  if (strength) {
    const amount = redact.getByRole('slider', { name: 'Amount' })
    await amount.fill(strength)
    // The panel said "Strength" for a second unrelated number, and the word is
    // spent: the Looks panel says "Amount" for its own.
    await expect(redact.getByRole('slider', { name: 'Strength' })).toHaveCount(0)
  }
}

test.describe('redaction privacy', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle, openTool }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()

    // 1. A black plate covering the frame, so the only content is what we add.
    const stickers = await openTool('Stickers')
    await stickers
      .getByRole('group', { name: 'Shapes' })
      .getByRole('button', { name: 'Rectangle', exact: true })
      .click()
    await settle()
    for (const [label, value] of [
      ['Width', '100'],
      ['Height', '100'],
    ] as const) {
      await stickers.getByRole('slider', { name: label }).fill(value)
    }
    await stickers.getByLabel('Fill').fill('#000000')
    await settle()

    // 2. White text on top of the plate, sized to fill the band.
    const text = await openTool('Text')
    await text.getByRole('button', { name: 'Add text' }).click()
    await settle()
    await text.getByLabel('Text content').fill(SECRET)
    await text.getByRole('slider', { name: 'Size' }).fill('14')
    await text.getByLabel('Colour').fill('#ffffff')
    await settle()
    await page.screenshot({ path: '.playwright-mcp/redact-00-before.png' })
  })

  test('the control band really does contain the secret', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const control = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
    expect(control.inkFraction).toBeGreaterThan(0.05)
    expect(control.edgeFraction).toBeGreaterThan(0.003)
    expect(control.distinctLevels).toBeGreaterThan(4)
    await settle()
  })

  test('a blur redaction removes the hidden ink from the exported PNG', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const before = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
    await setRedactionMode(openTool, 'Blur', '100')
    await settle()
    const after = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)

    // The glyph edges that encoded the secret are gone...
    expect(after.edgeFraction).toBeLessThan(before.edgeFraction * 0.4)
    expect(after.distinctLevels).toBeLessThan(before.distinctLevels)
    // ...and what the file now holds in that band is not the secret.
    expect(pearson(before.grid, after.grid)).toBeLessThan(0.9)
  })

  test('a pixelate redaction destroys the glyph structure', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const before = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
    await setRedactionMode(openTool, 'Pixelate', '100')
    await settle()
    const after = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)

    // 26 px blocks at full strength: the antialiased gradient of the glyphs is
    // quantised away, and the block mosaic is not the lettering.
    expect(after.distinctLevels).toBeLessThan(before.distinctLevels)
    expect(pearson(before.grid, after.grid)).toBeLessThan(0.95)
  })

  test('a solid redaction is an opaque black cover', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const before = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
    expect(before.inkFraction).toBeGreaterThan(0.05)
    await setRedactionMode(openTool, 'Solid')
    await settle()
    const after = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)

    expect(after.inkFraction).toBe(0)
    expect(after.edgeFraction).toBeLessThan(0.001)
    expect(after.meanLuma).toBeLessThan(2)
    expect(pearson(before.grid, after.grid)).toBeLessThan(0.5)
  })

  test('an emoji redaction does not leave the hidden ink under the tiles', async ({
    page,
    openTool,
    downloadFrom,
    settle,
  }) => {
    const before = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
    expect(before.inkFraction).toBeGreaterThan(0.05)
    const beforeBytes = await downloadPng({ openTool, downloadFrom })
    saveBand('redact-02-emoji-band-before', await bandCrop(page, beforeBytes, BAND))
    await setRedactionMode(openTool, 'Emoji')
    await settle()
    await page.screenshot({ path: '.playwright-mcp/redact-01-emoji-after.png' })
    const afterBytes = await downloadPng({ openTool, downloadFrom })
    saveBand('redact-03-emoji-band-after', await bandCrop(page, afterBytes, BAND))
    const after = await signatureOf(page, afterBytes, BAND)

    // The tiles are opaque, so an eyeball says "covered". The panel promises
    // more — "the original is not recoverable" — and that only holds if the
    // pixels under the tiles are gone too. Before the fix the lettering was
    // still legible straight through the gaps between the tiles.
    expect(pearson(before.grid, after.grid)).toBeLessThan(0.9)
  })

  for (const mode of ['Solid', 'Emoji'] as const) {
    test(`a ${mode.toLowerCase()} redaction leaves the export independent of the secret`, async ({
      page,
      openTool,
      readDoc,
      downloadFrom,
      settle,
    }) => {
      // The strongest form of the claim, and the one that needs no threshold:
      // export the same image twice, with two *different* secrets, under an
      // opaque redaction. If the file carried any trace of what it was hiding,
      // the two bands would differ. They are compared byte for byte.
      //
      // Both strings are three glyphs so they fit inside the band with room to
      // spare — a secret that overflowed the band would also be visible outside
      // it, and that is the redaction working, not leaking.
      await setRedactionMode(openTool, mode)
      await settle()

      const retype = async (secret: string) => {
        // Adding the redaction moved the selection off the text layer, so the
        // list is how a user gets back to it.
        const list = await openTool('Layers')
        await list.getByRole('button', { name: /^Text · / }).click()
        const text = await openTool('Text')
        await text.getByLabel('Text content').fill(secret)
        await settle()
        return signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
      }

      const first = await retype('AAA')
      const second = await retype('BBB')
      expect((await readDoc()).layers.some((l) => l.kind === 'redact')).toBe(true)
      expect(second.digest).toBe(first.digest)
    })
  }

  test('a redaction offers no way to become translucent', async ({ openTool, readDoc, settle }) => {
    const redact = await openTool('Redact')
    await redact.getByRole('button', { name: 'Add redaction' }).click()
    await settle()

    // The honest editor has no control that would make a redaction see-through.
    await expect(redact.getByRole('slider', { name: /^Opacity/ })).toHaveCount(0)
    await expect(redact.getByRole('group', { name: 'Blend mode' })).toHaveCount(0)
    const layer = (await readDoc()).layers.find((candidate) => candidate.kind === 'redact')
    expect(layer).toBeDefined()
  })

  test('a doc carrying a translucent redaction still exports an opaque one', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    // A session saved by an older build, a pasted document, or a script can
    // still say `opacity: 0.4, blend: 'screen'`. The compositor has to ignore
    // it, or the hidden pixels ship.
    await setRedactionMode(openTool, 'Solid')
    await settle()
    await transformFirstLayer(page, 'redact', { opacity: 0.2, blend: 'screen' })
    const weakened = (await readDoc()).layers.find((candidate) => candidate.kind === 'redact')
    expect(weakened?.transform.opacity).toBeCloseTo(0.2, 5)

    const after = await signatureOf(page, await downloadPng({ openTool, downloadFrom }), BAND)
    expect(after.inkFraction).toBe(0)
    expect(after.meanLuma).toBeLessThan(2)
  })

  test('a region pushed to the canvas edge still stays on the canvas (D6-F06)', async ({
    openTool,
    readDoc,
    settle,
  }) => {
    const redact = await openTool('Redact')
    await redact.getByRole('button', { name: 'Add redaction' }).click()
    await settle()

    // x = 90% with width = 100% is the combination that used to run off the
    // canvas with no recovery.
    await redact.getByRole('slider', { name: 'X' }).fill('90')
    await redact.getByRole('slider', { name: 'Width' }).fill('100')
    await settle()

    const layer = (await readDoc()).layers.find((candidate) => candidate.kind === 'redact')
    if (layer?.kind !== 'redact') throw new Error('expected a redaction layer')
    expect(layer.region.x).toBeGreaterThanOrEqual(0)
    expect(layer.region.y).toBeGreaterThanOrEqual(0)
    expect(layer.region.x + layer.region.width).toBeLessThanOrEqual(1 + 1e-9)
    expect(layer.region.y + layer.region.height).toBeLessThanOrEqual(1 + 1e-9)
  })
})
