import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import styles from './controls.module.css'

export type ChipOption<T extends string> = { value: T; label: string }

/**
 * The fading scroller every chip row is a child of.
 *
 * The row scrolls sideways and hides its scrollbar, so without a fade the last
 * chip reads as "that is all of them" when it is only the edge of the window. A
 * mask rather than a painted gradient, so it works in both themes without naming
 * the panel colour.
 *
 * The fade is only an honest affordance while there is genuinely more to scroll
 * to *and* the tail is not already in view, so it tracks both states rather than
 * assuming either. That is the part that is easy to get wrong and hard to notice:
 * a fade left on a row scrolled to the end is a gradient across the last chip's
 * own label, which is a different defect rather than a milder version of the one
 * the fade exists to prevent.
 *
 * `RatioChipRow` needs a glyph slot and an optional second line before its
 * labels, so it cannot be a `ChipRow` with different options — and it used to
 * re-declare this whole shell to get one. That made a change to the fade a change
 * in two files, one of which was only correct until somebody checked the other.
 * The measurement lives here now; the class names do not, because each row's
 * chips are styled from a different module on purpose (see the header of
 * `tools/ratioChips.module.css`), and `controls.module.css` is not this file's to
 * restyle. So the shell takes both: `className` is the row's own box, and
 * `fadeClassName` is the one rule that says "there is more past this edge".
 */
export function ChipRowShell({
  className,
  fadeClassName,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { fadeClassName?: string }) {
  const rowRef = useRef<HTMLDivElement>(null)
  const [scrolledToEnd, setScrolledToEnd] = useState(true)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const update = () => {
      const max = row.scrollWidth - row.clientWidth
      setOverflowing(max > 1)
      setScrolledToEnd(max <= 1 || row.scrollLeft >= max - 1)
    }
    update()
    // jsdom has no ResizeObserver, and a chip row that cannot measure itself
    // must still render — the fade is an affordance, not a precondition.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(row)
    for (const child of Array.from(row.children)) observer?.observe(child)
    if (!observer) window.addEventListener('resize', update)
    row.addEventListener('scroll', update, { passive: true })
    return () => {
      observer?.disconnect()
      if (!observer) window.removeEventListener('resize', update)
      row.removeEventListener('scroll', update)
    }
  }, [children])

  return (
    <div
      className={`${className ?? ''}${
        overflowing && !scrolledToEnd && fadeClassName ? ` ${fadeClassName}` : ''
      }`}
      role="group"
      ref={rowRef}
      {...rest}
    >
      {children}
    </div>
  )
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  style,
}: {
  options: ChipOption<T>[]
  value: T | null
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <ChipRowShell
      className={`${styles.chipRow}${className ? ` ${className}` : ''}`}
      fadeClassName={styles.chipRowMore}
      style={style}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${styles.chip}${option.value === value ? ` ${styles.chipActive}` : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </ChipRowShell>
  )
}
