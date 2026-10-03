import type { Size } from '../../model/types'
import { parseRatio } from '../format'
import { mmToPx } from './geometry'

export type AspectPreset = { id: string; label: string; aspect: number | null }

/** A platform preset always claims a ratio, so its aspect is never optional. */
export type PlatformPreset = { id: string; label: string; aspect: number }

export type AspectGroup = { id: string; label: string; presets: PlatformPreset[] }

/**
 * How close two ratios have to be to be the same ratio.
 *
 * `cropPixelReadout` measures the crop in whole source pixels, so a 16:9 lock on
 * a 3000×2000 photo comes back as 3000/1688 and not as 16/9. A selection that
 * compared the two exactly would light no chip at all for most photographs, and
 * the one thing this panel must never do is label a crop with a shape it does
 * not have. `readout.ts` uses the same figure for its own named ratios, so the
 * chip and the readout agree at the boundary instead of each having a private
 * tolerance.
 */
export const RATIO_TOLERANCE = 5e-3

/**
 * The one string each ratio is called.
 *
 * A ratio has to be spelled the same way on a chip, in a row heading and in the
 * canvas readout, or "16:9" is three strings and a search finds one of them.
 * `readout.ts` reads `ratioLabel` rather than keeping its own table — it used
 * to, and its copy was missing `5:7`, so a 5:7 crop said `5:7` on the chip and
 * `0.71:1` on the canvas. `CropPanel` picks its lit chip with `isRatio` against
 * the same `RATIO_TOLERANCE` this function names a ratio with, so the chip that
 * lights and the string the overlay prints cannot disagree at the boundary.
 */
const NAMED_RATIOS: readonly (readonly [string, number])[] = [
  ['1:1', 1],
  ['5:4', 5 / 4],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['2:1', 2],
  ['16:9', 16 / 9],
  ['5:7', 5 / 7],
  ['4:5', 4 / 5],
  ['3:4', 3 / 4],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
]

/** `ratioLabel` for a real ratio, and `1.78:1` for one nobody has a name for. */
export function ratioLabel(aspect: number): string {
  if (!Number.isFinite(aspect) || aspect <= 0) return '—'
  for (const [label, value] of NAMED_RATIOS) {
    if (Math.abs(aspect - value) < RATIO_TOLERANCE) return label
  }
  return `${aspect.toFixed(2)}:1`
}

/** Whether a measured crop aspect is the same ratio as a claimed one. */
export function isRatio(aspect: number, claimed: number | null): boolean {
  return claimed !== null && Math.abs(aspect - claimed) < RATIO_TOLERANCE
}

/**
 * The generic ratio row, one chip of which is not a ratio.
 *
 * There used to be two chips here for the same thing. `Original` and `Free` both
 * carried `aspect: null`, both meant "do not lock the box to a shape", and both
 * set the lock to `null` and the crop to the full frame. They were told apart
 * only by a dashed border and by the fact that `Free` happened to be the one
 * `activeGeneric` falls back to.
 *
 * They were also the third and fourth things in the app called "Original":
 * Export's resize mode, where it means "do not resize", and the compare badge,
 * where it means "the unedited photo". One word was carrying four unrelated
 * claims, and a user who had learned it in one place had to relearn it in
 * another. The row now says `Free`, which is the one thing this chip actually
 * does — it is the state the lock is in when nothing is holding the box — and
 * the word "Original" is left to mean one thing in the product.
 *
 * The id is `free`, which is the one `CropPanel` already used as its fallback
 * and the one its `shape` branch already gave the dashed outline, so the merge
 * changes what a chip is called and nothing else. Nothing persists a preset id:
 * `Doc.geometry.aspectLock` stores the ratio number, not the id, so a document
 * saved against the old chip loads against the new one with the same meaning.
 */
export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: 'Free', aspect: null },
  { id: '1:1', label: '1:1', aspect: 1 },
  { id: '4:5', label: '4:5', aspect: 4 / 5 },
  { id: '3:2', label: '3:2', aspect: 3 / 2 },
  { id: '16:9', label: '16:9', aspect: 16 / 9 },
  { id: '9:16', label: '9:16', aspect: 9 / 16 },
  { id: '2:3', label: '2:3', aspect: 2 / 3 },
  { id: '5:7', label: '5:7', aspect: 5 / 7 },
  { id: '4:3', label: '4:3', aspect: 4 / 3 },
]

