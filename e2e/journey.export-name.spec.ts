import { readImageHeader, test, expect } from './fixtures'
import { setOutput } from './store'
import { waitForEstimate } from './scene'
import { effectiveOutputSize } from '../src/model/selectors'
/**
 * D7-F17 — filename templating, judged on the file that lands.
 *
 * The templating has its own unit tests; what is only visible here is the
 * wiring. Every assertion reads `download.suggestedFilename()`, so it describes
 * the name the browser will write to disk rather than a label on the panel, and
 * the doc is read back afterwards to prove the template is a panel preference
 * and not an edit that followed the image into the autosave.
 */

test.describe('export filename template', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
    // 480 px keeps the three renders the zip does fast enough to be worth
    // asserting on; nothing about the name depends on the size.
    await setOutput(page, { resize: { mode: 'width', width: 480 } })
    await settle()
  })

  test('downloads under the name the template builds, and keeps the template out of the document', async ({
    openTool,
    readDoc,
    downloadFrom,
  }) => {
    const size = effectiveOutputSize(await readDoc())
    const panel = await openTool('Export')
    const field = panel.getByLabel('File name template')
    await expect(field).toBeVisible()

    await field.fill('{name}-{width}x{height}-{format}')
    // The panel says what it is about to call the file, before anything is
    // rendered at full size.
    await expect(panel.locator('p', { hasText: 'Download as' })).toContainText(
      `Sample 1-${size.width}x${size.height}-jpg.jpg`,
    )
    await waitForEstimate(panel)

    const { bytes, name } = await downloadFrom(
      panel.getByRole('button', { name: 'Download', exact: true }),
    )
    expect(name).toBe(`Sample 1-${size.width}x${size.height}-jpg.jpg`)
    // The bytes are still a real image behind the templated name.
    expect(readImageHeader(bytes).format).toBe('jpeg')

    // A file name is not an edit: the document never saw the template.
    expect(JSON.stringify(await readDoc())).not.toContain('{name}')
    await expect(panel.locator('input[aria-label="File name template"]')).toHaveValue(
      '{name}-{width}x{height}-{format}',
    )
  })

  test('drops a token the file cannot fill instead of printing it', async ({
    openTool,
    downloadFrom,
  }) => {
    const panel = await openTool('Export')
    // A PDF carries its density in the page geometry, so `{dpi}` has nothing to
    // say; the separator it leaves behind has to go with it.
    await panel.getByLabel('File name template').fill('{name}-{dpi}-{format}')
    await panel.getByRole('button', { name: 'PDF', exact: true }).click()
    await waitForEstimate(panel)

    const { name } = await downloadFrom(
      panel.getByRole('button', { name: 'Download', exact: true }),
    )
    expect(name).toBe('Sample 1-pdf.pdf')
  })

  test('names the multi-size zip from the same template', async ({ openTool, downloadFrom }) => {
    const panel = await openTool('Export')
    await panel.getByLabel('File name template').fill('{name}-sizes-{date}')
    // The preview counts the widths the zip will actually hold.
    await expect(panel.locator('p', { hasText: 'Download as' })).toContainText('Sample 1-sizes-')
    await waitForEstimate(panel)

    const { bytes, name } = await downloadFrom(
      panel.getByRole('button', { name: 'Multi-size zip', exact: true }),
    )
    expect(name).toMatch(/^Sample 1-sizes-\d{4}-\d{2}-\d{2}\.zip$/)
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
  })
})
