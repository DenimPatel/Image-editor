/* eslint-disable react-refresh/only-export-components -- the three shapes below
   are part of this component's vocabulary, not a second module: they are the
   answer to "what should this chip draw", and a caller that had to import them
   from somewhere else to render a `RatioChip` would be reaching past the control
   to configure it. There is no hook state here to lose on a hot reload, which is
   the other half of what the rule protects. */
import { type CSSProperties } from 'react'
import { ASPECT_GLYPHS, AspectRatioGlyph, type IconComponent } from '../ui/icons'
import { ChipRowShell } from './ChipRow'
import styles from '../tools/ratioChips.module.css'

/**
 * A chip that says what shape it sets, by drawing it.
 *
 * The panel this was built for stacked thirty-six text-only chips: nine generic
 * ratios, twenty-two platform presets in seven headed groups, five print sizes.
 * Seven of them read "Square 1:1", four read "Portrait 4:5" and three read
 * "Story 9:16", so the only way to find a ratio was to read all thirty-six
 * labels — the most-scrolled, least-glanceable surface in the editor.
 *
 * The fix is the camera viewfinder: a rounded rectangle whose internal division
 * bars sit at the true fractional positions of its ratio, which is what every
 * phone camera and mirrorless body draws. It is a *shape*, so it survives
 * translation — there is no character for "16:9" in Unicode at all, and the
 * geometric-shape characters that come close (`▭`, `▢`, `⧉`) have patchy
 * coverage across DejaVu, Segoe UI Symbol, Apple Symbols and Android
 * `system-ui`, where a missing glyph is a hollow box that also happens to be
 * the universal symbol for "square". On a screen full of rectangles, tofu is
 * maximally confusing.
 *
 * The shape is the fast path and the text is the authority. Every chip carries
 * its label in ordinary type, so a screen reader announces the ratio and anyone
 * who does not recognise the shape still has the words — the glyph is
 * `aria-hidden` by the icon base, which is why the button's accessible name is
 * exactly its label and nothing else.
 *
 * The artwork is not drawn here. `AspectRatioGlyph` and `ASPECT_GLYPHS` in
 * `../ui/icons/aspect.tsx` own it, and they carry the two properties that make
 * the shape trustworthy: the bars are at the real fractional positions, and
 * `vector-effect="non-scaling-stroke"` holds the stroke at one weight while the
 * rectangle changes proportion.
 */

/** What a chip draws in front of its label. */
export type RatioChipShape =
  /** The viewfinder at a true `width / height` ratio. The fast path. */
  | { readonly kind: 'viewfinder'; readonly ratio: number }
  /** A fixed mark, for a size that is a page and not a photograph. */
  | {
      readonly kind: 'mark'
      readonly glyph: IconComponent
      readonly width: number
      readonly height: number
    }
  /** No ratio to draw, and none to claim: `Free`. */
  | { readonly kind: 'unlocked' }

export type RatioChipOption = {
  readonly value: string
  /** The chip's whole accessible name, and the authority for the shape. */
  readonly label: string
  /** A second line — the millimetres on a print size. */
  readonly detail?: string
  readonly shape: RatioChipShape
}

/**
 * `Free`: no ratio, and nothing holding the box.
 *
 * The mark is the crop panel's open-corner glyph rather than nothing at all. It
 * used to be an empty shape slot, which left the one chip that makes no shape
 * claim as the one chip with no mark — beside eight rectangles that are all
 * checkable against their labels, so the eye had nothing to compare it against.
 * Four open corners say "a crop region of whatever shape" without claiming one:
 * there is no edge to measure, which is the point. See `aspect.tsx`.
 */
export const UNLOCKED: RatioChipShape = { kind: 'unlocked' }

/**
 * A sheet of paper, for the print sizes.
 *
 * These are page proportions, not photo proportions: 4×6 in and A3 are the
 * proportions of a piece of paper, and drawing them as a viewfinder would claim
 * they are a camera's frame. The millimetre line on the chip carries the size,
 * because a page outline says "sheet" and nothing about how big.
 */