/**
 * The platform catalogue, and the three rules its labels follow.
 *
 * The panel used to lay these out as seven headed groups, and the labels were
 * the shape words: seven chips read "Square 1:1", four read "Portrait 4:5" and
 * three read "Story 9:16". Nothing on screen said which platform any of them
 * belonged to, so the block was thirty-six text-only chips in which the fastest
 * way to find Instagram's square was to read all seven of them.
 *
 * 1. **Every label is qualified by its platform.** Twenty-two chips, twenty-two
 *    distinct strings, and a chip can be named out of a screenshot and still be
 *    unambiguous. The ids are untouched — `findPresetById` and
 *    `safeAreaFor` both key off them.
 * 2. **No label states an orientation the ratio already states.** "Portrait
 *    4:5" said portrait twice, and "Landscape 16:9" said it twice as well; the
 *    shape on the chip and the ratio in the label between them settle it. This
 *    is the orientation-expressed-twice half of the four-vocabularies problem.
 * 3. **A format word survives only where it names a format.** "Story", "Shorts",
 *    "Video" and "Pin" stay, because they are not the ratio: they say which
 *    placement the crop is for, and three of them are what
 *    `safeAreaFor(preset.id)` reads to open a safe-area overlay. Dropping
 *    "Story" would have collapsed Instagram Story, Facebook Story, Pinterest
 *    Story, TikTok Video and YouTube Shorts into five identical chips that
 *    quietly set three *different* safe areas.
 */
