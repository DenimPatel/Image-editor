import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { IconComponent } from './icons'
import styles from './menu.module.css'

export type MenuItem = {
  id: string
  label: string
  disabled?: boolean
  onSelect: () => void
  /**
   * The mark that names the row.
   *
   * Rendered `aria-hidden` by `icon()` and into a fixed-width slot, so the labels of
   * a menu whose rows carry glyphs line up with each other and with a menu whose rows
   * do not. The audit's complaint about this menu was "seven ungrouped rows and no
   * icons": the icons make each row findable at a glance and the slot makes the rows
   * a column rather than a paragraph.
   *
   * Optional, because a row with no true mark should have none — a wrong glyph is
   * worse than no glyph, since it is a claim about what the row does. `icons.test.tsx`
   * hashes every glyph's artwork and fails on a duplicate, so no two of the seven can
   * quietly end up drawing the same shape.
   */
  icon?: IconComponent
  /**
   * Rows sharing a group are one block, and a change of group puts a
   * `role="separator"` between them.
   *
   * Seven undifferentiated rows make a reader read all seven to find one. Seven rows
   * in two blocks — the editor's own settings, then the document's edits — is the
   * same seven taps with a shape. It is a claim about the menu's structure, so it is
   * stated in the menu rather than implied by spacing.
   */
  group?: string
}

export type UseMenuPopoverOptions = {
  /** The menu's own accessible name, and it is the trigger's too. */
  label: string
  items: MenuItem[]
}

/**
 * A popover menu with the roving focus a menu needs.
 *
 * Return focus to the trigger on close, place the panel under the top bar, close on
 * Escape, on Tab and on a press outside, and keep focus inside while it is open.
 * Everything about *appearance* belongs to the caller — this decides where the panel
 * is and what Escape does.
 *
 * The panel is portalled to `document.body` and the caller renders it as a sibling of
 * the header rather than inside it, because the header is a stacking context at 30
 * and the desktop inspector sits at 41: a popover inside the bar paints under the
 * panel it is meant to sit beside. `EditorTopBar.test.tsx` pins the parent element.
 */
export function useMenuPopover({ label, items }: UseMenuPopoverOptions) {
  const [open, setOpen] = useState(false)
  // Where the panel is portalled. Read out of the DOM when the menu is opened, in the
  // click handler, because a ref cannot be read during render and the portal target is
  // a rendering decision.
  const [host, setHost] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()

  const close = useCallback(() => {
    setOpen(false)
    // Focus goes back to the trigger rather than to the document, because a menu
    // that closes and drops focus leaves a keyboard user at the top of the page.
    // Selecting "Appearance…" hands focus to the panel it opens, so this runs
    // before that panel's own focus effect and is then overridden by it.
    triggerRef.current?.querySelector('button')?.focus()
  }, [])

  const openMenu = useCallback(() => {
    // The portal target is the header's *parent*, not `document.body`, and that is
    // load-bearing twice over: the header is a stacking context at 30 and the desktop
    // inspector sits at 41, so a panel inside the bar would paint under it; and
    // `document.body` would put the menu outside the app's own subtree, which is where
    // an orphaned portal accumulates and where a test cannot find it by asking the app
    // for it. `closest('header')` rather than counting `parentElement`s, so a wrapper
    // added to the bar tomorrow does not silently move the popover into it.
    setHost(triggerRef.current?.closest('header')?.parentElement ?? document.body)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])

  // Outside press. `pointerdown` rather than `click`, so the panel is already gone by
  // the time the control underneath handles the press: with `click` the menu item
  // under the pointer and the control behind it both fire.
  useEffect(() => {
    if (!open) return
    const onDown = (event: Event) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  // Focus leaving the panel by any route — a click on `Done`, a programmatic focus,
  // the browser's own Tab — dismisses rather than stranding a menu open with nothing
  // in it focused.
  useEffect(() => {
    if (!open) return
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [open])

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openMenu()
  }

  const onPanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab') {
      // A menu is not a tab stop. Tab closes it so focus can continue past it.
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const enabled = buttonRefs.current.filter(
      (button): button is HTMLButtonElement => button !== null && !button.disabled,
    )
    if (enabled.length === 0) return
    const current = enabled.findIndex((button) => button === document.activeElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1 + enabled.length) % enabled.length
            : (current - 1 + enabled.length) % enabled.length
    enabled[next]?.focus()
  }

  const triggerProps = {
    'aria-expanded': open,
    'aria-haspopup': 'menu' as const,
    'aria-controls': open ? menuId : undefined,
    onClick: () => (open ? close() : openMenu()),
    onKeyDown: onTriggerKeyDown,
  }

  const portalTarget = host ?? document.body

  const popover = open
    ? createPortal(
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={`${styles.menu} ${styles.menuEnd}`}
          onKeyDown={onPanelKeyDown}
        >
          {items.map((item, index) => {
            const previous = items[index - 1]
            const separated = previous !== undefined && previous.group !== item.group
            return (
              <div key={item.id} className={styles.menuGroup}>
                {separated ? <span role="separator" className={styles.menuSeparator} /> : null}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  aria-disabled={item.disabled || undefined}
                  className={styles.menuItem}
                  ref={(node) => {
                    buttonRefs.current[index] = node
                  }}
                  onClick={() => {
                    item.onSelect()
                    close()
                  }}
                >
                  {item.icon ? (
                    <item.icon className={styles.menuItemIcon} />
                  ) : (
                    <span className={styles.menuItemIcon} aria-hidden="true" />
                  )}
                  <span className={styles.menuItemLabel}>{item.label}</span>
                </button>
              </div>
            )
          })}
        </div>,
        portalTarget,
      )
    : null

  return { triggerRef, triggerProps, popover }
}
