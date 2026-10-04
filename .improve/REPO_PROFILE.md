# Repository profile — Image-editor

Baseline captured **2026-10-04** on branch `improve/auto-20261004` at `676b733` (from `10ade26`),
working tree clean except untracked `.improve/`. Every number below is a command's output or a
line in one of the five recon reports in `.improve/reports/`.

---

## 0. The operator's priority, stated up front

**This loop is ordered by USER JOURNEY DEFECTS FIRST, then UI/UX polish, then
correctness/testing/tooling.**

1. **Journey defects** — dead ends, missing reversals, traps, lost-work risk. The recon mapped
   **32 journeys** and found **19 dead ends (4 critical, 5 high, 7 medium, 3 low)**, and
   **11 of the 12 journeys with no e2e coverage are exactly the dead-end and reversal paths**.
2. **UI/UX polish** — 30 baseline screenshots in `.improve/artifacts/baseline/` and the visual
   defects measured off them (2 critical, 6 high, 9 medium, 9 low).
3. **Correctness, testing, tooling** — 55 quality findings, documentation drift, coverage gaps.

The owner's own worked example is the top of the queue, and it is **D-01 / C-02**: *after picking a
stock image there must be a visible, discoverable way to choose or upload a different one — today
there is none.* `src/pages/Editor.tsx:482` unmounts `ImportScreen` permanently once `source`
exists; the top bar holds only Close / Undo / Redo / More / Done
(`src/components/editor/EditorTopBar.tsx:116-175`); and `useDocStore` is a **module singleton**
(`src/store/docStore.ts:80`), so the Hub's "Start editing" (`src/pages/Hub.tsx:165`), Nav's "Open
Editor" (`src/components/ui/Nav.tsx:42`) and every tool card reopen **the same image**. The only
exit is a full browser reload. This is one of the two critical findings and it is not a test-only
defect — it needs a journey spec as well as the affordance.

---

## 1. Purpose and audience

**Purpose.** A fast, free, entirely client-side photo editor with an iOS-Photos-style,
canvas-first interface. A photo is imported, decoded and filed as a JSON-serializable `Doc`; every
edit — crop, straighten, perspective, 15 adjustments, curves, HSL mix, 24 film-looks, layers,
redaction, retouch, passport framing, background removal — is stored as data and re-rendered on
demand, so undo/redo, IndexedDB session resume and copy/paste-edits are exact. The output is a
JPEG / PNG / WebP / AVIF / PDF written by the browser's own encoders. Nothing is uploaded, there
is no account and there is no server.

**Audience, end users first.** A person who opens the app rather than the repository: someone
with one photo and a job to do, on a phone about as often as on a laptop, who will notice a dead
"Done" button and a crop handle they cannot focus but will never read a source file. They are
non-technical, they are not told what a `Doc` is, and they must be able to get back to where they
were from every screen. The maintainer comes second: a single maintainer of a late-production,
v1.0.0 project who also maintains the 20-file `scripts/` toolchain, the CI workflows and the
`docs/FEATURES.md` catalogue — and who has written down, at length and deliberately, which
questions are settled and which are not.

---

## 2. Repo type

**Client-side-only SPA image editor.** No server, no API, no database, no auth, no telemetry.
`package.json` is `private: true` with no `exports`, `main` or `types` — **there is no public
library surface**; every `export` in `src/` is an internal module boundary. Deployed as `dist/` to
GitHub Pages, with SPA deep-link recovery via `public/404.html`. It is also a self-hosting
toolchain repo: `scripts/` holds 20 `.mjs` files, 7 of which have their own `*.test.mjs`.

336 files / ~91.0k LOC under `src/` (`components` 148f/35.4k, `lib` 80f/20.0k, `gl` 27f/7.9k,
`features` 38f/8.0k). Stack: Vite 8 + React 18 + TypeScript 5.9 + zustand 5 +
react-router-dom 6 + `@use-gesture/react`, with `comlink`, `fflate`, `idb`, `jspdf` (lazy chunk),
`onnxruntime-web` 1.21.0 (pinned) and `@imgly/background-removal` 1.7.0 (pinned, **AGPL-3.0**).

Two stores, deliberately separate: `src/store/docStore.ts:80` is undoable, persisted **content**;
`src/store/uiStore.ts:217` is **chrome** (tool, sheet detent, viewport, compare, selection, jobs,
toasts, errors).

---

