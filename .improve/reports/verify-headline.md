# Verify: headline fix — "there is no way to open a different image"

Reviewer: independent, wrote none of this change. Branch `improve/auto-20261004`, HEAD `b957f90`,
28 files uncommitted (21 modified + 12 untracked, of which 2 are reports).
Verdict: **FAIL** — the delivered behaviour is right and the four gates are green, but one
acceptance criterion was quietly skipped (IMP-002 clauses 1 and 3, the `Reset all edits`
caller), and the diff carries four false claims about its own code and its own history.
All three of the four "unsatisfiable" clauses are correctly judged except IMP-006 clause 3,
whose replacement test is right but whose wording fix was not propagated to the file that
still states the wrong invariant.

---

## 1. Criterion-by-criterion

### IMP-002 — Confirm before replacing a document that has edits

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `confirmDestructive({title, body, confirmLabel, tone})` in `src/lib/confirm.ts`, promise→boolean, **used by at least `New image` and `Reset all edits`** | **PARTIAL / UNMET** | `src/lib/confirm.ts:38-45` exists and has exactly **one** production caller: `Editor.tsx` `handleNewImage` (`grep -rn confirmDestructive src e2e \| grep -v test` → 1 hit). `EditorTopBar.tsx` still calls `onReset={() => useDocStore.getState().reset()}` (`Editor.tsx:610`), unwrapped. |
| 2 | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial focus on the **safe** control, `Escape` → `false`, focus restored to the opener | **PASS** | `ConfirmDialog.tsx:46-53`; `confirm.test.ts` 14 cases; verified in a real browser at 1280×800 and 390×844 — `document.activeElement` was `Cancel` on open, `Escape` resolved false, focus returned to the **More options** trigger. |
| 3 | **Every** destructive path that can discard user work routes through it; a unit test greps `src/` and fails on a raw `confirm(` | **PARTIAL** | Grep guard **MET** and stronger than asked (`confirm.test.ts:255-266` walks all of `src/`, fails on any `confirm(` call outside tests). "Every destructive path" **NOT MET**: of the eight in the Intent, exactly one is wired. `Reset all edits` (`Editor.tsx:610`), `Discard session` (`ResumeSessionCard.tsx:119`), `Delete preset`, `Clear strokes`, `Delete layer`, `Remove frame` are all unwrapped, and `RouteError`'s "Start over" was changed to a direct destructive action rather than a confirmation. |
| 4 | Destructive control has an accessible name unique on the page, never bare `OK`/`Yes` | **PASS** | `Start new image`; `confirm.test.ts:199-210`; browser: exactly one such button, `aria-label`-free text `Start new image`. |

IMP-002's own *report* section argues that reversible actions must not get a dialog. That is a
defensible opinion; it is not the criterion, and the criterion was satisfiable.
**`docStore.reset()` pushes an undo entry** (`docStore.ts:152-163`), so the spec's own branch
(a) — "one `⌘Z` returns to the pre-reset state" — is the true one, and the wiring is a
three-line change in `EditorTopBar`/`Editor`. The skip is disclosed in the report but is not
recorded as an unmet criterion, and the four backlog rows still say `Status: TODO`.

