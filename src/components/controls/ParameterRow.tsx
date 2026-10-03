import { useRef } from 'react'
import type { AdjustKey } from '../../model/types'
import { AdjustIcon } from '../ui/icons'
import { nextRovingIndex } from '../ui/rovingTabindex'
import { ParameterRing } from './ParameterRing'
import styles from './controls.module.css'

export type ParameterItem = {
  key: AdjustKey
  label: string
  value: number
  min: number
  max: number
  neutral: number
  unit?: string
}

function formatValue(item: ParameterItem): string {
  const value = item.value
  if (Number.isInteger(value)) return `${value > 0 ? '+' : ''}${value}${item.unit ?? ''}`
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}${item.unit ?? ''}`
}

export function ParameterRow({
  items,
  selectedKey,
  onSelect,
}: {
  items: ParameterItem[]
  selectedKey: AdjustKey | null
  onSelect: (key: AdjustKey) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.key === selectedKey),
  )

  const focusAt = (index: number) => {
    const row = rowRef.current
    if (!row) return
    const buttons = row.querySelectorAll<HTMLButtonElement>('button')
    const target = buttons[index]
    if (!target) return
    target.focus()
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  return (
    // A ring is a toggle button: clicking it chooses which parameter the dial
    // below edits. It was declared a `tablist` with no `tab` children and no
    // `tabpanel`, which is the `aria-required-children` violation axe reports;
    // `toolbar` is the role that matches what it actually is.
    <div
      ref={rowRef}
      className={styles.parameterRow}
      role="toolbar"
      aria-label="Adjustment parameters"
      aria-orientation="horizontal"
    >
      {items.map((item, index) => {
        const span = item.value >= item.neutral ? item.max - item.neutral : item.neutral - item.min
        const progress = span > 0 ? Math.abs(item.value - item.neutral) / span : 0
        return (
          <ParameterRing
            key={item.key}
            label={item.label}
            progress={progress}
            valueLabel={formatValue(item)}
            active={selectedKey === item.key}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => onSelect(item.key)}
            onKeyDown={(event) => {
              const next = nextRovingIndex(event.key, selectedIndex, items.length)
              if (next === null) return
              event.preventDefault()
              onSelect(items[next].key)
              focusAt(next)
            }}
          >
            <AdjustIcon spec={item} />
          </ParameterRing>
        )
      })}
    </div>
  )
}