export const PLATFORM_GROUPS: AspectGroup[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    presets: [
      { id: 'instagram-square', label: 'Instagram 1:1', aspect: 1 },
      { id: 'instagram-portrait', label: 'Instagram 4:5', aspect: 4 / 5 },
      { id: 'instagram-landscape', label: 'Instagram 1.91:1', aspect: 1.91 },
      { id: 'instagram-story', label: 'Instagram Story 9:16', aspect: 9 / 16 },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    presets: [
      { id: 'tiktok-video', label: 'TikTok Video 9:16', aspect: 9 / 16 },
      { id: 'tiktok-square', label: 'TikTok 1:1', aspect: 1 },
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    presets: [
      { id: 'linkedin-square', label: 'LinkedIn 1:1', aspect: 1 },
      { id: 'linkedin-portrait', label: 'LinkedIn 4:5', aspect: 4 / 5 },
      { id: 'linkedin-landscape', label: 'LinkedIn 1.91:1', aspect: 1.91 },
    ],
  },
  {
    id: 'x',
    label: 'X',
    presets: [
      { id: 'x-landscape', label: 'X 16:9', aspect: 16 / 9 },
      { id: 'x-square', label: 'X 1:1', aspect: 1 },
      { id: 'x-portrait', label: 'X 4:5', aspect: 4 / 5 },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    presets: [
      { id: 'facebook-square', label: 'Facebook 1:1', aspect: 1 },
      { id: 'facebook-portrait', label: 'Facebook 4:5', aspect: 4 / 5 },
      { id: 'facebook-landscape', label: 'Facebook 16:9', aspect: 16 / 9 },
      { id: 'facebook-story', label: 'Facebook Story 9:16', aspect: 9 / 16 },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    presets: [
      { id: 'youtube-video', label: 'YouTube 16:9', aspect: 16 / 9 },
      { id: 'youtube-shorts', label: 'YouTube Shorts 9:16', aspect: 9 / 16 },
      { id: 'youtube-square', label: 'YouTube 1:1', aspect: 1 },
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    presets: [
      { id: 'pinterest-pin', label: 'Pinterest Pin 2:3', aspect: 2 / 3 },
      { id: 'pinterest-square', label: 'Pinterest 1:1', aspect: 1 },
      { id: 'pinterest-story', label: 'Pinterest Story 9:16', aspect: 9 / 16 },
    ],
  },
]

/** One row of the platform block: every platform preset that shares a ratio. */
export type PlatformShapeRow = {
  key: string
  /** The ratio as text — the row's heading, and the authority for its chips. */
  label: string
  aspect: number
  presets: PlatformPreset[]
}

/** Ratios are compared as measured pixel ratios, so they need a rounding key. */
function ratioKey(aspect: number): string {
  return aspect.toFixed(4)
}

/**
 * The platform catalogue regrouped by shape.
 *
 * Grouping by platform is what produced seven rows of which five held one chip
 * reading "Square 1:1" and nothing else. Grouping by ratio produces six rows —
 * 1:1, 4:5, 1.91:1, 9:16, 16:9, 2:3 — and every platform still has a chip per
 * ratio it offers, carrying that ratio's shape, so nothing is unreachable: the
 * seven square chips are now one row of seven shapes instead of seven rows of
 * seven words. Rows appear in the order their ratio is first mentioned, and
 * chips keep the catalogue order inside a row, so the block reads the same top
 * to bottom as before.
 */
export function platformShapeRows(): PlatformShapeRow[] {
  const rows = new Map<string, PlatformShapeRow>()
  for (const group of PLATFORM_GROUPS) {
    for (const preset of group.presets) {
      const key = ratioKey(preset.aspect)
      const row = rows.get(key)
      if (row) {
        row.presets.push(preset)
        continue
      }
      rows.set(key, {
        key,
        label: ratioLabel(preset.aspect),
        aspect: preset.aspect,
        presets: [preset],
      })
    }
  }
  return [...rows.values()]
}

export type PrintSizeId = '4x6' | '5x7' | '8x10' | 'a4' | 'a3'

export type PrintSize = {
  id: PrintSizeId
  /**
   * The one string this size is called, anywhere in the app. The crop chips, the
   * passport sheet picker and the millimetre line all read it or derive from it;
   * the sheet picker used to re-type a tighter `4×6 in` beside the crop panel's
   * `4 × 6 in`, and a size with two spellings is a size whose label can be wrong
   * without anything failing.
   */
  label: string
  widthMm: number
  heightMm: number
  /**
   * Whether the passport sheet offers this size. The crop tool and the sheet
   * picker showed two different lists that both re-typed the same millimetres;
   * a wrong millimetre is a wrong physical print size, so the numbers live here
   * exactly once and the sheet derives everything else from them.
   */
  sheet: boolean
}

/**
 * The one table of geometric sizes. Five entries: the three the passport sheet
 * can paginate plus 8×10 and A3, which are too big to fill with photos.
 */
export const PRINT_SIZES: PrintSize[] = [
  { id: '4x6', label: '4 × 6 in', widthMm: 101.6, heightMm: 152.4, sheet: true },
  { id: '5x7', label: '5 × 7 in', widthMm: 127, heightMm: 177.8, sheet: true },
  { id: '8x10', label: '8 × 10 in', widthMm: 203.2, heightMm: 254, sheet: false },
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, sheet: true },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420, sheet: false },
]

const PRINT_SIZES_BY_ID = new Map<PrintSizeId, PrintSize>(
  PRINT_SIZES.map((size) => [size.id, size]),
)

/** The one place a print size's physical dimensions come from. */
export function printSizeById(id: PrintSizeId): PrintSize {
  const size = PRINT_SIZES_BY_ID.get(id)
  if (!size) throw new Error(`no print size for "${id}"`)
  return size
}

/** The millimetres of a print size, in the app's one millimetre string. */
export function printSizeMm(size: PrintSize): string {
  return `${mmText(size.widthMm)} × ${mmText(size.heightMm)} mm`
}

/**
 * A millimetre figure, at full precision where the size needs it.
 *
 * A4 is 210 mm, not 210.0, and 4×6 in is 101.6 mm rather than a rounded 102 —
 * the millimetres are what the printer is handed, so a chip that printed `102 ×
 * 152 mm` would be describing a different piece of paper from the one the
 * export resizes to.
 */
function mmText(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : String(Number.parseFloat(mm.toFixed(1)))
}

export function printSizePx(size: PrintSize, dpi: number): Size {
  return {
    width: Math.round(mmToPx(size.widthMm, dpi)),
    height: Math.round(mmToPx(size.heightMm, dpi)),
  }
}

export function findPresetById(id: string): AspectPreset | undefined {
  for (const preset of ASPECT_PRESETS) {
    if (preset.id === id) return preset
  }
  for (const group of PLATFORM_GROUPS) {
    for (const preset of group.presets) {
      if (preset.id === id) return preset
    }
  }
  return undefined
}

export function aspectForCustomRatio(text: string): number | null {
  const parsed = parseRatio(text)
  if (!parsed) return null
  return parsed.width / parsed.height
}
