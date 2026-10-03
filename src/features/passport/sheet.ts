import { mmToPx } from '../../lib/crop/geometry'
import { PRINT_SIZES, printSizeById, type PrintSizeId } from '../../lib/crop/presets'
import type { PassportSpec } from './specs'

/**
 * The sheet catalogue is no longer a second copy of the millimetres: it is the
 * subset of `PRINT_SIZES` the sheet offers, in the crop tool's order. The
 * crop tool keeps 8×10 and A3 (too big to fill with photos) and the sheet keeps
 * the three it can paginate; both now read their dimensions from the same
 * table, so a corrected print size cannot leave the sheet printing the old one.
 */
const SHEET_IDS = ['4x6', '5x7', 'a4'] as const

export type SheetName = (typeof SHEET_IDS)[number]

/** A sheet size, read straight out of the print catalogue. */
export type SheetSize = { name: SheetName; label: string; widthMm: number; heightMm: number }

/**
 * The segmented control says what the crop chips say.
 *
 * This used to carry its own `SHEET_LABELS` spelling out `4×6 in` against the
 * print table's `4 × 6 in`, with a comment justifying the tighter wording as a
 * space saving in a fixed-width control. That comment is what gave the second
 * table away: a copy whose stated purpose is to *differ* from the table it
 * duplicates is a copy that has to be resynced by hand, and the only thing
 * standing between the two was an assertion somebody had to go and write.
 *
 * The millimetres already came from `printSizeById`, so the labels are the last
 * thing in this file that was not already shared. One table now, and
 * `sheet.test.ts` asserts the equality outright rather than implying it.
 */
export const SHEET_SIZES: SheetSize[] = SHEET_IDS.map((name) => {
  const { label, widthMm, heightMm } = printSizeById(name)
  return { name, label, widthMm, heightMm }
})

export const SHEET_SIZES_MM: Record<SheetName, { widthMm: number; heightMm: number }> =
  Object.fromEntries(
    SHEET_IDS.map((name) => {
      const { widthMm, heightMm } = printSizeById(name)
      return [name, { widthMm, heightMm }]
    }),
  ) as Record<SheetName, { widthMm: number; heightMm: number }>

/** Options for a segmented control, so the panel never re-types the list. */
export function sheetOptions(): { value: SheetName; label: string }[] {
  return SHEET_SIZES.map(({ name, label }) => ({ value: name, label }))
}

export function isSheetName(value: string): value is SheetName {
  return (SHEET_IDS as readonly string[]).includes(value)
}

/** The print-catalogue entry behind a sheet size, for callers that want it. */
export function sheetPrintSize(sheet: SheetName) {
  return printSizeById(sheet)
}

/**
 * Every `PRINT_SIZES` entry marked as a sheet, for the invariant test.
 *
 * The sheet does *not* expose the whole marked subset as a layout: a 8×10 sheet
 * cannot be filled to the top with photos, so `SHEET_IDS` is the three worth
 * offering. The equality that matters is the one below — every sheet name here
 * really is a `sheet` print size, and its label really is that size's label.
 */
export function catalogueSheetSizes(): PrintSizeId[] {
  return PRINT_SIZES.filter((size) => size.sheet).map((size) => size.id)
}

/** Sheet size for the requested orientation: landscape transposes the sheet. */
export function sheetSizeMm(sheet: SheetName, landscape = false) {
  const size = SHEET_SIZES_MM[sheet]
  return landscape ? { widthMm: size.heightMm, heightMm: size.widthMm } : size
}

export type SheetPhoto = { x: number; y: number; width: number; height: number }

export type SheetLayout = {
  sheet: SheetName
  sheetWidthPx: number
  sheetHeightPx: number
  dpi: number
  columns: number
  /** Rows the sheet physically has. */
  rows: number
  /** Rows actually filled by `count` photos — the block is centred on these. */
  filledRows: number
  count: number
  gapPx: number
  landscape: boolean
  photos: SheetPhoto[]
}

export function planSheet(
  spec: PassportSpec,
  sheet: SheetName,
  copies: number,
  dpi: number = spec.dpi,
  landscape = false,
): SheetLayout {
  const sheetMm = sheetSizeMm(sheet, landscape)
  const gapPx = mmToPx(2, dpi)
  // Landscape transposes the photo too, which is the whole point of the swap:
  // a 4×6 sheet of 45×35 mm photos, not 45 mm photos in a landscape frame.
  const photoW = mmToPx(landscape ? spec.heightMm : spec.widthMm, dpi)
  const photoH = mmToPx(landscape ? spec.widthMm : spec.heightMm, dpi)
  const sheetWidthPx = mmToPx(sheetMm.widthMm, dpi)
  const sheetHeightPx = mmToPx(sheetMm.heightMm, dpi)

  const columns = Math.max(0, Math.floor((sheetWidthPx + gapPx) / (photoW + gapPx)))
  const rows = Math.max(0, Math.floor((sheetHeightPx + gapPx) / (photoH + gapPx)))
  const count = Math.min(Math.max(0, copies), columns * rows)

  // Placement, on the one axis where the count of copies has anything to say.
  //
  // `originY` is computed for the rows the plan *uses*, not for the grid's full
  // capacity, and that is what the old version got wrong: it filled from the top
  // of a full-height grid, so four copies on a 2x3 sheet sat high with a dead
  // band underneath. `usedH` counts `filledRows` and nothing else.
  //
  // `originX` is the other matter, and it is deliberately *not* the same. A
  // partial row — the last two photos of a five-column A4 sheet — starts at the
  // left margin beside the rows above it rather than being centred under them.
  // That is not an oversight left over from the bug; it is what a grid is. The
  // sheet is meant to be physically cut, and a cut is straight: if the fifth
  // column's worth of the last row slid inwards, no two rows shared a column
  // pitch, and the operator's ruler and the guillotine both stop lining up with
  // the printed marks. Centring a partial row buys tidiness at the cost of the
  // one property the artefact exists for.
  //
  // The `filledRows` field is what a caller uses to tell the two cases apart —
  // it is `ceil(count / columns)`, so it is smaller than `rows` exactly when the
  // last row is partial.
  const filledRows = columns > 0 && count > 0 ? Math.ceil(count / columns) : 0
  const usedW = columns > 0 ? columns * photoW + (columns - 1) * gapPx : 0
  const usedH = filledRows > 0 ? filledRows * photoH + (filledRows - 1) * gapPx : 0
  const originX = (sheetWidthPx - usedW) / 2
  const originY = (sheetHeightPx - usedH) / 2

  const photos: SheetPhoto[] = []
  for (let i = 0; i < count; i += 1) {
    const column = i % columns
    const row = Math.floor(i / columns)
    photos.push({
      x: originX + column * (photoW + gapPx),
      y: originY + row * (photoH + gapPx),
      width: photoW,
      height: photoH,
    })
  }

  return {
    sheet,
    sheetWidthPx,
    sheetHeightPx,
    dpi,
    columns,
    rows,
    filledRows,
    count,
    gapPx,
    landscape,
    photos,
  }
}

/** How many copies of `spec` a sheet holds, whatever the stepper asks for. */
export function sheetCapacity(
  spec: PassportSpec,
  sheet: SheetName,
  dpi: number = spec.dpi,
  landscape = false,
): number {
  return planSheet(spec, sheet, Number.MAX_SAFE_INTEGER, dpi, landscape).count
}
