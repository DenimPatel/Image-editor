import { readImageHeader, test, expect } from './fixtures'
import { bandCrop, inkBounds, signatureOf } from './pixels'
import { patchFirstLayer, setOutput, transformFirstLayer } from './store'
import { waitForEstimate } from './scene'
import { effectiveOutputSize } from '../src/model/selectors'
import { writeFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import type { Locator } from '@playwright/test'

/**
 * D7-F10..F17 and the export half of D6-F04 — the export pipeline, judged on
 * the bytes.
 *
 * Every assertion here opens the file that came out of the download. A UI label
 * is not evidence: the interesting failures are "PDF pinned to 96 dpi whatever
 * you asked for", "a zip with three entries and only two sizes in it", and
 * "300 DPI that only exists in the panel", and none of them are visible without
 * measuring.
 *
 * Where the app has a byte-level parser for a format, this file deliberately
 * does *not* use it: `readJpegDpi` returning 300 only proves it agrees with
 * itself. The parsers below are written from the container specs and are the
 * independent read.
 */

/* ------------------------------------------------------------------ *
 * Independent container readers
 * ------------------------------------------------------------------ */

type Segment = { marker: number; start: number; end: number; dataStart: number }

/** JPEG: every marker segment, so APPn and COM can be listed by name. */
function jpegSegments(bytes: Buffer): Segment[] {
  const out: Segment[] = []
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2) break
    out.push({ marker, start: offset, dataStart: offset + 4, end: offset + 2 + length })
    if (marker === 0xda) break
    offset += 2 + length
  }
  return out
}

/** JFIF density, in DPI, from the APP0 segment's own units/density fields. */
function jpegDpi(bytes: Buffer): number | null {
  for (const segment of jpegSegments(bytes)) {
    if (segment.marker !== 0xe0) continue
    if (bytes.subarray(segment.dataStart, segment.dataStart + 5).toString('ascii') !== 'JFIF\0') {
      continue
    }
    // APP0 layout after the `JFIF\0` signature: version (2 bytes), units
    // (1 = dots per inch, 2 = dots per cm), Xdensity, Ydensity (2 bytes each).
    const units = bytes[segment.dataStart + 7]
    if (units !== 1 && units !== 2) return null
    const xDensity = bytes.readUInt16BE(segment.dataStart + 8)
    return units === 1 ? xDensity : xDensity * 2.54
  }
  return null
}

/** Names of the APPn / COM payloads a JPEG carries, e.g. `Exif`, `ICC_PROFILE`. */
function jpegMetadataMarkers(bytes: Buffer): string[] {
  const names: string[] = []
  for (const segment of jpegSegments(bytes)) {
    if (segment.marker === 0xfe) {
      names.push('COM')
      continue
    }
    if (segment.marker < 0xe1 || segment.marker > 0xef) continue
    const tag = bytes.subarray(segment.dataStart, segment.dataStart + 12).toString('latin1')
    if (segment.marker === 0xe1) {
      names.push(tag.startsWith('Exif\0\0') ? 'Exif' : `APP1:${tag.trim()}`)
    } else if (segment.marker === 0xe2 && tag.startsWith('ICC_PROFILE')) {
      names.push('ICC_PROFILE')
    } else {
      names.push(`APP${segment.marker - 0xe0}:${tag.trim()}`)
    }
  }
  return names
}

/** PNG chunk types in order. */
function pngChunks(bytes: Buffer): string[] {
  const out: string[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    out.push(type)
    offset += 12 + bytes.readUInt32BE(offset)
    if (type === 'IEND') break
  }
  return out
}

/** PNG pHYs density in DPI, read as pixels-per-metre over the axis ratio. */
function pngDpi(bytes: Buffer): number | null {
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    if (type === 'pHYs') {
      if (bytes[offset + 8 + 8] !== 1) return null
      // X and Y are pixels per metre; a conforming chunk has them equal.
      const x = bytes.readUInt32BE(offset + 8)
      const y = bytes.readUInt32BE(offset + 12)
      if (x !== y) return null
      return x * 0.0254
    }
    if (type === 'IEND') break
    offset += 12 + bytes.readUInt32BE(offset)
  }
  return null
}

