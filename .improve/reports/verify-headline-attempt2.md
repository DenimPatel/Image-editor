# Verify — headline fix, attempt 2 (independent)

Reviewer did not write this change. Scope: the UX judgement on the new
confirmation convention, the six two-click e2e edits, an independent check of the
IndexedDB data-loss fix, and one live browser pass. Gates, the reload assertion, the
Tab trap and coverage were established by a previous reviewer and are **not** re-run
here beyond `npx prettier --check .` and `npm test`.

Branch `improve/auto-20261004`, uncommitted. Specs: `.improve/FEATURES.md`
IMP-002/001/005/006. Implementer's report: `.improve/reports/impl-headline.md`.

---

## 1. The UX judgement — prompting on undoable actions is a regression

**Verdict: attempt 2's rule change is wrong, and it is the one substantive defect in
this change.** The seven prompts are not a coherent convention; four of them are
confirmation fatigue, and the owner asked for better journeys, not more questions.

### What changed

Attempt 1 followed IMP-002: *"reversible actions (anything undoable) do not need a
modal — use undo."* Attempt 2 changed the rule to *"ask unless it would destroy
nothing"* (`src/lib/destructive.ts:8-20`). Undo stopped being the exemption. All
seven existing destructive controls now prompt.

### The rule that should have been kept

**Prompt when `Ctrl/Cmd+Z` cannot bring the state back. Do not prompt when it can.**

That is not "it depends" — it is one question with a yes/no answer, and the app can
answer it for every control it has. The cost of getting it wrong is asymmetric, and
both sides are real:

- Wrong by prompting when undo exists: the user pays a keystroke, a read, and a
  decision on an action they were always going to be able to take back. Repeated
  across four controls, this teaches people to press through dialogs — which is
  precisely the failure mode that makes the *next* dialog, the one that matters,
  get dismissed without being read.
- Wrong by not prompting when undo does not exist: the user loses a photograph.

The first cost is paid thousands of times. The second is paid once. That asymmetry is
the whole argument, and attempt 2 inverted it by treating "asking is cheap" (for the
implementer, writing it once) as if it were cheap for the user (pressing it every
time, forever). The file's own comment makes the substitution: *"Asking is cheap and
reversible."* Cheap for whom? A dialog costs the user a decision. The implementer
pays it once per control; the user pays it per press.

Note also that attempt 2's own reasoning contradicts its own code. The comment at
`destructive.ts:10-12` says the old rule was wrong because it produced "a
confirmation and no convention" — but the fix it shipped is *more* confirmations,
which deepens the fatigue rather than resolving it. And `confirm.ts:10-13`, the
module that documents itself as *the* convention, still states the rule attempt 2
replaced:

> **What does not come through here.** Anything undoable. `Reset all edits`,
> `Clear strokes` and `Delete layer` are all `Ctrl/Cmd+Z`-able, so a dialog in
> front of them is a second decision about work the user can already get back.

So the two files that define the convention document **two opposite rules**. One of
them is wrong, and the one written first (`confirm.ts`) is the one the owner's spec
backs. That contradiction is itself a defect: a convention documented in two places
with different content is not a convention.

### The specific list

**MUST prompt (4).** All four are actions `Ctrl/Cmd+Z` cannot undo:

| Control | Why it must ask |
| --- | --- |
| **New image** | Replaces the document via `load()` (`Editor.tsx:474`), so there is no undo entry and the undo stack is gone. The dialog body already admits it cannot honour the count with Ctrl+Z. Confirmed and already correct in the code. |
| **Discard session** | Deletes the stored photo and its edits from the device. There is no undo stack on the resume card at all — the page it lives on *is* the undo stack. `destructive.ts:89-99` says so. |
| **Start over** (crash screen) | Same permanent deletion, on the screen where a person is most likely to press something without reading. `RouteError.tsx` was previously firing it on one press. |
| **Delete preset** | A preset is a recipe the user typed, it exists only in this browser's `localStorage`, and nothing in the app can rebuild it. Before this change its only feedback was a 3.2 s toast (D-05). This is the single clearest win in the change. |

