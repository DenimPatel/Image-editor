import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useHaptics } from '../../hooks/useHaptics'
import { usePointerDrag } from '../../hooks/usePointerDrag'
import type { SheetDetent } from '../../store/uiStore'
import { useIsInspector } from '../ui/useMediaQuery'
import styles from './controls.module.css'
import { DETENTS, SHEET_HEIGHTS } from './sheetHeights'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * The backdrop dims; it does not intercept.
 *
 * `.sheetBackdrop` is `position: absolute; inset: 0` inside `.canvasRegion`,
 * which on a phone is the whole box between the two bars — so a scrim that
 * takes pointer events is a scrim over *the entire visible canvas*, and every
 * canvas control under it is dead. All eight crop handles, all five layer
 * transform grips and the crop box's own move gesture were unreachable by
 * touch for exactly as long as a panel was open, which is the whole time you
 * want them: a thumb aimed at the se handle landed on the scrim instead and
 * closed the panel. Two of thirteen tools could not be used on a phone at all.
 *
 * This is the same mistake the scrim already had once and no longer has: it
 * used to be `position: fixed`, which put it over the top bar and the tool tab
 * bar too, so `Done`, `More options` and all thirteen tabs were behind 45%
 * black. Scoping the box to the canvas region fixed the chrome and left the
 * canvas, which is where this sheet's own handles live, still underneath it.
 *
 * Nothing is lost by letting touches through. Dismissal has three other doors —
 * the 44px `Close` button in the title row, Escape, and tapping any other tool
 * tab — and the tab bar is deliberately left lit and tappable for exactly this
 * reason. A scrim that a finger cannot press is a picture of a scrim.
 */
const BACKDROP_DIM_ONLY = { pointerEvents: 'none' } as const

export type BottomSheetProps = {
  open: boolean
  detent: SheetDetent
  onDetent: (detent: SheetDetent) => void
  onClose: () => void
  title?: string
  children: ReactNode
}

/**
 * Peek/medium/large bottom sheet with a draggable grabber and Escape to
 * close. On desktop it becomes a right-hand inspector via CSS, so the same
 * markup serves both form factors.
 */
export function BottomSheet({
  open,
  detent,
  onDetent,
  onClose,
  title,
  children,
}: BottomSheetProps) {
  const haptics = useHaptics()
  const dragDy = useRef(0)
  const sheetRef = useRef<HTMLElement>(null)
  const currentDetent = useRef(detent)
  // Above the breakpoint the sheet is a persistent column with no backdrop, so
  // the two behaviours that only make sense for a modal — `aria-modal` and the
  // Tab wrap — are switched off; otherwise a desktop keyboard user who opened
  // Crop could never Tab back out to the top bar or the canvas.
  const isInspector = useIsInspector()
  const modal = open && !isInspector
  useEffect(() => {
    currentDetent.current = detent
  }, [detent])

  const { onPointerDown } = usePointerDrag({
    onStart: () => {
      dragDy.current = 0
    },
    onMove: (_dx, dy) => {
      dragDy.current += dy
    },
    onEnd: () => {
      const threshold = 56
      const index = DETENTS.indexOf(currentDetent.current)
      if (dragDy.current > threshold && index > 0) {
        onDetent(DETENTS[index - 1])
        haptics(8)
      } else if (dragDy.current < -threshold && index < DETENTS.length - 1) {
        onDetent(DETENTS[index + 1])
        haptics(8)
      }
      dragDy.current = 0
    },
  })

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // The opener is whatever had focus when the sheet appeared. Without this the
  // sheet unmounts and focus falls to <body>, so the next Tab starts the whole
  // page over instead of returning to the control that opened the panel.
  //
  // The restore is in the *cleanup*, not a separate `open === false` effect:
  // `ToolSurface` unmounts `BottomSheet` outright when the tool closes, so an
  // effect keyed on `open` going false would never run.
  const openerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    const active = document.activeElement
    const opener = active instanceof HTMLElement ? active : null
    openerRef.current = opener
    return () => {
      openerRef.current = null
      if (opener?.isConnected) opener.focus()
    }
  }, [open])

  useEffect(() => {
    if (!modal) return
    const element = sheetRef.current
    if (!element) return
    const focusable = () =>
      Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.hasAttribute('disabled'),
      )
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const list = focusable()
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [modal])

  if (!open) return null

  return (
    <>
      {modal && (
        <div className={styles.sheetBackdrop} style={BACKDROP_DIM_ONLY} aria-hidden="true" />
      )}
      <section
        ref={sheetRef}
        className={styles.sheet}
        // The desktop inspector is stretched by `top: 0; bottom: 0`, and an
        // inline height outranks that — writing one here is what pinned the
        // "full-height" inspector at 58vh with 42vh of dead space beneath it.
        style={isInspector ? undefined : { height: SHEET_HEIGHTS[detent] }}
        role="dialog"
        aria-modal={modal ? true : undefined}
        aria-label={title}
      >
        <div className={styles.sheetGrabber} onPointerDown={onPointerDown} />
        <div className={styles.sheetBody}>
          {title && (
            <div className={styles.sheetTitleRow}>
              <h2 className={styles.sheetTitle}>{title}</h2>
              <button type="button" className={styles.sheetClose} onClick={onClose}>
                Close
              </button>
            </div>
          )}
          {children}
        </div>
      </section>
    </>
  )
}