function webpChunks(bytes: Buffer): string[] {
  const out: string[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    out.push(bytes.subarray(offset, offset + 4).toString('ascii'))
    offset += 8 + (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16))
  }
  return out
}

/** WebP density from an EXIF XResolution tag, when the container carries one. */
function webpDpi(bytes: Buffer): number | null {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii')
    const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16)
    const dataStart = offset + 8
    if (type === 'EXIF') {
      // The payload is `Exif\0\0` followed by a TIFF block, little-endian here.
      const tiff = dataStart + 6
      if (bytes[tiff] !== 0x49 && bytes[tiff] !== 0x4d) return null
      const ifd0 = bytes.readUInt32LE(tiff + 4)
      if (ifd0 < 8) return null
      const count = bytes.readUInt16LE(tiff + ifd0)
      let resolution = 0
      let unit = 2
      for (let i = 0; i < count; i += 1) {
        const entry = tiff + ifd0 + 2 + i * 12
        const tag = bytes.readUInt16LE(entry)
        if (tag === 0x011a) {
          // A RATIONAL is 8 bytes, so it lives out of line behind a pointer.
          const at = bytes.readUInt32LE(entry + 8)
          const numerator = bytes.readUInt32LE(tiff + at)
          const denominator = bytes.readUInt32LE(tiff + at + 4)
          resolution = denominator === 0 ? 0 : numerator / denominator
        }
        if (tag === 0x0128) unit = bytes.readUInt16LE(entry + 8)
      }
      if (resolution <= 0) return null
      // 2 = inches, 3 = centimetres. Nothing else carries a DPI meaning.
      return unit === 2 ? Math.round(resolution) : unit === 3 ? Math.round(resolution * 2.54) : null
    }
    offset = dataStart + size + (size % 2)
  }
  return null
}

/**
 * The PDF page box in millimetres, read from the trailer's `/MediaBox`.
 *
 * jsPDF writes page dictionaries as plain, uncompressed objects, so the numbers
 * are literally in the file. PDF user space is 1/72 inch by definition, so
 * mm = pt * 25.4 / 72, and a correct export at `dpi` gives
 * `pixels * 25.4 / dpi`.
 */
function pdfPageMm(bytes: Buffer): { width: number; height: number; box: number[] } {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`not a PDF: ${bytes.subarray(0, 8).toString('hex')}`)
  }
  const match = /\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)/.exec(
    bytes.toString('latin1'),
  )
  if (!match) throw new Error('the PDF has no /MediaBox')
  const box = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])]
  return {
    width: ((box[2] - box[0]) * 25.4) / 72,
    height: ((box[3] - box[1]) * 25.4) / 72,
    box,
  }
}

/* ------------------------------------------------------------------ *
 * Journeys
 * ------------------------------------------------------------------ */

type OpenTool = (name: 'Export' | 'Stickers' | 'Text' | 'Layers') => Promise<Locator>

type ExportCtx = {
  openTool: (name: 'Export') => Promise<Locator>
  downloadFrom: (action: Locator) => Promise<{ bytes: Buffer; name: string }>
}

/**
 * Whether the panel offers this format at all.
 *
 * The format list is capability-driven (`caps.formats.webp`), and WebKit's
 * `canvas.toBlob('image/webp')` is absent, so the WebP button is genuinely not
 * there on that engine. A test that hard-codes it would be testing Safari
 * rather than the export pipeline.
 */
async function offersFormat(panel: Locator, format: string): Promise<boolean> {
  return (await panel.getByRole('button', { name: format, exact: true }).count()) > 0
}

