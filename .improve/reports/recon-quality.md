# Recon — quality audit

Agent was read-only and could not write; persisted by the orchestrator from its 11 board posts.
**55 findings — 7 high / 22 med / 26 low.** 47 `src/` modules have no sibling test (~39 production).

## Lens 1 — Test coverage gaps

**1. HIGH | Background removal, the flagship feature and the whole basis of the AGPL obligation, runs
in no automated job** | `e2e/journey.background.spec.ts:134-137` + `ci.yml:160`. The only test that
clicks "Remove background" and asserts `background.removed === true` is
`test.skip(!process.env.E2E_MATTING)`; CI sets `E2E_MATTING: '0'`. `src/features/ml/matting.test.ts`
mocks `@imgly` wholesale, so the dynamic import, progress mapping, abort forwarding and
`ModelUnavailableError` classification are only ever exercised against a stub. The feature NOTICE and
`public/licenses.html` are written about has never run in CI.
*Fix:* a `continue-on-error: true` chromium matrix leg with `E2E_MATTING: '1'`.

**2. HIGH | The WebGL shader-parity gate cannot execute on the configured runner** |
`e2e/shader-parity.spec.ts:241` + `ci.yml:166`. `test.skip(!result.ok, 'no real GPU available')`.
`ubuntu-latest` has no real GPU, so the chromium leg's `--use-angle=metal --enable-gpu` flags
(`playwright.config.ts:57-64`) are ignored and every parity case skips on every PR. `AGENTS.md:91-94`
presents this spec as the gate for how the two backends differ; in practice `src/gl/*` vs
`src/render/fallback2d.ts` is unverified in every automated run. `parity.test.ts` covers the maths via
an interpreter, not the driver.

**3. MED | 47 `src/` modules have no sibling `*.test.ts(x)`; ~39 are production code.** Biggest:
`src/gl/shaders/index.ts` 684, `src/components/ui/useMenuPopover.tsx` 213, `src/gl/framebuffer.ts` 156,
`src/gl/texture.ts` 149, `src/gl/luts.ts` 131, `src/gl/limits.ts` 106, `src/gl/program.ts` 75,
`src/components/editor/PresetPopover.tsx` 152, `src/gl/context.ts` 69. Note `features/layers/factory.ts`
IS covered (`layers.test.ts:17`, `strokeRender.test.ts:25`, `panels.test.tsx:38`); `layerOps.ts` by
`layerTransform.test.ts:6`; `lib/metadata/jpeg.ts` by `exif.test.ts:184-205`; `render/cpu-passes.ts` by
`parity.test.ts`. **Nine `src/gl/*.ts` have NO test in ANY file**: context, texture, framebuffer,
program, limits, luts, pass-colors, pixel-scale, quad. *Fix:* table-driven tests per GL primitive
(`src/gl/fakegl.ts` exists), then a registry test asserting every `src/gl/*.ts` has a sibling, as
`licenses.test.ts:62-101` does for `package.json`.

**4. MED | `src/lib/metadata/abort.ts` has no test and it is the entire Cancel mechanism** |
`abort.ts:21-37`. `raceAbort` is what makes an export cancellable mid-encode
(`ExportSheet.tsx:248-255`). Grep across `*.test.*` returns nothing. *Fix:* six cases — abort-before,
abort-during, resolve, reject, no-signal, listener-removal.

**5. MED | `crc32.ts` untested, and its implementation is duplicated inside a test** |
`src/lib/metadata/crc32.ts:14` + `dpi.test.ts:4-22`. `dpi.test.ts` re-implements the CRC-32 table
verbatim instead of importing the one `png.ts:1` uses. *Fix:* import from `./crc32`, delete the copy.

**6. MED | No e2e journey for Copy edits / Paste edits** | `Editor.tsx:392-411` +
`recipes.ts:96-130`. The clipboard write/read, the 128 KB cap, the `localStorage` mirror fallback and
the four-result `RecipeWrite` machine are unit-tested, but no `journey.*.spec.ts` presses the
top-bar buttons. The mirror fallback only engages when a real browser refuses
`navigator.clipboard.writeText` — which jsdom cannot.

**7. LOW | `strokeRender.test.ts` has no `strokeRender.ts`** | it tests `src/render/layers.ts`
`drawLayers` through a recording 2D context. *Fix:* rename to `drawLayers.test.ts`.

