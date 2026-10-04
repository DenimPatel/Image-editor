# IMP-042 — the mobile tool bar's horizontal-scroll affordance

**Attempt 2.** Attempt 1 was returned **FAIL**: criterion 1's left-edge half was unmet
at every scroll position that was neither end (the two-gradient `mask-image` list
composites under `mask-composite: add` to a fully opaque mask), and the e2e case
guarded it with a `count: 2` assertion on a *declaration string*, which is
structurally unable to see a mask that paints nothing.

All four required fixes are done. Not committed, per the brief. Work in the working
tree of `improve/auto-20261004`.

---

## 1. What changed since attempt 1

| # | Fix | File |
| --- | --- | --- |
| 1 | `.tabBarMoreStart.tabBarMoreEnd` is now **one four-stop gradient** — `transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%` — and the `mask-composite: add` comment that described the two-class scheme is replaced with one that says what `add` actually does | `src/components/editor/editor.module.css` |
| 2 | The `count: 2` declaration assertion is **gone**. At each of the three scroll positions the row is captured twice — as painted, and again with `mask-image: none !important` — and the two PNGs are decoded and differenced per column band, in three bands: left 40px, middle, right 40px | `e2e/journey.mobile.spec.ts` |
| 3 | The ≤480px metric change has **two** gates: four declaration pins in `responsiveLayout.test.ts`, and a new appearance-parameterised e2e case at `density: roomy` + `textScale: xlarge`, 390×844 | both |
| 4 | `e2e/journey.mobile.spec.ts:282` reverted to its committed locator | `e2e/journey.mobile.spec.ts` |

Files touched this attempt: `src/components/editor/editor.module.css`,
`e2e/journey.mobile.spec.ts`, `src/components/controls/responsiveLayout.test.ts`,
`.improve/reports/discovered-IMP-042.md` (new), this report. Nothing else.
`git diff --stat` is now **786 insertions / 34 deletions across 7 files** (attempt 1:
367/35 across 5); the seventh is `.improve/PROGRESS.log`, which is IMP-041's
commit-hash fixup and was already modified when this work started.

### 1a. The mask

```css
.tabBarMoreStart.tabBarMoreEnd {
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 32px,
    #000 calc(100% - 32px),
    transparent 100%
  );
}
```

The comment above it now says the thing that was wrong: `add` **unions the layers'
alpha**, so a two-item list of a leading fade and a trailing fade is a fully opaque
mask — each layer's opaque body fills in the other's transparent end — and both edges
stop fading at exactly the scroll positions that are the only ones needing both. The
`calc(100% - 32px)` stop is where the plateau between the two ramps ends.

The `forced-colors` fallback and `.chipRow`'s `.chipRowMore` are untouched. Verified
good by the verifier and deliberately not "improved": `ChipRow`'s predicate identity,
its byte-identical geometry, its blast radius, the touch behaviour, the WebKit mask and
the byte-identical desktop.

### 1b. The paint gate

`paintedEdges(page, nav, label)` in `e2e/journey.mobile.spec.ts`:

