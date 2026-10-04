# verify-IMP-041 — independent review

Item **IMP-041** ("Move the crop readout out of the crop frame"), uncommitted on
`improve/auto-20261004`. Reviewed 2026-10-04 against `.improve/FEATURES.md`
lines 719–732 (the acceptance criteria), `.improve/REPO_PROFILE.md` and `AGENTS.md`.

**VERDICT: PASS.** All five acceptance criteria are met, and I measured each one
myself in Chromium. Two disclosures below are not criterion failures but must not
be lost: the report understates the preview cost in *area* terms by roughly half
again, and a **pre-existing** fixed error panel still occludes three of the four
handles criterion 2 names, in a normal shipping state.

---

## 1. Criterion-by-criterion

| # | Acceptance criterion (contract) | Verdict | My evidence |
|---|---|---|---|
| 1 | No element that renders the crop dimension readout (`Reset crop`, `Perspective`, the `W × H px · R` line) has a `getBoundingClientRect()` with overlapping area against any of the eight crop handles. Same at 390 × 844 with the sheet open. | **MET** | 1280×800: all 8 handles × 3 readout parts = **0 px²**. 390×844 (sheet at `peek`, marginBottom 489.52px): all 8 × 3 = **0 px²**. Measured for `nw n ne e se s sw w`, not just the four named. |
| 2 | On the changed tree, overlap area between the readout rect and `Crop s handle` / `Crop n handle` / `Crop e handle` / `Crop w handle` is 0 px² at 1280×800 and at 390×844. | **MET** | `s`/`n`/`e`/`w` = 0 px² at both widths. Baseline for contrast: `s` = **560 px²** (28 × 20 — 71% of the handle's own 784 px² box), `se` 342, `sw` 342, all measured on the pre-change tree with the same code. |
| 3 | Focusing `Crop s handle` draws a focus indicator fully inside the handle's own 28 × 28 box — `outline-offset + outline-width <= 0`. | **MET** | After: `solid`, `3px`, `offset −3px`, sum **0**, colour `rgb(56, 178, 140)`. Before: `2px` at `offset +2px`, sum **4**, drawn at y 706.8–708.8 while the readout pill spans y 697.6–724.8 → the ring was **entirely** inside the caption. Confirmed visually in `crop-before-zoom.png` (top half of the ring buried) vs `crop-after-zoom.png` (unbroken ring). |
| 4 | `.canvas` takes the readout as a sibling row below `.canvasStage`, and `.canvasStage` is the box `useRenderLoop` appends the canvas to and `CropOverlay` fills — not merely a `z-index` or `pointer-events` change. | **MET** | `EditorCanvas.tsx:252` `.canvasStage` carries `ref={containerRef}` and holds `CropOverlay`/`LayerTransformOverlay`; `EditorCanvas.tsx:271–273` renders `CropReadout` as a **sibling** of `.canvasStage` inside `.canvas`. `CropOverlay` measures `rootRef` = `.overlay` (`inset: 0` of the stage) and calls the same `cropFrameFit()`. Verified live: row `position: static`, `parentElement.className === '_canvas_qsa50_1'`, frame box **identical** to the canvas element box (0 px drift) at both widths. |
| 5 | A case in `e2e/journey.crop.spec.ts` asserts `document.elementFromPoint(cx, cy)` at the centre of each of the four edge-centre handles returns the handle or a descendant — never the readout or a sibling — on **both** the chromium and webkit projects, neither skipped. | **MET** | `e2e/journey.crop.spec.ts:211–246`. Two viewport cases in a `for` loop (so both widths run on both engines), `answerAtCentre()` at `:57`, no `skip`/`fixme`/`only` anywhere in the file. `npx playwright test --list` = **667 tests in 41 files** (baseline 659) and `journey.crop.spec.ts` alone = **14 passed** on chromium+webkit. The section is the real engine, not jsdom. |
| 6 (extra) | *Verification method.* The claim has to be executable in a real browser, not jsdom. | **MET** | New e2e uses `boundingBox()` + `elementFromPoint`; new jsdom test asserts **structure** only and says so in its own comment (`CropOverlay.test.tsx:120–126`). I re-measured everything in Chromium; see §4. |
| 7 (extra) | No `Doc` field added; `history.ts` stays import-free; no appearance value enters `Doc`. | **MET** | `git diff` touches no file under `src/model/`. `src/store/history.ts` not in the diff and still zero imports. `perspectiveOn` is `useState` in `EditorCanvas.tsx:49` — component state, never a `Doc` field; `FRAME_PADDING` is a constant. |
| 8 (extra) | Scope discipline. | **MET with one exception** | See §3. The one exception is `.improve/PROGRESS.log`, which is outside the item's declared file list and is **corrupted**. |

---

## 2. Commands I ran

Every shell command was prefixed with
`export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.

| Command | Result |
|---|---|
| `npm run typecheck` | **green** (exit 0) |
| `npm run lint` | **green** (exit 0, no output) |
| `npx prettier --check .` | **green** — "All matched files use Prettier code style!" |
| `npm test` | **green** — **Tests 3069 passed (3069)**, **Test Files 154 passed (154)** |
| `npm run build` | **green** (exit 0; `assets:check` + `tsc -b` + vite build + bundle + public budget, 1725.3 kB of an 8.00 MB budget) |
| `npm run test:coverage` | **green** — 154 files / 3069 tests, no threshold error. Per-area branches from `coverage/coverage-summary.json`: `src/pages` **51.30%** (59/115) vs the 48 threshold; `src/components` 79.82%; `src/lib` 86.65%; all 81.43% |
| `npx playwright test --list` | **667 tests in 41 files** (baseline 659/41 → **+8 cases**, = 4 new tests × chromium+webkit; the mobile project does not own this file) |
| `npx playwright test e2e/journey.crop.spec.ts` | **14 passed** |
| `npx playwright test <9 touched-area specs>` (crop, crop-preview, crop-shapes, layout-measure, inspector-layout, responsive, passport-document, mobile, mobile-touch; all 3 projects) | **141 passed (2.6m)**, 0 failed |
| `git diff --stat` | 7 files, **485 insertions / 120 deletions** + 2 untracked source files |

**New test count: 3069 in 154 files.** Baseline 3060 in 153. The implementer's
claim is exact.

Browser console: **0 errors** in both viewports after load → Crop → focus →
drag → Perspective → Reset. The only warning is the pre-existing React Router
`v7_startTransition` future-flag notice.

---

## 3. Diff review — scope creep, leftovers, invariants

**Clean.** No `console.log`, `debugger`, `TODO`, `FIXME`, `@ts-ignore`, commented-out
code, secrets, or dead code in the diff or in the two new files (`git diff -U0 |
grep -E "console\.(log|debug)|debugger|TODO|FIXME"` → nothing; same grep on
`frameFit.ts` / `frameFit.test.ts` → nothing).

Store writes still go through `src/store/actions.ts`: `CropOverlay.tsx:3` imports
`nudgePerspectiveCorner, resetPerspective, setCrop`, and `resetPerspective` is
`actions.ts:601`. No component calls `setState` on the doc.

Changes beyond the strict minimum, each disclosed in `impl-IMP-041.md` and each
justified by code I read:

- **`LayerTransformOverlay` moved inside `.canvasStage`** (`EditorCanvas.tsx:259`).
  Behaviourally inert: the readout row only exists while `activeTool === 'crop'`,
  and the overlay only renders when `activeTool !== 'crop'`. The existing comment
  at `:231–241` already argues both overlays must observe the same box. **Justified.**
- **`.handle:focus-visible` inset ring** (`canvas.module.css:222–225`). Required by
  criterion 3; an outline is always painted outside its element. **Justified.**
- **`perspectiveOn` lifted to `EditorCanvas.tsx:49–54`.** Forced by criterion 4: the
  toggle (readout) and the quad (overlay) must be siblings, so the state cannot live
  inside either. It uses React's documented adjust-during-render form rather than an
  effect. Reset-on-tool-close is **exactly equivalent** to the old unmount reset,
  because `CropOverlay` unmounts iff `activeTool !== 'crop'`. **Justified.**
- **`src/lib/crop/frameFit.ts`** — a 38-line module for ~6 lines of arithmetic.
  Over-engineered in isolation, but `AGENTS.md` rule 5 wants pure logic in `src/lib`,
  and it is the only mechanism that keeps the canvas fit and the overlay fit from
  drifting (the thing that would put every corner handle on the wrong pixel).
  **Justified.**

### Two findings that are not criterion failures

**(a) `.improve/PROGRESS.log` is corrupted, and the item is not logged as done.**
The file declares itself "Append-only". It had no trailing newline, so the append
concatenated onto the previous line. `PROGRESS.log:3` now reads:

```
2026-10-04T00:32Z | RECON | launched recon-journeys, … | -2026-10-04T00:30Z | SETUP | branch improve/auto-20261004 from main@10ade26, pre-push guard, state dir | -
```

— a duplicated fragment of line 2 glued to line 3's tail. There is also **no `DONE`
entry**: the last line is `IMP-041 | IN-PROGRESS`. This file is outside the item's
declared file list. *Action: repair line 3 and append the completion line.*

**(b) `frameFit.test.ts:31–37` cannot fail for the reason it names.**
`it('reserves the same padding on both axes, which is what keeps the two in step')`
asserts only `fit.width === fit.height` for a **square** input. With asymmetric
padding — `width − 32` but `height − 0` — the fit is still `600 × 600` and the
assertion still passes. So the case named "same padding on both axes" pins nothing
about padding. The property *is* pinned, correctly, by
`frameFit.test.ts:17` (`expect(portrait.height).toBe(600 - 2 * FRAME_PADDING)`);
this third case is redundant and its title overstates it. *Action: retitle it, or
assert the asymmetric case explicitly to prove it.*

---

## 4. Preview size, measured before and after (real browser, Chromium 141.0.6934.0)

BEFORE was measured by `git stash push` of the four source files (keeping the tests),
hard-reloading, and re-running the identical measurement code. **All source was
restored afterwards — see §6.**

### 1280 × 800, default appearance

| | BEFORE | AFTER | Δ |
|---|---|---|---|
| canvas element | **430.81 × 650.80** @ (244.6, 68) | **397.52 × 600.50** @ (261.24, 68) | −7.74% w, −7.73% h |
| canvas element **area** | **280 371 px²** | **238 647 px²** | **−14.9%** |
| overlay frame | 430.81 × 650.80 @ (244.6, 68) | 397.52 × 600.50 @ (261.24, 68) | drift 0 px either way |
| `.canvasStage` | — | 920 × 632.5 | — |
| readout row | n/a (absolute, over the frame) | 920 × 44 @ y 684.5 | — |
| `s` handle ↔ readout | **560 px²** | **0** | fixed |
| `s` focus ring vs readout rect | ring **inside** the caption | ring inside the handle | fixed |
| `elementFromPoint`, all 8 handles | the handle | the handle | — |

### 390 × 844, default appearance, Crop sheet at `peek`

| | BEFORE | AFTER | Δ |
|---|---|---|---|
| canvas element | **135.89 × 205.28** @ (127.1, 68) | **107.30 × 162.09** @ (141.4, 68) | −21.0% w, −21.0% h |
| canvas element **area** | **27 894 px²** | **17 393 px²** | **−37.6%** |
| `.canvas` | 236 × 390 | 237.29 × 390 | +1.3 px |
| readout row | — | 390 × **43.2** (one line) | 18.2% of `.canvas` |
| `s` ↔ readout | **560 px²** | **0** | fixed |
| `se` / `sw` ↔ readout | 342 / 342 px² | 0 / 0 | fixed |
| `elementFromPoint`, all 8 handles | the handle | the handle | — |

### The report's mobile figure is right; its framing understates the cost

`impl-IMP-041.md` reports "136 → 107 px (−21%)". My measurement reproduces
**135.89 → 107.30 (−21.0%)** exactly, so the number is not wrong. But a percentage of
one axis is not the cost. On the same sample the **area** of the crop preview — the
thing you are judging your crop against — falls **37.6%** on a phone, and the report's
own desktop row ("−7.4%") is **−14.9%** in area. Both costs are understated by about
half again.

### Is the shrink unavoidable? Mostly yes, with one avoidable factor

**Unavoidable part.** The readout cannot live inside `.canvasStage`, and the reason is
structural, not stylistic, and I checked it: `useRenderLoop.ts:320` fits the output
into the ResizeObserver-measured `.canvasStage` (`useRenderLoop.ts:303–310`), and
`CropOverlay.tsx:490` fits into its own `rootRef`, which is `.overlay { inset: 0 }` of
that same stage. Give the readout space *inside* the overlay and the overlay's box
diverges from the canvas element's box — which is precisely how a crop handle ends up
on the wrong pixel. `discovered-IMP-041.md` §4 documents this correctly. So a row of
`.canvas` is the right shape, and 32 px of `FRAME_PADDING` symmetric on both axes is
the correct shared arithmetic (`frameFit.ts`).

**The avoidable factor: the row wraps at large text.** At
`textScale: "xlarge"` (1.25) with `density: "roomy"` — a legitimate, persisted
`localStorage` appearance setting, not a hypothetical — the row becomes
**83.2 px on two lines** and the canvas element collapses to **76.64 × 115.78**.
Against BEFORE that is **−43.6% per axis, −68% in area.** The wrap is caused by a
**2.4 px shortfall**:

```
86.89 (Reset crop) + 8 + 92.98 (Perspective) + 8 + 172.52 (dims) + 24 (padding) = 392.4  >  390
```

At default text scale the dims pill is 142.02 px wide and the row is 338 px — fits. At
1.25 it is 172.52 px and the row is 392.4 px — wraps. This falsifies the premise stated
in the CSS comment at `canvas.module.css:125–126` ("only wrap … onto the `exports …`
suffix, which is the only part that grows") and the report's "one line, 43 px"
statement, both of which are true only at default text size. Nothing in the diff or
the e2e measures the readout at a non-default text scale.

**My judgement: I accept the shrink, and I do not accept the wrap.** Trading ~15% of
desktop preview area and ~38% of mobile preview area for a fully grabbable `s` handle
and an unoccluded focus ring is a reasonable trade — the preview is still 107 × 162
and the crop is still exact. But a 2.4 px shortfall doubling the row and taking a
further 28% of the phone preview is a layout fragility, not a design decision, and it
has nothing to do with the defect being fixed. Cheapest fixes, any one of which removes
it: drop `.cropReadout`'s horizontal padding at `<900px`, or move `gap` into the
buttons' margin, or let the dims pill shrink (`min-width: 0` + `flex-shrink`), or
accept two lines deliberately and size the stage against it.

---

## 5. Concern 3 — the `dismissErrorLog()` workaround

I did not take the implementer's word for this. I reproduced the panel in Chromium
with **no test fixture and no WebKit** by pushing one error toast through the live
store (`useUiStore.getState().pushToast('Could not save this session', 'error')`),
then measured. At 390 × 844, post-change, default appearance:

```
panel ("Recent problems", role=region) : x 20, y 64, 358 × 129.2
```

| handle | box | overlap with panel | `elementFromPoint` at centre |
|---|---|---|---|
| `nw` | 127.4, 54, 28×28 | **504 px²** | `DIV._savedErrors_…` |
| `n` | 181, 54, 28×28 | **504 px²** | `DIV._savedErrors_…` |
| `ne` | 234.6, 54, 28×28 | **504 px²** | `DIV._savedErrors_…` |
| `e` | 234.6, 135, 28×28 | **784 px² (100%)** | `DIV._savedErrors_…` |
| `w` | 127.4, 135, 28×28 | **784 px² (100%)** | `BUTTON._savedErrorClear_…` |
| `se` / `s` / `sw` | 216.1, 28×28 | 0 | the handle |

So yes: the fixed panel **genuinely occludes a handle** — in fact **three of the four
handles acceptance criterion 2 names** (`n`, `e`, `w`), two of them completely. `s`
escapes only because the panel ends at y 193.2.

**But it is not a suppression, and it is not this item's defect.** Three reasons:

1. **It is pre-existing, and this change does not touch it.** The diff modifies no
   file under `src/components/controls/` or `src/components/ui/`. `.toastStack` is
   still `position: fixed; top: calc(var(--ie-topbar-height) + var(--space-3))`
   (`controls.module.css:526–535`, right-aligned below 900px), and `.savedErrors`
   still takes `pointer-events: auto` because its own "Delete these" button needs it.
   On the BEFORE tree the `n` handle was at y 54–82 and `e`/`w` at y 156.6–184.6 —
   all inside y 64–193.2. The change neither creates nor worsens it; the frame sits
   16 px below the stage top either way, because `FRAME_PADDING` is symmetric.
2. **Criterion 5's prohibition is scoped to the readout.** Its text reads "never *the
   readout* or a sibling". An unrelated diagnostics panel is a different element with a
   different cause (a failed IndexedDB write — quota, private browsing, storage
   disabled). Every user with a recorded error can hit it, but that is a separate bug.
3. **The workaround is an honest, user-reachable button press, not a suppression.** It
   clicks "Delete these", then asserts `toHaveCount(0)` so it fails loudly if the panel
   refuses to clear. It skips nothing and soft-asserts nothing. `discovered-IMP-041.md`
   §1 and §2 write the defect up with rects and say explicitly that it is not fixed here.

**Honest verdict on the workaround: legitimate test setup, not suppression — with a
required follow-up.** The gate still bites (§6 proves it). But the shipping UI does
**not** satisfy criterion 5 whenever any error has been recorded, and the report never
mentions this when discussing cost or completeness. That is a **new backlog item**
(`Recent problems` panel is `position: fixed` over the canvas and takes
`pointer-events`), and it is the same class as IMP-041, so it should be filed rather
than left in a discovered-note. It is not grounds to fail IMP-041, whose five
criteria are all met.

---

## 6. Concern 1 — the `useRenderLoop.ts` blast radius, and concern 4 — do the tests bite?

### Blast radius: every change to `useRenderLoop.ts` justified

The whole diff to that file is **+6/−5 lines**: one import, and
`applyLayout` replacing four lines of arithmetic with `cropFrameFit(output, containerSize)`.

- `containerSize.width - 32` → `containerSize.width - 2 * FRAME_PADDING` where
  `FRAME_PADDING = 16`. **Arithmetically identical.** No backend-selection, rAF-loop,
  frame-keying or context-loss code was touched: `swapBackend`, `onLost`,
  `contextRetryDelay`, `shouldRenderFrame`/`frameKey`, `invalidate`, `schedule` and the
  effect deps `[source, containerRef, enginePreference]` are all unchanged.
- The `containerRef` **target** moved from `.canvas` to `.canvasStage` (done in
  `EditorCanvas.tsx`, not in the hook). Safe because both are unconditionally mounted
  and the ref object identity is stable, so the effect does not re-run; and
  `resizeObserver.observe(container)` measures the new box.
- `.canvas :global(.ie-canvas-el)` (`canvas.module.css:40`) is a **descendant** rule, so
  the appended canvas is still positioned `absolute; top/left 50%; translate(-50%,-50%)`
  against its new parent. `.overlay`'s `z-index: calc(var(--z-canvas) + 1)` still
  paints above it. **Verified**: `.canvas` (column flex) → `.canvasStage` (`flex: 1`)
  → `containerRef`. Correct.
- **The preview/overlay desynchronisation risk is real and it does not happen.** I
  measured `canvas.ie-canvas-el` and `.imageFrame` side by side in a live browser at
  both widths: **identical boxes, 0 px drift** (1280: both 261.24, 68, 397.52 × 600.50;
  390: both 141.4, 68, 107.30 × 162.09).

**Live drag-tracking check** (1280×800, `s` handle, 10 samples): the crop box's bottom
edge equalled the pointer's y at **every** sample to 0.1 px (652.1 → 504.5 px, crop box
652.1 → 504.5), and the readout updated live each frame
(`1271 × 1868 px · 0.68:1` → `1271 × 1396 px · 0.91:1`). The canvas element's own box
stayed at 668.5 throughout, as it should.

**Other live checks, 1280×800:** the thirds grid still computes
`background-size: 33.333% 33.333%`. Aspect lock `1:1` held the dragged box at
ratio **1.0000** exactly. `Reset crop` restored `1271 × 1920 px · 2:3` after a drag.
`Perspective` went `aria-pressed` false → true and raised the `<polygon>` quad plus a
`Reset perspective` button. With Perspective on, the row grows to two lines (buttons +
hint) and the stage shrinks with it — still no overlap, still 0 px drift, and it looks
deliberately laid out rather than broken.

*Aside for the record:* the app has **no thirds-snapping feature** — `grep -rn "snap"
src/lib/crop/ src/components/canvas/CropOverlay.tsx` returns nothing. What exists is the
thirds **grid** and aspect-ratio locking. Both verified working.

### Do the tests bite? Yes — proved by mutation

**Procedure.** I mutated the source to put the readout back over the frame: moved
`<CropReadout>` inside `.canvasStage` in `EditorCanvas.tsx` and made `.cropReadout`
`position: absolute; bottom: 10px; left: 50%`. Confirmed live in the browser first:
`rowParent === '_canvasStage_'`, `position: absolute`, canvas back to 135.9 × 205.3,
and the original defect reproduced exactly — `s` ↔ readout **560 px²**, `se`/`sw`
342 px².

**Result: 4 failed / 3 passed.**

```
Error: the readout overlaps Crop s handle at 390 × 844
Error: Perspective overlaps Crop s handle at 1280 × 800
  [chromium] › no edge handle shares any area with the readout at 1280 × 800
  [chromium] › no edge handle shares any area with the readout at 390 × 844
  [chromium] › the readout still reports the crop, and both overlay buttons still work
  [chromium] › Reset crop restores the full frame          ← a pre-existing case, also red
```

The last line matters: moving the readout back breaks a test that predates this item, so
the new arrangement is load-bearing rather than decorative. And the two overlap cases
fail on **the readout's own pixel arithmetic**, not on the panels — the assertion has
real teeth.

**Unit tests are real too.** `frameFit.test.ts` asserts values
(`toBe(600 - 2 * FRAME_PADDING)`, `toBeCloseTo(..., 9)`, `toEqual`) rather than "did not
throw", and each is falsifiable — except the one case flagged in §3(b).
`CropOverlay.test.tsx`'s new cases assert **structure** (`overlayEl().contains(readout)
=== false`, the two as siblings, the two buttons present by name), and the file's own
comment says plainly that jsdom cannot measure layout and that the e2e does that. That
is the right division of labour.

### Source restoration — exact, and I am stating it plainly

I modified source twice, and restored it exactly both times:

1. **Before-measurement**: `git stash push` of the four source files; then
   `git stash pop`. Diffstat after the pop matched my baseline capture exactly.
2. **Mutation test**: edited `EditorCanvas.tsx` and `canvas.module.css`, then restored.
   **My first restore attempt used `git checkout --`, which reverted them to `HEAD` —
   the pre-change state — destroying the implementer's version.** I recovered it from
   the dropped stash commit `ba3b68d` (found via `git fsck --unreachable`) and re-applied
   it with `git checkout ba3b68d -- <files>`. The result is verified: `git diff --stat`
   reads **7 files, 485 insertions, 120 deletions** — byte-identical to the diffstat I
   captured before touching anything — and spot checks confirm `.cropReadout` is back to
   `flex: none; padding: 6px 12px` with `position: static`, `parentElement.className ===
   '_canvas_qsa50_1'`, and `CropReadout` rendered after `</div>` at
   `EditorCanvas.tsx:271–273`.

**Post-restore re-verification:** `prettier --check` green, `typecheck` green, `lint`
green, `npx playwright test e2e/journey.crop.spec.ts` **14 passed**, and a fresh browser
load confirming `0 px drift`, `position: static`, `readoutRow 390 × 43.2`,
`1271 × 1920 px · 2:3`, 0 console errors. `git status --porcelain` lists exactly the 7
modified + 4 untracked files the implementer left. I also removed the `test-results/`
directory my failed mutation run created (gitignored).

---

## 7. Screenshots

All under `.improve/artifacts/IMP-041/verify/`. I looked at each with the read tool.

| file | what it shows |
|---|---|
| `desktop-1280-crop-after.png` | 1280×800, Crop open. Readout is a row under the frame; `s` handle clear at the bottom edge; no overlap. |
| `desktop-1280-s-handle-focused.png` | `s` handle focused — unbroken 3px ring inside its own box. |
| `crop-after-zoom.png` | 4× zoom of the above: ring complete, 2px clear of the readout row. |
| `desktop-1280-BEFORE-s-handle-focused.png` | Same, pre-change tree, `Tab` then focus. |
| `crop-before-zoom.png` | 4× zoom of the above: the caption cuts the ring **in half**. Compare with `crop-after-zoom.png` — this is the defect, and the fix. |
| `desktop-1280-perspective-on.png` | Perspective on: row wraps to two lines (buttons + hint), stage shrinks, still 0 drift, no overlap. |
| `mobile-390-crop-after.png` | 390×844, sheet at `peek`. `s` handle fully visible and clear of the readout row. |
| `mobile-390-crop-restored.png` | Re-taken after the mutation revert, to prove the restored tree. |

**Baselines compared against:**
`.improve/artifacts/baseline/desktop-10-crop-readout-occludes-handle.png` — in the
baseline the `1271 × 1920 px · 2:3` pill straddles the `s` handle at the frame's
bottom-centre and only the handle's lower sliver is visible. In
`desktop-1280-crop-after.png` the same three controls now sit **below** the frame on the
canvas ground, left-to-right as `Reset crop`, `Perspective`, `1271 × 1920 px · 2:3`,
centred, with the handle unobstructed. The result reads as intentionally laid out: the
pill keeps its scrim and `border-radius`, the buttons keep their pill shape, and the
row is centred on the same axis as the frame rather than floating.

`.improve/artifacts/baseline/mobile-06-crop-sheet.png` — in the baseline the pill sits
directly on the frame's bottom edge. In `mobile-390-crop-after.png` the frame is
visibly **smaller** (107 px wide against 136), and the row is a single clean line under
it. Layout, alignment and contrast are all fine. The one thing that does **not** look
designed is the two-line wrap at large text scale described in §4, where the pill
abandons the buttons' line and centres alone on a second line.

---

## 8. Bottom line

The contract is met. The change is small, principled, honest about its own
discoveries, and its new e2e genuinely fails when the readout is moved back — which I
proved rather than assumed, and which also broke a pre-existing case. The
`useRenderLoop.ts` change is a six-line, arithmetically-identical extraction, the two
consumers of the crop fit are now one function, and the preview tracks the canvas
element with 0 px measured drift.

Three things must not be lost:

1. **Required follow-up (new backlog item):** the `position: fixed` "Recent problems"
   panel occludes `n`, `e` and `w` completely or partly at 390 × 844 in any browser
   after a save error. Pre-existing, same bug class as IMP-041, currently only a note.
2. **Fix the row wrap.** A 2.4 px shortfall at `textScale: xlarge` doubles the readout
   row to 83.2 px and takes a further 28% of the phone preview. Neither the CSS comment
   nor the report covers non-default text scale.
3. **Bookkeeping:** `.improve/PROGRESS.log` line 3 is corrupted by a newline-less
   append, and IMP-041 has no `DONE` entry.