export const PAGE: RatioChipShape = {
  kind: 'mark',
  glyph: ASPECT_GLYPHS.page,
  width: 16,
  height: 20,
}

/**
 * One proportion, one chip, whichever of the two marks it needs.
 *
 * ## The decision this records
 *
 * The audit found "two designs for *a proportion*" and judged the split defensible:
 * one is a diagram, one is a picker, and it is not obvious they are the same idea.
 * They are, though, and this is where the rule now lives:
 *
 *  - **A sheet** — a print size, a piece of paper you will hand to a printer — is
 *    drawn as `PAGE`: a sheet with a clipped corner and three lines of type. Drawing
 *    it as a viewfinder would claim it is a camera's frame, and `RatioChip.test.tsx`
 *    pins that distinction by asserting 4 × 6 in and a 2:3 photograph do not render
 *    the same markup.
 *  - **A document** — a passport photo, a visa photo, any photograph a form asks
 *    for — is drawn as a proportional viewfinder, because the silhouette *is* the
 *    information: 35 × 45 and 50 × 70 have to be told apart before either label is
 *    read.
 *
 * Both rows state their size the same way, in millimetres on the chip's second line,
 * because that is the one number a user has to type into a form.
 *
 * ## Why it is a function and not two constants
 *
 * The crop panel's print sizes and the passport panel's document sizes were each
 * building their own option object, and they had drifted as far as the mark choice,
 * which lived in the call site where nothing could check it. One function means the
 * two rows cannot disagree about how a proportion is drawn.
 *
 * `detail` is passed in rather than formatted here, and that is not laziness: the
 * millimetres are the number a user has to type into a form, so each panel formats
 * them from its own source of truth — `printSizeMm` for a print size,
 * `widthMm`/`heightMm` for a passport spec — rather than one of them being handed a
 * string the other invented. Two panels, two sources, one drawing.
 */
export function proportionChip({
  value,
  label,
  detail,
  widthMm,
  heightMm,
  sheet,
}: {
  value: string
  /** The chip's whole accessible name, so it is the caller's to word. */
  label: string
  /** The size, already written the way this panel writes sizes. */
  detail: string
  /** The physical size, for the viewfinder's ratio. Ignored when `sheet`. */
  widthMm: number
  heightMm: number
  /** `true` for a piece of paper, `false` for a photograph a form asks for. */
  sheet: boolean
}): RatioChipOption {
  // A zero height is `Infinity`, and `RatioChip` reads any non-finite ratio as a
  // square: a chip that cannot draw a shape says so with a square rather than with
  // `NaN` geometry, and the millimetre line beside it still carries the real size.
  const ratio = heightMm === 0 ? Number.NaN : widthMm / heightMm
  return {
    value,
    label,
    detail,
    shape: sheet ? PAGE : { kind: 'viewfinder', ratio },
  }
}

/**
 * The open-corner mark's box, the full 24-unit grid the glyph is drawn on, so it
 * occupies the same optical slot the viewfinders do and the row's baseline holds.
 */
const FREE_FRAME = { width: 24, height: 24 }

/**
 * The long edge of a viewfinder frame, in px, before `--icon-scale`.
 *
 * 24 is the icon system's own grid, so a viewfinder is drawn at the same size as
 * every other glyph in the app, and the chip's 36px minimum height still clears
 * it with the padding: 24 + 10 = 34.
 */
const LONG_EDGE = 24

/**
 * The frame's own limits, as a ratio.
 *
 * Every ratio the app offers lands between 9:16 and 1.91:1 — 0.5625 to 1.91 —
 * so nothing is ever clamped, and the clamp exists for a ratio typed into the
 * custom field or added to the catalogue later, where the alternative is a chip
 * four hundred pixels wide or a viewfinder one pixel tall. A clamped frame is a
 * shape that is not the ratio, which is why the label is on every chip.
 */
const RATIO_MIN = 0.4
const RATIO_MAX = 2.5

