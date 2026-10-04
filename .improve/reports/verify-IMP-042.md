# verify-IMP-042 — independent review

**Reviewer:** independent pass, branch `improve/auto-20261004`, working tree uncommitted.
**Date:** 2026-10-04. **Verdict: FAIL** — one acceptance criterion is unmet in the state that
matters most, and the test written to guard it is structurally unable to see it.

Everything below is a measurement or a command's output. Where I could not measure something
on `jsdom` I say so and used a real engine instead.

---

## 0. The finding, first

**With both `.tabBarMoreStart` and `.tabBarMoreEnd` on the `nav` — i.e. at every scroll position
that is neither 0 nor the maximum — the mask composites to fully opaque and NEITHER edge fades.**

`editor.module.css:272-273` justifies the two-gradient list with:

> `mask-composite` defaults to `add`, so the two edges are one list rather than one of them winning.

That is true of the *declaration* and false of the *result*. `add` composites the layers' alpha as
a union (source-over), so the trailing gradient's opaque middle (`#000 calc(100% - 32px)`) fills in
the leading gradient's transparent start, and the leading gradient's opaque body fills in the
trailing gradient's transparent end. The union of two opposite-edge fades is an opaque mask.

Proof, per-pixel, at `deviceScaleFactor: 6` (6 device px per CSS px), 390×844, default appearance,
comparing the `nav` painted with the class against the same `nav` with `mask-image: none`:

| scroll position | classes on the `nav` | left 150 CSS px, max channel delta | right 150 CSS px, max channel delta | verdict |
| --- | --- | --- | --- | --- |
| 0 | `tabBarMoreEnd` | 1 | **138** | trailing fade paints |
| 229 (snapped) | `tabBarMoreEnd tabBarMoreStart` | **1** | **1** | **neither edge fades** |
| 395 (= max) | `tabBarMoreStart` | **191** | 1 | leading fade paints |

Delta of 1/255 is nothing. Screenshots: `verify/cmp-mid-left-WITH.png` vs
`verify/cmp-mid-left-NONE.png` (identical to the eye), against
`verify/cmp-start-right-WITH.png` vs `cmp-start-right-NONE.png` and
`verify/cmp-end-left-WITH.png` vs `cmp-end-left-NONE.png` where the difference is obvious.

Criterion 1 reads: *"a right-edge `mask-image` fade … and **an equivalent left-edge fade once
`scrollLeft > 0`**."* At `scrollLeft === 395` that is satisfied only because the trailing fade has
already switched off. At `scrollLeft === 229` — the position a flick or a wheel actually parks on,
and every position between — the row carries **no affordance at all**.

**The fix is one declaration.** Replace the two-gradient list with a single four-stop gradient:

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

Measured, injected live into the running app at `scrollLeft 229`: left 150 CSS px max channel
delta **76** (was 1), right 150 CSS px max channel delta **138** (was 1). Both edges paint.
`verify/fix-mid-left.png` (no fade, uniform) vs `verify/fix-mid-left-AFTER.png` (the "B" of
Background dimmed) makes it visible. `mask-composite: intersect` on the existing list is the
equivalent alternative.

### Why the new e2e case cannot see this

`e2e/journey.mobile.spec.ts:360-364,425` derives the fades from the **resolved `mask-image`
string** by counting `linear-gradient` occurrences:

```ts
expect(fades(scrolled.mask)).toEqual({ count: 2, trailing: true, leading: true })
```

That is a statement about a declaration, not about paint. A mask that resolves to two gradients and
composites to nothing satisfies it exactly. So does a mask that resolves to two gradients and
composites to two fades — the assertion cannot distinguish the two, and the defect is invisible to
it. Any of these would have caught it:

- a pixel check: `nav.screenshot()` with the mask, then again with `mask-image: none`, and assert
  the bytes differ (the check I used, and the one `AGENTS.md`'s "jsdom computes no layout" warning
  is really about);
