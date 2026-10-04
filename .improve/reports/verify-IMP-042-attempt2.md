# verify-IMP-042-attempt2 — independent re-review

**Reviewer:** independent pass. I did not write this change.
**Branch:** `improve/auto-20261004`, working tree uncommitted.
**Date:** 2026-10-04. **Verdict: PASS.**
**Prior verdict:** `.improve/reports/verify-IMP-042.md` (attempt 1, FAIL).

Everything below is a measurement or a command's output. Every shell command was prefixed with
`export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.

---

## 0. The finding, first

**The defect attempt 1 was rejected for is gone.** The two-gradient `mask-image` list has been
replaced by one four-stop ramp, and at every scroll position that is neither end, **both edges
now paint**. I reproduced attempt 1's own measurement method (decoded pixels, the row as painted
versus the same row with `mask-image: none !important`, differenced in three column bands) at
`deviceScaleFactor: 6` — 6 device px per CSS px, so a band boundary can never land mid-pixel.

| position | `scrollLeft` | classes | left 40 CSS px | middle | right 40 CSS px |
| --- | --- | --- | --- | --- | --- |
| start | 0 | `tabBarMoreEnd` | **0** | 0 | **137** |
| mid (wheel-snapped) | 229 | both | **74** | 0 | **137** |
| mid (exact half, not snapped) | 168 | both | **73** | 0 | **137** |
| end (= max) | 395 | `tabBarMoreStart` | **190** | 0 | **0** |

Attempt 1 measured **1 / 1 / 1** at mid-scroll. Attempt 2's report claims 71 / 1 / 136. I measure
**74 / 0 / 137** at DPR 6 and **71 / 0 / 136** at the e2e's own CSS-pixel scale (DSF 2.625,
`scale: 'css'`) — the implementer's numbers to the digit. The claim reproduces.

The two directions the brief specifically asked about also hold, and they hold in the *negative*
direction too, which is the half that is easy to get wrong:

- at `scrollLeft 0`, the **left** band is **0** — nothing fades at the start edge, because there is
  nothing behind it. A fade there would be a lie, and the assertion says so;
- at `scrollLeft = max`, the **right** band is **0** — the trailing fade is gone, because the last
  tool *is* in view;
- in the middle band, **0** at every position — the plateau between the two 32 px ramps really is
  opaque, so the two captures are of the same row in the same state and every byte of difference
  between them is the mask and nothing else.

**And the new test is a paint gate, and it bites.** See §3.

---

## 1. Criterion-by-criterion

The four acceptance criteria are `.improve/FEATURES.md:770-773`.

| # | Criterion | Verdict | My evidence |
| --- | --- | --- | --- |
| 1 | 390×844: a visible right-edge `mask-image` fade present only while `scrollLeft < scrollWidth − clientWidth`, **and an equivalent left-edge fade once `scrollLeft > 0`** | **MET** | start: right 137 / left **0**. mid@229: **left 74, right 137**. mid@168 (unsnapped): **left 73, right 137**. end@395: left 190 / right **0**. Middle 0 everywhere. Was 1/1/1 at mid. |
| 2 | `scrollSnapType` not `none` at ≤480 px, and `mouse.wheel({deltaX})` lands on a tool boundary | **MET** | `scrollSnapType` resolves to `"x"` — per CSS Scroll Snap, `x` on its own *is* `x proximity` (the initial strictness), so it satisfies "resolves to a proximity value". `wheel(+200)` → `scrollLeft 229`, nearest tab boundary **0.41 px**; `wheel(+90)` → `311`, **0.23 px**; `wheel(+340)` → `395 = max`. |
| 3 | No visible label clipped mid-word at `scrollLeft === 0`; `Background.right <= clientWidth + 1` | **MET**, at every appearance I could reach | default **316.77**; roomy **339**; roomy+xlarge **365.72**; default+xlarge **348.97**; `forced-colors: active` **−328** (overhang). All ≤ 391. `labelOverflow` 0 on all 13 tabs at both defaults and roomy+xlarge. |
| 4 | Desktop-invisible at 1280×800: 13 tools laid out, no fade, `scrollWidth <= clientWidth` | **MET**, byte-identical | `scrollWidth 1280 == clientWidth 1280`, `mask none`, `snapType none`, `scrollPaddingLeft auto`, `position static`, `zIndex 30`, `gap 4px`, `padding 6px 8px`. **The `nav` screenshot is md5-identical to HEAD and the whole page is md5-identical to HEAD, at default *and* at roomy+xlarge.** All 13 tab rects identical to the decimal. |

Three criteria the previous verifier added, re-checked:

| # | Extra criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| 5 | The ≤480 px metric change is gated by a test | **MET** (was UNMET) | Mutation B: the `.tabBar { gap }`, `.tab { min-width }`, `.tab { padding }` overrides deleted → `responsiveLayout.test.ts` **RED** (`cannot find \`gap\``) *and* the new roomy+xlarge e2e case **RED** (`Background is cut off by the edge, Expected <= 1, Received 18.72`). §4. |
| 6 | `e2e/journey.mobile.spec.ts:282` reverted, nothing unrelated left | **MET** | The diff for that file now touches **line 1 only** (a type import) plus an append after line 289. `:282` reads the committed `getByRole('button', { name: /^Sample 1\b/ })`. `D7-F02` passes with it (3.0 s). §5. |
| 7 | No `Doc` / history / appearance invariant broken; no debug output | **MET** | §5. |