**8. LOW | 1634 lines of `src/styles/*.css` are asserted only by a source-grep test** |
`scales.test.ts` is itself 1935 lines. `base.css`, `hub.css`, `index.css` have no unit test and no
e2e reads a rule. Accept, but `docs/FEATURES.md` must not call `hub.css` tested.

## Lens 2 — Test quality

**9. HIGH | The `--ie-tap` accessibility family is identified by regex-matching hashed CSS-module
class names — in the measurement AND in both anti-vacuity guards** | `e2e/a11y-measure.spec.ts:169-171`,
`:299`, `:314-337`. `readsIeTap` is
`/_ (iconButton|doneButton|primaryButton|boundaryActions)_/.test(element.className)`. The guard
`expect(familySeen).toBeGreaterThan(0)` at `:299` is fed by that same regex, and the vacuity test at
`:314-337` uses a third copy, `[class*="iconButton"]`. Rename `iconButton` in `controls.module.css`
and all three flip together — the file's own header at `:46-49` calls that outcome worse than no gate.
*Fix:* tag the family in the DOM (`data-tap`) and select `[data-tap]` — they already read `--ie-tap`.

**10. MED | The e2e fixture contract itself selects by CSS-module class substring** |
`e2e/fixtures.ts:328` — `page.getByRole('dialog').filter({ has: page.locator('[class*="sheetBody"]') })`.
`.sheetBody` is a real class (`controls.module.css:250`). `AGENTS.md:73-74` forbids exactly this, in
the file whose header states the rule. Every spec calling `panel(name)` for a tool with no
`SHEET_TITLE` entry depends on it.

**11. MED | Six more specs select by CSS-module class substring** |
`journey.panel-seams.spec.ts:199,200,203,204,226`; `journey.layout-measure.spec.ts:55`;
`journey.export.spec.ts:251`; `journey.desktop-truthfulness.spec.ts:303`;
`journey.desktop-honesty.spec.ts:59`; `a11y-measure.spec.ts:146,326,334` —
`helpFadeBottom`, `helpFadeTop`, `menuItemIcon`, `glyphRow`, `readout`, `sheetBody`, `footer-meta`,
`importHint`.

**12. LOW | The target-count floor in `a11y-measure.spec.ts` is denominated in deduplicated class
names** | `:153-154, 300-310`. `IconButton` composes `styles.iconButton` + optional
`styles.iconButtonActive` + a caller `className` (`IconButton.tsx:16`), so one button counts once or
twice depending on state and on the caller. Adding one wrapper class to a row inflates `measured`
toward the floor and weakens it. *Fix:* dedupe on `(accessible name, tagName)`.

**13. LOW | Three specs import `expect` from `@playwright/test` instead of `./fixtures`** |
`journey.layer-panels.spec.ts:1`, `journey.matte-alpha.spec.ts:1`, `scene.ts:1`. `e2e/fixtures.ts:410`
re-exports `expect`.

**14. LOW (positive record) | `not.toThrow()` is a real assertion almost everywhere** | 22 sites
checked (`appearance.test.ts:120,133,156,369,550`; `flags.test.ts:135,359`;
`retention.test.ts:121,126,127`; `mirror.test.ts:236`; `dataLoss.test.ts:246`; `format.test.ts:99`;
`onboardingKeys.test.ts:88,99`; `uiStore.test.ts:185`; `diagnostics.test.ts:255,558,582`;
`BottomSheet.test.tsx:259`; `useAppearance.test.tsx:234`). Every one is followed by a value assertion.
Zero `expect(true)`, zero snapshots repo-wide.

**15. LOW | e2e retries can turn a real failure into a green run** | `playwright.config.ts:29`
`retries: CI ? 1 : 0`. `journey.perf-budget.spec.ts` is most exposed. *Fix:* annotate on retry.

## Lens 3 — Error handling

**16. HIGH | A WebGL backend that fails to CONSTRUCT is swallowed with no diagnostic** |
`src/render/selectBackend.ts:48-52` — `catch { // Fall through to Canvas2D. }`. Every other renderer
failure IS recorded: `useRenderLoop.ts:401-418` records `render.fallback` and toasts "Switched to the
slower engine"; `gl/renderer.ts:258-261` records and re-throws. A driver that fails
`getContext('webgl2')` produces a silently slower editor and an EMPTY diagnostics report — and both the
Help overlay and the crash screen are built on that report.
*Fix:* `catch (error) { recordDiagnostic({ level: 'warn', tag: 'render.backend', message: 'WebGL2 construction failed; using Canvas2D.', error }) }`.

