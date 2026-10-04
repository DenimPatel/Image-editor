# Discovered while implementing IMP-041

Nothing here was fixed in this change: each is a different defect from the crop
readout, found because the acceptance criteria for IMP-041 could not be measured
without either working round it or proving it pre-existing. Ordered by how much it
matters.

## 1. The "Recent problems" error panel is `position: fixed` over the canvas

**Where.** `src/components/controls/controls.module.css` → `.toastStack`
(`position: fixed; left: 50%; top: calc(var(--ie-topbar-height) + var(--space-3))`,
`z-index: var(--z-toast)`) and `src/components/ui/diagnosticsReport.module.css` →
`.savedErrors` (`pointer-events: auto`, `width: min(360px, calc(100vw - var(--space-8)))`).

**What.** Any recorded error parks a panel at the **top centre of the editor**,
over the canvas. At 390 × 844 it occupies x 20–378, y 64–193 — which is exactly
where the crop `n` handle is drawn (x 181–209, y 63–91) — and it takes
`pointer-events`, so a press aimed at the north edge of the crop box answers to a
list of error messages instead. Measured on Chromium and WebKit alike; nothing
about IMP-041 causes it.

**Why it is not fixed here.** The readout no longer paints over any handle, and
this panel is a different occluder with a different cause (a failed save). Moving
the toast stack is a layout decision for the whole editor, and the panel's
`pointer-events: auto` is load-bearing for its own "Delete these" button.

**How it was proved pre-existing.** `git stash push` of the IMP-041 source change,
then the same measurement at 390 × 844 on WebKit: identical rects
(`panelRect` x 20, y 64, 358 × 129; `n` handle at 181, 54, 28 × 28;
`elementFromPoint` at the `n` centre → `DIV._savedErrors_…`).

## 2. WebKit's test browser cannot save a session, so every WebKit run shows #1

**Where.** `src/lib/persist/session.ts` → `saveSession` returns the generic
`'error'`, which `src/pages/Editor.tsx` maps to `"Could not save this session"`.

**What.** Opening any document in Playwright's WebKit reports a save failure. It
is reproducible with no test fixture involved at all — a bare
`goto` → click a sample → open Crop is enough. This is why #1 blocks a WebKit
hit test at the top of the canvas and not a Chromium one, and it is why roughly
68 other WebKit cases pass without noticing: nothing else hit-tests that corner.

**Not fixed here.** It is a persistence bug, not a crop-overlay bug, and the fix
is not obvious from the symptom (it may be the WebKit profile, the `assets` store,
or `transaction.done`).

**Worked around in the new e2e case.** `dismissErrorLog()` in
`e2e/journey.crop.spec.ts` clears the panel through its own visible button,
waiting out `AUTOSAVE_DEBOUNCE_MS` (1000 ms) first because the panel is written
when the save *fails*, so clearing straight after `settle()` clears nothing. Three
consecutive WebKit runs of `journey.crop.spec.ts` passed after that; one run
before it flaked.

## 3. `:focus-visible` is not reliably asserted by a bare `focus()`

**Where.** `e2e/fixtures.ts` documents that real tab navigation is dark on WebKit
unless `FULL_TAB_NAVIGATION` is set, which is why a programmatic `focus()` is the
usual approach in this repo.

**What.** After a page where the last interaction was a click, `element.focus()`
alone leaves `:focus-visible` matching on Chromium and **not** matching on WebKit,
so `getComputedStyle(el).outlineStyle` reads `none` there. A `page.keyboard.press`
of a modifier does not settle it. One real `page.keyboard.press('Tab')` — which
puts the keyboard modality behind the next focus — makes both engines report
`:focus-visible` and the outline.

**Consequence for other specs.** Any e2e case that wants to measure the *focus
ring* on WebKit needs that key press first. It is not documented anywhere except
now in `journey.crop.spec.ts`. Candidates worth checking: `a11y-keys.spec.ts`,
`journey.a11y.spec.ts`, `e2e/a11y-measure.spec.ts`.

## 4. The crop frame and the canvas element were fitted by two copies of `container - 32`

**Where.** `src/hooks/useRenderLoop.ts` → `applyLayout` and (before this change)
`src/components/canvas/CropOverlay.tsx`, each with its own `Math.max(1, size - 32)`.

**What.** The crop box is drawn in **whole-frame** coordinates while the preview
deliberately drops the crop, so the overlay's frame has to be pixel-identical to
the canvas element's box. Nothing tied the two together: an independent change to
either constant puts every corner handle on the wrong pixel, and
`e2e/journey.crop-preview.spec.ts` only catches it once someone runs that one spec.
This is the constraint that decides IMP-041's shape — the readout cannot be given
space *inside* the overlay, because any space taken from the overlay is space the
canvas element is not also giving up.

**Addressed, not merely noted.** Both now call `cropFrameFit()`
(`src/lib/crop/frameFit.ts`), so the coupling is one function rather than two
constants that have to be compared in a browser.