---

## 2. My own pixel measurements, in full

Method (`verify2/measure.cjs`): the `mobile` project's own geometry (Pixel 7 descriptor, `hasTouch`,
`isMobile`, viewport forced to 390×844), on the dev server already open at **5173** (PID 27068 —
used, never killed). For each position the row's box is captured twice with
`page.screenshot({ clip, animations: 'disabled', caret: 'hide' })` — once as painted, once with
`mask-image: none !important` forced on and polled until `getComputedStyle(...).maskImage === 'none'`
— then both PNGs are decoded **in the page** (`fetch` data URL → `createImageBitmap` →
`OffscreenCanvas` → `getImageData`) and differenced per channel in three bands.

Artifacts: `verify2/v2-{start,mid,end,half}-{WITH,NONE}.png`, `verify2/measure-dsf6.json`.

### 2a. At `deviceScaleFactor: 6` (device-pixel sampling, no dithering)

```
start  scrollLeft=0    left40=0    mid=0   right40=137
       mask = linear-gradient(to right, rgb(0,0,0) calc(100% - 32px), rgba(0,0,0,0) 100%)
mid    scrollLeft=229  left40=74   mid=0   right40=137
       mask = linear-gradient(to right, rgba(0,0,0,0) 0px, rgb(0,0,0) 32px,
                              rgb(0,0,0) calc(100% - 32px), rgba(0,0,0,0) 100%)
half   scrollLeft=168  left40=73   mid=0   right40=137   (deliberately NOT snapped)
end    scrollLeft=395  left40=190  mid=0   right40=0
       mask = linear-gradient(to right, rgba(0,0,0,0) 0px, rgb(0,0,0) 32px)
```

The half position matters and is my own addition: it is a mid-scroll position the snap never
produced, so it tests the state a touch drag that ends between flicks leaves behind. It paints at
both edges too.

The per-column ramp profile confirms the shape, not just the presence. At `start`, the leftmost
column's delta is **0** and the rightmost is **137**; at `end`, the leftmost is **190** and the
rightmost is **0**. The ramp is at the edge that has something behind it and nowhere else.

### 2b. At the e2e's own scale (DSF 2.625, `scale: 'css'`)

```
A  test A/B @css-scale  left=71  middle=0  right=136   (capture 390x65 css px)
```

Identical to the implementer's reported `71 / 1 / 136`. I read the middle as 0 where they read 1;
both are the noise floor and neither matters — see §3.

### 2c. Geometry at both appearances, and in forced colours

| | `scrollWidth` | max | tools whole at `scrollLeft 0` | `Background.right` | overhang | `Text.leading` |
| --- | --- | --- | --- | --- | --- | --- |
| default, after | **785** | 395 | **6** — Crop…Text | **316.77** | −73.23 | 318.77 |
| default, before (mutation B) | 897 | 507 | 5 — Crop…Background | 356.77 | −33.23 | 360.77 |
| roomy+xlarge, after | **899** | 509 | **5** — Crop…Background | **365.72** | −24.28 | 367.72 |
| roomy+xlarge, before (mutation B) | 1019 | 629 | 4 — Crop…Retouch | 408.72 | **+18.72** | 412.72 |

Every one of the "before" numbers reproduces the previous verifier's HEAD measurement and the
implementer's mutation-B read-out **to the decimal** (897, 356.77, 1019, 408.72, 18.72). The
`roomy+xlarge` before-state also reproduces the *spec's own* numbers (`scrollWidth 1019`, `Background`
bisected), which is how I know those numbers came from that appearance and not another.

`forced-colors: active` at 390×844, changed vs HEAD:

```
after   clientWidth 388  scrollWidth 785  mask none  _tabBar _tabBarMoreEnd  border-right 2px
before  clientWidth 390  scrollWidth 897  mask none  _tabBar                 no borders
```

The fallback works: no mask, a 2 px rule as the affordance, and `Background` still 328 px inside
the row despite losing 2 px of `clientWidth` to the border.

---

## 3. Judging the new paint-based test

`paintedEdges()` in `e2e/journey.mobile.spec.ts:404-508`, asserted at three positions with
`FADED = 8` and `QUIET = 1`.

### 3a. Is `QUIET = 1` too permissive? No — and I measured why.

`verify2/quiet.cjs`, at the e2e's own CSS-pixel scale, mid-scroll:

| experiment | left 40 | **middle** | right 40 |
| --- | --- | --- | --- |
| A — the test's own A/B (mask on vs mask off) | 71 | **0** | 136 |
| B — mask on vs mask off **plus a 1 px `translateX` on the row** | 122 | **164** | 126 |
| C — two identical captures, nothing changed, mask off | 0 | **0** | 0 |

