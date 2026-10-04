import { confirmDestructive, type ConfirmRequest } from './confirm'

/**
 * The question every *irreversible* destructive control asks.
 *
 * `confirm.ts` is the one dialog and `newImageRequest` in `editorEntry.ts` is one
 * caller's copy. These are the other three, in one pure module rather than four
 * strings inside four components, because every string here is greppable in this
 * file and testable without a browser — which is why this is not inline JSX again.
 *
 * **The rule has two halves, and both halves matter.**
 *
 * - **Irreversible → ask.** Exactly four, named in `IRREVERSIBLE_ACTIONS` so that
 *   adding a fifth is a decision somebody can see rather than a habit:
 *   `New image` (which `load()`s a different document and takes the undo stack
 *   with it), `Discard session` and `Start over` (the stored photograph, which is
 *   never written anywhere else), and `Delete preset` (a recipe the user typed,
 *   living only in this browser's `localStorage`). `Ctrl/Cmd+Z` reaches none of
 *   them, so the question is the only recovery the app can offer.
 * - **Recoverable by undo → act.** `Reset all edits`, `Clear strokes`,
 *   `Delete layer` and `Remove frame` — `UNDOABLE_ACTIONS`. Each is exactly one
 *   `Ctrl/Cmd+Z` away from where it was, each pushes a history entry of its own,
 *   and Undo is on screen in the same frame as the control that did it. A dialog
 *   in front of them is a second decision about work the user can already get
 *   back, and it is paid on every press rather than once — which is how an app
 *   teaches people to press through dialogs, and the dialog that matters is one
 *   of those. So these controls act on the press, and they have **no builder
 *   here at all**: the absence is the convention, and `destructive.test.ts` pins
 *   it rather than leaving it to whoever reads this file next.
 *
 * An earlier version of this file asked on both sides, on the reasoning that
 * asking is cheap. It is cheap for whoever writes the control and it costs the
 * user a decision every time, forever. The symptom was a dialog reading "The one
 * stroke on this layer is removed." over a photo being annotated, with Undo
 * sitting in the top bar beside it.
 *
 * No component imports anything from here, and nothing here imports React, so
 * this file can be read in one sitting and tested in jsdom-free unit tests.
 */

const edits = (count: number): string => (count === 1 ? '1 edit' : `${count} edits`)

/**
 * The four controls whose loss `Ctrl/Cmd+Z` cannot undo, and therefore the only
 * four that ask.
 *
 * A list rather than a comment because it is the thing a reviewer has to check
 * whenever an eighth destructive control turns up: if it is not here, it needs a
 * reason to be absent, and "it was too small to bother asking" is not one.
 */
export const IRREVERSIBLE_ACTIONS = [
  'New image',
  'Discard session',
  'Start over',
  'Delete preset',
] as const

/**
 * The four that act on the press because Undo answers for them.
 *
 * `destructive.test.ts` asserts this list and the absence of any builder for the
 * names in it, so adding a confirmation to one of these four — or quietly moving
 * one across — fails a test rather than shipping.
 */
export const UNDOABLE_ACTIONS = [
  'Reset all edits',
  'Clear strokes',
  'Delete layer',
  'Remove frame',
] as const

/**
 * Ask, then act — the one shape every asking control in the app uses.
 *
 * Written here rather than at each call site so the `null` rule is enforced in one
 * place: a builder that returns `null` means "there is nothing to lose", and
 * `commit` runs immediately. That is the same contract as `newImageRequest`,
 * which is the reason it is here rather than inlined as `if (await confirm…)` at
 * every caller, and it is what keeps a control with nothing to lose quiet.
 *
 * The three builders below never return `null` — each of them always has something
 * to lose, which is the only reason they are builders at all.
 *
 * It returns whether the action ran, so a caller that needs to say something
 * afterwards (a toast, a focus move) can tell "declined" from "done".
 */
export async function confirmThen(
  request: ConfirmRequest | null,
  commit: () => void,
): Promise<boolean> {
  if (request !== null && !(await confirmDestructive(request))) return false
  commit()
  return true
}

/**
 * "Discard" on the resume card.
 *
 * Always asks, never silent: the card only exists because there is a stored
 * document, and pressing this is the only thing in the app that deletes one. There is no undo
 * stack to fall back on, which is why the body says so rather than implying that
 * Resume is still around afterwards.
 */
export function discardSessionRequest(editCount: number): ConfirmRequest {
  return {
    title: 'Discard this session?',
    body:
      `The stored photo and its ${edits(editCount)} are deleted from this device. There is no ` +
      'Undo for this — the photo came off your files, but these edits were never written anywhere ' +
      'else, and once this is pressed they are gone.',
    confirmLabel: 'Discard session',
    tone: 'destructive',
  }
}

/**
 * "Delete <preset>" in the presets popover.
 *
 * A preset is a recipe the user typed, it lives only in this browser's
 * `localStorage`, and nothing in the app can rebuild it.
 */
export function deletePresetRequest(name: string): ConfirmRequest {
  return {
    title: `Delete “${name}”?`,
    body:
      `The saved preset “${name}” is removed from this browser. It cannot be brought back — a ` +
      'preset is only ever the copy you saved, and there is no second copy.',
    confirmLabel: 'Delete preset',
    tone: 'destructive',
  }
}

/**
 * "Start over" on the crash screen.
 *
 * The one control in the app that deletes the user's photograph *and* its edits in
 * one press, and the crash screen is where someone is most likely to press
 * something without reading it.
 */
export function startOverRequest(editCount: number): ConfirmRequest {
  return {
    title: 'Start over?',
    body:
      `This deletes the stored photo and its ${edits(editCount)} from this device and returns you ` +
      'to the import screen. Your photo file itself is not touched, but nothing here can be ' +
      'recovered afterwards.',
    confirmLabel: 'Start over',
    tone: 'destructive',
  }
}