**MUST NOT prompt (4).** All four are one `Ctrl/Cmd+Z` away from where they were:

| Control | Why it must not ask |
| --- | --- |
| **Clear strokes** | The worst offender, and the one the screenshots make undeniable. `verify2/03-desktop-clear-strokes-dialog.png` shows the dialog for **one stroke**: *"The one stroke on this layer is removed."* A two-sentence modal with a red button to delete one pen mark, on a panel where the user is mid-drawing and iterating. This is the modal that teaches people to press through modals. |
| **Delete layer** | Undoable, and the row being deleted is on screen with the Undo button two taps away in the top bar. `EditorTopBar` already carries Undo/Redo. |
| **Remove frame** | Identical act — both call `removeLayer` (`destructive.ts:127-129` says so explicitly), so it inherits the same answer. One act, one answer; a rule that splits them is not a rule. |
| **Reset all edits** | `docStore.reset` pushes an undo step of its own, so `Ctrl+Z` restores the entire edit stack *and* the stack. It is the most recoverable control in the app, and it now has the longest dialog body in it. |

### What should be kept from the mechanism

The parts of the change that are right and should survive the rule reversal:

- **`null` means "nothing to lose".** `resetEditsRequest(0)`,
  `clearStrokesRequest(0)` and `newImageRequest(0)` returning `null` for a pristine
  document is the right instinct, and `journey.new-image.spec.ts:249` states the
  principle in the implementer's own words — *"a confirmation in front of an action
  that destroys nothing is the dialog that teaches people to press through
  dialogs."* The principle is correct. It was then applied to undoability being
  zero rather than to undoability being **recoverable**, which is where it stops
  being right.
- **Cancel is the focused control.** Visible in both screenshots: "Cancel" carries the
  focus ring, so `Enter` cannot destroy anything. Correct, and it should apply to
  all four remaining prompts.
- **The confirm button names the action** ("Clear strokes", not "OK"). Correct.
- **`confirmThen` in one place** (`destructive.ts:47-54`) so the `null` case cannot be
  got wrong per call site. Correct; keep it.

### Cost if the owner keeps it as shipped

The drawing flow is the clearest loss: clear, redraw, adjust, clear again. Each
iteration now costs a modal. `Clear` and `Delete layer` sit side by side at the
bottom of the Draw panel, so the two most-repeated destructive gestures in the app
are the two that became hardest. Against a stated goal of *"get this app using as much
as possible"*, adding a click-cycle to the retouch loop works directly against it.

---

## 2. The two-click e2e edits — audit, per file

Every file below was diffed line by line against its pre-change version. In all
cases the assertion that existed before still exists; four of the six gained
assertions.

| File | Verdict | Detail |
| --- | --- | --- |
| `e2e/journey.layers.spec.ts` | **Properly updated — strengthened** | Adds the dialog acknowledgement at `:161-168` **and** a new negative assertion: `expect((await readDoc()).layers).toHaveLength(1)` between the press and the confirm. That proves the press alone did not delete, which the old single-press test could not distinguish. Net gain. |
| `e2e/journey.layer-panels.spec.ts` | **Properly updated — strengthened** | `:169-178` acknowledges the dialog and asserts `toContainText('only layer')`, pinning the last-layer wording. Both pre-existing assertions (`layers` length 0, empty-state text) retained after `settle()`. |
| `e2e/journey.shell.spec.ts` | **Properly updated — strengthened** | `:458-467` same shape; the pre-existing `expect.poll(...watermark length).toBe(0)` is untouched. |
| `e2e/journey.reload-loss.spec.ts` | **Properly updated — strengthened** | `:107-118` acknowledges the dialog and asserts the body contains `'no Undo'` — a claim about the irreversibility that the test then proves with the mirror check and the absence of Resume. Both original assertions retained. |
| `e2e/journey.new-image.spec.ts` | **New file, not an edit.** All 8 cases assert more than they replace. | Nothing was removed. The three `test.skip(webkit)` calls are all the same documented reason as `journey.reload-loss.spec.ts` (WebKit aborts the Blob write transaction, so no row ever lands — a genuine environment limit, stated in the skip message, not a case disabled to stay green). |
| `e2e/journey.hub-reentry.spec.ts` | **New file, not an edit.** All 4 cases assert more than they replace. | The "Start over" case at `:220-238` asserts the dialog appears, Cancel is focused, **Escape leaves the crash screen up** (`:227-229`, the case that would go unnoticed if the button only worked when pressed twice), then presses twice. |