Experiment B is the answer to the question asked. **A one-pixel shift does not pass this gate
vacuously**: it drives the quiet control from 0 to **164**, eighty-four times `QUIET`, and the test
fails on the control rather than being fooled by the edge numbers. Without the control, B would have
produced left 122 / right 126 — both comfortably over `FADED` — and the gate would have passed on a
row whose fade did nothing. The three-part structure (`>= 8` on the edge that should fade, `<= 1` on
the middle that should not move, `<= 1` on the edge that should be quiet) is what makes it a
measurement rather than a tautology, and the control is the load-bearing third of it.

Experiment C shows the real floor on this machine is **0**, so `QUIET = 1` is one notch of headroom,
not the floor itself. The implementer read 1 where I read 0 on identical code — that gap is
dithering non-determinism between runs, not a different measurement. Either way `QUIET = 1` is not
over-tight here and not vacuous.

`FADED = 8` sits ~9× under the weakest real fade (71) and 8× over the observed floor. That margin is
the right shape.

### 3b. Does the gate bite? Four mutations, all restored exactly

Backups in `/tmp/imp042bak_v2/`, md5s recorded before and after.

| # | Mutated | Gate | Result |
| --- | --- | --- | --- |
| **M1** | `.tabBarMoreStart.tabBarMoreEnd` reverted to the **two-item list**, **and** the mid-scroll `fades()` shape assertion deleted so the paint gate is the only thing left | `journey.mobile.spec.ts --project=mobile -g IMP-042` | **RED** — `expect(atMid.left, 'the leading edge is not painted mid-scroll').toBeGreaterThanOrEqual(FADED)` at `:651`, **`Expected: >= 8  Received: 1`** |
| **M2** | all three `mask-image` rules deleted | `journey.mobile.spec.ts --project=mobile -g IMP-042` | **RED** — `Error: the trailing fade did not come on` |
| **M2** | same | `responsiveLayout.test.ts` | **RED** — `× fades both edges with one four-stop ramp, not a two-item mask list`, `expected 'none' to be 'linear-gradient( to right, transparen…'` |
| **M3** | the three ≤480 px metric declarations deleted | `responsiveLayout.test.ts` | **RED** — `× tightens its own metrics…`, `cannot find \`gap\`` |
| **M3** | same | `journey.mobile.spec.ts --project=mobile -g IMP-042` | **RED** — `× at roomy density and xlarge text…`, `Background is cut off by the edge, Expected <= 1, Received: 18.72` |
| **M3** | same | `journey.responsive.spec.ts --project=chromium` (19 cases) | **GREEN — did not bite**, re-confirming that no pre-existing browser gate sees the metric change |

**M1 is the decisive one.** It reproduces attempt 1's exact defect (a two-gradient list under
`mask-composite: add`) with every other assertion removed, and the gate reports `Received: 1` — the
same delta the previous verifier measured by hand and the same delta the implementer reports. So the
new paint gate, **on its own, without the declaration-string assertion**, would have failed on the
original defect. That was the whole of the previous verdict's requirement 2, and it is satisfied.

**Restore verification.** Every mutated file re-hashed against the pre-mutation record, after every
mutation:

```
bceec6f2145bcde8efd67a11e1f9c3ee  src/components/editor/editor.module.css
473a9909f7d3b34b896f8f701e99006e  e2e/journey.mobile.spec.ts
805e868498bc835567c273568e078eac  src/components/controls/responsiveLayout.test.ts
db35ef7c6e4aded221937fe2a0e85424  src/components/editor/ToolTabBar.tsx
c8c29143f44e5cdcb6bf5d50b71988ce  src/hooks/useScrollEdges.ts
f43a81467580ecb9e85540c191c15b09  src/components/controls/ChipRow.tsx
3770958650ecc31fe1f55e1a5ed916c2  src/components/editor/ToolTabBar.test.tsx
c28933339386af74ee00f361d5430405  src/hooks/useScrollEdges.test.tsx
grep -rc "MUTATION" src e2e   ->  0 everywhere
git diff --stat  ->  786 insertions / 34 deletions across 7 files (unchanged)
```

**Nothing was left mutated.**

### 3c. What the paint gate cannot see, stated honestly

- **Ramp width.** `FADED = 8` is a presence threshold. A mask that faded over 2 px instead of 32 px
  would clear it, because column 0 would still be fully transparent. The width is not unpinned,
  though — `responsiveLayout.test.ts` pins the exact four-stop string including `32px`, and the e2e's
  `fades()` shape read pins `count: 1` at mid-scroll. That is a legitimate division of labour
  (paint gate owns *does it paint*, declaration pin owns *what shape*), and the previous verifier's
  objection was to a gate that stood on a declaration string alone. It no longer does.
