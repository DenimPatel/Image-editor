import type { RedactLayer } from '../../../model/types'
import { icon, type IconComponent } from './base'

/**
 * What a redaction region *does*, not the tool that creates it. The four marks
 * are frameless on purpose: `RedactToolGlyph` is a frame with a bar in it, and
 * a mode that was also a frame with a bar in it would be the same drawing
 * twice.
 */
const pixelateGlyph = icon(
  <>
    <rect x="3" y="3" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="9.8" y="3" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="16.6" y="3" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="3" y="9.8" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="9.8" y="9.8" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="16.6" y="9.8" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="3" y="16.6" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="9.8" y="16.6" width="4.4" height="4.4" fill="currentColor" stroke="none" />
    <rect x="16.6" y="16.6" width="4.4" height="4.4" fill="currentColor" stroke="none" />
  </>,
)

/** Overlapping soft blobs: the edges are still there, they are just not locatable. */
const blurGlyph = icon(
  <>
    <circle cx="9" cy="10" r="6" fill="currentColor" fillOpacity="0.28" stroke="none" />
    <circle cx="15" cy="14" r="6" fill="currentColor" fillOpacity="0.28" stroke="none" />
    <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.6" stroke="none" />
  </>,
)

/** The bar. This is what "redacted" looks like in every newsprint that ever ran one. */
const solidGlyph = icon(
  <rect x="2" y="8.5" width="20" height="7" rx="1.5" fill="currentColor" stroke="none" />,
)

const emojiGlyph = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
    <path d="M8 14.5a5 5 0 0 0 8 0" />
  </>,
)

export const REDACT_MODE_GLYPHS: Record<RedactLayer['mode'], IconComponent> = {
  pixelate: pixelateGlyph,
  blur: blurGlyph,
  solid: solidGlyph,
  emoji: emojiGlyph,
}