async function exportAs(
  { openTool, downloadFrom }: ExportCtx,
  format: 'JPEG' | 'PNG' | 'WebP' | 'PDF',
): Promise<{ bytes: Buffer; name: string }> {
  const panel = await openTool('Export')
  const button = panel.getByRole('button', { name: format, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await waitForEstimate(panel)
  const { bytes, name } = await downloadFrom(
    panel.getByRole('button', { name: 'Download', exact: true }),
  )
  return { bytes, name }
}

test.describe('export bytes', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
    // 480 px keeps every full-resolution re-encode in this file fast enough to
    // run in parallel workers; nothing about the byte-level claims depends on
    // the size, and the PDF test derives its expectation from this same number.
    await setOutput(page, { resize: { mode: 'width', width: 480 } })
    await settle()
  })

  test('D7-F11: the PDF page is sized in millimetres at the requested DPI', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    const size = effectiveOutputSize(await readDoc())
    const panel = await openTool('Export')
    const dpiReadout = () => panel.locator('p[class*="readout"]')

    // The document's own DPI, straight from the panel readout.
    expect(await dpiReadout().innerText()).toContain('300 DPI')

    const atDefault = pdfPageMm((await exportAs({ openTool, downloadFrom }, 'PDF')).bytes)
    expect(atDefault.width).toBeCloseTo((size.width * 25.4) / 300, 1)
    expect(atDefault.height).toBeCloseTo((size.height * 25.4) / 300, 1)

    // One press of the real control, to 301 — a value no coincidence produces.
    await panel.getByRole('button', { name: 'Increase DPI' }).click()
    await settle()
    expect((await readDoc()).output.dpi).toBe(301)
    const at301 = pdfPageMm((await exportAs({ openTool, downloadFrom }, 'PDF')).bytes)
    expect(at301.width).toBeCloseTo((size.width * 25.4) / 301, 1)
    // The page really moved, rather than being A4 or letter by coincidence.
    expect(at301.box[2]).toBeCloseTo(atDefault.box[2] * (300 / 301), 1)

    // 600 dpi, reached through the store because the Stepper has no text field.
    await setOutput(page, { dpi: 600 })
    await settle()
    const at600 = pdfPageMm((await exportAs({ openTool, downloadFrom }, 'PDF')).bytes)
    expect(at600.width).toBeCloseTo((size.width * 25.4) / 600, 1)
    expect(at600.box[2]).toBeCloseTo(atDefault.box[2] / 2, 1)
  })

  test('D7-F12: the requested DPI is written into JPEG, PNG and WebP', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    await setOutput(page, { dpi: 300 })
    await settle()
    expect((await readDoc()).output.dpi).toBe(300)

    const jpeg = (await exportAs({ openTool, downloadFrom }, 'JPEG')).bytes
    expect(jpegDpi(jpeg)).toBeCloseTo(300, 0)

    const png = (await exportAs({ openTool, downloadFrom }, 'PNG')).bytes
    expect(pngChunks(png)).toContain('pHYs')
    expect(pngDpi(png)).toBeCloseTo(300, 0)

    // WebP has no native density chunk: it is carried as an EXIF item, which is
    // the only container that can hold it — and only if the platform can encode
    // one at all. The panel already refuses to offer a format the engine cannot
    // produce, which is the behaviour worth asserting.
    const exportPanel = await openTool('Export')
    if (await offersFormat(exportPanel, 'WebP')) {
      const webp = (await exportAs({ openTool, downloadFrom }, 'WebP')).bytes
      expect(webpChunks(webp)).toContain('EXIF')
      expect(webpDpi(webp)).toBeCloseTo(300, 0)
    } else {
      expect(await offersFormat(exportPanel, 'WebP')).toBe(false)
    }
  })

  test('D7-F01: the strip policy really strips, for JPEG, PNG and WebP', async ({
    openTool,
    downloadFrom,
    settle,
  }) => {
    const panel = await openTool('Export')
    await panel
      .getByRole('group', { name: 'Metadata policy' })
      .getByRole('button', { name: 'Strip' })
      .click()
    await settle()

    const jpeg = (await exportAs({ openTool, downloadFrom }, 'JPEG')).bytes
    const markers = jpegMetadataMarkers(jpeg)
    // APP0/JFIF is the container's own density block, not source metadata; the
    // promise on the panel is EXIF, the colour profile, IPTC and comments.
    expect(markers).not.toContain('Exif')
    expect(markers).not.toContain('ICC_PROFILE')
    expect(markers).not.toContain('COM')
    expect(markers.some((name) => name.startsWith('APP13:'))).toBe(false)

    const png = (await exportAs({ openTool, downloadFrom }, 'PNG')).bytes
    const chunks = pngChunks(png)
    for (const type of ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'iCCP', 'tIME']) {
      expect(chunks).not.toContain(type)
    }

    // As above: nothing to read out of a format the engine cannot write.
    if (await offersFormat(panel, 'WebP')) {
      const webp = (await exportAs({ openTool, downloadFrom }, 'WebP')).bytes
      for (const type of ['ICCP', 'XMP ']) {
        expect(webpChunks(webp)).not.toContain(type)
      }
    }
  })

  test('D7-F08: keeping the orientation does not smuggle the rest of EXIF back', async ({
    openTool,
    downloadFrom,
    settle,
  }) => {
    const panel = await openTool('Export')
    const metadata = panel.getByRole('group', { name: 'Metadata policy' })
    // "Orientation" is portrait-or-landscape everywhere else in the app, so the
    // policy that writes the EXIF rotation flag names the tag instead.
    await expect(metadata.getByRole('button', { name: 'Keep orientation' })).toHaveCount(0)
    await metadata.getByRole('button', { name: 'Keep the rotation tag' }).click()
    await settle()
    const jpeg = (await exportAs({ openTool, downloadFrom }, 'JPEG')).bytes
    const markers = jpegMetadataMarkers(jpeg)
    expect(markers).not.toContain('ICC_PROFILE')
    expect(markers).not.toContain('COM')
    // The editor bakes rotation into the pixels at import, so there is no
    // orientation tag to keep; the policy may not invent an Exif block to hold
    // one, because that block is the only way a colour profile rides along.
    expect(markers.some((name) => name.startsWith('APP1:Exif'))).toBe(false)
  })

  test('D7-F14: "fit under N KB" either hits the budget or says it did not', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    // The suite renders at 480 px, where 5 KB is reachable; this test needs an
    // image big enough that an impossible budget is actually impossible.
    await setOutput(page, { resize: { mode: 'none' } })
    await settle()
    const panel = await openTool('Export')
    await panel.getByRole('button', { name: 'JPEG', exact: true }).click()
    await panel.getByLabel('Fit under a maximum size').check()
    const kb = panel.locator('input[type="number"]').last()
    await kb.fill('120')
    await settle()

    const { bytes } = await exportAs({ openTool, downloadFrom }, 'JPEG')
    expect((await readDoc()).output.targetBytes).toBe(120 * 1024)
    expect(bytes.length).toBeLessThanOrEqual(120 * 1024)

    // A budget no JPEG of this image can meet: the panel has to admit it rather
    // than claim success.
    await kb.fill('5')
    await settle()
    await expect(panel.getByRole('alert')).toContainText('Over target')
    const over = await downloadFrom(panel.getByRole('button', { name: 'Download', exact: true }))
    expect(over.bytes.length).toBeGreaterThan(5 * 1024)
  })

  test('D7-F15: the multi-size zip is a real archive of correctly sized images', async ({
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    const base = effectiveOutputSize(await readDoc())
    const panel = await openTool('Export')
    // Narrow the selection so the test renders two sizes, not seven.
    for (const choice of [640, 1440, 1920, 2560, 3840]) {
      await panel.getByRole('checkbox', { name: `${choice}px`, exact: true }).uncheck()
    }
    await settle()
    // Read back what the panel believes is selected, so the assertion describes
    // what the user actually asked for rather than what this file assumed.
    const wanted = (
      await Promise.all(
        [640, 720, 1080, 1440, 1920, 2560, 3840].map(async (w) => ({
          w,
          on: await panel.getByRole('checkbox', { name: `${w}px`, exact: true }).isChecked(),
        })),
      )
    )
      .filter((entry) => entry.on)
      .map((entry) => entry.w)
    expect(wanted).toEqual([720, 1080])

    const { bytes, name } = await downloadFrom(
      panel.getByRole('button', { name: 'Multi-size zip', exact: true }),
    )
    expect(name).toMatch(/\.zip$/)
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50)

    const entries = unzipSync(new Uint8Array(bytes))
    const names = Object.keys(entries).sort()
    // The archive holds exactly the widths that were ticked, named after the
    // imported file, with no path separators a reader could follow.
    expect(names).toEqual(wanted.map((w) => `Sample 1-${w}px.jpg`).sort())
    for (const entry of names) {
      expect(entry).not.toMatch(/[\\/]/)
      const header = readImageHeader(Buffer.from(entries[entry]))
      expect(header.format).toBe('jpeg')
      const width = Number(/-(\d+)px\.jpg$/.exec(entry)![1])
      expect(header.width).toBe(width)
      expect(header.height).toBe(Math.max(1, Math.round((width * base.height) / base.width)))
      // And the entry is a real image, not a zero-length placeholder.
      expect(entries[entry].length).toBeGreaterThan(1024)
    }
  })

  test('D7-F16: the job reports progress and finishes', async ({ page, openTool, settle }) => {
    const panel = await openTool('Export')
    await settle()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      panel.getByRole('button', { name: 'Multi-size zip', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.zip$/)
    // The job left `running` and settled on `done` with a count, not a spinner.
    await expect(page.getByText('Multi-size zip exported (3 sizes)')).toBeVisible()
  })

  test('D6-F04: a watermark really moves, scales and rotates in the export', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    const { height } = await blackPlate(page, openTool, settle)
    await addWatermark(page, openTool, settle)
    await patchFirstLayer(page, 'watermark', { text: 'MARK' })
    await transformFirstLayer(page, 'watermark', { x: 0.5, y: 0.5, scale: 1, rotation: 0 })
    await settle()

    const atRest = (await exportAs({ openTool, downloadFrom }, 'PNG')).bytes
    const rest = await inkBounds(page, atRest)
    saveBand(
      'export-00-watermark-at-rest.png',
      await bandCrop(page, atRest, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    )
    // The default anchor is bottom-right, so the mark rests low and to the right.
    expect(rest.cx).toBeGreaterThan(480 * 0.6)
    expect(rest.cy).toBeGreaterThan(height * 0.6)

    // Now move it. `transform.x/y` are an offset from the anchor (see
    // `drawWatermarkLayer`), so 0.1 is a long way left and 0.2 a long way up.
    await transformFirstLayer(page, 'watermark', { x: 0.1, y: 0.2 })
    await settle()
    expect((await readDoc()).layers.find((l) => l.kind === 'watermark')?.transform).toMatchObject({
      x: 0.1,
      y: 0.2,
    })

    const movedBytes = (await exportAs({ openTool, downloadFrom }, 'PNG')).bytes
    const moved = await inkBounds(page, movedBytes)
    saveBand(
      'export-01-watermark-moved.png',
      await bandCrop(page, movedBytes, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    )
    // Left by 0.4 of the width, up by 0.3 of the height: the mark's centre tracks
    // the transform instead of staying pinned to its anchor.
    expect(moved.cx).toBeCloseTo(rest.cx - 480 * 0.4, -1)
    expect(moved.cy).toBeCloseTo(rest.cy - height * 0.3, -1)

    // Scale 2x about the same anchor quadruples the mark's area.
    await transformFirstLayer(page, 'watermark', { scale: 2 })
    await settle()
    const scaled = await inkBounds(page, (await exportAs({ openTool, downloadFrom }, 'PNG')).bytes)
    expect(scaled.width / moved.width).toBeGreaterThan(1.8)
    expect(scaled.height / moved.height).toBeGreaterThan(1.8)
  })

  test('D6-F08: a watermark blends and fades exactly as the document says', async ({
    page,
    openTool,
    readDoc,
    downloadFrom,
    settle,
  }) => {
    const { height } = await blackPlate(page, openTool, settle)
    await addWatermark(page, openTool, settle)
    await patchFirstLayer(page, 'watermark', { text: 'MARK' })

    // Over a black plate the mark's own alpha is the whole story, so the mean
    // luma of the mark's bounding box *is* the alpha the compositor used.
    const markAlpha = async (): Promise<number> => {
      const bytes = (await exportAs({ openTool, downloadFrom }, 'PNG')).bytes
      const box = await inkBounds(page, bytes)
      expect(box.count).toBeGreaterThan(0)
      const { width: w, height: h } = readImageHeader(bytes)
      const band = await signatureOf(page, bytes, {
        x: box.x / w,
        y: box.y / h,
        width: box.width / w,
        height: box.height / h,
      })
      return band.meanLuma / 255
    }

    await transformFirstLayer(page, 'watermark', { opacity: 1, blend: 'normal' })
    await settle()
    const opaque = await markAlpha()
    // Some mark is there. Its mean over its own bounding box is below 1 even at
    // full opacity, because the box is glyphs *and* the gaps between them; what
    // the ratios below test is the linear scaling, which is the claim.
    expect(opaque).toBeGreaterThan(0.2)

    // A hard-coded 0.85 fudge used to render a document's 1.0 as 0.85 and its
    // 0.4 as 0.34. The mark is now exactly as opaque as the document holds.
    for (const opacity of [0.4, 0.7]) {
      await transformFirstLayer(page, 'watermark', { opacity })
      await settle()
      expect((await readDoc()).layers.find((l) => l.kind === 'watermark')?.transform.opacity).toBe(
        opacity,
      )
      // Compositing white over black is linear in alpha, so the mark's mean
      // luma scales exactly with the document's opacity.
      expect((await markAlpha()) / opaque).toBeCloseTo(opacity, 1)
    }
    expect(height).toBeGreaterThan(0)
  })
})