- **Engine.** The paint gate runs only on the `mobile` project, which is a Pixel 7 descriptor and
  therefore a **Chromium** binary. `journey.responsive.spec.ts` reads the nav's bounding box on both
  legs but **never reads `maskImage`**, so there is **no WebKit gate on the fade at all**. The fix is
  a declaration and WebKit was proved to paint the mask correctly in attempt 1 (byte-level A/B at all
  three positions), so this is a coverage gap rather than a defect — but it is a real gap and the
  implementer says so in their §5. CI does select the `mobile` project (`ci.yml:138`,
  `browser: chromium`), so the gate that does exist does run.
- **Rasteriser.** `QUIET = 1` was measured on Chromium's compositor on this machine. CI runners are
  Linux with a software rasteriser. The risk is a *flake*, not a false pass: a rasteriser whose floor
  sits above 1 would make the control fire on a correct build. Disclosed by the implementer as
  "Remaining uncertainty 1". I would want one CI run to confirm the floor before trusting the gate
  on Linux, and I cannot produce one from here.

---

## 4. Judging the new metric gate

Two gates, and the implementer's claim is that both bite. **It reproduces.**

`responsiveLayout.test.ts` gains a `media(css, condition)` helper (a tail slice answers with
whichever `.tab` comes first in the file, which above a desktop block is not the phone one) and four
cases: the snap declarations, the three metric declarations, the exact four-stop `mask-image` plus
`toHaveLength(1)` on the gradient count, and the **base** `.tabBar { gap: 4px }` / `.tab { min-width:
calc(62px …) }` so the phone block cannot leak upward. `33 tests` where there were `29`.

The `media()` helper is correct on inspection: `indexOf('@media (max-width: 480px)')` cannot false-match
the `@media (max-width: 420px)` block at line 168, and the slice stops at the next `@media`, so a
desktop `.tab` below the phone block cannot be returned for a phone-block lookup.

`e2e/journey.mobile.spec.ts:722` is the appearance-parameterised case.

### Does the roomy+xlarge case actually *visit* those settings, or set them without effect?

**It visits them, and mutation B proves it.** Under mutation B the case failed with
`Received: 18.72`. That number is only reachable at `roomy + xlarge`:

| appearance | `Background.right` | overhang |
| --- | --- | --- |
| defaults | 356.77 | −33.23 → assertion would have **passed** |
| `roomy` only | ~387.2 | ≈ −2.8 → assertion would have **passed** |
| `roomy + xlarge` | 408.72 | **+18.72 → fails** |

If the appearance had not taken effect, the case would have seen `−33.23` and passed vacuously
against the base metrics — which is precisely the failure mode the previous verifier's mutation 3
exposed. It failed instead. The case also asserts `html[data-density="roomy"]` and
`html[data-text="xlarge"]` before loading the sample, and `setAppearance` sets them *before* the
sample is loaded with the reason written down (a reload after a sample is loaded lands on the import
screen, because the app restores from its own debounced `localStorage` mirror).

Its other assertions are non-vacuous too: `scrollWidth > clientWidth` first, so a bar that fits would
make every later assertion empty; thirteen tabs in `TOOLS` order; the next tool's `leading` inside
the row; ≥ 5 whole tools (4 at the base metrics); and `labelOverflow <= 1` for all thirteen.

---

## 5. Scope, `:282`, and invariants

`git diff --name-only` — 7 files, 786 insertions / 34 deletions:

```
.improve/PROGRESS.log
e2e/journey.mobile.spec.ts
src/components/controls/ChipRow.tsx
src/components/controls/responsiveLayout.test.ts
src/components/editor/ToolTabBar.test.tsx
src/components/editor/ToolTabBar.tsx
src/components/editor/editor.module.css
```
plus untracked `src/hooks/useScrollEdges.ts`, `src/hooks/useScrollEdges.test.tsx`, and three
reports under `.improve/reports/`.

**`:282` is genuinely reverted.** `git diff -U2 -- e2e/journey.mobile.spec.ts` now has exactly two
hunks: line 1 (a `import type { Locator, Page }` addition) and a single append after line 289.
The D7-F02 body reads the committed locator. `D7-F02: the import pending state` passes (3.0 s).
The unrelated edit is gone.

**Nothing else unrelated.** Grepped all eight touched files for `console.log|debug|.only(|.skip(|
TODO|FIXME|MUTATION|@ts-ignore` — the only hits are the words "console" and "caret" inside
prose comments. No secrets (`api_key|secret|token|password|PRIVATE KEY` → 0 hits across the diff).
No mass reformat. `prettier --check .` clean repo-wide, which is the mechanical proof of the last
point.

**`AGENTS.md` invariants.**

