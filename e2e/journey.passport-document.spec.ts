import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { planSheet } from '../src/features/passport/sheet'
import { getSpec } from '../src/features/passport/specs'

/**
 * The passport panel, read by a person who does not know the rules.
 *
 * The panel used to offer eleven chips named after the catalogue's own ids and
 * labels — `us-2x2`, "UK Passport 35×45 mm" — with the millimetres only in the
 * id, no picture of the sheet that would be printed, no unit on the size fields,
 * and a checklist that printed a verdict without the two numbers behind it. Each
 * test below is one of those claims, and every locator is an accessible name or
 * a role: a document name a user can find by reading is the thing under test, so
 * reaching for a CSS-module class would test the rename instead.
 */

const spec = (id: string) => {
  const found = getSpec(id)
  if (!found) throw new Error(`no spec ${id}`)
  return found
}

/** The panel, with its document section scrolled into view. */
async function panel(page: Page) {
  return page.getByRole('dialog', { name: 'Passport' })
}

/** The sheet figure, addressed by what it is rather than by a class name. */
function sheetFigure(page: Page) {
  return page.locator('[data-figure="sheet"]')
}

/**
 * Get past the first-run orientation if it is there.
 *
 * A first-run panel is modal and swallows pointer events, so a journey that
 * does not answer it is testing the scrim rather than the tool. Located by its
 * own accessible name and gone within a moment, so a build without it costs
 * nothing.
 */
async function dismissFirstRunPanel(page: Page): Promise<void> {
  const gotIt = page.getByRole('button', { name: 'Got it', exact: true })
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click()
    await expect(gotIt).toHaveCount(0)
  }
}