1. reads the row's box and `page.screenshot({ clip, scale: 'css', animations: 'disabled',
   caret: 'hide' })` — CSS pixels, because this project's device pixel factor is 2.625
   and a band boundary landing mid-pixel would sample both ramps and say nothing;
2. forces the mask off with an inline `!important`, **polls the computed `maskImage`
   until it is `none`**, captures again, removes the inline declaration, and **polls
   until the mask is back**;
3. decodes both PNGs *in the page* (`fetch` data URL → `createImageBitmap` →
   `OffscreenCanvas` → `getImageData`) and returns the worst per-channel delta in three
   bands.

Three properties make it a measurement rather than a tautology:

- the two captures are the **same box at the same scroll position**, so every byte of
  difference between them is the mask and nothing else;
- the **middle band is asserted quiet** — the mask is opaque between the two 32px ramps
  — so if the whole capture shifted for any other reason (a caret, an animation, a
  re-decode) the control would move with it and the edge numbers would be measuring the
  wrong thing;
- each position asserts **which** edge moved, so "present only while" is part of the
  claim rather than assumed.

`FADED = 8`, `QUIET = 1`, both from the measured populations (below), not chosen to pass.

The six captures are written to `.improve/artifacts/IMP-042/paint-{start,mid,end}-{masked,bare}.png`
(390×65 CSS px each).

The `fades()` shape read is **kept** beside it — now `count: 1` at mid-scroll, so a
two-item list cannot come back — but it is no longer the thing standing on its own.

### 1c. The two gates on the ≤480px metrics

`src/components/controls/responsiveLayout.test.ts` gains a `media(css, condition)`
helper (a tail slice answers with whichever `.tab` comes first in the file, which above
a desktop block is not the phone one) and four cases:

| Case | Pins |
| --- | --- |
| `snaps by proximity, not by mandate…` | `.tabBar` `scroll-snap-type: x proximity`, `.tab` `scroll-snap-align: start` |
| `tightens its own metrics for the width where the metrics have to fit` | `.tabBar` `gap: 2px`, `.tab` `min-width: calc(54px * var(--density-factor))`, `.tab` `padding: 4px 6px` |
| `fades both edges with one four-stop ramp…` | the exact four-stop `mask-image`, and **one** `linear-gradient` in it |
| `keeps the desktop bar at the metrics it has always had` | the base `.tabBar` `gap: 4px` and base `.tab` `min-width: calc(62px…)`, so the phone block cannot leak upward |

`scroll-padding-inline` is deliberately **not** pinned — it is a known defect, and a
gate that defends the wrong one of two spellings is worse than no gate. See
`discovered-IMP-042.md` §1.

The e2e case is
`IMP-042: the tool bar says that it scrolls › at roomy density and xlarge text the bar
says so before it runs out of row`. It sets appearance *before* loading the sample (a
reload after a sample is loaded lands on the import screen, because the app restores
from its own debounced `localStorage` mirror), asserts `data-density="roomy"` and
`data-text="xlarge"`, and then measures: still a scroller; thirteen tabs in order;
`Background`'s overhang ≤ 1; the next tool's `leading` inside the row; at least five
whole tools; and no tab whose own `labelOverflow` is over 1.

---

## 2. Measured, at the DEFAULT appearance, before and after

Attempt 1 and the verifier both quoted `roomy + xlarge`, because that is what the
baseline screenshot was captured at. The verifier established that the nine mobile
baselines are **not** at the default appearance, so both numbers are given here and the
default one is the one that counts for a reader who has changed nothing.
`discovered-IMP-042.md` §3 records the finding itself.

**Before** is measured by me as mutation B below — the ≤480px metrics deleted, the mask
and the snap left in place — which is the base stylesheet's geometry. **After** is the
shipped tree. Both read out of the running app at 390×844 by the same
`measureRow()` the new gate uses, on the `mobile` project.

| at 390×844, **default** appearance | before | after |
| --- | --- | --- |
| `clientWidth` / `scrollWidth` | 390 / **897** | 390 / **785** |
| max scroll | 507 | **395** |
| tools fully visible at `scrollLeft 0` | **5** — Crop…Background | **6** — Crop…Text |
| `Background` right edge | **356.77** (whole, 33.23px inside) | **316.77** (whole, 73.23px inside) |
| `Text` leading edge | 360.77 — inside the 32px fade band | 318.77 — outside it, so the fade covers a fresh sliver of `Draw` |
| `mask-image` | `none` | 1 gradient trailing / **1 four-stop ramp** mid / 1 leading |
| `scroll-snap-type` | `none` | `x proximity` |
| tab `labelOverflow`, all 13 | 0 | 0 |

The improvement at defaults is real but about a third of what `roomy + xlarge` shows,
so both:

| at 390×844, `roomy` + `xlarge` | before | after |
| --- | --- | --- |
| `clientWidth` / `scrollWidth` | 390 / **1019** | 390 / **899** |
| tools fully visible | **4** — `Background` bisected, rendering `Backgroun` | **5** — `Background` whole |
| `Background` right edge | **408.72** — 18.72px past the row | **365.72** |
| next tool's leading edge | 413 — off the row entirely | 367.72 |

Every one of these was reproduced independently: my `before` numbers match the
verifier's HEAD-at-default measurement to the decimal (897, 356.77, 5 whole), and my
mutation-B `roomy` + `xlarge` overhang reproduces 408.72 − 390 = **18.72** exactly.

### The paint measurement — the defect and the fix, both measured by me

Channel difference, 0..255, between the row captured as painted and captured with
`mask-image: none`, in three CSS-pixel bands. `mobile` project, 390×844, default
appearance.

| scroll position | left 40px | middle | right 40px |
| --- | --- | --- | --- |
| 0 (`.tabBarMoreEnd`) | **1** | 1 | **136** |
| 229, snapped (both classes) | **71** | 1 | **136** |
| 395 = max (`.tabBarMoreStart`) | **164** | 1 | **1** |

Before the fix, the middle row of that table was **1 / 1 / 1** — both edges painting
nothing — which is the defect, and which the old test could not see.

Two populations, cleanly separated: **136, 71, 136, 164** painted and **1** unpainted,
everywhere including the middle band on every position. `FADED = 8` sits eight times
over the noise floor and eight times under the weakest real fade; `QUIET = 1` *is* the
noise floor.

The desktop is untouched by construction: `.tabBarMoreStart.tabBarMoreEnd` needs both
affordance classes, `useScrollEdges` returns `STILL` whenever
`scrollWidth − clientWidth <= 1`, and the ≤480px media block is the only other thing this
attempt changed. Verifier-measured at 1280×800 as of attempt 1: `scrollWidth 1280 ==
clientWidth 1280`, `maskImage none`, `snapType none`, whole-page screenshot
md5-identical to HEAD at default *and* at `roomy` + `xlarge`.

---

## 3. Commands run, with results

Every command prefixed with `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.
The dev server on **5173 (PID 27068) was used and never killed**; `npx playwright test`
starts its own on 5317.