| Invariant | Verdict |
| --- | --- |
| 1. `Doc` is JSON-serializable only | **MET** — zero files under `src/model/` in the diff; `types.ts` `mask|scrollLeft|scrollEdges` hits are `Mask`/`maskId` paint masks, pre-existing. Nothing scroll-related enters `Doc`; `useScrollEdges` is a `useState` in a component. |
| 2. Both render backends | N/A — no render pass. |
| 3. `history.ts` pure, no React/DOM | **MET** — `grep -cE '^import' src/store/history.ts` = **0**. Untouched. |
| 4. New `Doc` field needs a default + migration | N/A — no new `Doc` field. |
| 5. Pure logic in `src/lib`/`src/features` | **MET** — `measureScrollEdges` is a pure exported function in `src/hooks/useScrollEdges.ts:22`, directly unit-testable without React. |
| 6. Store updates via `actions.ts` | N/A — no store write. |
| 7. Appearance is chrome, never in `Doc` | **MET** — `density`/`textScale` appear **0** times in `types.ts`, `defaults.ts`, `migrate.ts`. The new e2e case writes `localStorage['image-editor-appearance']` and reads `html` data-attributes, exactly as `appearance.ts` specifies. |
| 9. New runtime dependency → `licenses.ts` | N/A — none added. |
| 10. `public/` fully tracked | **MET** — `git status --porcelain public/` empty. |
| 12. `AGENTS.md` e2e rules: fixtures, accessible names, `readDoc()`, bytes not "not empty" | **MET** — the new cases use the `test` from `e2e/fixtures.ts` and locate by `getByRole('navigation', { name: 'Editor tools' })` and `getByRole('button', { name })`. No `styles.` selector in the diff. `paintedEdges` asserts on decoded pixel values, not on emptiness. |
| "A gate must be green on the branch that adds it" | **MET** — §6. |

`.improve/PROGRESS.log` is IMP-041's commit-hash fixup (`pending` → `b957f90`), pre-existing in the
tree before this work started, and correctly attributed by the previous verifier. Not this change.

---

## 6. Re-checking what attempt 1's verifier proved sound

### 6a. `ChipRow` blast radius — unchanged, and still no behaviour change

`ChipRow.tsx` is **byte-identical to attempt 1** (`f43a81467580ecb9e85540c191c15b09`), so the
previous verifier's finding carries. I re-proved the observable half independently
(`verify2/chiprow.cjs`, `verify2/chiprow-force.cjs`), comparing the **changed** build at 5173 against
a fresh HEAD worktree at 5401:

- **7 panels** (Crop, Adjust, Passport, Export, Redact, Frame, Layers) × 2 widths (1280×900, 390×844)
  × 2 scroll positions, dumping every `[role="group"]`'s classes, `clientWidth`/`scrollWidth`/
  `scrollLeft` and resolved `mask-image`: **IDENTICAL** at both widths.
- That comparison is **dormant** (chip rows wrap and never overflow at these widths, so the fade path
  never runs), so I **forced** it: `flex-wrap: nowrap` + `min-width: 160px` on every chip in the Crop
  panel, giving `scrollWidth` up to 1508 against `clientWidth 327`. At `scrollLeft` 0 / 40 / max, all
  24 sampled states — including every `_rowMore` fade and every `mask: none` — are **byte-identical**
  between HEAD and the change.

The shared hook's predicate is also provably the old one: old `overflowing && !scrolledToEnd` where
`scrolledToEnd = max <= 1 || scrollLeft >= max - 1`, `overflowing = max > 1`; new
`overflowing && !afterEnd` where `max <= 1` returns `STILL` (so `overflowing` false) and
`afterEnd = scrollLeft >= max - 1`. The effect deps moved from `[children]` to `[ref, children]`, and
`ref` from `useRef` is stable, so re-run frequency is unchanged.

### 6b. Touch-scrolling on the `mobile` project — not hijacked, nothing unreachable

Real CDP `Input.dispatchTouchEvent`, Pixel 7 project, 390×844, default appearance
(`verify2/touch.cjs`, `verify2/slowdrag.cjs`):

| gesture | result |
| --- | --- |
| at rest | `scrollLeft 0`, off-boundary **0.00 px** |
| flick 200 px | `scrollLeft 311` — a tab boundary, off-boundary **0.23 px** |
| repeated flicks (×6) | `scrollLeft 395 of max 395`, **shortfall 0.00 px** |
| classes at the end | `_tabBar tabBarMoreStart` only — trailing fade correctly off |
| `Export` at the end | box `x 327.58 … 381.58`, **wholly on screen**; tap → `aria-current="true"` |
| slow drag +475 px over 20 moves, from the end | `scrollLeft 0`, classes back to `tabBarMoreEnd` only |
| slow drag +380 / +300 px | `scrollLeft 0` both times |
| small flicks from 0 | `10→0, 20→56, 30→112, 40→168, 55→229, 70→311, 100→395` — walks tab by tab |
| all 13 tools tapped in order | `aria-current="true"` on every one |

Identical pattern to attempt 1's measurement. No evidence of the scroll being hijacked; the
quantisation to boundaries is criterion 2 working as specified, and the end is always exactly
reachable (shortfall 0.00, not merely small).

### 6c. Desktop byte-identical at 1280×800 — proved against a HEAD build

