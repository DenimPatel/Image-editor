# Attempt 3 — the confirmation split: irreversible asks, undo-recoverable acts

Attempt 3 of a maximum 3. Attempts 1 and 2 were independently verified as
**correct**, and the only open finding was a design judgement: attempt 2 changed
the convention from *"reversible actions do not need a modal — use undo"* to
*"ask unless it would destroy nothing"*, so **all seven** destructive actions
prompted. Two reviewers rejected that as confirmation fatigue — *"an app that
asks before every small undoable action is an app people stop trusting"* — which
contradicts the owner's stated goal. This pass implements the split, and touches
nothing the verifiers called sound.

**Nothing here is committed.** The dev server on 5173 was used, not restarted.

## The split, and the rule that decides it

| Action | Was (attempt 2) | Now | Why |
| --- | --- | --- | --- |
| **New image** | asks | **asks** | `load()` replaces the document and takes the undo stack with it |
| **Discard session** | asks | **asks** | the stored photograph, never written anywhere else |
| **Start over** | asks | **asks** | deletes the stored photograph *and* its edits in one press |
| **Delete preset** | asks | **asks** | a recipe the user typed, living only in this `localStorage` |
| **Clear strokes** | asks | **acts** | one `Ctrl+Z` away; Undo is in the top bar of the same frame |
| **Delete layer** | asks | **acts** | `removeLayer` is a store action — one history entry |
| **Remove frame** | asks | **acts** | the same call, named differently on screen |
| **Reset all edits** | asks | **acts** | `docStore.reset` closes any open interaction and pushes one `past` entry |

The evidence that made the split unavoidable rather than a matter of taste is in
the verifier's screenshots: a dialog reading **"Clear all strokes?"** over a photo
with **one** stroke on it — *"The one stroke on this layer is removed"* — while
Undo sits in the top bar beside it. A question that is answered correctly on every
press is not a safety net; it is a tax, and it trains people to press through the
one question that matters.

## 1. `src/lib/destructive.ts` — the rule, stated as two lists

The header comment used to argue attempt 2's rule in four paragraphs. It now
states both halves, and **two exported lists make the split testable rather than
prose**:

- `IRREVERSIBLE_ACTIONS` — `New image`, `Discard session`, `Start over`,
  `Delete preset`, with the reason each one is outside undo's reach. Adding a
  fifth is a decision somebody can see.
- `UNDOABLE_ACTIONS` — `Reset all edits`, `Clear strokes`, `Delete layer`,
  `Remove frame`.

`resetEditsRequest`, `deleteLayerRequest` and `clearStrokesRequest` are **gone**,
along with `askToRemoveLayer` in `LayerPanels.tsx`. That is deliberate: the
absence is the convention, and a builder that always returns `null` is a function
that exists only to be asserted against — the `HUB_DOORS` defect this change was
already faulted for. `confirmThen` keeps its `ConfirmRequest | null` contract
because `newImageRequest` still returns `null`, and that null case now has its own
three-case test where it had none at all.

The three surviving call sites in the panels and the menu now read
`onClick={() => removeLayer(layer.id)}` and `useDocStore.getState().reset()`.

## 2. `src/lib/confirm.ts:10-13` — the stale doc comment

The header comment still documented the rule the code had stopped following. It
now states what the code does, names the four that do not ask, and points at
`IRREVERSIBLE_ACTIONS` as the list to check when an eighth destructive control
turns up. `docs/FEATURES.md`'s D8-F39 row asserted the same wrong rule and was
corrected in the same pass — a document that states a rule the code does not
follow is the defect `AGENTS.md` §Counting exists to prevent, and it is now gone
from both places.

## 3. Tests

**`src/lib/destructive.test.ts`** (32 cases) pins **both halves**: the four
irreversible actions each have a builder that names its action, names a commit
control that is never `OK`/`Yes`/`Cancel`, and says what is lost — and each of the
four recoverable ones is in `UNDOABLE_ACTIONS` with **no builder exported at
all**, asserted against the module's own export list so re-adding any of the three
deleted builders fails the test. Three new `confirmThen` cases cover confirm /
decline / `null`.

**`src/lib/confirm.test.ts`** — the two wiring scans were re-aimed, not deleted:
_…the four controls Undo reaches reach no dialog at all_ asserts `LayerPanels.tsx`
never imports the primitive and that `handleReset`'s body contains no `confirmThen`,
and the symbol scan was retitled to say what it actually guarantees (that the two
undoable deletions stay behind `src/store/actions.ts`).

**`src/store/actions.test.ts`** — _removeLayer and clearDrawStrokes are each one
undo step_. The whole convention rests on this, and nothing asserted it before.

**`src/components/tools/LayerPanels.test.tsx`** — the panel is mounted **without**
a `ConfirmDialog` now, and the watermark case presses Delete once, asserts the
layer is gone, then asserts one `undo()` brings it back. A two-click version of
that test passed while a dialog was wired in; its absence is the assertion.

### e2e: the four presses that go back to one click

