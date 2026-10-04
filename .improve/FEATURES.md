# Improvement backlog — Interactive Image Editor

**122 items**, produced from five reconnaissance reports against the working tree at `10ade26`.
Four parallel analysts wrote one tier each; a Critic pass then merged six duplicates, deleted one
ungrounded item and two pieces of busywork, split four oversized items, added six, and re-sorted
every tier. **IDs are permanent and are never reused**, so a deleted ID stays a hole.

## The operator's priority

> *"first see full user journeys to find loophole or issues… if a user selects one stock image and
> starts editing, how to go back and select/upload new option? there is no option for that… improve
> the overall user journeys and UI UX to get this app using as much as possible."*

So the file is ordered **journeys first**. Tier 1 is dead ends, missing reversals, traps and
lost-work risk — the defects that strand a user. Tier 2 is UI/UX, responsiveness and accessibility.
Tier 3 is correctness, performance, testing, tooling and CI. Tier 4 is missing features.

Within every tier the items are sorted by **priority score descending** (impact x confidence /
effort, S=1 M=2 L=3), subject to one rule: a `Depends on` entry always points at an item that
appears **earlier** in this file. Where the score and the dependency disagree, the dependency wins
and the dependency's item sits above its dependant even at a lower score.

The headline confirmed defect: **there is no way to open a different image.** `src/pages/Editor.tsx:482`
unmounts the import screen permanently once a photo is loaded; the More menu
(`src/components/editor/EditorTopBar.tsx:116-175`) offers Keyboard shortcuts, Appearance, Reset all edits, Copy
edits, Paste edits, Save preset and Photo details — and nothing that changes the photo. "Close editor" only
routes to the Hub, where Start editing, Open Editor and every tool card reopen **the same image**,
because `useDocStore` is a module singleton (`docStore.ts:80`). The only exit is a full browser
reload. See `.improve/artifacts/baseline/desktop-17-more-menu.png`.

## Gate baseline at backlog time

**Every gate is green**, including `npm run test:coverage`. `npx prettier --check .` was the one red
gate and commit `676b733` fixed it. Details in `REPO_PROFILE.md`.

| Gate | Command | Baseline |
|---|---|---|
| Unit | `npm test` | green — 3060 tests in 153 files |
| Typecheck | `npm run typecheck` | green |
| Lint | `npm run lint` | green |
| Format | `npx prettier --check .` | green (after `676b733`) |
| Build | `npm run build` | green |
| Coverage | `npm run test:coverage` | green — `src/pages/**` 63.0/51.3/50.9/60.9 vs 60/48/47/57 |
| End-to-end | `npx playwright test --list` | 659 cases in 41 spec files, 3 projects |

`node`/`npm` need `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"` first.

## Status vocabulary

`TODO` (next to pick up) · `IN-PROGRESS` · `DONE` · `BLOCKED` (MAX_ATTEMPTS reached) ·
`NEEDS-HUMAN` (a product decision, a paid service, credentials, or a subjective brand overhaul) ·
`SKIPPED`.

## Tier map

| Tier | Theme | Items | ID range |
|---|---|---|---|
| 1 | User journeys, dead ends and reversals | 36 | IMP-001 – IMP-040 (37 IDs issued: IMP-032 deleted, 038–040 never issued) |
| 2 | UI/UX, responsiveness and accessibility | 28 | IMP-041 – IMP-072 (32 IDs issued: IMP-044 and IMP-067 deleted, 071–072 never issued) |
| 3 | Correctness, performance, testing, tooling and CI | 34 | IMP-073 – IMP-112 (40 IDs issued: IMP-092, IMP-101, IMP-103 and IMP-106 deleted, 111–112 never issued) |
| 4 | Missing features natural to this product | 24 | IMP-113 – IMP-138 (26 IDs issued: IMP-126 and IMP-129 deleted, IMP-133 – IMP-138 added) |

## What the Critic pass changed

- **Merged** IMP-044 → IMP-041, IMP-092 → IMP-054, IMP-101 → IMP-024, IMP-103 → IMP-048,
  IMP-126 → IMP-007/IMP-010, IMP-129 → IMP-110. IMP-126 and IMP-007 also **contradicted each
  other** on whether a reset is undoable; IMP-007 now names the two mutually exclusive outcomes and
  requires the shipped one to be recorded.
- **Deleted as ungrounded:** IMP-032 (the top bar already renders `Undo`/`Redo` at
  `src/components/editor/EditorTopBar.tsx:123-127`).
- **Deleted as busywork:** IMP-106 (`.editorconfig` + `.gitattributes`, no gate) and IMP-067
  (radius/focus-ring token consolidation); IMP-067's one real defect — `appearance: auto` painting a
  square-cornered colour swatch inside a rounded frame — was folded into IMP-050.
- **Split** four items that had more than four acceptance criteria at Effort L: IMP-118/IMP-133,
  IMP-119/IMP-134, IMP-128/IMP-135, IMP-131/IMP-136.
- **Added** IMP-133 – IMP-138, including IMP-137 (recon-journeys finding **D-11**, which both
  analysts measured but neither filed) and IMP-138 (a keyboard-only import → download journey).
- **Corrected paths** that did not exist: `src/components/EditorTopBar.tsx` → `src/components/editor/`,
  `src/gl/useRenderLoop.ts` → `src/hooks/`, `src/components/editor/EditorCanvas.tsx` →
  `src/components/canvas/`, `src/components/RouteError.tsx` → `src/components/ui/`,
  `src/lib/network.ts` → `src/lib/assets/network.ts`, `src/lib/segmentRows.ts` →
  `src/components/controls/`, `src/components/tools/LayersPanel.tsx` →
  `src/components/tools/LayerPanels.tsx`, and `src/components/export/ExportSheet.tsx` →
  `src/components/tools/ExportSheet.tsx`.
- **Open owner decisions are untouched.** The AGPL-3.0 obligation for
  `@imgly/background-removal` (IMP-109) is still an open decision and is still stated as one in
  `NOTICE`, `AGPL_DECISION` and `public/licenses.html`; the colour-management build-vs-disclose
  decision (IMP-110, row `D4-F12`) and the `setStraighten` auto-reflow decision (IMP-130, row
  `D5-F05`) are unchanged.

---

## Tier 1 — User journeys, dead ends and reversals

Findings from `.improve/reports/recon-journeys.md` and `.improve/reports/recon-experience.md`.
The dominant theme is not a missing feature but a **missing exit**: the editor is very good at
getting a user in and has almost no honest way back out. Every item below either builds an exit,
makes a silent no-op loud, or proves a journey that has never been executed by a test.

Status vocabulary is the six words from `docs/FEATURES.md`: `TODO` here means *not yet
started*, not one of those six. Nothing below is claimed `Working`.

### IMP-004 — Make "Done" open the export panel when one is already open
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/pages/Editor.tsx:468-470`, `src/components/editor/EditorTopBar.tsx:171`, `src/components/editor/ToolTabBar.tsx:79-86`
- **Intent:** `openExport = if (!activeTool) setActiveTool('export')` at `Editor.tsx:468-470` means the `Done` button at `EditorTopBar.tsx:171` is a silent no-op whenever any tool is open. `ToolTabBar.tsx:79-86` has already established that these tabs are not toggles, so the user clicks `Done`, nothing happens, and there is no signal that the button is dead (D-02).
- **Acceptance criteria:**
  1. Clicking `Done` with any tool open sets the active tool to `export` and the export panel is visible; a unit test on the reducer covers the `activeTool === 'export'` case so the button is idempotent rather than inert.
  2. With no tool open, `Done` continues to set `activeTool` to `export` exactly as before.
  3. The `Done` control never has zero effect from any state a user can reach; a table-driven unit test enumerates every `ToolId` and asserts `openExport` yields the export panel.
  4. If a decision is made to keep `Done` as a no-op, it is given `aria-disabled="true"` and an accessible description saying so — the current silent behaviour is the defect either way.
- **Verification method:** `npx vitest run src/pages/editorOpenExport.test.ts` (new file beside `Editor.tsx`) for the table. `e2e/journey.done.spec.ts` (fixtures `test`): open a tool, click `getByRole('button', { name: 'Done' })`, assert `getByRole('region', { name: /export/i })` is visible via `readDoc()` for the active tool, screenshot to `.improve/screens/done-from-open-tool.png`.
- **Effort:** S    **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 5 / 1 = 20
- **Notes:** Smallest item in the tier with one of the largest scores, because it is the single most-complained-about dead control and the fix is a one-line predicate plus a test.

### IMP-021 — e2e: the Done journey from every starting state
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.done.spec.ts`, `e2e/fixtures.ts`, `src/pages/Editor.tsx:468-470`
- **Intent:** D-02's dead control has no case, so the silent no-op shipped. This case is the regression gate for IMP-004 and, more usefully, it enumerates the states in which a `Done` press does nothing — which is the general shape of every dead control in the app.
- **Acceptance criteria:**
  1. `e2e/journey.done.spec.ts` uses the fixtures `test`, locates `Done` by `getByRole('button', { name: 'Done' })`, and runs the press from every tool state the tab bar offers.
  2. After each press the export region is visible and `readDoc()` reports the export tool active.
  3. Pressing `Done` twice is idempotent rather than toggling export off.
  4. A test fails if `openExport` returns without a state change; the file name and case title are greppable and quoted in `docs/FEATURES.md`.
- **Verification method:** `npm run test:e2e -- e2e/journey.done.spec.ts` on all three projects; the unit half is the table in IMP-004's verification.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-004
- **Priority score:** 4 x 5 / 1 = 20
- **Notes:** Cheapest regression gate in the tier. Do it first.

### IMP-013 — Unmount the global tool shortcuts when no image is loaded
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/pages/Editor.tsx:462-466`, `src/hooks/useKeyboardShortcuts.ts`
- **Intent:** `Editor.tsx:462-466` mounts `useKeyboardShortcuts` unconditionally, so tool shortcuts are live on the import screen and leak forward into it. Pressing `E` on the import screen silently changes tool state the user cannot see (D-06), and a shortcut that fires with nothing on screen is indistinguishable from a broken one.
- **Acceptance criteria:**
  1. With no source loaded, no tool shortcut mutates `readDoc()`; a table-driven unit test presses every registered shortcut in the import state and asserts zero state change.
  2. With a source loaded, every shortcut keeps its current behaviour; the same table asserts the mapping in the loaded state.
  3. Shortcut hints shown on the import screen are removed, or replaced with the import screen's own affordances.
  4. The single-condition guard is documented in code by the test name, not by a comment.
- **Verification method:** `npx vitest run src/hooks/useKeyboardShortcuts.test.tsx` (new) for clauses 1, 2 and 4. `e2e/journey.import-screen.spec.ts` (fixtures `test`): on the import screen press each key and assert `readDoc()` is unchanged.
- **Effort:** S    **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** Low risk because it is a guard, not a remapping. `useKeyboardShortcuts` lives at `src/hooks/useKeyboardShortcuts.ts` and its sibling test `src/hooks/useKeyboardShortcuts.test.tsx` already exists, so criterion 1 extends it rather than creating a file. Worth doing before any shortcut is added, so the new one is not born leaking.

### IMP-015 — Sample tiles respect `describeOffline()`
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/pages/Editor.tsx:289`, `src/lib/assets/network.ts`, `src/components/ImportScreen.tsx:124`
- **Intent:** `describeOffline()` at `network.ts:29-34` states the sample tiles need a connection, but the tiles stay enabled offline and the failure surfaces at `Editor.tsx:289` as a failed load with no explanation. The user is told a tile is available, taps it, and gets a dead end with no message (D-12).
- **Acceptance criteria:**
  1. Offline, the sample tiles are `aria-disabled="true"` with an accessible description naming the offline banner text, and activating one produces no navigation and no unhandled rejection.
  2. The offline banner is visible and announces itself on the import screen, located by an accessible name that does not change with the message text.
  3. Going back online re-enables the tiles without a reload, driven by the same `describeOffline()` signal.
  4. A unit test for the tile component asserts the disabled state from an injected offline value, so the behaviour is not only proven through a browser.
- **Verification method:** `npx vitest run src/lib/assets/network.test.ts src/components/editor/ImportScreen.test.tsx`; the sample-tile disabled state is asserted in the latter, which exists today. `e2e/journey.offline.spec.ts` (fixtures `test`): `context.setOffline(true)`, assert the tile is disabled by role and that the banner is visible; screenshot to `.improve/screens/offline-import.png`.
- **Effort:** S    **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** The one uncertainty is whether the samples are bundled assets that genuinely work offline. If they are bundled, the defect is in the copy rather than the gating, and clause 1 should become "samples are available offline and the banner does not claim otherwise" — that is the same user-visible honesty, inverted.

### IMP-016 — Document double-click-to-fit and add a discoverable hint
- **Status:** TODO
- **Category:** journey
- **Type:** docs
- **Area / files:** `src/components/EditorCanvas.tsx:238`, `README.md`, `docs/FEATURES.md`
- **Intent:** `EditorCanvas.tsx:238` implements double-click-to-fit, and nothing anywhere tells the user it exists. It is the fastest way to recover from a zoom mistake, so an undiscovered double-click means users reach for the zoom controls for the rest of the session (D-13). Documentation plus a first-run hint, not a new control.
- **Acceptance criteria:**
  1. `README.md` and the `docs/FEATURES.md` row for canvas zoom state the double-click-to-fit gesture in the same words, and the quoted test title in that row is greppable in the file the row names.
  2. The canvas has an accessible name and a `aria-describedby` hint that mentions double-click; the hint is announced on focus, not only on hover.
  3. The gesture is discoverable after the first deliberate zoom change without a tour, and the hint is suppressed once the user has used it.
  4. A test fails if the double-click handler is removed: `e2e/journey.double-click-fit.spec.ts` double-clicks, asserts the zoom returns to fit via `readDoc()`, and is named in the `docs/FEATURES.md` row.
- **Verification method:** `npm run test:e2e -- e2e/journey.double-click-fit.spec.ts` with the `test` from `e2e/fixtures.ts`, locating the canvas by role and name. Then `npx prettier --check README.md docs/FEATURES.md` and a grep of the row's quoted test title.
- **Effort:** S    **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** The AGENTS.md rule that a `Working` row must name a greppable test applies here, so the doc change and the test land together or not at all.