`verify2/desktop.cjs` renders the changed build (5173) and a **fresh HEAD worktree at `a1f0e89`**
(5401) at 1280×800, DSF 1, Adjust panel open:

| appearance | `nav` bytes | whole page bytes | tab rects |
| --- | --- | --- | --- |
| default | **identical** `ed6c0d1ab9f721f16063a368a80cf253` | **identical** `3c72e523b79a20d6febbc726632795a8` | identical to the decimal |
| roomy+xlarge | **identical** `0bcf34d2b01f6b6be42fe7ae3fd86e8c` | **identical** `ffa72d645076788a1c343fed74e248db` | identical to the decimal |

The only textual difference between the two builds' geometry dumps is the CSS-module hash in
`className` (`_tabBar_1irpp_58` vs `_tabBar_yb6c0_58`) — expected, since `editor.module.css` changed.
**Zero console errors on both engines, both builds.**

---

## 7. Commands run, with results

| Command | Result |
| --- | --- |
| `npm run typecheck` | **pass**, exit 0, no output |
| `npm run lint` | **pass**, exit 0, zero errors zero warnings |
| `npx prettier --check .` | **pass** — "All matched files use Prettier code style!" |
| `npm test` | **pass** — `Test Files 155 passed (155)`, `Tests 3085 passed (3085)`. Re-run after all mutations were restored: identical. |
| `npx playwright test e2e/journey.mobile.spec.ts e2e/journey.mobile-touch.spec.ts --project=mobile` | **pass** — **21 tests**, incl. both IMP-042 cases (`every tool is reachable…` 5.0 s, `at roomy density and xlarge text…` 3.2 s) and `D7-F02` with its committed locator |
| `npx playwright test e2e/journey.responsive.spec.ts --project=webkit` | **pass** — **19 tests** |
| `npx playwright test e2e/journey.responsive.spec.ts --project=chromium` | **pass** — 19 tests (also 19 under mutation B, which is the point) |
| `npx playwright test e2e/a11y.spec.ts --project=chromium -g "forced"` | **pass** — 2 tests |
| `npx playwright test e2e/journey.shell.spec.ts --project=chromium -g "forced"` | **pass** — 1 test |
| `npx playwright test e2e/journey.inspector-layout.spec.ts --project=webkit` | **pass** — 7 tests |
| `npx vitest run src/components/controls/responsiveLayout.test.ts` | **pass** — 33 tests (29 + 4) |
| `git status --porcelain` | 7 modified + 5 untracked, exactly the files the brief lists |

The dev server on **5173 (PID 27068) was used and never killed.** A second server was started in a
throwaway `git worktree` at `a1f0e89` on **port 5401** to measure HEAD in the same engine; it is
disposable and I removed the worktree afterwards. `npx playwright test` used its own 5317.

**Console**, measured in every browser session I opened (10 contexts across chromium; the mobile
project is Chromium):

| context | errors |
| --- | --- |
| 390×844, default, start/mid/end, forced | **0** |
| 390×844, roomy+xlarge | **0** |
| 1280×800, default and roomy+xlarge, changed **and** HEAD | **0 / 0** |

**No new errors.** The expected jsdom stderr noise during `npm test` (`HTMLCanvasElement.prototype.
getContext` from `src/gl/caps.ts:181`, `asset_not_a_bitmap` from `src/lib/decode.ts:217`) is
pre-existing and unrelated.

---

## 8. Real-browser confirmation, 390×844 and 1280×800

Screenshots in `.improve/artifacts/IMP-042/verify2/`. **I looked at each of these.**

| what | file |
| --- | --- |
| start, 4× the bar — trailing fade only, `Background` whole, `Text` dimming at the right | `look-start-bar4x.png` |
| **mid, 4× the bar — `Background` dimmed on its left AND `Frame` dimmed on its right** | `look-mid-bar4x.png` |
| end, 4× the bar — leading fade only, `Export` whole and un-dimmed | `look-end-bar4x.png` |
| start, full page, default appearance | `look-start-full.png` |
| **mid, full page, default appearance — both edges fading** | `look-mid-full.png` |
| end, full page | `look-end-full.png` |
| start, full page, roomy+xlarge — `Background` whole at 365.72, sliver of `Text` past it | `look-roomyxlarge-start-full.png` |
| mid, full page, roomy+xlarge | `look-roomyxlarge-mid-full.png` |
| 1280×800, default, Adjust open — 13 tools, no fade | `desk-after-default.png` |
| 1280×800, roomy+xlarge | `desk-after-roomyxlarge.png` |
| 1280×800 HEAD, same two appearances (md5-identical to the two above) | `desk-before-*.png` |
| 390×844 in `forced-colors: active`, changed and HEAD | `forced-after-390.png`, `forced-head-390.png` |
| the defect A/B at DPR 6, all four positions, masked and bare | `v2-*-{WITH,NONE}.png` |

Confirmed by eye:

- **all 13 tools reachable at 390 px** — the e2e taps each one and asserts `aria-current="true"`;
  I drove it independently over CDP touch and got `true` on all 13, and at the end `Export`'s box
  is `327.58 … 381.58`, wholly inside the 390 px row.