**No weakened, deleted or skipped assertion in any of the six.** No `test.fixme`, no
`test.skip` added to a modified spec, no `expect` removed.

Two **strengthenings** outside the six, also worth recording:

- `e2e/journey.panel-seams.spec.ts:216-236` — the More-menu row count went 7 → 8 and
  separators 2 → 3, with the new row's own group explained in a comment. The count
  was updated to match reality rather than relaxed.
- `e2e/fixtures.ts:348,391-406` — `appBase` now prefers `baseURL` over the live URL.
  The old version derived the module base from `page.url()`, which on `/editor/adjust`
  produced `/Image-editor/editor/` — a path that serves no modules, so the dynamic
  import failed and the `catch` fell back to reading IndexedDB, i.e. to a row that
  does not exist. The fix removes a misleading-failure path rather than papering over
  one. **Strengthening**, and a genuine latent bug fix.

One press of a destructive control sits in a spec that needed no change and correctly
got none: `e2e/journey.appearance.spec.ts:70-76` locates the "Reset all edits"
menuitem to measure `min-height` and never clicks it.

---

## 3. The data-loss fix — independently verified

**Verdict: the fix holds.** The claim in `impl-headline.md` is accurate and the
ordering is load-bearing rather than incidental.

### The path, as read

`replaceDocument` (`src/pages/Editor.tsx:466-486`):

1. `autosaveRef.current?.cancel()`
2. `load(createDoc())` — synchronous, same frame as the click
3. `await autosaveRef.current?.idle()`
4. `await forgetStoredDocument()`

### Why the old row cannot come back

Three independent reasons, each sufficient:

**(a) The armed debounce is dropped.** `cancel()` (`autosave.ts:185-201`) clears
`dirtySince` and the timer, so the pending write for the replaced document never
starts.

**(b) The follow-up write is dropped.** This is the real fix. `run()` sets `queued`
when a `schedule()` lands while a write is in flight and re-enters itself after the
in-flight write settles (`autosave.ts:159`). That follow-up is a write of the
*replaced* document, and it fires a microtask after the delete — which is precisely
how the row was being recreated by the gesture that replaced it. `cancel()` now clears
`queued` unconditionally, including while a write is in flight
(`autosave.ts:198-199`), so that follow-up never happens. The old
`if (inFlight) return` guard was about the *current* write and said nothing about the
queued one; that reasoning was wrong in exactly the direction that mattered, and the
comment at `autosave.ts:194-198` says so.

**(c) The in-flight write is awaited before the delete, and it has actually
committed.** `saveSession` awaits `transaction.done` (`session.ts:197`), not just the
request, so when `save()` resolves the IndexedDB transaction has completed.
`idle()` (`autosave.ts:202-208`) reads `inFlight` once into a local and awaits it, so
it cannot observe a later write. Only then does `forgetStoredDocument()` run
(`forget.ts:41-44`), issuing `clearMirror()` synchronously and then `clearSession()`.
The delete transaction is created after the write transaction completed, and IndexedDB
serialises overlapping transactions by creation order, so the delete definitively wins.

**Nothing schedules a compensating write afterwards.** The autosave effect is keyed on
`[source, revision]` and returns early with no source (`Editor.tsx:522-525`), and
`load(createDoc())` happens at step 2, before the first `await`. The teardown path is
also safe: `flush()` calls `mirror()` before checking `dirtySince`
(`autosave.ts:169-179`), but the mirror closure is guarded by `if (doc.source)`
(`Editor.tsx:224-229`) and the document is already source-less, so `pagehide` during
the replacement writes nothing and starts no row.

### On writing a test for it

