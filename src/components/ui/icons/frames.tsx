import type { FrameStyle } from '../../../model/types'
import { icon, type IconComponent } from './base'

/**
 * The six frame *styles*, as distinct silhouettes rather than six rectangles
 * with different corner radii — at 14px a radius is the only difference you
 * can see, and "inset", "solid" and "rounded" all look like a box.
 *
 * `FrameToolGlyph` in `./toolTabs` is the *panel*; these are what it adds.
 */
const solidGlyph = icon(<rect x="3" y="3" width="18" height="18" rx="0.5" />)

/** A keyline drawn *inside* the edge. */
const insetGlyph = icon(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="7" y="7" width="10" height="10" rx="1" />
  </>,
)

/** The wide bottom band is the whole point of a Polaroid; the mark is mostly band. */
const polaroidGlyph = icon(
  <>
    <rect x="4" y="2.5" width="16" height="19" rx="1.5" />
    <rect x="6.5" y="5" width="11" height="10" rx="0.5" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </>,
)

/** Perforations top and bottom. Unmistakable at any size, which is the point. */
const filmGlyph = icon(
  <>
    <rect x="2.5" y="4" width="19" height="16" rx="1.5" />
    <rect x="5" y="6" width="2.4" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="10.8" y="6" width="2.4" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="16.6" y="6" width="2.4" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="5" y="15.6" width="2.4" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="10.8" y="15.6" width="2.4" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
    <rect x="16.6" y="15.6" width="2.4" height="2.4" rx="0.4" fill="currentColor" stroke="none" />
  </>,
)

const roundedGlyph = icon(<rect x="3" y="3" width="18" height="18" rx="6" />)

/** A card with a second sheet behind it, offset: the shadow is the second sheet. */
const shadowCardGlyph = icon(
  <>
    <rect x="3.5" y="3.5" width="14" height="14" rx="2" />
    <rect x="6.5" y="6.5" width="14" height="14" rx="2" />
  </>,
)

export const FRAME_GLYPHS: Record<FrameStyle, IconComponent> = {
  solid: solidGlyph,
  inset: insetGlyph,
  polaroid: polaroidGlyph,
  film: filmGlyph,
  rounded: roundedGlyph,
  'shadow-card': shadowCardGlyph,
}
