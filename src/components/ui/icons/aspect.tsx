/* eslint-disable react-refresh/only-export-components -- an icon module is a
   catalogue, not a stateful component tree: there is no hook state to lose on a hot
   reload, and splitting the lookups away from the marks they name would make the
   system harder to read, not easier. */
import { icon, iconWith, type IconComponent } from './base'

/**
 * Aspect ratios, drawn the way every phone camera and mirrorless body draws
 * them: a rounded rectangle whose internal division bars sit at the *true*
 * fractional positions, so a 16:9 is actually 16:9 at any size and 4:5 is not
 * secretly 3:4. The convention is a shape, so it survives translation — no
 * character for "16:9" exists in Unicode, and the geometric-shape characters
 * that come close (`▭`, `▢`, `⧉`) have patchy coverage across DejaVu, Segoe UI
 * Symbol, Apple Symbols and Android `system-ui`, where a missing glyph is a
 * hollow box that also happens to be the universal symbol for "square".
 *
 * `vectorEffect="non-scaling-stroke"` comes from `CropOverlay.tsx`, and it
 * belongs on the *parameterised* glyph only. The requirement it answers is
 * "the stroke must not thicken as the rect changes proportion", and the
 * parameterised glyph is the one whose proportion is a runtime value: the same
 * component draws 1:1 and 16:9 side by side in a ratio row. Pinning those two
 * to the same weight is the whole point. The fixed marks have a fixed
 * proportion, so a scaled stroke keeps them at exactly the family's 2 units at
 * 14, 16, 22 and 24 alike, and putting `non-scaling-stroke` on those would
 * make them read lighter than every other icon in the system at 24px.
 */
const PINNED = { vectorEffect: 'non-scaling-stroke' } as const

/** The largest edge a viewfinder may occupy, centred in the 24 grid. */
const MAX_EDGE = 20

export type ViewfinderBox = {
  x: number
  y: number
  width: number
  height: number
  /** The two internal division bars across the short axis, at true thirds. */
  verticals: [number, number]
  /** The two internal division bars across the long axis, at true thirds. */
  horizontals: [number, number]
}

/** Geometry for a `width / height` ratio, fitted to the 24 grid and centred. */
export function viewfinderBox(ratio: number): ViewfinderBox {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const width = safe >= 1 ? MAX_EDGE : MAX_EDGE * safe
  const height = safe >= 1 ? MAX_EDGE / safe : MAX_EDGE
  const x = (24 - width) / 2
  const y = (24 - height) / 2
  return {
    x,
    y,
    width,
    height,
    verticals: [x + width / 3, x + (2 * width) / 3],
    horizontals: [y + height / 3, y + (2 * height) / 3],
  }
}

function viewfinder(box: ViewfinderBox, extra: Record<string, string> = {}) {
  return (
    <>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="1.5" {...extra} />
      <line
        x1={box.verticals[0]}
        y1={box.y}
        x2={box.verticals[0]}
        y2={box.y + box.height}
        {...extra}
      />
      <line
        x1={box.verticals[1]}
        y1={box.y}
        x2={box.verticals[1]}
        y2={box.y + box.height}
        {...extra}
      />
      <line
        x1={box.x}
        y1={box.horizontals[0]}
        x2={box.x + box.width}
        y2={box.horizontals[0]}
        {...extra}
      />
      <line
        x1={box.x}
        y1={box.horizontals[1]}
        x2={box.x + box.width}
        y2={box.horizontals[1]}
        {...extra}
      />
    </>
  )
}

/**
 * The generic case: a caller with a ratio in hand. `landscape`, `portrait` and
 * `square` below are this component at 16:9, 9:16 and 1:1.
 */
export const AspectRatioGlyph = iconWith<{ ratio?: number }>(({ ratio }) =>
  viewfinder(viewfinderBox(ratio ?? 1), PINNED),
)

export const LandscapeRatioGlyph = icon(viewfinder(viewfinderBox(16 / 9)))
export const PortraitRatioGlyph = icon(viewfinder(viewfinderBox(9 / 16)))
export const SquareRatioGlyph = icon(viewfinder(viewfinderBox(1)))

/**
 * Cover: the frame is full, so all four corners are trimmed off. `contain` is
 * its opposite reading — the picture sits *inside* the frame with room around
 * it — and the two marks differ by silhouette, not by a caption.
 */
const COVER_FRAME = { x: 3.5, y: 5, width: 17, height: 14 } as const

const coverGlyph = icon(
  <>
    <rect
      x={COVER_FRAME.x}
      y={COVER_FRAME.y}
      width={COVER_FRAME.width}
      height={COVER_FRAME.height}
      rx="1.5"
    />
    <path d="M6 6L6 11L11 6Z" fill="currentColor" stroke="none" />
    <path d="M18 6L13 6L18 11Z" fill="currentColor" stroke="none" />
    <path d="M6 18L6 13L11 18Z" fill="currentColor" stroke="none" />
    <path d="M18 18L13 18L18 13Z" fill="currentColor" stroke="none" />
  </>,
)

const containGlyph = icon(
  <>
    <rect x={3.5} y={5} width="17" height="14" rx="1.5" />
    <rect x="7.5" y="8.5" width="9" height="7" rx="1" fill="currentColor" stroke="none" />
  </>,
)

/** A sheet of paper: clipped corner, fold, three lines of type. */
const printSheetGlyph = icon(
  <>
    <path d="M14 2.5H6a1 1 0 0 0-1 1v17a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7z" />
    <polyline points="14 2.5 14 7 19 7" />
    <line x1="8" y1="11.5" x2="16" y2="11.5" />
    <line x1="8" y1="15" x2="16" y2="15" />
    <line x1="8" y1="18.5" x2="13" y2="18.5" />
  </>,
)

/**
 * The crop mark for a box that is not held to any shape: four open corners and
 * no edges between them.
 *
 * Every other mark on this chip row is a *closed* rectangle, which is the whole
 * of what it claims — a 16:9 really is 16:9 at any size, and you can check it
 * against the label. `Free` has no ratio, so it cannot be drawn as one and must
 * not be drawn as one: a rectangle beside eight honest ones is the single mark
 * on the row the eye cannot verify, and a square one would read as `1:1`.
 *
 * Open corners are the photographer's own mark for a crop region of whatever
 * shape the photographer dragged, and they say it by what they leave out — there
 * is no edge to measure, so there is no shape being claimed. The chip's dashed
 * border carries the same idea in CSS for the same reason: it is the one thing a
 * dashed border reliably says.
 */
const freeCropGlyph = icon(
  <>
    <polyline points="2.5 8 2.5 2.5 8 2.5" />
    <polyline points="16 2.5 21.5 2.5 21.5 8" />
    <polyline points="21.5 16 21.5 21.5 16 21.5" />
    <polyline points="8 21.5 2.5 21.5 2.5 16" />
  </>,
)

export type AspectKind = 'square' | 'landscape' | 'portrait' | 'cover' | 'contain' | 'page' | 'free'

/** Keyed the way a crop panel wants to ask for a mark rather than import five. */
export const ASPECT_GLYPHS: Record<AspectKind, IconComponent> = {
  square: SquareRatioGlyph,
  landscape: LandscapeRatioGlyph,
  portrait: PortraitRatioGlyph,
  cover: coverGlyph,
  contain: containGlyph,
  page: printSheetGlyph,
  free: freeCropGlyph,
}
