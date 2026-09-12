import { zipSync } from 'fflate';
import { extensionFor } from '../../lib/encode';
import { effectiveOutputSize } from '../../model/selectors';
import type { Doc } from '../../model/types';
import { encodeDocument } from './encodeDocument';
import { renderExportCanvas, type RenderableSource } from '../../render/exportCanvas';

/**
 * Render the same edit at several widths and bundle them into a zip. Covers
 * the common "give me a few sizes" need without a batch-processing shell.
 */
export async function buildMultiSizeZip(
  source: RenderableSource,
  doc: Doc,
  widths: number[],
): Promise<Blob> {
  const base = effectiveOutputSize(doc);
  const files: Record<string, Uint8Array> = {};
  for (const width of widths) {
    const height = Math.max(1, Math.round((width * base.height) / base.width));
    const canvas = await renderExportCanvas(source, doc, { width, height });
    const blob = await encodeDocument(canvas, doc);
    files[`${doc.source?.name ?? 'image'}-${width}px.${extensionFor(doc.output.format)}`] = new Uint8Array(
      await blob.arrayBuffer(),
    );
  }
  return new Blob([zipSync(files) as unknown as BlobPart], { type: 'application/zip' });
}