| Command | Result |
| --- | --- |
| `npm run typecheck` | **pass**, exit 0, no output — run after the CSS edit, after the e2e rewrite, and after the `responsiveLayout` edit |
| `npm run lint` | **pass**, zero errors zero warnings — run twice, after the e2e rewrite and after the `responsiveLayout` edit |
| `npx prettier --write src/components/controls/responsiveLayout.test.ts src/components/editor/editor.module.css e2e/journey.mobile.spec.ts` | **pass**, all three formatted, last run "unchanged" ×3 |
| `npx prettier --check .` | **pass** — "All matched files use Prettier code style!" |
| `npm test` | **pass** — `Test Files 155 passed (155)`, `Tests 3085 passed (3085)`. Baseline 3069/154; +16 over 8 in `responsiveLayout.test.ts` and +12 in `useScrollEdges.test.tsx` |
| `npx playwright test e2e/journey.mobile.spec.ts --project=mobile -g "IMP-042"` | **pass** — 2 tests. Run 5× during development (once green with temp measurement logging, once under mutation A, once under mutation A with the shape assertion removed, once under mutation B, once clean) |
| `npx playwright test e2e/journey.mobile.spec.ts e2e/journey.mobile-touch.spec.ts --project=mobile` | **pass** — **21 tests**, incl. both IMP-042 cases and `D7-F02: the import pending state` with its **committed** locator, confirming the revert at `:282` was unnecessary and safe (3.5s) |
| `npx playwright test e2e/journey.responsive.spec.ts --project=webkit` | **pass** — 19 tests |
| `npx playwright test e2e/journey.responsive.spec.ts --project=chromium` | **pass** — 19 tests (and 19 again under mutation B, which is the finding) |
| `npx vitest run src/components/controls/responsiveLayout.test.ts` | **pass** — 33 tests (was 29) |

---

## 4. Mutations, and that each one bites

Backups in `/tmp/imp042bak2`. Every file restored and re-hashed afterwards.

| # | Mutated | Gate | Result |
| --- | --- | --- | --- |
| **A** | `.tabBarMoreStart.tabBarMoreEnd` reverted to the two-item `mask-image` list | `responsiveLayout.test.ts` | **RED** — `× fades both edges with one four-stop ramp…`; expected the four-stop string, received `linear-gradient(to right, transparent 0, #000 32px), linear-gradient(to right, #000 calc(100% - 32px), transparent 100%)` |
| **A** | same | `journey.mobile.spec.ts --project=mobile -g IMP-042` | **RED** — `× every tool is reachable…` at the `fades` shape assertion, `count: 2` vs `count: 1` |
| **A′** | same, with the `fades` mid-scroll assertion **temporarily removed** so the paint gate is the only thing left | same | **RED** — `Error: the leading edge is not painted mid-scroll`, `Expected: >= 8`, **`Received: 1`**, at `journey.mobile.spec.ts:651`. **This is the proof the paint gate, on its own, sees the defect** — the verifier's defect table reads 1/1/1 at mid-scroll and this reproduces it |
| **B** | the ≤480px metrics deleted (`.tabBar` `gap`, `.tab` `min-width`, `.tab` `padding`) | `responsiveLayout.test.ts` | **RED** — `× tightens its own metrics for the width where the metrics have to fit`, `cannot find \`gap\`` |
| **B** | same | `journey.mobile.spec.ts --project=mobile -g IMP-042` | **RED** — `× at roomy density and xlarge text…`, `Error: Background is cut off by the edge`, `Expected: <= 1`, **`Received: 18.72`** |
| **B** | same | `journey.responsive.spec.ts --project=chromium` (19 cases) | **GREEN — did not bite.** Re-confirms the verifier's mutation 3: the metric change is invisible to every pre-existing browser gate |
| **B** | same, plus a read-out of the row at the default appearance | — | gave the *before* numbers in §2: `scrollWidth 897`, `Background` right edge 356.77, 5 whole tools |
| **C** | `scroll-snap-type: x proximity` deleted from the media query | `responsiveLayout.test.ts` | **RED** — `× snaps by proximity, not by mandate…`, `cannot find \`scroll-snap-type\`` |