**17. MED | The autosave mirror's failure result is discarded** | `Editor.tsx:187`
`if (doc.source) writeMirror(doc)` — `writeMirror` returns `'too-large'|'unavailable'|'error'`
(`mirror.ts:91`) and all three are dropped. `createAutosave` try/catches and swallows
(`autosave.ts:90-96`). The mirror is the ONLY thing that survives a hard reload inside the debounce
window (`mirror.ts:5-17`). *Fix:* toast `'error'` once per session on a non-`unavailable` failure.

**18. MED | Both "delete my work" paths ignore a failed session delete** | `Editor.tsx:341`
(`void clearSession()`) + `RouteError.tsx:39-41` (`.catch(() => undefined)`). `clearSession` already
swallows internally (`session.ts:304-313`), so the `.catch` is dead code; if the delete DID fail the
UI still drops the resume card and navigates. The user is told the photo is deleted and it is still
in IndexedDB — and `RouteError`'s button label promises "deletes your photo and edits".
*Fix:* have `clearSession` return a boolean; render an error state when false.

**19. LOW | `PassportPanel`'s auto-frame returns silently when there is no source** |
`PassportPanel.tsx:628` `if (!present.source) return` inside the `try`, and
`finally { setBusy('idle') }` hides even the spinner.

**20. LOW | Six `catch { }` blocks in the persistence layer with no diagnostic** |
`session.ts:310`; `mirror.ts:108,165,187,219`; `retention.ts:75`. Each is defensible and commented, but
a quota-refused `setItem` and a Safari-private-mode `SecurityError` are exactly the two conditions
users report, and neither reaches `recordDiagnostic`.

**21. LOW | `renderer.ts` swallows the LUT prepare rejection on the render path** |
`gl/renderer.ts:281` `void this.prepare(doc).catch(() => {})`. The user-visible toast comes from an
independent `useRenderLoop` subscription (`:430-436, 454-458`), so this is a second, silent consumer of
the same failure — a frame drawn between the two subscriptions ships the look UNGRADED while the doc
says otherwise.

## Lens 4 — Security & privacy

**22. MED | `comlink` is a declared runtime dependency with no importer, and is published to users as
bundled work** | `licenses.ts:302-315` + `public/licenses.html:673-688` + `vite.config.ts:70`. Grep
finds `comlink` ONLY in its own licence row and the licence page — where a reader is told it
"contributes nothing to the bundle", a false statement in the attribution document. `vite.config.ts:70`
also justifies `worker.format: 'es'` with "so `comlink` and dynamic imports work".
*Fix:* delete the dep, the licence row, regenerate `public/licenses.html`, reword `vite.config.ts:70`.

**23. MED | `onnxruntime-web` is a runtime dependency no module imports** | `package.json:45` +
`vite.config.ts:65-67`. Presumed pinned to control the wasm the CDN-loaded `@imgly` build resolves; if
so that intent belongs in the entry's `why` field, which says only "Runs the matting model in
WebAssembly for the Background tool" (`licenses.ts:352-354`).

**24. MED | The clipboard is read on page MOUNT, with no user gesture** | `Editor.tsx:223`
`void hasClipboardRecipe().then(setCanPaste)` → `navigator.clipboard.readText()`
(`recipes.ts:117-119`). Deliberate and tested (`Editor.test.tsx:182`), and `looksLikeRecipe` filters
the result — but on a page the user merely opened, the app asks for clipboard contents.
*Fix:* read the `localStorage` mirror on mount; touch `navigator.clipboard` only inside the Paste click.

**25. LOW | The SPA-redirect shim trusts an unvalidated `sessionStorage` value as a navigation target**
| `index.html:157-166` + `public/404.html:13`. `replaceState` refuses cross-origin URLs so the blast
radius is same-origin and the `try/catch` absorbs the throw — but the value is never checked for being
a path under the app base. *Fix:* store `l.pathname + l.search + l.hash` and require the app base.