I did not add one, and I want to be explicit about why rather than silently skip it.
The race is already covered at the layer it lives at, by tests that are already in
the working tree and whose comments state the same reasoning I arrived at
independently:

- `src/lib/persist/autosave.test.ts:313-340` — *"drops the follow-up write a queued
  edit would fire behind an in-flight one"*. This fails without the `queued = false`
  line. It is the test that makes the fix load-bearing.
- `autosave.test.ts:342-366` — *"`idle()` does not resolve until a write already in
  flight has settled"*, which is what makes the ordering load-bearing.
- `autosave.test.ts:261-276` — `cancel()` drops a write that has not started.

A fourth test at the `replaceDocument` level would have to re-test the same two
properties through a jsdom store plus a fake autosave, i.e. assert the wiring rather
than the mechanism, and would pass even if the mechanism regressed as long as the
call order held. The browser-level half — a real `page.reload()` showing the import
screen, the mirror null and the IndexedDB row absent — was already established by the
previous reviewer. Adding a weaker duplicate of tests that already fail on the
regression would be coverage theatre.

### One residual window, low severity, not a blocker

`forgetStoredDocument` clears the mirror **first**, synchronously, and only then awaits
`clearSession()`. Between those two statements a teardown kills the delete transaction
while the mirror is already gone — and a **row without its mirror is the dangerous
half**, by the change's own analysis (`Editor.tsx:459-468`): `resolveResumableSession`
returns a row as-is, so a reload in that window would offer the replaced photograph
again. The window is the duration of one IndexedDB delete, single-digit milliseconds,
and it is not reachable by hand. It is worth noting because it is the same failure
mode the feature exists to prevent, at 1/500th the width; reversing the order would
close it but reintroduce the mirror-resurrection window the module's own comment
(`forget.ts:16-19`) rejects. Neither order is free. Not worth a finding.

---

## 4. The confirmation in a real browser

Dev server already running on 5173; used it, did not start or stop another. See
`.improve/artifacts/headline/verify3/`.

### From the prior screenshot set

`verify2/03-desktop-clear-strokes-dialog.png` is the strongest evidence in this
review and it is a picture of the problem, not of the feature. The dialog reads
**"Clear all strokes?"** for **one** stroke, with a two-sentence body and a red
"Clear strokes" button, over a photo the user is actively annotating. Behind it the
Draw panel still shows `Clear` and `Delete layer` side by side, and the top bar still
carries Undo. Three recovery affordances are visible in the same frame as a modal
about deleting one pen mark. The dialog is well-built — clear heading, Cancel
focused, danger-inked commit — and it is **disproportionate**, which is a different
failure from a badly-built one and is not fixed by styling.

`verify2/09-mobile-reset-dialog.png` shows the same at 390×844: a four-line body for a
menu row that is itself a single undo step. It fits the width fine, so this is purely
a proportion problem, not a layout problem.

### Live pass

Driven against the running dev server on **5173** (used it; did not start or stop
one). One representative undoable action — **Clear strokes** — at both widths.
Screenshots in `.improve/artifacts/headline/verify3/`:

- `01-desktop-1280x800-clear-strokes-dialog.png`
- `02-mobile-390x844-clear-strokes-dialog.png`

Procedure: import Sample 1, open Draw, drag one stroke on the canvas with the mouse,
press `Clear`, inspect, press Escape, then read the **live** store (resolved through
`performance.getEntriesByType('resource')`, per `AGENTS.md`'s rule about the second
module instance) to confirm whether the stroke survived.

Observed, at **1280×800**:

- The dialog appears with heading **"Clear all strokes?"** and the body *"The one
  stroke on this layer is removed."* — one stroke, confirmed by the live store, not
  by assumption.
- `document.activeElement` is the `Cancel` **button** on entry, and the focus ring is
  plainly visible in the screenshot. `Enter` cannot destroy the stroke.
- `Escape` → dialog gone (`role=dialog` count 0), live store still
  `{ past: 1, strokes: [1] }`, focus returned to `Clear`. Correct.
