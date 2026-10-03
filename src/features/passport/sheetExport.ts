import { planSheet, sheetSizeMm, type SheetName } from './sheet'
import type { PassportSpec } from './specs'
import type { ExportFormat } from '../../model/types'

let jsPdfPromise: Promise<typeof import('jspdf')> | null = null

function loadJsPdf() {
  jsPdfPromise ??= import('jspdf')
  return jsPdfPromise
}

export type SheetEncodeOptions = {
  /** Transpose the sheet and the photos on it. */
  landscape?: boolean
  /** The document's export format. Lossy formats encode as JPEG. */
  format?: ExportFormat
  /** 0..1, the document's output quality. */
  quality?: number
  /** Colour a transparent export is flattened onto, so it never prints black. */
  matte?: string
  /** Where the flattened copy is drawn. Injected by tests; never by the UI. */
  flattenCanvas?: HTMLCanvasElement
}

/** What jsPDF is told to embed. Only these two are universally supported. */
function embedMime(format: ExportFormat): 'image/png' | 'image/jpeg' {
  return format === 'png' || format === 'webp' ? 'image/png' : 'image/jpeg'
}

function embedName(format: ExportFormat): 'JPEG' | 'PNG' {
  return embedMime(format) === 'image/png' ? 'PNG' : 'JPEG'
}

/**
 * Encode the photo for the sheet.
 *
 * The old version called `toDataURL('image/jpeg', 0.95)` on whatever the export
 * canvas happened to be, which ignored `output.format` and `output.quality` and
 * flattened a transparent canvas onto black — JPEG has no alpha channel, so a
 * passport photo exported with no background came out of the printer as a
 * black rectangle. Flattening happens here, explicitly, onto `matte`.
 */
export function encodeSheetPhoto(
  photoCanvas: HTMLCanvasElement,
  options: SheetEncodeOptions = {},
): string {
  const mime = embedMime(options.format ?? 'jpeg')
  const quality = Math.min(1, Math.max(0.01, options.quality ?? 0.95))
  const matte = options.matte ?? '#ffffff'

  const flatten = options.flattenCanvas ?? document.createElement('canvas')
  flatten.width = photoCanvas.width
  flatten.height = photoCanvas.height
  const ctx = flatten.getContext('2d')
  if (ctx) {
    ctx.fillStyle = matte
    ctx.fillRect(0, 0, flatten.width, flatten.height)
    ctx.drawImage(photoCanvas, 0, 0)
  }

  return mime === 'image/png' ? flatten.toDataURL(mime) : flatten.toDataURL(mime, quality)
}

/**
 * Build a printable sheet PDF at exact physical page size (mm), with the
 * photo copies placed at their planned positions. jsPDF is imported lazily so
 * only passport exports pay for it.
 */
export async function exportPassportSheetPdf(
  spec: PassportSpec,
  sheet: SheetName,
  copies: number,
  photoCanvas: HTMLCanvasElement,
  options: SheetEncodeOptions = {},
): Promise<Blob> {
  const { jsPDF } = await loadJsPdf()
  const landscape = options.landscape ?? false
  const layout = planSheet(spec, sheet, copies, spec.dpi, landscape)
  const { widthMm, heightMm } = sheetSizeMm(sheet, landscape)
  const pdf = new jsPDF({
    unit: 'mm',
    format: [widthMm, heightMm],
    orientation: widthMm > heightMm ? 'landscape' : 'portrait',
  })
  const dataUrl = encodeSheetPhoto(photoCanvas, options)
  const embed = embedName(options.format ?? 'jpeg')
  const pxToMm = 25.4 / layout.dpi
  for (const photo of layout.photos) {
    pdf.addImage(
      dataUrl,
      embed,
      photo.x * pxToMm,
      photo.y * pxToMm,
      photo.width * pxToMm,
      photo.height * pxToMm,
    )
  }
  return pdf.output('blob')
}

export function sheetPreviewCount(
  spec: PassportSpec,
  sheet: SheetName,
  copies: number,
  landscape = false,
): number {
  return planSheet(spec, sheet, copies, spec.dpi, landscape).count
}