- asserting the single-gradient shape of the combined rule, so the two-gradient list cannot come
  back;
- asserting `getComputedStyle(nav).maskImage` contains **one** `linear-gradient` at mid-scroll.

Note this is the same trap the spec's own `opacity` wording was pointing at, and the deviation was
the right instinct for the wrong reason: an `opacity` assertion on the `nav` indeed could not fail,
but neither can a `mask-image`-string assertion detect a mask that paints nothing.

---

## 1. Criterion-by-criterion

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | 390×844: visible right-edge fade present only while `scrollLeft < scrollWidth − clientWidth`, **and an equivalent left-edge fade once `scrollLeft > 0`** | **PARTIAL — trailing MET, leading UNMET** | trailing paints (Δ138) at 0; leading paints (Δ191) at max; **both Δ1 — nothing paints — at mid-scroll on both engines** |
| 2 | `scrollSnapType` not `none` at ≤480px, and `mouse.wheel({deltaX})` lands on a tool boundary | **MET** | `scrollSnapType: "x proximity"`; wheel ΔX 200 → `scrollLeft 229`, `min abs(tab.left − 8px inset) = 0.41px` |
| 3 | no visible label clipped mid-word at `scrollLeft === 0`; `Background.right <= clientWidth + 1` | **MET** (measured at 6 appearance settings) | default **316.77**, roomy 339.17, roomy+large 351.38, roomy+xlarge **365.72**, default+xlarge 348.97, compact 297.16 — all ≤ 391. Before: roomy+xlarge **408.72**, bisected |
| 4 | desktop-invisible at 1280×800: 13 tools laid out, no fade, `scrollWidth <= clientWidth` | **MET** | `scrollWidth 1280 == clientWidth 1280`, `maskImage none`, `snapType none`; all 13 tab rects byte-identical to HEAD; whole-page screenshot **md5-identical** to HEAD at default *and* at roomy+xlarge |
| 5 | (extra) no `Doc`/history/appearance invariant broken | **MET** | diff touches no file under `src/model/`; `src/store/history.ts` still has 0 imports; no `density`/`textScale` string anywhere in `types.ts`/`defaults.ts`/`migrate.ts` |
| 6 | (extra) no `console.log`, `debugger`, `.only`, `.skip`, `TODO`, `FIXME` in the change | **MET** | grep over all 7 files: 0 hits |
| 7 | (extra) the ≤480px metric change is gated by a test | **UNMET** | mutation 3 survives unit + the entire `journey.responsive.spec.ts` on chromium — see §4 |

---

## 2. Commands run, with results

