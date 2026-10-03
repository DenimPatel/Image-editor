import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { cdnDisclosure } from './privacy'
import { hasSeenOnboarding, markOnboardingSeen } from './onboardingKeys'
import styles from './onboarding.module.css'

/**
 * The orientation: four things that are true of this editor and not of a
 * generic one. A term and a sentence each, deliberately not a feature list —
 * every entry is a property of how the app works rather than a thing it can do,
 * so there is nothing here a user has to shop for.
 */
const ORIENTATION: { term: string; detail: string }[] = [
  { term: 'It runs in this tab.', detail: cdnDisclosure() },
  {
    term: 'Every edit is reversible.',
    detail:
      'Crop, straighten, colour, masks and layers are instructions held next to your original pixels rather than changes made to them. Undo and redo reach all of it, and “Reset all edits” puts the photo back the way the file arrived.',
  },
  {
    term: 'Looks are settings, not filters.',
    detail:
      'A look is a named bundle of adjustments sitting over your photo, with an amount you can dial in and out. Change your mind about one and the photo underneath is exactly what it was.',
  },
  {
    term: 'Export is the only destructive step.',
    detail:
      'Until you download, nothing is written anywhere. Your original file, and any copy you have made of it, stay where they were.',
  },
]

/**
 * The first-run orientation, and the permanent way back to it.
 *
 * The trigger renders whether or not the panel does, which is what makes the
 * panel reachable after it has been dismissed: a first-run screen that can only
 * be seen once and never again is a secret, not an orientation. The panel itself
 * appears only when `onboardingKeys.ts` says this version has not been answered.
 *
 * Keyboard is the whole contract here rather than an extra. The panel takes
 * focus on open, a document-level listener cycles Tab inside itself so it cannot
 * land on the screen behind, closes on Escape wherever focus happens to be, and
 * hands focus back to the trigger on the way out — so the return path is
 * reachable without a pointing device at any point in the sequence.
 */
export default function Onboarding() {
  const [open, setOpen] = useState(() => !hasSeenOnboarding())
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  const panelId = useId()
  const titleId = useId()

  const close = useCallback(() => {
    setOpen(false)
    markOnboardingSeen()
  }, [])

  useEffect(() => {
    if (open) {
      panelRef.current?.focus()
    } else if (wasOpen.current) {
      // Only on the way *out*. On a mount where the panel was never open this
      // would steal the document's focus for a returning visitor, which is the
      // kind of thing that makes a screen reader start somewhere nobody chose.
      triggerRef.current?.focus()
    }
    wasOpen.current = open
  }, [open])

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const stops = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (stops.length === 0) return
      const first = stops[0]!
      const last = stops[stops.length - 1]!
      const active = document.activeElement
      // The panel itself counts as a stop in both directions. It has to: it
      // holds focus on open, and a forward Tab from there is a browser default
      // that walks *out* of the modal — Chromium happens to land back inside,
      // WebKit does not, and a trap that only holds on one engine is not a trap.
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault()
        first.focus()
      }
    },
    [close],
  )

  // On the document, not on the scrim. A handler on the scrim only ever sees
  // keys pressed inside the panel, and a modal that owns the whole viewport has
  // to close when the user clicks the background and then presses Escape — with
  // the listener on the scrim that keypress is delivered to whatever is behind
  // it and the panel stays open, which is the failure mode this is written to
  // avoid. Tab is here for the same reason: the cycle has to hold wherever focus
  // currently is.
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onKeyDown])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
      >
        How this editor works
      </button>
      {open ? (
        <div className={styles.scrim}>
          <div
            ref={panelRef}
            id={panelId}
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <h2 className={styles.title} id={titleId}>
              Before you start
            </h2>
            <dl className={styles.points}>
              {ORIENTATION.map((point) => (
                <div className={styles.point} key={point.term}>
                  <dt className={styles.term}>{point.term}</dt>
                  <dd className={styles.detail}>{point.detail}</dd>
                </div>
              ))}
            </dl>
            <div className={styles.actions}>
              <button type="button" className={styles.dismiss} onClick={close}>
                Got it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
