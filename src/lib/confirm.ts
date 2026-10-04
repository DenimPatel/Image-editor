/**
 * One confirmation, asked once.
 *
 * The app had no confirmation anywhere in `src/` when this was written, so the
 * first one is also the convention: every irreversible control asks through
 * `confirmDestructive`, and `confirm.test.ts` fails the build if a
 * `window.confirm` appears anywhere else. Eight bespoke dialogs would have been
 * eight chances to ship a modal with no focus trap, no Escape and no restore.
 *
 * **What comes through here, and what does not.** Anything `Ctrl/Cmd+Z` cannot
 * bring back. `Reset all edits`, `Clear strokes`, `Delete layer` and `Remove
 * frame` are each one keystroke from where they were, each pushes a history entry
 * of its own, and Undo is on screen in the same frame as the control that did it
 * — so a dialog in front of them is a second decision about work the user can
 * already get back, and it is paid on every press rather than once. That
 * repetition is what teaches people to press through dialogs, and the dialog that
 * matters is one of those. The four that do ask are named in
 * `IRREVERSIBLE_ACTIONS` in `destructive.ts`, which is the list to check when an
 * eighth destructive control turns up.
 *
 * **Why not `window.confirm`.** The browser's own alert is a synchronous modal
 * on the *document*: it cannot be styled to match the app, it traps focus
 * without announcing a title to a screen reader, it names its only safe control
 * "Cancel" in the OS's language rather than the app's, and Playwright cannot
 * locate it by role or name at all — so every assertion about it would be an
 * assertion about browser chrome, which is exactly the class of test this repo
 * refuses to write. `ConfirmDialog` is the app's own surface, and it is
 * testable.
 *
 * The imperative shape (`await confirmDestructive({...})`) is deliberate: the
 * caller reads as the sentence it is, and the dialog's state — which request is
 * open, who opened it — lives in one place rather than in every caller that
 * forgot to write a `useState`.
 */

/** How loud the confirm control is. `destructive` paints it in the danger ink. */
export type ConfirmTone = 'destructive' | 'neutral'

export type ConfirmRequest = {
  /** The heading, and the dialog's accessible name. What is about to happen. */
  title: string
  /** The consequence, in the app's own words: what is lost and what is not. */
  body: string
  /**
   * The control that commits. Never a bare `OK` or `Yes`: the button that
   * destroys a photograph says so, because on a small screen the two controls
   * sit side by side and "OK" tells the reader nothing about which one they are
   * about to press.
   */
  confirmLabel: string
  /** The safe control. Defaults to `Cancel`, which is what every platform says. */
  cancelLabel?: string
  tone?: ConfirmTone
}

export type ConfirmHost = {
  confirm: (request: ConfirmRequest) => Promise<boolean>
}

export const CANCEL_LABEL = 'Cancel'

let host: ConfirmHost | null = null

/**
 * The mounted dialog claims this slot while it is alive.
 *
 * A module-level slot rather than a React context because the callers are
 * ordinary functions — `handleNewImage` is a `useCallback`, not a component —
 * and a context would force every one of them to consume a hook that only
 * returns a function. It is the same reason `docStore` is a module singleton:
 * there is one editor, so there is one dialog.
 */
export function registerConfirmHost(next: ConfirmHost | null): void {
  host = next
}

/**
 * Ask. Resolves `true` only for the confirm control; `Escape`, the safe control,
 * a backdrop press and an unmount all resolve `false`.
 *
 * `false` rather than a throw when nothing is mounted: a confirmation that
 * throws takes the caller down with it, and a destructive action that was never
 * asked about must not then happen.
 */
export function confirmDestructive(request: ConfirmRequest): Promise<boolean> {
  return host ? host.confirm(request) : Promise.resolve(false)
}

/** True while a dialog is mounted, so a caller can assert on it without rendering. */
export function confirmHostMounted(): boolean {
  return host !== null
}
