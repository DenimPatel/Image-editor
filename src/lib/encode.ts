import type { ExportFormat } from '../model/types'

export { abortError, isAbortError, raceAbort, throwIfAborted } from './metadata/abort'

/** How long the object URL stays alive after a download click. */
export const OBJECT_URL_REVOKE_DELAY_MS = 30_000

export class UnsupportedEncodingError extends Error {
  constructor(
    readonly requested: string,
    readonly produced: string,
  ) {
    super(`This browser cannot encode ${requested}: the canvas encoder returned ${produced}`)
    this.name = 'UnsupportedEncodingError'
  }
}

/**
 * `Uint8Array` is generic over its backing buffer, and the default
 * `ArrayBufferLike` is not assignable to `BlobPart` even when the array really
 * does sit on a plain ArrayBuffer. One documented place to say so.
 */
export function asBlobPart(bytes: Uint8Array): BlobPart {
  return bytes as unknown as BlobPart
}

/**
 * Per the HTML spec `toBlob` silently falls back to `image/png` when the
 * requested type is unknown, so an AVIF request can hand back PNG bytes that
 * then get saved under a `.avif` name. Verify the type instead of assuming it.
 */
export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error(`Failed to encode canvas to ${mime}`))
      },
      mime,
      quality,
    )
  })
  if (blob.type !== mime) throw new UnsupportedEncodingError(mime, blob.type || 'no MIME type')
  return blob
}

/**
 * Encodes the final canvas for the given format. PDF is a real
 * application/pdf blob (the original Python app emitted a data:image/pdf URL
 * and rendered it in an <img> tag, which showed nothing and downloaded the
 * wrong type).
 *
 * The PDF page is sized in millimetres at the requested DPI, not in CSS
 * pixels: jsPDF's `px` unit is 1px = 1/96in, which silently pinned every print
 * export to 96 dpi no matter what the user asked for.
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
  dpi = 96,
): Promise<Blob> {
  switch (format) {
    case 'jpeg':
      return canvasToBlob(canvas, 'image/jpeg', quality)
    case 'png':
      return canvasToBlob(canvas, 'image/png')
    case 'webp':
      return canvasToBlob(canvas, 'image/webp', quality)
    case 'avif':
      return canvasToBlob(canvas, 'image/avif', quality)
    case 'pdf': {
      // Lazily loaded: jsPDF pulls in a large dependency tree that only PDF
      // exports need.
      const { jsPDF } = await import('jspdf')
      const effectiveDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 96
      const pxToMm = 25.4 / effectiveDpi
      const widthMm = canvas.width * pxToMm
      const heightMm = canvas.height * pxToMm
      const pdf = new jsPDF({
        orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [widthMm, heightMm],
      })
      // `toBlob` + `arrayBuffer` instead of `toDataURL`: base64 is a third
      // larger than the bytes and materialises a JS string of the same size,
      // so a 48 MP export built a ~200 MB string on the main thread.
      const bytes = new Uint8Array(
        await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer(),
      )
      pdf.addImage(bytes, 'JPEG', 0, 0, widthMm, heightMm)
      return pdf.output('blob')
    }
  }
}

export function extensionFor(format: ExportFormat): string {
  switch (format) {
    case 'jpeg':
      return 'jpg'
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    case 'avif':
      return 'avif'
    case 'pdf':
      return 'pdf'
  }
}

export function mimeFor(format: ExportFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'pdf':
      return 'application/pdf'
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking in the same task as the click cancels the download outright in
  // Safari and Firefox: the navigation has not read the blob yet.
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
}