Every command prefixed with `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.

| Command | Result |
| --- | --- |
| `npm run typecheck` | **pass**, no output, exit 0 |
| `npm run lint` | **pass**, zero errors zero warnings |
| `npx prettier --check .` | **pass** — "All matched files use Prettier code style!" |
| `npm test` | **pass** — `Test Files 155 passed (155)`, `Tests 3081 passed (3081)`. Baseline 3069/154 confirmed as +12 in 1 new file. (Re-run after all mutations restored: identical.) |
| `npx playwright test e2e/journey.mobile.spec.ts e2e/journey.mobile-touch.spec.ts --project=mobile` | **pass** — 20 tests, incl. `IMP-042: the tool bar says that it scrolls › every tool is reachable, and both edges say what is past them (4.9s)` |
| `npx playwright test e2e/journey.responsive.spec.ts --project=webkit` | **pass** — 19 tests |
| `npx playwright test e2e/journey.responsive.spec.ts --project=chromium` | **pass** — 19 tests (run under mutation 3 as well: still 19 pass) |
| `npx playwright test e2e/a11y.spec.ts --project=chromium -g "forced"` | **pass** — 2 tests, incl. "the editor is clean in forced colours" |
| `npx playwright test e2e/journey.shell.spec.ts --project=chromium -g "forced"` | **pass** — 1 test |
| `git status --porcelain` | 6 modified + 3 untracked, exactly the files the brief lists (`.improve/PROGRESS.log` is IMP-041's commit-hash fixup, pre-existing) |

The dev server on **5173 (PID 27068) was used, never killed.** A second server was started in a
throwaway `git worktree` at `676b733` on **port 5399** to measure the pre-change geometry in the
same engine; it is still running and is disposable.

---

## 3. The three flagged concerns

### 3a. `ChipRow` blast radius — no behaviour change. Provable, not assumed.

Consumers of the shared shell: `ChipRow` itself (`src/components/controls/ChipRow.tsx:72`) and
`RatioChipRow` (`src/components/controls/RatioChip.tsx:309`), reached from `CropPanel.tsx:202,327,354`,
`PassportPanel.tsx:735`, and every adjustment/band/effect/preset row via `<ChipRow>`.

**By construction.** The old predicate was `overflowing && !scrolledToEnd`, where
`scrolledToEnd = max <= 1 || scrollLeft >= max - 1` and `overflowing = max > 1`. The new call site
is `overflowing && !afterEnd`, where `max <= 1` returns `STILL` (so `overflowing` false) and
`afterEnd = scrollLeft >= max - 1`. Identical for every input, including the `max <= 1` case.

**Measured.** Seven panels (Crop, Adjust, Passport, Export, Redact, Frame, Layers) × 2 scroll
positions, dumping every `[role="group"]`'s class, `clientWidth`/`scrollWidth`/`scrollLeft` and
resolved `mask-image`, run against 5399 (HEAD) and 5173 (changed): **`diff` is empty apart from my
own `###before`/`###after` label line.** Byte-identical at 1280×900 and at 390×844.

**Non-vacuous.** At both widths every chip row wraps and none overflows, so the fade path is
dormant. I forced it: injected `flex-wrap: nowrap` + `min-width: 160px` on every chip in the Crop
panel so 7 rows genuinely overflow (up to `scrollWidth 1508` vs `clientWidth 327`). With the fade
live, class/mask/scroll position at `scrollLeft 0`, `40`, `scrollWidth`, and after a `window.resize`
are **byte-identical between HEAD and the change** — `_rowMore_w3n2o_30` present at mid-scroll,
gone at the end, in both builds.

**Still gated.** Mutation 6 (`afterEnd` forced to `false`, so the trailing fade can never switch
off) fails `ChipRow.test.tsx` ×2, `RatioChip.test.tsx` ×1, `ToolTabBar.test.tsx` ×1 and
`useScrollEdges.test.tsx` ×3. The pre-existing chip-row tests now guard the shared module.

One drift note: `GlyphRow` in `src/components/tools/LayerPanels.tsx:177-195` still carries a
**third** copy of the measurement (`el.scrollWidth > el.clientWidth + 2` plus a `resize` listener).
The new hook's header says the measurement "lives here now", which is true of `ChipRowShell` and
`ToolTabBar` but not of `GlyphRow`. Documentation only; out of scope, worth a follow-up item.

### 3b. Touch snapping on the mobile project — not hijacked, nothing unreachable.

Driven with real CDP `Input.dispatchTouchEvent` on the Pixel 7 project (`hasTouch`, `isMobile`,
390×844), against the changed build.

