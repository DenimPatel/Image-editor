import { describe, expect, it } from 'vitest'
import { orphansRow, rowSizes, rowsFor } from './segmentRows'

/**
 * Every width below was measured off the running app in a real browser, not
 * invented. jsdom has no layout — `clientWidth` is 0 for every element — so these
 * numbers are what makes the arithmetic here testable at all, and they are the
 * numbers that reproduce the two orphans the audit found.
 *
 * `1280x900`, Export, default appearance: a 327px control whose SIZE options are
 * No resize 83, Width 60, Height 64, Long edge 90, Percent 71. Greedy packing
 * takes 83 + 60 + 64 + 90 + 2 gaps = 301 ≤ 323 on one line and leaves `Percent`
 * alone on the second.
 *
 * `390x844`, Background, Roomy + Extra large: 121 / 75 / 90 / 71 in 358px, which
 * greedy packs as three and one.
 */
const EXPORT_SIZE = { items: [83, 60, 64, 90, 71], gap: 2, available: 323 }
const BACKGROUND_MODE = { items: [121, 75, 90, 71], gap: 2, available: 354 }

/** The rows a wrapping flex line produces, so the two answers can be compared. */
function greedy(items: number[], gap: number, available: number): number[] {
  const rows: number[] = []
  let from = 0
  while (from < items.length) {
    let width = 0
    let to = from
    while (to < items.length) {
      const next = width + (to > from ? gap : 0) + items[to]
      if (next > available) break
      width = next
      to += 1
    }
    rows.push(Math.max(to - from, 1))
    from += Math.max(to - from, 1)
  }
  return rows
}

