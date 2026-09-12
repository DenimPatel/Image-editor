import { canvasToBlob, encodeCanvas } from '../../lib/encode';
import { mimeFor } from '../../lib/encode';
import { setJpegDpi, setPngDpi } from '../../lib/metadata/dpi';
import { stripJpegMetadata } from '../../lib/metadata/exif';
import { fitUnderTarget } from '../../lib/metadata/targetBytes';
import type { Doc } from '../../model/types';

/**
 * Encode the final canvas honouring the output policy: target-bytes binary
 * search, metadata strip/keep, and real DPI written into the file bytes.
 * Pure byte-level post-processing lives in `lib/metadata` and is unit-tested
 * with golden bytes.
 */
export async function encodeDocument(canvas: HTMLCanvasElement, doc: Doc): Promise<Blob> {
  const { format, quality, dpi, metadata, targetBytes } = doc.output;

  if (format === 'pdf') {
    return encodeCanvas(canvas, format, quality);
  }

  let blob: Blob;
  const isLossy = format === 'jpeg' || format === 'webp' || format === 'avif';

  if (targetBytes && isLossy) {
    const result = await fitUnderTarget(
      async (candidateQuality) => {
        const candidate = await canvasToBlob(canvas, mimeFor(format), candidateQuality);
        return new Uint8Array(await candidate.arrayBuffer());
      },
      targetBytes,
      { maxQuality: quality },
    );
    blob = new Blob([result.bytes as unknown as BlobPart], { type: mimeFor(format) });
  } else {
    blob = await encodeCanvas(canvas, format, quality);
  }

  let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
  if (format === 'jpeg') {
    bytes = stripJpegMetadata(bytes, metadata) as Uint8Array;
    bytes = setJpegDpi(bytes, dpi) as Uint8Array;
  } else if (format === 'png') {
    bytes = setPngDpi(bytes, dpi) as Uint8Array;
  }
  return new Blob([bytes as unknown as BlobPart], { type: blob.type });
}
