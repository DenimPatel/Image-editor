import { icon } from './base'

/**
 * The crop panel's own buttons.
 *
 * All three of these used to be borrowed: `UndoGlyph`/`RedoGlyph` for the two
 * 90° rotations, and `GridGlyph` for "fill frame after straighten" — a button
 * whose label said *re-fit the crop box* carrying a four-by-four grid. Rotation
 * is not undo and re-fitting a box is not a grid, so each got a name that says
 * what it does.
 */

/** A closed circular arrow, counter-clockwise. The mirror of `RotateRightGlyph`. */
export const RotateLeftGlyph = icon(
  <>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </>,
)

/** A closed circular arrow, clockwise. */
export const RotateRightGlyph = icon(
  <>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
  </>,
)

/** The Flip & Rotate tool: a picture inside a turning arc. */
export const FlipRotateGlyph = icon(
  <>
    <rect x="8.5" y="9.5" width="10.5" height="10.5" rx="1.5" />
    <path d="M12 5a7 7 0 0 0 0 7" />
    <polyline points="2.5 9.5 5 12 2.5 14.5" />
  </>,
)

/** The crop box re-fitted to the whole frame: outer frame, inner box, corners snapping home. */
export const FillFrameGlyph = icon(
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <rect x="7" y="8" width="10" height="8" rx="1" />
    <path d="M7 8L3 4.5M17 8l4-3.5M17 16l4 3.5M7 16l-4 3.5" />
  </>,
)

/** Swap a `W:H` ratio's sides. An SVG rather than `⇄`/`↔`, because neither character is guaranteed. */
export const SwapRatioGlyph = icon(
  <>
    <line x1="3" y1="12" x2="21" y2="12" />
    <polyline points="7 8 3 12 7 16" />
    <polyline points="17 8 21 12 17 16" />
  </>,
)
