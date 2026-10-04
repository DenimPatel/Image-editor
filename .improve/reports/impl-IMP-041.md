# IMP-041 — the crop readout no longer occludes the crop handles

**Status: done.** Every acceptance criterion in `.improve/FEATURES.md` → `IMP-041` is
met and measured. One criterion (3, the focus ring) needed a second, smaller change
beyond moving the readout, and one design decision (the preview gets smaller) is a
real cost rather than a free win.

---

## What the evidence showed

`.improve/artifacts/baseline/desktop-10-crop-readout-occludes-handle.png` shows the
readout row sitting on the bottom-centre of the crop frame. Measured in Chromium
against the dev server on 5173, before the change:

| | x | y | w | h |
| --- | --- | --- | --- | --- |
| `.cropDimensions` (`1271 × 1920 px · 2:3`) | 389 | 698 | 142 | 27 |
| `Crop s handle` | 446 | 705 | 28 | 28 |

Shared area **28 × 20 = 560 px²**, i.e. 70 % of the handle's own box. The buttons
row above it (`.overlay`'s inline-styled container, `bottom: 40`) covered y 664–695
and so missed the handle by 10px — a miss, not a hit. At 390 × 844 the same 560 px²
overlap appears on `Crop s handle` (pill y 252–279, handle y 259–287).

`z-index` cannot fix either: it decides which of two overlapping boxes is painted on
top and leaves both of them under the reader's finger. The overlap itself has to go.

---

## The constraint that decides the shape

The obvious fix — give the readout a grid row *inside* the crop overlay and fit the
frame into the row above — is wrong here, and `e2e/journey.crop-preview.spec.ts`
says so:

> `expect(Math.abs(nwCorner.x - frame!.x)).toBeLessThan(2)`

While the Crop tool is open the preview deliberately drops the crop so the box has
the pixels it discards around it, and the overlay draws that box in **whole-frame**
coordinates. `useRenderLoop`'s `applyLayout` and `CropOverlay` each had their own
copy of `container - 32`, and the overlay's frame has to be pixel-identical to the
canvas element's box. I built the grid-inside-the-overlay version first; it failed
that spec on chromium *and* webkit with

```
Error: expect(received).toBeLessThan(expected)
Expected: < 2
Received:   20.25
```

— the overlay's frame came out 40.5px narrower than the canvas element, so every
corner handle was 20px off the photograph. Any space taken from inside the overlay
is space the canvas element is not also giving up. **The readout has to leave the
box, not merely move within it.**

So the readout became a **sibling of the box**, and the box became an element both
consumers can be pointed at.

---

## Files changed

| File | What and why |
| --- | --- |
| `src/lib/crop/frameFit.ts` *(new)* | The one definition of how an image is fitted into a box: `area - 16px` per side, aspect preserved. Pure, so both consumers can be held to it by a unit test rather than by two measurements that have to be compared in a browser. |
| `src/lib/crop/frameFit.test.ts` *(new)* | Sibling unit test: both axes, the aspect, the degenerate-frame and zero-area guards, and a case pinning that the padding is the same on both axes — the invariant `crop-preview` measures in the browser. |
| `src/hooks/useRenderLoop.ts` | `applyLayout` now calls `cropFrameFit` instead of its own `Math.max(1, size - 32)` pair. Removes the possibility of the canvas and the crop box drifting apart. |
| `src/components/canvas/canvas.module.css` | `.canvas` becomes a flex column (`flex-direction: column`, the inert centring removed). New `.canvasStage` (`flex: 1; position: relative`) is the box the image and every overlay are fitted into. New `.cropReadout` is the row below it — one wrapping row, not a stack. `.cropDimensions` stops being an absolutely positioned caption over the frame. `.handle:focus-visible` insets the ring by 3px so it is drawn inside the handle's own box. |
| `src/components/canvas/EditorCanvas.tsx` | Renders `.canvasStage` and points `containerRef` at it, so `useRenderLoop` appends the canvas there and the overlays fill the same box. Renders `CropReadout` as the row below. Owns `perspectiveOn`, because the toggle lives in the readout and the quad lives in the overlay and they have to be siblings. |
| `src/components/canvas/CropOverlay.tsx` | `CropOverlay` takes `perspectiveOn` and drops the dimensions line and the two buttons. New exported `CropReadout` holds them, reading the crop and the perspective quad from the store. Uses `cropFrameFit`. |
| `src/components/canvas/CropOverlay.test.tsx` | Renders the pair the way `EditorCanvas` does, and gains an `IMP-041` block: the readout is not a descendant of the overlay, the buttons are in the readout row with their names, the dimensions stay live, and the toggle still raises the quad in the other half. |
| `e2e/journey.crop.spec.ts` | Four new cases (below). |

`.improve/artifacts/IMP-041/desktop-10-after.png` and
`desktop-10-after-south-handle.png` — the required after-state, with the `Crop s
handle` focused.

---

## Tests

**Unit — `frameFit.test.ts`, 5 cases.** Pure arithmetic: aspect preserved, the
padding is 32 per axis, a 0×0 frame reads as 1×1 rather than dividing by zero, and
a 0×0 area yields a 1×1 box with a finite scale.

**Unit — `CropOverlay.test.tsx`, 4 new cases** under `IMP-041:`. jsdom computes no
layout, so these assert the *structure* that makes the geometry true — the readout
is a sibling of the overlay, not a descendant, and the `s` handle is inside the
overlay — plus the content claims (button names, live dimensions, the toggle still
raising the quad). The rectangles are measured in the browser, below.

**E2E — `e2e/journey.crop.spec.ts`, 4 new cases**, built on the `test` from
`e2e/fixtures.ts`, locating everything by accessible name or role:

1. `no edge handle shares any area with the readout at 1280 × 800` and
   `… at 390 × 844` (generated from one table, so the phone width is in the same file
   on both engines rather than dark on one). For each of `n`, `e`, `s`, `w`:
   `overlapArea()` between the handle's `boundingBox()` and each of `Reset crop`,
   `Perspective` and the dimension line is `0`; then
   `document.elementFromPoint` at the handle's centre returns the handle or a
   descendant.
2. `the readout still reports the crop, and both overlay buttons still work` —
   criterion 4: the text is `^\d+ × \d+ px · \d+(:\d+)?$` read from the page,
   dragging `s` shortens it, `Perspective` flips `aria-pressed` to `true`, and
   `Reset crop` restores the original numbers.
3. `focusing the south handle draws its ring inside the handle, not over it` —
   criterion 3: after focus, `getComputedStyle` gives
   `outline: 3px solid rgb(56, 178, 140)`, and the assertion is
   `outlineOffset + outlineWidth <= 0`. An outline is painted outward from
   `border edge + offset`, so that inequality is exactly "the whole ring is inside
   the handle's own 28px box". The global rule in `base.css` is `offset 2` on a `2px`
   ring — 4px *outside* the mark, which is the band of photograph the readout used
   to be painted on.

### These gates fail on the pre-change code

Not asserted, measured. `git stash push` of the three source files (keeping the
tests), then `--project=chromium -g "not painted over"`:

```
✓  the readout still reports the crop, and both overlay buttons still work
✘  no edge handle shares any area with the readout at 390 × 844
✘  no edge handle shares any area with the readout at 1280 × 800
✘  focusing the south handle draws its ring inside the handle, not over it

  Error: the readout overlaps Crop s handle at 1280 × 800
  Error: the readout overlaps Crop s handle at 390 × 844
  Error: the focus ring is drawn outside the handle, where a neighbour can cover it
  3 failed
```

The fourth case passing before *and* after is correct: it is criterion 4, a
regression guard.

---

## Measured after

Chromium, dev server on 5173, Crop tool open, `Sample 1`:

| | canvas element | overlay frame | readout row | `s` handle | gap | overlap with pill | hit test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1280 × 800 | 402 × 608 @ (259, 68) | 402 × 608 @ (259, 68) | y 692–735, h 43 | y 662–690 | 2px | 0 px² | the handle |
| 390 × 844 | 107 × 162 @ (141, 68) | 107 × 162 @ (141, 68) | y 246–289, h 43 | y 216–244 | 2px | 0 px² | the handle |

`n`, `e` and `w` are 0 px² and hit-test to the handle at both sizes. The canvas
element and the overlay frame are the same box, which is the invariant
`crop-preview` measures.

### The cost: the preview is smaller

The readout row is 43px of a 683px canvas region at 1280 × 800, and of a 237px one at
390 × 844 — the phone canvas region is already inset by `SHEET_HEIGHTS` for the
BottomSheet, so the readout takes 18 % of what is left.

| | before | after | |
| --- | --- | --- | --- |
| 1280 × 800 | 434 × 651 | 402 × 608 | −7.4 % |
| 390 × 844 | 136 × 205 | 107 × 162 | −21 % |

This is unavoidable for any fix that gives the readout its own space: the space has
to come from somewhere, and taking it from *inside* the overlay puts the crop
handles on the wrong pixels. I minimised it by making the readout **one wrapping
row** rather than the two-line stack it was — the buttons and the dimension line sit
beside each other (188 + 8 + 142 = 338px, which fits 390) and only wrap onto a
second line when the `exports …` suffix makes the caption too wide to share the row.
The earlier two-line version cost 33 % of the phone canvas instead of 18 %.

A reader may reasonably decide 107px is too small a crop box on a phone and want the
crop controls re-laid-out there. That is a design decision, not a bug fix, and it is
not in this item.

### One thing that is 2px, and why that is enough

The gap between the bottom of the `s` handle and the top of the readout row is 2px.
It is not a coincidence and it cannot go negative: the frame is centred in the stage
with `FRAME_PADDING` (16px) above and below, and the handle mark is offset 14px past
the frame's edge, so `16 − 14 = 2` at every viewport and every frame size. Zero
overlap is structural, not tuned. The `.handle::before` grab area (`--ie-tap`, 22px
from the handle's centre at the default density) does reach about 9px into the
readout row's top padding — it is transparent and answers to the handle, and the
criterion measures the element's own box.

---

## Commands, with results

All prefixed with `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"`.

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean, twice |
| `npm run lint` | clean — **failed once**: `react-hooks/set-state-in-effect` on the `useEffect` that reset `perspectiveOn`. Replaced with the documented adjust-state-during-render form, which lint accepts |
| `npx prettier --write <the 7 files>` | applied |
| `npx prettier --check .` | `All matched files use Prettier code style!` |
| `npm test` | **3069 passed / 154 files** (baseline 3060 / 153; +9 tests, +1 file) |
| `npx playwright test e2e/journey.crop.spec.ts` (chromium) | 7 passed |
| `npx playwright test e2e/journey.crop.spec.ts --project=webkit` ×3 | 7 passed each time |
| `npx playwright test e2e/journey.crop.spec.ts e2e/journey.crop-preview.spec.ts e2e/journey.layout-measure.spec.ts e2e/journey.a11y-keys.spec.ts` (both projects) | 68 passed, 2 skipped — after fixing the two failures below |
| `npx playwright test` (all 667 cases, 3 projects) | **640 passed, 27 skipped, 0 failed, 16.8m** |
| `npm test` + `npx playwright test e2e/journey.crop.spec.ts e2e/journey.crop-preview.spec.ts` re-run after a comment tidy | 3069 passed / 154 files; 22 passed on chromium and webkit |

### Failures I hit, and what they were

1. **`journey.crop-preview.spec.ts` failed on both projects** — `20.25` instead of
   `< 2`. My first design was wrong, not the test; described above. Reworked.
2. **The `390 × 844` hit test failed on WebKit only**, answering
   `DIV._savedErrors_…`. Not mine: the app's error panel is `position: fixed` at the
   top centre and WebKit's test browser fails to save every session, so the panel
   lands on the `n` handle. Proved pre-existing by stashing the source change and
   re-measuring (identical rects). Recorded in `discovered-IMP-041.md` §1–2, worked
   round in the test with `dismissErrorLog()`.
3. **`the focused handle draws no outline at all` on WebKit only.** A bare
   `focus()` leaves `:focus-visible` matching on Chromium and not on WebKit, and a
   modifier key press does not settle it. One real `page.keyboard.press('Tab')` does
   — measured across four strategies on both engines. Recorded in
   `discovered-IMP-041.md` §3.
4. **Flake after (2)'s first fix.** Clearing the panel immediately after `settle()`
   clears nothing, because autosave is a 1s trailing debounce and the panel is
   written when the save *fails*. The test now waits out the debounce and clears
   until it stays clear. Verified with three consecutive WebKit runs.
5. **Two of my own unit-test expectations were wrong** on the first run (I asserted
   a portrait frame was height-bound at a size where it was width-bound, and that a
   0×0 frame fits to 1×1 when it reads as a 1×1 frame). Fixed the expectations, not
   the function.

### Full e2e

The `.canvas` flex change touches every canvas overlay — `LayerTransformOverlay`, the
gesture layer, the Compare toggle, the canvas element `useRenderLoop` appends — so the
whole suite was run rather than the crop specs: **667 cases, 3 projects, 640 passed,
27 skipped, 0 failed, 16.8 minutes.** The 27 skips are the suite's existing
conditional ones (`E2E_MATTING`, `FULL_TAB_NAVIGATION`); none is one of the new cases.
Notably green: `journey.layout-measure` (handle reach), `journey.responsive` at
390 × 844, `journey.phone-extremes` at 320 × 568, `journey.shell`'s crop-keyboard and
inspector cases, `journey.transform-handles`, and the mobile project's
`nothing on the canvas is under the sheet`.

---

## Acceptance criteria

| # | Criterion | How it is met |
| --- | --- | --- |
| 1 | 1280 × 800: readout and `Crop s handle` share **no** overlapping area | 0 px², measured. The readout is a sibling of `.canvasStage`; the handle cannot leave the stage |
| 2 | 390 × 844: same for `s`, `n`, `e`, `w` | 0 px² for all four, both viewports, in `journey.crop.spec.ts` on chromium and webkit |
| 3 | Focusing `Crop s handle` gives a focus indicator **fully inside its own box** | `.handle:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: -3px }`, so `offset + width = 0`. Asserted as `outlineOffset + outlineWidth <= 0` on both engines; `.improve/artifacts/IMP-041/desktop-10-after-south-handle.png` |
| 4 | The readout still shows live pixel dimensions and the ratio; `Reset crop` and `Perspective` remain operable with their current accessible names | Unchanged elements, unchanged names, unchanged `cropPixelReadout` source. Asserted in the e2e case and in three jsdom cases. `Reset crop` still resets the crop and leaves the orientation alone (`CropOverlay.test.tsx`, untouched) |
| 5 | e2e: `document.elementFromPoint` at the centre of each of the four edge handles returns the handle or a descendant — on chromium **and** webkit, neither skipped | `journey.crop.spec.ts` runs on both projects; verified 7 passed on each. The spec is not in the `mobile` project's `testMatch`, so the 390 × 844 case runs on both desktop engines rather than being owned by one |

---

## Uncertain, and left out

- **The preview is smaller** (table above). Not a criterion, and not avoidable, but it
  is a real change to the crop tool's usable area and the phone figure is the larger
  of the two.
- **`perspectiveOn` moved to `EditorCanvas`.** Behaviour is preserved exactly — leaving
  the Crop tool closes the mode, as unmounting the overlay did — but the reset is now
  a render-time state adjustment rather than a mount/unmount. `e2e/fixtures.ts` notes
  that real tab navigation is dark on WebKit without `FULL_TAB_NAVIGATION`; that is
  why the focus-ring case presses one real `Tab` first. If that convention ever
  changes, this case still works, because it only needs one Tab.
- **`dismissErrorLog()` is a workaround for a bug outside this item.** It clicks a
  real, user-reachable button by its accessible name, so the gate is honest, but if
  the WebKit save failure is ever fixed the helper becomes a no-op and could be
  deleted. I did not delete it on speculation.
- **`LayerTransformOverlay` moved inside `.canvasStage`.** Behaviourally identical
  (the stage *is* `.canvas` for every other tool, since the readout row only exists
  while cropping), but it is a change beyond the strict minimum. I did it so the
  layer grips cannot acquire the same drift IMP-041's fix is about.
- **Not re-verified in this pass:** `npm run test:coverage` (red on `src/pages/**` at
  baseline per `AGENTS.md`, and this change adds no `src/pages` code), and
  `npm run build`. `npm run assets:check` is unaffected — no asset changed.