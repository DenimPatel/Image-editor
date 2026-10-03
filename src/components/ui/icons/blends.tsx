import type { BlendMode } from '../../../model/types'
import { icon, type IconComponent } from './base'

/**
 * The eight blend modes, drawn with one grammar so the row can be *read*:
 * a square behind, a circle in front, and the lens where they overlap as the
 * result. The inputs say which shape wins; the lens says what winning did.
 *
 *   mode         back        front       lens
 *   normal       solid       solid       —
 *   multiply     half        half        solid (the overlap compounds)
 *   screen       half        half        three dots (the overlap adds light)
 *   overlay      half        half        half solid, half open (contrast doubles)
 *   darken       solid       half        solid (the darker input wins)
 *   lighten      half        solid       solid (the lighter input wins)
 *   soft-light   open        half        nested arcs (a gentle curve)
 *   hard-light   half        solid       a four-ray burst (a hard curve)
 *
 * The brief asked for six; `blendModes()` in `features/layers/factory.ts` has
 * eight, and a six-entry lookup with two holes is the same rot as the missing
 * adjustment glyph, so the two overlay variants are drawn too. `Record` over
 * `BlendMode` makes the map total at compile time.
 */
const normalGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" />
  </>,
)

const multiplyGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" fillOpacity="0.5" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" fillOpacity="0.5" />
    <path d="M7.5 15A7.5 7.5 0 0 1 15 7.5L15 15Z" fill="currentColor" stroke="none" />
  </>,
)

const screenGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" fillOpacity="0.5" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" fillOpacity="0.5" />
    <circle cx="9.8" cy="11.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12.2" cy="9.8" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12.8" cy="13.6" r="1.3" fill="currentColor" stroke="none" />
  </>,
)

const overlayGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" fillOpacity="0.5" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" fillOpacity="0.5" />
    <path d="M7.5 15A7.5 7.5 0 0 1 11.25 8.51L11.25 15Z" fill="currentColor" stroke="none" />
    <path d="M11.25 8.51A7.5 7.5 0 0 1 15 7.5L15 15H11.25Z" />
  </>,
)

const darkenGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" fillOpacity="0.5" />
    <path d="M7.5 15A7.5 7.5 0 0 1 15 7.5L15 15Z" fill="currentColor" stroke="none" />
  </>,
)

const lightenGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" fillOpacity="0.5" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" />
    <path d="M7.5 15A7.5 7.5 0 0 1 15 7.5L15 15Z" fill="currentColor" stroke="none" />
  </>,
)

const softLightGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" fillOpacity="0.5" />
    <path d="M7.5 15A7.5 7.5 0 0 1 15 7.5L15 15Z" />
    <path d="M9.6 12.9A3.3 3.3 0 0 1 12.9 9.6" />
    <path d="M11.3 14.6A1.6 1.6 0 0 1 14.6 11.3" />
  </>,
)

const hardLightGlyph = icon(
  <>
    <rect x="2" y="2" width="13" height="13" rx="1.5" fill="currentColor" fillOpacity="0.5" />
    <circle cx="15" cy="15" r="7.5" fill="currentColor" />
    <path d="M7.5 15 15 7.5M9.6 15l2.4-2.4M15 12.9l-2.4-2.4" strokeWidth="1.4" />
  </>,
)

export const BLEND_GLYPHS: Record<BlendMode, IconComponent> = {
  normal: normalGlyph,
  multiply: multiplyGlyph,
  screen: screenGlyph,
  overlay: overlayGlyph,
  darken: darkenGlyph,
  lighten: lightenGlyph,
  'soft-light': softLightGlyph,
  'hard-light': hardLightGlyph,
}