| File | Change |
| --- | --- |
| `journey.layers.spec.ts` | Delete layer → one press; `readDoc()` shows 0 layers; the unused `page` fixture removed |
| `journey.layer-panels.spec.ts` | Delete layer → one press; empty-state assertion intact |
| `journey.shell.spec.ts` | Delete layer → one press; the watermark-count `expect.poll` intact |
| `journey.new-image.spec.ts` | _"Reset all edits" acts on one press, and Undo brings the edits back_ — rewritten: no dialog, `readDoc()` proves the reset, then one Undo restores the crop |
| `journey.reload-loss.spec.ts` | **unchanged** — Discard session is irreversible and still answers a dialog |
| `journey.hub-reentry.spec.ts` | **unchanged** — Start over is irreversible and still answers a dialog |

Nothing was weakened, deleted or skipped. Every assertion attempt 2 added about
the *dialog* was removed; every assertion about *the action* was kept, and each of
the four now additionally asserts the thing happened on the single press.

**The tests bite — both halves were reverted and measured.**

| Reverted | Result |
| --- | --- |
| `Discard` no longer asks (irreversible half) | `EditorSession.test.tsx` › _discards the session and its mirror_ — **1 failed** |
| `deleteLayerRequest` re-added and wired to the draw panel (recoverable half) | `destructive.test.ts` — **4 failed**; `confirm.test.ts` › _the four controls Undo reaches reach no dialog at all_ — **1 failed** |
| `handleReset` routed through `confirmThen` | `confirm.test.ts` › _the four controls Undo reaches reach no dialog at all_ — **1 failed** |

All three restored; `sha256` of all seven touched source files is byte-identical to
the pre-mutation state (`diff` of the two checksum lists is empty).

## Gates

| Gate | Result |
| --- | --- |
| `npm run typecheck` | green |
| `npm run lint` | green |
| `npx prettier --check .` | green, repo-wide |
| `npm test` | **3187 passed, 160 files** (was 3185/160; the four recoverable builders' cases out, the split and `confirmThen` cases in, plus one `actions.test.ts` case) |
| six e2e files, chromium | **45 passed, 0 failed** |
| `journey.reload-loss.spec.ts`, webkit | **2 skipped** — the file's pre-existing `NO_BLOB_STORAGE` skip (WebKit aborts the IndexedDB blob write). Not a pass and not a new failure; the chromium run covers both cases. |

Not run, as instructed: the full `npm run test:e2e`, and `npm run test:coverage`.

**Untouched**, because the verifiers called them sound: the four irreversible
confirmations, `focusTrap.ts`, `ConfirmDialog`, the focus-restore behaviour and
the focus ring, the `cancel()`/`idle()` fix in `autosave.ts` and `forget.ts`, and
`e2e/fixtures.ts`. `Doc` stays JSON-only, `history.ts` stays import-free, store
updates go through `src/store/actions.ts`, appearance never enters `Doc`.

---

## Browser observations

Checked by hand on the dev server at **1280x800** and **390x844**, Chromium.
Screenshots in `.improve/artifacts/headline/verify3/`, and read, not just captured.

**Clear strokes acts immediately, and one Undo brings the strokes back.** Drawn one
stroke on a new drawing layer at 1280x800 (`01`), pressed `Clear` (`02`): the
stroke was gone, the store read `strokes: 0` with `past` 2 → 3, the only
`role="dialog"` on the page was the Draw tool panel itself, and focus stayed on the
`Clear` button — no question asked, nothing to dismiss, and the canvas was live
immediately. One press of `Undo` (`03`) put the stroke back: `strokes: 1`, `past`
back to 2, and the restored mark is visible in the screenshot with Undo still
enabled in the top bar. At 390x844 (`06`) the same round trip with two strokes:
`2 → 0` on `Clear` with `past` 3 → 4 and **no dialog containing a `?`**, then one
Undo restored `2` strokes. The Draw sheet at that size has `Clear` and
`Delete layer` side by side with the canvas above; both being single-press is what
makes that sheet feel like a tool rather than a queue of forms.

**Delete preset still asks** (`04`). The dialog is `Delete "Verify3 warm"?`, the body
says *"It cannot be brought back — a preset is only ever the copy you saved, and there
is no second copy"*, `Cancel` holds a visible focus ring and `Delete preset` is a
distinct, outlined commit control. This is the half of the convention that has to
keep its teeth, and it is unchanged.

**New image still asks** (`05` desktop, `07` mobile). *"This photo has 2 edits.
Starting a new image replaces it, and the edits cannot be undone afterwards — there
is nothing to undo them back to."* `Cancel` focused on arrival at both sizes; the
mobile dialog sits above the open Draw sheet as a second scrim, which reads
correctly — the sheet is not interactive behind it.

**One thing worth noting, not a defect.** The first-run panel's copy — *"Every edit
is reversible… Undo and redo reach all of it, and 'Reset all edits' puts the photo
back the way the file arrived"* — now matches the shipped rule exactly. It did not
under attempt 2, where `Reset all edits` asked as though it were the destructive
one.