### IMP-005 — "Start editing" from the Hub opens the image the user is looking at

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Each Hub entry point **that names a specific source** opens that source; the singleton is initialised from the entry point's intent | **UNSATISFIABLE as written** — right call | `Hub.tsx:126-171` renders 7 tool cards (`/editor`, `/editor/{crop,adjust,filters,background,passport,layers,export}`) plus "Start editing" → `/editor`. **No door names a photograph**, so there is no producer for the clause. The *intent* half — "initialised from the entry point's intent rather than from whatever was last in memory" — is honoured only for the **tool** (`editorEntryTool(location.pathname, TOOL_IDS)`), which is the only intent any door carries. |
| 2 | If the intended source is not in the `AssetStore`, no silent fall back to a different image: import screen or explicit error | **PASS (already satisfied before the change)** | Traced every route in: (a) `/editor` + `/editor/:tool` — `Editor.tsx:153` `bitmapFor(sourceAssetId)` **throws** before `resolveEditorEntry` runs, so the `source-unavailable` branch is unreachable at runtime and the error screen (naming the asset) is what a reader gets; (b) resume — `handleResume` decodes **that row's own** blob or says "That session's image is no longer stored"; (c) import screen — user-chosen. Browser: pointing the live doc at `asset_vanished` produced `RouteError` with the id in the copyable detail line, **not** another photo (`07-routeerror.png`). |
| 3 | Two different **Hub navigations** in one session produce two different `doc.source`, asserted via `readDoc()` in both cases in one e2e case | **PARTIAL — not disclosed** | The assertion shape is delivered (`journey.hub-reentry.spec.ts:75`, two different `assetId`s, both via `readDoc()`), but the second source came from the **import screen** via "New image", not from a Hub door — for the same reason clause 1 is vacuous. **Not mentioned in the report's list of unmet criteria.** Worse, the case's title, "two Hub entries in one session open two different photographs", is false: both Hub entries in that case open the *same* photograph (its third assertion proves it). |
| 4 | A unit test on the singleton's init/reset path proves a fresh source replaces rather than merges | **PASS** | `docStore.test.ts:309-395`, four cases: drops source/layers/edits/undo stack, a source-less doc is the empty editor, `liveAssetIds` releases the replaced source, `loadUnknown` replaces too. |

### IMP-001 — "New image" in the More menu

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Menu item named exactly `New image` | **PASS** | `EditorTopBar.tsx:119-124`. Browser: `role=menuitem`, accessible name `New image`, 3rd of 8 rows, own group (3 separators), at y=153-195 in an 800px viewport — **no scrolling**, own glyph, keyboard-reachable via `ArrowDown` ×2. |
| 2 | Dirty doc → confirmation naming the **number** of edits + a confirm control; pristine doc → no confirmation | **PASS** | `newImageRequest(past.length)`; browser: "This photo has **2** edits." with `past.length === 2` read from the live store — the number is truthful and Undo-checkable. Pristine: **0** dialogs, straight to the import screen. |
| 3 | After confirming: new source, only the new assets, `doc.layers` is the **default single layer** | **PASS on intent / criterion wording wrong** | `createDoc()` has **`layers: []`**, not one layer (`model/defaults.ts`). Shipped assertion is `layers === createDoc().layers` (`docStore.test.ts`, `EditorNewImage.test.tsx:333`) and the e2e asserts `after.layers).toEqual([])` (`journey.new-image.spec.ts:206`) — i.e. "the new document's default", which is what the clause meant. Only the new asset remains (`liveAssetIds` = `[new]`). |
| 4 | Autosave keys for the previous document removed; a hard reload does not resurrect it | **PASS — verified in a real browser inside the debounce window** | See §5(c). Both durable copies were populated with Sample 1 + `exposure 0.02` before the replace; the reload landed **48 ms** after the confirm (edit→reload 157 ms, debounce 1000 ms); after reload: `localStorage['image-editor:doc-mirror'] === null`, IndexedDB `sessions/current` **absent**, `present.source === null`, **0** canvases, **0** Resume buttons, import screen rendered. |
| 5 | Item stays in the menu, `aria-disabled="true"` during export, with an accessible description naming the reason | **PASS** | `uiStore.exportBusy` (chrome, not `Doc`), set in `ExportSheet.tsx` around the export and cleared in `finally`; `EditorTopBar.tsx` + `useMenuPopover` render the reason in a visually-hidden span wired by `aria-describedby`, so the name stays exactly `New image` (WCAG 3.2.4). `EditorTopBar.test.tsx` and `useMenuPopover.test.tsx` cover it. |