- **`Background` not clipped mid-word** — whole at 316.77 px (default) and 365.72 px
  (roomy+xlarge) against a 390 px row; `labelOverflow` 0 on all 13 tabs at both.
- **fade visible and correctly one-sided at the ends** — `look-start-bar4x.png`: `Crop` crisp at the
  left, `Text` dissolving at the right. `look-end-bar4x.png`: a sliver of `Draw` dissolving at the
  left, `Export` crisp at the right.
- **fade visible at both edges mid-scroll** — `look-mid-bar4x.png`: `Background` dissolving on the
  left, `Frame` dissolving on the right, both over readable labels, with the next tab ghosting in
  past the right ramp. This is the thing attempt 1 did not paint, and it now reads as deliberate.
- **no desktop regression** — `desk-after-default.png` vs `desk-before-default.png` are md5-identical.

---

## 9. The reported cross-cutting baseline problem — confirmed, and larger than reported

Attempt 1's verifier found the nine mobile baselines at `density: roomy` + `textScale: xlarge` and
the twenty-one desktop baselines at **defaults**, on the strength of the desktop tab pitch being 72 px
(default-density pitch).

**I confirm the mobile half and I do not confirm the desktop half. All thirty baselines are at
`roomy` + `xlarge`, and so the mismatch is with the *defaults*, not with each other.**

Two independent methods:

**1. Whole-page pixel diff** of `baseline/desktop-06-editor-loaded.png` (no panel open, so the only
variable is appearance) against HEAD renders at 1280×800 (`verify2/pitch2.cjs`):

| compared against | channels differing by > 24 |
| --- | --- |
| HEAD at **defaults** | **3.63 %** |
| HEAD at `density: roomy` | 1.15 % |
| HEAD at **`roomy` + `xlarge`** | **0.60 %** |

Six times closer to roomy+xlarge than to defaults.

**2. Label-centre positions** in the desktop tab bar band, y ∈ [736, 792), as the x of each bright
run (`verify2/pitch.cjs`):

| image | bright-run centres (x) |
| --- | --- |
| `baseline/desktop-11-adjust-panel.png` | 41, 51.5, **128**, 214, **372, 379, 388, 473**, 547, 558, 706, 715, 722.5, 790, 803, 949.5, 964, **1030** |
| after @ roomy+xlarge | 41, 51, **128**, **379, 388.5, 472.5**, 547, 558, 706, 715, 722.5, …, 950, 963, **1030** |
| after @ defaults | **47, 113, 129, 329, 345.5, 417.5, 625, 641, 697, 714, 842, 857, 913** |

The baseline and the roomy+xlarge render agree on **128 / 379 / 388 / 472 / 547 / 558 / 706 / 715 /
722 / 950 / 963 / 1030** — every one of the wide-label tabs, to the pixel. The defaults render
agrees with neither. And the band-only diff agrees: `desktop-11` tab band is **4.85 %** vs
roomy+xlarge and **12.08 %** vs defaults.

Corroborating: the mobile baseline's tab pitch measures ≈ 74 px, which is HEAD's roomy pitch
(62 × 1.125 + 4 = 73.75) and not HEAD's default pitch (62 + 4 = 66); and `Background` is bisected in
it, which only happens at `textScale: xlarge` (387.17 at roomy alone is inside the row).

**So: 30 of 30 baselines were captured at one non-default appearance, `density: roomy` +
`textScale: xlarge`, and `REPO_PROFILE.md` §0 records none of it.** The reconciliation is the same
either way — everything derived from those images was measured against a bar, a sheet and a chip row
12–17 % larger than a default user sees — but the statement is simpler and the exposure is larger than
attempt 1's report claims, because no baseline in the repository is a default-appearance baseline.

### Is the fix's claimed improvement stated at default as well as at roomy/xlarge?

**Yes, correctly, and I verified the default numbers independently.** `impl-IMP-042.md` §2 gives two
tables and says plainly: *"The improvement at defaults is real but about a third of what `roomy` +
`xlarge` shows, so both."* My own measurements agree with both:

| at 390×844 | default before → after | roomy+xlarge before → after |
| --- | --- | --- |
| `scrollWidth` | 897 → **785** (−12.5 %) | 1019 → **899** (−11.8 %) |
| max scroll | 507 → **395** | 629 → **509** |
| tools whole at `scrollLeft 0` | 5 → **6** | 4 → **5** |
| `Background.right` | 356.77 → **316.77** | 408.72 → **365.72** |
| clip mid-word | none, before or after | **yes → no** |

So the improvement is real at **both**, and the headline `"Background" renders as "Backgroun"` is
correctly attributed to `roomy + xlarge` rather than claimed at the default. **No misstatement to
flag.**

One consequence worth naming: **criterion 3 was already satisfied at the default appearance before
this change** (356.77 ≤ 391). The metric change is what makes it hold at `roomy` + `xlarge`, and the
new gates are correctly placed on the appearance where it matters. The three of thirteen tools
visible at the default is a genuine improvement, not a restatement.