**26. LOW (positive record) | No telemetry, no outbound network beyond the matting CDN — CONFIRMED** |
`gl/luts.ts:97`, `lib/decode.ts:244`, `features/ml/matting.ts:61`. Every `fetch(` is same-origin or
the `@imgly` CDN. No `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, `postMessage`, `eval`,
`new Function` or `dangerouslySetInnerHTML` in `src/`. `diagnostics.ts:271-288` asserts its own lack of
a transport against the source; `privacy.ts:49-51` discloses the CDN; `public/sw.js:83` refuses
cross-origin caching; `index.html:41-49` documents removing the Google Fonts link for this reason.

## Lens 5 — Performance

**27. HIGH | Every store update runs a full deep-equality walk of the whole `Doc`, on the pointermove
path** | `docStore.ts:88` + `EditorCanvas.tsx:125-139`. `update()` calls `structurallyEqual(next,
state.present)` — a recursive walk of every key, every layer, every stroke point — before deciding
anything changed. `EditorCanvas.onDrag` calls `update()` on EVERY `pointermove` while appending a
point, so a stroke of n points costs **O(n²)** in comparisons. Drag coalescing (`history.ts:102-104`)
does not help: `structurallyEqual` runs before `applyEdit`.
*Fix:* pass an explicit `changed` hint from the drag path, or short-circuit to the last stroke point
when `options.key` is the draw key.

**28. MED | `createDoc()` is called on every rendered frame while Compare is held** |
`useRenderLoop.ts:338`. Up to 60x/second for as long as Compare is held; line 342 then allocates a
second object graph for the crop path. *Fix:* hoist one module-level unedited template.

**29. MED | `SegmentedControl` re-renders on every `ResizeObserver` tick because `rowsFor` returns a
fresh array** | `SegmentedControl.tsx:102-117` + `segmentRows.ts:117-137`. The preceding `measure()`
(`:38-68`) reads `getBoundingClientRect()` once per button plus `clientWidth` on two elements, so each
render also forces a synchronous layout. *Fix:* `setRows((cur) => sameRows(cur, next) ? cur : next)`.

**30. MED | `getBoundingClientRect()` is read on every pointer event in three drag handlers** |
`EditorCanvas.tsx:45`, `transformHandles.tsx:120`, `CurvesEditor.tsx:168`. `EditorCanvas` writes the
canvas `transform` every frame via `applyLayout` (`useRenderLoop.ts:320-322`), so each move is a forced
synchronous reflow. `transformHandles.tsx:110-113` justifies not caching the box.
*Fix:* read the box once in `onStart` into the drag basis, refresh on resize/scroll.

**31. LOW | The rAF loop re-arms unconditionally, waking at 60 Hz for the whole session** |
`useRenderLoop.ts:368-370` — `raf = requestAnimationFrame(loop)` then `if (!dirty) return`. Every
producer already sets `dirty = true`. *Fix:* stop re-arming when `!dirty`.

**32. LOW | The blend-chip row's overflow fade measures on `window.resize` only** |
`LayerPanels.tsx:184-195`. The comment says a `ResizeObserver` "would have thrown in every render"
under jsdom — **a test-environment constraint shaping production behaviour**. The row also changes
width on sheet-detent change, scrollbar appearance, and inspector breakpoint; none fire `window.resize`.
`ChipRow.tsx:52-60` already uses a `ResizeObserver` correctly.

**33. LOW | A full-resolution re-encode per debounce tick in the export estimate** |
`ExportSheet.tsx:186-226` on a 350 ms debounce. `inFlight.current?.abort()` bounds concurrency;
nothing bounds how often a slider drag restarts it. *Fix:* render the estimate from the 256 px proxy
the auto-tone path already builds (`Editor.tsx:359-361`).

## Lens 6 — Accessibility

**34. HIGH | The bottom-sheet detent has NO keyboard route** | `BottomSheet.tsx:167` (handler
`:73-92`) — `<div className={styles.sheetGrabber} onPointerDown={onPointerDrag} />`, a bare div with a
pointer handler, no `role`, no accessible name, not focusable. `onDetent` is called from exactly one
place: that drag's `onEnd`. Both e2e drivers use touch (`journey.mobile-touch.spec.ts:556`,
`journey.inspector-layout.spec.ts:259`). A keyboard or switch user on a phone cannot raise or lower
the sheet — the documented way to get the image back (`EditorCanvas.tsx:226-228`).
*Fix:* `role="separator"`, `aria-orientation="horizontal"`, `tabIndex={0}`,
`aria-valuenow`/`aria-valuetext`, and ArrowUp/ArrowDown/Home/End routed through the same `onDetent`.

**35. MED | `BottomSheet`'s focus trap overrides `tabIndex={-1}` decisions** | `BottomSheet.tsx:10,
126-143` — `const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'`.
The `:not` applies to `[tabindex]` only, so a control that asked to be left out of the tab order is
pulled back by `focusable()[0]?.focus()` on open. `HelpOverlay.tsx:31-48` gets this exactly right and
documents why; the two traps in one repository disagree.