Note on **A vs A′**: with both assertions in place, A trips the cheap shape check first
and the paint check is never reached. A′ is the run that matters — it is what shows the
*new* gate would have caught the defect on its own, which is the whole point of fix 2.

**Restore verification.** `md5 -q src/components/editor/editor.module.css` →
`bceec6f2145bcde8efd67a11e1f9c3ee` and `md5 -q e2e/journey.mobile.spec.ts` →
`473a9909f7d3b34b896f8f701e99006e`, both identical to the pre-mutation record;
`grep -c "MUTATION\|TEMPORARILY\|console.log"` is **0** in all three files this attempt
touches; `git diff --stat` shows the 786/34 above; `npm test` → 155 files / 3085 tests,
green. **Nothing was left mutated.**

---

## 5. Judgement calls

**A byte comparison is not a paint assertion, and a threshold-free one would have
repeated the original mistake.** "The two captures differ" is satisfied by one dithered
bit. So the assertion is on a decoded per-channel delta with a measured floor, *and* on
which edge moved, *and* on a quiet control band in the same capture. The thresholds are
in the file with the numbers they were derived from, so the next person can see the gap
they have to stay inside.

**Both gates for the metric change, not either.** The `responsiveLayout` pin is the one
that dies in a millisecond on a CI machine with no browser and it catches the exact
declarations. The appearance-parameterised e2e is the one that measures the consequence
(18.72px of overhang, a name arriving as `Backgroun`) rather than the intention, and it
is the first gate in this repository that fails when that block is deleted. Each catches
something the other does not.

**`scroll-padding-inline` deliberately unpinned.** It is a real defect — a shorthand
setting `scroll-padding-right` from the left inset, so the snap and the bar's own
`padding-right` disagree by a safe-area width in landscape. Pinning it would mean the
unit suite defends the wrong one of two spellings. Recorded in
`discovered-IMP-042.md` §1 and not fixed here.

**The paint gate is not run on WebKit.** The `mobile` project is Chromium-only by
construction (CDP touch). The defect reproduced on both engines and the fix is a
declaration, so the fix is engine-independent — but that is a measurement someone took,
not a gate that runs, and WebKit's dithering floor would have to be measured before a
`QUIET` there meant anything. Recorded in `discovered-IMP-042.md` §4.

**`.improve/FEATURES.md` and `docs/FEATURES.md` still untouched.** Attempt 1's reasoning
still holds for the implementer and the verifier's §8.3 names the gap: the backlog row
is still `TODO` and must be flipped when a human accepts this. Recorded in
`discovered-IMP-042.md` §5 rather than done, because it is the coordinator's call, not
this item's.

**Unchanged from attempt 1 and still right:** the fade is a `mask-image` on the `nav`
rather than an overlay element (`position: relative` on `.tabBar` would start applying
this file's inert `z-index: 30` at 1280px); `proximity` rather than `mandatory` snap;
`flex: 0 0 auto` untouched so no label is ever narrower than its tab; no animation
introduced, so `prefers-reduced-motion` has nothing to override; nothing enters `Doc`,
history or IndexedDB; thirteen buttons in `TOOL_IDS` order with no fourteenth control.

**Not done, on purpose:** not committed; no `docs/FEATURES.md` row; no change to
`ChipRow.tsx`, `ToolTabBar.tsx`, `useScrollEdges.ts` or `LayerPanels.tsx`; no
re-measurement of any other backlog item's baseline number (recorded as §3 of
`discovered-IMP-042.md` instead).

## 6. Remaining uncertainty

1. **`QUIET = 1` is this engine's number.** Measured on Chromium's compositor at 390×844
   CSS-pixel scale. Every position, including the middle band, came out at exactly 1 —
   suspiciously exact, which suggests it is a quantisation floor rather than noise, but
   I did not chase where it comes from. If a future change moves the bar by a single
   level somewhere unrelated, this gate will fail and the message will point at the mask
   rather than at the real cause.
2. **The masks' two 32px ramps are hard-coded in three places** — the three CSS rules —
   and the test's band width is `40`, a third larger. If a ramp were widened past 40px
   the middle band would start including a fade and the quiet control would fail; the
   failure would be correct but the diagnosis would not be obvious from the message.
3. **`page.screenshot({ clip })` is the only paint probe here.** It reads the composited
   output, which is the claim, but it cannot say *why* two pixels differ. The
   `scroll-padding-inline` and `GlyphRow` findings above are both things this gate can
   see only as "nothing changed" rather than as a named defect.