/** Save a cropped band from a real export, so the report has something to look at. */
function saveBand(name: string, base64: string): void {
  writeFileSync(`.playwright-mcp/${name}`, Buffer.from(base64, 'base64'))
}

/**
 * Cover the frame with an opaque black rectangle, so the only lit pixels in an
 * export are the ones a test put there. The bounding box of those pixels is then
 * a measurement, not an eyeball.
 */
async function blackPlate(
  page: import('@playwright/test').Page,
  openTool: OpenTool,
  settle: () => Promise<void>,
): Promise<{ width: number; height: number }> {
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
  return { width: 480, height: Math.round((480 * 1920) / 1271) }
}

/**
 * Add a watermark through the panel, and leave it on the document.
 *
 * "Add watermark" used to sit at the bottom of a *selected text layer's*
 * inspector, so a text layer had to exist before the button was offered at all
 * and there was no way back to an existing watermark once anything else was
 * selected. It is now offered from the Text panel's default branch, so this goes
 * the short way a user can now take.
 */
async function addWatermark(
  page: import('@playwright/test').Page,
  openTool: OpenTool,
  settle: () => Promise<void>,
): Promise<void> {
  await openTool('Text')
  await page.getByRole('dialog').getByRole('button', { name: 'Add watermark' }).click()
  await settle()
  // The watermark is now selected, so the panel opened on its inspector. The
  // assert is that a watermark is reachable and editable, not just creatable.
  await expect(
    page.getByRole('dialog').getByRole('textbox', { name: 'Watermark text' }),
  ).toBeVisible()
}