## 3. Verified commands

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
```

`node`/`npm` are **not** on the default PATH. That export is not optional.

| Command | What it proves | Wall clock (measured) |
| --- | --- | --- |
| `npm test` | 153 files / **3060 tests** pass under jsdom, `tsconfig`-checked. `Test Files 153 passed (153)` / `Tests 3060 passed (3060)`. | **63.6 s** (re-measured) / 70.4 s (runbook) |
| `npm run test:coverage` | the same tests plus the ten per-area thresholds in `vite.config.ts:191-207`. Totals 89.57 % stmts / 81.42 % branches / 92.23 % lines. | **123.1 s** |
| `npm run typecheck` | `tsc -b`, no output, exit 0 | seconds |
| `npm run lint` | `eslint .`, no output, exit 0 | seconds |
| `npx prettier --check .` | repo-wide format, the CI gate in `ci.yml:33` and `deploy.yml:36` | **9.3 s** |
| `npm run build` | `assets:check` → `tsc -b` → `vite build` → bundle → public budget. `✓ built in 1.50s`, `bundle check passed`, `✓ public/ is 1.95 MB across 74 files`. | **~30 s** |
| `npx playwright test --list \| tail -1` | `Total: 659 tests in 41 files` = 320 chromium + 320 webkit + 19 mobile. **Never remember this number.** | seconds |
| `find src e2e scripts -name '*.test.ts*' -o -name '*.test.mjs' \| wc -l` | 153 — consistent with vitest's own count | instant |
| `git status --porcelain public/` | must be **empty** (0 lines) before a release | instant |
| `lsof -nP -iTCP:5173 -sTCP:LISTEN` | the dev server. **OCCUPIED at baseline** — PID 27068, this repo's `vite --host 0.0.0.0 --port 5173 --strictPort`, deliberately left up. Do not kill it. | instant |
| `npm ls --depth=0` | 29 top-level deps, exit 0, no `invalid`, no `UNMET` | seconds |

Fast paths:

```bash
npx vitest run src/lib/curves.ts          # scope to one file. Never -u / --update.
npx vitest run src/render/parity.test.ts  # ~4 min for 43 cases; run it ALONE
npm run appearance:sync                   # regenerate index.html's pre-paint script
npm run luts:gen -- --check               # and thumbs:gen / icons:gen: verify a generator
npm run assets:check                      # what `npm run build` runs first
```

**Do not run** `npm run test:e2e` casually — it is minutes across three projects. It starts its
own dev server on **port 5317**, so it never collides with 5173.

**Benign stderr noise, exit 0, not a regression.** `npm test` and `npm run test:coverage` print a
large volume of jsdom `Error:` output. Two known sources, both deliberate:

- `The document names a source the editor no longer holds (asset_not_a_bitmap)` — thrown from
  `bitmapFor` at `src/pages/Editor.tsx:104`; a test exercises that path.
- `Not implemented: HTMLCanvasElement.prototype.getContext` / `.toDataURL` — from the caps probes
  at `src/gl/caps.ts:166` and `:181`. jsdom has no WebGL; the probes are supposed to degrade.

The same run prints `Environment jsdom was created 153 times`. That hint is not a gate.

---

## 4. Gate baseline

**AT BASELINE EVERY GATE IS GREEN, INCLUDING `npm run test:coverage`.**

`AGENTS.md` claims coverage is **RED** on `src/pages/**` branches "37.4 vs 38". That is stale and
wrong. `vite.config.ts:199` actually sets `src/pages/**` to `60/48/47/57`, and the measured run is
**63.0 / 51.3 / 50.9 / 60.9** — green with +3.3 on branches. **That drift is itself a backlog
item**, and a dangerous one: a stale "RED" on a green gate sends the next implementer to write
tests that are not needed. Fix the docs before writing coverage tests.

**Pre-existing failures: the list is empty.** A verifier must not attribute any failure to a
change unless it appears in the list below, and the list below contains **no failing gate** — only
known-flaky and timing items.

| # | Gate | Command | Baseline | Time |
| --- | --- | --- | --- | --- |
| 1 | Unit | `npm test` | **exit 0** — 153 files / 3060 tests | 63.6 s |
| 2 | Typecheck | `npm run typecheck` | **exit 0** — no output | seconds |
| 3 | Lint | `npm run lint` | **exit 0** — no output | seconds |
| 4 | Format | `npx prettier --check .` | **exit 0** — `All matched files use Prettier code style!` | 9.3 s |
| 5 | Build | `npm run build` | **exit 0** — built, bundle check passed, public budget passed | ~30 s |
| 6 | Coverage | `npm run test:coverage` | **exit 0** — all ten areas green | 123.1 s |
| 7 | e2e inventory | `npx playwright test --list` | **exit 0** — `Total: 659 tests in 41 files` | seconds |
| 8 | `public/` hygiene | `git status --porcelain public/` | **empty**, 0 lines | instant |

The runbook's `FAIL-1` (`prettier` red on `.improve/STATE.md`) **is resolved**: `.improve/` was
added to `.prettierignore` in commit `676b733`, and I re-ran the gate to confirm exit 0. If a
format failure reappears naming a path under `src/`, `e2e/`, `scripts/`, `.improve/` itself, or a
root config file, it is new.

### Known-flaky and timing items — not failures

| Item | Where | Rule |
| --- | --- | --- |
| `src/render/parity.test.ts` ~4 min for 43 cases; one case can hit the 20 s `testTimeout` | `src/render/parity.test.ts` | **A timeout under concurrent load is not a failure.** Re-run it alone before believing it. |
| `shader-parity.spec.ts` and `shader-compile.spec.ts` skip on a software rasteriser | `e2e/shader-parity.spec.ts:241`, `e2e/shader-compile.spec.ts:54,111` | The skip records the renderer string. **A skip is never a pass.** |
| Capability skips reported only as "did not run" | `e2e/journey.context-loss.spec.ts:120,158` | Named reason; not a failure. |
| `playwright.config.ts:29` — `retries: CI ? 1 : 0` | e2e | A retried-and-passed case is indistinguishable from a clean pass; `journey.perf-budget.spec.ts` is most exposed. |
| `a11y-matrix.spec.ts` runs on 2 of 3 legs by design | `a11y-matrix.spec.ts:7` | `MATRIX_ENGINE = 'chromium'`; the 14 contrast cases are dark on WebKit. Documented contention flakiness. |
| Real-`Tab` assertions are dark on the WebKit leg | `journey.shell.spec.ts:43`, `journey.a11y-keys.spec.ts:72,269`, `journey.appearance.spec.ts:221` | All four gate on `FULL_TAB_NAVIGATION` (Safari's "full keyboard access"). Roughly a third of keyboard coverage never executes on WebKit. |
| Baseline-diff rule for counts | — | A **unit** count moving with no test files added is a regression. An **e2e** count moving is expected when cases are added. |

---

## 5. How to verify a change in this repo

**Prefer a unit test.** If the claim can be made without a browser, it must be. The e2e suite is
minutes, not milliseconds.

### 5.1 Pure logic → a sibling `*.test.ts`

Put the test next to the source as `<sibling>.test.ts`, jsdom environment, no React where the
source has no React. Fast path:

```bash
npx vitest run src/lib/curves.ts
```

For anything touching a `Doc` field, the default in `src/model/defaults.ts`, or the schema, the
sibling test is `src/model/migrate.test.ts`.

### 5.2 UI / interaction → `e2e/journey.*.spec.ts` on the fixture

**Build it on the `test` from `e2e/fixtures.ts`.** Do not write a raw
`import { test } from '@playwright/test'` in a new spec. The fixtures are the contract
(`e2e/fixtures.ts:159` exports the extended `test`; `:410` re-exports `expect`).

- **Locate by accessible name or role, never by a CSS-module class.** A `styles.foo` selector dies
  on the next rename and says nothing about keyboard reachability. Note that the existing codebase
  violates this in seven places (`e2e/fixtures.ts:328` `[class*="sheetBody"]` plus
  `journey.panel-seams`, `journey.layout-measure`, `journey.export`, `journey.desktop-truthfulness`,
  `journey.desktop-honesty`, `a11y-measure`) — do not copy the pattern.
- **Assert on `readDoc()` (the live store) or `persistedDoc()` (the stored row)** — not on a value
  copied into the test.
- **`readDoc()` resolves the app's module URL out of
  `performance.getEntriesByType('resource')` and imports that** (`e2e/fixtures.ts:96-100`). On a
  warm dev server the bare `src/store/docStore.ts` specifier can hand back a _second_, empty
  module instance. **Do not simplify it back.** It will not error; it will return a truthy default
  document, and every assertion downstream will be about an empty editor while the screenshot shows
  the real one. The fixture already detects this and fails loudly (`e2e/fixtures.ts:359`).
- **Downloads: assert on the bytes** via `readImageHeader(bytes)` (`e2e/fixtures.ts:425`), not on
  "not empty".
- **Never let a test download the matting model.** `@imgly/background-removal` pulls ~42 MB from
  a CDN (84 MB for best-quality). The matting journey is behind `E2E_MATTING=1`, which is off by
  default and `ci.yml:160` sets `'0'`.
- All three Playwright projects must appear in the matrix — `ci.yml:133-139` selects
  `chromium/chromium`, `webkit/webkit`, `mobile/chromium`. The `mobile` project owns
  `testMatch: /journey.mobile/`, which is **two** specs (`journey.mobile.spec.ts`,
  `journey.mobile-touch.spec.ts`), 19 cases. It is a prefix, not a filename.

### 5.3 Shader / GPU claims → `e2e/shader-compile.spec.ts` and `e2e/shader-parity.spec.ts`

`shader-compile.spec.ts` compiles **every exported shader on the real driver** and is the gate for
the whole class of "the shader does not compile" defects. `shader-parity.spec.ts` compiles the real
GLSL in a real WebGL2 context and compares it to `runCpuPasses`
(`src/render/cpu-passes.ts:903`). **Both skip on a software rasteriser (SwiftShader, llvmpipe) and
record the renderer string in the report, so a skip can never be read as a pass.** Do not make them
trust a software renderer. `parity.test.ts` covers the maths through the GLSL interpreter
(`src/gl/glsl-eval.ts`), not the driver — it does not substitute for either spec.

### 5.4 Visual / UX claims → Playwright MCP against the dev server

**jsdom has no WebGL and computes no layout.** jsdom reports `scrollWidth === clientWidth === 0` for
**every** element, so a jsdom overlap assertion passes on a panel that covers the bar by any
amount. Any claim about what is reachable, visible, on top of, or off-screen is unproven until a
real engine has run it.

- Server: the **already-running dev server on 5173**. It is PID 27068, this repo, with
  `BASE_URL = /Image-editor/` — `GET /` returns `302 → /Image-editor/`, so the bare origin is not
  the app. Test `http://localhost:5173/Image-editor/`.
- Viewports: **desktop 1280 × 800 and mobile 390 × 844**, DPR 1, screenshots at `scale: 'css'`.
- Screenshots to **`.improve/artifacts/<ID>/`**, compared against **`.improve/artifacts/baseline-default/`**
  (30 files: 21 desktop + 9 mobile, captured at **default appearance**). The older set at
  `.improve/artifacts/baseline/` is the same 30 states at **`density: roomy` +
  `textScale: xlarge`** — do not diff against it without reading **§ 11**, which records
  both appearance settings and the two code fixes that separate the sets.
- Use the built-in **"Sample 1"** (1271 × 1920 portrait) to avoid the file chooser and any network
  fetch. Opening the Background panel is safe; **using** it is not (42 MB).
- Mobile caveat that must be repeated in any report: a 390 px viewport in a desktop browser is
  **not** the Pixel 7 profile `e2e/journey.mobile*.spec.ts` uses — `hasTouch` / `isMobile` are not
  set. Layout-at-390 px findings are in scope; touch-specific behaviour is not claimed.
- Do not attribute hot-reload artefacts to the baseline. When another agent is editing `src/`, the
  console fills with Vite HMR errors (`Failed to reload …?t=<timestamp>`, "Rendered more hooks than
  during the previous render"). A hard reload reproduces none of them.

### 5.5 Pre-existing coverage gaps that hide regressions

Three of the biggest defects in this repo are dark in every automated run, and a verifier must
know it:

- **Background removal — the flagship feature and the whole basis of the AGPL obligation — runs in
  no automated job.** The only case that clicks "Remove background" and asserts
  `background.removed === true` is `test.skip(!process.env.E2E_MATTING)` at
  `e2e/journey.background.spec.ts:134-137`; CI sets `E2E_MATTING: '0'`.
- **The shader-parity gate cannot execute on the configured runner.** `ubuntu-latest` has no real
  GPU, so every parity case skips on every PR. `src/gl/*` vs `src/render/fallback2d.ts` is
  unverified in every automated run.
- **The `--ie-tap` accessibility family is identified by regex-matching hashed CSS-module class
  names — in the measurement *and* in both anti-vacuity guards**
  (`e2e/a11y-measure.spec.ts:169-171`, `:299`, `:314-337`). A rename flips all three together, which
  is the "reads as a clean pass" outcome the file's own header at `:46-49` calls worse than no gate.

12 journeys have **no e2e spec at all**: hub re-entry · changing image · "Done" · "Reset all edits" ·
preset apply/delete · Copy/Paste edits · Compare · double-click-to-fit · drag-drop import · paste
import · "Photo details" · offline banner. 11 of the 12 are dead-end or reversal paths.

---

## 6. Conventions to follow

- **TypeScript strict; no `any`** (eslint `typescript-eslint` recommended is an error).
- **Prettier: 2-space, single quotes, no semicolon at end of statements** (`.prettierrc.json`).
  Run `npx prettier --write <files>` on every file you touch. Note `.prettierrc.json` sets no
  `proseWrap`, so prose reflows as docs grow.
- **Test file naming: `<sibling>.test.ts` next to the source**, jsdom environment.
- **Conventional Commits** — `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.
- **No comments** unless the surrounding code is heavily commented; match local density. Note that
  several files carry unusually argumentative header comments (`docStore.ts:43-50`,
  `backend.ts:16-20`, `useRenderLoop.ts:74-91`) — those are documentation, not noise.
- **Pure logic belongs in `src/lib/*` or `src/features/*`** as small testable functions, not inline
  in components. `src/components/*` is presentation + store wiring.
- **Store updates go through `src/store/actions.ts`** (`src/store/actions.ts`, 617 lines, 50
  exported actions) so history stays correct. Do not `setState` the doc directly from a component.
- **Do not commit.** Work stays in the working tree unless explicitly told.
- **A gate must be green on the branch that adds it.** A red gate gets disabled, and a disabled gate
  is worth less than no gate. If something cannot be made green, do not add it — report it.
- **No `expect(true)` and no snapshots repo-wide.** The 22 `not.toThrow()` sites are all paired with
  a real value assertion; that is the standard to match.
- **A row's `Status` in `docs/FEATURES.md` is a claim about a test.** `Working` means a named test
  exists that fails if the feature regresses. Never invent a test title. Never quietly promote a
  `Partial`. A removed lie is `Missing`, not `Working`. The vocabulary is six words: `Working`,
  `Partial`, `Stub`, `Broken`, `Missing`, `Untested`. Update all seven count locations in one pass.

---

## 7. Architecture invariants that must not break

### 7.1 `Doc` is JSON-serializable only — **and there is NO runtime guard**

`src/model/types.ts:373` — `Doc` is `export type Doc = { schema: DocSchema; source: SourceRef | null; … }`.
No `ImageBitmap`, `Blob`, canvas, class instance or function may be stored in a `Doc` field.
Pixels live in `AssetStore` keyed by `AssetId` (`src/model/assets.ts`). This is what makes history,
IndexedDB persistence, context-loss recovery and copy/paste-edits work.

**Enforcement is the type system only.** A `as unknown as Doc` cast defeats it silently — and there
are ~100 such casts in the tree, 8 in production code. Nothing fails, nothing warns, and the breakage
surfaces later as a persistence or undo bug.

### 7.2 Two backends behind `src/render/backend.ts` — a new pass is **THREE** implementations

`src/render/backend.ts:21` is the one interface; its own header at `:16-20` states the rule:
*"`Editor` never branches on engine."* `src/gl/*` is WebGL2; `src/render/fallback2d.ts` is Canvas2D.
Both consume the **same `Pass[]` from `planPasses`**, which is what makes parity possible.

**Adding a render pass means writing it three times: the GLSL, the GL executor, and the CPU mirror
in `src/render/cpu-passes.ts` (1053 lines).** `src/render/parity.test.ts` (43 cases) is what keeps
them honest. Budget for it. Capability-gating a pass in `src/gl/caps.ts` instead requires a Canvas2D
fallback.

Four independent gates: the interface (`backend.ts:21`), caps (`caps.ts:80/108`), the unit parity
suites (`render/parity.test.ts`, `render/fallback2d.test.ts`), and the real driver
(`e2e/shader-parity.spec.ts` + `e2e/shader-compile.spec.ts`).

### 7.3 `src/store/history.ts` must stay **zero-import**

165 lines, **zero imports** — mechanically enforced by the file being self-contained. It
re-implements timing through an injectable `options.now` (`:94`). Drag coalescing lives here
(`COALESCE_MS = 600`, `history.ts:15`) and `applyEdit` is the single choke point for undoable
writes. No React, no DOM, no `Date.now()`.

### 7.4 A new `Doc` field needs a default **and** a migration

`src/model/defaults.ts` (`createDoc`) **and** `src/model/migrate.ts` (829 lines;
`migrateDoc` at `:680`, `DOC_SCHEMA = 3` at `src/model/types.ts:22`), plus tests in
`migrate.test.ts`. Bump `DocSchema` if the change is not backwards-compatible. **Enforcement is
tests only — no checker fails if a field lacks either.** `src/model/migrate.ts:707/709` is the one
place to watch: the deserialisation trust boundary is narrowed by a cast rather than validated.

### 7.5 Appearance is chrome, not content

The six settings in `src/lib/appearance.ts` — `theme`, `density`, `textScale`, `motion`,
`iconScale`, `accent` — live in one `localStorage` key and reach the page as six `<html>`
data-attributes. **None of them may enter `Doc`, history or IndexedDB.** Two people exporting the
same recipe must get the same image, and an undo must never re-colour the canvas. Enforced by three
tests plus the structural fact that no appearance field exists on `Doc`. `index.html`'s pre-paint
script is **generated** by `appearanceBootstrapScript()` — run `npm run appearance:sync`, never
hand-edit; the byte-identical guard in `appearance.test.ts` is the whole mechanism.

### 7.6 Route-level code splitting is load-bearing

`src/router.tsx:21-22` declares two `lazy()` routes (`/` + `*`, `/editor` + `/editor/:tool`) behind
a Suspense shell (`:33-52`). Static imports would put `jspdf` (405 kB) plus imgly/onnx (865 kB JS
+ 23.9 MB WASM) in the entry chunk. **A new static import in `src/pages/` can undo a 1.3 MB win.**
Do not add a store read inside `renderOnce`, or a field to `frameKey` that is not in `FrameInputs`.

### 7.7 `public/` additions need a generator with a `--check` mode

`assets:check` — which `npm run build` runs **first** (`package.json:13`) — byte-compares every
catalogue entry against its generator, so a hand-edited asset fails the build. It also fails
without a `src/lib/licenses.ts` entry for any new runtime dependency. A new committed asset must
come from `scripts/*.mjs` with a `-- --check` mode (`luts:gen`, `thumbs:gen`, `icons:gen`).

`public/` is copied verbatim by both `vite build` and `npm run dev`, and `npm run build` reads the
working tree — so a file on disk but untracked passes every gate and ships as a 404.
`git status --porcelain public/` must be empty before a release. **At baseline it IS empty:**
74 tracked files, 1.95 MB.

---

## 8. Areas to AVOID

| Path | Why |
| --- | --- |
| `src/gl/shaders/index.ts` (684 lines of GLSL strings) | No unit test is possible in jsdom; the gate is `e2e/shader-compile.spec.ts` on a real driver. A one-character GLSL edit is unverifiable locally and in CI (`shader-parity` skips on the runner). |
| `src/model/migrate.ts` beyond **additive** changes | 829 lines of hand-written defensive remapping, and the deserialisation trust boundary at `:707/709` is narrowed by cast rather than validated. Reading stored documents from older builds is not a place to refactor. |
| `public/**` binary assets | 24 look strips, 24 thumbnails, 14 woff2 fonts, icons, `sw.js`, `manifest.webmanifest`. Byte-compared by `assets:check`; there is no `.gitattributes`, so a Windows checkout rewrites them whole. |
| `public/models/` | Gitignored, prettier-ignored, exempt from the per-file cap. `models.lock.json` carries `"models": []` **on purpose** — the app self-hosts no ML weights. Do not add to it. |
| `package-lock.json` | Hand-editing it is the classic way to ship a broken install. `@imgly/background-removal@1.7.0` and `onnxruntime-web@1.21.0` are pinned exactly while every other runtime dep uses `^`; the pin on the AGPL dep is correct (its CDN chunks must match the wasm) and nothing tests why, so a routine dependency bump would un-pin it with no gate failing. |
| `index.html`'s generated appearance script (`index.html:51-148`) | Generated by `appearanceBootstrapScript()`. **Run `npm run appearance:sync`; never hand-edit.** The byte-identical guard in `appearance.test.ts` is the whole mechanism. |
| `LICENSE`, `NOTICE`, `AGPL_DECISION` in `src/lib/licenses.ts`, `public/licenses.html` | **The AGPL obligation is an OPEN OWNER DECISION.** `@imgly/background-removal@1.7.0` is AGPL-3.0; anyone who distributes this build conveys a combined work and owes the corresponding source under AGPL §5(a). The three options — obtain permission, replace the dependency, publish the source — and what each costs are written out in `NOTICE`, in `AGPL_DECISION`, and in their own panel on `public/licenses.html`. **Never resolve it in a comment, never soften it into "should read the upstream licence before shipping it"** (which is advice and discharges nothing), and never delete the panel. A licence page that lists a dependency accurately and omits the obligation is worse than one that says what shipping AGPL means. |
| `coverage/`, `dist/` | Build products; `.prettierignore`d. `coverage/coverage-summary.json` is the only thing worth reading from `coverage/`. |
| `src/store/docStore.ts`'s exported `useDocStore` hook as a write path | Invariant "store updates go via `actions.ts`" is **convention only and already breached** (`EditorCanvas.tsx:102,125` calls `getState().update()` directly). It is the weakest invariant in the set — do not add a fourth breach. |

---

## 9. Documentation drift register

**If a number in a document disagrees with a command's output, the command wins and the document
is the bug.** These are all verified. Every one is a real, currently-shipping falsehood.

| # | File:line | Claim | Actual (measured 2026-10-04) |
| --- | --- | --- | --- |
| 1 | `AGENTS.md:43`, `AGENTS.md:46-47` | Coverage is **RED**, `src/pages/**` branches **37.4 vs 38** | **GREEN.** `vite.config.ts:199` sets `60/48/47/57`; measured **63.0 / 51.3 / 50.9 / 60.9**. |
| 2 | `README.md:394-397` (Known release blocker #1) | "`npm run test:coverage` is currently red" | Green, all ten areas. The blocker does not exist. |
| 3 | `docs/FEATURES.md:601` (D9-F02) | `src/pages/**` measures `52.1 / 37.4 / 47.3 / 50.4` against thresholds `49 / 38 / 43 / 48`; "branches is 0.6 points under" | **Wrong twice.** Thresholds are `60/48/47/57`; measured `63.0 / 51.3 / 50.9 / 60.9`. |
| 4 | `docs/FEATURES.md:974`, `:1046-1047`, `:601` | "`src/pages` branches 37.4 against a 38 threshold"; totals **89.14 / 80.85 / 88.63 / 91.80** | **51.3 against 48**; totals **89.57 / 81.42 / 88.83 / 92.23**. |
| 5 | `README.md:249-251` | Coverage "statements 89.14 %, branches 80.85 %, functions 88.63 %, lines 91.80 %", "one per-area threshold red" | **89.57 / 81.42 / 88.83 / 92.23**; **no** area red. |
| 6 | `AGENTS.md:38`, `AGENTS.md:121` | `npm test` = **2974 tests in 148 files** | **3060 tests in 153 files** (`npm test`; `find` also gives 153). |
| 7 | `README.md:194`, `README.md:241` | same | same |
| 8 | `docs/FEATURES.md:943`, `:1020` | same | same |
| 9 | `AGENTS.md:44`, `README.md:196`, `README.md:243`, `docs/FEATURES.md:580,600,747,930,972,1020` | e2e = **623 cases in 38 spec files** | **659 tests in 41 files** = 320 chromium + 320 webkit + 19 mobile. |
| 10 | `AGENTS.md:55` | "jsdom, 148 files" | 153 files |
| 11 | `AGENTS.md:161-166` (invariant 10) | `public/` is a mess of untracked files — strips, thumbnails, fonts, licences page, service worker, manifest, icons | `git status --porcelain public/` is **empty**; 74 tracked files. The *rule* still stands and still passes. |
| 12 | `README.md:115-117` (blockquote) | "As the tree stands they are untracked. `git status --porcelain public/` lists all of them." | Empty. The blockquote is false. |
| 13 | `README.md:398-403` (Known release blocker #2) | "The committed-asset tree is not committed." | False — everything is committed. |
| 14 | `AGENTS.md:167-171` (invariant 11) | `public/models/` holds an unpinned 3 758 596 B `face_landmarker.task`, exempt by a hard-coded prefix in `check-public-budget.mjs` | Directory is **empty**; `models.lock.json` has `"models": []`; the prefix exemption was **removed** — `scripts/check-public-budget.mjs:71-88` documents the removal and `:137` pins against the lock. The build's "14 files exempt" line is the 14 woff2 fonts. |
| 15 | `README.md:384-387` (Roadmap) | "A decision on `public/models/face_landmarker.task`" | Nothing to decide. The file is gone. |
| 16 | `README.md:408-411` (Known inaccuracies #1) | `check-public-budget.mjs` prints a false "sha256-pinned" line from `PUBLIC_PINNED_PREFIXES = ['models/']` | That constant is gone; the script now checks the lock per file. |
| 17 | `README.md:111` | look strips + thumbnails + icons + 14 fonts = **5.79 MB** | **819 410 B (0.78 MB)** for luts + thumbs + fonts (352 / 276 / 316 KB on disk); whole `public/` is **1.95 MB** across 74 files. Off by ~7×. |
| 18 | `README.md:217-218` | `.prettierignore` keeps out `dist/`, `coverage/`, `test-results/`, `playwright-report/`, `.kilo/`, `public/models/` | Also `node_modules/`, `blob-report/`, `.playwright-mcp/` and — since `676b733` — **`.improve/`**. |
| 19 | `recon-architecture.md:74` | `src/model/migrate.ts` is 720 lines | **829 lines** |
| 20 | `recon-architecture.md:12` | 18 `scripts/*.mjs`, 7 with their own tests | **20** `.mjs`, of which **7** are `*.test.mjs` (13 non-test) |
| 21 | `recon-runbook.md:79-107` (FAIL-1) | `prettier --check .` is red on `.improve/STATE.md` | **Resolved** in `676b733`; the gate is exit 0. |

Accurate and worth not re-litigating: `AGENTS.md:65-69` on the three-project e2e matrix (`ci.yml:133-139`
and `playwright.config.ts:44,68,81` all list three) is **correct**; `AGENTS.md:97-99` on the empty
`ALLOWED` list in `e2e/a11y.spec.ts` is **correct**; and `docs/FEATURES.md`'s row accounting is internally sound —
179 rows, 171 Working / 4 Partial / 3 Missing / 1 Untested, every figure appearing exactly twice
(district table + §5 index), and every row naming a greppable test title. Its **status** counts can
be trusted even where its **prose** counts cannot.

---

## 10. Verifier's baseline-diff rules

- A new failure in `npm test` → a real regression. Baseline is 153 files / 3060 tests, exit 0.
- A new failure in `npm run typecheck`, `npm run lint` or `npm run build` → real. Baseline exit 0
  with no output. If `assets:check` is what fails, the message names the generator — re-run that
  generator with `--check` to reproduce.
- A new failure in `npm run test:coverage` → real. Baseline exit 0. Check the per-area table for
  the area you touched; every area clears its threshold. The thinnest margins in the tree are
  `src/render/**` functions (87.5 vs 86, **+1.5**) and `src/components/**` lines (87.3 vs 84,
  +3.3), so a large file added to `src/render/` can tip a green gate red.
- A `prettier` failure naming any path under `src/`, `e2e/`, `scripts/`, `.improve/` or a root
  config file → real. There is no baseline format failure.
- A `parity.test.ts` timeout under concurrent load → not a failure. Re-run it alone.
- A unit-test **count** moving with no test files added → real. An e2e count moving when cases were
  added → expected.
- A jsdom assertion about layout, overlap, visibility or reachability → **proves nothing**,
  regardless of whether it passes.

---

## 11. The two visual baseline sets, and their appearance settings

**Added by IMP-144, 2026-10-04. This section is the committed record.** The PNGs and the
per-set `README.md` files live under `.improve/artifacts/`, which is listed in
`.git/info/exclude` and in `.prettierignore`, so they do **not** travel with the history.
This section does.

There are two baseline sets. Both are 30 PNGs covering the same 21 desktop and 9 mobile
states, at 1280 × 800 and 390 × 844, DPR 1, `scale: 'css'`, captured with the Playwright
MCP browser tools against the dev server on **5173** using the built-in **Sample 1**
(1271 × 1920). Filenames and pixel dimensions are identical between the sets, so they diff
file-for-file. **They differ in appearance, and — read §11.3 — in code.**

| | Set A | Set B |
| --- | --- | --- |
| Directory | `.improve/artifacts/baseline/` | `.improve/artifacts/baseline-default/` |
| Captured | 2026-10-03 20:27–20:44 | 2026-10-04 04:38–05:20 |
| Commit | `aea8523` | `7c30292` |
| Report | `reports/recon-experience.md` | `reports/impl-IMP-144.md` |
| Per-set README | `artifacts/baseline/README.md` | `artifacts/baseline-default/README.md` |
| Use it for | the states the original findings were measured against | **quoting a magnitude** |

### 11.1 The six appearance settings, per set

The six settings are `DEFAULT_APPEARANCE` in `src/lib/appearance.ts:58-65` and reach the
page as six `<html>` data-attributes.

| Setting | Set A | Set B | `DEFAULT_APPEARANCE` |
| --- | --- | --- | --- |
| `theme` | `system` | `system` | `system` |
| `density` | **`roomy`** | `default` | `default` |
| `textScale` | **`xlarge`** | `default` | `default` |
| `motion` | `full` | `full` | `full` |
| `iconScale` | `default` | `default` | `default` |
| `accent` | `green` | `green` | `green` |

**Set A is at a non-default appearance. That was never recorded anywhere until two
verifiers discovered it independently.** Three independent confirmations, in order of
strength:

1. **The pixels.** `artifacts/baseline/mobile-08-appearance-panel.png` is the Appearance
   dialog, and it shows **Roomy ✓** and **Extra large ✓** with **Reset to defaults
   enabled**. The evidence was in the artefact the whole time.
2. **The stored payload.** The browser profile that took set A still held
   `localStorage['image-editor-appearance'] = {"density":"roomy","textScale":"xlarge"}`.
   `coerceAppearance()` fills the four absent keys from the defaults.
3. **The verifiers.** `verify-IMP-042-attempt2.md:110-122` measured `Background.right` =
   365.72, and `:246-257` shows that value is reachable only at `roomy` + `xlarge`.

### 11.2 Two rules for reading a screenshot

- **Absence of a data-attribute means "at the default", not "not set".**
  `appearanceAttributes()` (`src/lib/appearance.ts:438-461`) deliberately omits any setting
  whose value equals its default, so that the OS-preference `:root:not([data-theme])`
  branch in `tokens.css` keeps working. **Set B was captured with all six attributes
  absent from `<html>`.** A verifier checking "is `data-density` set?" will conclude set B
  is unconfigured; it is in fact the fully-default set.
- **Verify the appearance by looking at `mobile-08-appearance-panel.png` in each set.** The
  Appearance dialog is a rendered, self-describing record of the setting that produced the
  frame next to it: set A reads Roomy / Extra large, set B reads Default / Default, and in
  set B the **Reset to defaults** button is `disabled` because
  `disabled={isDefault(settings)}` (`src/components/ui/AppearanceMenu.tsx:518`). No tooling
  and no `localStorage` archaeology required.

### 11.3 The two sets are NOT appearance-only different — read this before diffing

Set A was captured at `aea8523`; set B at `7c30292`. Two fixes landed in between:

- `b957f90` — **IMP-041**, "move the readout out of the crop frame so the s handle is
  grabbable". In set A, `desktop-09` and `desktop-10` are **byte-identical**
  (md5 `3f7850892c74ad653676cc3687c5ee09`) — that identity *was* the finding: the bottom
  crop handle's focus ring was entirely hidden behind the `1271 × 1920 px · 2:3` readout.
  In set B they **differ**, the readout sits below the frame at y ≈ 713, and the focused
  handle shows `outline: rgb(56,178,140) solid 3px` at `offset −3px`, `:focus-visible`
  true. This is the concrete case IMP-144 was raised for: a defect invisible at defaults.
- `cb3e7ef` — **IMP-042**, the mobile tool bar. Set A's `mobile-05` shows "Background"
  clipped mid-word; set B's shows it whole.

Conversely `desktop-20`/`desktop-21` are byte-identical in **both** sets (set A
`fee649a7…`, set B `2d203c5e…`), so the "Done is a silent no-op with a panel open" defect
(C-01 / D-02) reproduces unchanged at defaults.

**A pixel difference between the two sets is evidence of *either* an appearance change
*or* one of those two fixes. Name which before reporting it.**

### 11.4 Magnitudes, measured

Measured in set B (defaults) in this browser; the set-A column is quoted from
`recon-experience.md` and the verifier reports, not re-measured. Full per-shot provenance
is in each directory's README.

| Measurement | Set B (defaults) | Set A (roomy + xlarge) |
| --- | --- | --- |
| `Background` tab `right`, 1280 × 800 | **380.17** | 365.72 |
| Tool-bar `scrollWidth` vs `clientWidth`, 1280 × 800 | **1280 = 1280** | 899 track |
| Tool-bar `scrollWidth` vs `clientWidth`, 390 × 844 | **785 vs 390** (scrolls) | — |
| Hub page height, 1280 wide, `fullPage` | **1699** | 1953 |
| Hub page height, 390 wide, `fullPage` | **2934** | 3477 |
| Hub sticky header, 390 px | **116 px, 2 rows** | 188 px, 3 rows |
| Editor empty-state max `scrollTop`, 1280 × 800 | **309** | 585 |
| Crop-sheet max `scrollTop`, 1280 × 800 | **117** | 299 |
| Aspect-ratio chips per row, Crop sheet at 1280 | **5** | 3 |
| Canvas CSS size, 1280 × 800, no panel | **430.81 × 650.80** | — |
| Canvas CSS size, 390 × 844, Crop sheet open | **107.30 × 162.09** | 135 × 204 |

**The 356.77 px that IMP-042's implementer quoted from the baseline is not reproducible
today at any appearance** — it was a pre-fix measurement, and `cb3e7ef` changed the tab
metrics afterwards. `380.17` is the current defaults value.

### 11.5 Console, both sets

Zero errors and one warning on a fresh load for every navigation and every panel switch,
in both sets. The single warning is pre-existing and benign:

```
React Router Future Flag Warning: React Router will begin wrapping state updates in
React.startTransition in v7. You can use the `v7_startTransition` future flag to opt-in early.
  @ node_modules/.vite/deps/react-router-dom.js:3614
```

A full-session log (`all: true`) holds ~20 older errors — "Rendered more hooks than during
the previous render", "Cannot read properties of null (reading 'getSnapshot')", "Failed to
fetch dynamically imported module … `?t=…`". Their `?t=` timestamps are ~17 hours older
than the set-B capture and they belong to a previous browser session during which other
agents were editing `src/`. That is the HMR-artefact class § 5.4 warns about; do not
attribute them to a baseline.