describe('rowsFor', () => {
  it('leaves a control that fits on one row alone, so nine controls do not change', () => {
    // Export's FORMAT row, measured: JPEG 58, PNG 52, WebP 60, PDF 49.
    expect(rowsFor({ items: [58, 52, 60, 49], gap: 2, available: 323 })).toEqual([4])
    expect(rowsFor({ items: [54, 152], gap: 2, available: 323 })).toEqual([2])
  })

  it('is 3 + 2 at 1280x900 for the SIZE row the audit found 4 + 1 in', () => {
    expect(greedy(EXPORT_SIZE.items, EXPORT_SIZE.gap, EXPORT_SIZE.available)).toEqual([4, 1])
    expect(rowsFor(EXPORT_SIZE)).toEqual([3, 2])
  })

  it('is 2 + 2 at 390px for the Background row the audit found 3 + 1 in', () => {
    expect(greedy(BACKGROUND_MODE.items, BACKGROUND_MODE.gap, BACKGROUND_MODE.available)).toEqual([
      3, 1,
    ])
    expect(rowsFor(BACKGROUND_MODE)).toEqual([2, 2])
  })

  it('gives six options three and three where greedy would give four and two', () => {
    // Frame styles are a chip row, not a segmented control, but the arithmetic is
    // the same and the shape is the one worth asserting.
    const items = [62, 61, 87, 94, 93, 125]
    const available = 320
    expect(greedy(items, 2, available)).toEqual([4, 2])
    expect(rowsFor({ items, gap: 2, available })).toEqual([3, 3])
  })

  it('prefers two even rows over two uneven ones when both fit', () => {
    // A skewed set is the case an equal-width grid cannot serve: `Long edge` needs
    // 90px, so a grid whose columns must each clear it is not the same answer as
    // packing the real widths and rebalancing them.
    const items = [100, 40, 40, 40]
    expect(greedy(items, 2, 200)).toEqual([3, 1])
    expect(rowsFor({ items, gap: 2, available: 200 })).toEqual([2, 2])
  })

  it('does not spend a row on balance when the only even split needs one more', () => {
    // A 110px option followed by four 30px ones in 130px: greedy puts the wide one
    // on its own line and the four narrow ones on the next, which is two rows and
    // no trailing orphan. A rebalanced 1 + 2 + 2 would be three rows of a control
    // that only needed two — tidier, and taller, which is the wrong trade.
    const items = [110, 30, 30, 30, 30]
    expect(greedy(items, 2, 130)).toEqual([1, 4])
    expect(rowsFor({ items, gap: 2, available: 130 })).toEqual([1, 4])
  })

  it('keeps the two options of a narrow control side by side', () => {
    // Measured, `Background`'s Model quality row: 58 and 114 in 178px minus padding.
    expect(rowsFor({ items: [58, 114], gap: 2, available: 174 })).toEqual([2])
  })

  it('accepts an uneven split when that is the only shape there is', () => {
    // Three options over two rows is one and two however you slice it. The single
    // one is put first rather than last, because a trailing row of one is the shape
    // this file exists to remove and a leading one is not: `Left` on its own line
    // reads as a group, `Left | Centre | Right` reading down to a lone `Right` reads
    // as the control running out of room. Said here so the limitation is a stated
    // decision rather than an accident nobody checked for.
    expect(rowsFor({ items: [45, 70, 50], gap: 2, available: 130 })).toEqual([1, 2])
  })

  it('never orphans when an even split is available at the same row count', () => {
    for (let available = 60; available <= 900; available += 5) {
      for (const items of [
        [60, 60, 60],
        [60, 60, 60, 60],
        [60, 60, 60, 60, 60],
        [60, 70, 80, 90],
        [50, 60, 70, 80, 90, 100],
        [40, 50, 60, 70, 80, 90, 100],
        [90, 40, 90, 40, 90, 40],
        [121, 75, 90, 71],
        [83, 60, 64, 90, 71],
      ]) {
        const widths = { items, gap: 2, available }
        const rows = rowsFor(widths)
        const label = `${items.join(',')} at ${available}`
        expect(
          rows.reduce((a, b) => a + b, 0),
          label,
        ).toBe(items.length)
        // No more rows than a flex line would use, or the control got taller for
        // the sake of looking tidier.
        const fewest = greedy(items, 2, available).length
        expect(rows.length, label).toBeLessThanOrEqual(fewest)
        // An orphan survives only when nothing even fitted at the same row count.
        // Three 60px options in 60px get one per row whatever you do: that is a
        // control with no room, not one with an orphan, and the assertion has to
        // know the difference or it forbids the honest answer.
        const fitsVector = (sizes: number[]) => {
          let from = 0
          for (const size of sizes) {
            let width = 0
            for (let i = from; i < from + size; i++) width += items[i] + (i > from ? 2 : 0)
            if (width > available) return false
            from += size
          }
          return true
        }
        const even = Math.floor(items.length / fewest)
        const remainder = items.length % fewest
        const evenCandidates =
          remainder === 0
            ? [Array.from({ length: fewest }, () => even)]
            : [
                Array.from({ length: fewest }, (_, row) => (row < remainder ? even + 1 : even)),
                Array.from({ length: fewest }, (_, row) =>
                  row >= fewest - remainder ? even + 1 : even,
                ),
              ]
        if (even >= 2 && evenCandidates.some(fitsVector)) {
          expect(rows[rows.length - 1], `${label} should not end on an orphan`).not.toBe(1)
        }
      }
    }
  })

  it('keeps a label wider than the control rather than dropping it', () => {
    // `.segmentedButton` is `white-space: nowrap` and this repository has already
    // decided a label is never cut to fit, so overflowing is the answer. Losing an
    // option would not be.
    const rows = rowsFor({ items: [400, 60, 60], gap: 2, available: 200 })
    expect(rows.reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('uses the fewest rows it can', () => {
    for (let available = 80; available <= 800; available += 10) {
      for (const items of [
        [60, 70, 80, 90, 100],
        [40, 40, 40, 40, 40, 40],
        [110, 30, 30, 30, 30],
      ]) {
        const rows = rowsFor({ items, gap: 2, available })
        const minimum = greedy(items, 2, available).length
        expect(rows.length, `${items.join(',')} at ${available}`).toBeLessThanOrEqual(minimum)
      }
    }
  })

  it('is well defined for no options and for one', () => {
    expect(rowsFor({ items: [], gap: 2, available: 100 })).toEqual([])
    expect(rowsFor({ items: [80], gap: 2, available: 10 })).toEqual([1])
  })
})

describe('rowSizes and orphansRow', () => {
  it('describe the equal-column layout this replaced', () => {
    expect(rowSizes(5, 4)).toEqual([4, 1])
    expect(rowSizes(4, 3)).toEqual([3, 1])
    expect(rowSizes(5, 3)).toEqual([3, 2])
    expect(rowSizes(3, 3)).toEqual([3])
    expect(rowSizes(0, 0)).toEqual([])
  })

  it('name the two shapes this file exists to refuse', () => {
    expect(orphansRow(5, 4)).toBe(true)
    expect(orphansRow(4, 3)).toBe(true)
    expect(orphansRow(5, 3)).toBe(false)
    expect(orphansRow(3, 3)).toBe(false)
  })
})