**36. MED | `Stepper` announces no value and associates no label** | `Stepper.tsx:19-31`. The
`fieldLabel` span has no `htmlFor`; the value span has no `role` and no `aria-live`. Pressing "Increase
Width" moves a number a screen reader never reads. The component has no test.

**37. LOW | `ColorField` gives no accessible value** | `ColorField.tsx:12-21`. The name is right, but
`input[type=color]` exposes no text value, so a reader hears "Colour, colour picker", not `#3366ff`.
*Fix:* `aria-valuetext={value}` plus a visible hex readout.

**38. LOW | `ParameterRing`'s correct aria pairing is unpinned** | `ParameterRing.tsx:39, 66-69`. The
pattern is right; the component has no test, so nothing pins the pairing if a `title` is added later.

**39. LOW (record) | Three HelpOverlay controls share single digit keys** | `HelpOverlay.tsx:256-274,
301-311, 371-380`. Four `tabIndex={-1}` controls reachable only via `d`, `1`-`9`, `0` on a
capture-phase `document` listener. Documented at length, printed in the labels, tested in
`journey.a11y-keys.spec.ts`.

**Contrast tokens are NOT a finding.** `--ie-ink-soft` on `--ie-chrome-solid` ~5.9:1, `--muted` on
`--bg` ~5.2:1; `scales.test.ts` measures all 24 pairs at three thresholds. The one soft spot is
`--ie-hairline` at rest, deliberately measured at threshold `0` (`scales.test.ts:2205-2213`).

## Lens 7 — Dependency health

**40. MED | No missing dependency, no bad range, and every runtime dep has a licence row** |
`package.json:38-50` + `licenses.ts:276-395`. All ten runtime deps are `direct: true` with version,
licence, https upstream and a `why`; all seven transitive rows name a `via` that is still declared.
`licenses.test.ts:62-101` asserts all four directions and `scripts/verify-assets.mjs` calls the same
exported functions, so the table cannot rot silently. The two inaccurate rows are 22 and 23.

**41. LOW | `@imgly/background-removal@1.7.0` is pinned exactly while every other runtime dep uses
`^`** | `package.json:39, 45`. Correct for an AGPL dep whose CDN chunks must match the wasm — but
nothing tests *why*, so a routine `npm-check-updates` turns it into `^1.7.0` and no gate fails, on the
one dependency whose licence is an open owner decision.

**42. LOW | `.prettierrc.json` sets no `proseWrap`** | `:1-6`. `printWidth: 100` with the default
`preserve` means prose line lengths will diverge as the docs grow. Not a red gate today.

## Lens 8 — CI

**43. MED | The "asset guard is real" step accepts ANY build failure as proof** | `ci.yml:64-71` —
`if REQUIRE_ASSETS=1 npm run build; then ... exit 1; fi`. `prebuild` runs `scripts/fetch-models.mjs`,
which downloads and sha256-verifies 14 woff2 over the network (`fetch-models.mjs:25-31`). A CDN flake
or a tsc error from the same commit makes the build fail for the wrong reason and the step reports
GREEN. *Fix:* capture output and grep for `kodak-portra`, failing loudly otherwise.

**44. MED | The GitHub Pages deploy runs neither the coverage gate nor any e2e** |
`deploy.yml:29-49`. It runs format, lint, typecheck, `npm test`, the three generators,
`assets:verify` and `REQUIRE_ASSETS=1 npm run build`, then uploads `dist`. It does not `needs` the
`ci.yml` build job. The artefact users download is gated on unit tests but not on the per-area
coverage thresholds and not on a single journey.

**45. LOW | All three Playwright projects ARE selected — the matrix shape is now correct** |
`ci.yml:133-139`. The AGENTS.md:65-69 defect is closed. Residual: a fourth project added to
`playwright.config.ts` is silently unselected — the same failure mode, one level up.

**46. LOW | `a11y-matrix.spec.ts` runs on two of three legs by design, and says so** |
`a11y-matrix.spec.ts:7, 204, 270` — `MATRIX_ENGINE = 'chromium'`, so the 14 contrast cases across
8 theme x accent states are dark on WebKit. Documented contention-induced flakiness.

