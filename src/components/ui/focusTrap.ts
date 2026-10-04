/**
 * The one focus trap, extracted.
 *
 * Two modals need it — the help overlay and the destructive confirmation — and a
 * second copy is how the two drift into disagreeing about what "inside the
 * dialog" means. It lives here rather than inside either of them so a third modal
 * cannot quietly arrive with a third definition.
 */

/**
 * Everything focusable inside the dialog, in DOM order.
 *
 * The dialog itself is a stop because it is what focus lands on when the dialog
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
 * The help overlay has three such controls — the diagnostics copy button, the
 * diagnostics text field, and the debug-switch resets — and each reaches the
 * keyboard by its own labelled key instead.
 */
export const TABBABLE = [
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
 * The first version prevented the default on either direction and focused the
 * close button, which is a trap with one reachable stop: Tab and Shift+Tab both
 * landed on the same control, so a keyboard user could not move backwards at all
 * and had no way to tell which way round the dialog was. Cycling the real stop
 * list fixes both directions and survives a second control being added later.
 */
export function trapTab(panel: HTMLElement, shift: boolean): void {
  const stops = [panel, ...Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE))]
  if (stops.length === 0) return
  const current = stops.indexOf(document.activeElement as HTMLElement)
  const delta = shift ? -1 : 1
  // Focus outside the list entirely (a click on the backdrop, a programmatic
  // focus) restarts at the top rather than computing an index of -1.
  const next = current < 0 ? stops[0] : stops[(current + delta + stops.length) % stops.length]
  next?.focus()
}
