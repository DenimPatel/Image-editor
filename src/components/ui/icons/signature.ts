import { Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'

/**
 * Canonical serialisation of a glyph's artwork.
 *
 * The repo's original icon rot was not a bug in any one icon: `AdjustIcon` and
 * `AdjustGlyph` carried byte-identical path data, as did `ExportIcon` and
 * `ExportGlyph`, and nothing in the build could see it. A hash over the
 * *rendered* element tree — not over the source text, which prettier is free
 * to reflow — makes that class of duplication impossible to reintroduce
 * silently, because two glyphs with different meanings cannot produce the same
 * string.
 *
 * Attribute order is normalised and every primitive is included, so a glyph
 * that differs only in `strokeWidth`, or only in the `fill` of its last child,
 * still counts as different artwork.
 */
export function signatureOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(signatureOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!isValidElement(node)) return ''
  const element = node as ReactElement<Record<string, unknown>>
  if (element.type === Fragment) return signatureOf(element.props.children as ReactNode)
  if (typeof element.type !== 'string') return ''
  const attrs = Object.entries(element.props)
    .filter(([key]) => key !== 'children' && key !== 'key' && key !== 'ref')
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort()
    .join(',')
  const children = signatureOf(element.props.children as ReactNode)
  return `<${element.type} ${attrs}>${children}</${element.type}>`
}

/** FNV-1a, 32-bit. Short enough to read in a failure message, wide enough that a collision across ~100 glyphs is not a thing anyone will hit. */
export function hashSignature(signature: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < signature.length; i += 1) {
    hash ^= signature.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