**47. LOW | Every real-`Tab` assertion in the repository is dark on the WebKit leg** |
`journey.shell.spec.ts:43`, `journey.a11y-keys.spec.ts:72, 269`, `journey.appearance.spec.ts:221` —
all four gate on `FULL_TAB_NAVIGATION` (Safari's "full keyboard access"). Roughly a third of keyboard
coverage is never executed on the engine `AGENTS.md:57` calls "the project that catches the Safari-only
behaviour". Each skip is documented; the aggregate is not.

**48. LOW | Capability-gated skips are reported only as "did not run"** | `journey.context-loss.spec.ts:120,
158`, `shader-compile.spec.ts:54, 111`, `shader-parity.spec.ts:241`. On `ubuntu-latest` the last is
always true (finding 2). *Fix:* emit the skip reason as a `testInfo.annotation`.

## Lens 9 — Tooling

**49. HIGH | `.improve/` is in neither `.gitignore` nor `.prettierignore`, so the repo-wide format gate
fails on agent artefacts** | `.prettierignore:1-16`, `.gitignore:1-47`, `ci.yml:33`. Prettier 3's
default `--ignore-path` is `[.gitignore, .prettierignore]`. `.prettierignore:3-6` shows exactly this
having happened before with `.kilo/`: *"a 95-file diff in someone else's checkout is not a format gate,
it is sabotage"*. **ALREADY FIXED by the orchestrator in `676b733` — added `.improve/` to
`.prettierignore`. Recorded so it is not re-raised.**

**50. MED | No `.editorconfig`** | repo root. There is `.prettierrc.json`, `eslint.config.js` and
`.prettierignore`, and no `.editorconfig`. A contributor with no Prettier integration gets tabs,
4-space indent and CRLF — none of which any gate checks until `format:check`.

**51. MED | No `.gitattributes`** | repo root. No `* text=auto eol=lf`, no `*.png binary`, no
`*.woff2 diff=binary`. On Windows checkouts the 14 committed `.woff2` and the 24 look strips would show
as whole-file rewrites in every diff.

**52. LOW (confirmed) | `npm run typecheck` IS in CI, in both workflows** | `ci.yml:35` +
`deploy.yml:38`.

**53. LOW | The coverage-threshold story is coherent, but six TEST DOUBLES sit in the per-area
denominators** | `vite.config.ts:126-207`. `vite.config.ts:136` excludes only `*.test.*`, `*.d.ts`,
`main.tsx`, `vite-env.d.ts` — so `gl/fakegl.ts` 446, `gl/glsl-eval.ts` 1041, `render/gl-replay.ts` 273,
`render/fake2d.ts` 224, `features/export/fakeCanvas.ts` 287, `lib/persist/fakeIndexedDb.ts` 401 count
as shipped source: **2672 lines of test infrastructure diluting `src/gl`, `src/render` and `src/lib`**,
and a 1041-line GLSL interpreter sits in the "0% and therefore at risk" surface.
*Fix:* add the six to `coverage.exclude`, or move them to `src/testing/`. This RAISES the real numbers
and makes `src/gl`'s `functions: 89` a claim about production code.

**54. LOW | The `router.tsx` threshold encodes a gap as an acceptable number** | `vite.config.ts:201-206`
— `functions: 33` with `branches: 100` on a 63-line module means 4 of 6 functions are uncovered and the
gate cannot notice a fifth. The comment blames the `lazy()` thunks, but `router.tsx:21-22` declares
exactly two lazy routes, so `33` is 2/6 — coincidentally right rather than measured.

**55. MED | Three numbers in `AGENTS.md` disagree with the tree** | `AGENTS.md:38, 44, 121, 43`.
Verified: `npm test` = **153 files / 3060 tests** (not 2974/148); `playwright test --list` =
**659 tests in 41 files** (not 623/38); coverage on `src/pages/**` = **51.3 vs 48, green** (not "RED at
37.4 vs 38"). By `AGENTS.md:126-127` the commands win and the document is the bug.

## Positive results worth recording

- **No `dangerouslySetInnerHTML`, no `eval`, no `postMessage`, no `sendBeacon`, no telemetry, no
  outbound network beyond same-origin assets and the disclosed imgly CDN** (26).
- Zero `expect(true)` and zero snapshots repo-wide; all 22 `not.toThrow()` sites are paired with a
  value assertion (14).
- All 63 `addEventListener` sites have a matching removal or a documented singleton — verified
  individually, no finding.
- All three Playwright projects ARE selected by the matrix (45).
- `npm run typecheck` is in both workflows (52).
- No missing dependency and no bad version range (40).
- Contrast tokens all clear their thresholds (Lens 6).