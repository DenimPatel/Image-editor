/**
 * How a segmented control breaks into rows, and why a wrapping flex row is not
 * allowed to decide.
 *
 * The defect this exists for. `Export`'s SIZE row is five options — No resize,
 * Width, Height, Long edge, Percent — in a 327px control, and a `flex-wrap: wrap`
 * row packs greedily: four on the first line and `Percent` alone on the second.
 * `Background`'s mode row does the same at 390px with `Image` alone, at the
 * *primary* desktop width in the first case. A control whose last option is a
 * full-width bar under four narrower ones does not read as a control that finished
 * laying itself out; it reads as a control that ran out of room, which is a much
 * worse thing to say about a product at the width most people use.
 *
 * So the rows are chosen here instead of by the browser, and the rule is small:
 * **as few rows as possible, and as even as possible.** Four options in a box that
 * fits three becomes 2 + 2 rather than 3 + 1; five in a box that fits four becomes
 * 3 + 2 rather than 4 + 1; five that fit entirely stay on one row and the caller
 * leaves the DOM flat, so the nine segmented controls that never wrap look exactly
 * as they did.
 *
 * Why rows and not equal columns. An equal-width grid is the other way to stop the
 * orphan, and it was the first thing tried here: give every button
 * `(width - gaps) / columns`. It has to clear the *widest* label or the layout
 * orphans again one row down, and that test is stricter than the layout it replaces.
 * Measured, `Background`'s Model quality row is 58px and 114px in a 178px control —
 * the two sit side by side today — and equal columns do not fit there, so the grid
 * answer was two full-width buttons stacked, which is worse than what it replaced.
 * Rows partition the same items greedily and then rebalance, so a skewed set keeps
 * sharing its rows.
 *
 * Three options cannot be even across two rows — 2 + 1 is the only shape — so the
 * evenness rule is a preference, not a guarantee, and `rowsFor` says so rather than
 * pretending. There is no arrangement of three items over two rows with no orphan,
 * and a control that fits on one row is not a defect at all.
 */

/** One control's measured geometry, in CSS pixels. */
export type SegmentedWidths = {
  /** Each button's own natural width: label + horizontal padding. */
  items: number[]
  /** `column-gap` between buttons. */
  gap: number
  /**
   * The width the buttons share. The control's own padding is already out of it,
   * because `clientWidth` minus the padding is what the buttons can use — and
   * subtracting it twice is how a model quality row became two stacked bars.
   */
  available: number
}

/** The sum of `items[from..to)`, plus the gaps between them. */
function rowWidth(items: number[], from: number, to: number, gap: number): number {
  let total = gap * Math.max(to - from - 1, 0)
  for (let index = from; index < to; index++) total += items[index] ?? 0
  return total
}

/**
 * The most even size vectors of `rows` parts summing to `n`, or `null` when the
 * parts would have to be empty.
 *
 * Two candidates rather than all of them: the longer parts at the front, and the
 * longer parts at the back. Which end they go on matters when the widths are
 * skewed — a long first option wants a short row under it — and two is enough to
 * find the answer for every set of options this control is given.
 */
function evenSizes(n: number, rows: number): number[][] | null {
  const base = Math.floor(n / rows)
  const extra = n % rows
  if (base === 0) return null
  const long = base + 1
  const short = base
  const front: number[] = []
  const back: number[] = []
  for (let row = 0; row < rows; row++) {
    front.push(row < extra ? long : short)
    back.push(row >= rows - extra ? long : short)
  }
  const candidates = extra === 0 || front.join() === back.join() ? [front] : [front, back]
  return candidates.some((sizes) => sizes.some((size) => size <= 0)) ? null : candidates
}

/** Whether one size vector fits: no row's own width exceeds what the row has. */
function vectorFits(items: number[], sizes: number[], gap: number, available: number): boolean {
  let from = 0
  for (const size of sizes) {
    if (rowWidth(items, from, from + size, gap) > available) return false
    from += size
  }
  return from === items.length
}

/**
 * How many options go on each row, or `[items.length]` when they all fit on one.
 *
 * The order of the two rules is the whole argument, and it is deliberate:
 *
 *  1. Never use more rows than the control has to use. A partition that evens out
 *     an orphan by adding a row is a worse answer than the orphan, because it
 *     makes the control taller to look tidier.
 *  2. Among the partitions that use the fewest rows, prefer the most even. This is
 *     the rule that turns 4 + 1 into 3 + 2 and 3 + 1 into 2 + 2.
 *  3. If no even partition fits at that row count, take the greedy one unless it
 *     orphans, and only then spend an extra row on balance.
 *
 * Step 3 is what stops a skewed set being made worse. Measured, `Background`'s
 * Model quality row is 58px and 114px in a 178px control and the two sit side by
 * side today; an even-column grid cannot do that, and neither can a rebalanced
 * one, because no 2 + 1 split of two items exists. Greedy is right there and the
 * answer is greedy.
 *
 * A single option wider than `available` is left in a row of its own rather than
 * being dropped: `.segmentedButton` is `white-space: nowrap` and this repository
 * has already decided that a label is never cut to fit, so overflowing is the
 * documented answer and a control that silently loses an option is not.
 */
export function rowsFor({ items, gap, available }: SegmentedWidths): number[] {
  const n = items.length
  if (n === 0) return []

  if (rowWidth(items, 0, n, gap) <= available) return [n]

  const packed = greedySizes(items, gap, available)

  // Never more rows than a flex line would use: a control made taller to look
  // tidier is worse than the thing it was tidied for. Within that, the first
  // partition that fits and does not end on a row of one wins, and equal-sized
  // rows are offered before the greedy one so that, at the same row count, the
  // balanced answer is the one taken.
  for (let rows = 2; rows <= packed.length; rows++) {
    for (const sizes of evenSizes(n, rows) ?? []) {
      if (sizes[sizes.length - 1] >= 2 && vectorFits(items, sizes, gap, available)) return sizes
    }
    if (rows === packed.length && packed[packed.length - 1] >= 2) return packed
  }
  return packed
}

/** The rows a wrapping flex line produces: fill each line, then start the next. */
function greedySizes(items: number[], gap: number, available: number): number[] {
  const rows: number[] = []
  let from = 0
  while (from < items.length) {
    let to = from + 1
    while (to < items.length && rowWidth(items, from, to + 1, gap) <= available) to += 1
    rows.push(to - from)
    from = to
  }
  return rows
}

/** Row sizes a browser would produce for `columns` equal columns, for comparison. */
export function rowSizes(n: number, columns: number): number[] {
  if (n <= 0 || columns <= 0) return []
  const rows: number[] = []
  let left = n
  while (left > 0) {
    const size = Math.min(columns, left)
    rows.push(size)
    left -= size
  }
  return rows
}

/** Whether the last row of `columns` would hold exactly one item. */
export function orphansRow(n: number, columns: number): boolean {
  const rows = rowSizes(n, columns)
  return rows.length > 1 && rows[rows.length - 1] === 1
}
