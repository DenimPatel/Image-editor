import type { SheetDetent } from '../../store/uiStore'

/**
 * The three detents a phone sheet can be dragged between, and the height of
 * each.
 *
 * This lives in its own module rather than beside `BottomSheet` because two
 * things have to agree with these numbers, and one of them is not a component:
 * `EditorCanvas` gives the canvas a bottom margin of exactly this, so the canvas
 * is laid out in the strip the sheet leaves visible instead of in the box the
 * sheet then covers. A second copy of the detent heights would be two numbers
 * free to drift, and a canvas fitted a few pixels wrong is a crop handle a
 * finger cannot reach — which is the failure this arrangement exists to prevent.
 *
 * Each value is therefore a `var()`, resolved by the one place that knows how
 * tall the two bars are: `editor.module.css`. That is what lets the same three
 * detents be correct at a 844px-tall window and at a 390px one. Written as the
 * literals `34vh / 58vh / 90vh`, a detent was a fraction of the *window*, which
 * is only a fraction of the room by coincidence, and at a short window the
 * coincidence is what breaks: 58vh of a 390px landscape phone is 226px of a
 * 273px canvas region, so `medium` left 47px of image and the panel was open
 * over nothing. `--ie-sheet-*` is a fraction of the space between the bars,
 * capped so the canvas keeps `--ie-canvas-floor`.
 *
 * Above 900px the sheet becomes a right-hand inspector that spans the full
 * height, so it is written no height at all; `BottomSheet` reads that as "not a
 * bottom sheet" and skips both the height and the canvas's margin.
 */
export const DETENTS: readonly SheetDetent[] = ['peek', 'medium', 'large']

export const SHEET_HEIGHTS: Record<SheetDetent, string> = {
  peek: 'var(--ie-sheet-peek)',
  medium: 'var(--ie-sheet-medium)',
  large: 'var(--ie-sheet-large)',
}