### IMP-006 — Clear the autosave row and the mirror on replace

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Replace clears the row **and** the mirror in the same operation; a unit test asserts both are gone | **PASS** | `forget.ts` (row + its asset bytes + mirror, `Promise.all`, refuses rather than throws on a blocked storage); `forget.test.ts`; `EditorNewImage.test.tsx:269`. Mutation-tested (§6). |
| 2 | A hard reload after a replace shows the import screen, not the previous image | **PASS** | §5(c). Also `journey.new-image.spec.ts:242`. |
| 3 | "The mirror is written with the same debounce as the store, so the mirror can never be **newer** than the store" | **UNSATISFIABLE as written — right call, wrong wording** | `resolveResumableSession` (`mirror.ts`) is `if (!mirrored) return stored; if (!stored) return null; if (mirrored.updatedAt <= stored.updatedAt) return stored` — the mirror exists **to be newer**. A mirror that could never be newer would be redundant with the row, and would not rescue the reload that lands inside the debounce window, which is the whole reason it is stamped first. The shipped test asserts the opposite direction and says so (`mirror.test.ts` — "stamps the mirror before the durable write starts, in the same throttle"). Live confirmation: mirror `updatedAt` 1791096806940 / row 1791096806941 (same write, mirror first), and the mirror did rescue a session the row never got. Correct criterion: *"the mirror is stamped before the durable write for the same revision, carries `updatedAt`, and `resolveResumableSession` picks the newer of the two."* |
| 4 | A `beforeunload` flush so a reload inside the debounce window restores in-progress edits | **PASS (already shipped)** | `attachUnloadFlush` in `autosave.ts`, wired by `Editor.tsx`; covered by the pre-existing `attachUnloadFlush` describe block and the new `mirror.test.ts` case. Not mentioned in the report at all. |

---

## 2. The four unsatisfiable clauses — my verdict

1. **IMP-005 clause 1 — right call.** No Hub door names a photograph (`Hub.tsx`), so the clause has
   no producer. The substance moved into clause 2 and shipped.
2. **IMP-005 clause 2 — right call, and it was already true.** The editor never substituted: a
   missing source raises into `RouteError` with the asset id, before any entry decision is made.
   `resolveEditorEntry`'s `source-unavailable` branch is therefore **dead code at runtime** (table
   tests only) — honest, but it is policy, not behaviour, and the report says so.
3. **IMP-001 "default single layer" — right call.** `createDoc().layers` is `[]`; the clause's
   wording was wrong about this app's document model. The shipped assertion matches the intent.
4. **IMP-006 clause 3 — right call, incompletely applied.** The invariant is inverted in the
   spec; the shipped ordering (mirror first, `updatedAt`-resolved) is correct and is now pinned by
   a test. **But** the wrong invariant survives in three places the implementer touched or cited:
   `Editor.tsx:392-395` and `forget.test.ts:12-16` justify clearing both copies with "…only adopts
   a mirror when the row it shadows exists", which is a statement about the *harmless* direction;
   the resurrection vector is the row surviving alone. Same false reasoning in
   `EditorNewImage.test.tsx:270-273` and in the report.

**Not disclosed at all:** IMP-005 clause 3 (partial, test title inaccurate) and IMP-006 clause 4
(met by pre-existing code). Both belong in the orchestrator's record.

---

## 3. Scope creep and the shared files

Nothing extraneous. Every one of the nine non-obvious touched files has a justification in the diff:

| File | Why it had to move |
|---|---|
| `src/store/uiStore.ts` | `exportBusy` — IMP-001 clause 5's "while an export is in flight". Chrome state, not `Doc`, not persisted. ✓ |
| `src/components/tools/ExportSheet.tsx` | The only writer of that flag; `finally` clear. ✓ |
| `src/components/ui/useMenuPopover.tsx` | `description` plumbing for the disabled-row reason; existing `menuItemDescription` CSS reused rather than duplicated. ✓ |
| `src/store/testHarness.ts` | `resetStores` must clear `exportBusy` or every panel test leaks it. ✓ |
| `src/components/editor/HelpOverlay.tsx` | Trap moved to a shared module; one hidden description span added. Body otherwise untouched. ✓ |
| `src/components/ui/RouteError.tsx` | Clears the durable copies in parallel with the navigation, and imports two ~20-line helpers. ✓ |
| `src/components/ui/icons/chrome.tsx` + `index.ts` | `NewImageIcon` for the new row. ✓ |
| `src/components/ui/menu.module.css` | The visually-hidden description class. ✓ |
| `e2e/fixtures.ts` | See §4. |

No `console.log`, no `debugger`, no `TODO`/`FIXME`, no `.only`, no secrets, no dead branches in any
of the 33 changed/new files (scanned). No unrelated edits.

**AGENTS.md invariants:** `Doc` still JSON-only (nothing new is stored; `replaceDocument` loads
`createDoc()`); `src/store/history.ts` untouched and still import-free; every store write goes
through `src/store/actions.ts` or the store's own `load`/`update`, never a component `setState`;
appearance still never enters `Doc`; route-level splitting still load-bearing — the new imports in
`src/pages/Editor.tsx` are `editorEntry` and `forget` (both tiny), and the build confirms it
(`Hub` 14.2 kB and `Editor` 343 kB remain separate chunks; eager set 237.4 kB).

