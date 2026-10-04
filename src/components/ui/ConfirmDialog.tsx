import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CANCEL_LABEL, registerConfirmHost, type ConfirmRequest } from '../../lib/confirm'
import { trapTab } from './focusTrap'
import styles from '../editor/editor.module.css'

/**
 * The app's one modal confirmation.
 *
 * `HelpOverlay` is the reference implementation of the behaviour and the two
 * share `trapTab` rather than each carrying a copy: a second trap is a second
 * definition of "inside the dialog", and the two would drift the first time a
 * control was added to one of them.
 *
 * Four properties are the whole contract, and each of them is load-bearing for
 * someone:
 *
 * - **Focus starts on the safe control.** A dialog that opens with the
 *   destructive button focused is one `Enter` away from a lost photograph, and
 *   a screen reader announces the button before the question that makes it
 *   legible.
 * - **`Escape` resolves `false`.** Captured, and propagation stopped: the editor
 *   binds bare keys on `window`, so an Escape that merely bubbled would cancel
 *   the open tool *behind* the dialog as well as dismissing the dialog.
 * - **Focus comes back to whatever opened it**, which is why the opener is read
 *   in an effect rather than at call time. The More menu's rows are removed from
 *   the DOM by the time React commits the dialog, so a synchronously captured
 *   opener is a detached node and focus would land on `<body>`.
 * - **A backdrop press dismisses** without deciding anything, because a click
 *   outside a dialog is not consent.
 */
export function ConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const settleRef = useRef<((value: boolean) => void) | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()

  const close = useCallback((outcome: boolean) => {
    const settle = settleRef.current
    settleRef.current = null
    setRequest(null)
    const opener = openerRef.current
    openerRef.current = null
    // `isConnected` rather than a focus call on faith: the opener can be gone by
    // the time a promise settles, and focusing a detached node throws in some
    // engines and does nothing in others.
    if (outcome === false && opener?.isConnected) opener.focus()
    settle?.(outcome)
  }, [])

  useEffect(() => {
    registerConfirmHost({
      confirm: (next) =>
        new Promise<boolean>((resolve) => {
          // One dialog at a time. A second request while one is open resolves the
          // first `false` rather than orphaning its promise, which is what a
          // plain `settleRef.current = resolve` would do.
          settleRef.current?.(false)
          settleRef.current = resolve
          setRequest(next)
        }),
    })
    return () => {
      registerConfirmHost(null)
      // An unmount mid-question is not consent. The caller's `await` resolves
      // `false` and its document survives.
      const settle = settleRef.current
      settleRef.current = null
      settle?.(false)
    }
  }, [])

  useEffect(() => {
    if (!request) return
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement ? active : null
    cancelRef.current?.focus()
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [request, close])

  if (!request) return null

  const destructive = request.tone !== 'neutral'

  return (
    <div className={styles.confirmOverlay} onClick={() => close(false)} role="presentation">
      <div
        ref={panelRef}
        className={styles.confirmPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          event.preventDefault()
          const panel = panelRef.current
          if (panel) trapTab(panel, event.shiftKey)
        }}
      >
        <h2 id={titleId} className={styles.confirmTitle}>
          {request.title}
        </h2>
        <p id={bodyId} className={styles.confirmBody}>
          {request.body}
        </p>
        <div className={styles.confirmActions}>
          <button
            ref={cancelRef}
            type="button"
            className={styles.confirmCancel}
            onClick={() => close(false)}
          >
            {request.cancelLabel ?? CANCEL_LABEL}
          </button>
          <button
            type="button"
            className={destructive ? styles.confirmDanger : styles.confirmGo}
            onClick={() => close(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
