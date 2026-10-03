import type { Doc } from '../../model/types'
import { bitmapToBlob } from '../decode'
import type { SourceBytes } from './session'

/**
 * Which encoded bytes belong to the asset the document currently points at.
 *
 * A tool that replaces the source (background removal is the only one today)
 * hands the document a *new* asset id while the editor still holds the file the
 * user imported. Persisting those original bytes under the new id is what makes
 * a cut-out disappear across a reload, so the id the bytes were encoded for is
 * tracked explicitly and the bytes are re-encoded when — and only when — the
 * document moves to a different asset.
 *
 * A re-encode is PNG because the replacement is a matte: it carries alpha that
 * JPEG would flatten away. It only happens on an asset swap, never per save.
 */

export type SourceBytesInput = {
  doc: Doc
  /** The live pixels the document renders, when the editor has them. */
  bitmap: ImageBitmap | null
  /** Bytes already encoded for an asset — the last import, or the last save. */
  known: SourceBytes | null
  /** Injection seam for tests and for callers that already hold the bytes. */
  encode?: (bitmap: ImageBitmap, mime: string) => Promise<Blob>
  mime?: string
}

export const REPLACEMENT_MIME = 'image/png'

export async function bytesForSource(input: SourceBytesInput): Promise<SourceBytes | null> {
  const assetId = input.doc.source?.assetId
  if (!assetId) return null
  if (input.known?.assetId === assetId) return input.known
  if (!input.bitmap) return null
  const mime = input.mime ?? REPLACEMENT_MIME
  const encode = input.encode ?? ((bitmap: ImageBitmap, type: string) => bitmapToBlob(bitmap, type))
  return { assetId, blob: await encode(input.bitmap, mime), mime }
}
