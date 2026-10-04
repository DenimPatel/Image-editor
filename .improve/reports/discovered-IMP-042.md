# discovered-IMP-042 — found while fixing IMP-042, not fixed here

Five things. Three were reported by the verifier on attempt 1 and are still open; two
are new. None of them is fixed here: they belong to other items or to nobody, and a
scope-creep fix inside this one is how a diff stops being readable.

---

## 1. `scroll-padding-inline` sets the *right* inset from the *left* one — open

`src/components/editor/editor.module.css:668` (the `@media (max-width: 480px)`
`.tabBar`) writes:

```css
scroll-padding-inline: calc(8px + var(--ie-safe-left));
```

It is a shorthand, so it sets `scroll-padding-right` from the **left** safe inset,
while `.tabBar`'s own `padding-right` at `:256` is
`calc(8px + var(--ie-safe-right))`. On a device in landscape with a right safe inset
the last tab therefore snaps a safe-area's width short of where the bar's own padding
puts it — the snap and the padding disagree about where "the end" is.

Fix: `scroll-padding-left: calc(8px + var(--ie-safe-left); scroll-padding-right:
calc(8px + var(--ie-safe-right));`.

**Zero visible effect at 390x844 portrait**, where both insets are 0, which is why no
test in this change sees it and why this report exists rather than a code comment.
The reason there is no unit pin for it either is in
`responsiveLayout.test.ts › snaps by proximity, not by mandate…`: pinning the wrong one
of two spellings is how a gate ends up defending a defect.

## 2. `GlyphRow` still carries its own copy of the scroll measurement — open

`src/components/tools/LayerPanels.tsx:184-196` measures `el.scrollWidth >
el.clientWidth + 2` with its own `resize` listener, alongside `ChipRowShell` and
`ToolTabBar`, which both now read `src/hooks/useScrollEdges.ts`. The hook's header
says the measurement "lives here now", which is true of two of the three callers. The
tolerance also differs (`+ 2` rather than the hook's 1px), so a row that overflows by
exactly 2px fades in `GlyphRow` and does not in the others.

Follow-up item. Nothing in this change touched it and its behaviour is unchanged.

## 3. The mobile baselines were captured at `roomy` + `xlarge`; the desktop ones at default — open, cross-cutting

**Recorded here because it must not be lost, and deliberately not fixed here.**

The nine `mobile-*` screenshots in `.improve/artifacts/baseline/` were captured at
`density: roomy` + `textScale: xlarge`. `.improve/FEATURES.md` IMP-042 quotes
`scrollWidth 1019` and "Background bisected"; only `roomy` + `xlarge` reproduces
either — at the default appearance the same build measures 897 and shows `Background`
whole at 356.77px of a 390px row. `baseline/mobile-05-editor-loaded.png` corroborates
it: a 73.75px tab pitch is `62 × 1.125` plus a 4px gap, i.e. roomy.

The twenty-one `desktop-*` baselines were captured at **defaults**
(`desktop-11-adjust-panel.png` has the default 72px pitch). `REPO_PROFILE.md` §0 records
neither fact.

Consequences for anything else in flight: every mobile defect derived from those nine
screenshots was measured against a bar, a sheet and a chip row 12–17% larger than a
default user's. A threshold set from those numbers is either over-tight (sized to the
inflated value) or will look already-fixed at defaults. Neither is visible until
someone runs the app at defaults.

Recommended: record the appearance per screenshot in `REPO_PROFILE.md`, re-capture the
nine mobile baselines at defaults or capture both sets, and re-measure any in-flight
mobile item that quotes a number off them.

**This change's own before/after numbers were re-measured at the default appearance**
for exactly that reason, and are in `.improve/reports/impl-IMP-042.md`. The IMP-042
metric change is real at defaults (`897 → 785` of `scrollWidth`, 5 whole tools → 6) and
much larger at `roomy` + `xlarge` (`1019 → 899`, 4 whole tools → 5). Reporting only the
second number would overstate it by about a third.

## 4. The paint gate runs on one engine — new

`e2e/journey.mobile.spec.ts › every tool is reachable, and both edges say what is past
them` measures the fade by differencing decoded pixels, with `FADED = 8` and
`QUIET = 1` on a 0..255 channel difference. Those thresholds are the *measured*
populations on the `mobile` project (Chromium, 390×844, CSS-pixel scale): 136 / 71 /
136 / 164 painted, exactly 1 unpainted.

The `mobile` project is Chromium-only — `playwright.config.ts` scopes it to
`journey.mobile*`, and one-finger drags need CDP — so this claim is **not** gated on
WebKit. The mask defect reproduced on both engines, and WebKit aliases `mask-image` to
`-webkit-mask-image` and paints it, so the fix is engine-independent; but "engine-
independent" here is a measurement someone took, not a gate that runs.

If WebKit coverage of this bar is wanted, the cheap version is a `clip`-screenshot
byte comparison inside `e2e/journey.responsive.spec.ts`, which already runs on both
projects and already sets appearance four ways. It would need its own `QUIET` floor
measured on WebKit's compositor first — 1 is Chromium's dithering noise and should not
be assumed elsewhere.

## 5. `.improve/FEATURES.md` IMP-042 is still `TODO`, and `docs/FEATURES.md` has no row — open

Attempt 1 left both alone, on the grounds that verification was its own and that adding
a `docs/FEATURES.md` row means updating six sets of counts in one pass. That reasoning
still holds for the implementer. It stops holding the moment a human accepts this
attempt, and at that point the status needs flipping in both places or the next agent
picks up a finished item.