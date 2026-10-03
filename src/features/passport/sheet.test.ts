import { describe, expect, it } from 'vitest'
import { mmToPx } from '../../lib/crop/geometry'
import { PRINT_SIZES, printSizeById } from '../../lib/crop/presets'
import { getSpec } from './specs'
import {
  catalogueSheetSizes,
  planSheet,
  sheetCapacity,
  SHEET_SIZES,
  SHEET_SIZES_MM,
  sheetOptions,
  sheetSizeMm,
} from './sheet'
import type { SheetLayout, SheetPhoto } from './sheet'

const spec = getSpec('uk-35x45')
if (!spec) throw new Error('missing uk-35x45')

const UK = spec

function overlaps(a: SheetPhoto, b: SheetPhoto): boolean {
  const epsilon = 1e-6
  return (
    a.x + a.width > b.x + epsilon &&
    b.x + b.width > a.x + epsilon &&
    a.y + a.height > b.y + epsilon &&
    b.y + b.height > a.y + epsilon
  )
}

function expectNoOverlaps(layout: SheetLayout): void {
  for (let i = 0; i < layout.photos.length; i += 1) {
    for (let j = i + 1; j < layout.photos.length; j += 1) {
      expect(overlaps(layout.photos[i], layout.photos[j])).toBe(false)
    }
  }
}

describe('SHEET_SIZES_MM', () => {
  it('uses the correct inch and A4 sizes', () => {
    expect(SHEET_SIZES_MM['4x6']).toEqual({ widthMm: 101.6, heightMm: 152.4 })
    expect(SHEET_SIZES_MM['5x7']).toEqual({ widthMm: 127, heightMm: 177.8 })
    expect(SHEET_SIZES_MM.a4).toEqual({ widthMm: 210, heightMm: 297 })
  })

  it('has one catalogue that the panel options and the millimetres both come from', () => {
    expect(sheetOptions()).toEqual([
      { value: '4x6', label: '4 × 6 in' },
      { value: '5x7', label: '5 × 7 in' },
      { value: 'a4', label: 'A4' },
    ])
    for (const size of SHEET_SIZES) {
      expect(SHEET_SIZES_MM[size.name]).toEqual({ widthMm: size.widthMm, heightMm: size.heightMm })
    }
  })

  it('labels every sheet exactly as the print catalogue labels it', () => {
    // The assertion the previous test could not make. `SHEET_LABELS` was a
    // second table whose labels were deliberately spelled differently from the
    // print table's (`4×6 in` vs `4 × 6 in`), which is exactly the shape a drift
    // takes: two sources, one of them wrong, and nothing but a promise that
    // somebody would remember to check. The table is gone, so this is an
    // identity rather than an expectation — it can only fail if a label is typed
    // out again.
    expect(SHEET_SIZES.map((s) => s.label)).toEqual(
      PRINT_SIZES.filter((s) => s.sheet).map((s) => s.label),
    )
    // And the names this file offers are genuinely sheets in that catalogue,
    // so a corrected print size cannot leave the sheet printing the old one.
    expect(SHEET_SIZES.map((s) => s.name).sort()).toEqual(
      [...catalogueSheetSizes()].sort().slice(0, SHEET_SIZES.length),
    )
    for (const size of SHEET_SIZES) {
      const catalogue = printSizeById(size.name)
      expect(catalogue.sheet, size.name).toBe(true)
      expect(size.widthMm, size.name).toBe(catalogue.widthMm)
      expect(size.heightMm, size.name).toBe(catalogue.heightMm)
    }
  })

  it('transposes the sheet for landscape', () => {
    expect(sheetSizeMm('4x6', false)).toEqual({ widthMm: 101.6, heightMm: 152.4 })
    expect(sheetSizeMm('4x6', true)).toEqual({ widthMm: 152.4, heightMm: 101.6 })
  })
})

