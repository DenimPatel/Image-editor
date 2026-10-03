import {
  asBlobPart,
  canvasToBlob,
  encodeCanvas,
  extensionFor,
  mimeFor,
  throwIfAborted,
} from '../../lib/encode'
import { readOutputDpi, setOutputDpi } from '../../lib/metadata/dpi'
import { stripJpegMetadata } from '../../lib/metadata/exif'
import { stripPngMetadata } from '../../lib/metadata/png'
import { fitUnderTarget } from '../../lib/metadata/targetBytes'
import { stripWebpMetadata } from '../../lib/metadata/webp'
import type { Doc, ExportFormat } from '../../model/types'

export type EncodeOptions = {
  signal?: AbortSignal
  /** 0..1, monotonically increasing. */
  onProgress?: (progress: number) => void
}

export type EncodedDocument = {
  blob: Blob
  /** The quality actually encoded, which is below `output.quality` when a
   * target byte budget forced the search down. */
  quality: number
  /** False when even the lowest searched quality is over the requested budget. */
  metTarget: boolean
  /** False when the format could not actually carry the requested DPI. */
  dpiWritten: boolean
  /** Truthful disclosures for the UI, e.g. a target size on a lossless format. */
  notes: string[]
}

const LOSSY: readonly ExportFormat[] = ['jpeg', 'webp', 'avif']

function applyMetadataPolicy(
  format: ExportFormat,
  bytes: Uint8Array,
  policy: Doc['output']['metadata'],
): Uint8Array {
  switch (format) {
    case 'jpeg':
      return stripJpegMetadata(bytes, policy)
    case 'png':
      return stripPngMetadata(bytes, policy)
    case 'webp':
      return stripWebpMetadata(bytes, policy)
    case 'avif':
    case 'pdf':
      return bytes
  }
}

/**
 * Encode the final canvas honouring the output policy: target-bytes binary
 * search, metadata strip/keep, and real DPI written into the file bytes.
 * Pure byte-level post-processing lives in `lib/metadata` and is unit-tested
 * with golden bytes.
 */
export async function encodeDocument(
  canvas: HTMLCanvasElement,
  doc: Doc,
  options: EncodeOptions = {},
): Promise<EncodedDocument> {
  const { format, quality, dpi, metadata, targetBytes } = doc.output
  const report = (progress: number) => options.onProgress?.(progress)
  const notes: string[] = []

  // A size budget only means something for a format with a quality knob. The
  // value survives a format switch because `setOutput` merges partials, so say
  // so out loud rather than quietly ignoring a limit the document still claims.
  const budget = targetBytes !== null && LOSSY.includes(format) ? targetBytes : null
  if (targetBytes !== null && budget === null) {
    notes.push(`A maximum size cannot be enforced for ${extensionFor(format).toUpperCase()}.`)
  }

  throwIfAborted(options.signal)
  report(0.05)

  if (format === 'pdf') {
    const blob = await encodeCanvas(canvas, format, quality, dpi)
    throwIfAborted(options.signal)
    report(1)
    return { blob, quality, metTarget: budget === null, dpiWritten: true, notes }
  }

  let bytes: Uint8Array
  let usedQuality = quality
  let metTarget = budget === null

  if (budget !== null) {
    const result = await fitUnderTarget(
      async (candidateQuality) =>
        new Uint8Array(
          await (await canvasToBlob(canvas, mimeFor(format), candidateQuality)).arrayBuffer(),
        ),
      budget,
      {
        maxQuality: quality,
        signal: options.signal,
        onProgress: (progress) => report(0.05 + progress * 0.7),
      },
    )
    bytes = result.bytes
    usedQuality = result.quality
    metTarget = result.metTarget
  } else {
    bytes = new Uint8Array(await (await encodeCanvas(canvas, format, quality, dpi)).arrayBuffer())
  }

  throwIfAborted(options.signal)
  report(0.8)
  bytes = applyMetadataPolicy(format, bytes, metadata)
  throwIfAborted(options.signal)
  report(0.9)
  bytes = setOutputDpi(format, bytes, dpi)

  const dpiWritten = readOutputDpi(format, bytes) !== null
  if (!dpiWritten) {
    notes.push(
      `${format.toUpperCase()} files carry no resolution metadata, so the ${dpi} DPI setting was not written.`,
    )
  }

  report(1)
  return {
    blob: new Blob([asBlobPart(bytes)], { type: mimeFor(format) }),
    quality: usedQuality,
    metTarget,
    dpiWritten,
    notes,
  }
}
