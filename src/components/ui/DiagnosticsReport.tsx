import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  buildDiagnosticsReport,
  copyOutcomeMessage,
  copyText,
  recordManualReport,
  refreshStorageEstimate,
  type CopyOutcome,
} from '../../lib/diagnostics'
import styles from './diagnosticsReport.module.css'

/**
 * `inline` — the crash screen: the text is there from the first paint, because
 * the app is dead and there is no second chance to find this.
 *
 * `onDemand` — the live app: one button. The report is generated when it is
 * pressed rather than on every render, so a user who never reports a bug never
 * pays for the report and never sees a wall of text in the middle of an edit.
 *
 * `revealed` — the text with no button of its own, for a host that has already
 * put a copy control in its own toolbar. The `HelpOverlay` needs that because
 * its dialog's tab cycle is pinned to one control by a unit test and an e2e
 * test, and a second focusable stop would break both; the button it renders is
 * `tabIndex={-1}` and the dialog's own key handler copies on `d`.
 */
export type DiagnosticsReportVariant = 'inline' | 'onDemand' | 'revealed'

export type DiagnosticsReportProps = {
  variant?: DiagnosticsReportVariant
  /** Overridable so a host can name the action for its own context. */
  label?: string
  /**
   * Whether the text field is a stop in the host's tab order.
   *
   * `true` by default, and it is what makes the crash screen's block usable
   * from the keyboard alone. `false` is for a host whose focus trap is pinned
   * to a fixed stop list — `HelpOverlay` — where a second stop would break a
   * test that is asserting something true about the trap. The field is still
   * selected with a pointer and still readable; it is only left out of Tab.
   */
  fieldTabbable?: boolean
}

const COPY_LABEL = 'Copy diagnostics'

/**
 * The one way a user gets a bug out of this app.
 *
 * Every branch ends with the text in front of them. The clipboard API is tried
 * first; a refusal falls back to a hidden field and `execCommand`; if that is
 * gone too, the visible field is focused with its contents selected and the
 * reader is told which keys to press. "Copied" is never claimed unless it
 * happened.
 */
export function DiagnosticsReport({
  variant = 'inline',
  label = COPY_LABEL,
  fieldTabbable = true,
}: DiagnosticsReportProps) {
  const [text, setText] = useState(() => buildDiagnosticsReport())
  const [status, setStatus] = useState<string | null>(null)
  // `onDemand` keeps the text hidden until the button is pressed, so the live
  // app never has a wall of log in the middle of an edit. The other two
  // variants are shown from the first paint: a crash screen has no second
  // chance, and a host that put its own control in a toolbar wants the text
  // there to select.
  const [revealed, setRevealed] = useState(variant !== 'onDemand')
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const noteId = useId()

  useEffect(() => {
    let cancelled = false
    // `navigator.storage.estimate()` is the one asynchronous fact, and the
    // report cannot wait for it: a report that has to await something can fail
    // to arrive at all. It is refreshed in the background and the text rebuilt
    // when it lands.
    void refreshStorageEstimate().then(() => {
      if (cancelled) return
      setText(buildDiagnosticsReport())
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onCopy = useCallback(() => {
    void (async () => {
      // The pressing of the button is itself the record, so the buffer knows a
      // report was taken even if the paste never lands in a browser we control.
      recordManualReport('Diagnostics copied by the reader')
      const report = buildDiagnosticsReport()
      setText(report)
      setRevealed(true)
      const outcome: CopyOutcome = await copyText(report)
      if (outcome === 'manual') {
        const field = fieldRef.current
        field?.focus()
        field?.select()
      }
      setStatus(copyOutcomeMessage(outcome))
    })()
  }, [])

  return (
    <div className={styles.report}>
      {revealed && (
        <p className={styles.reportNote} id={noteId}>
          Nothing here is sent anywhere. It is built on this device, in this tab, and contains your
          build and browser but no image, no pixel, no file name and no document.
        </p>
      )}
      {variant !== 'revealed' && (
        <button type="button" className={styles.copyButton} onClick={onCopy}>
          {label}
        </button>
      )}
      {/* `readOnly` with no `onChange` is deliberate and is not a React
          warning: a read-only field is exactly the affordance needed here,
          because focusing it and pressing the copy keys works whether or not a
          clipboard permission was ever granted. */}
      {revealed && (
        <textarea
          ref={fieldRef}
          className={styles.reportText}
          aria-label="Diagnostics report"
          aria-describedby={noteId}
          readOnly
          rows={8}
          spellCheck={false}
          tabIndex={fieldTabbable ? undefined : -1}
          value={text}
        />
      )}
      {status && (
        <p className={styles.reportStatus} role="status">
          {status}
        </p>
      )}
    </div>
  )
}