describe('planSheet', () => {
  it('fits 6 copies of 35x45 mm on 4x6 in at 300 DPI with 2 mm gaps', () => {
    const layout = planSheet(UK, '4x6', 6, 300)

    expect(layout.count).toBe(6)
    expect(layout.photos).toHaveLength(6)
    expect(layout.columns * layout.rows).toBe(6)
    expect(layout.gapPx).toBeCloseTo(mmToPx(2, 300), 6)
    expectNoOverlaps(layout)
  })

  it('caps 7 copies at the 6 that actually fit', () => {
    const layout = planSheet(UK, '4x6', 7, 300)

    expect(layout.count).toBe(6)
    expect(layout.photos).toHaveLength(6)
    expectNoOverlaps(layout)
  })

  it('never returns more photos than requested', () => {
    for (const copies of [0, 1, 2, 5, 20]) {
      for (const sheet of ['4x6', '5x7', 'a4'] as const) {
        const layout = planSheet(UK, sheet, copies)
        expect(layout.photos.length).toBeLessThanOrEqual(copies)
        expect(layout.count).toBe(layout.photos.length)
      }
    }
  })

  it('defaults the DPI to the spec DPI and sizes photos in millimetres', () => {
    const layout = planSheet(UK, '5x7', 4)

    expect(layout.dpi).toBe(UK.dpi)
    for (const photo of layout.photos) {
      expect(photo.width).toBeCloseTo(mmToPx(UK.widthMm, UK.dpi), 6)
      expect(photo.height).toBeCloseTo(mmToPx(UK.heightMm, UK.dpi), 6)
    }
  })

  it('lays out every photo inside the sheet without overlapping', () => {
    for (const sheet of ['4x6', '5x7', 'a4'] as const) {
      const layout = planSheet(UK, sheet, 100, 300)
      expectNoOverlaps(layout)
      for (const photo of layout.photos) {
        expect(photo.x).toBeGreaterThanOrEqual(0)
        expect(photo.y).toBeGreaterThanOrEqual(0)
        expect(photo.x + photo.width).toBeLessThanOrEqual(layout.sheetWidthPx + 1e-6)
        expect(photo.y + photo.height).toBeLessThanOrEqual(layout.sheetHeightPx + 1e-6)
      }
    }
  })

  // D5-F12c: `originY` was computed for the full-capacity grid and only `count`
  // cells were filled from the top, so a partial fill left a gap underneath.
  it('centres a partial fill on the rows it uses', () => {
    const full = planSheet(UK, '4x6', 100, 300)
    const layout = planSheet(UK, '4x6', 4, 300)

    expect(layout.count).toBe(4)
    expect(layout.filledRows).toBe(2)
    expect(layout.rows).toBe(full.rows)

    const top = layout.photos[0].y
    const bottom = layout.photos[layout.photos.length - 1].y + layout.photos[0].height
    expect((top + bottom) / 2).toBeCloseTo(layout.sheetHeightPx / 2, 6)
    expect(top).toBeGreaterThan(full.photos[0].y)
  })

  it('left-aligns a partial last row, because a cut is straight', () => {
    // The counterpart to the centring above, and the decision the docstring used
    // to get wrong. Seven 35x45 photos on A4 is five across and two on a second
    // row; those two sit at the left margin beside the row above, not centred
    // under it. Centring would put the fifth column's worth of the last row
    // somewhere else entirely, so no two rows would share a column pitch and a
    // ruler laid across the printed marks would stop lining up — which is the
    // one property a sheet meant to be physically cut exists to have.
    const layout = planSheet(UK, 'a4', 7, 300)

    expect(layout.count).toBe(7)
    expect(layout.columns).toBe(5)
    expect(layout.filledRows).toBe(2)
    // Two rows used out of six, and the used block is what is centred.
    expect(layout.filledRows).toBeLessThan(layout.rows)

    const firstRow = layout.photos.slice(0, layout.columns)
    const lastRow = layout.photos.slice(layout.columns)
    expect(firstRow).toHaveLength(5)
    expect(lastRow).toHaveLength(2)
    // Same column pitch, exactly: photo 6 is directly under photo 1, photo 7 under
    // photo 2. Filling restarts at column 0 rather than at the first empty cell
    // of the previous row, which is what a wrapping grid does and what makes
    // the column pitch uniform.
    for (const [i, photo] of lastRow.entries()) {
      expect(photo.x).toBeCloseTo(firstRow[i].x, 6)
      expect(photo.y).toBeGreaterThan(firstRow[0].y)
    }
    // Every photo shares one left margin and one pitch, so the whole plan can be
    // cut in three straight passes.
    const pitch = firstRow[1].x - firstRow[0].x
    for (const photo of layout.photos) {
      expect(photo.x - firstRow[0].x).toBeCloseTo(
        Math.round((photo.x - firstRow[0].x) / pitch) * pitch,
        6,
      )
    }
  })

  it('centres a single photo vertically', () => {
    const layout = planSheet(UK, 'a4', 1, 300)
    const photo = layout.photos[0]

    expect(layout.filledRows).toBe(1)
    expect(photo.y + photo.height / 2).toBeCloseTo(layout.sheetHeightPx / 2, 6)
  })

  it('has no photos and no rows to centre for zero copies', () => {
    const layout = planSheet(UK, '4x6', 0, 300)

    expect(layout.photos).toHaveLength(0)
    expect(layout.filledRows).toBe(0)
  })

  describe('landscape (D5-F15)', () => {
    it('transposes both the sheet and the photo', () => {
      const portraitLayout = planSheet(UK, '4x6', 6, 300)
      const landscapeLayout = planSheet(UK, '4x6', 6, 300, true)

      expect(landscapeLayout.sheetWidthPx).toBeCloseTo(portraitLayout.sheetHeightPx, 6)
      expect(landscapeLayout.sheetHeightPx).toBeCloseTo(portraitLayout.sheetWidthPx, 6)
      expect(landscapeLayout.photos[0].width).toBeCloseTo(portraitLayout.photos[0].height, 6)
      expect(landscapeLayout.photos[0].height).toBeCloseTo(portraitLayout.photos[0].width, 6)
      expect(landscapeLayout.landscape).toBe(true)
    })

    it('still fills the landscape sheet with the requested copies', () => {
      const layout = planSheet(UK, '4x6', 4, 300, true)

      expect(layout.count).toBe(4)
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(4)
      expectNoOverlaps(layout)
    })
  })

  describe('sheetCapacity', () => {
    it('reports what the sheet actually holds, not what the stepper allows', () => {
      // The stepper offered `max={24}` while a us-2x2 print on 4×6 holds 2.
      const us = getSpec('us-2x2')
      if (!us) throw new Error('missing us-2x2')

      expect(sheetCapacity(us, '4x6')).toBe(2)
      expect(sheetCapacity(us, '4x6')).toBe(planSheet(us, '4x6', 24).count)
      expect(sheetCapacity(UK, '4x6')).toBe(6)
      expect(sheetCapacity(UK, 'a4')).toBeGreaterThan(6)
    })
  })
})