- The `↶ Undo` button is visible in the top bar of the same frame, one press away.

Observed, at **390×844**:

- Same dialog, rendered as a bottom sheet with a drag handle. Cancel focused, ring
  visible, buttons fit the width, no clipping, nothing overlapping.
- `Escape` → the only remaining `role="dialog"` is the Draw tool panel itself; live
  store still `{ past: 1, strokes: [1] }`. Correct.
- Proportionally the sheet is *larger* at this width than the desktop card: a
  full-height scrim plus a handle, to delete one pen mark.

**Console: 0 errors.** The only warning is React Router's
`v7_startTransition` future-flag notice, which is pre-existing and unrelated. (The
`asset_vanished` render errors visible in the browser's full console history belong
to the *previous* reviewer's manual probe in this same browser context — that string
is the test fixture's own fake asset id in `journey.hub-reentry.spec.ts`. Nothing in
my session produced an error.)

Findings:

- **Focus ring: clearly visible at both widths**, and on the safe control. The prior
  reviewer established the ring survives the full three-stop Tab cycle including the
  panel itself, and `journey.new-image.spec.ts:129-163` pins that with a
  computed-style assertion. **Correct, keep it.**
- **Escape cancels without doing the thing at both widths**, verified against the live
  store rather than against a screenshot. **Correct, keep it.**
- **Proportion: wrong at both widths.** The dialog is well-built — clear heading,
  honest body, danger-inked commit, safe control focused. It is simply asking a
  question the user has already answered with `Ctrl+Z`, and the drawing loop is where
  that hurts most: clear, redraw, adjust, clear again, each iteration now behind a
  sheet. Note the three recovery affordances visible in the desktop screenshot at
  once — Undo in the top bar, `Clear` and `Delete layer` still sitting side by side
  behind the scrim. This is not a mobile problem and not a styling problem; the
  dialog is proportionate to nothing.

---

## What this review did NOT cover

A previous reviewer established these; I did not re-run them and do not re-assert
them as my own findings:

- The gate suite: `npm run typecheck`, `npm run lint`, `npm run build`, bundle sizes
  (38.2 kB entry / 237.4 kB eager), and the assets/licences checks.
- `npm run test:coverage` and the `src/pages/**` coverage movement on all four
  metrics.
- The browser-level reload assertion (`page.reload()` 48 ms after confirming shows the
  import screen, mirror null, IndexedDB row absent). I verified the *mechanism* by
  reading the code and by reading the live store in a browser, but I did not re-run
  that assertion.
- The cyclic Tab trap, focus return to the opener, and Escape cancelling the New image
  modal. I did re-check focus-return and Escape for **Clear strokes**, at both
  widths, and both were correct.
- `npm run test:e2e` in full. I audited the six spec diffs by reading them; I did not
  execute the suite.

**What I did run**, within bounds: `npx prettier --check .` → clean; `npm test` →
**160 files / 3185 tests, all passing** — consistent with the prior reviewer's
figures, so the counts in `AGENTS.md` and `docs/FEATURES.md` are one step further out
of date and should be re-taken from these numbers when they next change.

This review covers exactly four things: the UX judgement on the confirmation
convention, the per-file audit of the e2e edits, an independent reasoning-level
verification of the data-loss race, and one live browser pass on one action at two
widths.

---

## Verdict

**FAIL** — on the UX judgement, not on correctness.

The feature works. The data-loss fix is sound and the two-click e2e edits are
strengthenings rather than accommodations. But attempt 2's rule change puts a modal in
front of four actions that `Ctrl+Z` fully restores, which is confirmation fatigue the
owner did not ask for and which works against the stated goal of getting the app used
as much as possible. The fix is small and mechanical: make
`clearStrokesRequest` and `deleteLayerRequest` return `null` unconditionally and make
`resetEditsRequest` return `null` (the `confirmThen` call sites and every test already
handle `null` as "proceed"), leaving prompts on **New image**, **Discard session**,
**Start over** and **Delete preset** — the four that no undo reaches. Then reconcile
`confirm.ts:10-13`, which still documents the old rule, with whatever rule is shipped.