test.describe('the passport panel speaks in documents', () => {
  test.beforeEach(async ({ goto, clearStorage, loadSample, settle, openTool, page }) => {
    await goto('/editor')
    await clearStorage()
    await dismissFirstRunPanel(page)
    await loadSample('Sample 1')
    await settle()
    await openTool('Passport')
  })

  test('a chip is named after the document, and sets that document’s size', async ({
    page,
    readDoc,
  }) => {
    const sheet = await panel(page)
    // The name a user reads is the control they press. On the old panel this was
    // "UK Passport 35×45 mm" off a row labelled "Passport spec".
    const chip = sheet.getByRole('button', { name: 'UK passport 35 × 45 mm', exact: true })
    await expect(chip).toBeVisible()
    await chip.click()

    const doc = await readDoc()
    expect(doc.passport?.specId).toBe('uk-35x45')
    expect(doc.output.resize).toEqual({
      mode: 'physical',
      widthMm: 35,
      heightMm: 45,
      dpi: 300,
    })
  })

  test('the two specs that are not countries are not offered as passports', async ({ page }) => {
    const sheet = await panel(page)
    const passports = sheet.getByRole('group', { name: 'Passport photos' })

    // `generic-35x45` is `country: 'Any'` and `schengen-35x45` is
    // `'Schengen Area'`, so a row headed "Passport photos" containing either of
    // them would be telling a user to get a passport photo they do not need.
    await expect(passports.getByRole('button')).toHaveCount(7)
    await expect(passports.getByRole('button', { name: /Generic/ })).toHaveCount(0)
    await expect(passports.getByRole('button', { name: /Schengen/ })).toHaveCount(0)
    await expect(
      sheet.getByRole('group', { name: 'Other ID photos' }).getByRole('button', {
        name: 'Generic ID photo 35 × 45 mm',
        exact: true,
      }),
    ).toBeVisible()
  })

  test('the millimetre fields carry their unit and refuse a size that is not one', async ({
    page,
    readDoc,
  }) => {
    const sheet = await panel(page)
    await sheet.getByRole('button', { name: 'UK passport 35 × 45 mm', exact: true }).click()

    const width = sheet.getByRole('textbox', { name: 'Width in millimetres' })
    const height = sheet.getByRole('textbox', { name: 'Height in millimetres' })
    // The fields show what will print, and the unit is on them.
    await expect(width).toHaveValue('35')
    await expect(height).toHaveValue('45')
    await expect(sheet.getByText('mm', { exact: true }).first()).toBeVisible()

    // `0:45` is not a size, and the panel says so instead of going quiet.
    await width.fill('0')
    await expect(sheet.getByRole('alert')).toContainText(
      'Width and height each need a number of millimetres above zero',
    )
    await expect(width).toHaveAttribute('aria-invalid', 'true')
    expect((await readDoc()).output.resize).toMatchObject({ widthMm: 35, heightMm: 45 })

    // A real size applies as one edit, and the fields then show the truth.
    await width.fill('40')
    await height.fill('50')
    await height.press('Enter')
    await expect(width).toHaveValue('40')
    const doc = await readDoc()
    expect(doc.output.resize).toMatchObject({ widthMm: 40, heightMm: 50 })
    expect(doc.geometry.aspectLock).toBeCloseTo(0.8, 6)
  })

  test('a failing check prints the measurement and the requirement', async ({ page }) => {
    const sheet = await panel(page)
    await sheet.getByRole('button', { name: 'UK passport 35 × 45 mm', exact: true }).click()

    // Sample 1's head is about 22 mm in a 45 mm frame, so the head-height rule
    // fails. What the reader needs is the two numbers the rule compared: what the
    // photo measures, and the range the document asks for.
    const head = sheet.getByText('Head height', { exact: true })
    await expect(head).toBeVisible()
    await expect(sheet.getByText('Required 29–34 mm', { exact: true })).toBeVisible()
    await expect(sheet).toHaveText(/Head height[^]*?Measured \d+\.\d mm[^]*?Required 29–34 mm/)
    // And the verdict says how many need attention, in words, once.
    await expect(sheet).toHaveText(/\d+ of 8 checks fail/)
  })

  test('the sheet is drawn from the plan, and the copies stop at its capacity', async ({
    page,
  }) => {
    const sheet = await panel(page)
    await sheet.getByRole('button', { name: 'US passport 50.8 × 50.8 mm', exact: true }).click()

    // 4×6 in holds two 50.8 mm squares, and the figure is those two rectangles at
    // `planSheet`'s own positions on a viewBox of the sheet's own size.
    const planned = planSheet(spec('us-2x2'), '4x6', 2, 300, false)
    await expect(sheetFigure(page)).toHaveAttribute(
      'viewBox',
      `0 0 ${planned.sheetWidthPx} ${planned.sheetHeightPx}`,
    )
    // One rect for the paper, one per photo.
    await expect(sheetFigure(page).locator('rect')).toHaveCount(1 + planned.photos.length)
    await expect(sheet).toHaveText(/4 × 6 in sheet · 101\.6 × 152\.4 mm · 1 across × 2 down/)

    // Thirty clicks cannot put more on the sheet than the sheet holds.
    const increase = sheet.getByRole('button', { name: 'Increase Copies' })
    for (let i = 0; i < 30; i += 1) await increase.click()
    await expect(sheet).toHaveText(/Printing all 2\./)
    await expect(sheetFigure(page).locator('rect')).toHaveCount(1 + planned.photos.length)
  })

  test('turning the frame says what it turned', async ({ page, readDoc }) => {
    const sheet = await panel(page)
    await sheet.getByRole('button', { name: 'UK passport 35 × 45 mm', exact: true }).click()
    await expect(sheet).toHaveText(
      /Prints 35 × 45 mm\. Landscape turns the same photo on its side\./,
    )

    await sheet.getByRole('button', { name: 'Landscape', exact: true }).click()
    await expect(sheet).toHaveText(/Prints 45 × 35 mm\. Portrait turns it back upright\./)
    expect((await readDoc()).output.resize).toMatchObject({ widthMm: 45, heightMm: 35 })
  })

  test('nothing in the panel claims a model it does not load', async ({ page }) => {
    const sheet = await panel(page)
    const text = await sheet.innerText()

    expect(text).toContain('downloads no model')
    expect(text).not.toMatch(/landmark|neural|\bAI\b|face detect/i)
  })
})
