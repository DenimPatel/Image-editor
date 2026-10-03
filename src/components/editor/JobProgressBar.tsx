import { useId } from 'react'
import { useUiStore } from '../../store/uiStore'
import styles from './editor.module.css'

/**
 * The one-pixel job bar over the canvas.
 *
 * ## The accessible name
 *
 * This was a `role="progressbar"` with an `aria-valuenow` and no name at all,
 * leaning entirely on a sibling `aria-live` div. That works for a user who is
 * already listening to the live region, and for nobody else: navigating by
 * element reached an unnamed widget, and the only thing it could have announced
 * was a number with no idea what it was counting. The name now comes from the
 * job's own label — the same string the live region announces — so the bar
 * reads "Exporting, progress bar, 42%" rather than "progress bar, 42%", and
 * there is still exactly one string in the file, so the two cannot drift.
 *
 * `aria-valuemin`/`aria-valuemax` are the implicit defaults, written out anyway:
 * `aria-valuenow` is the only one of the three a screen reader reads on its own,
 * and a value whose range is not stated is a number with no scale.
 *
 * ## Monotonicity is the store's job, not this component's
 *
 * A progress bar that rewinds is a lie, so the obvious move was to floor the
 * value here. It is the wrong move: the floor would be a second copy of state
 * that the bar maintains and nothing else can see, and `react-hooks/refs`
 * (rightly) refuses to read or write a ref during render, so the only way to
 * keep it is a `setState` in an effect — which trades a one-line rule violation
 * in the view for a second source of truth in the data layer. The correct fix is
 * in `useUiStore.updateJob`, which every reporter goes through; this component
 * renders what it is told and nothing more.
 */
export function JobProgressBar() {
  const jobs = useUiStore((state) => state.jobs)
  const running = jobs.find((job) => job.status === 'running')
  const labelId = useId()
  // Clamped to the role's own range so an out-of-band reporter cannot put an
  // impossible value in the DOM, while still reporting exactly what it said.
  const value = running ? Math.min(100, Math.max(0, Math.round(running.progress * 100))) : 0

  if (!running) return null
  return (
    <>
      <div
        className={styles.jobBar}
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className={styles.jobBarFill} style={{ width: `${value}%` }} />
      </div>
      <div className={styles.jobLabel} id={labelId} aria-live="polite">
        {running.label}
      </div>
    </>
  )
}