The two documentation gaps the implementer left, both flagged and both defensible as the
coordinator's call: `.improve/FEATURES.md` IMP-042 is still `Status: TODO`, and `docs/FEATURES.md`
has no row for the affordance. The spec text itself still quotes only the roomy+xlarge numbers in
its `Intent`. `AGENTS.md`'s feature-work rule ("update its row/status in that file and add tests")
is not satisfied, so these are open items rather than defects in the change.

---

## 10. Findings, none blocking

1. **`scroll-padding-inline` is still wrong** (pre-existing, unchanged, now with a written rationale
   and a test comment saying why it is deliberately *not* pinned).
   `editor.module.css:668` sets `scroll-padding-inline: calc(8px + var(--ie-safe-left))`, a shorthand,
   so it sets `scroll-padding-right` from the **left** safe inset while the bar's own
   `padding-right` at `:256` is `calc(8px + var(--ie-safe-right))`. On a device in landscape with a
   right inset, the last tab snaps about a safe-area width short of where the bar's padding puts it.
   Use `scroll-padding-left` / `scroll-padding-right` explicitly. I measured `scrollPaddingLeft` and
   `scrollPaddingRight` both resolving to `8px` in portrait, so this is latent, not active.
2. **The edge fade has no WebKit gate.** `journey.responsive.spec.ts` reads the nav's box on both
   legs but never `maskImage`; the paint gate is Chromium-only by construction. Disclosed by the
   implementer. A WebKit leg would need its own `QUIET`, measured, since the dithering floor differs.
3. **`QUIET = 1` is unverified on a Linux CI rasteriser** (§3c). Flake risk, disclosed. One CI run
   would settle it.
4. **`GlyphRow` still carries a third copy of the measurement** —
   `src/components/tools/LayerPanels.tsx:184-195`, `el.scrollWidth > el.clientWidth + 2` with a
   `window` resize listener. The new hook's header says the measurement "lives here now", which is
   true of `ChipRowShell` and `ToolTabBar` and not of this. Unchanged by attempt 2, out of scope,
   but the header is one merge ahead of the code. Follow-up item.
5. **`editor.module.css` now has three `@media (forced-colors: active)` blocks** (109, 677, 721);
   it had two. The new one is at 677, adjacent to the rules it overrides, and I measured it working
   (mask off, 2 px rules, `Background` still 328 px inside). Grouping them is a tidy-up, not a
   defect.
6. **Backlog documentation** (§9): `.improve/FEATURES.md` status and the absent `docs/FEATURES.md`
   row.
7. **Baseline appearance** (§9): 30 of 30 baselines at `roomy` + `xlarge`, unrecorded. Cross-cutting;
   every in-flight mobile item whose threshold came off those nine images should be re-measured at
   the default before acceptance.

---

## 11. Verdict

**PASS.**

Attempt 1's four required fixes are all done and all verified by measurement rather than by reading
a declaration:

1. **The combined mask is fixed** — one four-stop ramp, and the `mask-composite: add` comment now
   states what `add` actually does. My own per-pixel measurement at three scroll positions plus one
   unsnapped position gives **74 / 0 / 137** at mid-scroll against attempt 1's **1 / 1 / 1**, and the
   quiet-at-the-ends directions hold too (left 0 at the start, right 0 at the end).
2. **The e2e case can see paint.** Four mutations, three red. The decisive one puts the two-gradient
   list back *and deletes the shape assertion*, and the gate reports `Received: 1`. `QUIET = 1` is
   not permissive: a 1 px shift drives the control from 0 to 164.
3. **The ≤480 px metric change is gated, twice.** Deleting it turns `responsiveLayout.test.ts` red
   *and* the new roomy+xlarge case red with `Received: 18.72`, which is the number only that
   appearance produces — so the case provably visits it. `journey.responsive.spec.ts` still does not
   see it, which is the point of the two new gates.
4. **`:282` is reverted**, `git diff` for that file is one import line plus one append, and D7-F02
   passes on the committed locator.

Criterion 2 and 3 are met (measured at six appearances and in forced colours), criterion 4 is
byte-identical to HEAD at two appearances, `ChipRow` is byte-identical across 24 forced-overflow
states, touch scrolling still lands on boundaries with zero shortfall and a reachable `Export`, no
console errors anywhere, and all five gates are green with `155 files / 3085 tests`.

No `AGENTS.md` invariant is broken, no unrelated edit remains, no debug output, no secrets, no
scope creep. Nothing the fix introduced that I would send back.

**Restored:** every file I mutated is back to its pre-mutation md5, `grep -rc MUTATION src e2e` is 0,
`git diff --stat` is the original 786/34 across 7 files, and `npm test` re-run after the last restore
is green at 155 files / 3085 tests.

**Report:** `.improve/reports/verify-IMP-042-attempt2.md`.
**Evidence:** `.improve/artifacts/IMP-042/verify2/`.