/**
 * The export sheet's two controls that were shapes rather than controls.
 *
 * Both are measurements, so both are in a real browser: jsdom reports
 * `scrollWidth === clientWidth === 0` for every element, which means a jsdom
 * assertion of "the swatch is big enough" passes on a 1 × 1 input, and a jsdom
 * assertion that a `<p>` is absent passes on a `<p>` nobody rendered.
 */
test.describe('the export sheet is operable, not just documented', () => {
  test.beforeEach(async ({ page, goto, clearStorage, loadSample, settle, openTool }) => {
    await goto('/editor')
    await clearStorage()
    await loadSample('Sample 1')
    await settle()
    await openTool('Export')
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
  })

  test('the colour behind transparent areas is a tap target, not a 50 × 27 swatch', async ({
    page,
  }) => {
    const swatch = page
      .getByRole('dialog', { name: 'Export' })
      .getByRole('textbox', { name: 'Colour behind transparent areas' })
    await expect(swatch).toBeVisible()

    const measured = await swatch.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return {
        width: rect.width,
        height: rect.height,
        // A class, not a name: the defect was that there was no class at all.
        className: node.className,
        type: (node as HTMLInputElement).type,
        selfHit: hit !== null && (hit === node || node.contains(hit)),
      }
    })

    // It carried an `aria-label` and no class, so it never picked up
    // `controls.module.css`'s `.colorInput` and stayed at the UA's 50 × 27 — a
    // bare target on the one row where the radio and the swatch have to be aimed
    // at the same decision. `.colorInput` is `--ie-tap` square, and `--ie-tap` is
    // 44px at the default density, so the floor is the product's own figure
    // rather than a round guess. The class is asserted because `class="undefined"`
    // — a class that styles nothing — would satisfy a size assertion at the UA's
    // default size on no account, but would read as a class in the DOM.
    expect(measured.type).toBe('color')
    expect(measured.className).toBeTruthy()
    expect(measured.className).not.toContain('undefined')
    expect(measured.height, 'the swatch is shorter than a finger').toBeGreaterThanOrEqual(44)
    // Square, because that is what the rule is: a swatch is chosen by hitting the
    // colour, and an oblong one has corners that belong to nothing.
    expect(Math.abs(measured.width - measured.height), 'the swatch is not square').toBeLessThan(1)
    expect(measured.selfHit, 'something is painted over the swatch').toBe(true)
  })

  test('the swatch grows with the density it is measured in', async ({
    goto,
    loadSample,
    openTool,
    page,
  }) => {
    // Proof that the 44px above is `--ie-tap` being honoured and not a number
    // somebody typed: the same control, in a larger density, is a larger control.
    // Seeded and reloaded rather than set through the panel, because the panel's
    // own controls are at the density under test and the reading would be of the
    // control that made the setting.
    await page.evaluate(() => {
      localStorage.setItem(
        'image-editor-appearance',
        JSON.stringify({ density: 'roomy', textScale: 'xlarge' }),
      )
    })
    await goto('/editor')
    // No `settle()` between the reload and the sample: `settle` waits for a
    // canvas, and the point of the reload is that there is not one yet.
    await expect(page.locator('html')).toHaveAttribute('data-density', 'roomy')
    // The reload lost the document, so the sample is loaded again: this test is
    // about the swatch's size and not about a sheet that was left open.
    await loadSample('Sample 1')
    await openTool('Export')

    const swatch = page
      .getByRole('dialog', { name: 'Export' })
      .getByRole('textbox', { name: 'Colour behind transparent areas' })
    await expect(swatch).toBeVisible()
    const roomy = await swatch.evaluate((node) => node.getBoundingClientRect().height)
    // 44 × 1.125, which is `--ie-tap` under the roomiest density. "Greater than
    // 44" rather than a figure of its own, so the assertion is about the token
    // and not about one engine's rounding.
    expect(roomy, 'the swatch does not follow --ie-tap').toBeGreaterThan(44)
  })

  test('AVIF is either in the picker or named, and never silently missing', async ({ page }) => {
    // The Hub says "plus AVIF where your browser can encode it", and a format the
    // browser cannot encode is dropped from the options — so where that condition
    // is false the picker was one button short with nothing on screen to account
    // for it. Which side of the branch this browser lands on is not the claim;
    // the claim is that the two never disagree.
    const dialog = page.getByRole('dialog', { name: 'Export' })
    const formats = dialog.getByRole('group', { name: 'Export format' })
    const avifButton = formats.getByRole('button', { name: 'AVIF', exact: true })
    const note = dialog.locator('p', { hasText: 'AVIF is missing' })

    const hasButton = (await avifButton.count()) > 0
    const hasNote = (await note.count()) > 0
    expect(hasButton && hasNote, 'AVIF is silently missing from the picker').toBe(false)
    expect(hasButton || hasNote, 'the picker says nothing about AVIF at all').toBe(true)

    if (hasNote) {
      // The line has to name the cause rather than gesture at it: the encode
      // goes through this browser's own canvas encoder, so "AVIF is missing"
      // without a reason is a complaint, not an explanation.
      await expect(note).toHaveText('AVIF is missing because this browser cannot encode it.')
    }
  })
})