### IMP-017 — Replace the "Photo details" info toast with a persistent, reachable disclosure
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/editor/EditorTopBar.tsx:112`
- **Intent:** `Photo details` at `EditorTopBar.tsx:112` shows a toast and nothing else, so the only access to a photo's dimensions, size and format is a message that disappears (D-13). There is no way to get the information a second time, and a toast is the wrong container for reference data.
- **Acceptance criteria:**
  1. `Photo details` is a disclosure control, not a toast: it toggles a persistent region with an accessible name that stays stable, and it is reachable and dismissible by keyboard.
  2. The region shows dimensions, file size, colour space and format read from the live document, and it updates when the image changes.
  3. The toast path is removed for this control; a unit test asserts no toast is raised on activation.
  4. The region is announced on open and its state is exposed via `aria-expanded`.
- **Verification method:** `e2e/journey.photo-details.spec.ts` (fixtures `test`): `getByRole('button', { name: 'Photo details' })`, assert the region by role, assert its contents against `readDoc()`, open again after closing, screenshot to `.improve/screens/photo-details.png`.
- **Effort:** S    **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** I am unsure which fields the existing toast already computes; keep whatever it shows and add the ones the `AssetStore` already has, rather than adding new asset metadata.

### IMP-002 — Confirm before replacing a document that has edits
- **Status:** TODO
- **Category:** journey
- **Type:** new-feature
- **Area / files:** `src/pages/Editor.tsx:340-347`, `src/components/editor/ResumeSessionCard.tsx:57`, `src/components/ui/RouteError.tsx:34-54`, `src/lib/confirm.ts`
- **Intent:** Every destructive path in the app today either fires without asking or is unwired (D-04: zero `confirm()` calls in `src/`). One shared, focus-trapped, testable confirmation primitive means `New image`, `Reset all edits`, `Discard session`, `Start over`, `Delete preset`, `Clear strokes`, `Delete layer` and `Remove frame` all stop losing work on a misclick, and each of them becomes one unit test instead of eight bespoke dialogs.
- **Acceptance criteria:**
  1. A `confirmDestructive({ title, body, confirmLabel, tone })` helper exists in `src/lib/confirm.ts`, returns a promise resolving `boolean`, and is used by at least `New image` (IMP-001) and `Reset all edits` (IMP-003).
  2. Rendered as a modal dialog with `role="dialog"`, `aria-modal="true"`, an `aria-labelledby` pointing at the title, initial focus on the **safe** control, `Escape` resolving `false`, and focus restored to the element that opened it.
  3. Every destructive path that can discard user work routes through it; a unit test greps the built `src/` tree and fails if a `window.confirm(` call appears outside `src/lib/confirm.ts`.
  4. A destructive confirm control has an accessible name that is unique on the page and never a bare `OK`/`Yes`.
- **Verification method:** `npx vitest run src/lib/confirm.test.ts` for focus, Escape and restore. `e2e/journey.new-image.spec.ts` (fixtures `test`) for the Escape-restores-focus case, located by `getByRole('dialog')` and its named controls. Run `npm test && npm run lint && npm run typecheck` to confirm the no-raw-`confirm` guard is green.
- **Effort:** M    **Risk:** med
- **Depends on:** none
- **Priority score:** 5 x 4 / 2 = 10
- **Notes:** Reusing a single dialog is also what makes the *silent no-op* class of bug (D-02) visible in a screenshot. I believe `ResumeSessionCard.tsx:57` and `RouteError.tsx:34-54` are the two discard surfaces; if `RouteError` renders outside the normal React tree, a portal-based dialog may be needed.

### IMP-007 — "Reset all edits" asks before it resets
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/pages/Editor.tsx:453-460`, `src/store/docStore.ts:144-166`
- **Intent:** `Reset all edits` is the most destructive ordinary control in the editor and it currently fires on a single click with no confirmation and no undo (D-04, D-01 family). The store action at `docStore.ts:144-166` is pure and has a single caller, so this is a small, high-value wiring change.
- **Acceptance criteria:**
  1. With at least one edit in history, activating `Reset all edits` opens IMP-002's confirmation naming the operation; cancelling leaves `readDoc()` byte-identical to before.
  2. Confirming resets the document, and exactly one of these two behaviours ships, with the criterion text and the unit test naming which: (a) the reset is a history entry and one `Ctrl/Cmd+Z` returns to the pre-reset state per `readDoc()`; or (b) the store keeps discarding the stack, as the comment at `src/components/editor/EditorTopBar.tsx:85` documents, and the confirmation copy says the edits **cannot** be undone afterwards and the test asserts that Undo afterwards does **not** restore them.
  3. With no edits, the control is `aria-disabled="true"` with a description, so there is nothing to confirm.
  4. A unit test asserts the reset is a single coalesced history entry, not one per field.
- **Verification method:** `npx vitest run src/store/history.test.ts` for clause 4 and `src/store/docStore.test.ts` for 2. `e2e/journey.reset-all-edits.spec.ts` (fixtures `test`), locating `Reset all edits` by `getByRole('button', { name: 'Reset all edits' })` and the dialog controls by their accessible names.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-002
- **Priority score:** 4 x 4 / 1 = 16
- **Notes:** If the reset is not currently undoable, clause 2 is the larger of the two changes; making it a history entry is likely a one-line addition given the store already routes through `src/store/actions.ts`. Deleted IMP-126 filed the same confirmation and asserted the *opposite* of clause 2 — that one Undo after a reset does not bring the edits back. Both cannot be true, so criterion 2 now names the two mutually exclusive outcomes and requires the shipped one to be recorded rather than guessed. Clause 3 now asks for the same dialog for `Delete layer` and `Delete recipe`, which is what makes IMP-002's "every destructive path routes through it" true. Path corrected: `EditorTopBar.tsx` lives in `src/components/editor/`.

### IMP-009 — Clear strokes asks first
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/LayerPanels.tsx:1179`
- **Intent:** `Clear strokes` at `LayerPanels.tsx:1179` discards a user's hand-drawn work with one click and no confirmation and no undo entry (D-04). Mask pixels are the most expensive thing in the document to recreate, so this is the cheapest confirmation in the app to add and the most expensive to omit.
- **Acceptance criteria:**
  1. With a non-empty mask, `Clear strokes` opens IMP-002's confirmation; cancelling is a no-op asserted by `readDoc()` deep equality.
  2. Confirming clears the mask and records one undoable history entry.
  3. With an empty mask the control is `aria-disabled="true"` and no dialog appears.
  4. A unit test on the mask-clearing action proves it is one coalesced history entry.
- **Verification method:** `npx vitest run src/components/LayerPanels.test.tsx` for 3 and 4. `e2e/journey.clear-strokes.spec.ts` (fixtures `test`): draw a stroke via the tool, click the control located by `getByRole('button', { name: 'Clear strokes' })`, assert `readDoc()`.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-002
- **Priority score:** 4 x 4 / 1 = 16
- **Notes:** I believe the destructive layer controls (`Delete layer`, `Remove frame`) sit in the same region and should be swept in the same change; if they are far apart, split them rather than growing this item.

### IMP-008 — Deleting a preset reports an outcome instead of a 3.2s toast
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/pages/Editor.tsx:453-460`, `src/store/uiStore.ts:269-272`, `src/components/PresetPopover.tsx:141`
- **Intent:** Deleting a preset at `PresetPopover.tsx:141` routes to `Editor.tsx:453-460`, which raises a toast with tone `'info'`; `uiStore.ts:269-272` persists only the `'error'` tone, so the confirmation of the deletion — the thing the user is looking for — evaporates in 3.2 seconds and leaves no record (D-05). A user who closes the popover has no way to know whether the delete happened.
- **Acceptance criteria:**
  1. A successful preset deletion produces a durable, dismissible status message that names the deleted preset and survives longer than 3.2 seconds, with an accessible role that announces it politely.
  2. A **failed** deletion produces a message in the persisted `'error'` channel that survives a reload.
  3. The delete is confirmed first (IMP-002) when the preset is a user preset rather than a bundled look.
  4. `uiStore.ts` persists a success tone as well as `'error'`, with a unit test per tone.
- **Verification method:** `npx vitest run src/store/uiStore.test.ts` for clause 4. `e2e/journey.preset-delete.spec.ts` (fixtures `test`): delete a preset, assert the status message is present by role, reload, and assert the error-channel case survives via `persistedDoc()`/`localStorage` inspection.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-002
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** I recall the 3.2s figure from the recon report rather than from reading `uiStore.ts`; if the real default is a different number, the substance of the item is unchanged.

### IMP-010 — Delete layer and Remove frame ask first
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/LayerPanels.tsx:1179`, `src/store/docStore.ts:144-166`
- **Intent:** `Delete layer` and `Remove frame` are the other two irreversible controls in the layer panel and share D-04's defect. Grouping them keeps the sweep over every destructive control complete, which is what makes the "no unconfirmed destructive action" claim in IMP-002 true rather than aspirational.
- **Acceptance criteria:**
  1. `Delete layer` and `Remove frame` each route through IMP-002's confirmation when they would discard user content, with confirm labels unique to each action.
  2. Deleting the only layer is refused outright with a message, or confirmed with copy that says the result is an empty document — never both.
  3. Both are single undoable history entries.
  4. A sweep test enumerates every control in `src/components/**` whose accessible name matches `/delete|remove|clear|reset|discard/i` and fails if any of them is not confirmed, has no undo entry, or both.
- **Verification method:** `npx vitest run src/components/LayerPanels.test.tsx` for 1–3. The clause-4 sweep is a static test over the component sources; run it as part of `npm test`.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-002, IMP-009
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** Clause 4 is the durable part: it is what stops the next destructive control from reintroducing D-04 silently. The regex is a heuristic and will need a small allowlist for things like "remove background".

### IMP-012 — "Start over" states that it deletes the photo and the edits
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/ui/RouteError.tsx:34-54`
- **Intent:** The crash path at `RouteError.tsx:34-54` offers a `Start over` that discards the user's photo and edits, and the copy does not say so. A user arriving here has just lost the session to an exception and is the least able to absorb a second silent loss (D-04). The route is also the app's only crash surface, so its copy is read under exactly the wrong conditions.
- **Acceptance criteria:**
  1. The `Start over` control's accessible name and visible label both state that it deletes the photo and the edits — e.g. `Start over — deletes your photo and edits`.
  2. Activating it opens IMP-002's confirmation; cancelling leaves the app in the error state with the document intact per `readDoc()`.
  3. The error boundary logs the crash reason somewhere the user can act on (a copyable detail line or a support reference), so `Start over` is not the only option.
  4. A unit test asserts the copy contains both nouns, so a copy edit cannot quietly drop the warning.
- **Verification method:** `npx vitest run src/components/RouteError.test.tsx` for clauses 1 and 4. `e2e/journey.crash-recovery.spec.ts` (new, fixture `test`) reaches the crash surface through the existing `src/components/ui/CrashOnPurpose.tsx` trigger, then locates the control by `getByRole('button', { name: /deletes your photo/i })`, cancels, and asserts `readDoc()` is unchanged and no dialog remains open.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-002
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** The three real crash-recovery journeys are: failed import, failed export, and the render throw. This item covers only the third; failed import and failed export need their own recoverability work and are listed separately below.

### IMP-027 — Flush the autosave mirror on unload so a reload inside the debounce window is survivable
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/lib/persist/mirror.ts:5-17`, `src/pages/Editor.tsx:113-118`
- **Intent:** The mirror at `mirror.ts:5-17` is the only thing that survives a hard reload during the autosave debounce, and a reload is exactly what a user does after D-01's dead end. Today the worst case is a silent partial loss; with a flush on unload the reload becomes a save. This is the difference between "the app lost my work" and "the app kept my work".
- **Acceptance criteria:**
  1. An edit made within one debounce interval is present in `localStorage` immediately on `page.reload()`, asserted by `persistedDoc()` after the reload; a unit test drives the debounce and the flush directly.
  2. The flush runs on `visibilitychange` to hidden as well as on `pagehide`, so a mobile app-switch is covered.
  3. The flush is synchronous, bounded, and does not block `pagehide` for longer than 50 ms; a unit test measures it.
  4. The mirror never persists a `Doc` containing pixels, per invariant 1 — a unit test asserts JSON round-trip with no binary field.
- **Verification method:** `npx vitest run src/lib/persist/mirror.test.ts` for 1, 3 and 4. `e2e/journey.autosave-flush.spec.ts` (fixtures `test`): edit, reload within the debounce window, assert `persistedDoc()` and `readDoc()` both carry the edit.
- **Effort:** M    **Risk:** med
- **Depends on:** none
- **Priority score:** 5 x 4 / 2 = 10
- **Notes:** The `50 ms` bound in clause 3 is my estimate of what `pagehide` tolerates; treat it as a starting value to be measured, not a researched figure. On mobile Safari, `pagehide` is the only reliable signal and the number may need to be lower.

### IMP-035 — A "you are leaving a document with edits" guard on browser navigation
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/pages/Editor.tsx:340-347`, `src/components/editor/EditorTopBar.tsx:116-175`
- **Intent:** The remaining lost-work path after IMP-027 is a user closing the tab or hitting Back with unsaved edits. A `beforeunload` prompt is the standard answer, but it must not fire for a clean document or for the app's own navigation, or it becomes the nuisance prompt users learn to dismiss without reading.
- **Acceptance criteria:**
  1. A `beforeunload` handler prompts only when the document has edits not yet in the mirror; a clean document leaves silently.
  2. In-app navigation (Hub, deep links) is never interrupted by the browser prompt, because it is handled by the router and the store flush.
  3. A unit test enumerates the dirty/clean matrix against the mirror's last-write time, proving the prompt does not fire on a freshly saved document.
  4. The prompt is the browser's own — no custom copy is claimed, and no test asserts on browser chrome text.
- **Verification method:** `npx vitest run src/pages/editorUnloadGuard.test.ts` (new) for 1, 3 and 4. `e2e/journey.hub-reentry.spec.ts` (fixtures `test`) for clause 2: navigating Hub-bound must not hang on a dialog.
- **Effort:** S    **Risk:** med
- **Depends on:** IMP-027
- **Priority score:** 4 x 3 / 1 = 12
- **Notes:** `Risk: med` for one reason only: a `beforeunload` that fires too eagerly makes the app feel hostile and will be reported as a regression. Clause 3 is the guard against that, so it is not optional.

### IMP-014 — Put appearance and help on the import screen
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/pages/Editor.tsx:484-490`, `src/components/ImportScreen.tsx:124`
- **Intent:** `Editor.tsx:484-490` renders the import screen with no appearance, theme or help control, and the orientation tour trigger at `ImportScreen.tsx:124` is the only place it exists, so it is unreachable the moment a source exists. A first-run user who wants dark mode, a different text scale or the tour has nowhere to go, and a returning user cannot re-open the tour (D-07).
- **Acceptance criteria:**
  1. The import screen exposes the same six appearance settings as the editor, in a control reachable by keyboard, with accessible names matching the editor's so the two are learned once.
  2. The orientation tour can be re-opened from both the import screen and the editor, from a control whose accessible name is stable across both.
  3. Choosing an appearance on the import screen does not write to `Doc`, history or IndexedDB — a unit test asserts `Doc` deep-equality across an appearance change, per invariant 7 in `AGENTS.md`.
  4. The settings live in the same `localStorage` key as the editor's, and `index.html`'s pre-paint script still matches byte-for-byte (`npm run appearance:sync -- --check` is green).
- **Verification method:** `npx vitest run src/lib/appearance.test.ts` for clause 4 including the byte-identical guard. `e2e/journey.import-screen.spec.ts` (fixtures `test`): toggle theme on the import screen by accessible name, assert the `<html>` `data-theme` attribute changed and `readDoc()` did not; then open the tour and assert its dialog by role.
- **Effort:** M    **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** Clause 4 is the reason this cannot be done by copying a `settingsStore` call: the pre-paint script is generated and a hand-edit fails `appearance.test.ts`. Run `npm run appearance:sync` rather than editing `index.html`.

### IMP-023 — e2e: the preset apply and delete journey
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.preset-apply-delete.spec.ts`, `e2e/fixtures.ts`, `src/components/PresetPopover.tsx:141`
- **Intent:** Presets are the app's main creative lever and their two halves — apply, delete — are unproven. A look strip can be applied and reverted, and a user preset can be deleted, and a bug in either is a lost edit or a lost preset rather than a cosmetic defect.
- **Acceptance criteria:**
  1. `e2e/journey.preset-apply-delete.spec.ts` uses the fixtures `test`, locates looks by accessible name from `src/lib/luts.ts` names, never by thumbnail `src`.
  2. Applying a look changes `readDoc()` in a way that reverts on undo, and applying a second look composes rather than replaces.
  3. Deleting a user preset confirms first, removes it from the list, and reports durably per IMP-008; reloading does not resurrect it.
  4. A bundled look is not deletable and the control says so by accessible name rather than by being silently absent.
- **Verification method:** `npm run test:e2e -- e2e/journey.preset-apply-delete.spec.ts` on all three projects.
- **Effort:** M    **Risk:** low
- **Depends on:** IMP-008
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** Cloning a user preset is a common user motion with no case either; add it here if the popover already supports it, otherwise log it as a follow-up rather than growing this item.

### IMP-029 — A failed import says what failed and offers a way forward
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/ImportScreen.tsx:124`, `src/pages/Editor.tsx:289`, `src/lib/assets/network.ts`
- **Intent:** A failed import currently produces silence or a bare spinner stop. The three real causes — an unsupported format, a file too large, and a network failure fetching a sample — have different remedies, and lumping them into one failure makes the user guess. This is the first dead end a first-run user can hit.
- **Acceptance criteria:**
  1. Each cause produces a distinct message naming the cause and one concrete next action, in a live region, and none of them is a bare `error`.
  2. The failure never leaves the import screen in a state where re-selecting the same file silently does nothing; retry is offered and works.
  3. A unit test per cause asserts the message, driven by an injected error, not by a browser.
  4. The message is announced politely, and the failure is not written into the toast-only channel that expires.
- **Verification method:** `npx vitest run src/components/ImportScreen.test.tsx` for 1, 3 and 4. `e2e/journey.failed-import.spec.ts` (fixtures `test`): drop a deliberately corrupt file via the fixtures' file chooser, assert the live region's text names the cause, screenshot to `.improve/screens/failed-import.png`.
- **Effort:** M    **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** Shares the surface with IMP-015; implement together so there is one error vocabulary on the import screen rather than two.

### IMP-030 — A failed export says what failed and keeps the document
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/ExportPanel.tsx`, `src/store/uiStore.ts:269-272`
- **Intent:** Export is the last step and the one place a user has usually spent the most time. A failed export that surfaces as a transient toast and leaves the document in an unknown state is the worst outcome the app can produce, and the `uiStore.ts:269-272` channel distinction (only `'error'` persists) is the right place to enforce it.
- **Acceptance criteria:**
  1. A failed export raises a persisted `'error'`-channel message that survives a reload and names the failure and a remedy (retry, different format, or a size reason).
  2. The document is unchanged after a failed export — `readDoc()` deep-equals its pre-export state, asserted in the test.
  3. No partial or zero-byte file is offered for download; the download control is `aria-disabled` until a successful encode exists.
  4. The exported bytes are verified, not assumed: a unit test decodes the result and checks the header and dimensions.
- **Verification method:** `npx vitest run src/components/ExportPanel.test.tsx` for 1, 3 and 4. `e2e/journey.failed-export.spec.ts` (fixtures `test`) forces an encode failure, asserts the persisted message and that no download occurred.
- **Effort:** M    **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** I am not certain of the export panel's filename or the encode helper's name; the acceptance criteria are written against behaviour so they survive either. The `readImageHeader` pattern from the fixtures is the right tool for clause 4.

### IMP-003 — "Reset all edits" also removes the background-removal cut-out
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/store/docStore.ts:144-166`, `src/components/BackgroundPanel.tsx:67-77`, `src/components/Onboarding.tsx:15-18`
- **Intent:** `docStore.ts:144-166` resets by cloning the source, but `BackgroundPanel.tsx:67-77` rewrites `doc.source` when a background is removed, so a "reset" leaves the cut-out in place and the user still sees the matte they asked to undo. That contradicts the onboarding copy in `Onboarding.tsx:15-18`, which promises a reset returns to the original photo (D-03). Either the reset restores the true original bytes or the copy stops claiming it does.
- **Acceptance criteria:**
  1. After remove-background then Reset all edits, the rendered canvas is byte-identical to the canvas immediately after import, proven by comparing canvas pixel hashes rather than by comparing a `Doc` field.
  2. The reset path does not depend on which panel was open; it is the same code path whether the background is a cut-out, a colour, a blur or untouched.
  3. If the true original bytes are not retained after import, then the reset control is relabelled to say what it actually does and `Onboarding.tsx:15-18` no longer promises a full reset — the two texts agree, and a unit test asserts that agreement.
  4. The reset is routed through IMP-002's confirmation when the doc has edits.
- **Verification method:** `npx vitest run src/store/docStore.test.ts` for the store-level reset, with a case named after the background-removal interaction. `e2e/journey.reset-all-edits.spec.ts` (fixtures `test`) drives remove-background, then `Reset all edits`, then hashes the canvas via `readImageHeader`-style byte comparison and saves the failing screenshot path. Requires `E2E_MATTING=1`? No — this must use a synthetic cut-out, not the model.
- **Effort:** M    **Risk:** med
- **Depends on:** IMP-002
- **Priority score:** 5 x 3 / 2 = 7.5
- **Notes:** I am not certain whether the original pixels survive matting in the `AssetStore` or whether they are gone; that determines whether clause 1 or clause 3 is the honest fix. I lean toward the source being re-encoded, in which case clause 3 is the correct outcome. Do not resolve this by silently keeping the cut-out.

### IMP-022 — e2e: the Reset all edits journey
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.reset-all-edits.spec.ts`, `e2e/fixtures.ts`, `src/store/docStore.ts:144-166`
- **Intent:** `Reset all edits` is the only control in the editor that is meant to undo everything, and its behaviour depends on what the background panel did to `doc.source` (D-03). No case covers it, which is exactly why the cut-out survives the reset. The case has to assert pixels, not doc fields.
- **Acceptance criteria:**
  1. `e2e/journey.reset-all-edits.spec.ts` uses the fixtures `test`, locates the control by accessible name, and asserts on canvas bytes via the `readImageHeader` pattern from the fixtures — not on a `Doc` field.
  2. It covers four pre-states: edits only, background colour only, a cut-out, and an empty document; and it covers the cancelled confirmation.
  3. It asserts one undo returns to the pre-reset state, via `readDoc()`.
  4. It does not enable `E2E_MATTING` — the cut-out pre-state must be produced without downloading the 42 MB model.
- **Verification method:** `npm run test:e2e -- e2e/journey.reset-all-edits.spec.ts` on all three projects; confirm `E2E_MATTING` is unset in the run environment.
- **Effort:** M    **Risk:** low
- **Depends on:** IMP-003, IMP-007
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** Clause 4 is the operational trap: a test that downloads the matting model makes the suite slow and network-dependent for every future run.

### IMP-005 — "Start editing" from the Hub opens the image the user is looking at
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/store/docStore.ts:80`, `src/pages/Hub.tsx`, `src/components/HubToolCard.tsx`
- **Intent:** `useDocStore` is a module singleton at `docStore.ts:80`, so every Hub entry point — `Start editing`, `Open Editor`, and each tool card — reopens whatever source happens to be in the singleton. A user who has two photographs and picks the second from the Hub silently gets the first, with no error and no explanation (D-01 family).
- **Acceptance criteria:**
  1. Each Hub entry point that names a specific source (a tool card, `Start editing` when a source is chosen) opens that source; the singleton is initialised from the entry point's intent rather than from whatever was last in memory.
  2. If the intended source is not in the `AssetStore`, the editor does not silently fall back to a different image; it shows the import screen or an explicit error.
  3. Two different Hub navigations in one session produce two different `doc.source` values, asserted via `readDoc()` in both cases within a single e2e case.
  4. A unit test on the singleton's init/reset path proves a fresh source replaces rather than merges.
- **Verification method:** `npx vitest run src/store/docStore.test.ts` for clause 4. `e2e/journey.hub-reentry.spec.ts` (fixtures `test`): assert on `readDoc()` after each Hub entry, locating Hub controls by accessible name only. Note the `readDoc()` module-URL resolution requirement from `e2e/fixtures.ts` — do not simplify it.
- **Effort:** M    **Risk:** med
- **Depends on:** none
- **Priority score:** 5 x 3 / 2 = 7.5
- **Notes:** I am unsure how many Hub entry points actually name a source versus relying on the singleton, so the size of the change may be smaller than the wording implies. Treat clause 2 as the real requirement: never silently substitute a different photo.

### IMP-031 — Returning from a `/editor/:tool` deep link lands on the tool with a usable document
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/pages/Editor.tsx:484-490`, `src/store/docStore.ts:80`
- **Intent:** A user who bookmarks or shares `/editor/<tool>` — or who reloads one — should not arrive at a tool panel over an empty document, nor at the import screen with the tool requested in the URL silently ignored. Today the tool in the path and the document in the singleton are two unrelated facts, so the deep link is only half-honoured.
- **Acceptance criteria:**
  1. Loading `/editor/<tool>` with no document shows the import screen and remembers the requested tool, applying it once a document exists.
  2. Loading `/editor/<tool>` with a persisted document opens that document with the tool active, and `readDoc()` agrees with the URL.
  3. An unknown tool segment falls back to a real tool rather than rendering nothing, and the fallback is observable in a unit test.
  4. The tool segment is reflected in the document title so a re-entry is identifiable in history.
- **Verification method:** `npx vitest run src/pages/editorDeepLink.test.ts` (new) for 2 and 3. `e2e/journey.hub-reentry.spec.ts` (fixtures `test`) extended with two direct `page.goto` navigations, asserting `readDoc()` and the active tool region.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-005
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** Related to but distinct from D-01: the singleton is a *memory* problem, the deep link is a *routing* problem, and fixing one does not fix the other.

### IMP-001 — Add a "New image" action to the editor More menu
- **Status:** TODO
- **Category:** journey
- **Type:** new-feature
- **Area / files:** `src/pages/Editor.tsx:482`, `src/components/editor/EditorTopBar.tsx:116-175`, `src/store/docStore.ts:80`
- **Intent:** Once any source exists, `Editor.tsx:482` unmounts `ImportScreen` permanently, so the More menu is the only permanent surface a user has and it offers no way to choose a different image. A user who realises they picked the wrong file has no in-app recovery: the only exit is a full browser reload, which throws away their session. This is the owner's headline complaint (D-01).
- **Acceptance criteria:**
  1. The More menu (the menu that currently contains the "Photo details" and "Reset all edits" region) contains an item whose accessible name is exactly `New image`.
  2. Activating it with keyboard or pointer on a doc that has a source and at least one edit opens a confirmation whose text names the number of edits that will be lost and offers a confirm control; activating it on a pristine doc performs the swap with no confirmation.
  3. After confirming, `doc.source` is the newly chosen image, `readDoc().assets` contains only the new image's assets, and `doc.layers` is the default single layer.
  4. `sessionStorage`/`localStorage` autosave keys for the previous document are removed, and a subsequent hard reload of `/editor` does not resurrect the previous image.
  5. The item is disabled (and stays in the menu, not hidden) while an export is in flight, with `aria-disabled="true"` and an accessible description naming the reason.
- **Verification method:** Add cases to `e2e/journey.new-image.spec.ts` using the `test` from `e2e/fixtures.ts`. Locate the trigger by accessible name (`getByRole('menuitem', { name: 'New image' })` or `getByRole('button', { name: 'New image' })`), never by a `styles.*` class. Assert on `readDoc()` for the new source, `persistedDoc()` for the cleared row, and on a hard reload for the "does not resurrect" clause. Unit: add a case to `src/store/docStore.test.ts` for the unconfirmed pristine path and the confirmed dirty path.
- **Effort:** M    **Risk:** med
- **Depends on:** IMP-002, IMP-005
- **Priority score:** 5 x 4 / 2 = 10
- **Notes:** My recollection is that the More menu region is `EditorTopBar.tsx:116-175` and that `Reset all edits` sits near its bottom; confirm the exact item order before placing the new entry. If the swap is expensive on the asset path, gate the destructive branch behind IMP-005's confirmation so a misclick cannot cost a photo.

### IMP-006 — Clear the autosaved session and the localStorage mirror on replace
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/lib/persist/mirror.ts:5-17`, `src/store/docStore.ts:144-166`, `src/pages/Editor.tsx:340-347`
- **Intent:** The localStorage mirror at `mirror.ts:5-17` is the only thing that survives a hard reload inside the autosave debounce window, which makes it the thing that resurrects a document the user believed they had replaced. Without an explicit clear, `New image` (IMP-001) and a from-scratch Hub start leave a stale row that a reload brings back.
- **Acceptance criteria:**
  1. Replacing a document clears both the IndexedDB autosave row and the `localStorage` mirror key in the same operation, and a unit test asserts both are gone.
  2. A hard reload after a replace shows the import screen, not the previous image.
  3. The mirror is written with the same debounce as the store, so the mirror can never be *newer* than the store; a unit test on the ordering proves this.
  4. A `beforeunload` handler (or equivalent) flushes the mirror so a reload inside the debounce window restores the in-progress edits rather than dropping them.
- **Verification method:** `npx vitest run src/lib/persist/mirror.test.ts` for 1, 3 and 4. `e2e/journey.new-image.spec.ts` (fixtures `test`) for clause 2: replace, `page.reload()`, then assert `readDoc()` has no source and the import screen is visible by role.
- **Effort:** M    **Risk:** med
- **Depends on:** IMP-001
- **Priority score:** 5 x 4 / 2 = 10
- **Notes:** This is also the lost-work half of the hard-reload journey; clause 4 is what stops the fix from trading one data-loss path for another. I am not certain a `beforeunload` flush exists today, so treat clause 4 as a real addition rather than a wiring job.

### IMP-011 — "Discard session" asks before it discards
- **Status:** TODO
- **Category:** journey
- **Type:** improvement
- **Area / files:** `src/components/editor/ResumeSessionCard.tsx:57`, `src/pages/Editor.tsx:340-347`
- **Intent:** The resume card's discard action at `ResumeSessionCard.tsx:57` calls the handler at `Editor.tsx:340-347`, which drops the autosaved document. This is the one control whose entire purpose is to destroy work, and it is reached by a user who has just been told they have work to lose (D-04). It is also the most likely to be tapped on a phone.
- **Acceptance criteria:**
  1. Activating discard opens IMP-002's confirmation, whose body states how much would be lost and that it cannot be undone after the mirror is cleared.
  2. Cancelling returns focus to the discard control and leaves `persistedDoc()` unchanged.
  3. Confirming clears the row and the mirror and moves the user to the import screen; a hard reload then does not restore the discarded document.
  4. The control's accessible name is `Discard session` and it is reachable by keyboard without a pointer.
- **Verification method:** `e2e/journey.resume-discard.spec.ts` (fixtures `test`): seed a stored session, locate by `getByRole('button', { name: 'Discard session' })`, assert the dialog by role, cancel then `persistedDoc()`, confirm then reload and assert the row is gone.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-002, IMP-006
- **Priority score:** 4 x 4 / 1 = 16
- **Notes:** Pairs naturally with IMP-006; if the two are implemented together the mirror clearing is the shared test fixture.

### IMP-019 — e2e: the changing-image journey, end to end
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.changing-image.spec.ts`, `e2e/fixtures.ts`, `src/pages/Editor.tsx:482`
- **Intent:** The journey the owner actually complains about has no e2e case: load image A, make an edit, decide you wanted image B, get back to an import screen. Nothing in the suite exercises leaving a document for another one, which is why the singleton behaviour in `docStore.ts:80` has never been caught. This item is the test that would have failed before IMP-001.
- **Acceptance criteria:**
  1. `e2e/journey.changing-image.spec.ts` exists, uses the `test` from `e2e/fixtures.ts`, and locates every control by accessible name or role — no `styles.*` selector anywhere in the file.
  2. The case loads image A, applies an edit, changes to image B, and asserts on `readDoc()` that the source is B and the A-only edit is gone; it asserts on `persistedDoc()` for the stored row.
  3. The same case covers both routes to the change — the More-menu action and a full reload — and asserts the reload does not resurrect A.
  4. The case passes on **all three** Playwright projects (`chromium`, `webkit`, `mobile`); the file name must not match `/journey\.mobile/`, so the mobile project runs it too.
  5. The quoted case title appears in the `docs/FEATURES.md` row it claims, greppable in this file.
- **Verification method:** `npm run test:e2e -- e2e/journey.changing-image.spec.ts` and `npx playwright test --list e2e/journey.changing-image.spec.ts` to confirm the project count. The dev server on 5317 is started by the command; do not stop the 5173 one.
- **Effort:** M    **Risk:** low
- **Depends on:** IMP-001, IMP-005, IMP-006
- **Priority score:** 5 x 5 / 2 = 12.5
- **Notes:** Written after the fix, but it is the artefact that keeps the fix from regressing, so it must be merged with IMP-001 rather than deferred. Per AGENTS.md, a gate that no project selects is worse than no gate — clause 4 is the part that would otherwise be missed.

### IMP-018 — Show a persistent autosave state indicator
- **Status:** TODO
- **Category:** journey
- **Type:** new-feature
- **Area / files:** `src/pages/Editor.tsx:113-118`, `src/lib/persist/mirror.ts:5-17`
- **Intent:** `Editor.tsx:113-118` has no saved indicator, so a user has no way to know whether their work is persisted. Combined with the debounce window in `mirror.ts:5-17`, the user's model is either "it is saved" or "I might lose everything", and the truth is a three-state machine they cannot observe (D-13). A small status region resolves the whole class.
- **Acceptance criteria:**
  1. A live region reports three states — `Saving…`, `Saved`, `Save failed` — with `aria-live="polite"`, and the state is derived from the real persistence result, not from a timer.
  2. `Save failed` persists until a successful save and is accompanied by a retry control with an accessible name.
  3. The indicator does not appear in the accessibility tree as a duplicate of an existing status, and passes `e2e/a11y.spec.ts` with an unchanged empty `ALLOWED` list.
  4. A unit test drives the persistence result through saving/saved/failed and asserts the state transitions, including the failed-then-recovered case.
- **Verification method:** `npx vitest run src/lib/persist/mirror.test.ts` for clause 4. `e2e/journey.autosave-indicator.spec.ts` (fixtures `test`): make an edit, assert the region transitions to `Saved`; deny IndexedDB writes via `page.route`/context override to assert `Save failed`.
- **Effort:** M    **Risk:** med
- **Depends on:** IMP-006
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** Highest leverage on the lost-work journey — it is what makes the reload-in-the-debounce-window case survivable rather than mysterious. Depends on IMP-006 because the mirror and the store must agree on state before one indicator can be truthful.

### IMP-020 — e2e: hub re-entry into an existing session
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.hub-reentry.spec.ts`, `e2e/fixtures.ts`, `src/pages/Hub.tsx`
- **Intent:** The Hub -> editor -> back -> editor loop is a real user motion and has no case. It is the loop that makes the singleton in `docStore.ts:80` visible: a user navigating back and forth should keep their document, and today nobody has asserted that it does. The same case also covers the Hub's own claim of continuity.
- **Acceptance criteria:**
  1. `e2e/journey.hub-reentry.spec.ts` uses the fixtures `test` and locates Hub controls by accessible name.
  2. The case performs editor -> Hub -> editor at least three times and asserts after each hop that `readDoc()` still has the original source and the original edit.
  3. It asserts the resume card is offered on the return visit and is absent on the first visit, by accessible name, distinguishing first-run from returning-with-a-stored-session.
  4. It runs on all three projects.
- **Verification method:** `npm run test:e2e -- e2e/journey.hub-reentry.spec.ts`, plus `npx playwright test --list | tail -1` for the updated totals that `docs/FEATURES.md` and `AGENTS.md` must be updated with in the same pass.
- **Effort:** M    **Risk:** low
- **Depends on:** IMP-005
- **Priority score:** 4 x 4 / 2 = 8
- **Notes:** Per AGENTS.md the counting rule bites here: adding cases means the header, §5 index, distribution table, §6, §7.4 and §8 numbers in `docs/FEATURES.md` all go stale in the same commit unless they are updated.

### IMP-036 — A dead-control sweep that presses every top-bar and panel control
- **Status:** TODO
- **Category:** journey
- **Type:** tooling
- **Area / files:** `e2e/journey.dead-controls.spec.ts`, `e2e/fixtures.ts`, `src/components/editor/EditorTopBar.tsx:116-175`
- **Intent:** D-02's `Done` and D-01's missing More-menu entry are the same defect class: a control that does nothing, or does nothing discoverable. Rather than find them one report at a time, a single spec enumerates the interactive controls in the top bar, tab bar and each open panel, activates each from a known state, and fails when a press produces no observable change in `readDoc()` **and** no visible change such as an opened region, a message or a disabled-to-enabled transition. It is the cheapest way to find the next one before a user does.
- **Acceptance criteria:**
  1. `e2e/journey.dead-controls.spec.ts` uses the `test` from `e2e/fixtures.ts` and builds its list from accessible names and roles, never from `styles.*` classes.
  2. Each control is activated from a state where it is expected to do something, and the spec records an explicit, hand-written reason for any control that is allowed to be inert (`aria-disabled`, decorative, or a no-op by design). There is no silent skip.
  3. A press that changes neither `readDoc()`, nor the accessibility tree's visible state, nor the canvas bytes fails the spec with the control's accessible name in the message.
  4. The allowlist is a named export with a one-line reason per entry, so adding an entry is a reviewable act and `e2e/a11y.spec.ts`'s empty-`ALLOWED` discipline is mirrored.
- **Verification method:** `npm run test:e2e -- e2e/journey.dead-controls.spec.ts` on all three projects. The spec is expected to fail on the current tree and that failure is the deliverable — it is the inventory. Then `npm run typecheck && npm run lint`.
- **Effort:** L    **Risk:** med
- **Depends on:** IMP-001, IMP-004
- **Priority score:** 5 x 4 / 3 = 6.7
- **Notes:** `Risk: med` because a spec that is red on arrival can go stale and be ignored — which is the "a red gate gets disabled" failure in `AGENTS.md`. Land it together with the fixes for the controls it reports, or do not land it. Effort is L because enumerating panels is more work than the assertion.

### IMP-024 — e2e: the Copy/Paste edits journey
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.copy-paste-edits.spec.ts`, `e2e/fixtures.ts`, `src/store/docStore.ts:80`
- **Intent:** Copy/paste-edits is what makes `Doc` being JSON-serializable-only (invariant 1) pay off, and it is the one feature where a bug destroys work in a way the user cannot detect — a partial paste looks like a successful one. No case covers it.
- **Acceptance criteria:**
  1. `e2e/journey.copy-paste-edits.spec.ts` uses the fixtures `test` and drives copy then paste entirely by keyboard.
  2. After paste, `readDoc()` matches the copied edits for the layer, mask and adjustments, and the paste is a single undoable history entry.
  3. Pasting into a document with a different image size is handled per the documented rule and the case asserts that rule rather than the accident.
  4. Pasting a document containing a reference to an asset that is not present produces an explicit, non-silent failure, not a blank layer.
  5. A case denies clipboard permission through the browser context (no `grantPermissions` call for `clipboard-read`/`clipboard-write`), copies, and asserts the paste still succeeds through the `localStorage` mirror — the refusal path jsdom cannot reach. The case is not skipped when the permission cannot be denied; it asserts the fallback either way.
- **Verification method:** `npm run test:e2e -- e2e/journey.copy-paste-edits.spec.ts` on all three projects; the JSON-serializability rule itself is covered by the unit suite in `src/model/`.
- **Effort:** M    **Risk:** med
- **Depends on:** none
- **Priority score:** 4 x 3 / 2 = 6
- **Notes:** `Risk: med` because clipboard permissions differ across the three projects; if WebKit needs an explicit grant, the case must do it in a `test.beforeEach` rather than being skipped, or the project silently loses the coverage. Merged from deleted IMP-101, which filed the same journey as `e2e/journey.copy-paste.spec.ts`; that file name is dropped in favour of this item's `journey.copy-paste-edits.spec.ts` and its denied-permission clause became criterion 4. `readDoc()` is the only assertion target.

### IMP-028 — Navigating to the Hub mid-edit does not lose work or silently revert it
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/pages/Editor.tsx:340-347`, `src/components/editor/ResumeSessionCard.tsx:57`, `src/lib/persist/mirror.ts:5-17`
- **Intent:** Leaving the editor for the Hub mid-edit is ordinary navigation, not a discard, and the user reasonably expects to come back to the edit they made. If the store is torn down on unmount without a final autosave, the return visit shows a resume card for an older state or nothing at all, and the user has to decide whether to trust it.
- **Acceptance criteria:**
  1. Make an edit, navigate to the Hub, return: `readDoc()` has the edit, with no reload in between and no dialog the user did not ask for.
  2. If the document was not persisted within the debounce when the editor unmounted, the resume card offers the in-memory state rather than the older stored one, and says which it is offering.
  3. Unmounting the editor never increases the persisted row's age silently; either it flushes (IMP-027) or the card states that the resume point is older.
  4. The case covers a second visit with no edits at all, which must not prompt for a resume.
- **Verification method:** `e2e/journey.resume-discard.spec.ts` (fixtures `test`) extended with the navigation half, asserting `persistedDoc()` before and after the hop and `readDoc()` on return. Unit: `npx vitest run src/lib/persist/mirror.test.ts`.
- **Effort:** M    **Risk:** med
- **Depends on:** IMP-027
- **Priority score:** 4 x 3 / 2 = 6
- **Notes:** Clause 2's wording is deliberate: telling the user "this is the state as of 40 seconds ago" is a worse experience than a flush, but it is honest, and honesty beats a confident wrong resume.

### IMP-033 — e2e: first-run versus returning-with-a-stored-session
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.first-run.spec.ts`, `e2e/fixtures.ts`, `src/components/editor/ResumeSessionCard.tsx:57`
- **Intent:** The app has two distinct first impressions — empty state with a tour, and a returning user with a document to resume — and they are visually and behaviourally different paths chosen by persisted state. Nothing tests which one a given visitor gets, so an inverted condition ships silently and a returning user is met with an onboarding tour.
- **Acceptance criteria:**
  1. `e2e/journey.first-run.spec.ts` uses the fixtures `test` and covers both: a clean context shows the import affordances and the tour trigger, and a seeded context shows the resume card and no tour.
  2. The two are distinguished by accessible name, so a copy change in one state cannot make the other pass.
  3. The tour can be dismissed in the first-run state and does not reappear within the same context; it is re-openable on demand per IMP-014.
  4. A first-run case is part of every other journey spec's setup, so a spec cannot pass while depending on stale local state.
- **Verification method:** `npm run test:e2e -- e2e/journey.first-run.spec.ts` on all three projects. The mobile project's two `journey.mobile*` specs share this concern, so cross-check the mobile cases against it.
- **Effort:** M    **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 2 = 6
- **Notes:** Clause 4 is the hygiene item: an e2e case that passes only because a previous case left a document in local storage is a false pass, and that is how a broken Hub gets a green suite.

### IMP-034 — e2e: the offline banner across a full session
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.offline.spec.ts`, `e2e/fixtures.ts`, `src/lib/assets/network.ts`
- **Intent:** `describeOffline()` at `network.ts:29-34` is a single function that decides banner text, sample-tile enablement and several other affordances, and the whole offline story is unproven. Offline is also where silent failure is most likely, because the user cannot tell a network stall from a broken app.
- **Acceptance criteria:**
  1. `e2e/journey.offline.spec.ts` uses the fixtures `test` and covers: offline at the import screen, offline mid-edit, offline at export, and recovery when the connection returns.
  2. Each case asserts the banner by an accessible name that does not embed the message text, and asserts exactly what remains usable.
  3. No unhandled rejection or console error is produced while offline; the case fails on a page error, not only on an assertion.
  4. Coming back online restores the affordances without a reload.
- **Verification method:** `npm run test:e2e -- e2e/journey.offline.spec.ts` on `chromium` and `webkit`; screenshots to `.improve/screens/offline-*.png`.
- **Effort:** M    **Risk:** low
- **Depends on:** IMP-015
- **Priority score:** 3 x 4 / 2 = 6
- **Notes:** Per AGENTS.md, a claim about what a user can still do offline needs a real engine — jsdom reports no layout and no network state, so this cannot be a unit test.

### IMP-025 — e2e: the Compare journey
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.compare.spec.ts`, `e2e/fixtures.ts`
- **Intent:** Compare is the feature that makes an edit defensible — before and after in one view — and it has no case. An unproven compare is worse than none: a user can conclude their edit did nothing.
- **Acceptance criteria:**
  1. `e2e/journey.compare.spec.ts` uses the fixtures `test`, locates the compare control and the split handle by accessible name/role.
  2. With compare open, the left and right sides differ in canvas bytes and the difference corresponds to the applied edit; the assertion is on bytes, not on a class or an `aria` attribute alone.
  3. Closing compare restores the full edited view, and the drag handle is keyboard-operable to both extremes.
  4. The case runs on all three projects including `mobile`, where a drag is a touch drag.
- **Verification method:** `npm run test:e2e -- e2e/journey.compare.spec.ts`; for the mobile project, the touch interaction must be a real touch drag, not a synthesised mouse one, or the assertion is meaningless.
- **Effort:** M    **Risk:** med
- **Depends on:** none
- **Priority score:** 3 x 3 / 2 = 4.5
- **Notes:** I am least certain of the current compare implementation's surface, so the accessible names in clause 1 are the part most likely to need adjusting. The substance — prove before/after differs on bytes — does not depend on my recollection.

### IMP-026 — e2e: the drag-drop and paste import journeys
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.drag-drop-import.spec.ts`, `e2e/journey.paste-import.spec.ts`, `e2e/fixtures.ts`
- **Intent:** The two ways a user gets an image in fastest — drag a file onto the window, paste from the clipboard — are both unproven, and both fail in ways a unit test cannot see (jsdom has no file drop and no clipboard). They are also the paths most likely to break on a browser update.
- **Acceptance criteria:**
  1. Both spec files use the `test` from `e2e/fixtures.ts`; neither imports `test` from `@playwright/test` directly.
  2. Drop-in sets the document's source from the dropped file's bytes, asserted via `readDoc()` and the resulting canvas bytes.
  3. Paste-in does the same from a clipboard image, and an unsupported clipboard type produces an explicit message rather than silence.
  4. Both cases pass on `chromium` and `webkit`; a drop that WebKit cannot perform is `test.skip`ped with a reason naming the platform, and that skip is recorded in the report rather than hidden.
- **Verification method:** `npm run test:e2e -- e2e/journey.drag-drop-import.spec.ts e2e/journey.paste-import.spec.ts`. Note the `readDoc()` module-URL resolution requirement in the fixtures — do not simplify it back to the bare specifier.
- **Effort:** M    **Risk:** med
- **Depends on:** none
- **Priority score:** 3 x 3 / 2 = 4.5
- **Notes:** Grouped because they share the import surface and the same failure mode. A skip must say why; per AGENTS.md a skip that can be read as a pass is a defect, which is the same rule the shader-parity spec already follows.

### IMP-037 — Record the journey inventory in `docs/FEATURES.md` with greppable test names and refreshed counts
- **Status:** TODO
- **Category:** journey
- **Type:** docs
- **Area / files:** `docs/FEATURES.md`, `README.md`, `AGENTS.md`
- **Intent:** Every item in this tier adds e2e cases, and every `docs/FEATURES.md` number is a claim that the recon found three releases out of date. Landing the tier without updating the header, the district map, the §5 index and distribution table, §6, §7.4 and §8 in the same pass would re-create the exact staleness this catalogue exists to prevent, and a row claiming `Working` that names a test which does not exist is the failure mode the document is built to catch.
- **Acceptance criteria:**
  1. Every row this tier touches states one of the six status words, and any row that becomes `Working` names a `describe`/`it` that is greppable in the spec file it names — verified by a grep, not by reading.
  2. `npx playwright test --list | tail -1` and `npm test` totals are refreshed in `AGENTS.md`, `README.md` and the `docs/FEATURES.md` header, index, distribution table, §6, §7.4 and §8, all in the same commit.
  3. A row that has no test is `Untested`, never `Working`, and `Partial` is never promoted without the reason moving to §6.
  4. `npx prettier --check .` is clean, and `npm run test:e2e` on the affected specs is green on all three projects.
- **Verification method:** `npx playwright test --list | tail -1`; `npm test`; `grep -n "<quoted title>" e2e/journey.*.spec.ts` for each claimed title; `npx prettier --check .`; `npm run test:e2e`.
- **Effort:** S    **Risk:** low
- **Depends on:** IMP-019, IMP-020, IMP-021, IMP-022, IMP-023, IMP-024, IMP-025, IMP-026, IMP-033, IMP-034, IMP-036
- **Priority score:** 4 x 5 / 1 = 20
- **Notes:** Sequenced last on purpose: it depends on the cases actually existing, and its score is high because an un-updated catalogue is a false claim in a document whose whole purpose is not carrying false claims.

## Tier 2 — UI/UX, responsiveness and accessibility

Derived from `.improve/reports/recon-experience.md`, Lens 6 and Lens 2 of
`.improve/reports/recon-quality.md`, and the 30 baseline screenshots in
`.improve/artifacts/baseline/`. Every layout claim below was measured in a real engine at
**1280 x 800** or **390 x 844**; jsdom computes no layout and is never offered as evidence.

### IMP-041 — Move the crop readout out of the crop frame
- **Status:** DONE
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/canvas/CropOverlay.tsx`, `src/components/canvas/canvas.module.css` (`.readout`), `src/components/tools/CropPanel.tsx`, evidence `.improve/artifacts/baseline/desktop-10-crop-readout-occludes-handle.png`, `.improve/artifacts/baseline/mobile-06-crop-sheet.png`
- **Intent:** The crop readout row (`Reset crop` / `Perspective` / `1271 × 1920 px · 2:3`) is painted inside the crop frame at x 374–546, y 687–719 while the bottom-centre crop handle (`role="slider"`, `tabindex="0"`, `aria-label="Crop s handle"`) occupies x 446–474, y 699–727. The two overlap over 28 × 20 px, so focusing that handle produces **no visible focus indicator at all** and the handle is not grabbable with a pointer at the position a user expects. A keyboard user tabbing the eight handles gets zero feedback on the one that straddles the readout.
- **Acceptance criteria:**
  1. In a real browser at **1280 × 800** with the Crop sheet open, `getBoundingClientRect()` of the readout element and of the element with `aria-label="Crop s handle"` have **no overlapping area** (zero intersection of the two rectangles).
  2. The same holds at **390 × 844** with the Crop sheet open, for `Crop s handle`, `Crop n handle`, `Crop e handle` and `Crop w handle`.
  3. Focusing `Crop s handle` yields a focus indicator that is **fully inside its own box** — screenshot `.improve/artifacts/IMP-041/desktop-10-after.png` shows a complete ring, compared side by side with the baseline.
  4. The readout still shows the live pixel dimensions and aspect ratio, and `Reset crop` and `Perspective` remain operable buttons with their current accessible names.
  5. A case in `e2e/journey.crop.spec.ts` asserts `document.elementFromPoint(cx, cy)` at the centre of each of the four edge-centre handles (`Crop s handle`, `Crop n handle`, `Crop e handle`, `Crop w handle`, located by `getByRole('slider', { name })`) returns the handle or a descendant of it — never the readout or a sibling — on the `chromium` and `webkit` projects, neither skipped.
- **Verification method:** `npm test` (covers `src/components/canvas/CropOverlay.test.tsx`, `src/components/tools/CropPanel.test.tsx`) — a jsdom test may assert that the readout is not a descendant of the handle layer, but **not** geometry. The geometric proof is a new case in `e2e/journey.crop.spec.ts` using the `test` from `e2e/fixtures.ts`, locating the handle by `page.getByRole('slider', { name: 'Crop s handle' })` and the readout by its accessible name `1271 x 1920 px`, asserting `expect(intersectionArea).toBe(0)` from two `boundingBox()` calls. Screenshot to `.improve/artifacts/IMP-041/desktop-10-after.png` and `.improve/artifacts/IMP-041/mobile-06-after.png`. Run `npm run typecheck && npm run lint && npx prettier --check .`
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 5 × 5 / 1 = **25**
- **Notes:** `z-index` alone is not the fix — it changes paint order, not the overlap. The readout has to move out of the frame (dock it below the canvas or into the sheet). The recon records the handles themselves as correctly implemented (`role="slider"` + real `aria-label`s on all 8); this is a layout defect on top of a working implementation. Merged from deleted IMP-044, which asked for the same two measurements (overlap area and `elementFromPoint`); its self-report clause ("reverting the CSS makes the case fail") was dropped because a verifier cannot check it, and criterion 2 is the same measurement in the browser. Paths corrected from `src/components/editor/EditorCanvas.tsx`-style guesses to the real `src/components/canvas/`.

**DONE — commit pending. Verified PASS.** The readout left the crop box entirely: `.canvas` is now a
column whose first row (`.canvasStage`) is the one box both `useRenderLoop` and `CropOverlay` fit
from, so overlap is structurally impossible rather than merely re-z-ordered. New pure module
`src/lib/crop/frameFit.ts` (+ sibling test). Verifier measured, in a real browser at 1280x800 and
390x844 on chromium AND webkit: overlap on `Crop s handle` **560 px^2 -> 0 px^2**, and 0 on all 8
handles x 3 readout parts at both widths; focus ring now 3px inset vs 2px outset, sum 0; 0 px drift
between canvas and crop frame. `elementFromPoint` assertions unsuppressed on both projects. Gates
green: typecheck, lint, prettier, build, coverage; unit 3069 in 154 files; e2e 667 in 41 files; 141
passed across the 9 touched specs. **The e2e case was proven to bite**: the verifier mutated the
source to move the readout back over the handle and 4 assertions went red, then restored the file
exactly (diffstat 485/120 before and after).

**Cost, recorded honestly.** Fixing the occlusion shrank the crop preview: per-axis **-7.4% at
1280px and -21% at 390px**, which is an **area cost of -14.9% desktop and -37.6% mobile**. The
implementer's first design (space taken *inside* the overlay) desynchronised the preview from the
canvas element and broke `journey.crop-preview.spec.ts`, which is why the readout had to leave the
frame entirely. A mobile user loses a third of their preview area to fix a desktop overlap — IMP-139
exists to claw that back. Follow-ups raised by the verifier: IMP-139 (recover mobile preview space),
IMP-140 (the fixed "Recent problems" panel occluding the n/e/w handles at 390x844), IMP-141 (the
readout wraps 2.4px over and doubles to 83px at `textScale: xlarge`).
### IMP-042 — Give the mobile tool bar a visible horizontal-scroll affordance and edge fade
- **Status:** DONE
- **Category:** responsiveness
- **Type:** improvement
- **Area / files:** `src/components/editor/ToolTabBar.tsx:69` (`nav[aria-label="Editor tools"]`), `src/components/editor/editor.module.css`, `src/components/editor/ToolTabBar.test.tsx`, evidence `.improve/artifacts/baseline/mobile-05-editor-loaded.png`
- **Intent:** At **390 × 844** the tool bar measures `scrollWidth 1019` against `clientWidth 390` with `offsetWidth - clientWidth === 0` (an overlay scrollbar paints nothing), so 8 of 13 tools are off-screen with nothing to say so. The word "Background" is bisected at the 390 px edge and renders as `Backgroun`. A phone user has no way to know the bar scrolls; an unaffordanced scroller reads as a layout bug.
- **Acceptance criteria:**
  1. At **390 × 844** the tool bar shows a **visible** continuation affordance: a right-edge `mask-image` fade (alpha 1 → 0 over the last 32 px) that is present only while `scrollLeft < scrollWidth - clientWidth`, and an equivalent left-edge fade once `scrollLeft > 0`.
  2. `getComputedStyle(nav).scrollSnapType` is not `none` at ≤ 480 px, and scrolling with `mouse.wheel({deltaX})` lands on a tool boundary (measured `scrollLeft` differs from a random value by more than the bar's half-width tolerance, or `snapType` resolves to a proximity value).
  3. No tool's **visible label** is clipped mid-word at `scrollLeft === 0` — specifically the element whose text is `Background` has `getBoundingClientRect().right <= clientWidth + 1`, or is fully hidden behind the fade with `aria-hidden`-equivalent treatment. Measured, not asserted from a screenshot.
  4. The change is desktop-invisible: at **1280 × 800** all 13 tools are laid out with no fade and `nav.scrollWidth <= nav.clientWidth`.
- **Verification method:** `npm test` for the pure part (`src/components/editor/ToolTabBar.test.tsx` may assert the affordance element's presence given a `scrollWidth > clientWidth` prop). Geometry is proven by a new case in `e2e/journey.mobile.spec.ts` on the `test` from `e2e/fixtures.ts`: load Sample 1, `page.getByRole('navigation', { name: 'Editor tools' })`, then assert `scrollWidth > clientWidth` **and** that the fade element's computed `opacity` is `> 0`, and after `mouse.wheel` that `scrollLeft > 0`. Screenshot `.improve/artifacts/IMP-042/mobile-05-after.png`. This is a **fade only** — it does not make Export discoverable; that is IMP-053.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 5 × 5 / 1 = **25**
- **Notes:** The recon's own judgement is that a fade alone does not fix discoverability of the exit path. This item is deliberately scoped to the affordance only so it can be verified in one pass; the DOM reorder that puts Export within reach is IMP-053.


**DONE — commit pending. Attempt 1 FAILED, attempt 2 PASSED.** Attempt 1 combined two gradients in a
`mask-composite: add` list, which composites **fully opaque** when both ends apply: at mid-scroll
neither edge faded (measured pixel delta **1/1/1**) — the state a user is in most of the time. Its
e2e case asserted a computed declaration string (`count: 2`) rather than paint, so it passed while
nothing painted. Attempt 2 replaced it with one four-stop ramp
(`transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%`) and rewrote the case to
difference decoded pixels against `mask-image: none` in three bands at three scroll positions.

Independently verified in a real browser: mid-scroll **74/0/137** (was 1/1/1); one-sided and correct
at each end; absent where there is nothing to scroll. Snap boundary 0.41px. `Background.right` <= 391
at 6 appearance combinations. Desktop bar byte-identical at 2 appearances. `QUIET = 1` was shown NOT
vacuous — a 1px shift moves the control by 0 -> 164 — and both gates (the new
`responsiveLayout` pin and the roomy+xlarge case) were proven to bite by mutation, with every
mutation restored and checksummed.

The paint gate is **Chromium-only** (a 1-pixel-difference threshold has no meaning on WebKit, whose
pixel output differs); the declarative pin and the geometry assertions cover WebKit.

Verified sound and deliberately NOT changed: `ChipRow` blast radius (nil — byte-identical geometry
across 7 panels x 2 widths, mutation caught by pre-existing tests), touch behaviour (flicks land on
boundaries, reachability shortfall 0.00px, Export visible and tappable, slow drag returns to 0,
keyboard focus unchanged), and the WebKit mask (it paints; no `-webkit-mask-image` needed).

**Baseline correction, and it is not a small one.** Both verifiers established that **all 30**
screenshots in `.improve/artifacts/baseline/` were captured at `density: roomy` + `textScale: xlarge`,
not at default appearance. Earlier recon reported the desktop shots as being at defaults; that was
wrong. Every mobile-derived magnitude in this backlog was therefore measured at a non-default
setting. The defects are still real — roomy/xlarge is a supported appearance — but the *magnitude*
of any visual claim must be re-measured at defaults before it is quoted. IMP-144 exists for this.
### IMP-043 — Render the Hub tool cards at opacity 1 by default and let the observer add the entrance
- **Status:** TODO
- **Category:** ux
- **Type:** bug-fix
- **Area / files:** `src/pages/Hub.tsx:124-142` (`.reveal` observer adds `.is-visible`), `src/pages/Hub.test.tsx`, evidence `.improve/artifacts/baseline/desktop-01-hub-hero.png`, `.improve/artifacts/baseline/mobile-01-hub-hero.png`
- **Intent:** CSS starts every tool card at `opacity: 0; transform: translateY(16px)` and only the intersection observer reveals them. Measured on load at 1280 × 800, **all 8 cards measure `opacity: 0`**. A human who scrolls is fine, but a `fullPage` screenshot, a print, find-in-page, or a cold cache on a slow client sees the entire primary content of the Hub as a ~1000 px blank void. Inverting the pattern makes the content unconditional and the transition additive.
- **Acceptance criteria:**
  1. With JavaScript disabled or before any observer callback, `getComputedStyle()` on all 8 tool cards at **1280 × 800** reports `opacity: 1` and no `translateY` offset.
  2. `prefers-reduced-motion: reduce` still yields visible cards and no transition (the short-circuit at `Hub.tsx:125` is preserved).
  3. A full-page screenshot of the Hub at **1280 × 800** and at **390 × 844** shows all 8 tool cards with their titles visible — recorded at `.improve/artifacts/IMP-043/desktop-01-after.png`.
  4. No regression to the existing reveal behaviour: `src/pages/Hub.test.tsx` still asserts the cards become visible after the observer fires.
- **Verification method:** `npm test` (covers `src/pages/Hub.test.tsx`). Visual proof in a real browser via `page.screenshot({ fullPage: true })` from `e2e/journey.shell.spec.ts` on the `test` from `e2e/fixtures.ts`, asserting `page.getByRole('link', { name: /Crop & Straighten/ })` (or the actual accessible name) is visible and that a computed `opacity` read in `page.evaluate` is `1`. Screenshot to `.improve/artifacts/IMP-043/`. Plus one manual `page.emulateMedia({ reducedMotion: 'reduce' })` pass.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 × 5 / 1 = **20**
- **Notes:** This is not the same as IMP-056 — IMP-056 settles whether the mobile grid paints at all; this item is about the opacity contract, which is measurable at both viewports regardless of that outcome.

### IMP-045 — Reset the sheet body scroll position when the active tool changes
- **Status:** TODO
- **Category:** ux
- **Type:** bug-fix
- **Area / files:** `src/components/editor/ToolSurface.tsx`, `src/components/controls/controls.module.css:250` (`.sheetBody`), `src/components/controls/sheetHeights.ts`, `src/components/editor/ToolSurface.test.tsx`, evidence `.improve/artifacts/baseline/desktop-11-adjust-panel.png`
- **Intent:** One shared scroll container is reused by every tool. Measured: scroll the Crop sheet to the bottom (`scrollTop 300`), click **Adjust** — `scrollTop` is still 300; click **Looks** — still 300. The consequence is `desktop-11`: Adjust opens with its first chip row sliced in half, the bottoms of three icons and a row of `0 0 0` values sitting above the title with nothing to indicate the panel is scrolled. Every tool switch after a scroll lands mid-panel.
- **Acceptance criteria:**
  1. On switching the active tool, the sheet body's `scrollTop` is `0` within one animation frame, for every tool that owns a scroller.
  2. Re-opening the **same** tool twice with a scroll in between also resets (the reset is keyed on the tool, not only on a change).
  3. `e2e/journey.panel-coherence.spec.ts` gains a case: scroll the Crop sheet to the bottom, click **Adjust**, then assert `scrollTop === 0` **and** that the first adjustment chip row's `boundingBox().y` is greater than the sheet body's `boundingBox().y` — i.e. the row is not sliced.
  4. The same case passes at **1280 × 800** and at **390 × 844** (the mobile sheet is a `BottomSheet`, so both detents are exercised).
- **Verification method:** `npm test` for the effect hook (`src/components/editor/ToolSurface.test.tsx` can assert `scrollTop` is reset because jsdom does implement `scrollTop` assignment on a stubbed element — this is a state assertion, not a layout claim). Geometry proof in `e2e/journey.panel-coherence.spec.ts` on the fixture `test`, locating chips by accessible name (`Contrast`, `Brightness`, `Black point`) rather than by `.sheetBody`. Screenshots `.improve/artifacts/IMP-045/desktop-11-after.png`, `.improve/artifacts/IMP-045/mobile-06-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 × 5 / 1 = **20**
- **Notes:** Two acceptable implementations: `useEffect(() => { bodyRef.current.scrollTop = 0 }, [activeTool])`, or giving the scroller `key={activeTool}`. Prefer the effect — a `key` remount also destroys focus and transient panel state.

### IMP-046 — Clear the tool tab bar from the sheet body's last row and fade the overflow
- **Status:** TODO
- **Category:** responsiveness
- **Type:** bug-fix
- **Area / files:** `src/components/controls/controls.module.css:250` (`.sheetBody`), `src/components/controls/sheetHeights.ts`, `src/components/editor/ToolTabBar.tsx`, evidence `.improve/artifacts/baseline/desktop-12-looks-panel.png`, `desktop-13-passport-panel.png`, `desktop-15-export-panel.png`, `desktop-20-draw-controls.png`, `mobile-06-crop-sheet.png`
- **Intent:** The sheet body ends at y 729 and the bottom tool bar begins at y 729 with **no padding to clear it**, so the final row of any overflowing panel is cut in half. Captured at the A3 print size, the CINEMATIC look row, the "US visa" chip, the METADATA row, the "Hard" blend mode, and the 4 × 6 in print row at 390 px. Six separate surfaces read as "clipped" rather than "scrollable", because every scroll container in the app uses a zero-width overlay scrollbar.
- **Acceptance criteria:**
  1. At **1280 × 800** and at **390 × 844**, the sheet body's `padding-bottom` is at least the measured height of the tool bar (`getBoundingClientRect().height` of `nav[aria-label="Editor tools"]`) plus 8 px, so a panel scrolled to `scrollHeight` shows its last row fully above the bar.
  2. A bottom fade mask on the sheet body is **opacity 0** when `scrollTop + clientHeight >= scrollHeight - 1` and **opacity > 0** otherwise.
  3. `e2e/journey.panel-seams.spec.ts` gains a case that, for Looks, Passport, Export and Draw, scrolls the sheet to the bottom and asserts the last item's `boundingBox().y + height <= sheetBody.boundingBox().y + sheetBody.boundingBox().height` — no bisection.
  4. The fade does not appear at the top of an unscrolled panel (asserted in the same case).
- **Verification method:** `npm test` for `src/components/controls/responsiveLayout.test.ts` (a token/value assertion on the padding rule, which is pure). Geometry in `e2e/journey.panel-seams.spec.ts` on the fixture `test`, locating items by accessible name (`CINEMATIC`, `US visa`, `METADATA`, `Hard`) — not by the `[class*="sheetBody"]` selector the file currently uses at `:199-226`; migrate that as part of IMP-066 or accept the technical debt explicitly in the item's notes. Screenshots under `.improve/artifacts/IMP-046/`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 × 5 / 1 = **20**
- **Notes:** `AGENTS.md`'s width warning is the trap here — a jsdom test can assert the padding token exists but not that the last row clears. The e2e case is the gate.

### IMP-047 — Make BottomSheet's focus trap honour `tabIndex={-1}`
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/controls/BottomSheet.tsx:10` (`const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`), `src/components/controls/BottomSheet.tsx:126-143`, reference implementation `src/components/editor/HelpOverlay.tsx:31-48`, `src/components/controls/BottomSheet.test.tsx`
- **Intent:** The `:not([tabindex="-1"])` exclusion applies to the `[tabindex]` selector only, so a control that deliberately asked to be left out of the tab order — HelpOverlay's four `tabIndex={-1}` digit-key controls — is pulled straight back by `focusable()[0]?.focus()` when the sheet opens. Two focus traps in one repository disagree, and `HelpOverlay.tsx:31-48` documents why its own version is correct.
- **Acceptance criteria:**
  1. `FOCUSABLE` excludes any element whose own `tabindex` attribute is `-1`, regardless of tag: e.g. `button[tabindex="-1"]` is not in the returned list.
  2. A unit case in `src/components/controls/BottomSheet.test.tsx` renders a sheet containing `<button tabIndex={-1}>` as the first focusable candidate plus a normal button after it, opens the sheet, and asserts `document.activeElement` is the normal button, not the `tabIndex={-1}` one. This is a focus assertion jsdom **can** make honestly.
  3. Tabbing inside the sheet still cycles and does not escape to the page behind it (existing behaviour preserved).
  4. `HelpOverlay.tsx:31-48` and `BottomSheet.tsx` end up sharing one implementation, or a comment in each states why they differ.
- **Verification method:** `npx vitest run src/components/controls/BottomSheet.test.tsx` then `npm test`. Add a real-browser confirmation in `e2e/journey.a11y-keys.spec.ts` on the fixture `test`: open a tool sheet at **390 × 844**, press `Tab`, and assert `page.evaluate(() => document.activeElement?.getAttribute('tabindex'))` is not `'-1'`. Note from `AGENTS.md` that real-`Tab` assertions are dark on the WebKit leg unless `FULL_TAB_NAVIGATION` is set — say so in the notes rather than claiming WebKit coverage.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 × 5 / 1 = **20**
- **Notes:** The recon rates this MED and it is the cheapest accessibility fix in the tier. Extracting the shared `FOCUSABLE` selector into one exported constant is the shape that stops the two traps drifting again.

### IMP-048 — Tag the `--ie-tap` family in the DOM and migrate all three class-regex selectors
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `e2e/a11y-measure.spec.ts:169-171` (`readsIeTap`), `:299` (the `familySeen > 0` anti-vacuity guard), `:314-337` (the third copy, `[class*="iconButton"]` / `[class*="doneButton"], [class*="primaryButton"]`), `src/components/controls/IconButton.tsx:16`, `src/components/controls/controls.module.css`
- **Intent:** The tap-target family is identified by regex-matching **hashed CSS-module class names** in the measurement *and* in both anti-vacuity guards. Rename `iconButton` in `controls.module.css` and all three flip together — the "reads as a clean pass" outcome the file's own header at `:46-49` calls worse than no gate. Tagging the family in the DOM with `data-tap` makes the gate survive the rename it is currently one commit away from.
- **Acceptance criteria:**
  1. Every element that reads `--ie-tap` carries `data-tap` in the DOM; `grep -rn 'ie-tap' src/ | wc -l` and the number of `data-tap` emissions agree per component, and `readsIeTap` becomes `element.hasAttribute('data-tap')` — no class-name string remains.
  2. All three sites select `[data-tap]` (or `[data-tap="primary"]` where the guard distinguishes families); no regex of the form `/_[a-zA-Z]+_/.test(className)` survives anywhere in `e2e/`.
  3. The vacuity guard at `:299` and the existence test at `:314-337` read the **same** attribute as the measurement, so a rename cannot desynchronise them.
  4. `e2e/a11y-measure.spec.ts` still reports a non-zero `familySeen` and a `measured` distinct-target count above the existing floor of 140, at **1280 × 800**.
  5. Renaming `iconButton` in `src/components/controls/controls.module.css` and re-running `npx playwright test e2e/a11y-measure.spec.ts --project=chromium` leaves the case green — the rename-proof, recorded by the implementer in the PR description with the command output, since it is the only way to tell a fixed selector from an unchanged one.
- **Verification method:** `npx playwright test e2e/a11y-measure.spec.ts --project=chromium` (single spec). Then prove the gate is no longer rename-fragile: temporarily rename the CSS-module class, re-run, and confirm the case still passes — record that result in the item's notes. Unit side: `src/components/controls/` has no `IconButton.test.tsx`, so add one asserting `data-tap` is emitted for the default and active variants.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 × 5 / 1 = **20**
- **Notes:** This is tooling work but it is a **gate** fix, not cleanup: the current arrangement makes a green run untrustworthy. Do not add a new entry to `e2e/a11y.spec.ts`'s `ALLOWED` list to make anything pass — the list is empty by decision and a new entry needs a one-line reason. Merged from deleted IMP-103 (same three regex copies, same fix); IMP-103's criterion 3 became criterion 4 here. Path corrected: the classes live in `src/components/controls/controls.module.css`, not `src/components/ui/controls.module.css`.

### IMP-049 — Make `Stepper` announce its value and associate its label
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/controls/Stepper.tsx:19-31`, new sibling `src/components/controls/Stepper.test.tsx`
- **Intent:** The `fieldLabel` span has no `htmlFor` and the value span has no role and no `aria-live`. Pressing **Increase Width** moves a number that a screen reader never reads, and the component has no test at all, so nothing pins the structure. Stepper is used by the Export SIZE fields, so this is on the path to the app's primary output.
- **Acceptance criteria:**
  1. The label span is associated with the group by a stable `id` (e.g. `aria-labelledby` on a `role="group"` wrapper), and a new `src/components/controls/Stepper.test.tsx` asserts the accessible name of the group equals the visible `fieldLabel` text.
  2. The value span has `role="status"` (or `aria-live="polite"`) and its text content is the formatted current value; a unit test renders the Stepper, clicks **Increase Width**, and asserts the live region's text changed to the incremented value.
  3. Both the increment and decrement buttons keep their existing accessible names (`Increase Width` / `Decrease Width`) and both are reachable by keyboard.
  4. `npx vitest run src/components/controls/Stepper.test.tsx` is green, and `npm run lint` reports no `jsx-a11y` warning for the new markup.
- **Verification method:** `npx vitest run src/components/controls/Stepper.test.tsx` (fast path) then `npm test`, `npm run typecheck`, `npm run lint`. Browser confirmation is optional and belongs to `e2e/journey.export-width.spec.ts` on the fixture `test` using `page.getByRole('group', { name: 'Width' })` — note in the notes that jsdom **can** assert live-region text, so this is a legitimate unit-level fix.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 5 / 1 = **15**
- **Notes:** `aria-live="polite"` on a value that changes on every arrow-key repeat can be chatty; `role="status"` on the value wrapper is the standard middle ground and is what the acceptance criteria name.

### IMP-050 — Give `ColorField` an accessible value and a visible hex readout
- **Status:** TODO
- **Category:** accessibility
- **Type:** improvement
- **Area / files:** `src/components/controls/ColorField.tsx:12-21`, `src/components/controls/controls.module.css`, new sibling `src/components/controls/ColorField.test.tsx`, evidence `.improve/artifacts/baseline/desktop-20-draw-controls.png`
- **Intent:** The control's accessible name is right, but `input[type=color]` exposes no text value, so a screen-reader user hears "Colour, colour picker" and never the colour. The recon also records the Draw panel's swatch as having **no `aria-label` at all** with the visible word "Colour" in a sibling `<span>` rather than a `<label>`. A colour well with no value and no name is unusable non-visually.
- **Acceptance criteria:**
  1. `input[type=color]` has `aria-valuetext` equal to the hex form of the current value (e.g. `#3366ff`), and a new `src/components/controls/ColorField.test.tsx` asserts it after both an initial prop and a change event.
  2. The visible word "Colour" is a real `<label htmlFor>` bound to the input's `id`, not a bare `<span>`; the unit test asserts `getByLabelText('Colour')` returns the input.
  3. A visible monospace hex readout sits beside the swatch and updates on change; the test asserts its text matches the hex.
  4. `role="presentation"` or `alt=""` is applied to the swatch's inner rendering so the name is announced once, not twice.
  5. The swatch paints **no square-cornered inner fill inside its rounded frame**: `input[type=color]` gets `appearance: none` with the frame painting the colour, or the frame radius is `0`. Asserted on `getComputedStyle(input).appearance` in a real browser, not from a screenshot — the current `appearance: auto` state is a rendering defect, and it is why `ChipRow`/`ColorField` neighbours look inconsistent.
- **Verification method:** `npx vitest run src/components/controls/ColorField.test.tsx`, then `npm test`, `npm run lint`, `npx prettier --check .`. Browser proof in `e2e/a11y.spec.ts` (axe over WCAG 2.1 A/AA) on the fixture `test` at **1280 × 800** with the Draw sheet open — no new `ALLOWED` entry is added or removed by this change. Screenshot `.improve/artifacts/IMP-050/desktop-20-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 5 / 1 = **15**
- **Notes:** `axe` will not catch "no accessible value" on a colour input — it is a judgement call, not a rule violation, so this item's gate is the new unit test, not the axe run. Absorbs the one non-stylistic half of deleted IMP-067 (the `appearance: auto` colour input painting square corners inside a rounded frame); the radius-scale and focus-ring-token consolidation in IMP-067 was deleted as cosmetic churn that no test could check.

### IMP-051 — Make Download the visually dominant action in the Export sheet
- **Status:** TODO
- **Category:** visual-consistency
- **Type:** improvement
- **Area / files:** `src/components/tools/ExportPanel.tsx`, `src/components/tools/exportSheet.module.css`, evidence `.improve/artifacts/baseline/desktop-16-export-download-belowfold.png`
- **Intent:** In `desktop-16` the four actions — **Download**, **Share**, **Copy**, **Multi-size zip** — are four **identical outline buttons in a 2 × 2 grid**. The one action every user came to this panel for carries exactly the visual weight of the three secondaries, sitting beneath a dense wall of body copy. Primary-action styling is also inconsistent across four surfaces (`desktop-05` Resume filled, `desktop-06` Done bare green text, `desktop-12` a full-width "None" bar, `desktop-16` Download an outline).
- **Acceptance criteria:**
  1. In the Export sheet at **1280 × 800**, the element whose accessible name is `Download` has a **filled** accent background and white text, while `Share`, `Copy` and `Multi-size zip` are ghost or outline. Asserted from `getComputedStyle()` `backgroundColor` differing between Download and Share.
  2. Download is at least as tall as Share and Copy (measured `boundingBox()`), and its `getBoundingClientRect()` area is strictly greater than each of the three.
  3. The app follows one rule everywhere: the single primary action of a surface is a filled accent button, every other action is ghost or bare. The other three surfaces (`ImportScreen` Resume/Discard, Looks "None", editor top-bar **Done**) either already satisfy it or are listed with a one-line reason in the item's notes.
  4. `npx vitest run src/components/controls/responsiveLayout.test.ts` (or a new sibling for the export sheet styles) still passes, and no existing e2e case asserts the old outline styling.
- **Verification method:** `npm test`. Real-browser proof in `e2e/journey.export.spec.ts` on the fixture `test`, locating buttons by `page.getByRole('button', { name: 'Download' })` etc. — never by `.footer-meta` or any `styles.` class — asserting computed background colours. Screenshot `.improve/artifacts/IMP-051/desktop-16-after.png` and `.improve/artifacts/IMP-051/mobile-07-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 5 / 1 = **15**
- **Notes:** Purely visual hierarchy, so the gate is a computed-style assertion, not a screenshot. Do **not** change the token set here — IMP-067 owns the radius/focus-ring/primary-action token consolidation; this item only applies an existing token.

### IMP-052 — Reset dialog scroll on reopen and show overflow in the Appearance and Shortcuts dialogs
- **Status:** TODO
- **Category:** ux
- **Type:** bug-fix
- **Area / files:** `src/components/ui/AppearanceMenu.tsx`, `src/components/ui/appearanceMenu.module.css`, `src/components/editor/HelpOverlay.tsx`, `src/components/ui/AppearanceMenu.test.tsx`, `src/components/editor/HelpOverlay.test.tsx`, evidence `.improve/artifacts/baseline/mobile-08-appearance-panel.png`, `.improve/artifacts/baseline/mobile-09-shortcuts-dialog.png`
- **Intent:** Both dialogs keep their scroll position across close/reopen and both use zero-width overlay scrollbars (`offsetWidth - clientWidth === 0`). Measured at **390 × 844**: the Appearance body is `scrollHeight 898` in a `clientHeight 664`, so MOTION is sliced at the viewport edge and **"Icon size" is entirely invisible**; the Shortcuts dialog is 796 px tall in an 844 px viewport with its title wrapped to two lines and its diagnostics block cut mid-sentence. A setting that is simply not on screen does not exist for the user.
- **Acceptance criteria:**
  1. Reopening either dialog sets its body `scrollTop` to `0`.
  2. Each dialog body carries a bottom fade mask that is `opacity > 0` when `scrollTop + clientHeight < scrollHeight - 1` and `opacity === 0` otherwise — the same mechanism as IMP-046, implemented once in a shared hook if the two dialogs share a scroller.
  3. At **390 × 844**, with the Appearance dialog open and scrolled to the bottom, the control with accessible name **Icon size** is inside the dialog's visible box: `boundingBox().y + height <= dialogBox.y + dialogBox.height`.
  4. No new entry is added to `e2e/a11y.spec.ts`'s `ALLOWED` list, which is empty by decision.
- **Verification method:** `npm test` for the mount-time reset (jsdom can assert a `scrollTop` assignment on a stub). Geometry in `e2e/journey.appearance.spec.ts` on the fixture `test`, opening Appearance at **390 × 844** via `page.getByRole('button', { name: /Appearance/ })`, then scrolling the dialog and asserting the Icon size row is in the box. Screenshots `.improve/artifacts/IMP-052/mobile-08-after.png`, `.improve/artifacts/IMP-052/mobile-09-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 5 / 1 = **15**
- **Notes:** The 390 px viewport used here is a narrow-viewport desktop context — `hasTouch` / `isMobile` are **not** set, matching the recon's stated caveat. Layout-at-390 px is in scope; touch behaviour is not claimed. Consider factoring the "fade when overflowing" logic with IMP-046 rather than writing it twice.

### IMP-053 — Put the exit path within reach at 390 px instead of last in DOM order
- **Status:** TODO
- **Category:** responsiveness
- **Type:** improvement
- **Area / files:** `src/components/editor/ToolTabBar.tsx:69-110`, `src/components/editor/editor.module.css`, `src/components/editor/ToolTabBar.test.tsx`, `src/components/ui/useMediaQuery.ts`, evidence `.improve/artifacts/baseline/mobile-05-editor-loaded.png`
- **Intent:** The two tools that get a user **out** of the editor — **Passport** and **Export** — are last in DOM order and therefore furthest off-screen at 390 px, where the bar overflows 629 px. The recon calls this the single highest-value mobile fix: the primary exit path is the hardest thing to reach at the viewport where it matters most. A fade (IMP-042) makes the scroller legible; this item makes Export **discoverable**.
- **Acceptance criteria:**
  1. At **390 × 844**, with no user interaction after load, the element with accessible name **Export** is fully inside the tool bar's visible box (`boundingBox().x >= 0` and `x + width <= 390`) **or** is reachable in at most two taps: one tap on a `More tools` affordance, then one on Export.
  2. If a "more tools" sheet is used, it exposes all eight tools currently off-screen (Text, Draw, Stickers, Redact, Frame, Layers, Passport, Export) and each keeps its existing accessible name; every one is reachable by keyboard in DOM order.
  3. At **1280 × 800** the change is invisible: all 13 tools remain in one row in the existing order, no "More tools" affordance appears, and `nav.scrollWidth <= nav.clientWidth`.
  4. DOM order in the tab bar still matches visual order (a screen reader and a Tab press must agree), and the bottom-bar tab-order claim in the recon's "recorded as correct" list still holds.
- **Verification method:** `npm test` for the responsive branch (`src/components/editor/ToolTabBar.test.tsx` with a mocked `matchMedia`). Real browser: `e2e/journey.mobile.spec.ts` on the fixture `test` at **390 × 844**, loading Sample 1 and asserting the Export affordance is visible or one tap away, then clicking it and asserting the Export sheet's accessible name is `Export` — reachable without a horizontal scroll gesture. Also assert on **1280 × 800** in `e2e/journey.responsive.spec.ts` that no overflow affordance appears. Screenshot `.improve/artifacts/IMP-053/mobile-05-after.png`.
- **Effort:** M  **Risk:** med
- **Depends on:** IMP-042
- **Priority score:** 5 × 5 / 2 = **12.5**
- **Notes:** A 3-up icon grid at ≤ 480 px and a "More" sheet are the two options the recon names; the grid is better discoverability and worse for labels at 390 px, so the implementer should pick one and record why. Do not simply reorder the DOM so Export is first — the tool bar's logical order (image ops → layers → output) is a deliberate design and the recon records its tab order as correct.

### IMP-054 — Give the bottom-sheet detent a keyboard route
- **Status:** TODO
- **Category:** accessibility
- **Type:** improvement
- **Area / files:** `src/components/controls/BottomSheet.tsx:167` (`<div className={styles.sheetGrabber} onPointerDown={onPointerDrag} />`), `src/components/controls/BottomSheet.tsx:73-92` (the pointer drag), `src/components/controls/BottomSheet.test.tsx`, `src/components/controls/sheetHeights.ts`
- **Intent:** `onDetent` is called from exactly one place: the drag's `onEnd`. The grabber is a bare `<div>` with a pointer handler, no `role`, no accessible name, and it is not focusable. A keyboard or switch user on a phone cannot raise or lower the sheet — and lowering it is the documented way to get the image back (`src/pages/EditorCanvas.tsx:226-228`). Both existing e2e drivers reach the detent by touch (`journey.mobile-touch.spec.ts:556`, `journey.inspector-layout.spec.ts:259`), so nothing catches this.
- **Acceptance criteria:**
  1. The grabber exposes `role="separator"`, `aria-orientation="horizontal"`, `tabIndex={0}`, an accessible name, and `aria-valuenow` reflecting the current detent index with a human `aria-valuetext`.
  2. `ArrowUp` / `ArrowDown` move one detent, `Home` goes to the smallest and `End` to the largest, and each calls the **same** `onDetent` the pointer drag's `onEnd` calls — one code path, asserted by a unit test that spies on the callback.
  3. A third, taller detent is offered for the sheets that need canvas reference (Crop, Retouch), so the portrait photo is not reduced to a 135 × 204 thumbnail at the default 66 % detent.
  4. The pointer drag still works and still produces the same detent set (no behaviour change for touch users).
  5. `e2e/journey.mobile-touch.spec.ts` gains a case on the `mobile` project: focus the grabber by `getByRole('separator')`, press `ArrowDown`, and assert the sheet's `boundingBox().y` decreased — the project that owns `/journey\.mobile/` is the one place the keyboard route is not dark.
- **Verification method:** `npx vitest run src/components/controls/BottomSheet.test.tsx` — jsdom can fire `keydown` and assert the `onDetent` spy, so this is honestly unit-verifiable. Then `e2e/journey.a11y-keys.spec.ts` on the fixture `test` at **390 × 844**: focus the grabber via `page.getByRole('separator')`, press `ArrowUp`, and assert the sheet's `boundingBox().y` decreased. Record in the notes that real-`Tab` assertions are dark on the WebKit leg unless `FULL_TAB_NAVIGATION` is set (`AGENTS.md` known-flaky list).
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 5 × 5 / 2 = **12.5**
- **Notes:** `role="separator"` on a focusable element with `aria-valuenow` is the window-splitter pattern and is what the quality recon prescribes. Keep `aria-valuetext` human ("Half height") rather than the raw index. Merged from deleted IMP-092, which filed the same fix against a non-existent path (`src/components/ui/BottomSheet.tsx`; the real file is `src/components/controls/BottomSheet.tsx`). IMP-092's mobile-project e2e case became criterion 4. The accessibility recon numbers this finding 34 (HIGH); it is kept here rather than in Tier 3 because the defect is a journey dead end for a switch user.

### IMP-055 — Reclaim the dead band between the canvas and the tool bar at 390 px
- **Status:** TODO
- **Category:** responsiveness
- **Type:** improvement
- **Area / files:** `src/components/editor/editor.module.css` (workspace / canvas container), `src/pages/Editor.tsx`, `src/components/editor/ToolSurface.tsx`, evidence `.improve/artifacts/baseline/mobile-05-editor-loaded.png`
- **Intent:** In `mobile-05` the image bottom sits at roughly y 682 and the tool bar top at roughly y 750, leaving a band of empty black that is neither canvas nor chrome. Measured at 1271 × 1920 in a 135 × 204 preview, the canvas is not filling the space it has been given. That band is the single most valuable 60–100 px on a phone.
- **Acceptance criteria:**
  1. At **390 × 844** with an image loaded and no panel open, the vertical gap between the canvas container's `bottom` and the tool bar's `top` is **≤ 16 px**, measured with `getBoundingClientRect()`.
  2. The image is scaled up to consume the reclaimed space: the rendered canvas height increases by at least the reclaimed pixels, and the aspect ratio is still within 1 % of the source's 0.662.
  3. At **1280 × 800** the gap is unchanged from baseline (16 px above and 16 px below, per the recon's "recorded as correct" measurement) — this item must not disturb the desktop framing.
  4. No regression when a bottom sheet is open: the canvas shrinks to the sheet's detent as before.
- **Verification method:** `npm test` for the layout token. Real browser in `e2e/journey.responsive.spec.ts` on the fixture `test`: load Sample 1, read both rectangles at **390 × 844** and at **1280 × 800**, assert the gap. Screenshots `.improve/artifacts/IMP-055/mobile-05-after.png` and `.improve/artifacts/IMP-055/desktop-06-after.png` compared against `.improve/artifacts/baseline/`.
- **Effort:** S  **Risk:** low
- **Depends on:** IMP-042
- **Priority score:** 3 × 4 / 1 = **12**
- **Notes:** Confidence is 4 rather than 5 because the exact source of the band (canvas `object-fit` letterboxing vs. a container `padding`) has not been isolated from the source — the implementer must measure before editing. Do not remove the band by cropping the image: the aspect-ratio criterion is the guard against that.

### IMP-056 — Settle whether the Hub tool grid paints below the hero at 390 px
- **Status:** TODO
- **Category:** ux
- **Type:** bug-fix
- **Area / files:** `.improve/artifacts/baseline/mobile-01-hub-hero.png` vs `.improve/artifacts/baseline/mobile-02-hub-grid.png`, `src/pages/Hub.tsx:124-142`, candidate fix in `src/components/ui/IconTile.tsx`
- **Intent:** `.improve/artifacts/baseline/mobile-01-hub-hero.png` is a full-page capture at **390 × 844** that shows roughly a 1200 px void below the hero, which reads as "the tool cards never rendered". `.improve/artifacts/baseline/mobile-02-hub-grid.png` shows the cards **do** render once scrolled. **This item exists to decide which is true** — a real defect at 390 px (content clipped, unreachable, or zero-height) or a capture artefact of `fullPage` + the reveal observer. It is explicitly not asserted as a bug.
- **Acceptance criteria:**
  1. A recorded measurement at **390 × 844**: `document.querySelectorAll` count of tool-card links, each card's `boundingBox()`, and each card's computed `opacity` and `visibility` — both at `scrollY = 0` and after a programmatic scroll.
  2. A `fullPage` screenshot captured **after** `page.waitForFunction` that every card's computed `opacity > 0.99`, saved to `.improve/artifacts/IMP-056/mobile-01-after.png`, shows all 8 cards.
  3. The conclusion is written down in one of two forms: (a) **defect** — the grid is genuinely not painted at 390 px with no scroll, in which case this item's status stays TODO and a fix follows, or (b) **capture artefact** — the grid paints, the earlier capture simply preceded the observer, in which case the note records that and IMP-043's `fullPage` assertion is the permanent guard.
  4. If (a), the fix lands with its own real-browser proof at **390 × 844**; if (b), no source change is made and the reason is recorded so the question is not reopened.
- **Verification method:** one Playwright case in `e2e/journey.responsive.spec.ts` (fixture `test`, `page.setViewportSize({ width: 390, height: 844 })`) that reads the card count, each card's `boundingBox()`, `opacity` and `visibility` at `scrollY = 0` and after a programmatic scroll, then takes a `fullPage` screenshot **after** `page.waitForFunction` that every card's `opacity > 0.99` and saves it to `.improve/artifacts/IMP-056/mobile-01-after.png`. The mobile project (`journey.mobile*`) is a prefix covering two specs, not one — see `AGENTS.md`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 × 3 / 1 = **12**
- **Notes:** Confidence is 3 precisely because the two baseline screenshots disagree and this item's job is to resolve that with a measurement rather than an opinion. Outcome (b) is a perfectly respectable result and the notes must say so. Verification method rewritten: it named a specific local dev-server port and a specific PID, which is stale machine state rather than a checkable procedure. The measurement is now one Playwright case that a verifier can run from a clean checkout. `src/pages/Hub.tsx` path confirmed.

### IMP-057 — Stop the Compare toggle from changing its own accessible name
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/canvas/EditorCanvas.tsx` (Compare toggle), `src/store/uiStore.ts:217` (`compare` flag), `src/pages/Editor.test.tsx`, evidence `.improve/artifacts/baseline/desktop-06-editor-loaded.png`
- **Intent:** The Compare control's accessible name is derived from its pressed state, so pressing it changes the label a screen-reader user is about to hear — a WCAG 2.2 SC **3.2.4 Change on Request** problem: a label that changes when the control is activated reads as an unrequested context change. It is also a plain e2e hazard: any spec locating the control by name breaks the moment the name changes.
- **Acceptance criteria:**
  1. The control keeps **one** accessible name in both states (e.g. `Compare`); the on/off state is conveyed only by `aria-pressed` (or `aria-checked`).
  2. A unit case in `src/pages/Editor.test.tsx` asserts the accessible name is identical before and after activation, and that `aria-pressed` flips.
  3. `e2e/journey.a11y-keys.spec.ts` on the fixture `test` asserts the name is stable across a real click at **1280 × 800**.
  4. Any existing spec or documentation referring to the old two-state name is updated in the same pass (grep for both strings).
- **Verification method:** `npm test` (jsdom is sufficient — this is a name-and-attribute claim, not a layout claim), then `npx playwright test e2e/journey.a11y-keys.spec.ts --project=chromium`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 4 / 1 = **12**
- **Notes:** The recon's "no e2e spec exists for Compare" gap is a separate journey-coverage item owned elsewhere; this item is only the naming contract.

### IMP-058 — Give the layer-row glyph controls real accessible names
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/tools/LayerPanels.tsx` or the layer list in `src/components/tools/LayerPanels.tsx`, `src/components/controls/IconButton.tsx:16`, `src/components/controls/IconButton.test.tsx`
- **Intent:** The layer rows' per-layer controls are raw Unicode glyphs with no visible label and, per the recon's icon-only inventory, no accessible name — so a screen-reader user reaches an unlabelled control per row, multiplied by the row count. The recon's table shows the same class of failure on the Draw colour swatch (no `aria-label` at all) and on the four Crop rotate/flip glyphs, which hold the only rotate/flip controls in the app.
- **Acceptance criteria:**
  1. Every glyph-only control in the layers panel exposes an accessible name built from the layer's own name, e.g. `Hide Flood layer`, `Delete Flood layer`, `Reorder Flood layer` — verified by a unit test asserting the full name string.
  2. The glyph characters are marked `aria-hidden="true"` so the accessible name is the label, not the glyph codepoint.
  3. The same rule is applied to the four Crop rotate/flip/fill glyphs in `src/components/tools/CropPanel.tsx` and to the blend-mode glyph row in `src/components/tools/LayerPanels.tsx`: no control in `src/components/**` is reachable with an empty accessible name. The colour well is `src/components/controls/ColorField.tsx` and is owned by IMP-050.
  4. A new `src/components/controls/IconButton.test.tsx` (the component currently has no test) asserts `getByRole('button')` resolves by accessible name, not by glyph text.
- **Verification method:** `npm test`. Real browser in `e2e/journey.layers.spec.ts` on the fixture `test`, creating two layers at **1280 × 800** and asserting `page.getByRole('button', { name: 'Delete Flood layer' })` (or the actual layer name) is present and focusable. Optionally `e2e/a11y.spec.ts` for the axe pass — with **no** new `ALLOWED` entry, since that list is empty by decision.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 4 / 1 = **12**
- **Notes:** Confirm the file that owns the layer row before editing — the recon names the control but not its component. Keep visible labels off the glyphs; the accessible name is for assistive tech, and a `title` alone is not enough (see IMP-059). The recon named the control but not its component; verified against the tree, the layer rows and the blend chips are both in `src/components/tools/LayerPanels.tsx` (the glyph buttons at `:1298-1333`, the row at `:1179`). Neither `src/components/editor/LayerRow.tsx` nor `src/components/tools/LayersPanel.tsx` exists.

### IMP-059 — Make the "Auto tone" description reachable without hover
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/tools/AdjustPanel.tsx`, `src/components/controls/ParameterRing.tsx`, evidence `.improve/artifacts/baseline/desktop-11-adjust-panel.png`
- **Intent:** **Auto tone** explains itself only through a `title` attribute, which is unreachable on touch and unreliable for keyboard and screen-reader users. The recon lists it as one of exactly two hover/pointer-only affordances in the app that matter. Its sibling **Reset Exposure** is a ghost button beside a filled primary, so the pair reads correctly visually while the primary's explanation does not exist non-visually.
- **Acceptance criteria:**
  1. The Auto tone control is associated with a visible-or-assistive description via `aria-describedby` pointing at an element that is in the DOM (visible, or visually hidden but not `display: none`).
  2. That description explains what Auto tone does — it analyses the image and sets exposure/contrast/warmth to a starting point — in one sentence, and is **not** a `title` attribute.
  3. The element is reachable at **1280 × 800** and **390 × 844**, and the description is announced: a unit test asserts `getByRole('button', { name: /Auto tone/ })` has a non-empty accessible description.
  4. If the text is visually hidden, it is hidden with a method that keeps it in the accessibility tree (the repo has no `visually-hidden` utility — add one to the shared controls stylesheet and use it).
- **Verification method:** `npm test` with a new sibling test for the adjust panel's control, asserting the `aria-describedby` target resolves to a non-empty string. Then `e2e/journey.adjust-legibility.spec.ts` on the fixture `test` at **1280 × 800**, reading the computed `accessibilityDescription` (or the referenced element's text) for the Auto tone button. Screenshot `.improve/artifacts/IMP-059/desktop-11-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 4 / 1 = **12**
- **Notes:** A `title` on top of a proper description is acceptable, but the description must stand alone — a spec that only asserts a `title` exists would pass while the defect survives.

### IMP-060 — Pin a sticky action footer in the Export sheet so Download is not 1280 px below the fold
- **Status:** TODO
- **Category:** ux
- **Type:** improvement
- **Area / files:** `src/components/tools/ExportPanel.tsx`, `src/components/tools/exportSheet.module.css`, `src/components/controls/controls.module.css:250` (`.sheetBody`), evidence `.improve/artifacts/baseline/desktop-15-export-panel.png` vs `desktop-16-export-download-belowfold.png`, `mobile-07-export-sheet.png`
- **Intent:** The Export sheet body measures `scrollHeight 1957` in a `clientHeight` of 677 (desktop) / 468 (mobile). **Download** is at the very bottom, after a "FILES 1920 px" note, the FILE NAME field, a **six-line** token-syntax paragraph and the METADATA row — 1280 px at 1280 × 800 and 1489 px at 390 × 844 of scrolling, with an invisible overlay scrollbar and no sticky footer. The panel's whole purpose is to produce a file.
- **Acceptance criteria:**
  1. A footer pinned to the bottom of the sheet contains the **Download** button and is visible when the Export sheet opens, at **1280 × 800** and at **390 × 844**, with `scrollTop === 0` on the sheet body.
  2. The footer's `getBoundingClientRect().y + height` is within 8 px of the sheet body's visible bottom, and it does **not** overlap the tab bar (which begins at y 729 at 1280 × 800).
  3. Scrolling the sheet body to the bottom reveals the last row (the METADATA disclosure) fully above the footer — no bisection.
  4. The footer is `position: sticky` (or fixed within the sheet), so it does not scroll away, and it is reachable by keyboard in DOM order after the panel's fields.
- **Verification method:** `npm test` for the structure. Real browser in `e2e/journey.export.spec.ts` on the fixture `test`: open Export at **1280 × 800**, assert the Download button's `boundingBox().y < 800` with `scrollTop === 0`, click it, and assert the download bytes via `readImageHeader(bytes)` from `e2e/fixtures.ts` — **bytes, not "not empty"**. Repeat the visibility assertion at **390 × 844** in `e2e/journey.mobile.spec.ts`. Screenshots under `.improve/artifacts/IMP-060/`.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 4 × 5 / 2 = **10**
- **Notes:** The recon's alternative is hoisting Download above FORMAT; the sticky footer is better because it survives every scroll position and does not reorder the panel's logic. Pair it with IMP-051 (Download filled) so the footer reads as the primary action, and with IMP-046 so the body's last row clears both the tab bar and the new footer.

### IMP-061 — Collapse the Hub header at ≤ 480 px and stop it occluding scrolled content
- **Status:** TODO
- **Category:** responsiveness
- **Type:** improvement
- **Area / files:** `src/components/ui/Nav.tsx`, `src/components/ui/Nav.module.css`, `src/components/ui/ThemeToggle.tsx`, `src/components/ui/useMediaQuery.ts`, evidence `.improve/artifacts/baseline/mobile-01-hub-hero.png`, `.improve/artifacts/baseline/mobile-02-hub-grid.png`
- **Intent:** Measured at **390 × 844** (`documentElement.scrollWidth === 390`, so this is wrapping, not overflow): the header is **188 px** tall against 84 px on desktop and occupies **22 % of the viewport** before any content, across three rows with three different control heights (50 / 43 / 57) and two baselines. Worse, being sticky it then **occludes ~120 px of scrolled content permanently** — `mobile-02` shows the Looks card with its icon tile and top edge sliced by the header's lower boundary, with no shadow, fade or border saying there is more above.
- **Acceptance criteria:**
  1. At **390 × 844** the header's `getBoundingClientRect().height` is **≤ 120 px**; the primary CTA and at least one secondary control remain on row one.
  2. Scrolling the page 600 px at **390 × 844** leaves **0 px** of card content under the header: for the first card that intersects the header's box, assert the card's `boundingBox().y >= headerBox.y + headerBox.height`.
  3. `html` carries `scroll-padding-top` equal to the header height, so anchor navigation and focus scrolling do not land content under it.
  4. The header gains a bottom shadow or hairline once `scrollY > 0`, and **not** at `scrollY === 0`.
  5. At **1280 × 800** the header is unchanged from baseline (84 px) and the wordmark, Appearance, theme toggle and CTA all stay on one row.
- **Verification method:** `npm test` for the media-query branch. Real browser in `e2e/journey.responsive.spec.ts` on the fixture `test`: at **390 × 844** measure the header height, then `mouse.wheel` 600 px and assert no card pixel intersects the header box; repeat the height assertion at **1280 × 800**. Screenshots `.improve/artifacts/IMP-061/mobile-01-after.png`, `.improve/artifacts/IMP-061/mobile-02-after.png`, compared against `.improve/artifacts/baseline/`. Note in the item record that 390 px in a desktop browser is not the Pixel 7 profile.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 4 × 5 / 2 = **10**
- **Notes:** The recon's minimal fix — collapse "Appearance" to its icon, or move both secondary controls into the Hub's own overflow menu — is a layout judgement with more than one defensible answer, so the acceptance criteria pin the **numbers** (≤ 120 px, 0 px occlusion) rather than the arrangement. Do not turn this into a Hub redesign; that is IMP-070.

### IMP-062 — Restore a visible marker on the collapsed PLATFORM disclosure
- **Status:** TODO
- **Category:** visual-consistency
- **Type:** bug-fix
- **Area / files:** `src/components/tools/CropPanel.tsx` (native `<details>` for PLATFORM / 22 sizes), `src/components/tools/tools.module.css` (`summary` rule), `src/components/tools/CropPanel.test.tsx`, evidence `.improve/artifacts/baseline/desktop-09-crop-rotate-flip-belowfold.png`, `.improve/artifacts/baseline/mobile-06-crop-sheet.png`
- **Intent:** The PLATFORM disclosure is a native `<details>`, so it **is** keyboard-operable and its 22 presets are reachable — but the disclosure triangle is suppressed, leaving a **64 px empty band** between "PLATFORM / 22 sizes" and "PRINT SIZE" with nothing to indicate it expands. A substantial feature (Instagram, TikTok, LinkedIn, X, Facebook, YouTube, Pinterest across 1:1 / 4:5 / 1.91:1 / 9:16 / 16:9 / 2:3) has no visual entry point.
- **Acceptance criteria:**
  1. The `<summary>` renders a visible affordance: either the native marker (`summary { list-style: revert }`) or an explicit chevron glyph marked `aria-hidden` that rotates 180° when `[open]` is set.
  2. Measured at **1280 × 800** with the Crop sheet open, the gap between the PLATFORM row and the PRINT SIZE heading is **≤ 24 px** when collapsed (baseline: 64 px) and grows when expanded to reveal all 22 presets.
  3. All 22 presets are reachable by keyboard after expanding, and the collapsed state reports `aria-expanded="false"`.
  4. No new entry is added to `e2e/a11y.spec.ts`'s `ALLOWED` list.
- **Verification method:** `npm test` for `src/components/tools/CropPanel.test.tsx` (the expanded/collapsed `aria-expanded` contract is unit-checkable). Geometry in `e2e/journey.crop.spec.ts` on the fixture `test` at **1280 × 800**: locate the summary by its accessible text `PLATFORM` and the next heading by `PRINT SIZE`, assert the vertical gap. Screenshot `.improve/artifacts/IMP-062/desktop-09-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 2 × 5 / 1 = **10**
- **Notes:** One CSS rule. The recon classifies it Low; the impact is small but the confidence and the cost are both high, which is why it outranks several larger items on score.

### IMP-063 — Lay chip rows on an even grid instead of ragged flex-wrap
- **Status:** TODO
- **Category:** visual-consistency
- **Type:** improvement
- **Area / files:** `src/components/controls/ChipRow.tsx`, `src/components/controls/controls.module.css`, `src/components/tools/PassportPanel.tsx`, `src/components/tools/LayerPanels.tsx`, `src/components/controls/ChipRow.test.tsx`, evidence `.improve/artifacts/baseline/desktop-13-passport-panel.png`, `.improve/artifacts/baseline/desktop-20-draw-controls.png`
- **Intent:** Chips are packed with flex-wrap, so rows break arbitrarily: `desktop-13` (Passport) packs 1-2-1-1-1-1 with the "US visa" chip cut in half; `desktop-20` (Draw blend modes) packs 2-2-3-1 with **"Hard" alone** on the last row, cut by the tab bar. A grid with an explicit minimum track width makes every row even and makes the "one orphan" pattern impossible.
- **Acceptance criteria:**
  1. Chip containers in the Passport and Draw panels use `grid-template-columns: repeat(auto-fill, minmax(<min>, 1fr))`; no chip row uses bare `flex-wrap` for its items.
  2. Measured at **1280 × 800**, every chip row's chips all have the **same `boundingBox().height`**, and no row has a single chip while the row above has more than one.
  3. At **390 × 844** the Passport chip row wraps to two even rows with no half-clipped chip; the "US visa" chip's `boundingBox()` is fully inside the sheet body's visible box at `scrollTop` 0.
  4. `npx vitest run src/components/controls/ChipRow.test.tsx` is green.
- **Verification method:** `npm test` for the component contract. Real browser in `e2e/journey.passport-document.spec.ts` and `e2e/journey.layer-panels.spec.ts` on the fixture `test`, locating chips by accessible name (`US visa`, `Hard`) and measuring heights. Screenshots `.improve/artifacts/IMP-063/desktop-13-after.png`, `.improve/artifacts/IMP-063/desktop-20-after.png`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 2 × 5 / 1 = **10**
- **Notes:** Pick the minimum track width per surface — a fixed pixel minimum that is too wide for 390 px will reintroduce a one-chip orphan row at the narrow viewport, so the value must be checked at both viewports, not just 1280.

### IMP-064 — Pin `ParameterRing`'s correct aria pairing with a unit test
- **Status:** TODO
- **Category:** accessibility
- **Type:** test
- **Area / files:** `src/components/controls/ParameterRing.tsx:39,66-69`, new sibling `src/components/controls/ParameterRing.test.tsx`
- **Intent:** `ParameterRing` already does the right thing — an accessible name on the ring and a description pointing at the ring's own text — but nothing pins it. A later `title` attribute, a refactor to a plain `<div>`, or a CSS-module rename would silently unpair them and nothing would fail. The recon records this as an unpinned-correct pattern rather than a defect; recording it as a defect would be wrong, and leaving it unpinned means the next change is invisible.
- **Acceptance criteria:**
  1. `src/components/controls/ParameterRing.test.tsx` exists and asserts the ring's accessible name matches its visible label and that its accessible description matches the adjacent explanatory text.
  2. The test asserts the pairing structurally rather than by convention: it queries the ring by `getByRole`, reads `aria-describedby`, and asserts the referenced id resolves to a non-empty element **and** that the ring has no `title` attribute — so adding a `title` to unpair the description fails the case directly.
  3. The ring is reachable by keyboard and its value is announced; the test asserts the value element's text is the current value, not an empty string.
  4. `npx vitest run src/components/controls/ParameterRing.test.tsx` is green and `npm run test:coverage` shows the `src/components/**` area still above its threshold (baseline 87.3 lines vs 84).
- **Verification method:** `npx vitest run src/components/controls/ParameterRing.test.tsx` then `npm test` and `npm run test:coverage`. jsdom is sufficient — this is an accessible-name/description attribute claim, not a layout claim, so no browser is needed.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 2 × 5 / 1 = **10**
- **Notes:** Deliberately a test item, not a fix. Its value is that it converts "recorded as correct" into "enforced", which is the distinction `AGENTS.md` draws between a `Working` row and an `Untested` one in `docs/FEATURES.md`.

### IMP-065 — Announce that the drawing canvas requires a pointer
- **Status:** TODO
- **Category:** accessibility
- **Type:** improvement
- **Area / files:** `src/components/canvas/EditorCanvas.tsx`, `src/components/tools/LayerPanels.tsx`, `src/components/editor/ImportScreen.tsx` (skip-link target `#editor-main`), `src/pages/Editor.test.tsx`, evidence `.improve/artifacts/baseline/desktop-19-draw-tool-panel.png`
- **Intent:** The Draw panel's 19 controls are all keyboard-reachable, but the canvas itself measures `tabindex → null`, `role → null`, `aria-label → null` — so **there is no keyboard way to place a stroke**, and the panel's empty state says only "create one, then sketch on the canvas" with no note that a pointer is required. The gap is sharper because every neighbouring control works. The recon also notes the "Skip to the canvas" link targets the scroll `<main>` (`tabIndex={-1}`), not the canvas, so it overpromises.
- **Acceptance criteria:**
  1. The canvas exposes a name and a description that state it is a drawing surface and that placing a stroke requires a pointer or touch, via `aria-describedby` on a focusable element or a `role`/`aria-label` pair plus adjacent text.
  2. Either the canvas gains `tabIndex={0}` with arrow-key caret movement and Enter/Backspace to drop and lift, **or** the limitation is stated in text a screen reader reaches — and the item's notes record which of the two shipped and why.
  3. The skip link's target and its label agree: if it still targets `#editor-main`, either it targets the canvas or the link text stops claiming it skips to the canvas.
  4. No new entry is added to `e2e/a11y.spec.ts`'s `ALLOWED` list (empty by decision).
- **Verification method:** `npm test` for the attribute contract. Real browser in `e2e/journey.layer-panels.spec.ts` on the fixture `test` at **1280 × 800**: with a drawing layer created, assert the canvas element has a non-empty accessible name and a description containing the word "pointer". Screenshots under `.improve/artifacts/IMP-065/`.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 4 × 4 / 2 = **8**
- **Notes:** Full keyboard drawing is a genuine feature, not a polish item, and it is why the effort is M and the score is below the layout fixes. The recon explicitly warns that **M-05 is likely understated**: Text, Stickers, Redact and Frame were never opened, and those are exactly where drag-only placement lives. Scope this item to Draw and state the limitation; a separate item should cover the other four tools.

### IMP-066 — Add `data-role` attributes and migrate the class-substring selectors out of the e2e suite
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `e2e/fixtures.ts:328` (`page.getByRole('dialog').filter({ has: page.locator('[class*="sheetBody"]') })`), `e2e/journey.panel-seams.spec.ts:199,200,203,204,226`, `e2e/journey.layout-measure.spec.ts:55`, `e2e/journey.export.spec.ts:251`, `e2e/journey.desktop-truthfulness.spec.ts:303`, `e2e/journey.desktop-honesty.spec.ts:59`, `e2e/a11y-measure.spec.ts:146,326,334`, classes `sheetBody`, `helpFadeBottom`, `helpFadeTop`, `menuItemIcon`, `glyphRow`, `readout`, `footer-meta`, `importHint`
- **Intent:** The fixture contract itself selects by hashed CSS-module class substring, in the file whose header states the rule. Seven specs depend on the pattern. Every one of these selectors dies silently on the next rename and says nothing about keyboard reachability — the exact failure mode `AGENTS.md:73-74` forbids. Tagging the DOM once and migrating the selectors is the difference between a gate and a snapshot of today's class names.
- **Acceptance criteria:**
  1. Each of the eight named elements carries a stable `data-role` attribute (`sheet-body`, `help-fade-bottom`, `help-fade-top`, `menu-item-icon`, `glyph-row`, `readout`, `footer-meta`, `import-hint`) that is **not** derived from the CSS-module class name.
  2. `grep -rn '\[class\*=' e2e/` returns **no matches**, and `grep -rn 'class\*' e2e/` likewise returns nothing outside `e2e/fixtures.ts`'s own helpers if any remain.
  3. `e2e/fixtures.ts:328` selects `[data-role="sheet-body"]` and every spec that called `panel(name)` still passes unchanged.
  4. Renaming any one CSS-module class does not change any selector in `e2e/` — demonstrated once by the implementer and recorded in the notes.
- **Verification method:** `npm test` for any component that renders the tagged elements. Then `npx playwright test e2e/fixtures.spec.ts e2e/journey.panel-seams.spec.ts e2e/journey.export.spec.ts e2e/a11y-measure.spec.ts --project=chromium` — scoped to the four specs that use the selectors, not the full 41-file suite. Then `npm run test:e2e` once for the whole inventory.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 3 × 5 / 2 = **7.5**
- **Notes:** Sibling to IMP-048: that one fixes the family that drives the **vacuity guards**, this one fixes the **structural selectors**. Both are needed — fixing only one leaves the other rename-fragile. Do not fold new specs into the old pattern while migrating.

### IMP-068 — Make the empty state's overflow visible and lift the drop zone at 390 px
- **Status:** TODO
- **Category:** responsiveness
- **Type:** improvement
- **Area / files:** `src/components/editor/ImportScreen.tsx`, `src/components/editor/editor.module.css` (`_editorMain_yb6c0_234`), `src/components/ui/EmptyState.tsx`, `src/components/ui/emptyState.module.css`, `src/components/editor/ImportScreen.test.tsx`, evidence `.improve/artifacts/baseline/desktop-04-editor-empty.png`, `.improve/artifacts/baseline/mobile-03-editor-empty.png`
- **Intent:** At **1280 × 800** the document does not scroll (`html.scrollHeight === 800`); content scrolls inside `main._editorMain_yb6c0_234` (`scrollHeight 1333` in a `clientHeight 748`), so on first load the **"Continue editing?" card is cut in half at the fold** — its title baseline at y 782 with 30 px below the viewport — and nothing indicates more exists. At **390 × 844** the same screen is a prose wall: a 6-line hero paragraph plus an 8-line CDN disclaimer, with the drop zone (the only thing a first-time user needs) not beginning until **y ≈ 605 of 844**.
- **Acceptance criteria:**
  1. A bottom fade mask on the scroll container is `opacity > 0` when `scrollTop + clientHeight < scrollHeight - 1` and `opacity === 0` at the bottom, at both **1280 × 800** and **390 × 844**.
  2. At **1280 × 800** with `scrollTop === 0`, the "Continue editing?" heading is either fully inside the viewport or clearly below the fold — its `boundingBox()` is not intersected by the fold. Never half a heading.
  3. At **390 × 844** the drop zone's `boundingBox().y < 500`, achieved by moving the CDN disclaimer behind the existing "How this editor works" disclosure rather than deleting it.
  4. The disclaimer text remains reachable — expanding the disclosure reveals the full text, asserted by an accessible-name lookup, not by a CSS-class check.
- **Verification method:** `npm test` for the structure. Real browser in `e2e/journey.empty-state.spec.ts` on the fixture `test`: at **1280 × 800** assert the Resume card is not bisected by the fold; at **390 × 844** assert the drop zone's y. Screenshots `.improve/artifacts/IMP-068/desktop-04-after.png`, `.improve/artifacts/IMP-068/mobile-03-after.png`.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 5 / 2 = **7.5**
- **Notes:** The privacy disclosure is a licence-adjacent statement (`src/components/editor/privacy.ts`); moving it behind a disclosure is a product-surface change, so state that in the PR rather than dropping it. Criterion 2 must be checked on a **real engine** — jsdom reports `clientHeight === 0` for every element and would pass either way.

### IMP-069 — Fix the sample tiles' proportions and their duplicated accessible name
- **Status:** TODO
- **Category:** ux
- **Type:** bug-fix
- **Area / files:** `src/components/editor/ImportScreen.tsx` (sample tiles), `src/components/editor/editor.module.css`, `src/components/editor/ImportScreen.test.tsx`, evidence `.improve/artifacts/baseline/desktop-05-editor-empty-scrolled.png`, `.improve/artifacts/baseline/mobile-04-editor-empty-samples.png`
- **Intent:** The body `<p>` is **118 px inside a 120 px button** — effectively no horizontal padding — so "A bright sky and a shadowed face — try Brightness and Exposure." wraps to **seven lines**, and tile heights are unequal (274 / 274 / **211 px**) because nothing equalises them. At 390 px the three tiles stay 120 px wide in a 358 px container: two on row one, one **orphaned and centred** on row two, using **66 % of the available width**. The accessible name is worse than the layout: alt text + title + description concatenated with no separator, and the title twice — `"Sample 1 Sample 1 A bright sky and a shadowed face — try Brightness and Exposure."`
- **Acceptance criteria:**
  1. Each tile has `padding: 0 12px` so the copy column is ≤ 96 px, and the copy wraps to **≤ 4 lines** at both **1280 × 800** and **390 × 844**.
  2. All three tiles have the **same `boundingBox().height`** at **1280 × 800** and at **390 × 844**.
  3. The grid is `repeat(auto-fit, minmax(160px, 1fr))` or equivalent, so at **390 px** three tiles occupy **≥ 90 %** of the container width with no single centred orphan.
  4. The accessible name of a tile equals its visible title **exactly once**, with the description delivered via `aria-describedby` and `alt=""` on the thumbnail. A unit test asserts `getByRole('button', { name: 'Sample 1' })` resolves and its accessible description starts with "A bright sky".
- **Verification method:** `npx vitest run src/components/editor/ImportScreen.test.tsx` for the accessible-name contract (jsdom is honest here — it is an attribute claim). Real browser in `e2e/journey.empty-state.spec.ts` on the fixture `test` at both viewports, measuring tile boxes by `getByRole('button', { name: 'Sample 1' })` etc. Screenshots `.improve/artifacts/IMP-069/mobile-04-after.png`.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 × 5 / 2 = **7.5**
- **Notes:** Specs locate the sample tiles by `getByRole('button', { name: /^Sample 1\b/ })` today (see `e2e/a11y-measure.spec.ts`); tightening the name to exactly `Sample 1` keeps those selectors valid because of the `^…\b` anchor. Check `journey.empty-state.spec.ts` and `journey.import-edit-export.spec.ts` for the same pattern before changing the name.

### IMP-070 — Decide whether the Hub gets a wholesale visual redesign
- **Status:** NEEDS-HUMAN
- **Category:** visual-consistency
- **Type:** docs
- **Area / files:** `src/pages/Hub.tsx`, `src/pages/Hub.test.tsx`, `.improve/artifacts/baseline/desktop-01-hub-hero.png`, `desktop-02-hub-tools-grid.png`, `desktop-03-hub-grid-full.png`, `mobile-01-hub-hero.png`, `mobile-02-hub-grid.png`, `docs/FEATURES.md`
- **Intent:** The targeted defects in this tier are all fixable without a product decision (IMP-043, IMP-056, IMP-061). What remains on the Hub is a composition question no test can settle: the hero occupies 44 % of the desktop viewport, the grid ends in a 2-card orphan row at **820 px** of scroll (`desktop-03`), the featured card gets a teal border that no other card has, and at **390 px** the grid's card density is unverified. Someone with taste has to decide whether the Hub's current shape is the product's identity or an accident of ordering. This item exists so that decision is made deliberately and recorded, not deferred indefinitely.
- **Acceptance criteria:**
  1. A written decision in `docs/FEATURES.md` — one paragraph, naming either "keep the current composition" or "redesign", with the reason.
  2. If "keep": each of the four specific complaints above is either accepted in writing or turned into its own scoped backlog item with an ID and a priority — an accepted defect is not silently dropped.
  3. If "redesign": the work is split into items that each fit one verification pass (Effort L with more than four acceptance criteria is not acceptable), and the Hub's existing `e2e/journey.shell.spec.ts` cases are updated **in the same pass** — a redesign that lands without its gates is worse than the current Hub.
  4. No change to the Hub's accessible names, routes, or the number of tool cards (8) as part of the decision itself; those are covered by other items.
- **Verification method:** Human review of the decision text. If implementation follows, the existing `e2e/journey.shell.spec.ts` and `e2e/journey.responsive.spec.ts` cases are the gate, run with `npx playwright test e2e/journey.shell.spec.ts e2e/journey.responsive.spec.ts --project=chromium`, and re-captured screenshots land under `.improve/artifacts/IMP-070/`. No new `e2e/a11y.spec.ts` `ALLOWED` entry is permitted as part of a redesign — the list is empty by decision and a new entry needs a one-line reason.
- **Effort:** L  **Risk:** high
- **Depends on:** none
- **Priority score:** not scored — gated on a human decision
- **Notes:** Marked NEEDS-HUMAN deliberately. Every other item in this tier is a defect with an objective pass/fail; this one is taste, and pretending otherwise is how a redesign lands as unreviewable churn. The four "recorded as correct" items in the recon (crop handles, roving tabindex, aspect ratio, tab order) constrain what a redesign may change.

## Tier 3 — Correctness, performance, testing, tooling and CI

Items in this tier are sorted by priority score descending (impact x confidence / effort,
S=1 M=2 L=3), subject to the same rule as every tier: a `Depends on` entry points at an item
earlier in this file. Verified baselines: all gates green at `676b733`; unit 3060/153;
e2e 659/41; coverage `src/pages/**` = 63.0/51.3/50.9/60.9 vs 60/48/47/57.

### IMP-073 — Record a diagnostic when the WebGL backend fails to construct
- **Status:** TODO
- **Category:** error-handling
- **Type:** bug-fix
- **Area / files:** `src/render/selectBackend.ts:48-52`; consumers `src/hooks/useRenderLoop.ts:401-418`, `src/gl/renderer.ts:258-261`; report surface `src/components/editor/HelpOverlay.tsx`, `src/components/ui/RouteError.tsx`
- **Intent:** `catch { // Fall through to Canvas2D. }` is the only renderer failure in the app that produces no record. A driver that fails `getContext('webgl2')` gives the user a silently slower editor and an **empty** diagnostics report, and both the Help overlay and the crash screen are built on that report. Every other failure path already records, so this one reads as an oversight rather than a decision.
- **Acceptance criteria:**
  1. The catch block calls `recordDiagnostic({ level: 'warn', tag: 'render.backend', message: 'WebGL2 construction failed; using Canvas2D.', error })` with the caught error attached; the comment is replaced by a one-line statement of why the fallback is still correct.
  2. `src/render/selectBackend.test.ts` exists and asserts that a `getContext('webgl2')` that returns `null` produces the fallback backend **and** exactly one diagnostic with `tag === 'render.backend'` and `level === 'warn'`.
  3. The same test asserts the diagnostic's `error` field carries the thrown value (e.g. a `SecurityError`), not `undefined`.
  4. `grep -c 'catch { }' src/render/selectBackend.ts` returns 0 — the bare catch is gone.
- **Verification method:** `npx vitest run src/render/selectBackend.test.ts`; `npm run typecheck`; `npm run lint`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 25 (impact 5 x confidence 5 / S)
- **Notes:** Highest impact-per-effort item in the tier: a four-line change plus one new test file, on the one code path that silently degrades the whole application. `recordDiagnostic` already exists and already has a no-transport guard test in `diagnostics.test.ts`, so no new plumbing.

### IMP-074 — Correct the stale unit-test counts in AGENTS.md, README.md and docs/FEATURES.md
- **Status:** TODO
- **Category:** docs
- **Type:** docs
- **Area / files:** `AGENTS.md:38` (gate table), `AGENTS.md:55`, `AGENTS.md:121`; `README.md:194`, `README.md:241`; `docs/FEATURES.md:943`, `docs/FEATURES.md:1020`
- **Intent:** Every one of these seven locations says "2974 tests in 148 files". `npm test` prints **3060 in 153 files**. `AGENTS.md:126-127` says the command wins and the document is the bug, so this is a self-declared defect with a known fix, and it has been wrong for at least one release.
- **Acceptance criteria:**
  1. All seven locations read 3060 tests in 153 files.
  2. The date qualifier at `AGENTS.md:121` is updated to the date the numbers were re-measured.
  3. `grep -rn '2974\|148 files\|148 test files' AGENTS.md README.md docs/FEATURES.md` returns nothing.
  4. The commit message or the item notes record the two commands used: the `Tests … passed` / `Test Files … passed` lines of `npm test`, and `find src e2e scripts -name '*.test.ts*' -o -name '*.test.mjs' | wc -l`.
- **Verification method:** `npm test` (read the two summary lines); the `grep -rn` above returns no match; `npx prettier --check AGENTS.md README.md docs/FEATURES.md`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** Do this in the same pass as IMP-075 and IMP-076 — `AGENTS.md` §Counting says to update all the count locations together, and a follow-up reader will not know which pass fixed which number. This item will need re-running whenever items that add unit tests land; do not let it go stale a second time.

### IMP-075 — Correct the stale end-to-end counts in AGENTS.md, README.md and docs/FEATURES.md
- **Status:** TODO
- **Category:** docs
- **Type:** docs
- **Area / files:** `AGENTS.md:44`, `README.md:196`, `README.md:243`, `docs/FEATURES.md:580`, `docs/FEATURES.md:600`, `docs/FEATURES.md:747`, `docs/FEATURES.md:930`, `docs/FEATURES.md:972`
- **Intent:** All eight locations say "623 cases in 38 spec files". `npx playwright test --list | tail -1` says **659 cases in 41 spec files**. `AGENTS.md:116` explicitly says "never remember this" and to run the command — the number was remembered anyway.
- **Acceptance criteria:**
  1. All eight locations read 659 cases in 41 spec files.
  2. `grep -rn '623' AGENTS.md README.md docs/FEATURES.md` returns no match, and `grep -rn '38 spec files' AGENTS.md README.md docs/FEATURES.md` returns no match.
  3. The item notes record the exact output line of `npx playwright test --list | tail -1` that the numbers came from.
  4. `AGENTS.md:63` is left as-is (it correctly describes two mobile spec files by prefix) — this item changes no prose, only numbers.
- **Verification method:** `npx playwright test --list | tail -1`; the two `grep -rn` commands return no match; `npx prettier --check AGENTS.md README.md docs/FEATURES.md`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** Split from IMP-074 deliberately: the two numbers move independently, and several items in this tier add e2e cases, which will move this one again. `AGENTS.md:64` already warns the mobile entry is a two-file prefix; that prose is correct and must not be "corrected" to one filename.

### IMP-076 — Correct the claim that the coverage gate is red
- **Status:** TODO
- **Category:** docs
- **Type:** docs
- **Area / files:** `AGENTS.md:43` (gate table), `AGENTS.md:46-47`, `AGENTS.md:113`; `docs/FEATURES.md:601` (row D9-F02), `docs/FEATURES.md` §7.4 distribution text
- **Intent:** Three documents say the coverage gate is RED at `src/pages/**` branches 37.4 vs a threshold of 38, and `docs/FEATURES.md:601` adds a second, also-wrong set of thresholds (`49/38/43/48`, "0.6 under"). The gate is **green** at 63.0/51.3/50.9/60.9 against `vite.config.ts:199`'s 60/48/47/57. A whole paragraph instructs the next implementer to go add tests in `src/pages/` for a failure that does not exist.
- **Acceptance criteria:**
  1. `AGENTS.md:43` reads green, with the measured per-area figures for `src/pages/**` (63.0/51.3/50.9/60.9) quoted and dated.
  2. `AGENTS.md:46-47` is deleted, not softened — it exists only to instruct against fixing a red gate that is not red.
  3. `docs/FEATURES.md:601` quotes thresholds that match `vite.config.ts:199` verbatim, or points at the file and line instead of restating them.
  4. `npm run test:coverage` exits 0 on the branch that makes these edits.
- **Verification method:** `npm run test:coverage` (exit 0); read `coverage/coverage-summary.json` aggregated the way `vite.config.ts` aggregates; `npx prettier --check AGENTS.md docs/FEATURES.md`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** The lesson to preserve: a document that reports a gate's state from memory will eventually report the wrong state. The threshold values now live in `vite.config.ts`; restating them in prose is what created the second wrong number. Prefer pointing at the file.

### IMP-077 — Correct architecture invariants 10 and 11 to match the tree
- **Status:** TODO
- **Category:** docs
- **Type:** docs
- **Area / files:** `AGENTS.md:161-166` (invariant 10), `AGENTS.md:167-171` (invariant 11), `scripts/check-public-budget.mjs:71-88`, `scripts/check-public-budget.mjs:137`, `public/models.lock.json`
- **Intent:** Invariant 10 says `public/` is dirty (74 files untracked); `git status --porcelain public/` is empty. Invariant 11 makes three claims, all stale: `public/models/` "currently holds a 3 758 596 B `face_landmarker.task`" (the directory is **empty**), and the hard-coded prefix exemption is described as live when `check-public-budget.mjs:71-88` documents its **removal** in favour of a real `models.lock.json` pin check at `:137`, with `"models": []`.
- **Acceptance criteria:**
  1. Invariant 10 states that `git status --porcelain public/` is empty at 74 tracked files, and keeps the invariant itself (a dirty `public/` still ships as a 404) without the stale "as of 2026-10-03 it was not".
  2. Invariant 11 states that `public/models/` is empty, that `models.lock.json` carries `"models": []` on purpose, and that the prefix exemption was replaced by a lock pin check — with no sentence describing a 3.7 MB `.task` file.
  3. The sentence "do not trust a 'pinned' line about it" is either kept (it is sound advice) or moved next to the lock check; it is not silently deleted while the surrounding claim is rewritten.
  4. `git status --porcelain public/` is empty and `ls public/models/` lists nothing, re-verified in the same pass.
- **Verification method:** `git status --porcelain public/`; `ls public/models/`; `grep -rn '3758596\|3 758 596\|face_landmarker' AGENTS.md` returns nothing.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** The `face_landmarker.task` reference is a **phantom** that reads like an inventory entry. Nothing in the tree pins or loads it, and a future maintainer could waste an afternoon looking for the download that fetches it.

### IMP-078 — Correct the four remaining stale counts in README.md and the prose around them
- **Status:** TODO
- **Category:** docs
- **Type:** docs
- **Area / files:** `README.md:111` (self-hosted asset size), `README.md:217-218` (`.prettierignore`), `AGENTS.md`/`docs/FEATURES.md` references to `src/model/migrate.ts` line count, `scripts/` file count in `README.md` and `.improve/REPO_PROFILE.md` §1
- **Intent:** Four verified numbers are wrong in the same class as IMP-074/075/076: `README.md:111` claims the committed self-hosted assets are 5.79 MB (measured ~819 kB); `README.md:217-218` lists `.prettierignore` contents that have since changed; `src/model/migrate.ts` is 829 lines, not the 720 quoted in at least one doc; and `scripts/` holds 20 `.mjs` files, not 18.
- **Acceptance criteria:**
  1. `README.md:111` states the measured byte total of `public/luts/ public/look-thumbs/ icons public/fonts/`, and the number was produced by a command recorded in the item notes.
  2. `README.md:217-218`'s `.prettierignore` list matches `.prettierignore` line-for-line, including the `.improve/` entry added in `676b733`.
  3. Every document that gives a line count for `src/model/migrate.ts` says 829.
  4. Every document that counts `scripts/*.mjs` says 20; `grep -rn '18 scripts\|18 `.mjs`\|scripts/.*18 file' README.md AGENTS.md docs/` returns nothing.
- **Verification method:** `du -sk public/luts public/look-thumbs public/fonts` plus `wc -c` on the icons; `wc -l src/model/migrate.ts`; `ls scripts/*.mjs | wc -l`; `npx prettier --check README.md AGENTS.md docs/`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** The 5.79 MB figure is the worst of the four because it is a **user-facing resource claim** in the README, where a reader deciding whether to self-host uses it to size a download. Re-measure before writing; do not scale the old number.

### IMP-079 — Add the missing unit test for src/lib/metadata/abort.ts
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `src/lib/metadata/abort.ts:21-37`; consumer `src/components/tools/ExportSheet.tsx:248-255`
- **Intent:** `raceAbort` is the entire Cancel mechanism for an in-progress export encode — the one operation in the app long enough to need cancelling. No `*.test.*` file anywhere in the repo references it, so a regression here is invisible until a user waits through an encode they cannot stop.
- **Acceptance criteria:**
  1. `src/lib/metadata/abort.test.ts` exists and covers six named cases: abort before the promise starts, abort during, resolve wins when no abort arrives, reject propagates, no signal supplied, and the abort listener is removed from the signal after settle.
  2. The listener-removal case asserts the signal's listener count returns to its pre-call value, not merely that the promise settled.
  3. The abort-during case uses a deferred promise and asserts the returned promise rejects with an `AbortError`-shaped error, matching whatever `abort.ts` actually throws.
  4. Every assertion is a value assertion; zero `expect(true)` and zero snapshots (repo precedent, `recon-quality.md` finding 14).
- **Verification method:** `npx vitest run src/lib/metadata/abort.test.ts`; `npm test` stays at 3060 + the new count; `npx prettier --check src/lib/metadata/abort.test.ts`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** Pure logic with no DOM and no timer dependency, so this is a `jsdom` unit test, not a Playwright case. Do not reach for fake timers unless `abort.ts` actually uses them.

### IMP-080 — Test src/lib/metadata/crc32.ts and delete the duplicate inside dpi.test.ts
- **Status:** TODO
- **Category:** test
- **Type:** bug-fix
- **Area / files:** `src/lib/metadata/crc32.ts:14`; duplicate at `src/lib/metadata/dpi.test.ts:4-22`; sole production consumer `src/lib/metadata/png.ts:1`
- **Intent:** `dpi.test.ts` re-implements the CRC-32 table verbatim instead of importing the module `png.ts` actually uses. The test therefore proves the copy agrees with the copy, not that PNG chunk checksums are correct — and a bug in `crc32.ts` would be replicated faithfully into the test and pass.
- **Acceptance criteria:**
  1. `src/lib/metadata/crc32.test.ts` exists and asserts `crc32` against at least the three standard vectors (`"123456789"` -> `0xCBF43926`, the empty input, and one all-zero input) plus a non-ASCII UTF-8 input.
  2. `dpi.test.ts` imports `crc32` from `./crc32` and its 19-line local table copy is deleted.
  3. The refactor leaves `dpi.test.ts`'s existing assertions and count unchanged — only the duplicate implementation is removed.
  4. A deliberate mutation of `crc32.ts`'s polynomial makes `crc32.test.ts` fail (state the mutation in the notes so a verifier can reproduce it).
- **Verification method:** `npx vitest run src/lib/metadata/crc32.test.ts src/lib/metadata/dpi.test.ts`; `grep -n '0xEDB88320' src/lib/metadata/dpi.test.ts` returns nothing.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** Acceptance criterion 4 is the whole point: a test of a copy cannot fail. Cheap, and it removes a class of self-confirming test from the metadata area.

### IMP-081 — Stop the render loop's idle work: no per-frame createDoc, and do not re-arm when clean
- **Status:** TODO
- **Category:** performance
- **Type:** improvement
- **Area / files:** `src/hooks/useRenderLoop.ts:338`, `src/hooks/useRenderLoop.ts:342`, `src/hooks/useRenderLoop.ts:368-370`
- **Intent:** Two costs are paid for the whole session regardless of whether anything changed. While Compare is held, `createDoc()` runs on every rendered frame — up to 60 times a second — and line 342 then allocates a second object graph for the crop path. And the rAF callback re-arms itself unconditionally *before* its `if (!dirty) return`, so the browser wakes at 60 Hz forever even on a completely idle editor.
- **Acceptance criteria:**
  1. The Compare path uses one module-level unedited template document, created once at module scope, and the frame loop does not call `createDoc()`; `grep -n 'createDoc()' src/hooks/useRenderLoop.ts` shows the call at most once and outside the frame callback.
  2. The re-arm is conditional: the loop stops re-arming when `dirty` is false, and every existing producer still sets `dirty = true` before the next frame is requested — asserted by a test, not by inspection.
  3. A regression test drives N store updates and asserts the number of frames requested equals the number of dirty frames plus one, so an idle editor requests no further frames.
  4. Compare still renders the unedited document when pressed and released, asserted by a case in `e2e/journey.compare*.spec.ts` on the `test` from `e2e/fixtures.ts` that holds compare, reads `readDoc()` for the unedited state and screenshots both halves.
- **Verification method:** `npx vitest run src/hooks/useRenderLoop.test.ts` (or the sibling that exists); `npx playwright test e2e/journey.compare*.spec.ts`; `npm run typecheck`.
- **Effort:** S  **Risk:** med
- **Depends on:** none
- **Priority score:** 20
- **Notes:** Risk med because stopping the re-arm is a real behaviour change: one producer that sets a flag without setting `dirty` loses its frame. Do criterion 2 by enumerating every `dirty = true` site first, and add the frame-count assertion before removing the unconditional re-arm. Split criterion 4 out if the compare journey case proves to need its own item. Path corrected: the render loop is `src/hooks/useRenderLoop.ts` (the sibling test is `src/hooks/useRenderLoop.test.ts`); `src/gl/useRenderLoop.ts` does not exist. Line numbers moved with it: the per-frame `createDoc()` is at `src/hooks/useRenderLoop.ts:338` and the unconditional re-arm at `:369-371`.

### IMP-082 — Pin why @imgly/background-removal is pinned to an exact version
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `package.json:39`, `package.json:45`; `src/lib/licenses.ts` licence row for the dependency; sibling test `src/lib/licenses.test.ts:62-101`
- **Intent:** Every other runtime dependency uses `^`. This one is exact, deliberately, because the CDN chunks the matting build fetches must match the wasm. Nothing tests the reason, so a routine `npm-check-updates` or a hand-edit turns it into `^1.7.0`, no gate fails, and the one dependency whose licence is an open owner decision becomes an unpinned one. A test makes the reason mechanical instead of tribal.
- **Acceptance criteria:**
  1. `src/lib/licenses.test.ts` gains a case asserting the `@imgly/background-removal` range in `package.json` matches `/^\d+\.\d+\.\d+$/` — no `^`, `~`, `>`, or `*`.
  2. The same case asserts that every **other** entry in `dependencies` and `devDependencies` uses a caret range, so the exact pin cannot be quietly generalised.
  3. The case's `it` title states the reason in one line (CDN chunks must match the wasm), so the failure message explains itself without a reader opening `licenses.ts`.
  4. The test imports nothing from `src/lib/licenses.ts`'s `AGPL_DECISION` and does not assert anything about the AGPL obligation itself.
- **Verification method:** `npx vitest run src/lib/licenses.test.ts`; `npm test` green.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 20
- **Notes:** This item deliberately does **not** edit `AGPL_DECISION`, `NOTICE` or the licences panel — it only makes an existing version-range decision fail loudly if reversed. The open owner decision is IMP-109; do not let this test imply it has been made.

### IMP-083 — Make the untested-module list a machine-checked registry, starting with src/gl
- **Status:** TODO
- **Category:** test
- **Type:** tooling
- **Area / files:** registry to add: `src/testing/testRegistry.ts` + `src/testing/testRegistry.test.ts`; the registry's first entries are `src/gl/context.ts`, `src/gl/texture.ts`, `src/gl/framebuffer.ts`, `src/gl/program.ts`, `src/gl/limits.ts`, `src/gl/luts.ts`, `src/gl/pass-colors.ts`, `src/gl/pixel-scale.ts`, `src/gl/quad.ts`; precedent `src/lib/licenses.test.ts:62-101`; existing GL siblings `src/gl/caps.test.ts`, `src/gl/geometry.test.ts`, `src/gl/mask.test.ts`, `src/gl/passes.test.ts`, `src/gl/tiling.test.ts`
- **Intent:** 47 `src/` modules have no sibling `*.test.ts(x)`; nine of them are `src/gl/*.ts` with no test in **any** file. The number is true and nobody acts on it. A registry makes "which module is untested, and why" a recorded fact that a test checks, so the list can only shrink — and so adding a new untested module fails a gate instead of quietly becoming a new row.
- **Acceptance criteria:**
  1. `src/testing/testRegistry.ts` exports an array of `{ module: string; reason: string }` for every `src/**/*.{ts,tsx}` module with no sibling `*.test.{ts,tsx}`, each with a non-empty `reason`; the nine `src/gl/*.ts` names above are in it.
  2. `src/testing/testRegistry.test.ts` asserts (a) every registry entry genuinely has no sibling test file, and (b) every module found by the glob that lacks a sibling test appears in the registry — so adding an untested module fails.
  3. The test prints the registry's length in its failure message, and the registry length is written into `docs/FEATURES.md` §6 with the command that reads it, replacing any hand-maintained "untested modules" prose.
  4. The registry must not include any `*.test.ts`, `*.d.ts`, `main.tsx` or `vite-env.d.ts` entry, and the glob excludes them.
- **Verification method:** `npx vitest run src/testing/testRegistry.test.ts`; deliberately add a new `src/lib/__probe.ts` with no test and confirm the case fails, then delete it.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 15
- **Notes:** This is green on its branch because it asserts the registry is **accurate**, not that it is empty. IMP-099 and IMP-100 remove entries; they do not gate this item. Reuses the shape of `licenses.test.ts:62-101`, which `recon-architecture` records as the repo's existing "a table that cannot rot silently" pattern.

### IMP-084 — Record a diagnostic where PassportPanel's auto-frame and renderer.ts's LUT prepare fail silently
- **Status:** TODO
- **Category:** error-handling
- **Type:** bug-fix
- **Area / files:** `src/components/tools/PassportPanel.tsx:628`; `src/gl/renderer.ts:281` (`void this.prepare(doc).catch(() => {})`); the independent toast at `src/hooks/useRenderLoop.ts:430-436,454-458`
- **Intent:** Two swallowed failures with different user-visible shapes. The passport auto-frame `return`s inside its `try` when there is no source, and the `finally { setBusy('idle') }` hides even the spinner — the button looks inert with no explanation. Separately, `renderer.ts` is a *second* consumer of the LUT prepare failure and drops it, so a frame drawn between that call and the `useRenderLoop` subscription ships the look **ungraded** while the doc says it is applied.
- **Acceptance criteria:**
  1. `PassportPanel.tsx:628`'s silent `return` records a diagnostic (`tag: 'passport.frame'`, level `warn`) stating that no source document is available, and the button reaches a terminal state that is not `idle` — either a visible "no photo loaded" message or a disabled affordance with an accessible name saying so.
  2. `renderer.ts:281`'s `.catch(() => {})` records the same failure the `useRenderLoop` subscription records (same `tag`, so a reader sees one cause reported twice rather than one silent consumer), and rethrows nothing.
  3. `src/components/editor/PassportPanel.test.tsx` asserts the diagnostic is recorded when auto-frame is requested with no source; a new or extended `src/gl/renderer.passes.test.ts` case asserts a rejected `prepare` records the diagnostic.
  4. No test asserts the user-visible toast text; the fix is that the failure is **recorded**, which is what the tests check.
- **Verification method:** `npx vitest run src/components/editor/PassportPanel.test.tsx src/gl/renderer.passes.test.ts`; `grep -n 'catch(() => {})' src/gl/renderer.ts` returns nothing.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 15
- **Notes:** Two small sites in one item because both fixes are the same shape — attach the existing `recordDiagnostic` to a swallowed failure — and both are verified the same way. Split if the passport button's terminal state turns out to need a design decision.

### IMP-085 — Validate the SPA-redirect target read from sessionStorage
- **Status:** TODO
- **Category:** correctness
- **Type:** bug-fix
- **Area / files:** `index.html:157-166`; `public/404.html:13`
- **Intent:** The shim trusts an unvalidated `sessionStorage` value as a navigation target. The blast radius is small — `replaceState` refuses cross-origin URLs and the `try/catch` absorbs the throw — but the value is never checked for being a path under the app base, so the failure mode depends on the browser's origin policy rather than on anything this code asserts. Storing `l.pathname + l.search + l.hash` and requiring the app base makes the check local.
- **Acceptance criteria:**
  1. The value stored in `sessionStorage` is a path + query + fragment, not a whole URL, and on read it is accepted only if it begins with the app base path; anything else is discarded and the redirect is skipped.
  2. The validation is a named expression or function in the inline script with a one-line comment stating why (the value is same-origin data the app wrote, but it is still a navigation target and must be checked).
  3. A test asserts the shim's predicate against four cases: an in-base path, an absolute same-origin URL (accepted, for values written by the older format), an out-of-base path, and an empty value.
  4. `public/404.html` and `index.html` use the same stored key and the same accept condition, byte-consistent.
- **Verification method:** `npx vitest run` for the predicate's sibling test; `npm run appearance:sync` is **not** the generator for this script, so confirm `npm run build` and `npx prettier --check index.html public/404.html` still pass.
- **Effort:** S  **Risk:** med
- **Depends on:** none
- **Priority score:** 15
- **Notes:** Risk med because this is hand-written inline script in two HTML files and `public/404.html` is a committed asset. Confirm the existing generator list before editing; if `index.html` and `public/404.html` are generated by a `scripts/*.mjs` with a `--check` mode, edit the generator, not the HTML.

### IMP-086 — Measure the blend-chip overflow fade with a ResizeObserver, not window.resize
- **Status:** TODO
- **Category:** performance
- **Type:** bug-fix
- **Area / files:** `src/components/tools/LayerPanels.tsx:184-195`; the correct pattern already in `src/components/controls/ChipRow.tsx:52-60`
- **Intent:** The comment says a `ResizeObserver` "would have thrown in every render" under jsdom. A test-environment constraint is shaping production behaviour: the row also changes width on sheet-detent change, on scrollbar appearance and at the inspector breakpoint, and none of those fire `window.resize`. So the fade is wrong in exactly the situations where it matters — a jsdom test cannot catch it, because jsdom reports `scrollWidth === clientWidth === 0` for every element.
- **Acceptance criteria:**
  1. The measurement runs from a `ResizeObserver` on the scroll container, as `ChipRow.tsx:52-60` already does, and `window.resize` is no longer the trigger.
  2. The observer is disconnected on unmount, and the test asserts removal with a spying stub.
  3. The comment justifying the choice is replaced with one line naming the actual reason the observer is safe here, and no comment in the file refers to jsdom as a reason for a production decision.
  4. `grep -rn 'jsdom' src/components/tools/LayerPanels.tsx src/components/controls/ChipRow.tsx` returns nothing — the guard in `ChipRow.tsx:50` (`typeof ResizeObserver === 'function' ? … : null`) stays as a capability check, but no comment may justify a production decision by what jsdom can or cannot do.
- **Verification method:** `npx vitest run src/components/editor/LayerPanels.test.tsx` (or the sibling that exists); a new e2e case in `e2e/journey.layer-panels.spec.ts` asserts the fade appears when the inspector crosses its breakpoint, using the `test` from `e2e/fixtures.ts` and asserting on the DOM rather than a CSS-module class.
- **Effort:** S  **Risk:** med
- **Depends on:** none
- **Priority score:** 15
- **Notes:** The e2e case matters more than the unit test here: `AGENTS.md:104-108` says jsdom computes no layout, so a unit test can only prove the observer was attached, not that the fade is correct. Keep both. Note `journey.layer-panels.spec.ts:1` imports `expect` from `@playwright/test` rather than `./fixtures` — fix that line while editing the file.

### IMP-087 — Add a non-blocking CI leg that runs background removal with E2E_MATTING=1
- **Status:** TODO
- **Category:** ci
- **Type:** tooling
- **Area / files:** `e2e/journey.background.spec.ts:134-137`; `.github/workflows/ci.yml:160`; unit coverage gap in `src/features/ml/matting.test.ts`
- **Intent:** The only test that clicks "Remove background" and asserts `background.removed === true` is `test.skip(!process.env.E2E_MATTING)`, and CI sets `E2E_MATTING: '0'`. The dynamic import, the progress mapping, abort forwarding and `ModelUnavailableError` classification are therefore only ever exercised against a wholesale `@imgly` mock. The feature that `NOTICE` and `public/licenses.html` are written about has never run in an automated job.
- **Acceptance criteria:**
  1. `.github/workflows/ci.yml` gains a chromium-only matrix leg with `E2E_MATTING: '1'` and `continue-on-error: true`, so a CDN flake or a slow download can never turn a real failure elsewhere green and can never block the required checks.
  2. The leg uploads its Playwright report and trace on both success and failure, so the result is readable after the fact rather than a bare green/red X.
  3. The leg's job name says in one line that it is advisory, so the required-check list and the UI agree about which jobs gate a merge.
  4. No existing required job changes: `npm test`, `typecheck`, `lint`, `prettier --check`, `assets:check` and the three Playwright projects all keep their current status.
- **Verification method:** `npx playwright test --list` in a shell with `E2E_MATTING=1` shows the matting case as runnable rather than skipped; `grep -n 'E2E_MATTING' .github/workflows/ci.yml` shows both legs.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 12.5
- **Notes:** This is explicitly **not** a gate. Rule 2 requires a gate to be green on the branch that adds it, and a job that downloads ~42 MB from a CDN cannot be; `continue-on-error: true` is the honest form. `AGENTS.md:86-87` is right that no test should download the model by default — the model is downloaded in this leg only, on a schedule that can be made nightly if it proves too slow on every PR.

### IMP-088 — Decide and provision a real-GPU runner for the WebGL parity gate
- **Status:** NEEDS-HUMAN
- **Category:** ci
- **Type:** tooling
- **Area / files:** `e2e/shader-parity.spec.ts:241` (`test.skip(!result.ok, 'no real GPU available')`); `.github/workflows/ci.yml:166`; `playwright.config.ts:57-64` (`--use-angle=metal --enable-gpu`); claimed by `AGENTS.md:91-94`
- **Intent:** `ubuntu-latest` has no real GPU, so the ANGLE flags are ignored and every parity case skips on every PR. `AGENTS.md:91-94` presents this spec as the gate for how the two backends differ; in practice `src/gl/*` against `src/render/fallback2d.ts` is unverified in every automated run, and `src/render/parity.test.ts` checks the maths through a GLSL interpreter, not the driver. The gap is real; the fix needs a budget.
- **Why this is NEEDS-HUMAN:** Every option — a paid GPU runner, a self-hosted Mac/Windows machine, or a `macos-latest` leg where Metal is available — is a spending or infrastructure decision, and a self-hosted runner makes the repository's supply chain depend on a machine someone maintains. Choosing between them is an owner's call, not a code change.
- **Acceptance criteria:**
  1. The owner records a decision in `NOTICE`-adjacent project notes or an issue: which option, what it costs per month, and who owns the runner.
  2. Whichever option is chosen, the resulting job runs `e2e/shader-parity.spec.ts` on a renderer string that is **not** SwiftShader or llvmpipe, and the spec still skips (rather than passes) on a software rasteriser — `AGENTS.md:93-94` must not be relaxed to make this green.
  3. If the decision is "do not provision", the spec's skip becomes a documented, visible gap rather than a silent one, which IMP-102 covers independently.
- **Verification method:** the recorded decision plus, for option 1 or 2, a CI run whose report contains the renderer string from a non-software driver.
- **Effort:** L  **Risk:** high
- **Depends on:** none
- **Priority score:** 12.5
- **Notes:** Do **not** resolve this by relaxing `e2e/shader-parity.spec.ts:241` to accept a software rasteriser, and do not "fix" it by marking the skip as a pass. `AGENTS.md:93-94` says a skip must never read as a pass; that line is a decision record, not a default.

### IMP-089 — Make both workflows' gates match what they claim: fix the asset-guard step and the deploy pipeline
- **Status:** TODO
- **Category:** ci
- **Type:** tooling
- **Area / files:** `.github/workflows/ci.yml:64-71` (asset-guard step); `.github/workflows/deploy.yml:29-49`
- **Intent:** Two claims in two workflows that do not hold. `ci.yml:64-71` runs `if REQUIRE_ASSETS=1 npm run build; then ... exit 1; fi` to prove the asset guard is real — but `prebuild` runs `scripts/fetch-models.mjs`, which downloads and sha256-verifies 14 woff2 over the network, so a CDN flake or a tsc error from the same commit makes the build fail for the wrong reason and the step reports green. Separately, `deploy.yml` runs format, lint, typecheck, `npm test`, the generators, `assets:verify` and a build, then uploads `dist`: the artefact users download is gated on unit tests but not on the per-area coverage thresholds and not on a single journey, and it does not `needs` the `ci.yml` build job.
- **Acceptance criteria:**
  1. `ci.yml:64-71` captures the build output to a log file, greps that log for the guard's own message (`kodak-portra` is the current sentinel), and fails loudly with the captured log's tail when the build fails without that message.
  2. The step's `if` is inverted only for the grep, so a **passing** asset-guard proof is the only green outcome; a network flake exits non-zero with a message naming `scripts/fetch-models.mjs` as the likely cause.
  3. `deploy.yml` adds `needs:` on the `ci.yml` jobs it duplicates, or — if a `needs:` across workflows is not available for this repository's trigger — adds `npm run test:coverage` to its own job list before the upload step.
  4. `deploy.yml`'s job is renamed or its step list annotated so the badge and the workflow text both say which gates apply to the published artefact.
- **Verification method:** `npm run assets:check` locally; `grep -n 'kodak-portra' .github/workflows/ci.yml`; `grep -n 'test:coverage' .github/workflows/deploy.yml`; a dry run with `REQUIRE_ASSETS=0` proves the new logic does not pass on an ordinary build failure.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 12.5
- **Notes:** Two steps in two files, grouped because they are one finding — *a CI step that proves less than its name says*. A repo's own `AGENTS.md:65-69` calls "a gate that no workflow selects is worse than no gate"; a gate that cannot distinguish its own pass from an unrelated failure is the same defect one level down.

### IMP-090 — Stop deep-walking the whole Doc on every pointermove
- **Status:** TODO
- **Category:** performance
- **Type:** improvement
- **Area / files:** `src/store/docStore.ts:88` (`structurallyEqual(next, state.present)`); `src/components/canvas/EditorCanvas.tsx:125-139` (`onDrag` calls `update()` per pointermove); coalescing at `src/store/history.ts:102-104`
- **Intent:** Every `update()` recursively walks every key, every layer and every stroke point to decide whether anything changed — and the drag path calls `update()` on **every** `pointermove` while appending a point. A stroke of n points costs O(n^2) in comparisons. Drag coalescing in `history.ts` does not help, because the equality walk happens before `applyEdit`. This is the only place in the app where a hot path is quadratic in user input.
- **Acceptance criteria:**
  1. The draw path passes an explicit changed hint, or `update()` short-circuits the equality walk when the only difference is the last point of the stroke identified by `options.key`; the mechanism chosen is recorded in the code comment.
  2. A test drives N=500 `update()` calls appending to one stroke and asserts the equality walk is invoked at most once per coalesced commit, not once per point (spy on the comparison, or assert a counter).
  3. The optimisation is proven not to suppress a real change: a test appends a point **and** changes a different field in the same update, and the change is observed in `readDoc()`.
  4. `structurallyEqual` keeps its existing unit tests unchanged and remains the default for every non-drag caller.
- **Verification method:** `npx vitest run src/store/docStore.test.ts`; the new call-count case; `npm run typecheck`.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 12.5
- **Notes:** Risk med because the equality walk is a **correctness** mechanism, not only a cost: an over-eager short-circuit silently drops an edit. Criterion 3 is the anti-regression half and is not optional. Do not "fix" this by memoising `Doc` identity — the walk exists to detect a mutation of a shared object, which identity cannot.

### IMP-091 — Do not tell the user their photo is deleted when the session delete failed
- **Status:** TODO
- **Category:** error-handling
- **Type:** bug-fix
- **Area / files:** `src/pages/Editor.tsx:341` (`void clearSession()`); `src/components/ui/RouteError.tsx:39-41` (`.catch(() => undefined)`); `src/lib/persist/session.ts:304-313` (swallows internally); button label in `RouteError.tsx`
- **Intent:** Both "delete my work" paths ignore a failed session delete. `clearSession` already swallows internally, so the `.catch` in `RouteError.tsx` is dead code — and if the delete *did* fail, the UI still drops the resume card and navigates. The user is told the photo is deleted and it is still in IndexedDB. The `RouteError` button's label actively promises "deletes your photo and edits", so this is a broken promise, not a missing detail.
- **Acceptance criteria:**
  1. `clearSession` returns a `boolean` (or a discriminated result) that is `false` when the IndexedDB delete did not complete; the internal swallow becomes a recorded diagnostic plus the return value.
  2. `RouteError.tsx` renders an error state with a retry affordance when the result is `false`, and **does not** navigate; the success path is unchanged.
  3. `Editor.tsx:341` awaits the result and shows a toast naming what did not happen when it is `false`, instead of `void`-ing it.
  4. A test in `src/lib/persist/session.test.ts` covers the failing-delete branch with the existing fake IndexedDB, and `Editor.test.tsx` asserts the toast.
- **Verification method:** `npx vitest run src/lib/persist/session.test.ts src/pages/Editor.test.tsx`; `npm run typecheck`; `npm run lint`.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 12.5
- **Notes:** The failure mode is data loss in the user's mental model — a second reload resurrects a photo they were told was gone, which is worse than an error message. Criterion 2 is the one that matters: a failure must be visible where the promise was made.

### IMP-093 — Reconcile the declared dependencies with what the code actually imports
- **Status:** TODO
- **Category:** tooling
- **Type:** bug-fix
- **Area / files:** `package.json:38-50`; `src/lib/licenses.ts:303-315` (the `comlink` row) and `:347-353` (the `onnxruntime-web` row); `public/licenses.html:673-688`; `vite.config.ts:65-67` and `:70`; precedent test `src/lib/licenses.test.ts:62-101`
- **Intent:** Two dependency declarations do not match the tree. `comlink` is a **runtime** dependency with no importer anywhere — yet the licences page tells a reader it "contributes nothing to the bundle", which is a false statement in the attribution document, and `vite.config.ts:70` justifies `worker.format: 'es'` with "so `comlink` and dynamic imports work". `onnxruntime-web` is imported by no module either; it is presumably pinned to control the wasm the CDN-loaded `@imgly` build resolves, but `licenses.ts`'s `why` field says only "Runs the matting model in WebAssembly", which is not why it is declared. Both are fixed by one durable mechanism rather than two one-off edits.
- **Acceptance criteria:**
  1. `src/lib/licenses.test.ts` gains a case asserting every entry in `dependencies` has at least one importer under `src/`, or appears in an explicit `NO_IMPORTER` allowlist whose entries carry a one-line reason.
  2. `comlink` is removed from `package.json` dependencies and its row is removed from `src/lib/licenses.ts`; `public/licenses.html` is regenerated by its own generator and no longer contains the word `comlink`.
  3. `onnxruntime-web` stays in `package.json` and gains an entry in the allowlist whose reason names the actual purpose — pinning the wasm the CDN-loaded `@imgly` chunks resolve — which is also copied into `licenses.ts`'s `why` field.
  4. `vite.config.ts:70`'s comment no longer mentions `comlink`; `npm run assets:check` and `npm run build` both exit 0.
- **Verification method:** `npx vitest run src/lib/licenses.test.ts`; `npm run build` (which runs `assets:check` first and byte-compares `public/licenses.html` against its generator); `grep -rn 'comlink' package.json src public/licenses.html vite.config.ts` returns nothing.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 10
- **Notes:** Criterion 2 removes a **false statement from the licence page**, which is a different class of problem from a stale dependency: attribution that misinforms is worse than no attribution. The AGPL obligation for `@imgly/background-removal` is untouched by this item — `AGPL_DECISION`, `NOTICE` and the AGPL panel are not edited here. Confirm the `public/licenses.html` generator's name and `--check` mode before editing anything; `public/**` must never be hand-edited.

### IMP-094 — Surface a failed autosave-mirror write instead of discarding the result
- **Status:** TODO
- **Category:** error-handling
- **Type:** bug-fix
- **Area / files:** `src/pages/Editor.tsx:187` (`if (doc.source) writeMirror(doc)`, result dropped); `src/lib/persist/mirror.ts:91` (`writeMirror` returns `'too-large' | 'unavailable' | 'error'`); `src/lib/persist/autosave.ts:90-96` (try/catch that swallows); `src/lib/persist/mirror.ts:5-17`
- **Intent:** The mirror is the **only** thing that survives a hard reload inside the debounce window, and all three of its failure results are dropped: the caller ignores the return value and `createAutosave` swallows the throw. A user who closes the tab during the debounce window loses the edit and was never told there was a second copy. A refused `setItem` is exactly the condition users report.
- **Acceptance criteria:**
  1. `Editor.tsx:187` consumes the `writeMirror` result and toasts on `'too-large'` and `'error'`; `'unavailable'` stays silent, because a browser without `localStorage` is not the user's problem to solve.
  2. The toast fires **at most once per session** per failure kind, tracked in a `useRef` set, so a debounce loop cannot produce a stream of toasts.
  3. `autosave.ts:90-96`'s catch records a diagnostic (`tag: 'persist.mirror'`, level `warn`) with the error attached, instead of discarding it.
  4. `src/lib/persist/mirror.test.ts` gains a case asserting `'error'` produces exactly one diagnostic across three consecutive failing writes, and a case asserting `'unavailable'` produces none.
- **Verification method:** `npx vitest run src/lib/persist/mirror.test.ts`; `npm run typecheck`; `npm run lint`.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** Criterion 2 is what keeps this from becoming a new defect: an unguarded toast on every failed mirror write is a toast storm, and a debounced autosave runs every few seconds. The distinction between `'unavailable'` and `'error'` already exists in `mirror.ts` and is what makes this cheap.

### IMP-095 — Stop reading the clipboard on page mount; read it inside the Paste click
- **Status:** TODO
- **Category:** correctness
- **Type:** improvement
- **Area / files:** `src/pages/Editor.tsx:223` (`void hasClipboardRecipe().then(setCanPaste)` on mount); `src/lib/recipes.ts:117-119` (`navigator.clipboard.readText()`); `looksLikeRecipe` filter in `recipes.ts`; existing test `src/pages/Editor.test.tsx:182`
- **Intent:** On a page the user merely opened, the app asks for clipboard contents. `hasClipboardRecipe` is deliberate and tested and `looksLikeRecipe` filters the result, so nothing leaks — but the permission prompt fires before any user gesture and the app cannot distinguish "no recipe" from "permission denied", so the Paste affordance is disabled for a reason the user was never told. The `localStorage` mirror already holds the same recipe and is readable without a gesture.
- **Acceptance criteria:**
  1. On mount, `canPaste` is derived from the `localStorage` mirror only; `navigator.clipboard` is not touched.
  2. `navigator.clipboard.readText()` is called only inside the Paste click handler, after the user gesture.
  3. A paste-availability indicator sourced from the mirror renders in the UI (visible or `aria-disabled`) with an accessible name that distinguishes "a recipe is available to paste" from "nothing to paste".
  4. `Editor.test.tsx:182` is updated: the existing test that a mount does not prompt is retained, and a new case asserts `readText` is called exactly once after a Paste click and zero times on mount.
- **Verification method:** `npx vitest run src/pages/Editor.test.tsx`; `npx playwright test e2e/journey.clipboard*.spec.ts` if it exists, otherwise a new case in `e2e/journey.export.spec.ts` built on the `test` from `e2e/fixtures.ts` asserting `readDoc()` after a paste.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 10
- **Notes:** This is a privacy-behaviour change, so it is a product-visible decision: after this, a recipe copied from another tab is pasteable only after the first click. `docs/FEATURES.md` has rows for copy/paste edits — update their status wording if it promises clipboard detection on load, per `AGENTS.md:201-203`.

### IMP-096 — Record a diagnostic at the six swallowed catches in the persistence layer
- **Status:** TODO
- **Category:** error-handling
- **Type:** improvement
- **Area / files:** `src/lib/persist/session.ts:310`; `src/lib/persist/mirror.ts:108`, `:165`, `:187`, `:219`; `src/lib/persist/retention.ts:75`; diagnostic API at `src/lib/diagnostics.ts`
- **Intent:** Six `catch { }` blocks in the persistence layer, each defensible and each commented, none reaching `recordDiagnostic`. A quota-refused `setItem` and a Safari-private-mode `SecurityError` are precisely the two conditions users report, and today neither leaves a trace in the report that the Help overlay and the crash screen are both built on. The mirror cases are partially addressed by IMP-094; this item covers the rest of the layer so the coverage is complete rather than partial.
- **Acceptance criteria:**
  1. All six sites record a diagnostic with a distinct `tag` (`persist.session`, `persist.mirror`, `persist.retention`), level `warn`, and the caught error attached; none of the six bare `catch { }` blocks remains.
  2. Each of the three modules gains a test case where the guarded operation throws, asserting the diagnostic's `tag` and level.
  3. No diagnostic includes the **value** that failed to persist — only the operation and the error — so a private photo's metadata cannot reach the report.
  4. The existing comments explaining why each catch is safe are kept and moved to the `catch` that now records.
- **Verification method:** `npx vitest run src/lib/persist/`; `grep -rn 'catch {' src/lib/persist/` shows only catches that record.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** Criterion 3 is the constraint that makes this safe to do at all: `diagnostics.ts` has no transport, but a report that can be screenshotted and shared is still a disclosure surface. IMP-097's coverage change also touches these files' denominators, so run `npm run test:coverage` once both land.

### IMP-097 — Take test doubles out of the coverage denominators and stop a threshold from encoding a gap
- **Status:** TODO
- **Category:** test
- **Type:** tooling
- **Area / files:** `vite.config.ts:126-207`; `vite.config.ts:136` (the `exclude` list), `:158`, `:196-206` (the `src/router.tsx` entry); the doubles `src/gl/fakegl.ts` (446), `src/gl/glsl-eval.ts` (1041), `src/render/gl-replay.ts` (273), `src/render/fake2d.ts` (224), `src/features/export/fakeCanvas.ts` (287), `src/lib/persist/fakeIndexeddb.ts` (401)
- **Intent:** `vite.config.ts:136` excludes only `*.test.*`, `*.d.ts`, `main.tsx` and `vite-env.d.ts`, so **2672 lines of test infrastructure** count as shipped source — including a 1041-line GLSL interpreter sitting in the "0% and therefore at risk" surface, which makes `src/gl`'s `functions: 89` a claim about half the code the gate is protecting. Separately, `src/router.tsx`'s `functions: 33` on a 63-line module means 4 of 6 functions are uncovered and the gate cannot notice a fifth; the comment blames the `lazy()` thunks, but `router.tsx:21-22` declares exactly **two** lazy routes, so `33` is 2/6 — coincidentally right rather than measured.
- **Acceptance criteria:**
  1. The six doubles are added to `coverage.exclude` (or moved to `src/testing/`, in which case the exclude is unnecessary), and `coverage-summary.json` no longer lists any of the six.
  2. `npm run test:coverage` exits 0 after the change; every per-area threshold in `vite.config.ts` still holds, and **no threshold is lowered to achieve that** — if an area falls below, the item is reported as unfinished with the area named.
  3. `src/router.tsx` gains tests that exercise the two lazy thunks and the not-found route so that all 6 functions are covered, and its `functions` threshold is raised from 33 to the measured value (100 if fully covered).
  4. A comment above the `src/router.tsx` entry states the measured value's provenance and no longer blames four lazy routes when there are two.
- **Verification method:** `npm run test:coverage` (exit 0); `grep -c 'glsl-eval' coverage/coverage-summary.json` returns 0; diff the per-area table against `vite.config.ts`'s numbers and confirm every one still clears.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 10
- **Notes:** This item **raises** real coverage numbers, which is why it is safe to land. The one way it can go red is criterion 3 — raising a threshold to a value the code does not reach — so write the tests first and read the number second. Never resolve a shortfall by editing the threshold downward; `AGENTS.md:46-47` and `AGENTS.md:101-103` both say so, and IMP-076 removes the stale paragraph that currently misstates this gate's state.

### IMP-098 — Remove the forced synchronous layout and needless re-render on the interaction path
- **Status:** TODO
- **Category:** performance
- **Type:** improvement
- **Area / files:** `src/components/controls/SegmentedControl.tsx:102-117` + `src/components/controls/segmentRows.ts:117-137` (`rowsFor` returns a fresh array every measure); `src/components/canvas/EditorCanvas.tsx:45`; `src/components/canvas/transformHandles.tsx:110-120`; `src/components/tools/CurvesEditor.tsx:168`
- **Intent:** `SegmentedControl` re-renders on every `ResizeObserver` tick because `rowsFor` returns a new array, so the `setRows` identity check can never short-circuit — and the `measure()` that precedes it (`:38-68`) reads `getBoundingClientRect()` once per button plus `clientWidth` on two elements, so every render also forces a synchronous layout. Three drag handlers separately read `getBoundingClientRect()` on **every** pointer event; `EditorCanvas` rewrites the canvas transform each frame via `applyLayout`, so each move is a forced reflow. `transformHandles.tsx:110-113` justifies not caching the box; the cache belongs in the drag basis instead.
- **Acceptance criteria:**
  1. `SegmentedControl` compares rows by content before calling `setRows` (`setRows((cur) => sameRows(cur, next) ? cur : next)`), and a test asserts that re-running `measure()` with an unchanged layout causes **zero** re-renders.
  2. Each of the three drag handlers reads its box once in the drag-start path, stores it in the drag basis, and refreshes it on resize and scroll; a test drives 100 pointermove events with a stubbed `getBoundingClientRect` and asserts it was called once, not 100 times.
  3. `EditorCanvas`'s cached box is invalidated when the canvas is resized or the layout changes, so the cache cannot go stale — a test resizes and asserts the second drag uses the new box.
  4. `npm test`, `npm run typecheck` and the three existing layout e2e specs (`journey.layout-measure.spec.ts`, `journey.inspector-layout.spec.ts`, `journey.desktop-truthfulness.spec.ts`) are green, so no measured layout changed.
- **Verification method:** `npx vitest run src/components/ui/SegmentedControl.test.tsx`; `npx playwright test e2e/journey.layout-measure.spec.ts e2e/journey.inspector-layout.spec.ts`; `npm test`.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 10
- **Notes:** Four sites, one item, because they are one mechanism ("read layout once per gesture, re-render only on a real change") and one measurement plan. Criterion 3 is the whole risk: a stale cached box is an invisible drag-offset bug that jsdom cannot see. If criterion 4 turns out to need a spec that does not exist, split this item per file rather than weakening the cache invalidation.

### IMP-099 — Add unit tests for src/gl/context.ts, program.ts and limits.ts
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `src/gl/context.ts` (69), `src/gl/program.ts` (75), `src/gl/limits.ts` (106); existing double `src/gl/fakegl.ts`; existing siblings `src/gl/caps.test.ts`, `src/gl/geometry.test.ts`
- **Intent:** These three have no test in any file, and together they are the construction path: get a context, create and link a program, read the driver's limits. A failure here is the one IMP-073 shows is silently swallowed, so the cheapest defence is knowing what the happy path returns and what the failure path throws. `fakegl.ts` already exists, so this is table-driven work against an existing double.
- **Acceptance criteria:**
  1. `src/gl/context.test.ts` covers: a successful `webgl2` acquisition, a `null` context from the canvas, and the attribute set passed to `getContext` (asserted on the recorded call, not on the returned object).
  2. `src/gl/program.test.ts` covers compile success, compile failure with an info log, link failure with an info log, and asserts that a failed link throws rather than returning an unusable program.
  3. `src/gl/limits.test.ts` covers the clamping of at least three limit values (one below the driver value, one at it, one above) and the documented fallback when a limit is unavailable.
  4. All three are pure-logic unit tests run in jsdom against `fakegl.ts`; none requires a real WebGL context.
- **Verification method:** `npx vitest run src/gl/context.test.ts src/gl/program.test.ts src/gl/limits.test.ts`; `npm test`; the three module names are removed from the IMP-083 registry.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** jsdom has no WebGL, which is why `fakegl.ts` exists and why this is a unit-test item rather than a Playwright one. The **real driver** gate for these three is `e2e/shader-compile.spec.ts`, which already exists and is green; this item does not replace it and must not be described as if it does.

### IMP-100 — Add unit tests for src/gl/texture.ts, framebuffer.ts, luts.ts, pass-colors.ts, pixel-scale.ts and quad.ts
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `src/gl/texture.ts` (149), `src/gl/framebuffer.ts` (156), `src/gl/luts.ts` (131), `src/gl/pass-colors.ts`, `src/gl/pixel-scale.ts`, `src/gl/quad.ts`; existing siblings `src/gl/mask.test.ts`, `src/gl/passes.test.ts`, `src/gl/tiling.test.ts`
- **Intent:** Six more `src/gl/*.ts` with no test in any file. They are the resource-management half of the backend: texture allocation and upload, framebuffer attach and detach, LUT upload, colour-space pass parameters, device-pixel scaling and the full-screen quad. IMP-084 shows the LUT prepare failure is swallowed on the render path, and nothing currently asserts what `luts.ts` uploads.
- **Acceptance criteria:**
  1. `src/gl/texture.test.ts` and `src/gl/framebuffer.test.ts` cover the allocate path, the resize path (including a no-op when dimensions are unchanged), and the dispose path asserting the GL delete calls on the fake.
  2. `src/gl/luts.test.ts` covers uploading a look strip by name, an unknown look name (the failure IMP-084 swallows), and the dimensions/format handed to `texImage2D`.
  3. `src/gl/pass-colors.test.ts`, `src/gl/pixel-scale.test.ts` and `src/gl/quad.test.ts` each get a sibling test covering their exported pure functions and their GL call arguments respectively.
  4. All six are jsdom unit tests against `fakegl.ts`, table-driven where the module is table-shaped, with no real WebGL context and no snapshot assertions.
- **Verification method:** `npx vitest run src/gl/texture.test.ts src/gl/framebuffer.test.ts src/gl/luts.test.ts src/gl/pass-colors.test.ts src/gl/pixel-scale.test.ts src/gl/quad.test.ts`; `npm test`; all six names removed from the IMP-083 registry.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** Six modules in one item because each is small (55–156 lines) and each needs the same three shapes: happy path, resize/no-op path, dispose path. If the six prove to need more than one pass, split into resource (`texture`, `framebuffer`) and value (`luts`, `pass-colors`, `pixel-scale`, `quad`) — do not weaken the ACs instead.

### IMP-102 — Make an e2e run unable to look greener than it is
- **Status:** TODO
- **Category:** ci
- **Type:** tooling
- **Area / files:** `playwright.config.ts:29` (`retries: CI ? 1 : 0`); `journey.perf-budget.spec.ts`; the dark assertions at `e2e/journey.shell.spec.ts:43`, `e2e/journey.a11y-keys.spec.ts:72,269`, `e2e/journey.appearance.spec.ts:221` (all gated on `FULL_TAB_NAVIGATION`); capability skips at `e2e/journey.context-loss.spec.ts:120,158`, `e2e/shader-compile.spec.ts:54,111`, `e2e/shader-parity.spec.ts:241`; `e2e/a11y-matrix.spec.ts:7` (`MATRIX_ENGINE = 'chromium'`)
- **Intent:** Three ways a run reports green while asserting less than it looks. A retried test is reported as passed with no indication it failed first, and `journey.perf-budget.spec.ts` is the most exposed. Roughly a third of the real-`Tab` keyboard coverage never executes on the WebKit leg — the engine `AGENTS.md:57` calls "the project that catches the Safari-only behaviour". And capability-gated skips report only as "did not run", so IMP-088's always-true skip looks identical to a passing leg.
- **Acceptance criteria:**
  1. Every `test.skip`/conditional skip that depends on a capability emits a `testInfo.annotation({ type: 'skip-reason', description })` naming the capability and the value observed, so the HTML report and `npx playwright test --list` show it.
  2. `playwright.config.ts` uses `retries: CI ? 1 : 0` with `trace: 'on-first-retry'` and the report records `testInfo.retry` in the title of any retried test, so a pass-after-retry is distinguishable from a first-time pass.
  3. The aggregate WebKit keyboard gap is stated in one place: a comment in `journey.a11y-keys.spec.ts` or a row in `docs/FEATURES.md` §6 naming every `FULL_TAB_NAVIGATION`-gated case and the engine it is dark on, replacing four separate inline comments with one inventory.
  4. `npx playwright test --list` still reports the same number of cases as IMP-075 records, and no skip was removed to make a leg pass.
- **Verification method:** `npx playwright test e2e/shader-compile.spec.ts --project=chromium --reporter=list` shows a reason string where a capability skip occurs; `grep -rn 'FULL_TAB_NAVIGATION' e2e/` returns the four sites and no fifth.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** None of these changes a pass into a fail or a fail into a pass; every change makes an existing state **visible**. That is why this item can be green on its branch while the underlying coverage gaps stay open — and it is why it is the companion to IMP-088 rather than a substitute for it. Do not "fix" the WebKit keyboard gap by removing the `FULL_TAB_NAVIGATION` guard.

### IMP-104 — Make invariant 6 mechanical: no component may write the doc outside actions.ts
- **Status:** TODO
- **Category:** tooling
- **Type:** tooling
- **Area / files:** invariant text `AGENTS.md:145-146`; `src/store/docStore.ts:80` (the raw zustand hook is exported); existing violations `src/components/canvas/EditorCanvas.tsx:102` and `:125`
- **Intent:** "Store updates go through `src/store/actions.ts` so history stays correct. Do not `setState` the doc directly from a component." Nothing enforces it — `docStore.ts:80` exports the raw hook, and `EditorCanvas.tsx:102/125` already calls `useDocStore.getState().update()` directly. The invariant is the weakest in the set, and it is the one whose violation silently produces wrong history, which is the app's central promise.
- **Acceptance criteria:**
  1. `EditorCanvas.tsx:102` and `:125` route through `src/store/actions.ts`, which is the fix the invariant demands; the drag path keeps its coalescing behaviour, proven by the history tests staying green.
  2. A source-scanning test (the same shape as `src/components/editor/ToolSurface.test.tsx`, which already walks the `.tsx` tree by path) fails if any file under `src/components/` or `src/pages/` references `useDocStore.getState()` for a mutating call, with the offending file:line in the failure message.
  3. The test's allowlist is empty or names each permitted exception with a one-line reason; a new violation needs an explicit entry, so it cannot be added silently.
  4. `npm run lint` and `npm test` are green, and `docs/FEATURES.md` rows that claim undo/redo correctness still name a test that exists.
- **Verification method:** `npx vitest run src/components/editor/ToolSurface.test.tsx` (extended); deliberately add a `useDocStore.getState().update(...)` to a component and confirm the case fails.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 10
- **Notes:** A source-scanning test, not an eslint rule, because the repo already has the pattern and `eslint.config.js` has no restricted-syntax rule for store access today. Criterion 1 must land **before** the guard or the guard is red on its own branch — that ordering is the whole reason this item is effort M and not S.

### IMP-105 — Make invariant 4 mechanical: a new Doc field needs a default and a migration
- **Status:** TODO
- **Category:** tooling
- **Type:** test
- **Area / files:** invariant text `AGENTS.md:140-142`; `src/model/types.ts:22` (`DOC_SCHEMA = 3`), `:373`; `src/model/defaults.ts:192` (`createDoc`); `src/model/migrate.ts:680` (`migrateDoc`, 829 lines) — both line numbers verified in the tree; `src/model/migrate.test.ts`
- **Intent:** Any new `Doc` field needs a default in `defaults.ts` **and** a migration in `migrate.ts`, plus a `migrate.test.ts` case. The tests prove the migrations that exist work; nothing fails if a field is added without either half. A field with a default but no migration is invisible on every persisted document, and the symptom is a silently dropped edit on an old session.
- **Acceptance criteria:**
  1. `src/model/migrate.test.ts` gains a case that enumerates the keys of `createDoc()` and asserts each one is either present in the document produced by `migrateDoc` from the previous `DOC_SCHEMA` fixture, or listed in an explicit `CARRIED_BY_VERSION` map whose entry names the version that added it.
  2. A `Doc` field added without a default fails the case (every field appears in `createDoc()`'s output).
  3. A `Doc` field added without a migration fails the case (it is absent from the migrated output and absent from `CARRIED_BY_VERSION`).
  4. The `CARRIED_BY_VERSION` map is asserted to be **complete for the current schema**: its key set equals the set of fields added in versions 1..`DOC_SCHEMA`, so bumping `DocSchema` without an entry fails.
- **Verification method:** `npx vitest run src/model/migrate.test.ts`; add a field to `src/model/types.ts` and confirm the case fails; `npm test`.
- **Effort:** M  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** Pure logic, jsdom, no browser — this is a unit test by `AGENTS.md:59-60`. Criterion 4 is the one that keeps the map from becoming a new stale list; criterion 3 is the one that catches the actual failure mode. Keep the map in `migrate.ts` next to the migrations it describes, not in the test.

### IMP-107 — Delete src/components/ui/Chip.tsx
- **Status:** TODO
- **Category:** tooling
- **Type:** tooling
- **Area / files:** `src/components/ui/Chip.tsx` (5 lines, 0% coverage, imported by nothing)
- **Intent:** A five-line component with no importer, no test and 0% coverage. It is in the `src/**/*.{ts,tsx}` coverage glob, so it appears in the per-area denominator for `src/components/**` as a permanently uncovered file — a gate input that describes nothing. The repo has already established the precedent for deleting unused modules.
- **Acceptance criteria:**
  1. `src/components/ui/Chip.tsx` is deleted and no file references it: `grep -rn 'ui/Chip\|from .\./Chip' src e2e` returns nothing.
  2. `npm run typecheck`, `npm run lint` and `npm test` are all green after the deletion.
  3. The `src/components/**` per-area coverage figures in `vite.config.ts` are re-measured and **raised** if the deletion raises them; no threshold is lowered.
  4. The deletion is recorded in the same commit message as the reason, rather than being folded into an unrelated change.
- **Verification method:** `npx vitest run` after deleting; `npm run test:coverage` (exit 0); the two `grep` commands above.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 10
- **Notes:** The IMP-083 registry would list this file; completing that item **after** this one keeps the registry accurate without an allowlist entry for it. Do not delete anything else in the same pass — one file, one reason. The cited precedent `src/hooks/useSafeArea.ts` does not exist in the tree; the claim that the repo "already established the precedent for deleting unused modules" is dropped rather than repaired, because no unused-module deletion exists to point at. The file and its 5 lines, 0% coverage and zero importers are all verified.

### IMP-109 — Record the AGPL-3.0 distribution decision for @imgly/background-removal
- **Status:** NEEDS-HUMAN
- **Category:** docs
- **Type:** docs
- **Area / files:** `NOTICE`; `AGPL_DECISION` in `src/lib/licenses.ts`; the AGPL panel in `public/licenses.html`; the section `AGENTS.md:173-187`
- **Intent:** `@imgly/background-removal@1.7.0` is AGPL-3.0. An end user running the hosted app is a _user_, not a conveyer, and owes nothing. **Anyone who distributes this build is conveying a combined work** and owes the corresponding source under AGPL §5(a). The three options — obtain permission, replace the dependency, publish the corresponding source — and what each costs are written out in the three places above. This item exists so the open decision is not closed by accident, by silence, or by a comment.
- **Why this is NEEDS-HUMAN:** Each of the three options commits money or legal posture, and none can be chosen from inside the repository. It is also not a documentation fix: the documents are already accurate.
- **Acceptance criteria:**
  1. The owner records which option is being taken, with a date and a named owner, in the same three locations so the licence page, `NOTICE` and `AGPL_DECISION` agree.
  2. Until that record exists, none of the three files is edited, softened, or reworded from "we are shipping AGPL and here is what that means" into advice.
  3. No item in this backlog adds, removes or substitutes a licence obligation as a side effect — IMP-093 changes dependency bookkeeping only and must not touch the AGPL panel.
- **Verification method:** Not verifiable by a command. Verification is that the three locations continue to state the obligation without softening, checked by a human reading them side by side.
- **Effort:** L  **Risk:** high
- **Depends on:** none
- **Priority score:** 8.3
- **Notes:** Placed below the actionable 10s because nothing can be done, not because it matters less. `AGENTS.md:184-187` is explicit: a licence page that lists a dependency accurately and omits the obligation is a worse problem than one that says we ship AGPL. Do not resolve it in a comment. IMP-082 makes the version pin mechanical without touching the decision, and IMP-087 makes the feature run in CI without touching it.

### IMP-110 — Decide whether to disclose the absent colour management
- **Status:** NEEDS-HUMAN
- **Category:** docs
- **Type:** docs
- **Area / files:** `docs/FEATURES.md` row D4-F12 ("not built, and not disclosed"); related colour-space handling in `src/gl/pass-colors.ts`, `src/lib/format.ts`, `public/licenses.html`'s accuracy panel
- **Intent:** Row D4-F12 records that colour management is neither built nor disclosed. Both halves are honest in a repository and neither is honest to a user choosing this editor for print work: no ICC profile is read, no output profile is written, and a wide-gamut source is silently treated as sRGB. Whether that is acceptable depends on the product's audience, and it is currently a **row in an internal catalogue** rather than anything a user can read.
- **Why this is NEEDS-HUMAN:** The options are build it, disclose it in `README.md` and the licences page, or accept the gap explicitly and say so in the same places. Choosing between them is a product decision about what kind of editor this is, and it may cost real engineering (building) or real users (disclosing).
- **Acceptance criteria:**
  1. The owner records one of: (a) colour management is built, with the named test that would fail if it regressed; (b) it is not built and the absence is disclosed to users in `README.md` and in the app's own accuracy/licences surface; or (c) it is not built and the gap is accepted deliberately, with the reason and a review date.
  2. Row D4-F12's `Status` is one of the six words in the vocabulary and names a real test where it claims `Working`.
  3. Until the decision is recorded, row D4-F12 keeps saying "not built, and not disclosed" verbatim — the phrase is the honest state, and softening it is the failure mode.
  4. The **build** option is not a docs task and is costed here so the owner sees it before choosing: an ICC parser, a colour-space conversion in the render pipeline and profile writing per format, and per architecture invariant 2 that is **three** implementations (GLSL in `src/gl/shaders/index.ts`, the GL executor, the CPU mirror in `src/render/cpu-passes.ts`) with `src/render/parity.test.ts` extended, or a feature gate in `src/gl/caps.ts` with a Canvas2D fallback. Building therefore forks from this docs item rather than being scheduled from it.
- **Verification method:** Not verifiable by a command. Verification is that the recorded decision exists and row D4-F12 matches it.
- **Effort:** L  **Risk:** med
- **Depends on:** none
- **Priority score:** 6.7
- **Notes:** Listed last in the tier because it is a decision, not a change, and because the repo's own status vocabulary already forces the issue: a row that says "not built, and not disclosed" is `Missing` by `AGENTS.md:217`, and re-labelling it `Broken` or `Stub` would be the quiet promotion `AGENTS.md:214-215` forbids. Last placed here so it is not resolved by anyone picking up a neighbouring item. Absorbed deleted IMP-129 ("Decide colour management: build it, or disclose the absence"), which filed the same D4-F12 decision a second time in Tier 4. Its substantive addition is kept in the criterion below; the four ACs here stay as the owner-facing decision record. D4-F12 is still `Missing` in `docs/FEATURES.md:353` and §6 still says "Not built, and not disclosed" — unchanged by this item.

### IMP-108 — Render the export estimate from the proxy instead of a full-resolution re-encode
- **Status:** TODO
- **Category:** performance
- **Type:** improvement
- **Area / files:** `src/components/tools/ExportSheet.tsx:186-226` (350 ms debounce); the 256 px proxy already built at `src/pages/Editor.tsx:359-361`; `inFlight.current?.abort()` at `ExportSheet.tsx`
- **Intent:** Every debounce tick during a slider drag re-encodes at **full resolution** to produce a size estimate. `inFlight.current?.abort()` bounds concurrency but nothing bounds how often a drag restarts it, so dragging one control can queue dozens of full-resolution encodes that the user only wanted a number from. The app already builds a 256 px proxy for auto-tone; the estimate does not need the real thing to be within a plausible range.
- **Acceptance criteria:**
  1. The estimate is computed from the existing 256 px proxy and scaled to the target dimensions, so a format/size change is reflected without a full-resolution encode.
  2. The estimate is labelled in the UI as approximate (or the difference from an exact figure is stated once in the sheet), so a user comparing against the real file size is not misled.
  3. The abort path is kept: a newer slider value still cancels the previous in-flight estimate rather than queueing behind it.
  4. A test asserts the estimate for a given format and dimension, and that it does **not** call the full-resolution encoder — asserted on a spy, not on a timing measurement.
- **Verification method:** `npx vitest run src/components/export/ExportSheet.test.tsx`; `npm run typecheck`; a manual drag with the Network/CPU panel shows no full-resolution encode per tick.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 6
- **Notes:** Lowest-impact item in the tier and placed last for that reason. Risk med is about **honesty**, not correctness: an estimate from a proxy can be wrong by a few percent, and criterion 2 exists because a silently-wrong size figure is worse than a coarse labelled one. If the proxy is not reachable from the sheet without a prop-drilling refactor, report this item as too big rather than half-doing it.

## Tier 4 — Missing features natural to this product

The engine underneath most of these exists and is tested; what is missing is the affordance a
person can see, press and come back to. Nothing here adds a runtime dependency, uploads a photo,
or puts a colour-management claim in a comment.

### IMP-116 — Prove the export: a strip that reads dimensions and DPI back out of the bytes

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/lib/metadata/` (the readers `journey.export.spec.ts` already drives), `src/components/tools/ExportSheet.tsx:83-112` (the estimate and failure copy), new `src/components/tools/ExportProof.tsx`
- **Intent:** The export panel promises a DPI and a "fit under N KB". The user is asked to trust it. Reading those properties back out of the encoded bytes and printing them turns a promise into a measurement, which matters most for print and passport work where the DPI is the whole point.
- **Acceptance criteria:**
  1. After an encode, a strip in the export sheet prints the format, the pixel dimensions read back from the produced bytes, and the density read back from those same bytes, each labelled with its unit.
  2. For AVIF the density row says it can only be read, not written, rather than showing a number the encoder did not put there — the same honesty `D7-F12` records for the write side.
  3. Where a requested property is absent from the bytes the row says so in words; it never prints `0`, `undefined` or a blank.
  4. The values come from decoding the produced bytes, not from the settings that produced them: a unit test feeds a hand-built byte string whose header disagrees with the settings and asserts the strip shows the header's values.
- **Verification method:** `npx vitest run src/lib/metadata/proof.test.ts` (sibling; the disagreeing-header case is the anti-vacuity guard). `npx playwright test e2e/journey.export.spec.ts` (existing spec, fixture `test`) asserts the printed dimension string for a configured width after export, located by the strip's accessible name.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 1 = 16.0
- **Notes:** No new render pass — this reads bytes, it does not draw them, so `src/render/parity.test.ts` is untouched. Checked against `docs/FEATURES.md`: `D7-F12` (`Partial`, DPI written for JPEG/PNG/WebP) is about _writing_ DPI and names the AVIF read limitation; this item is the user-visible read-back, which no row I read names.

### IMP-117 — Make HEIC rejection actionable instead of terminal

- **Status:** TODO
- **Category:** feature
- **Type:** improvement
- **Area / files:** `src/lib/accept.ts:29` (`isHeic`) and `:33` (`describeUnsupported`'s HEIC branch), `src/components/editor/ImportScreen.tsx:149-154` (where the accepted formats are printed and the drop zone lives)
- **Intent:** HEIC is every iPhone photo. Today the file is refused with one sentence telling the user to go and export as JPEG elsewhere, with no way to act inside the app and no indication that the refusal is a browser limitation rather than a choice this app made.
- **Acceptance criteria:**
  1. The HEIC message names the reason in the user's terms — the browser cannot decode HEIC/HEIF — and does not imply the app supports the format and declined it.
  2. The message names the exact remedy for the two common cases (iPhone Photos → share/export as JPEG; on macOS, Preview or Image Preview saves as JPEG) and says the result can be dropped straight back onto the import screen.
  3. The message names the formats that **are** accepted, taken from `ACCEPTED_IMAGE_TYPES` rather than a second hard-coded list, and a unit test fails if the two lists diverge.
  4. A `.heic` file is still refused — the item changes the wording and the next step, not the accept/reject decision — and a unit test asserts `describeUnsupported` still returns a string for a HEIC file.
- **Verification method:** `npx vitest run src/lib/accept.test.ts` (sibling; includes the list-divergence guard). `npx playwright test e2e/journey.empty-state.spec.ts` (existing spec, fixture `test`) drops a `.heic` fixture by the drop zone's accessible name and asserts the message names a format the editor accepts.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 1 = 16.0
- **Notes:** **Explicitly not** HEIC _decode_. `README.md:366` lists "HEIC decode" as a non-goal and a decoder is a new runtime dependency, which rule 3 forbids; this item adds no dependency and ships no decode. If `docs/FEATURES.md` has a row on import copy that already claims an actionable unsupported-file message, drop this one.

### IMP-119 — Replace the hold-to-show Compare badge with a side-by-side and a blink view

- **Status:** TODO
- **Category:** feature
- **Type:** improvement
- **Area / files:** `src/components/canvas/EditorCanvas.tsx:245-251` (the `Compare` toggle and `compareHeld`), `src/store/uiStore.ts:173,187,234` (`compareHeld` and its setter), `src/components/canvas/CompareBadge.tsx`, `src/hooks/useRenderLoop.ts:94,141` (`compareHeld` in `FrameInputs`)
- **Intent:** Compare is reachable only as a toggle on the canvas, and one toggle cannot answer "what changed?" — you cannot see the edited and original images at once, and there is no way to hold compare while dragging a slider to watch an adjustment cross the original.
- **Acceptance criteria:**
  1. Compare gains a **Blink** state beside the existing toggle, reachable by an accessible name, alternating the edited and unedited frames of the _current_ document at a stated interval that the control announces.
  2. Blink is a pure function of elapsed time and one boolean in `src/store/uiStore.ts`; no per-frame timer is created, and none survives unmount — a test asserts no `setInterval`/`setTimeout` is left pending after the panel closes.
  3. Compare state is chrome. No field describing it exists on `Doc`, none is written to history, and a unit test asserts a compare-mode change does not push an undo entry.
- **Verification method:** `npm run test:e2e -- e2e/journey.crop-preview.spec.ts` on the `chromium` and `webkit` projects asserts two screenshots taken 250 ms apart differ and that a third back again. No new render pass is added by Blink, so `src/render/parity.test.ts` is untouched; if it is, run it alone with the new cases named.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 1 = 16
- **Notes:** The Compare badge itself is already shipped — `README.md:71` and the toggle at `EditorCanvas.tsx:245` — and `e2e/journey.shell.spec.ts` covers Compare per the no-coverage list in `.improve/REPO_PROFILE.md` §5.5. What is being added is a _mode_ the toggle does not have, so this is an improvement to a `Working` capability rather than a claim that Compare is missing. The blink view is the cheap half and could ship alone as an S. Split: the original bundled a blink mode (no new render pass) with a split mode (a new pass, or three implementations per invariant 2). The blink half is Effort S and ships first; the split half is IMP-134. The claim that Split would need a pass is not asserted here — it is IMP-134's first question.

### IMP-137 — Announce the three settings a passport Document chip rewrites
- **Status:** TODO
- **Category:** journey
- **Type:** bug-fix
- **Area / files:** `src/components/tools/PassportPanel.tsx:563-580` (`applySpec`, verified in the tree)
- **Intent:** Selecting a passport Document chip runs `applySpec`, which rewrites the crop, the output resize **and** the background in one press, with no announcement and no undo entry that names what happened. A user whose frame was already composed presses "US visa", and the canvas they were looking at is now something else. This is D-11, and it is the same defect class as D-02: an action with effects the user cannot see or attribute.
- **Acceptance criteria:**
  1. Activating a Document chip raises one status message naming the three things it changed — crop, output size, background — and each of the three is applied through `src/store/actions.ts` as a single coalesced history entry, so one Undo restores the frame exactly as it was (asserted via `readDoc()`).
  2. When the chip changes only some of the three (a chip that sets size but not background), the message names **only what changed**, computed by comparing before and after — not a fixed sentence.
  3. The changed values are visible in the message: the output pixel dimensions and the aspect ratio, read from the document after the change.
  4. A unit test asserts that on a document where the crop, output and background all already match the chip, no status message is raised and no history entry is pushed.
- **Verification method:** `npx vitest run src/components/tools/PassportPanel.test.tsx` (existing sibling) for clauses 1, 2 and 4. `npx playwright test e2e/journey.passport-document.spec.ts` (fixture `test`, chips located by accessible name such as `US visa`) asserting the status message by role and `readDoc()` before and after one Undo.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 4 x 4 / 1 = 16
- **Notes:** Added by the Critic: this is `recon-journeys.md` finding **D-11**, and both analysts filed it — the experience analyst put the underlying measurement in Tier 2 and neither filed the fix, so the journey defect had no item. `applySpec` was verified at `src/components/tools/PassportPanel.tsx:563`; the three settings are read from `getSpec` in that function. Distinct from IMP-063 (chip layout) and from IMP-025 (the Compare journey).

### IMP-114 — Save a recipe to a shareable file and import one from a dropped file

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/lib/persist/recipes.ts:9,96,132` (`writeClipboardRecipe`/`readClipboardRecipe`/`listPresets` — the only transports today), new `src/lib/persist/recipeFile.ts`, `src/components/editor/ImportScreen.tsx:112-113` (the paste listener, where a `recipe+json` drop branch goes), `src/components/editor/EditorTopBar.tsx:92-104` (the Copy/Paste-edits rows, where _Save recipe to file…_ goes)
- **Intent:** The recipe travels today only through the clipboard or the same browser's `localStorage`. A person who wants to send a look to a colleague has to paste JSON into a chat app; a file named `warm-sunset.ie-recipe.json` attached to an email works, survives a paste that carries formatting, and can be dropped onto the import screen.
- **Acceptance criteria:**
  1. A menu row _Save recipe to file…_ writes the current edits as a single `.json` file named from a trimmed, filesystem-safe version of the entered name, via one call to the existing `src/lib/encode.ts` download path — no new encoder.
  2. Dropping a file whose content parses as a recipe onto the import screen applies the recipe and reports success through the existing toast channel; a file that does not parse says which part failed and applies nothing.
  3. The written file's bytes are asserted to round-trip: `parseRecipe(JSON.parse(text))` returns a document equal to the one at save time for the colour sections only — layers and source are never carried in a recipe file, and the unit test asserts that exclusion.
  4. The round-trip is asserted on the **bytes**, not on "not empty".
  5. Nothing about appearance enters the recipe file; a unit test asserts no `theme`/`density`/`textScale`/`motion`/`iconScale`/`accent` key appears in a serialised recipe.
- **Verification method:** `npx vitest run src/lib/persist/recipeFile.test.ts` (sibling; includes a test that fails if an appearance key is present in the output). `npx playwright test e2e/journey.recipe-file.spec.ts` (new, on the fixture's `test`, drop located by the drop zone's accessible name) for the drop path, asserting `readDoc()`.
- **Effort:** M **Risk:** low
- **Depends on:** none
- **Priority score:** 5 x 5 / 2 = 12.5
- **Notes:** No new `Doc` field — the recipe is derived from the existing document at save time. Checked against `docs/FEATURES.md`: `D2-F14` ("Copy edits wrote localStorage") and `D2-F15` ("Presets are readable, appliable and deletable") are both `Working` and cover the clipboard and localStorage transports only; neither names a file transport, and neither names a drop. Rule 7 applies: the spec uses the fixture `test` and locates by accessible name.

### IMP-122 — Make onboarding adapt to a returning visitor with a stored session

- **Status:** TODO
- **Category:** feature
- **Type:** improvement
- **Area / files:** `src/components/editor/Onboarding.tsx:17` (the copy that promises undo and reset), `src/components/editor/ResumeSessionCard.tsx`, `src/components/editor/resumeSummary.ts` (what the resume card already knows), `src/lib/persist/session.ts` (the stored session)
- **Intent:** A first-time visitor is taught the model; a visitor with a session in IndexedDB is shown the same first-run orientation, which reads as though the app has forgotten them. The returning visitor's first screen should be their work, with the orientation one dismissible step behind it.
- **Acceptance criteria:**
  1. With a resumable session present, the first screen offers the resume card before any orientation step, and the orientation is reachable but not in front.
  2. With no session, the orientation still comes first — the two orders are both asserted, not just one.
  3. Dismissal is per-visitor and persisted; a returning visitor is not shown the same step twice, and a test asserts a second visit with a stored session skips straight to the resume decision.
  4. The dismissal record is chrome in the existing persistence layer; no appearance setting and no document field records it.
  5. The orientation copy still states that edits are undoable and that _Reset all edits_ returns the photo — no claim is weakened to make the shorter path work.
- **Verification method:** `npx vitest run src/components/editor/resumeSummary.test.ts` (existing sibling, extended) for the order decision as a pure function. `npx playwright test e2e/journey.onboarding.spec.ts` (existing spec, fixture `test`, buttons located by accessible name) for both orders across two page loads in one test.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12.0
- **Notes:** `D8-F20` and `D8-F21` are both `Working` rows — the first covers "nothing said what the app is", the second covers the resume card offering a permanent choice with nothing to decide on. **This item is adjacent to both and may be argued as already covered.** It is filed only because the specific claim — orientation appears before a stored session — is a different defect from either row; if a verifier reads `D8-F21`'s test and finds the ordering asserted, delete this item.

### IMP-127 — Keep a list of what this session has already exported, and re-export from it

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/components/tools/ExportSheet.tsx:87` (the `ExportAction` union), `src/components/tools/ExportSheet.tsx:365` (`handleDownload`) and `:889` (where the download caption already names the file), `src/store/uiStore.ts:65` (the chrome persistence the job list already uses), `src/lib/encode.ts:131` (`downloadBlob`)
- **Intent:** A person exporting at four sizes then discovering the third was the wrong size has no record of what they already made, and re-deriving the filename by hand is where duplicates and `image (3).jpg` come from. A short list of what this session wrote turns that into one press.
- **Acceptance criteria:**
  1. Every successful export appends a row to a _Recently exported_ list in the export panel, naming the file, the format, the width in pixels and the size in bytes.
  2. Each row offers _Re-export_, which re-runs the same encode and derives the same filename through `src/features/export/naming.ts`, so a retry after a failure produces the identical name rather than a second one.
  3. **The byte size recorded is read back from the produced `Blob`,** not from the panel's own size predictor; a unit test feeds a deliberately wrong estimate and asserts the recorded number is the blob's.
  4. The list is chrome: it lives in `uiStore`'s existing persisted collection, adds **no `Doc` field**, and an export pushes **no history entry** — a unit test asserts both.
  5. The list is capped and newest-first, and survives a reload through the same chrome persistence that already keeps the tool selection and safe-area choice.
  6. A row for an export that failed is not added; the existing failure copy at `ExportSheet.tsx:100-112` still says what to do instead.
- **Verification method:** `npx vitest run src/components/tools/ExportSheet.test.tsx` (sibling, extended) for criteria 3 and 4. `npx playwright test e2e/journey.export.spec.ts` (existing spec, fixture `test`, rows and the Re-export control located by accessible name) for: download at one width, the row appears with the templated filename, Re-export produces a second download whose bytes have the same `readImageHeader` dimensions.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12.0
- **Notes:** Checked against `docs/FEATURES.md`: `D7-F17` (filename templating), `D7-F15`/`D7-F16` (the multi-size zip and its job) and `D8-F31` (`JobProgressBar`'s accessible name) are all `Working` and none of them is a list of what was already written. `D2-F16` ("A wall-clock rule deleted a photograph 7 days after a read") is about deletion, not export records. An earlier draft of this section also filed an "apply to all layers" item here; it duplicated IMP-121 and was deleted rather than merged.

### IMP-128 — Build the matte repair brush, or keep saying it is not there

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/components/tools/BackgroundPanel.tsx:249` (the copy that admits the brush does not exist), `src/features/ml/matting.ts` (where the matte asset is produced), `src/model/types.ts:373` + `src/model/defaults.ts` + `src/model/migrate.ts` + `src/model/migrate.test.ts` (**required** — this adds a `Doc` field), `src/render/cpu-passes.ts:903` (`runCpuPasses`) and `src/gl/shaders/index.ts` if the stroke becomes a pass
- **Intent:** Matting leaves a hard edge on hair and a halo where the subject met the background, and today the only remedy is to re-run the model. A one-brush repair — paint the matte back in or out along an edge — is the single most requested thing a matting tool is asked for, and `D6-F11` is a `Missing` row that says so out loud.
- **Acceptance criteria:**
  1. `Doc` gains one field carrying the repair strokes, and it ships with all three halves at once: a default in `src/model/defaults.ts` (an empty stroke list), a migration in `src/model/migrate.ts` that gives a pre-existing document an empty list, and a case in `src/model/migrate.test.ts` asserting a v3 document with no such field migrates and round-trips.
  2. `DOC_SCHEMA` in `src/model/types.ts:22` goes from 3 to 4 and the v1/v2 → v3 branch is left intact, because that branch is not the place to refactor.
  3. The stroke list is JSON — no `ImageBitmap`, `Blob` or canvas reference — and a unit test asserts a document carrying strokes still passes the existing serialisability contract (invariant 1).
  4. Appearance never enters the stroke list: a test asserts no `theme`/`density`/`textScale`/`motion`/`iconScale`/`accent` key appears in a serialised document with strokes (invariant 7).
- **Verification method:** `npx vitest run src/model/migrate.test.ts` and `npx vitest run src/render/parity.test.ts` **alone** if criterion 4 added a pass. `npx playwright test e2e/journey.matte.spec.ts` (existing spec, fixture `test`) only under `E2E_MATTING=1` — **never** in default CI, because it pulls ~42 MB. The stroke-plumbing half must therefore be covered by a unit test over a matte-asset double so the feature is not dark.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** `D6-F11` is `Missing` and `P2`, and §6 records it as "Deliberately not built; the copy says so". **This item contradicts a recorded decision**, so it should go to the owner before anyone builds it — the honest status is arguably NEEDS-HUMAN. It is filed as TODO only because the _deliberate_ part was "not built", not "not wanted"; a maintainer reading `§6` may reasonably close it. Effort L and risk high are the price of the pass decision in criterion 4. Split: the original had six criteria at Effort L. This item is the schema half only, and it is what invariant 4 forces for any `Doc` field. The brush itself — the part that contradicts the recorded `D6-F11` decision — is IMP-135 and is NEEDS-HUMAN.

### IMP-136 — Carry a document name and id through the Doc schema
- **Status:** TODO
- **Category:** tooling
- **Type:** test
- **Area / files:** `src/model/types.ts:22` (`DOC_SCHEMA = 3`, verified), `src/model/defaults.ts:192` (`createDoc`, verified), `src/model/migrate.ts:680` (`migrateDoc`, 829 lines, verified), `src/model/migrate.test.ts`; precedent IMP-105
- **Intent:** A named list of stored documents needs two new `Doc` fields, and invariant 4 says a new field ships with a default **and** a migration **and** a test. Doing it here as its own item means the schema work is done once, correctly, and IMP-131 cannot be built against a half-migrated document.
- **Acceptance criteria:**
  1. `Doc` gains `name` and `id`; `src/model/defaults.ts` supplies both (name defaulting to the source file name at import, id a new generated id) and `src/model/migrate.ts` supplies both for a document persisted before the field existed.
  2. `DOC_SCHEMA` goes from 3 to 4 **only if** the change is not backwards-compatible; the v1/v2 → v3 branch is left byte-identical, and `src/model/migrate.test.ts` gains a case that a v3 document with neither field migrates and round-trips through `createDoc()`.
  3. `migrate.test.ts` also asserts both fields are JSON — no `ImageBitmap`, `Blob`, canvas or class instance — so invariant 1 still holds for an IndexedDB row.
  4. Deleting a stored document removes its `id` from the stored list and its asset rows, and a test asserts no orphaned row survives (the GC path `D2-F13` already names is exercised, not assumed).
- **Verification method:** `npx vitest run src/model/migrate.test.ts`; add the field to `src/model/types.ts` without a migration and confirm the new case fails; `npm test`; `npm run typecheck`.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 4 / 1 = 12
- **Notes:** Split from the original IMP-131 by the Critic (six criteria at Effort L). Its four criteria are the schema half; the list UI is IMP-131, which depends on this item. Pair with IMP-105, which makes this same rule mechanical for the next field.

### IMP-113 — Show a labelled edit-history timeline from the pure history engine

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/store/history.ts:13` (`MAX_HISTORY = 50`), `src/store/docStore.ts` (the `past`/`future` arrays it holds), `src/components/editor/EditorTopBar.tsx:121-127` (the More menu rows, where the entry point goes), new `src/components/editor/HistoryPanel.tsx`
- **Intent:** Undo/redo is a two-button machine: after six slider drags the user can only step backwards one step at a time and cannot see what any of the steps were. Exposing the existing `past`/`present`/`future` stacks as a labelled list turns "I think I broke it somewhere" into "the step called _Curves_ is the one to jump back to".
- **Acceptance criteria:**
  1. A control named `Edit history` is reachable from the editor's More menu, and opening it lists one row per history entry in oldest-first order, newest last, with the current state marked as current.
  2. Each row has an accessible name naming the kind of change it was (e.g. _Curves_, _Crop_, _Layer added_) — not `step 4` — derived from a pure `describeEdit(before, after)` in `src/lib/historyLabels.ts`.
  3. Activating a row restores that document state as **one** undoable step, so pressing Undo once after jumping returns to where the user was.
  4. The list is capped at the engine's own `MAX_HISTORY` and never renders more rows than `history.past.length + 1 + history.future.length`.
  5. The panel reads `past`/`future` from the store; it never calls `setState` on the doc directly.
- **Verification method:** `npx vitest run src/lib/historyLabels.test.ts` for the pure label derivation. `npx playwright test e2e/journey.history-panel.spec.ts` (new spec, built on the `test` from `e2e/fixtures.ts`, locating rows by accessible name and asserting via `readDoc()`, never a CSS-module class) for: three adjustments applied → the panel lists three rows → jump to the first → `readDoc()` reports the first adjustment's value → one Undo returns to the third.
- **Effort:** M **Risk:** low
- **Depends on:** none
- **Priority score:** 5 x 4 / 2 = 10.0
- **Notes:** No new `Doc` field — history lives in `docStore`, never in the document. Checked against `docs/FEATURES.md`: `D2-F01`/`D2-F02`/`D2-F03`/`D2-F04` are the _engine_ rows (all `Working`) and none of them names a history UI, so this is additive rather than a duplicate. If a history row does exist there under a district I did not read line by line, this item is redundant and should be deleted rather than merged.

### IMP-125 — Give every empty panel the one action that would fill it

- **Status:** TODO
- **Category:** feature
- **Type:** improvement
- **Area / files:** `src/components/ui/EmptyState.tsx` (the primitive, already used and tested per `D8-F28`), `src/components/tools/LayerPanels.tsx`, `src/components/tools/RetouchPanel.tsx`, `src/components/tools/BackgroundPanel.tsx:249` (the copy that admits the repair brush does not exist)
- **Intent:** An empty panel that says "No layers yet" and shows a disabled button teaches nothing. Each empty panel already knows what would fill it; the empty state should name that thing and perform it in one press.
- **Acceptance criteria:**
  1. Every empty panel's primary action is enabled — it performs the thing that creates the first item — and no empty state ships a disabled button as its primary affordance.
  2. `EmptyState` takes an action and a verb, and a test asserts no caller passes a disabled action as the empty state's primary.
  3. The Background panel's empty state names the manual background-replacement path that works without the model download, rather than only naming the matting button that needs 42 MB.
  4. Each panel's action is reachable by its accessible name and produces the item it promises, asserted through `readDoc()`.
- **Verification method:** `npx vitest run src/components/ui/EmptyState.test.tsx` (sibling, extended) for the disabled-primary guard. `npx playwright test e2e/journey.panel-coherence.spec.ts` (existing spec, fixture `test`) for the Layers panel: the empty state's action is enabled, activating it adds a layer per `readDoc()`.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 3 / 1 = 9.0
- **Notes:** `D8-F28` ("EmptyState: the empty case says both halves") is `Working` — it is about the component saying what is empty and what it is for. This is about whether the action it offers _works_, which is a different assertion. **Do not run this against the Background panel's _use_ path in e2e**: that would download the matting model (`E2E_MATTING=1`, off in CI). Only the manual replacement is asserted.

### IMP-115 — Batch export to a chosen folder where the File System Access API exists

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/lib/encode.ts:131` (`downloadBlob`, the single-file path), `src/features/export/multiSize.ts` (the one job that already writes several widths), `src/components/tools/ExportSheet.tsx:87` (the `ExportAction` union — a `folder` member goes there), `src/components/tools/ExportSheet.tsx:365` (`handleDownload`)
- **Intent:** A person with twenty photos from one trip currently exports one, renames it, exports the next, renames that. This writes every configured size for the open photo into a directory the user picks once, keeping the filename template's numbering.
- **Acceptance criteria:**
  1. Where `window.showDirectoryPicker` exists, an export row _Save all sizes to a folder…_ asks for a directory once and writes one file per configured width into it; where the API is absent the row is either absent or says plainly that this browser cannot and points at Download.
  2. Each written file's bytes are the same bytes `downloadBlob` would have written for that width — asserted on encoded dimensions via `readImageHeader`, not on file size.
  3. A failure on any one file names that file and continues with the rest, and the summary says how many of how many succeeded; no silent partial archive.
  4. The picker call is never made from module scope and never inside the render loop; it is called from the click handler only.
  5. The feature is behind capability detection, not a runtime dependency: no new entry in `src/lib/licenses.ts` and nothing added to `package.json`.
- **Verification method:** `npx vitest run src/features/export/multiSize.test.ts` for the write-plan function that is pure about ordering and naming. `npx playwright test e2e/journey.export.spec.ts` (existing spec, extended, fixture `test`) asserts the graceful-absent-API path and the toast text; the granted-permission path is asserted in a unit test over an injected directory-handle double, because Playwright cannot grant a directory picker.
- **Effort:** M **Risk:** med
- **Depends on:** none
- **Priority score:** 4 x 4 / 2 = 8.0
- **Notes:** **Not** the non-goal "batch processing of many files at once" in `README.md:364` — that is many _source photos_, which needs a different app shell. This is many _outputs of the one photo already open_, which is what `multiSize.ts` already computes. The directory picker requires a user gesture and a secure context, so the e2e claim is limited to the absent-API branch and that limit is stated rather than glossed.

### IMP-120 — Give every tool panel a "revert this panel" that returns it to how it was on open

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/store/history.ts` (the pure engine this reads), `src/store/actions.ts` (a `snapshotSection`/`revertSection` pair, beside the existing multi-field action that merges undo steps), `src/components/tools/AdjustPanel.tsx`, `src/components/tools/CurvesEditor.tsx`, `src/components/tools/HslPanel.tsx`, `src/components/tools/FiltersPanel.tsx`
- **Intent:** Somebody who spends twenty minutes on colour and decides it is worse has to hold Undo until the twenty minutes is unwound, and every press may cross into the crop they set before it. A per-panel revert does exactly one thing and leaves the rest of the document alone.
- **Acceptance criteria:**
  1. Each colour panel shows a _Revert this panel_ control, disabled until that panel's section differs from the value captured when the panel was opened.
  2. Activating it restores only that section and pushes exactly **one** undo entry, so one Undo undoes the revert.
  3. The captured value is held in `uiStore` (chrome) or a local ref, never in `Doc`, and reopening the panel recaptures — a test asserts reopening after a revert shows the reverted value, not the pre-revert one.
  4. The pure `sectionChanged(before, after)` / `sectionRestore(doc, section, before)` functions live in `src/lib/sectionRevert.ts` with a sibling `sectionRevert.test.ts`, and every one of the document's sections has a case.
  5. No new `Doc` field: this adds nothing to the document schema.
- **Verification method:** `npx vitest run src/lib/sectionRevert.test.ts`. `npx playwright test e2e/journey.adjust-legibility.spec.ts` (existing spec, fixture `test`, control located by accessible name) for: move two adjustments, revert the panel, `readDoc()` shows both at their panel-open values and one Undo restores one of them.
- **Effort:** M **Risk:** low
- **Depends on:** IMP-113
- **Priority score:** 4 x 4 / 2 = 8.0
- **Notes:** Shares its history-reading plumbing with IMP-113 but is shippable without it — the dependency is convenience, not correctness. Checked against `docs/FEATURES.md`: `D2-F05` ("multi-field actions split undo steps") is `Working` and is about the opposite problem. If a "reset panel" row exists that I did not read, this duplicates it.

### IMP-124 — Show a release note in the app that says what changed since their last visit

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/lib/buildInfo.ts` (the version already derived from `package.json` and printed on the Hub and the crash screen, `D9-F15`), `src/pages/Hub.tsx` (the Hub footer, where the entry point goes), new `src/lib/releaseNotes.ts`
- **Intent:** `README.md` has a _What's new_ section and `docs/FEATURES.md` §10 has a changelog; neither reaches the person using the app. A returning visitor on a hosted static build has no way to learn that a tool they use changed shape.
- **Acceptance criteria:**
  1. A `What's new` entry point on the Hub opens a list of changes for the current version and the two before it, newest first, each entry naming the feature in the user's words rather than a commit.
  2. The list records the last version a visitor has read in the existing chrome persistence layer, and shows an unread marker only for versions newer than that.
  3. The version the notes claim to describe is the same `APP_VERSION` the Hub footer prints; a unit test asserts the two are read from one source and cannot diverge.
  4. The notes ship as data in the bundle — no network fetch, nothing downloaded, nothing that would phone home.
  5. An unread marker is chrome. It adds no `Doc` field and no history entry.
- **Verification method:** `npx vitest run src/lib/releaseNotes.test.ts` (sibling; includes a test that fails if an entry's version is not present in the notes data, and one that fails if `releaseNotes.ts` reaches for `fetch`). `npx playwright test e2e/journey.empty-state.spec.ts` (existing spec, fixture `test`, entry point located by accessible name) for the list opening with the current version first.
- **Effort:** S **Risk:** low
- **Depends on:** none
- **Priority score:** 2 x 4 / 1 = 8.0
- **Notes:** Rule 4: **no new `Doc` field.** The read-version marker is stored beside the appearance key's storage wrapper in `src/lib/appearance.ts`-style chrome storage and must never enter `Doc`, history or IndexedDB. If a row in `docs/FEATURES.md` already claims an in-app changelog, drop this.

### IMP-134 — Add a Split view to Compare
- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/components/canvas/EditorCanvas.tsx:245-251` (the compare toggle), `src/components/canvas/CompareBadge.tsx`, `src/store/uiStore.ts:173,187,234`, `src/render/backend.ts:21`, and — only if a new pass is needed — `src/gl/shaders/index.ts`, `src/gl/renderer.ts`, `src/render/cpu-passes.ts:903`, `src/gl/caps.ts`
- **Intent:** Compare as shipped is a hold-to-show badge: it cannot put the edited and the original picture side by side, which is the only view in which "what did my edit actually do" is answerable at a glance. IMP-119 ships Blink; this is the half that needs the render pipeline.
- **Acceptance criteria:**
  1. A **Split** state renders the edited result on the right of a draggable divider and the unedited result of the same document on the left, both at the same viewport scale, so a crop or a curve is visibly absent on one side only.
  2. The divider is focusable, has an accessible name naming its role, and moves with `ArrowLeft`/`ArrowRight` (1 %) and `Home`/`End` (0 % and 100 %), with `aria-valuenow` as a percentage.
  3. Split uses the existing contract at `src/render/backend.ts:21` rather than branching on engine. **If it needs a new render pass**, it is three implementations — the GLSL, the GL executor and the CPU mirror in `src/render/cpu-passes.ts` — with `src/render/parity.test.ts` extended, or it is feature-gated in `src/gl/caps.ts` with a Canvas2D fallback; whichever is chosen is named in the PR, and `npx vitest run src/render/parity.test.ts` is run **alone** with the new cases named.
  4. On Canvas2D the state either works or says it does not; a control that renders one side with no warning fails criterion 4's first clause.
- **Verification method:** `npx playwright test e2e/journey.crop-preview.spec.ts` (existing spec, fixture `test`, controls by accessible name) asserts two screenshots taken either side of a midpoint divider differ in bytes and that `Home` then `End` moves the divider to each extreme. `npx vitest run src/render/parity.test.ts` alone if criterion 3 added a pass. Run `npm run test:e2e -- e2e/shader-parity.spec.ts` and record the renderer string: a skip on a software rasteriser is reported as a skip, never as a pass.
- **Effort:** M  **Risk:** med
- **Depends on:** IMP-119
- **Priority score:** 4 x 4 / 2 = 8.0
- **Notes:** Split out of the original IMP-119 by the Critic (five criteria at Effort L, two unrelated amounts of work). Criterion 3 is where this can quietly become unreviewable: a split view implemented only in the GL backend and not in `cpu-passes.ts` is precisely the class of defect `src/render/parity.test.ts` exists to catch, and it cannot be caught if the pass is never mirrored.

### IMP-130 — Decide whether straightening should reflow the crop by itself

- **Status:** NEEDS-HUMAN
- **Category:** feature
- **Type:** improvement
- **Area / files:** `src/store/actions.ts` (`setStraighten`), `src/components/tools/CropPanel.tsx` (the _Fill frame after straighten_ button), `src/lib/crop/geometry.ts` (the remap that a reflow would change)
- **Intent:** Rotating a photo by eight degrees leaves a wedge of empty canvas and a crop that no longer frames the subject. The app offers a button that reflows the crop around the rotation; whether straightening should do it automatically is unsettled, and the answer changes what a user sees the instant they let go of the dial.
- **Acceptance criteria:**
  1. **Blocked on an owner decision.** `D5-F05` is `Partial`/`P2` and §6 says in its own words: "**A product decision, not an implementation gap.**" Auto-reflow on every dial tick would move the crop under the user's hands mid-gesture; the current behaviour leaves it alone and offers a button. Both are defensible and they are not equivalent.
  2. The decision is recorded in `docs/FEATURES.md`'s `D5-F05` row and in `README.md`, in the same words on both sides.
  3. If the answer is **keep the button**: `D5-F05` is re-stated as a deliberate `Partial` with the reason, rather than being quietly promoted or quietly left to rot.
  4. If the answer is **auto-reflow**: it lands as a separate edit step that coalesces with the dial drag under `src/store/history.ts`'s existing `COALESCE_MS`, so one drag is still one undo entry; a unit test asserts 40 pointermoves produce one undo step.
- **Verification method:** Decision 3/4: `npx vitest run src/store/actions.test.ts` (extend) for the coalescing assertion. `npx playwright test e2e/journey.crop.spec.ts` (existing spec, fixture `test`, the dial located by accessible name) for the visible outcome — crop rectangle before and after one drag — asserting `readDoc()`.
- **Effort:** M **Risk:** med
- **Depends on:** none
- **Priority score:** 3 x 5 / 2 = 7.5
- **Notes:** NEEDS-HUMAN under rule 3: the app's own catalogue already names this a product decision, so writing it as a TODO would be picking a side silently. Filed so the decision gets made and written down, not so the current behaviour gets changed by an implementer.

### IMP-138 — e2e: one keyboard-only pass from import to download
- **Status:** TODO
- **Category:** journey
- **Type:** test
- **Area / files:** `e2e/journey.keyboard-journey.spec.ts`, `e2e/fixtures.ts`, `e2e/journey.a11y-keys.spec.ts`, `playwright.config.ts`
- **Intent:** Every tool panel's controls are individually reachable by keyboard, and no case proves the whole sequence. `recon-quality.md` finding 47 records that roughly a third of the real-`Tab` assertions are dark on the WebKit leg, which makes a single full-journey case the only place the aggregate is proven. This is the journey the owner named first — the app has no way to open a different image — and it is also the one a keyboard-only user has to complete.
- **Acceptance criteria:**
  1. `e2e/journey.keyboard-journey.spec.ts` uses the `test` from `e2e/fixtures.ts`, drives import → open a tool → change one value → undo → redo → close the tool → Export → Download using `keyboard.press` and `locator.press` only, and contains no `page.mouse`, no `page.click` and no `styles.*` selector.
  2. Every step is asserted on `readDoc()` or on the download's bytes via `readImageHeader`, never on a class or a screenshot.
  3. The case runs on `chromium` and `webkit`, and it either passes on WebKit or names `FULL_TAB_NAVIGATION` in a `testInfo.annotation` with the observed value — a WebKit skip that says only "skipped" is a defect, not a pass (`AGENTS.md` on shader-parity).
  4. The case is quoted by name in the `docs/FEATURES.md` row it claims, greppable in this file, and the three counts it moves are refreshed in the same pass.
- **Verification method:** `npm run test:e2e -- e2e/journey.keyboard-journey.spec.ts`; `npx playwright test --list | tail -1` re-measured for IMP-075; `grep -n '<quoted case title>' e2e/journey.keyboard-journey.spec.ts`.
- **Effort:** M  **Risk:** med
- **Depends on:** IMP-004, IMP-021
- **Priority score:** 5 x 3 / 2 = 7.5
- **Notes:** Added by the Critic. Depends on IMP-004 and IMP-021 because a keyboard-only journey that ends in the silent no-op of D-02 cannot pass, and the Done path must be fixed and gated first. `Risk: med` is the WebKit `Tab` behaviour in finding 47, which clause 3 handles by annotating rather than skipping silently.

### IMP-118 — Import more than one file and say what happened to each

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/components/editor/ImportScreen.tsx:85-113` (the file input, the drop handler, the paste listener), `src/lib/accept.ts:41` (`describeUnsupported` — already per-file), `src/lib/decode.ts` (the size/pixel guard)
- **Intent:** A user who selects eight photos from a card gets the first one and no idea what happened to the other seven. Multi-select gives the app a first-class answer to "I have several and I want them one after another".
- **Acceptance criteria:**
  1. The file input carries `multiple`, and a multi-file drop and a multi-file selection both offer the whole set, in the order the OS listed them.
  2. Each candidate is put through the existing `describeUnsupported` and `lib/decode.ts` guard independently; one bad file never blocks the good ones.
  3. After the import the user sees a summary naming how many loaded and, for each rejected file, its name and the reason — not a single aggregate count.
  4. The first accepted file becomes the open document; the rest are handed to IMP-133 rather than dropped silently.
- **Verification method:** `npx vitest run src/lib/importQueue.test.ts` (sibling; the order, the per-file rejection and the one-bad-does-not-block cases). `npx playwright test e2e/journey.import-edit-export.spec.ts` (existing spec, fixture `test`, `setInputFiles` on the input located by its accessible name) for three files where the middle one is `.heic`: the summary names two loaded and names the rejected file by name.
- **Effort:** M **Risk:** med
- **Depends on:** none
- **Priority score:** 4 x 3 / 2 = 6.0
- **Notes:** This is **multi-file import, not batch processing.** `README.md:364` puts batch processing of many files out of scope because it needs a different app shell; this keeps one document open at a time and adds no queue UI beyond a list of pending opens. If that boundary is judged to cross the non-goal, mark this NEEDS-HUMAN rather than building it — the owner's call, not mine. Camera capture already exists (`D8-F16`, `Working`, `ImportScreen.tsx:170-182`), so a separate "import from the camera" item would be a duplicate and is not filed. Split: the original had five acceptance criteria at Effort L, which the loop treats as two passes. The pending-open queue and its undo semantics moved to IMP-133; this item is now the import surface plus the per-file report. Both the `multiple` attribute and the summary are asserted in one Playwright case (`setInputFiles` with three files, the middle one `.heic`), so the split is by work, not by test.

### IMP-121 — Copy one adjustment's values onto another, and onto every layer

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/model/types.ts:373` (`Doc` and its adjustment sections), `src/store/actions.ts` (the layer-mutating actions beside `duplicateLayer`), `src/components/tools/LayerPanels.tsx`, `src/model/defaults.ts` + `src/model/migrate.ts` + `src/model/migrate.test.ts` **only if** a new field is introduced
- **Intent:** Grading a set of layers by hand means typing the same fifteen numbers fifteen times, and a near-identical set of adjustments across a document drifts. One action that lifts the current values onto every layer's adjustment section, and one that lifts one layer's onto another, is the difference between a minute and an hour.
- **Acceptance criteria:**
  1. An _Apply to all layers_ action writes the current document-level adjustment values onto every layer that has an adjustment section, and reports how many layers it touched.
  2. A layer-row action copies one layer's adjustment values onto another named layer, and the copy is a value copy — the two layers do not share an object afterwards (asserted with a mutation of one that leaves the other unchanged).
  3. Both actions go through `src/store/actions.ts` so history records one entry each, and one Undo reverts one bulk apply across all layers.
  4. **If** the implementation needs any new `Doc` field, it must ship all three of: a default in `src/model/defaults.ts`, a migration case in `src/model/migrate.ts`, and a case in `src/model/migrate.test.ts`, with `DOC_SCHEMA` bumped in `src/model/types.ts:22` if the change is not backwards-compatible. The preferred implementation adds no field at all, and that is stated as the design.
  5. No appearance setting is copied by either action.
- **Verification method:** `npx vitest run src/store/actions.test.ts` (extend; sibling of the actions, and `migrate.test.ts` if a field was added). `npx playwright test e2e/journey.layer-verify.spec.ts` (existing spec, fixture `test`, control located by accessible name) for apply-to-all over two layers with `readDoc()` on both.
- **Effort:** M **Risk:** med
- **Depends on:** none
- **Priority score:** 3 x 4 / 2 = 6.0
- **Notes:** Checked against `docs/FEATURES.md`: `D6-F13` ("Duplicate / front / back / row drag-reorder") is `Working` and is layer _arrangement_, not adjustment propagation — different feature. Confidence is 4 rather than 5 because the layer/adjustment shape was read only at the type level and the implementer should confirm whether a per-layer adjustment section already exists before assuming it.

### IMP-123 — Name, annotate and list recent recipes with their thumbnails

- **Status:** TODO
- **Category:** feature
- **Type:** improvement
- **Area / files:** `src/lib/persist/recipes.ts:132` (`listPresets` returns names), `src/components/editor/PresetPopover.tsx:96-142` (the name field, the apply row, the delete row), `src/pages/Editor.tsx:136-138,413-425` (the preset state and the save handler)
- **Intent:** The preset list is a column of bare names in one browser's storage. A saved look that cannot be told apart from another saved look, and cannot be recognised on sight, is a recipe nobody reuses.
- **Acceptance criteria:**
  1. Each stored recipe keeps an optional free-text note and, once the user has exported the look once, a small thumbnail captured from the document; both are shown in the list beside the name.
  2. The list is ordered by last-used with the most recent first, and the order survives a reload.
  3. A recipe can be renamed without being deleted and re-saved; the old name is not left behind as a duplicate entry.
  4. A recipe whose stored payload no longer parses is shown as _unavailable — this recipe was saved by an older version_ with a delete affordance, and applying it is refused rather than silently applying an empty edit set.
  5. Adding the note and thumbnail requires **no new `Doc` field** — both live in the recipe's own stored envelope in `src/lib/persist/recipes.ts`, outside the document. A unit test asserts a serialised recipe contains no appearance key.
- **Verification method:** `npx vitest run src/lib/persist/recipes.test.ts` (sibling, extended) for the ordering, the rename-without-duplicate and the unparseable-payload cases. `npx playwright test e2e/journey.empty-state.spec.ts` (existing spec, fixture `test`) for two saved recipes appearing in reverse save order with their notes as accessible names.
- **Effort:** M **Risk:** low
- **Depends on:** IMP-114
- **Priority score:** 3 x 4 / 2 = 6.0
- **Notes:** Checked against `docs/FEATURES.md`: `D2-F15` ("Presets are readable, appliable and deletable") is `Working` and covers the three verbs, not metadata, ordering or a corrupt-payload path. Layer rename is `D6-F09` and is a _layer_, not a recipe — do not confuse the two. Confidence 4 because the stored envelope shape in `recipes.ts` was read only at the line level.

### IMP-131 — Keep a named list of the documents this browser is holding

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/lib/persist/session.ts` (the one stored session `resolveResumableSession` reads), `src/components/editor/ResumeSessionCard.tsx` (the entry point becomes a link into a list), `src/pages/Hub.tsx` (the Hub card), `src/model/types.ts:22` (`DOC_SCHEMA`) + `src/model/defaults.ts` + `src/model/migrate.ts` + `src/model/migrate.test.ts` (**required** — a stored-document name and an id are new fields)
- **Intent:** Session resume restores _the_ last document. A person who edits a passport photo and a product shot in one afternoon can only keep one of them; the other is gone the moment the second is imported. A named list of stored documents means both are still there tomorrow.
- **Acceptance criteria:**
  1. Every imported document is stored under a name the user can change, defaulting to the source file's name, and the Hub lists all stored documents by name with their dimensions and last-modified time.
  2. Opening a listed document restores its pixels and its edits exactly — asserted with `persistedDoc()` from `e2e/fixtures.ts`, not with a value copied into the test.
  3. A document can be renamed and deleted; deleting names what it takes with it, in the confirmation shape IMP-002 provides, and the deletion frees the asset rows (`D2-F13` already GCs them).
  4. Appearance never enters the name or the list — renaming a document must not re-colour the canvas.
- **Verification method:** `npx vitest run src/model/migrate.test.ts` and `npx vitest run src/lib/persist/session.test.ts` (siblings). `npx playwright test e2e/journey.reload-loss.spec.ts` (existing spec, fixture `test`, list rows and their controls located by accessible name) for: import A, import B, both named in the Hub list, open A, `persistedDoc()` equals what was saved.
- **Effort:** M **Risk:** med
- **Depends on:** IMP-136
- **Priority score:** 3 x 4 / 2 = 6.0
- **Notes:** **Check `docs/FEATURES.md` before building**: `D2-F11` ("Autosave lost a reload inside the flush window") and `D8-F21` ("The resume card offered a permanent choice with nothing to decide on") are both `Working` and both concern _one_ session. If a `Multi` row already exists, this is a duplicate — the _singular_ framing in both rows I read is the reason I filed it. Effort L because of the migration and the IndexedDB shape, not the UI. Split: the original had six criteria at Effort L. The `Doc`-field half (name and id, defaults, migration, `migrate.test.ts`) is IMP-136, which must land first because invariant 4 makes the schema a precondition for the list. The reference to deleted IMP-126 now points at IMP-002's shared dialog.

### IMP-132 — Apply a recipe to a photo and show the before and the after side by side

- **Status:** TODO
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/lib/persist/recipes.ts` (`applyRecipe` — the writer), `src/features/export/encodeDocument.ts` (the encoder a thumbnail would come from), `src/components/tools/FiltersPanel.tsx` (where the 24 committed thumbnails already live, `D4-F13`), `src/components/canvas/EditorCanvas.tsx` (the surface, for the unedited side)
- **Intent:** Copying a look between people means pasting JSON, and the receiver cannot tell whether the look suits _their_ photo until they have already overwritten their edits. Applying it to a scratch copy first, beside the untouched original, turns a leap of faith into a comparison.
- **Acceptance criteria:**
  1. A _Preview recipe_ action renders the current document and the recipe-applied document **side by side**, each labelled, at the same scale, with the recipe applied to a copy so `readDoc()` is unchanged by opening the preview.
  2. The preview is chrome: closing it leaves `Doc`, history and IndexedDB byte-identical, and a unit test asserts history depth is unchanged.
  3. Applying from the preview goes through `src/store/actions.ts` so it is one undoable step; dismissing it pushes nothing.
  4. The two sides come from `encodeDocument.ts` through the same `Backend` interface at `src/render/backend.ts:21`; if this needs a pass the implementer does not write one — encoding each side to a blob and compositing two surfaces in the DOM is the intended route, and it needs no `src/render/cpu-passes.ts` mirror.
  5. Either heavy import (`encodeDocument.ts`, or anything that pulls an encoder) is a `lazy()` import inside the preview component, not a static import in `src/pages/` — route-level code splitting is load-bearing and a new eager import can undo it.
  6. On Canvas2D the preview says so rather than rendering one side only; a feature that half-works on the fallback backend must say which half.
- **Verification method:** `npx vitest run src/lib/persist/recipes.test.ts` (extend) for criterion 2. `npx playwright test e2e/journey.layer-verify.spec.ts` (existing spec, fixture `test`, both sides located by their accessible names) for: apply a look, preview it against the original, close, `readDoc()` reports the original values; then apply, and `readDoc()` reports the look's values. `npm run bundle:check` after any new import.
- **Effort:** M **Risk:** med
- **Depends on:** IMP-114
- **Priority score:** 3 x 4 / 2 = 6.0
- **Notes:** Distinct from IMP-119, which compares _one_ document against its own unedited state; this compares _two recipes' worth of edits_ and is the answer to "which of these two looks suits this photo". Checked against `docs/FEATURES.md`: `D4-F24` and `D4-F13` cover the 24 committed thumbnails and the near-duplicate fix — a static thumbnail grid, not a live before/after. If a row covers live recipe comparison, delete this.

### IMP-133 — Step through the files you imported after the first
- **Status:** TODO
- **Category:** journey
- **Type:** new-feature
- **Area / files:** the pending-open queue added by IMP-118; `src/components/editor/ImportScreen.tsx` (the summary surface), `src/store/actions.ts` (the action that swaps the open document), `src/model/defaults.ts` + `src/model/migrate.ts` **only if** the queue is stored in the document — it must not be
- **Intent:** IMP-118 gets eight photos into the app and opens the first. The other seven then have nowhere to go, and the user's next motion — "open the second one, then the third" — is the ordinary way this work is done. A silent drop is the worst outcome and a second file dialog is a poor one.
- **Acceptance criteria:**
  1. After a multi-file import, a _Also imported_ list names every accepted file by name in OS order, each row a control with an accessible name equal to that filename.
  2. Activating a row swaps the open document to that file and marks the row current with `aria-current="true"`; the previously current row is no longer current.
  3. The swap is one undoable step through `src/store/actions.ts`, and the canvas keeps showing the old photo until the new one has decoded — a case asserts the canvas is unchanged for the whole decode by reading canvas bytes before and after with the decode stubbed to hang.
  4. The list is chrome: it lives in `uiStore`'s existing persisted collection, adds no `Doc` field and no history entry beyond the one in criterion 3, and a unit test asserts both.
- **Verification method:** `npx vitest run src/components/editor/ImportScreen.test.tsx` for the list's own state. `npx playwright test e2e/journey.import-edit-export.spec.ts` (existing spec, extended, fixture `test`) for: `setInputFiles` with three images, the summary names three, the _Also imported_ row for the second is located by accessible name and clicked, `readDoc()` reports the second file's source, and one Undo returns to the first.
- **Effort:** M  **Risk:** med
- **Depends on:** IMP-118
- **Priority score:** 4 x 3 / 2 = 6.0
- **Notes:** Split out of IMP-118 by the Critic because the original item had five acceptance criteria at Effort L. Criterion 3's decode-hang assertion is the anti-vacuity half: without it, "does not clear the canvas until decoded" is a claim no test can check. Not batch processing — `README.md`'s non-goal is many *source photos at once in one run*, and this is one document open at a time with a list to walk.

### IMP-135 — Build the matte repair brush, or record why not
- **Status:** NEEDS-HUMAN
- **Category:** feature
- **Type:** new-feature
- **Area / files:** `src/components/tools/BackgroundPanel.tsx:249` (the copy that admits the brush does not exist), `src/features/ml/matting.ts`, the field IMP-128 adds, and — if the strokes become a pass — `src/render/cpu-passes.ts:903`, `src/gl/shaders/index.ts`, `src/gl/caps.ts`
- **Intent:** Matting leaves a hard edge on hair and a halo where the subject met the background, and the only remedy today is re-running the model. A one-brush repair — paint the matte back in or out along an edge — is the most requested thing a matting tool is asked for.
- **Why this is NEEDS-HUMAN:** `docs/FEATURES.md` row `D6-F11` is `Missing`/`P2` and §6 records it as "Deliberately not built; the copy says so". Building it contradicts a recorded decision, so an implementer picking this up would be overturning a product choice without one.
- **Acceptance criteria:**
  1. The owner records the decision in `docs/FEATURES.md` §6: **build**, or **keep not built** with the reason restated. Until one exists the row and the panel copy stay as they are.
  2. If the answer is **build**, the Background panel gains a _Repair matte_ mode whose brush has an adjustable size and a two-state restore/erase control, reachable **without** the matting model downloaded, because the strokes apply to the stored matte asset.
  3. If the strokes become a render pass rather than a pre-pass over the matte asset, it is **three** implementations with `src/render/parity.test.ts` extended, or a feature gate in `src/gl/caps.ts` with a Canvas2D fallback; whichever is chosen is stated in the PR.
  4. The copy at `BackgroundPanel.tsx:249` is replaced by the control rather than left beside it, and a test asserts the "does not exist" sentence is gone from the rendered panel.
- **Verification method:** not verifiable by a command — verification is that the recorded decision exists in §6 and the row matches it. If **build** ships, `npx vitest run src/render/parity.test.ts` alone when a pass was added, `npx vitest run src/model/migrate.test.ts` for IMP-128's half, and the panel e2e **only** under `E2E_MATTING=1`, never in default CI, because it pulls ~42 MB. The stroke plumbing must be covered by a unit test over a matte-asset double so the feature is never dark.
- **Effort:** L  **Risk:** high
- **Depends on:** IMP-128
- **Priority score:** 4 x 4 / 3 = 5.3
- **Notes:** Split from the original IMP-128 by the Critic (six criteria at Effort L). The schema half stayed TODO because invariant 4 makes it mechanical; this half is the product decision and was already flagged by the analyst as "arguably NEEDS-HUMAN" — it is now flagged that way. Note `README.md` and `NOTICE` are untouched by either half: no licence obligation changes.

### IMP-139 — Recover the mobile crop preview area lost to the IMP-041 readout
- **Status:** TODO
- **Category:** responsiveness
- **Type:** improvement
- **Area / files:** `src/components/canvas/canvas.module.css` (`.canvas`, `.canvasStage`), `src/components/canvas/EditorCanvas.tsx`, `src/components/canvas/CropOverlay.tsx`, `src/lib/crop/frameFit.ts`, evidence `.improve/artifacts/IMP-041/verify/mobile-390-crop-after.png`
- **Intent:** IMP-041 fixed a real occlusion by moving the crop readout out of the crop frame, and the price was a 37.6% reduction in mobile preview AREA (21% per axis at 390x844). On a phone that is a large amount of the thing the user is actually cropping, paid to fix a defect that was worst on desktop. The space is recoverable without reintroducing the overlap.
- **Acceptance criteria:**
  1. At **390 x 844** with the Crop sheet at its default detent, the crop preview's rendered area is at least **10% larger** than the area measured at `.improve/artifacts/IMP-041/verify/mobile-390-crop-after.png`, measured with `boundingBox()` on the canvas stage.
  2. The readout still has **zero** intersection area with all eight crop handles at both 390x844 and 1280x800 — the IMP-041 invariant must not regress.
  3. `e2e/journey.crop.spec.ts` keeps its existing `elementFromPoint` assertions for `Crop s/n/e/w handle` green on chromium and webkit.
  4. The mobile sheet detents in `sheetHeights.ts` are unchanged, and the image is still fully visible at every detent.
- **Verification method:** `npm test`, plus a measurement in `e2e/journey.crop.spec.ts` (or a sibling case) logging the canvas-stage `boundingBox()` at 390x844 before and after. Screenshots to `.improve/artifacts/IMP-139/`. Run `npm run typecheck && npm run lint && npx prettier --check .`.
- **Effort:** M  **Risk:** med
- **Depends on:** IMP-041
- **Priority score:** 4 x 4 / 2 = **8**
- **Notes:** Raised by the IMP-041 verifier, which measured the per-axis shrink as -7.4% desktop / -21% mobile but the area cost as -14.9% / -37.6%. Do not attempt this by moving the readout back inside the crop frame; `crop-preview.spec.ts` fails there.

### IMP-140 — Stop the fixed "Recent problems" panel from covering the crop handles on mobile
- **Status:** TODO
- **Category:** ux
- **Type:** bug-fix
- **Area / files:** `src/components/controls/Toast.tsx` (the bounded, versioned, user-clearable error list that outlives the toast), `src/components/canvas/CropOverlay.tsx`, evidence `.improve/artifacts/IMP-041/verify/mobile-390-crop-after.png`
- **Intent:** The IMP-041 verifier measured that after any save error the fixed "Recent problems" panel occludes the `Crop n`, `Crop e` and `Crop w` handles by **504 px^2 at 390x844 in Chromium**, and `elementFromPoint` at their centres fails. This is a SECOND, pre-existing instance of exactly the occlusion class IMP-041 exists to eliminate, on the error path rather than the normal path. The IMP-041 e2e case has to call `dismissErrorLog()` to work around it, which is a smell, not a fix.
- **Acceptance criteria:**
  1. At **390 x 844** with the error list visible and the Crop sheet open, `document.elementFromPoint` at the centre of `Crop n handle`, `Crop e handle` and `Crop w handle` returns the handle or a descendant — never the error panel. Measured with `boundingBox()`, intersecting area 0 for all three.
  2. The error list remains reachable, readable and dismissible by keyboard at 390x844; nothing is hidden in a way that removes the user's ability to read or clear an error.
  3. The error list does not permanently reserve the space it occupies — dismissing it restores the full preview, and asserting that does not create a layout jump greater than 2px.
  4. The workaround in the IMP-041 e2e case is **removed**, and that case still passes on chromium and webkit.
- **Verification method:** `npm test`, plus a case in `e2e/journey.crop.spec.ts` that raises a save error, leaves the panel up, and asserts hit-testability of the three handles at 390x844. Screenshots to `.improve/artifacts/IMP-140/`. Run `npm run typecheck && npm run lint && npx prettier --check .`.
- **Effort:** M  **Risk:** med
- **Depends on:** none
- **Priority score:** 4 x 5 / 2 = **10**
- **Notes:** Raised by the IMP-041 verifier. Pre-existing, NOT introduced by IMP-041, and deliberately not fixed there because it is out of that item's scope. The `dismissErrorLog()` call in the IMP-041 e2e case is the smell to remove.

### IMP-141 — Keep the crop readout on one line at large text scale
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/canvas/canvas.module.css` (the readout row introduced by IMP-041), `src/lib/appearance.ts` (`textScale`), `src/styles/scales.test.ts`
- **Intent:** IMP-041's CSS comment and the verifier's measurements both assume the DEFAULT text scale. At `textScale: xlarge` the readout row wraps 2.4 px over its allotted width and doubles in height to 83 px, taking **28% more** of the phone preview — so the fix for the occlusion is itself occluded at a setting the app explicitly supports and that `AGENTS.md` invariant 7 protects.
- **Acceptance criteria:**
  1. At **390 x 844** with `textScale: xlarge`, the readout row is a single line and its height does not exceed its height at the default scale by more than the text-scale ratio implies; specifically it must not exceed **56 px**.
  2. At `textScale: xlarge` the readout still shows the live pixel dimensions and aspect ratio, and `Reset crop` and `Perspective` remain operable with their current accessible names.
  3. The readout still has zero intersection area with all eight crop handles at `textScale` of `default`, `large` and `xlarge`, at both 390x844 and 1280x800.
  4. The appearance setting reaches the page as an `<html>` data-attribute; nothing about it enters `Doc`, history or IndexedDB (invariant 7).
- **Verification method:** `npm test`; a case in `e2e/journey.crop.spec.ts` that sets `textScale` to `xlarge` via the appearance control at 390x844 and asserts the row height and the handle intersections. A static assertion may be added to `src/styles/scales.test.ts`. Screenshots to `.improve/artifacts/IMP-141/`. Run `npm run typecheck && npm run lint && npx prettier --check .`.
- **Effort:** S  **Risk:** low
- **Depends on:** IMP-041
- **Priority score:** 3 x 4 / 1 = **12**
- **Notes:** Raised by the IMP-041 verifier, which measured 2.4 px of wrap and an 83 px row at `textScale: xlarge`. Neither the IMP-041 CSS comment nor the verifier's acceptance run covered a non-default text scale.

### IMP-142 — Replace the vacuous assertion in `frameFit.test.ts`
- **Status:** TODO
- **Category:** test
- **Type:** test
- **Area / files:** `src/lib/crop/frameFit.test.ts` (added by IMP-041)
- **Intent:** The IMP-041 verifier found that the case asserting "same padding on both axes" cannot fail for the reason it names, so it documents an intent rather than pinning one. A test that cannot fail is the failure mode `docs/FEATURES.md` §1.2 was written to catch, and it is new code, so it is ours to fix now rather than inherited later.
- **Acceptance criteria:**
  1. Every case in `src/lib/crop/frameFit.test.ts` fails when the behaviour it names is broken — proven by mutation, not asserted. At least one case must be shown to go red under a deliberate change to `src/lib/crop/frameFit.ts`, which is then reverted exactly.
  2. The file covers the axes the IMP-041 layout depends on: stage fitting, and the readout row reserving space without entering the crop frame.
  3. `npm test` passes and the test count does not decrease.
- **Verification method:** `npm test`; plus a documented mutation run recorded in `.improve/reports/verify-IMP-142.md`. Run `npm run typecheck && npm run lint && npx prettier --check .`.
- **Effort:** S  **Risk:** low
- **Depends on:** IMP-041
- **Priority score:** 2 x 5 / 1 = **10**
- **Notes:** Raised by the IMP-041 verifier. Non-blocking, but it is new code shipping with a test that does not bite, which is the same defect class as `e2e/a11y-measure.spec.ts`'s class-regex guards.

### IMP-143 — Pin `scroll-padding-inline` so a keyboard-focused chip is not hidden under the fade
- **Status:** TODO
- **Category:** accessibility
- **Type:** bug-fix
- **Area / files:** `src/components/editor/editor.module.css` (the scroller introduced by IMP-042), `src/hooks/useScrollEdges.ts`, `src/components/controls/ChipRow.tsx`
- **Intent:** IMP-042's implementer left `scroll-padding-inline` unpinned and recorded it as a known defect. Without it, a chip scrolled into view by keyboard focus lands *underneath* the edge fade rather than clear of it, so the focused control is partially masked at exactly the moment a keyboard or screen-reader user is trying to see it. This is the same occlusion class IMP-041 and IMP-042 exist to eliminate, on the focus path.
- **Acceptance criteria:**
  1. When a chip tab is focused by keyboard and the scroller scrolls to reveal it, the chip is **fully outside** the faded region — measured as zero intersection with the mask ramp's transparent stops.
  2. The focus ring is fully visible at 390 x 844 for every one of the 13 tool tabs when reached by Tab, and at 1280 x 800 unchanged.
  3. `scroll-padding-inline` is pinned by a test, so deleting it turns a gate red. The pin must be proven to bite by mutation.
  4. The fade still paints correctly at all three scroll positions — IMP-042's own invariant must not regress.
- **Verification method:** `npm test`; a case in `e2e/journey.mobile.spec.ts` at 390x844 that Tabs through all 13 tabs, forces each into view, and asserts the chip is clear of the fade. Screenshots to `.improve/artifacts/IMP-143/`. Run `npm run typecheck && npm run lint && npx prettier --check .`.
- **Effort:** S  **Risk:** low
- **Depends on:** IMP-042
- **Priority score:** 3 x 4 / 1 = **12**
- **Notes:** Raised by the IMP-042 implementer as a known unpinned defect and deliberately not fixed inside that item.

### IMP-144 — Capture a second baseline set at default appearance
- **Status:** TODO
- **Category:** test
- **Type:** tooling
- **Area / files:** `.improve/artifacts/baseline/` (30 screenshots, currently all `density: roomy` + `textScale: xlarge`), the capture procedure the Experience auditor used
- **Intent:** Every baseline screenshot in this loop was captured at `density: roomy` + `textScale: xlarge` rather than default appearance, and that was not recorded anywhere until two verifiers discovered it independently. Defects found against those images are still real, but any claim about *magnitude* — "the tool bar fits 5 of 13", "the readout takes 28% of the preview" — is measured at a non-default setting and cannot be quoted without that caveat. A verifier comparing a default-appearance screenshot against a roomy/xlarge baseline will also see differences that are not regressions.
- **Acceptance criteria:**
  1. A second complete set of baseline screenshots exists at **default appearance**, covering the same states at 1280x800 and 390x844, saved alongside the existing set with the appearance settings recorded in the filename or a manifest.
  2. A short `README` in the baseline directory states, per set, the exact `theme` / `density` / `textScale` / `motion` / `iconScale` / `accent` values used, so a verifier can never again mistake an appearance difference for a regression.
  3. The existing roomy/xlarge set is retained and labelled, not overwritten — it is what the original findings were measured against.
- **Verification method:** `npx prettier --check .`; manual confirmation that the manifest matches the appearance actually set before each capture. The captures themselves are produced with the Playwright tools against the dev server on port 5173.
- **Effort:** S  **Risk:** low
- **Depends on:** none
- **Priority score:** 3 x 5 / 1 = **15**
- **Notes:** Raised by both IMP-042 verifiers. IMP-041's verifier separately recorded that the `textScale: xlarge` case makes the IMP-041 readout wrap 2.4px and double to 83px — that defect (IMP-141) is invisible at default appearance, which is exactly the class of regression a single-appearance baseline misses.
