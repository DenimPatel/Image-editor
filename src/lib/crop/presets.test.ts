import { describe, expect, it } from 'vitest'
import { parseRatio } from '../format'
import { SHEET_SIZES, catalogueSheetSizes, isSheetName } from '../../features/passport/sheet'
import { mmToPx } from './geometry'
import {
  ASPECT_PRESETS,
  PLATFORM_GROUPS,
  PRINT_SIZES,
  aspectForCustomRatio,
  findPresetById,
  isRatio,
  platformShapeRows,
  printSizeById,
  printSizeMm,
  printSizePx,
  ratioLabel,
  type PrintSizeId,
} from './presets'

describe('ASPECT_PRESETS', () => {
  it('contains the core ratios with correct numeric values', () => {
    const aspects = new Map(ASPECT_PRESETS.map((preset) => [preset.id, preset.aspect]))
    expect(aspects.get('1:1')).toBeCloseTo(1, 9)
    expect(aspects.get('4:5')).toBeCloseTo(4 / 5, 9)
    expect(aspects.get('3:2')).toBeCloseTo(1.5, 9)
    expect(aspects.get('16:9')).toBeCloseTo(16 / 9, 9)
    expect(aspects.get('9:16')).toBeCloseTo(9 / 16, 9)
    expect(aspects.get('2:3')).toBeCloseTo(2 / 3, 9)
    expect(aspects.get('5:7')).toBeCloseTo(5 / 7, 9)
    expect(aspects.get('4:3')).toBeCloseTo(4 / 3, 9)
    expect(aspects.get('free')).toBeNull()
  })

  it('offers one chip for "no ratio", not two, and never calls it Original', () => {
    // `Original` and `Free` both meant "do not lock the box", and both were in
    // the row. They are one chip now, and it says what it does. The word
    // `Original` was the third thing in the app to carry it (Export's resize
    // mode and the compare badge are the other two), so the check is that this
    // table does not add a fourth.
    const noRatio = ASPECT_PRESETS.filter((preset) => preset.aspect === null)
    expect(noRatio).toHaveLength(1)
    expect(noRatio[0].id).toBe('free')
    expect(noRatio[0].label).toBe('Free')
    const labels = ASPECT_PRESETS.map((preset) => preset.label)
    expect(labels).not.toContain('Original')
    // And no two chips in the row say the same thing, so the row can be read
    // as a list rather than scanned.
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('PLATFORM_GROUPS', () => {
  it('has non-empty groups with positive aspects', () => {
    expect(PLATFORM_GROUPS.length).toBeGreaterThan(0)
    for (const group of PLATFORM_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0)
      expect(group.presets.length).toBeGreaterThan(0)
      for (const preset of group.presets) {
        expect(preset.aspect).not.toBeNull()
        expect(preset.aspect as number).toBeGreaterThan(0)
      }
    }
  })

  it('has twenty-two labels and no two of them alike', () => {
    // The panel used to stack seven chips reading "Square 1:1", four reading
    // "Portrait 4:5" and three reading "Story 9:16" with nothing on screen to
    // say which platform any of them belonged to. Qualifying every label with
    // its platform is what makes a chip nameable out of a screenshot; the shape
    // on it is the fast path and this is the authority.
    const labels = PLATFORM_GROUPS.flatMap((group) => group.presets.map((p) => p.label))
    expect(labels).toHaveLength(22)
    expect(new Set(labels).size).toBe(22)
    for (const group of PLATFORM_GROUPS) {
      for (const preset of group.presets) {
        expect(preset.label, preset.id).toContain(group.label)
      }
    }
  })

  it('states an orientation once, in the ratio, rather than twice', () => {
    // "Portrait 4:5" said portrait twice and "Landscape 16:9" said it twice. The
    // shape and the ratio between them settle it, so the words are gone.
    for (const group of PLATFORM_GROUPS) {
      for (const preset of group.presets) {
        expect(preset.label, preset.id).not.toMatch(/portrait|landscape|square/i)
      }
    }
  })

  it('keeps the format word where it is a format, and it is what opens a safe area', () => {
    // "Story", "Shorts", "Video" and "Pin" are not the ratio: they say which
    // placement the crop is for, and `safeAreaFor(preset.id)` reads them to open
    // an overlay. Five 9:16 presets that quietly set three different safe areas
    // is the reason they stayed.
    const byId = new Map(
      PLATFORM_GROUPS.flatMap((group) => group.presets).map((preset) => [preset.id, preset.label]),
    )
    expect(byId.get('instagram-story')).toBe('Instagram Story 9:16')
    expect(byId.get('tiktok-video')).toBe('TikTok Video 9:16')
    expect(byId.get('youtube-shorts')).toBe('YouTube Shorts 9:16')
    expect(byId.get('pinterest-pin')).toBe('Pinterest Pin 2:3')
  })
})

describe('platformShapeRows: the block grouped by shape instead of by platform', () => {
  it('has one row per ratio, in the order the catalogue first mentions it', () => {
    expect(platformShapeRows().map((row) => row.label)).toEqual([
      '1:1',
      '4:5',
      '1.91:1',
      '9:16',
      '16:9',
      '2:3',
    ])
  })

  it('holds every one of the twenty-two presets, exactly once, in catalogue order', () => {
    const rows = platformShapeRows()
    const flat = rows.flatMap((row) => row.presets)
    expect(flat).toHaveLength(22)
    const catalogue = PLATFORM_GROUPS.flatMap((group) => group.presets)
    // Regrouping reorders, so what has to hold is the set: a collapse that loses
    // a chip is a regression a user feels, not a refactor.
    expect(new Set(flat.map((preset) => preset.id))).toEqual(
      new Set(catalogue.map((preset) => preset.id)),
    )
    // Inside a row the catalogue order is kept, so the block still reads the way
    // it did when it was seven headed groups.
    for (const row of rows) {
      const order = catalogue
        .map((preset) => preset.id)
        .filter((id) => row.presets.some((preset) => preset.id === id))
      expect(
        row.presets.map((preset) => preset.id),
        row.label,
      ).toEqual(order)
    }
  })

  it('puts only presets of that row’s own ratio in the row', () => {
    for (const row of platformShapeRows()) {
      expect(row.presets.length).toBeGreaterThan(0)
      for (const preset of row.presets) {
        expect(isRatio(preset.aspect, row.aspect), preset.id).toBe(true)
      }
    }
    // The seven "Square 1:1" chips are the case the collapse is for: one row of
    // seven, rather than seven rows of one.
    expect(platformShapeRows().find((row) => row.label === '1:1')?.presets).toHaveLength(7)
  })

  it('calls each row the same string the ratio is called everywhere else', () => {
    for (const row of platformShapeRows()) {
      expect(row.label).toBe(ratioLabel(row.aspect))
    }
  })
})

describe('ratioLabel and isRatio are one vocabulary, not four', () => {
  it('names every ratio the app offers', () => {
    expect(ratioLabel(1)).toBe('1:1')
    expect(ratioLabel(4 / 5)).toBe('4:5')
    expect(ratioLabel(3 / 2)).toBe('3:2')
    expect(ratioLabel(16 / 9)).toBe('16:9')
    expect(ratioLabel(9 / 16)).toBe('9:16')
    expect(ratioLabel(2 / 3)).toBe('2:3')
    expect(ratioLabel(5 / 7)).toBe('5:7')
    expect(ratioLabel(4 / 3)).toBe('4:3')
    // A print size, which is a ratio nobody has a name for.
    expect(ratioLabel(101.6 / 152.4)).toBe('2:3')
    expect(ratioLabel(1.91)).toBe('1.91:1')
    expect(ratioLabel(2.5)).toBe('2.50:1')
  })

  it('refuses to name a ratio that is not one', () => {
    expect(ratioLabel(0)).toBe('—')
    expect(ratioLabel(-2)).toBe('—')
    expect(ratioLabel(Number.NaN)).toBe('—')
  })

  it('measures a whole-pixel crop as the ratio it was asked for', () => {
    // `cropPixelReadout` measures in integer source pixels, so a 16:9 lock on a
    // 3000×2000 photo comes back as 3000/1688 rather than 16/9. Comparing
    // exactly would light no chip at all for most photographs.
    expect(isRatio(3000 / 1688, 16 / 9)).toBe(true)
    expect(isRatio(101.6 / 152.4, 2 / 3)).toBe(true)
    expect(isRatio(1.5, 16 / 9)).toBe(false)
    expect(isRatio(1.5, null)).toBe(false)
  })
})

describe('printSizePx', () => {
  it('converts a 4x6 print at 300 DPI', () => {
    const six = PRINT_SIZES.find((size) => size.id === '4x6')
    expect(six).toBeDefined()
    expect(printSizePx(six!, 300)).toEqual({
      width: Math.round(mmToPx(101.6, 300)),
      height: Math.round(mmToPx(152.4, 300)),
    })
  })
})

describe('the print catalogue is the only source of millimetres', () => {
  it('has unique ids and positive dimensions everywhere', () => {
    const ids = PRINT_SIZES.map((size) => size.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const size of PRINT_SIZES) {
      expect(size.widthMm).toBeGreaterThan(0)
      expect(size.heightMm).toBeGreaterThan(0)
      expect(size.label.length).toBeGreaterThan(0)
    }
  })

  it('offers 8x10 and A3 to the crop tool but not to the sheet', () => {
    const ids = PRINT_SIZES.map((size) => size.id)
    expect(ids).toContain('8x10')
    expect(ids).toContain('a3')
    // A5 is not in either list, so no panel can offer it.
    expect(ids).not.toContain('a5')
  })

  it('agrees with the passport sheet on every sheet size it offers', () => {
    // The sheet used to re-type the same three millimetre pairs, so a corrected
    // print size could have left the sheet printing the old dimensions.
    expect(catalogueSheetSizes()).toEqual(SHEET_SIZES.map((size) => size.name))
    for (const size of SHEET_SIZES) {
      const print = printSizeById(size.name)
      expect(print.sheet).toBe(true)
      expect(size.widthMm).toBe(print.widthMm)
      expect(size.heightMm).toBe(print.heightMm)
    }
    for (const size of PRINT_SIZES) {
      if (!size.sheet) expect(isSheetName(size.id)).toBe(false)
    }
  })

  it('spells a size one way, with the app’s multiplication sign', () => {
    // The sheet picker carried a tighter `4×6 in` beside the crop panel's
    // `4 × 6 in` for the same sheet of paper, on the argument that a
    // fixed-width control is worth a character. That table is gone — `sheet.ts`
    // reads its labels from here — so this table is the only place a size is
    // written and there is nothing for a second spelling to disagree with.
    const expected: Record<string, string> = {
      '4x6': '4 × 6 in',
      '5x7': '5 × 7 in',
      '8x10': '8 × 10 in',
      a4: 'A4',
      a3: 'A3',
    }
    for (const [id, label] of Object.entries(expected)) {
      expect(printSizeById(id as PrintSizeId).label, id).toBe(label)
    }
    for (const size of PRINT_SIZES) {
      expect(size.label).not.toMatch(/[0-9]x[0-9]/)
    }
    // The millimetres, the crop readout and the geometry all join the same
    // multiplication sign: `1600 × 900 px`, `101.6 × 152.4 mm`.
    expect(printSizeMm(printSizeById('4x6'))).toBe('101.6 × 152.4 mm')
    expect(printSizeMm(printSizeById('a4'))).toBe('210 × 297 mm')
    expect(printSizeMm(printSizeById('5x7'))).toBe('127 × 177.8 mm')
    expect(printSizeMm(printSizeById('8x10'))).toBe('203.2 × 254 mm')
    expect(printSizeMm(printSizeById('a3'))).toBe('297 × 420 mm')
  })
})

describe('findPresetById', () => {
  it('finds standard and platform presets', () => {
    expect(findPresetById('3:2')?.aspect).toBeCloseTo(1.5, 9)
    expect(findPresetById('instagram-story')?.aspect).toBeCloseTo(9 / 16, 9)
    expect(findPresetById('does-not-exist')).toBeUndefined()
  })
})

describe('aspectForCustomRatio', () => {
  it('parses valid ratios and rejects invalid ones', () => {
    expect(aspectForCustomRatio('3:2')).toBe(1.5)
    expect(aspectForCustomRatio(' 16 : 9 ')).toBeCloseTo(16 / 9, 9)
    expect(aspectForCustomRatio('abc')).toBeNull()
    expect(aspectForCustomRatio('0:0')).toBeNull()
    expect(aspectForCustomRatio('')).toBeNull()
  })

  it('reuses parseRatio semantics', () => {
    const parsed = parseRatio('5:7')
    expect(aspectForCustomRatio('5:7')).toBeCloseTo((parsed?.width ?? 0) / (parsed?.height ?? 1), 9)
  })
})
