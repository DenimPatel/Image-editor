import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  buildDiagnosticsReport,
  copyOutcomeMessage,
  copyText,
  recordManualReport,
  type CopyOutcome,
} from '../../lib/diagnostics'
import {
  clearAllFlags,
  clearFlagState,
  setFlagState,
  useFlagReport,
  type FlagReportRow,
  type FlagSource,
  type FlagState,
} from '../../lib/flags'
import { useUiStore } from '../../store/uiStore'
import { DiagnosticsReport } from '../ui/DiagnosticsReport'
import { detectedPlatform, shortcutSections } from '../ui/shortcuts'
import styles from './editor.module.css'

/**
 * Everything focusable inside the dialog, in DOM order.
 *
 * The panel itself is a stop because it is what focus lands on when the dialog
 * opens, and a trap that skipped it would make the first Tab jump to the bottom
 * of a list the reader has not been told about. It is not in the *natural* tab
 * order — it carries `tabIndex={-1}` — so this is the only thing that reaches
 * it, which is exactly what a cyclic trap is for.
 *
 * `:not([tabindex="-1"])` is applied to every element type here rather than to
 * the attribute clause alone, and that is the whole point of writing it this
 * way: a bare `button` or `textarea` in this selector also matches a control
 * that has *explicitly* asked to be left out of the tab order, so a trap built
 * on it would override that decision and drag the control back into the cycle.
 * This dialog has three such controls — the diagnostics copy button, the
 * diagnostics text field, and the debug-switch resets — and each reaches the
 * keyboard by its own labelled key instead.
 */
const TABBABLE = [
  'a[href]',
  'button:not([tabindex="-1"])',
  'input:not([tabindex="-1"])',
  'select:not([tabindex="-1"])',
  'textarea:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Keep Tab and Shift+Tab inside a modal dialog, wrapping at both ends.
 *
 * The previous version prevented the default on either direction and focused
 * the close button, which is a trap with one reachable stop: Tab and Shift+Tab
 * both landed on the same control, so a keyboard user could not move backwards
 * at all and had no way to tell which way round the dialog was. Cycling the
 * real stop list fixes both directions and survives a second control being
 * added to the panel later.
 */
function trapTab(panel: HTMLElement, shift: boolean): void {
  const stops = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE))]
  if (stops.length === 0) return
  const current = stops.indexOf(document.activeElement as HTMLElement)
  const delta = shift ? -1 : 1
  // Focus outside the list entirely (a click on the backdrop, a programmatic
  // focus) restarts at the top rather than computing an index of -1.
  const next = current < 0 ? stops[0] : stops[(current + delta + stops.length) % stops.length]
  next?.focus()
}