/**
 * The box a viewfinder occupies for a ratio.
 *
 * The frame is the ratio, not a square that a ratio is drawn inside: the box is
 * `LONG_EDGE` on its long side and proportionally shorter on the other, and the
 * `non-scaling-stroke` on the glyph keeps the stroke at one weight from 1:1 to
 * 16:9. A square box would make all nine generic ratios the same silhouette,
 * which is the one thing a viewfinder must never be.
 */
function viewfinderFrame(ratio: number): { width: number; height: number } {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const clamped = Math.min(Math.max(safe, RATIO_MIN), RATIO_MAX)
  return clamped >= 1
    ? { width: LONG_EDGE, height: LONG_EDGE / clamped }
    : { width: LONG_EDGE * clamped, height: LONG_EDGE }
}

/** The box, carried by `--icon-scale` so the icon preference moves the shape. */
function frameStyle(width: number, height: number): CSSProperties {
  return {
    width: `calc(${width}px * var(--icon-scale))`,
    height: `calc(${height}px * var(--icon-scale))`,
  }
}

function Shape({ shape }: { shape: RatioChipShape }) {
  if (shape.kind === 'unlocked') {
    const Glyph = ASPECT_GLYPHS.free
    return (
      <span className={styles.frame} style={frameStyle(FREE_FRAME.width, FREE_FRAME.height)}>
        <Glyph />
      </span>
    )
  }
  if (shape.kind === 'mark') {
    const Glyph = shape.glyph
    return (
      <span className={styles.frame} style={frameStyle(shape.width, shape.height)}>
        <Glyph />
      </span>
    )
  }
  const frame = viewfinderFrame(shape.ratio)
  return (
    <span className={styles.frame} style={frameStyle(frame.width, frame.height)}>
      <AspectRatioGlyph ratio={shape.ratio} />
    </span>
  )
}

function classes(...names: (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === 'string' && name.length > 0).join(' ')
}

/**
 * One shape chip. The button is the control, so there is no wrapper to find by
 * role and the accessible name is the label alone.
 */
export function RatioChip({
  option,
  selected,
  onSelect,
}: {
  option: RatioChipOption
  selected: boolean
  onSelect: (value: string) => void
}) {
  const { detail, label, shape, value } = option
  return (
    <button
      type="button"
      className={classes(
        styles.chip,
        shape.kind === 'unlocked' && styles.unlocked,
        selected && styles.chipActive,
      )}
      aria-pressed={selected}
      onClick={() => onSelect(value)}
    >
      <Shape shape={shape} />
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {detail ? <span className={styles.detail}>{detail}</span> : null}
      </span>
    </button>
  )
}

/**
 * A scrolling row of shape chips.
 *
 * The shell is `ChipRowShell`, the same one `ChipRow` uses, so the fade-on-
 * overflow behaviour is one implementation for the whole app: a change to it can
 * no longer land in one row and miss the other. The shell is shared rather than
 * `ChipRow` itself because a shape chip carries a glyph slot and an optional
 * millimetre line in front of its label, and a text-only row has nowhere to put
 * them.
 *
 * The class names are not shared, and should not be: the two rows draw their
 * chips from different CSS modules on purpose, and `ChipRowShell` takes the fade
 * class as a prop so each row keeps its own styling while the measurement —
 * the part with the bug in it — is written once.
 */
export function RatioChipRow({
  options,
  selected,
  onChange,
  ariaLabel,
  className,
  style,
  labelledBy,
}: {
  options: readonly RatioChipOption[]
  /** Every selected value: a shape row can light more than one chip at once. */
  selected: readonly string[]
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
  style?: CSSProperties
  labelledBy?: string
}) {
  return (
    <ChipRowShell
      className={classes(styles.row, className)}
      fadeClassName={styles.rowMore}
      style={style}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
    >
      {options.map((option) => (
        <RatioChip
          key={option.value}
          option={option}
          selected={selected.includes(option.value)}
          onSelect={onChange}
        />
      ))}
    </ChipRowShell>
  )
}
