import type { Page } from '@playwright/test'
import { test, expect, readImageHeader } from './fixtures'

/**
 * D9-F01 — crop.
 *
 * Two independent claims are checked, because either alone is satisfiable by a
 * broken editor: the *readout* must move when the corner moves, and the
 * *exported bytes* must be the size the readout promised. A readout that lies,
 * and a crop that only relabels itself, each fail one of the two.
 */

/** The overlay's dimension line, e.g. `1271 × 1920 px · 2:3`. */
const READOUT = /^\d+ × \d+ px/

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
