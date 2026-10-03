import type { KeyboardEventHandler, ReactNode } from 'react'
import styles from './controls.module.css'

export type ParameterRingProps = {
  label: string
  progress: number
  valueLabel: string
  active?: boolean
  onClick: () => void
  children: ReactNode
  /** Roving tabindex: exactly one ring in the row is in the tab order. */
  tabIndex?: number
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>
}

const RADIUS = 18
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ParameterRing({
  label,
  progress,
  valueLabel,
  active,
  onClick,
  children,
  tabIndex,
  onKeyDown,
}: ParameterRingProps) {
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = CIRCUMFERENCE * (1 - clamped)
  return (
    <button
      type="button"
      className={`${styles.ring}${active ? ` ${styles.ringActive}` : ''}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      aria-pressed={active}
      aria-label={`${label} ${valueLabel}`}
    >
      <span className={styles.ringButton} aria-hidden="true">
        <svg width="42" height="42" viewBox="0 0 42 42" style={{ position: 'absolute' }}>
          <circle
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="3"
          />
          <circle
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            stroke="var(--ie-accent-bright)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 21 21)"
          />
        </svg>
        {children}
      </span>
      <span aria-hidden="true">{label}</span>
      <span className={styles.ringValue} aria-hidden="true">
        {valueLabel}
      </span>
    </button>
  )
}
