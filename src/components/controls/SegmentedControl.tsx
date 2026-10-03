import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { nextRovingIndex } from '../ui/rovingTabindex'
import { rowsFor, type SegmentedWidths } from './segmentRows'
import styles from './controls.module.css'

export type SegmentedOption<T extends string> = { value: T; label: string }

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}

/**
 * Read the three numbers `rowsFor` needs off the live layout.
 *
 * **The width comes from the parent, not from the control.** `.segmented` is
 * `inline-flex`, so it shrink-wraps: after it has wrapped, `clientWidth` is the width
 * of its *widest row*, which is smaller than the space it had, and reading it there
 * answers "does the widest row fit in the widest row" — always yes, forever, no matter
 * what the panel is doing. `Background`'s four-option row at 390px was measured at
 * 358px of *available* width and the control reported 271px, because three of its
 * options had already wrapped off the fourth. `Export`'s SIZE row escaped this because
 * `.segments` in `exportSheet.module.css` makes the control a full-width flex item, so
 * its own box happened to be the truth.
 *
 * The parent's content box is the answer, with the control's own box taken as a floor
 * so a control in a narrower column of its own never reports room it does not have.
 * No segmented control in this app shares a row with a sibling, which is what makes
 * that floor a floor rather than a fudge — if one ever does, this has to become a
 * measured share.
 *
 * A label span inside each button is measured rather than the button itself, for the
 * reason in the comment above it: reading a stretched box returns the row width, and
 * the measurement would confirm whatever it decided first.
 */
function measure(group: HTMLElement, count: number): SegmentedWidths | null {
  const buttons = group.querySelectorAll<HTMLButtonElement>(':scope > button, :scope > * > button')
  if (buttons.length !== count || count === 0) return null
  const computed = getComputedStyle(group)
  const gap = Number.parseFloat(computed.columnGap || '0') || 0
  const padding =
    (Number.parseFloat(computed.paddingLeft || '0') || 0) +
    (Number.parseFloat(computed.paddingRight || '0') || 0)
  const items: number[] = []
  for (const button of buttons) {
    const label = button.firstElementChild as HTMLElement | null
    if (!label) return null
    const buttonStyle = getComputedStyle(button)
    items.push(
      label.getBoundingClientRect().width +
        (Number.parseFloat(buttonStyle.paddingLeft || '0') || 0) +
        (Number.parseFloat(buttonStyle.paddingRight || '0') || 0),
    )
  }
  const own = group.clientWidth - padding
  const host = group.parentElement
  const hostStyle = host ? getComputedStyle(host) : null
  const hostWidth = host
    ? host.clientWidth -
      (Number.parseFloat(hostStyle?.paddingLeft || '0') || 0) -
      (Number.parseFloat(hostStyle?.paddingRight || '0') || 0)
    : 0
  const available = Math.max(own, hostWidth)
  if (!(available > 0) || items.some((width) => !(width > 0))) return null
  return { items, gap, available }
}

/**
 * A group of toggles that breaks into even rows rather than into whatever a
 * wrapping flex line happens to produce.
 *
 * The DOM, the roles, the single tab stop and the arrow-key roving are all
 * unchanged. The only structural change is inside a control that cannot fit on one
 * row: its buttons are grouped into row elements, one per row, so `Percent` is the
 * third button on the second row instead of a full-width bar under four others. A
 * control that *does* fit renders exactly the flat button list it rendered before,
 * so the nine that never wrap are byte-for-byte unchanged.
 *
 * `data-segmented` carries the row count for the browser test: `1` is a control
 * that fits, and `e2e/journey.panel-seams.spec.ts` asserts that no control above
 * one row ends with a row of one. jsdom reports `scrollWidth === clientWidth === 0`
 * for every element and has no layout at all, so a unit test cannot tell a
 * balanced control from a broken one — only the arithmetic in `segmentRows.ts` is
 * unit-tested, and the layout is checked in a real engine.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<number[] | null>(null)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  const count = options.length
  const rebalance = useCallback(() => {
    const group = groupRef.current
    if (!group) return
    const measured = measure(group, count)
    setRows(measured ? rowsFor(measured) : null)
  }, [count])

  useLayoutEffect(rebalance, [rebalance])

  useEffect(() => {
    const group = groupRef.current
    if (!group || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(rebalance)
    observer.observe(group)
    return () => observer.disconnect()
  }, [rebalance])

  const focusAt = (index: number) => {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('button')
    buttons?.[index]?.focus()
  }

  const buttonAt = (option: SegmentedOption<T>, index: number) => {
    const selected = option.value === value
    return (
      <button
        key={option.value}
        type="button"
        aria-pressed={selected}
        tabIndex={index === selectedIndex ? 0 : -1}
        className={`${styles.segmentedButton}${selected ? ` ${styles.segmentedButtonActive}` : ''}`}
        onClick={() => onChange(option.value)}
        onKeyDown={(event) => {
          const next = nextRovingIndex(event.key, selectedIndex, options.length)
          if (next === null) return
          event.preventDefault()
          onChange(options[next].value)
          focusAt(next)
        }}
      >
        <span className={styles.segmentedLabel}>{option.label}</span>
      </button>
    )
  }

  // `rows === null` is the pre-measurement and the jsdom state: render flat, which
  // is what the flat layout is, so nothing is ever decided by a guess.
  const grouped = rows !== null && rows.length > 1 ? rows : null
  let from = 0

  return (
    // It was `role="tablist"` with `role="tab"` children and no tabpanel, so
    // assistive tech promised a tab set that did not exist. A segmented
    // control is a group of toggles choosing one value, which is exactly what
    // `aria-pressed` toggle buttons inside a `group` describe.
    <div
      ref={groupRef}
      className={styles.segmented}
      role="group"
      aria-label={ariaLabel}
      data-segmented={rows === null ? undefined : String(rows.length)}
    >
      {grouped
        ? grouped.map((size, row) => {
            const buttons = options
              .slice(from, from + size)
              .map((option, offset) => buttonAt(option, from + offset))
            from += size
            return (
              <span key={row} className={styles.segmentedRow}>
                {buttons}
              </span>
            )
          })
        : options.map((option, index) => buttonAt(option, index))}
    </div>
  )
}
