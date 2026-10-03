import type { ExportFormat } from '../../model/types'

/**
 * D7-F17 — export filename templating.
 *
 * Every place that hands the user a file used to build its own name: the
 * download used `${fileName}-edited.${ext}`, the zip used
 * `${fileName}-sizes.zip`, and the share and copy paths used the first of those
 * again. Two rules for one user, so "one helper feeds download, share, copy and
 * zip" was not true of the code. This is that helper.
 *
 * The tokens are deliberately few and all of them are things a user can see
 * elsewhere in the panel, so a name is never surprising:
 *
 * - `{name}` the sanitised imported stem
 * - `{width}` and `{height}` the output pixels actually written
 * - `{format}` `jpg`, `png`, `webp`, `avif` or `pdf`
 * - `{dpi}` the density in the file
 * - `{date}` `YYYY-MM-DD` in local time
 * - `{index}` the position in a multi-size set, 1-based
 *
 * A token that cannot be filled — `{dpi}` for a PDF, where the density lives in
 * the page geometry instead of a header — is dropped, and the separators around
 * it are collapsed. A template the user typed is never rewritten into nonsense.
 */

export type NameContext = {
  /** The imported file's name with its extension removed. */
  fileName: string
  width: number
  height: number
  format: ExportFormat
  dpi: number
  /** Position in a multi-size set, 1-based. Omitted for a single export. */
  index?: number
  /** Injected so the date is testable. */
  now?: Date
}

const EXTENSIONS: Record<ExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  pdf: 'pdf',
}

/**
 * Strip a path, a trailing extension and anything that cannot survive a
 * Windows, macOS or Linux filesystem.
 *
 * The ZIP writer depends on this: an entry name containing a separator becomes a
 * path inside the archive, and a name containing a control byte is rejected
 * outright by several unarchivers.
 */
/** The characters no filesystem on any of the three platforms will accept. */
const UNSAFE_IN_A_NAME = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

/** True for anything a name must not carry: a separator, a control byte, or a reserved mark. */
function unsafeInName(char: string): boolean {
  const code = char.charCodeAt(0)
  // C0 controls, DEL, and the C1 range. A name carrying one of these is either
  // truncated by the filesystem or rejected outright by an unarchiver.
  if (code < 0x20 || code === 0x7f) return true
  if (code >= 0x80 && code <= 0x9f) return true
  return UNSAFE_IN_A_NAME.has(char)
}

export function sanitizeStem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const withoutExt = base.replace(/\.[a-z0-9]{1,8}$/i, '')
  // Filtered by code point rather than by a regex so the rule is legible: a
  // control-byte range inside a character class is invisible in a diff, and the
  // one that matters here is exactly the part you cannot see.
  let cleaned = ''
  for (const char of withoutExt) if (!unsafeInName(char)) cleaned += char
  cleaned = cleaned.trim()
  const collapsed = cleaned.replace(/\s+/g, ' ').replace(/^\.+/, '')
  return collapsed === '' ? 'export' : collapsed.slice(0, 120)
}

function formatDate(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The tokens a template may use, for a help line in the panel. */
export const NAME_TOKENS = [
  '{name}',
  '{width}',
  '{height}',
  '{format}',
  '{dpi}',
  '{date}',
  '{index}',
] as const

const KNOWN = new Set<string>(NAME_TOKENS.map((token) => token.toLowerCase()))

/** PDF carries its density in the page geometry, so `{dpi}` has nothing to say. */
function available(format: ExportFormat, index?: number): Set<string> {
  const tokens = new Set<string>(['{name}', '{width}', '{height}', '{format}', '{date}'])
  if (format !== 'pdf') tokens.add('{dpi}')
  if (index !== undefined) tokens.add('{index}')
  return tokens
}

/**
 * Tidy a filled name.
 *
 * A dropped token leaves its separators behind — `photo-{dpi}-{date}` becomes
 * `photo--2026-09-29` — and a template is free text, so the result has to be put
 * through the same path-stripping the imported name gets. `{colour}` is *not* a
 * token and is left visible: silently eating it would look like the feature
 * worked.
 */
function tidy(filled: string): string {
  return filled
    .replace(/[\\/]/g, '-')
    .replace(/[<>:"|?*]/g, '')
    .replace(/[._-]{2,}/g, (run) => run[0])
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .trim()
}

/**
 * Fill a template, falling back to `{name}-{width}x{height}.{ext}` when the
 * template collapses to nothing.
 */
export function buildExportName(template: string, context: NameContext): string {
  const stem = sanitizeStem(context.fileName)
  const extension = EXTENSIONS[context.format]
  const usable = available(context.format, context.index)
  const now = context.now ?? new Date()
  const fallback = `${stem}-${context.width}x${context.height}.${extension}`

  const replacements: Record<string, string> = {
    '{name}': stem,
    '{width}': String(context.width),
    '{height}': String(context.height),
    '{format}': extension,
    '{dpi}': String(context.dpi),
    '{date}': formatDate(now),
    '{index}': String(context.index ?? 1),
  }

  const filled = template.replace(/\{[a-z]+\}/gi, (token) => {
    const key = token.toLowerCase()
    if (!KNOWN.has(key)) return token
    return usable.has(key) ? (replacements[key] ?? token) : ''
  })
  const collapsed = tidy(filled)
  if (collapsed === '' || collapsed.toLowerCase() === extension) return fallback
  // A template that already names the extension must not get a second one.
  return collapsed.toLowerCase().endsWith(`.${extension}`) ? collapsed : `${collapsed}.${extension}`
}

/**
 * The name of a multi-size archive.
 *
 * The archive is one file, so the per-size tokens are not available to it; the
 * count is what tells a user how many sizes to expect from the name alone.
 */
export function buildArchiveName(template: string, context: NameContext, sizes: number): string {
  const stem = sanitizeStem(context.fileName)
  const suffix = sizes === 1 ? '1-size' : `${sizes}-sizes`
  const usable = new Set(['{name}', '{format}', '{date}'])
  const now = context.now ?? new Date()
  const replacements: Record<string, string> = {
    '{name}': stem,
    '{format}': EXTENSIONS[context.format],
    '{date}': formatDate(now),
  }
  const filled = template.replace(/\{[a-z]+\}/gi, (token) => {
    const key = token.toLowerCase()
    if (!KNOWN.has(key)) return token
    return usable.has(key) ? (replacements[key] ?? token) : ''
  })
  const collapsed = tidy(filled)
  const base =
    collapsed === '' || collapsed.toLowerCase().endsWith('.zip')
      ? collapsed.replace(/\.zip$/i, '') || `${stem}-${suffix}`
      : collapsed
  return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`
}

/** The policy a name template implies, for the panel's one-line summary. */
export function describeTemplate(template: string): string {
  const used = NAME_TOKENS.filter((token) => template.includes(token))
  return used.length === 0 ? 'Using the default name.' : `Using ${used.join(' ')}.`
}