**Dead-ish code:** `HUB_DOORS` (in production `editorEntry.ts`) is used by **no** runtime code — the
editor answers from `editorEntryTool(pathname, TOOL_IDS)`, and `Hub.tsx` keeps its own `TOOLS`
table. It ships ~1 kB of data for the tests' benefit. Two comments state the opposite:
`Hub.test.tsx:320` ("The editor decides what a URL means from `HUB_DOORS`") and the report
("single-sourced with the editor"). Both are false.

---

## 4. `e2e/fixtures.ts` — the contract file

One small hunk, `appBase`: it now prefers `baseURL` from the Playwright config over re-deriving the
base from the current `location.pathname`, which is the correct source of truth and **more**
robust than before (it no longer depends on being at a route with a trailing slash).

- `readDocExpression` — **byte-identical**. Still builds `bare = `${appBase}src/store/docStore.ts``
  and imports the first `performance.getEntriesByType('resource')` entry starting with it. Not
  simplified. ✓
- No helper removed, renamed, or re-signatured; every existing spec gets the same behaviour.
- Nothing weakened: no `waitFor` removed, no assertion relaxed.
- The two new specs follow the same rule independently (`journey.new-image.spec.ts:99-120`
  `liveDocument()`, and it explains why). The no-document assertion reads the live store directly
  **on purpose** — `readDoc()` refuses a source-less document — and says so in a comment.

One pre-existing hazard, not introduced here: on `/editor` exactly (no tool segment) the bare URL
suffixed with `?t=` equals the module's own URL, and `&t=` may 404 on some dev servers. No spec
asserts `readDoc()` from bare `/editor` today.

---

## 5. Real-browser verification (dev server on 5173, untouched)

Device A 1280×800, device B 390×844. `localStorage` and IndexedDB cleared first; the only console
errors in the session were the ones I caused on purpose (§f).

**(a) Discoverability** — `01-editor-loaded-edited.png`, `02-more-menu-new-image.png`,
`09-mobile-more-menu.png`. `New image` present on both widths, in its own group, 3rd of 8 rows,
fully visible with no scrolling (desktop y 153-195 of 800; mobile y≈150 of 844), `role=menuitem`,
accessible name exactly `New image`; every row carries `tabIndex=0`; reachable by
`ArrowDown` ×2 from the trigger (the menu closes on `Tab` — pre-existing and correct for the ARIA
menu pattern). Greyed `Paste edits` shows its reason underneath, which is the new
description mechanism doing the same job.

**(b) The dialog** — `03-confirm-dialog.png`, `10-mobile-confirm-dialog.png`.
`role=dialog`, `aria-modal="true"`, `aria-labelledby` → "Start a new image?", `aria-describedby` →
the body. **`document.activeElement` was `Cancel`** on open in both viewports and by both mouse and
keyboard. **Escape** resolved false, dialog gone, document intact
(`present === Sample 1, exposure 0.02, past.length 2` — the same 2 the dialog named), the Adjust
panel behind it stayed open (capture-phase `stopPropagation` genuinely works), and **focus returned
to the "More options" trigger** (the menu row itself is unmounted by then; the trigger is the
nearest live opener, and no focus is dropped to `<body>`).
Mobile: panel 342×253 at y=295 inside 390×844, `scrollWidth === clientWidth === 390`.

**(c) The load-bearing assertion** — `04-`, `05-`. Row *and* mirror both held Sample 1 +
`exposure 0.02` beforehand. Edit → More → New image → Start new image → **`page.reload()` 48 ms
later**, inside the 1000 ms debounce. After the reload: mirror key **null**, IndexedDB
`sessions/current` **gone**, live `present.source` **null**, canvases **0**, Resume card **0**,
"Edit an image" import screen rendered (`05-…png`). **The old photograph does not come back.**
(The e2e's equivalent case reloads *after* the assertions; mine reloads inside the window, which
is strictly harder.)

