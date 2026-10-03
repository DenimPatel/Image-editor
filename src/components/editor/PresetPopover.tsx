import { useEffect, useRef } from 'react'
import controls from '../controls/controls.module.css'
import tools from '../tools/tools.module.css'
import menu from '../ui/menu.module.css'

export type PresetPopoverProps = {
  name: string
  onNameChange: (name: string) => void
  names: readonly string[]
  onSave: () => void
  onApply: (name: string) => void
  onDelete: (name: string) => void
  onClose: () => void
}

/**
 * The preset list, opened from the editor's More menu.
 *
 * It was a `div` with `className={styles.moreMenu}` — and `.moreMenu` is not a
 * class in `editor.module.css`, so the name resolved to `undefined` and the box
 * had no styles at all. What rendered was a raw `<input>` stretched the full
 * width of the page at the top-left corner, a browser-default `<button>` under
 * it, and "No saved presets yet." at the left margin, all painted *over* the
 * canvas: no surface, no border, no shadow, no padding, and the canvas visible
 * through the middle of the dialog.
 *
 * It was also not dismissible. No Escape, no outside press, no focus handling —
 * selecting "Save preset" closed the menu, handed focus back to the trigger, and
 * left a dialog on screen that the only way out of was the one button in it. The
 * keyboard answer to "I opened this by accident" was: reload.
 *
 * So the three things that make it a dialog are here now: a surface to sit on
 * (the same top-right popover the More menu itself is drawn from, so it lands
 * under the control that opened it), the three ways out, and focus moved to the
 * field on arrival. The classes are borrowed rather than added — a new
 * `.moreMenu` rule would be a new declaration for a box that already has one.
 */
export function PresetPopover({
  name,
  onNameChange,
  names,
  onSave,
  onApply,
  onDelete,
  onClose,
}: PresetPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Arriving with the caret in the name field: this dialog exists to be typed
    // into, and the old one put focus wherever the trigger had left it.
    fieldRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    const onPointerDown = (event: Event) => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Presets"
      className={`${menu.menu} ${menu.menuEnd}`}
      // A definite width, not `min-width`. The box is `position: absolute` with
      // only `right` set, so it shrink-to-fits its *max-content* — and the
      // longest sentence in here is the empty-state hint, which laid the popover
      // out 713 px wide across the top of the canvas. `.menu` cannot be given a
      // `max-width` from here, so the width is stated here.
      style={{ width: 300 }}
    >
      <p className={controls.sectionTitle} style={{ margin: '2px 6px 6px' }}>
        Presets
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <input
          ref={fieldRef}
          aria-label="Preset name"
          className={controls.textInput}
          value={name}
          maxLength={40}
          placeholder="Name this look"
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            onSave()
          }}
        />
        <div className={tools.buttonRow} style={{ marginTop: 8 }}>
          <button
            type="submit"
            className={`${tools.textButton} ${tools.textButtonPrimary}`}
            style={{ flex: 1 }}
          >
            Save preset
          </button>
        </div>
      </form>
      {names.length === 0 ? (
        <p className={tools.hint} style={{ margin: '10px 6px 2px' }}>
          No saved presets yet. Saving one keeps the adjustments, layers and output settings so you
          can put them back in one tap.
        </p>
      ) : (
        <>
          <p className={controls.sectionTitle} style={{ margin: '10px 6px 2px' }}>
            Saved
          </p>
          {names.map((preset) => (
            <div key={preset} className={tools.row} style={{ gap: 6, padding: '0 2px 6px' }}>
              <button
                type="button"
                className={`${menu.menuItem} ${tools.textButton}`}
                style={{ flex: 1, borderRadius: 'var(--radius-xs)' }}
                onClick={() => onApply(preset)}
              >
                {preset}
              </button>
              <button
                type="button"
                className={tools.textButton}
                aria-label={`Delete ${preset}`}
                onClick={() => onDelete(preset)}
              >
                Delete
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
