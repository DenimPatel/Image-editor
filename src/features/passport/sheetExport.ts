import { planSheet, SHEET_SIZES_MM, type SheetName } from './sheet';
import type { PassportSpec } from './specs';

let jsPdfPromise: Promise<typeof import('jspdf')> | null = null;

function loadJsPdf() {
  jsPdfPromise ??= import('jspdf');
  return jsPdfPromise;
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
): Promise<Blob> {
  const { jsPDF } = await loadJsPdf();
  const layout = planSheet(spec, sheet, copies);
  const { widthMm, heightMm } = SHEET_SIZES_MM[sheet];
  const pdf = new jsPDF({
    unit: 'mm',
    format: [widthMm, heightMm],
    orientation: widthMm > heightMm ? 'landscape' : 'portrait',
  });
  const dataUrl = photoCanvas.toDataURL('image/jpeg', 0.95);
  const pxToMm = 25.4 / layout.dpi;
  for (const photo of layout.photos) {
    pdf.addImage(
      dataUrl,
      'JPEG',
      photo.x * pxToMm,
      photo.y * pxToMm,
      photo.width * pxToMm,
      photo.height * pxToMm,
    );
  }
  return pdf.output('blob');
}

export function sheetPreviewCount(spec: PassportSpec, sheet: SheetName, copies: number): number {
  return planSheet(spec, sheet, copies).count;
}