| Gesture | Result |
| --- | --- |
| flick 200px | `scrollLeft 229` (a tab boundary; 5th tab's leading edge 8.09px from the 8px inset) |
| repeated flicks (≤6) | `scrollLeft 395 of max 395`, **shortfall 0.00px** |
| slow drag back 475px over 20 moves | `scrollLeft 0` — the start is reachable too |
| drag released at `max − 4` | snapped to `395` — a 4px shortfall still completes |
| small flicks from 0 | 10px→0, 20→56, 30→56, 40→56, 55→56, 70→112, 100→112, 140→168 |
| 6 cumulative 40px flicks | 56, 112, 168, 229, 311, 367 — walks tab by tab, lands exactly on max |
| tap `Export` (last tab) at the end | `aria-current="true"`; its box is `x 327.6..381.6`, wholly on screen |
| tap `Background` at `scrollLeft 0` | `aria-current="true"` |
| all 13 tabs, in order, pressed | `aria-current="true"` on each (the e2e case does this; it passes) |

The same holds at all five appearance settings: flick → snapped boundary, repeated flicks → exact
max, slow drag → exact 0, `Export` fully visible at the end in every one.

**Judgement:** the quantisation to tab boundaries is the *intended* effect of criterion 2 and is
what makes the affordance legible. A 10px nudge doing nothing is ordinary `proximity` behaviour,
not a trap, because a 20px nudge already advances a whole tab and the end is always exactly
reachable. No evidence of the scroll being hijacked.

I also checked the case most likely to break: **keyboard focus vs the snap.** Real `Tab` presses,
before vs after, 390×844:

| | partially-visible focused tabs | positions |
| --- | --- | --- |
| HEAD | 2 — `Text`, `Frame` | `scrollLeft` 0, 263, 507 |
| changed | 2 — `Draw`, `Layers` | `scrollLeft` 0, 229, 395 |

Same count, same pattern, different tabs. The partial-visibility is a pre-existing property of a
partially-clipped flex child at a scroller edge, not something the snap introduced. **No keyboard
regression.**

### 3c. WebKit and `mask-image` — the prefix question is fine; the fade is real on WebKit

The brief's hypothesis was that `-webkit-mask-image` might be missing. It is not: WebKit aliases
`mask-image` to `-webkit-mask-image`, and unprefixed `mask-image` has been supported since 15.4.
At 390×844 on `webkit`:

```
maskImage:     linear-gradient(to right, rgb(0,0,0) calc(100% - 32px), rgba(0,0,0,0) 100%)
webkitMaskImage: (identical)
```

Resolved style is not paint, so I proved paint two ways.

**Byte-level A/B of the whole `nav`**, with the fade class versus `mask-image: none`, at three
scroll positions:

| position | with-fade md5 | without-fade md5 | |
| --- | --- | --- | --- |
| start | `89852a6ee6b6` | `a113e126aed9` | **paints** |
| mid | `4dae0ec33f00` | `db91da37eb4a` | **paints** |
| end | `9265c406362b` | `282e95091b8f` | **paints** |

**Per-pixel** (`verify/cmp-*-WITH.png` vs `cmp-*-NONE.png`, 6× DPR, max channel delta over the
crop): start/right **138**, end/left **191**, and — the point — **mid/left 1 and mid/right 1 on
chromium**. WebKit shows the same mid-state behaviour; the defect in §0 is engine-independent.

Visually (`verify/z4-bar-webkit-a-start.png`, 4×): the trailing fade is there and it reads as
deliberate — "Text" dims towards the right edge and a sliver of "Draw" ghosts in. At
`roomy + xlarge` (`verify/z4-bar-roomyxlarge-webkit-a-start.png`) the same. Chromium and WebKit
renders are indistinguishable here.

**So WebKit is not a FAIL.** The engine is fine; the implementation is not.

---

## 4. Did the new tests bite? Six mutations, all restored exactly.

Backups taken first (`/tmp/imp042bak`), md5s recorded, every file restored and re-hashed after.

| # | Mutated | Gate | Result |
| --- | --- | --- | --- |
| 1 | `.tabBarMoreEnd` / `.tabBarMoreStart` / combined → `mask-image` deleted | `journey.mobile.spec.ts --project=mobile -g IMP-042` | **RED** — `expected {count:1,trailing:true,leading:false}, received {trailing:false}` at `:373` |
| 2 | `scroll-snap-type: x proximity` deleted | same | **RED** — `expect(start.snapType).not.toBe('none')` at `:390` |
| 3 | ≤480px `.tab { min-width: 54px×density; padding: 4px 6px }` and `.tabBar { gap: 2px }` reverted to base | same → **GREEN** | **DID NOT BITE** |
| 3b | same mutation | `journey.responsive.spec.ts --project=chromium` (19 tests) → **GREEN** | **DID NOT BITE** |
| 3c | same mutation | `responsiveLayout.test.ts` + `ToolTabBar.test.tsx` (42 tests) → **GREEN** | **DID NOT BITE** |
| 4 | `ToolTabBar.tsx` affordance classes removed | `ToolTabBar.test.tsx` | **RED** — 3 failed |
| 5 | `useScrollEdges.ts` tolerance `1` → `0`, `afterEnd >= max-1` → `>= max` | `useScrollEdges.test.tsx` | **RED** — 2 failed |
| 6 | `afterEnd` forced `false` | `ChipRow` + `RatioChip` + `ToolTabBar` + `useScrollEdges` | **RED** — 7 failed across 4 files |
| 7 | `journey.mobile.spec.ts:282` D7-F02 locator reverted to the original | `journey.mobile.spec.ts --project=mobile -g D7-F02` | **GREEN** — see §6 |

**Mutation 3 is the second finding.** The ≤480px metric tightening — a real restyle of the tool bar
at *every* phone width — is asserted by **nothing**. The reason is that the new e2e case runs at
default appearance, where the base metrics already put `Background.right` at 356.77, inside the
box. The metric change only matters at `roomy`/`xlarge`, and no case in this change visits those
settings for this claim. `responsiveLayout.test.ts:386` pins the **base** `.tab` `min-width`
(`calc(62px * var(--density-factor))`) and still passes, because the override is inside the media
query — as the implementer correctly noted, but "correctly noted" is not "pinned". AGENTS.md is
explicit: *"A row's `Status` is a claim about a test."* Here there is no row, and the CSS change
has no test.

Either add a `responsiveLayout.test.ts` case pinning the ≤480px `.tab` `min-width` / `padding` and
the `.tabBar` `gap`, or add an appearance-parameterised case to the IMP-042 e2e block that asserts
`Background` overhang ≤ 1 at `density: roomy, textScale: xlarge` (which is the appearance the
baseline screenshot was captured at, §7).

**Mutation 7** mutated three call sites, not one: my `str.replace` matched every occurrence of the
two-line pattern. All three were restored from the backup and the file re-hashed to
`7e3240104de2a4f3a9a4d3e6e0596e6f`. The D7-F02 test passed with the original locator, so the
change at `:282` was not needed.

**Restore verification.** All four mutated files re-hashed against the pre-mutation record:

```
9661928d510dc82f3a98810c6281f0a2  src/components/editor/editor.module.css
db35ef7c6e4aded221937fe2a0e85424  src/components/editor/ToolTabBar.tsx
c8c29143f44e5cdcb6bf5d50b71988ce  src/hooks/useScrollEdges.ts
7e3240104de2a4f3a9a4d3e6e0596e6f  e2e/journey.mobile.spec.ts
grep -rc MUTATION- src e2e  ->  0
git diff --stat -> the original 367 insertions / 35 deletions
npm test -> 155 files / 3081 tests, green
```

Nothing was left mutated.

---

## 5. Real-browser verification at both widths

All at `deviceScaleFactor: 1` so the images are 390×844 and 1280×800 CSS px.

### 390×844, after — tools visible and reachability

| appearance | `scrollWidth` | max scroll | tools **fully** visible at `scrollLeft 0` | `Background.right` | `Export` at the end |
| --- | --- | --- | --- | --- | --- |
| default | 785 | 395 | **6** — Crop, Adjust, Looks, Retouch, Background, Text | 316.77 | fully visible, tapped |
| roomy | 851 | 461 | 5 — Crop…Background | 339.17 | fully visible |
| roomy + large | 872 | 482 | 5 — Crop…Background | 351.38 | fully visible |
| roomy + xlarge | 899 | 509 | 5 — Crop…Background | 365.72 | fully visible |
| default + xlarge | 860 | 470 | 5 — Crop…Background | 348.97 | fully visible |
| compact | 733 | 343 | 7 — Crop…Draw | 297.16 | fully visible |

The affordance is **not** shown when there is nothing to scroll: at 1280×800 `maskImage` resolves
to `none`, and `useScrollEdges` returns `STILL` whenever `scrollWidth − clientWidth <= 1`
(mutation 5 pins the 1px tolerance).

### 390×844, before → after

| | before (HEAD) | after |
| --- | --- | --- |
| **default** `scrollWidth` / max scroll | 897 / 507 | **785 / 395** |
| **default** tools fully visible | **5** (6th, `Text`, partial) | **6** (7th, `Draw`, partial) |
| **default** `Background.right` | 356.77 (whole) | 316.77 (whole) |
| **roomy+xlarge** `scrollWidth` / max scroll | **1019** / 629 | **899 / 509** |
| **roomy+xlarge** tools fully visible | **4** — `Background` bisected at 408.72, rendering `Backgroun` | **5** — `Background` whole at 365.72 |
| `maskImage` | `none` at every width | 1 gradient trailing / 2 both / 1 leading — **but see §0: the "2 both" state paints nothing** |
| `scrollSnapType` | `none` | `x proximity` |
| console errors | none | none |

### 1280×800, no regression

```
after  : clientWidth 1280, scrollWidth 1280, maskImage none, snapType none,
         position static, zIndex 30, gap 4px, padding 6px 8px, 13 tabs
         Crop:8..76 Adjust:80..148 Looks:152..220 Retouch:224..292 Background:296..380
         Text:384..452 Draw:456..524 Stickers:528..596 Redact:600..668 Frame:672..740
         Layers:744..812 Passport:816..884 Export:888..956
before : identical, character for character
```

Whole-page screenshots, Adjust panel open: **`desk-after-roomyxlarge-Adjust.png` and
`desk-before-roomyxlarge-Adjust.png` are md5-identical** (`9dfce5b3978bd1875c4b632832502f36`).

Compared against `.improve/artifacts/baseline/desktop-11-adjust-panel.png`: the baseline's tab
pitch is 72px, which is the **default** density pitch; my `verify/desk-after-default-Adjust.png`
has the same 72px pitch and the same thirteen positions. The desktop bar is unchanged. (The panel
*body* differs — the baseline is scrolled down, which is IMP-045's known defect, not this change.)

### Does the fade look intentionally designed?

Yes at both engines and both appearances, and it is strong enough to read as "there is more here"
without hiding a label: `verify/z4-bar-chromium-a-start.png`, `z4-bar-webkit-a-start.png`,
`z4-bar-roomyxlarge-chromium-a-start.png`, `z4-bar-roomyxlarge-webkit-a-start.png`. It is
comparable in weight to the existing `.chipRowMore` fade, which is the right consistency call.

### Console

| engine | messages | errors |
| --- | --- | --- |
| chromium, before | 5 (vite ×2, React DevTools notice, React Router future-flag warning, one WebGL ReadPixels perf warning) | **0** |
| chromium, after | 5, the same five | **0** |
| webkit, before | 3 (vite ×2, React Router future-flag warning) | **0** |
| webkit, after | 3, the same three | **0** |

No new errors. (An earlier "Could not save this session" toast I saw came from my own throwaway
context opening two pages against one IndexedDB; it does not reproduce in a clean single-page
context on either engine, before or after.)

---

## 6. Scope creep and unrelated edits

The diff is 367 insertions / 35 deletions across 5 files plus `PROGRESS.log`. No secrets, no
debug output, no mass reformat, no `.only`/`.skip`.

**One unrelated edit.** `e2e/journey.mobile.spec.ts:282`, inside `D7-F02: the import pending
state`, changes

```diff
-    await expect(page.getByRole('button', { name: /^Sample 1\b/ })).toBeVisible()
+    await expect(page.getByRole('heading', { name: 'Edit an image' })).toBeVisible()
```

This has nothing to do with IMP-042. It is absent from the implementer's file table, absent from
the "Files changed" narrative, and **unnecessary** — mutation 7 reverted it and D7-F02 passed
(2.1s). Revert it or add a one-line comment saying which failure it fixed. Editing an existing
test in a file you are already touching, with no record, is how the next reader loses trust in the
diff.

`.improve/PROGRESS.log` is IMP-041's commit-hash fixup, pre-existing in the tree. Not this change's.

---

## 7. The baseline-appearance finding — **cross-cutting, and it is real**

**The mobile baseline screenshots were captured at `density: roomy` + `textScale: xlarge`, not at
the app's defaults.** Proven by reproducing the item's own quoted numbers on a HEAD worktree at
390×844, sweeping `density` × `textScale`:

| appearance written to `localStorage` | `html` data-attrs | `scrollWidth` | `Background.right` |
| --- | --- | --- | --- |
| defaults | `{}` | **897** | **356.77** (whole) |
| `density: compact` | `{density:compact}` | 828 | 333.52 |
| `density: roomy` | `{density:roomy}` | 985 | 387.17 |
| `density: roomy, textScale: large` | `{density:roomy,text:large}` | 996 | 395.70 |
| **`density: roomy, textScale: xlarge`** | `{density:roomy,text:xlarge}` | **1019** | **408.72** |

`.improve/FEATURES.md` IMP-042 quotes `scrollWidth 1019` and `Background` bisected. **Only
`roomy + xlarge` reproduces both.** At defaults the same build measures 897 and already shows
`Background` whole. The image corroborates it: `baseline/mobile-05-editor-loaded.png` has a 73.75px
tab pitch (`62 × 1.125` plus a 4px gap = roomy) and shows exactly five tabs with `Background` cut
at the viewport edge.

**The desktop baselines were captured at *defaults*.** `desktop-11-adjust-panel.png` has a 72px
tab pitch, which is the default-density pitch, and my `verify/desk-after-default-Adjust.png`
reproduces it exactly.

So the 30 baseline screenshots in `.improve/artifacts/baseline/` were captured under **two
different appearance settings**: the nine mobile ones at `roomy + xlarge`, the 21 desktop ones at
defaults. `REPO_PROFILE.md` §0 records only "baseline captured 2026-10-04 … working tree clean"
and never states the appearance.

**Why this matters beyond IMP-042.** Every mobile defect the recon derived from those nine
screenshots was measured against a bar, a sheet and a chip row 12–17% larger than what a default
user sees. Consequences already visible:

- IMP-042's stated intent is partly wrong: "the word `Background` is bisected … renders as
  `Backgroun`" is a **roomy+xlarge** defect, not a default one. The implementer diagnosed this
  correctly, which is to their credit.
- Any other mobile item whose threshold was set from a baseline number is either over-tight (if
  the fix was sized to the inflated number) or will look already-fixed at defaults (if the fix was
  sized to it and does nothing at defaults). Both failure modes are invisible until someone runs
  the app at defaults.
- The IMP-042 e2e case runs at **defaults**, so the appearance that produced the evidence is the
  one the new gate does not exercise.

**Recommendation:** record the appearance settings per screenshot in `REPO_PROFILE.md`, and
re-capture the nine mobile baselines at defaults — or, if the elevated appearance was deliberate,
say so and capture **both** sets. Any in-flight mobile item citing a number off those images
should be re-measured at defaults before it is accepted.

---

## 8. Minor findings, not blocking

1. **`scroll-padding-inline` uses the wrong inset on the right.**
   `editor.module.css:655` writes `scroll-padding-inline: calc(8px + var(--ie-safe-left))`. It is
   a shorthand, so it sets `scroll-padding-right` from the **left** safe inset, while the bar's own
   `padding-right` at `:256` is `calc(8px + var(--ie-safe-right))`. On a device in landscape with a
   right safe inset, the last tab snaps ~44px short of where the bar's padding puts it. Use
   `scroll-padding-left`/`scroll-padding-right` explicitly.
2. **`GlyphRow` still has its own measurement** (`LayerPanels.tsx:177-195`), so the hook's header
   comment is one merge ahead of the code. Follow-up item, not this one.
3. **`.improve/FEATURES.md` IMP-042 is still `TODO`** and `docs/FEATURES.md` has no row for the
   affordance. I checked: no row exists, so the implementer's reasoning (adding one means touching
   six sets of counts in one pass) is defensible. But the item is now implemented and verified, so
   the backlog status should say so before the next agent picks it up again.
4. The implementer's report §"Uncertain 1" argues the `opacity`-vs-`mask-image` deviation at length
   and is right that `opacity` could not fail — but it never asks whether the substitute can fail,
   and it cannot. That single unexamined assumption is what let §0 through.

---

## 9. Verdict

**FAIL.**

Criterion 1's left-edge half is unmet at every scroll position between the start and the end, which
is the position the row spends most of its time in and the position a flick parks on. Criterion 2,
3 and 4 are met, all gates are green, `ChipRow`'s behaviour is provably unchanged, WebKit paints the
mask correctly, and the desktop is byte-identical. The change is one declaration away from correct.

**Required before acceptance:**

1. **Fix the combined mask.** One four-stop gradient on `.tabBarMoreStart.tabBarMoreEnd` (measured
   working in §0), or `mask-composite: intersect` on the existing two-gradient list. Correct the
   `mask-composite` comment at `editor.module.css:272-273`, which states the opposite of what
   happens.
2. **Make the e2e case able to see paint, not a declaration string.** The `count: 2` assertion must
   go — a two-gradient `mask-image` string is compatible with a mask that paints nothing. Either
   compare `nav.screenshot()` bytes with and without the mask, or pin the single-gradient shape of
   the combined rule so the list cannot come back. Keep the current reads; they are good.
3. **Gate the ≤480px metric change** (mutation 3 survives everything today). A
   `responsiveLayout.test.ts` pin on the media-query values, or an appearance-parameterised case in
   the IMP-042 block asserting `Background` overhang ≤ 1 at `roomy + xlarge`.
4. **Revert `journey.mobile.spec.ts:282`** or explain it in a comment.
5. **Record the baseline appearance mismatch** (§7) and re-measure in-flight mobile items against
   defaults. Cross-cutting, not this item's to fix, but it must not be lost.

**Screenshots:** `.improve/artifacts/IMP-042/verify/` — 94 files. The ones that carry the finding:
`cmp-mid-left-WITH.png` / `cmp-mid-left-NONE.png` / `cmp-mid-right-WITH.png` / `cmp-mid-right-NONE.png`
(the defect), `cmp-start-right-WITH.png` / `-NONE.png` and `cmp-end-left-WITH.png` / `-NONE.png`
(the halves that do work), `fix-mid-left.png` / `fix-mid-left-AFTER.png` / `fix-mid-right-AFTER.png`
(the fix), `z4-bar-*.png` (4× magnifications, both engines, default and roomy+xlarge),
`desk-after-default-Adjust.png` / `desk-before-roomyxlarge-Adjust.png` (desktop, md5-identical),
`before-chromium-390x844-roomy-xlarge-start.png` (the pre-change bisected label),
`after-chromium-390x844-roomy-xlarge-start.png` (fixed), `clip-*.png` (full-page, both engines).