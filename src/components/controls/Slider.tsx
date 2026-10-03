import { useCallback, useEffect, useRef } from 'react'
import { useDocStore } from '../../store/docStore'
import styles from './controls.module.css'

export type SliderProps = {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  /**
   * Undo interaction key; defaults to the label. Every continuous control has
   * to be bracketed, otherwise each `input` event pushes its own entry and a
   * single drag exhausts `MAX_HISTORY`.
   */
  interactionKey?: string
}

const KEYED = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

/**
 * Native range input bracketed as one undo interaction. Pointer, touch and
 * held-arrow-key adjustments all open the span on the first event and close it
 * on release, cancel, blur and unmount, so a 100-event drag is one step.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  interactionKey,
}: SliderProps) {
  const key = interactionKey ?? `slider:${label}`
  const open = useRef(false)

  const begin = useCallback(() => {
    if (open.current) return
    open.current = true
    useDocStore.getState().beginInteraction(key)
  }, [key])

  const end = useCallback(() => {
    if (!open.current) return
    open.current = false
    useDocStore.getState().endInteraction()
  }, [])

  const endRef = useRef(end)
  useEffect(() => {
    endRef.current = end
  })
  // A panel that unmounts mid-drag must still close the span, or the next edit
  // in the whole app is swallowed into a single undo step.
  useEffect(() => () => endRef.current(), [])

  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)))

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}{' '}
        <span className={styles.dialValue}>
          {value}
          {unit}
        </span>
      </span>
      <input
        className={styles.sliderInput}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onMouseDown={begin}
        onMouseUp={end}
        onTouchStart={begin}
        onTouchEnd={end}
        onKeyDown={(event) => {
          if (KEYED.has(event.key)) begin()
        }}
        onKeyUp={end}
        onBlur={end}
        onChange={(event) => set(Number(event.target.value))}
      />
    </label>
  )
}
