import { useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import diagnostics from '../ui/diagnosticsReport.module.css'
import styles from './controls.module.css'

/**
 * The toast stack, and what is left when it is gone.
 *
 * Every toast is dismissed after 3.2 s, which is right for "Exported" and wrong
 * for "Storage is full — this session was not saved". So an error toast is
 * *also* appended to a bounded, versioned, user-clearable list in
 * `localStorage`, and the panel below is that list: it outlives the toast, and
 * it outlives a reload, which is the moment somebody notices they have lost
 * work and starts looking for a way to say so.
 *
 * It is a child of `.toastStack` so it lands where the toasts already land and
 * inherits that stack's fixed, centred column — adding a second fixed element
 * would mean a second thing to keep clear of the tool tab bar. It opts back into
 * `pointer-events`, which the stack turns off for itself, because the delete
 * button is a real control.
 */
export function ToastStack() {
  const toasts = useUiStore((state) => state.toasts)
  const errorLog = useUiStore((state) => state.errorLog)
  const dismiss = useUiStore((state) => state.dismissToast)
  const clearErrorLog = useUiStore((state) => state.clearErrorLog)

  useEffect(() => {
    const timers = toasts.map((toast) => window.setTimeout(() => dismiss(toast.id), 3200))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [toasts, dismiss])

  return (
    <div className={styles.toastStack} aria-live="polite" aria-atomic="false">
      {errorLog.length > 0 && (
        <div className={diagnostics.savedErrors} role="region" aria-label="Recent problems">
          <p className={diagnostics.savedErrorsHead}>
            Kept after a reload so you can tell somebody what went wrong
          </p>
          <ul className={diagnostics.savedErrorList}>
            {errorLog.map((entry) => (
              <li key={entry.id} className={diagnostics.savedErrorItem}>
                <time dateTime={new Date(entry.at).toISOString()}>
                  {new Date(entry.at).toISOString().slice(5, 16).replace('T', ' ')}
                </time>
                {entry.message}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={diagnostics.savedErrorClear}
            onClick={() => clearErrorLog()}
          >
            Delete these
          </button>
        </div>
      )}
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast}${toast.tone === 'error' ? ` ${styles.toastError}` : ''}`}
          role="status"
        >
          {toast.message}
        </div>
      ))}
    </div>
  )
}