**(d) Pristine doc** — `06-pristine-new-image-quiet.png`. With `past.length === 0`: **0**
`aria-modal` dialogs, straight to the import screen, canvas gone. Quiet. ✓
*Minor defect found:* on this quiet path `document.activeElement` becomes `<body>` — a keyboard user
who pressed the row loses their place. The confirming path restores focus; the quiet one does not.

**(e) Tab trap** — forward: Cancel → Start new image → panel → Cancel; backward: Cancel → panel →
Start new image → Cancel. Four Tabs and two Shift+Tabs, `document.activeElement` never left the
`[aria-modal="true"]` panel and the page behind was never reached. Genuinely cyclic in both
directions (inherited from `HelpOverlay`'s stop list, unchanged).

**(f) `RouteError` "Start over"** — `07-routeerror.png`, `08-routeerror-startover-result.png`.
`asset_vanished` → error screen ("could not be restored" + `Start over — deletes your photo and
edits`, with `asset_vanished` in the copyable detail line). After one click: **0** alerts,
**0** canvases, import screen, URL `/editor`. **No loop.** ✓

**(g) Console** — the only new errors are the deliberate corruption above (2 `window.onerror` +
2 React boundary logs). Nothing new from the New image journey, quiet path, or RouteError.

**Chrome judgement:** the dialog is deliberately designed and consistent — same overlay geometry,
`--ie-chrome-solid` panel, `--radius-md`, `--ie-hairline`, accent Cancel focus ring, ink-outlined
danger button rather than a red fill, mobile-friendly 44px targets. It reads as part of this app,
not as a browser dialog. The one inconsistency: `.confirmPanel:focus { outline: none }` makes the
panel a focus stop with **no** visible ring — inherited from `.helpPanel`, and it is what the a11y
focus-visible check happens to pass on, but it is a latent defect in both modals.

---

## 6. Do the tests bite? (2 of 5 mutations re-run by me)

| Mutation | Result |
|---|---|
| `src/components/ui/focusTrap.ts` → `trapTab()` returns immediately | `src/lib/confirm.test.ts` → "keeps Tab and Shift+Tab inside the dialog, wrapping at both ends" **FAILS**; `HelpOverlay.test.tsx` → "holds Tab on its only tabbable control" and "cycles Tab and Shift+Tab between the panel and its control, both ways" **FAIL**. Restored from a byte copy: `sha256 ff71991a…6170a` identical. |
| `src/pages/Editor.tsx` → drop `void forgetStoredDocument()` from `replaceDocument` | `src/pages/EditorNewImage.test.tsx` → "on yes, it takes both durable copies and drops the document" **FAILS**. Restored: `sha256 dba8b3ed…add3` identical. |

Both bites are on the central behaviour, not on an incidental assertion. The `HelpOverlay` failures
are also direct proof that the shared trap's behaviour is covered by two named pre-existing cases.

**Honesty note:** my first combined e2e run showed one WebKit failure
(`journey.a11y-keys.spec.ts:324`, "Tab lands focus on Close"). That was **my own doing** — I was
mutating source files while the suite ran against the dev server, so Vite hot-reloaded
`trapTab`-as-no-op mid-test. Isolated re-run 2/2 passed; full re-run of the four specs on the
restored tree: **69 passed, 5 skipped, 0 failed**. Not a defect in the change.

---

## 7. Gates — commands and real numbers

| Command | Result |
|---|---|
| `npm run typecheck` | **clean**, no output |
| `npm run lint` | **clean**, no output |
| `npx prettier --check .` | **clean**, "All matched files use Prettier code style!" |
| `npm test` | **159 files / 3143 tests passed** (53 s) — exactly the claim |
| `npm run test:coverage` | exit **0**; 159 files / 3143 tests; summary 89.67 stmts / 81.57 branches / 88.96 funcs / 92.31 lines |
| `src/pages/**` (from `coverage-summary.json`, aggregated as `vite.config.ts` does) | **69.33 / 56.30 / 61.02 / 67.91** (lines/branches/functions/statements) vs baseline 63.0/51.3/50.9/60.9 — **all four up**; thresholds 60/48/47/57 all clear |
| `src/lib/**` 95.91/86.83/96.64/92.93 · `src/components/**` 87.49/79.97/82.36/85.25 · `src/store/**` 97.21/90.00/95.31/96.17 | all green |
| `npm run assets:check` | ✓ 24 LUT strips, 14 fonts, 33 licence entries; `public/` 1.95 MB of 8.00 MB |
| `npx vite build` | ✓ 436 modules, 992 ms. Entry `index-*.js` **38.2 kB**; eager set `index` 38.2 + runtime 1.1 + react 197.6 + buildInfo 0.4 = **237.4 kB** — exactly the claim. `Hub` 14.2 kB and `Editor` 343.2 kB still separate chunks, so the 1.3 MB win is intact |
| `node scripts/check-bundle.mjs` | bundle check passed |
| `node scripts/check-public-budget.mjs` | ✓ 74 files, 1.95 MB |
| `npx playwright test --list` | **689 tests in 43 files**. The report's "657 passed / 30 skipped" sums to 687 — two short of the suite that exists (skips match exactly at 30) |
| `npx playwright test` (full, 3 projects, 15.2 min) | **689 cases: 658 passed / 30 skipped / 1 failed.** The one failure is `[webkit] e2e/journey.onboarding.spec.ts:182` "the import screen carries the CDN exception in the claim itself" — an assertion about import-screen copy and about no CDN-shaped request, in a file this change does not touch. Re-run alone: 15 passed / 1 skipped. Re-run of the **entire webkit project** (334 cases, 6.3 min): **305 passed / 29 skipped / 0 failed.** Not reproducible, load-sensitive flake, not attributable to this change. |
| `npx playwright test e2e/a11y.spec.ts e2e/journey.a11y-keys.spec.ts e2e/journey.new-image.spec.ts e2e/journey.hub-reentry.spec.ts` | **69 passed / 5 skipped / 0 failed** (3 projects). `a11y.spec.ts`'s `ALLOWED` list is **still empty** — no suppression was added. ✓ |

`npm run build` was run as `assets:check && tsc -b && vite build && check-bundle && check-public-budget`,
i.e. everything `npm run build` runs **except** `prebuild`'s 42 MB model fetch, which would only
have written into the gitignored `public/models/`. `assets:check` (which reads `models.lock.json`)
still ran and passed.

---

## 8. `docs/FEATURES.md`

The implementer changed exactly one line (the D8-F11 row). That change is **correct and
necessary**: with "New image" inserted, `ArrowDown` ×2 lands on the third row, not on
"Paste edits" — and `journey.a11y-keys.spec.ts` never asserted that name (it only presses the
key), so only the prose was wrong. The rewritten claim matches the code. No invented test title.

**No row was added** for the new capability (deferred to the orchestrator by the report's own
account), so the "update the counts in the same pass" rule was not triggered by a row — but the
six numbers it quotes are now further out of date than before, in a file that claims "every count
in it has been taken from a run rather than from a previous entry":

| docs/FEATURES.md says | measured |
|---|---|
| **623 cases across 38 spec files** (lines 580, 600, 747, 930, 972) | **689 in 43** |
| **2974 tests in 148 files** (line 943, §7.4) | **3143 in 159** |

These were already stale before this change (baseline 667/41 and 3085/155); this change added 58
tests and 2 spec files without touching them, while editing 200 lines above them.

---

## 9. Findings (FAIL, ordered)

1. **IMP-002 clause 1 and clause 3 are unmet and the skip is not recorded as such.**
   `Reset all edits` — an undoable but genuinely destructive action named twice by the spec — does
   not go through `confirmDestructive` (`Editor.tsx:612` calls `reset()` directly), and neither do
   `Discard session`, `Delete preset`, `Clear strokes`, `Delete layer`, `Remove frame`, or
   `RouteError`'s "Start over". `reset()` does push an undo entry, so the spec's branch (a) is the
   truthful one and the wiring is trivial.
   *Action:* route `onReset` through the primitive (a three-line change) or renounce clauses 1 and
   3 in writing as "New image only, this pass", and mark the backlog rows accordingly.
2. **`docs/FEATURES.md` counts are wrong in six places** (623/38 and 2974/148 vs 689/43 and
   3143/159), in a file whose stated rule is that a count comes from a run. *Action:* refresh
   header, §5 index, §6, §7.4 and §8 in the same pass that adds the row for this feature.
3. **Four false claims about their own code.**
   (a) `Editor.tsx:392-395` and `EditorNewImage.test.tsx:270-273` justify clearing both copies with
   "`resolveResumableSession` only adopts a mirror when the row it shadows exists" — which is a
   statement about the *harmless* direction (row deleted, mirror kept → nothing is offered); the
   resurrection vector is the row surviving alone. Same muddle in `forget.test.ts:12-16`'s header
   (whose own case at line 102 gets it right) and in the report.
   (b) `Editor.tsx:388` and `autosave.ts`'s new `cancel()` comment: "the replacement overwrites
   whatever lands" / "the next write lands over whatever the old one commits" is **false**. After a
   replacement the autosave effect returns early (`if (!source) return`), so nothing is scheduled
   at all; an in-flight old write that lands *after* `forgetStoredDocument()` resurrects the old
   row and the old mirror and no later write overwrites it. Untestable-to-hit in a test, but a
   false invariant in a comment on a data-loss path. *Action:* say "a write already dispatched
   cannot be recalled; the window is the length of one IndexedDB transaction."
   (c) `EditorNewImage.test.tsx:257-259` claims consecutive edits of one control coalesce into one
   undo step, and the report repeats it as a headline judgement call ("three nudges of Exposure say
   '1 edit'", `impl-headline.md:56`). Measured in the browser: **three `ArrowRight` presses on
   Exposure in 12 ms produced three undo steps** (`past` 6→9, and 12 after three more), because
   `AdjustPanel.tsx:102-103` brackets each slider interaction with `beginInteraction`/
   `endInteraction`, so every key press is its own span and coalescing never applies to it. The
   number the dialog shows (`past.length`) is still correct and Undo-checkable — and
   `editorEntry.ts:118-131` says exactly that, correctly; only the test comment and the report are
   wrong.
   (d) `Hub.test.tsx:320` and the report both claim the editor answers from `HUB_DOORS`; it does
   not. `HUB_DOORS` has no runtime consumer at all.
4. **`journey.hub-reentry.spec.ts:75`'s title is false**: "two Hub entries in one session open two
   different photographs". Both Hub entries in that case open the same photograph (its third
   assertion says so). The second source came from the import screen. Rename to what it proves, and
   record IMP-005 clause 3 as partial.
5. **The quiet (pristine) path drops focus to `<body>`.** Minor, but it is the keyboard path for
   the most common use of the new control, and the confirming path gets this right.
6. **`.confirmPanel:focus { outline: none }`** (inherited from `.helpPanel`) leaves a stop in the
   trap cycle with no visible focus indicator. Latent in both modals; `e2e/a11y.spec.ts` does not
   catch it because its focus-visible scan does not land on the panel.
7. **Undisclosed items, and two numbers in the report that do not match a run.** IMP-006
   clause 4 (met by pre-existing `attachUnloadFlush`) and IMP-005 clause 3 (partial) appear nowhere
   in the report. The e2e figure (687) is 2 short of the 689 the suite actually contains, and the
   "0 failed" did not reproduce on my first full run — one load-sensitive WebKit flake in
   `journey.onboarding.spec.ts:182`, which passes alone and passes on a full-project re-run.

Non-findings, for the record: no scope creep, no debug leftovers, no `AGENTS.md` invariant broken,
no fixture weakening, `readDoc()` not simplified, `ALLOWED` still empty, entry bundle unchanged at
38.2 kB / 237.4 kB eager, `src/pages` coverage up on all four metrics, and the load-bearing
reload property verified in a real browser inside the debounce window.

---

## 10. What I touched, and what I restored

Modified and restored byte-for-byte (sha256 verified):

- `src/components/ui/focusTrap.ts` — mutation (trapTab → no-op) → `ff71991abefcd7d720fed91737ec04990ccefcb6f8ac577bec233e5b2cb6170a`
- `src/pages/Editor.tsx` — mutation (dropped `forgetStoredDocument()`) → `dba8b3edbf0103c3607e6850e91d89504902490aa61620853ed306b4a67badd3`

Not modified: everything else. `git status --porcelain` is byte-identical to the state I found it in
(21 modified + 12 untracked). Side effects of running the gates, all gitignored:
`dist/`, `coverage/`, `test-results/`, `playwright-report/`. New files I added, all under the
gitignored `.improve/artifacts/`: the ten screenshots in
`.improve/artifacts/headline/verify/` and this report.