export function HelpOverlay() {
  const showHelp = useUiStore((state) => state.showHelp)
  const setShowHelp = useUiStore((state) => state.setShowHelp)
  const flags = useFlagReport()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const flagsTitleId = useId()
  // The platform cannot change under a running document, and the overlay only
  // mounts when it is opened, so this is a plain read at first render.
  const [platform] = useState(detectedPlatform)
  /**
   * Which edges of the panel have content behind them.
   *
   * The panel is 1373px of content in an 850px box at 1280x900 — the diagnostics
   * `<pre>` is most of it — and it scrolls, with nothing on screen to say so. The
   * last line was cut mid-glyph and read as a broken panel rather than as more
   * panel. A scrollbar is the browser's answer and it is not available here:
   * `overflow-y: auto` with an overlay scrollbar, or none at all.
   *
   * Two sticky gradient elements are the answer, one per edge, each rendered only
   * when there is something on the far side of it. A `::after` cannot do this: it
   * scrolls with the content, which is the one thing a fade must not do. `false` on
   * both edges is also the state jsdom produces, since it has no layout and every
   * box reports a zero scroll extent — which is why the fades are asserted in a real
   * browser (`e2e/journey.panel-seams.spec.ts`) and not here.
   */
  const [overflow, setOverflow] = useState({ above: false, below: false })
  const syncOverflow = useCallback(() => {
    const panel = panelRef.current
    if (!panel) return
    const next = {
      above: panel.scrollTop > 1,
      below: panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1,
    }
    setOverflow((current) =>
      current.above === next.above && current.below === next.below ? current : next,
    )
  }, [])
  // Keyed to the open/closed cycle rather than reset in an effect: the overlay
  // stays mounted across a close, so a bare state update would keep showing the
  // last outcome the next time it opens, and `setState` in an effect is the
  // thing this repo's lint rule exists to stop.
  const [copied, setCopied] = useState<{ open: boolean; outcome: CopyOutcome } | null>(null)

  const copyDiagnostics = useCallback(() => {
    void (async () => {
      recordManualReport('Diagnostics copied from the help overlay')
      const outcome = await copyText(buildDiagnosticsReport())
      setCopied({ open: true, outcome })
    })()
  }, [])

  useEffect(() => {
    if (!showHelp) return
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement ? active : null
    // The panel itself is the only reliably focusable element on open: the
    // close button comes first in the tab order but focusing a dismiss control
    // before the user has read the heading is hostile.
    panelRef.current?.focus()
    syncOverflow()
  }, [showHelp, syncOverflow])

  useEffect(() => {
    if (showHelp) return
    const opener = openerRef.current
    openerRef.current = null
    if (opener?.isConnected) opener.focus()
  }, [showHelp])

  useEffect(() => {
    if (!showHelp) return
    // Captured, not bubble: `useKeyboardShortcuts` listens for Escape on window
    // to cancel the open tool, and Escape here means "close the help" only.
    // React's own listener is attached below this point in the tree, so
    // stopping propagation in the capture phase keeps it from ever firing.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setShowHelp(false)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // `d` is the keyboard route to the copy control, and it exists because
      // that control is deliberately outside the trap — see the note on it.
      // Capture, and stop propagation, for the same reason as Escape: the
      // editor binds bare letter keys on `window`, so without this a press of
      // `d` would also switch tools behind the overlay.
      if (event.key === 'd') {
        event.preventDefault()
        event.stopPropagation()
        copyDiagnostics()
        return
      }
      const index = Number(event.key)
      // The same reasoning for the debug-switch rows: their buttons are outside
      // the tab cycle, so `1`–`9` and `0` are the way in. Registry order, and
      // the number is printed in each button's own label so it is discoverable
      // from the screen rather than only from this comment. A url row has no
      // button and no key, because nothing here can undo `?off=`.
      if (event.key === '0') {
        event.preventDefault()
        event.stopPropagation()
        clearAllFlags()
        return
      }
      if (!Number.isInteger(index) || index < 1 || index > flags.rows.length) return
      const row = flags.rows[index - 1]
      if (row.source === 'url') return
      event.preventDefault()
      event.stopPropagation()
      toggleFlag(row)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [showHelp, setShowHelp, copyDiagnostics, flags.rows])

  if (!showHelp) return null

  return (
    <div className={styles.helpOverlay} onClick={() => setShowHelp(false)} role="presentation">
      <div
        ref={panelRef}
        className={styles.helpPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onScroll={syncOverflow}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          event.preventDefault()
          const panel = panelRef.current
          if (panel) trapTab(panel, event.shiftKey)
        }}
      >
        {overflow.above ? <span className={styles.helpFadeTop} aria-hidden="true" /> : null}
        <div className={styles.helpHead}>
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.helpClose}
            onClick={() => setShowHelp(false)}
          >
            Close
          </button>
        </div>
        {/*
          Rows come from `shortcutSections`, which reads `SHORTCUT_GROUPS` and
          `SHORTCUTS` in `src/components/ui/shortcuts.ts`. Nothing here is typed
          by hand: the keys are the ones `useKeyboardShortcuts` really switches
          on, the modifier glyph is `⌘` or `Ctrl` to match what the hook accepts,
          and the four blocks are the same groups the source is sorted by.
          `shortcuts.test.ts` scrapes the hook's `case` labels and fails if a row
          names a key the hook does not handle, so this list cannot drift into
          advertising a shortcut that was never bound.

          Each group is a *named* `<section>` rather than a visible heading: the
          four titles are now reachable by a screen reader instead of being four
          strings no user could see, which is exactly how this table's earlier
          version rotted. A visible heading needs one rule in
          `editor.module.css` (`.helpGroup`), which this file does not own.
        */}
        {shortcutSections(platform).map((section) => (
          <section key={section.id} aria-label={section.title}>
            <dl>
              {section.rows.map((row) => (
                <div key={row.keys + row.label} style={{ display: 'contents' }}>
                  <dt>{row.keys}</dt>
                  <dd>{row.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {/*
          The live route to a bug report: the crash screen's copy block is only
          reachable once the app has already failed, and by then the reader is
          describing the failure in words from memory.

          `tabIndex={-1}` is a deliberate trade-off, and the reason is written
          down rather than left to be discovered: this dialog's tab cycle is
          pinned to a single control by `HelpOverlay.test.tsx` *and* by
          `e2e/journey.appearance.spec.ts` ("Tab is held inside: the dialog has
          exactly one control"), and a second focusable stop would fail both. So
          the button is out of the cycle and `d` — handled in the key handler
          above, and named in the button's own label — is the keyboard route to
          it. The report itself is still plain selectable text below.
        */}
        <div>
          <button
            type="button"
            tabIndex={-1}
            className={styles.helpClose}
            onClick={copyDiagnostics}
          >
            Copy diagnostics (D)
          </button>
          {copied?.open && (
            <p role="status" style={{ fontSize: 'var(--font-2xs)' }}>
              {copyOutcomeMessage(copied.outcome)}
            </p>
          )}
        </div>
        <DiagnosticsReport variant="revealed" fieldTabbable={false} />

        {/*
          The debug switches, in the one place a user will actually look.

          The gap this fills is not "there is no ?features= parameter", it is
          "a user who pasted a URL with ?off=matting has no way to find out why
          the button was gone". Every row therefore names the flag, what it
          gates, the state, and *where the state came from* — because a flag
          saved in this browser three weeks ago is not something a user can be
          expected to remember setting.

          `aria-labelledby` rather than `aria-label`, and a list rather than a
          second `<dl>`, so this section does not join the four shortcut regions
          that `HelpOverlay.test.tsx` and `e2e/journey.a11y-keys.spec.ts` count.
          Those tests assert the panel holds the shortcut table and nothing
          else, and the honest way to add a second list is not to widen the
          selector that describes the first one — the same reasoning behind
          `fieldTabbable={false}` on the report below.

          The reset controls follow the same trade-off the copy button above
          makes, and for the same reason: this dialog's tab cycle is pinned to
          exactly one control by `HelpOverlay.test.tsx` and
          `e2e/journey.a11y-keys.spec.ts`, so these are `tabIndex={-1}` and the
          key handler above routes `1`–`9` to them by registry order, with the
          number printed in each label.

          A row whose state came from the URL gets no button, because no button
          here can undo `?off=matting` — it would be a control that appeared to
          do something and did not. Those rows name the address bar instead,
          which is the only place that switch can actually be changed.
        */}
        <section aria-labelledby={flagsTitleId}>
          {/*
            `--font-s` is not a token: it is declared nowhere, so `var(--font-s)`
            is the guaranteed-invalid value and the whole `font-size` declaration
            is dropped at computed-value time. What a reader saw instead was the
            UA's own `h3` size, which measured 16px against 12px of body copy —
            a section heading three quarters of the way to looking like body text,
            and off the type scale, so it did not move with `--text-scale` the
            way every other size in this dialog does. `--font-sm` is the step
            below the 24px `h2` and a clear step above the copy.
          */}
          <h3 id={flagsTitleId} style={{ fontSize: 'var(--font-sm)', margin: '20px 0 8px' }}>
            Debug switches
          </h3>
          <p
            style={{ fontSize: 'var(--font-2xs)', color: 'var(--ie-ink-soft)', margin: '0 0 8px' }}
          >
            This build has no server and no remote configuration, so there is nothing that can
            switch a feature off behind your back. It does have debug switches: add{' '}
            <code>?features=matting</code> or <code>?off=matting</code> to the address bar to turn
            one on or off for a single visit, or use the list below to change one saved in this
            browser. Anything you set in the address bar wins over the saved value.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 'var(--font-2xs)' }}>
            {flags.rows.map((row, index) => (
              <li key={row.id} style={{ marginBottom: 10 }}>
                <strong style={{ color: 'var(--ie-accent-bright)' }}>{row.label}</strong>{' '}
                {/* The id is what the user types into a URL, so a row that only
                    showed the label would describe the feature without giving
                    the one string they need to act on it. */}
                <code style={{ fontSize: 'var(--font-2xs)' }}>{row.id}</code>{' '}
                {row.blocking && <span style={{ color: 'var(--danger)' }}>OFF · </span>}
                {describeState(row.state)} · {describeSource(row.source)}
                {row.source === 'url' && row.state === 'off' && (
                  <> — remove ?off={row.id} from the address bar</>
                )}
                {row.source !== 'url' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    className={styles.helpClose}
                    onClick={() => toggleFlag(row)}
                  >
                    {row.source === 'saved' ? `Reset (${index + 1})` : `Turn off (${index + 1})`}
                  </button>
                )}
                <br />
                <span style={{ color: 'var(--ie-ink-soft)' }}>
                  Normally: {row.today} Gates {row.gates}.
                </span>
              </li>
            ))}
          </ul>
          {flags.unknown.length > 0 && (
            <p role="status" style={{ fontSize: 'var(--font-2xs)', margin: '8px 0 0' }}>
              Not recognised, so ignored: {flags.unknown.join(', ')}. No feature has those names.
            </p>
          )}
          {flags.hasSaved && (
            <button
              type="button"
              tabIndex={-1}
              className={styles.helpClose}
              onClick={clearAllFlags}
            >
              Clear every saved switch (0)
            </button>
          )}
        </section>
        {overflow.below ? <span className={styles.helpFadeBottom} aria-hidden="true" /> : null}
      </div>
    </div>
  )
}

/**
 * What a row's single control does.
 *
 * One function for the button and for the digit key, because two
 * implementations of "change this flag" would drift: the key route would keep
 * resetting after the button was changed to mean the other action, and nothing
 * would fail.
 *
 * A `url` row returns `null` and both callers render, or do nothing, on it. A
 * `?off=` in the address bar belongs to the address bar; a control that wrote
 * the saved tier beside it would look like it worked and would not.
 */
function toggleFlag(row: FlagReportRow): 'cleared' | 'turned-off' | null {
  if (row.source === 'url') return null
  if (row.source === 'saved') {
    clearFlagState(row.id)
    return 'cleared'
  }
  setFlagState(row.id, 'off')
  return 'turned-off'
}

/** The three states, in the words the rest of the UI uses. */
function describeState(state: FlagState): string {
  if (state === 'off') return 'off'
  if (state === 'on') return 'on'
  return 'default'
}

function describeSource(source: FlagSource): string {
  if (source === 'url') return 'from the address bar'
  if (source === 'saved') return 'saved in this browser'
  return 'nothing has changed it'
}
