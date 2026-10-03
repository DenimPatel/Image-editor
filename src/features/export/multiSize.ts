import { zip } from 'fflate'
import { asBlobPart, extensionFor, throwIfAborted } from '../../lib/encode'
import { effectiveOutputSize } from '../../model/selectors'
import type { Doc, Size } from '../../model/types'
import { renderExportCanvas, type RenderableSource } from '../../render/exportCanvas'
import { encodeDocument } from './encodeDocument'

export const DEFAULT_MULTI_SIZE_WIDTHS = [720, 1080, 1920]

/**
 * Reduce an imported file name to a single safe archive *stem* — a name with no
 * path separators, no extension (the real one is appended per entry) and no
 * characters a zip reader would choke on. `a/b.jpg` would otherwise create a
 * nested directory inside the zip and `..` would escape the extraction root.
 */
export function sanitizeEntryStem(name: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? ''
  let cleaned = ''
  for (const char of lastSegment) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) continue
    cleaned += /[A-Za-z0-9_. -]/.test(char) ? char : '_'
  }
  const trimmed = cleaned
    .replace(/^[.\s]+/, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .trim()
  return trimmed.length > 0 ? trimmed.slice(0, 60) : 'image'
}

/** Clamp, drop duplicates and sort, so two widths can never name one entry. */
export function normalizeWidths(widths: readonly number[]): number[] {
  const unique = new Set<number>()
  for (const width of widths) {
    const rounded = Math.round(width)
    if (Number.isFinite(rounded) && rounded >= 1) unique.add(rounded)
  }
  return [...unique].sort((a, b) => a - b)
}

export function multiSizeEntryName(
  stem: string,
  width: number,
  actual: Size,
  format: Doc['output']['format'],
): string {
  const base = `${stem}-${width}px`
  const ext = extensionFor(format)
  return actual.width === width
    ? `${base}.${ext}`
    : `${base}-${actual.width}x${actual.height}.${ext}`
}

function uniqueEntryName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  // `zip` is fflate's asynchronous API; `zipSync` blocks the main thread for
  // the whole archive, which for a handful of multi-megapixel JPEGs is
  // hundreds of milliseconds of frozen UI.
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, data) => {
      if (error) reject(error)
      else resolve(data)
    })
  })
}

export type MultiSizeOptions = {
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export type MultiSizeResult = {
  blob: Blob
  /** Entry path → rendered pixel size, so callers and tests can see what shipped. */
  entries: { name: string; size: Size; bytes: number }[]
}

/**
 * Render the same edit at several widths and bundle them into a zip. Covers
 * the common "give me a few sizes" need without a batch-processing shell.
 */
export async function buildMultiSizeZip(
  source: RenderableSource,
  doc: Doc,
  widths: readonly number[],
  options: MultiSizeOptions = {},
): Promise<MultiSizeResult> {
  const base = effectiveOutputSize(doc)
  const sizes = normalizeWidths(widths)
  if (sizes.length === 0) throw new Error('No widths selected')

  const stem = sanitizeEntryStem(doc.source?.name ?? 'image')
  const files: Record<string, Uint8Array> = {}
  const taken = new Set<string>()
  const entries: MultiSizeResult['entries'] = []

  for (const [index, width] of sizes.entries()) {
    throwIfAborted(options.signal)
    const requestedHeight = Math.max(1, Math.round((width * base.height) / base.width))
    const canvas = await renderExportCanvas(
      source,
      doc,
      { width, height: requestedHeight },
      {
        signal: options.signal,
      },
    )
    throwIfAborted(options.signal)
    const encoded = await encodeDocument(canvas, doc, {
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.((index + progress) / sizes.length),
    })
    const bytes = new Uint8Array(await encoded.blob.arrayBuffer())
    const name = uniqueEntryName(
      taken,
      multiSizeEntryName(stem, width, { width, height: requestedHeight }, doc.output.format),
    )
    files[name] = bytes
    entries.push({ name, size: { width, height: requestedHeight }, bytes: bytes.length })
  }

  throwIfAborted(options.signal)
  options.onProgress?.(1)
  const archive = await zipAsync(files)
  return {
    blob: new Blob([asBlobPart(archive)], { type: 'application/zip' }),
    entries,
  }
}
