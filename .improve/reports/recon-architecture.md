# Recon — architecture & stack

Agent was read-only and could not write; condensed by the orchestrator from its report. All claims
were verified against the working tree at `10ade26` by the agent.

## Classification

Client-side-only SPA. No server, no API, no DB, no auth. `package.json` is `private: true` with no
`exports`/`main`/`types` — **there is no public library surface**. Every `export` in `src/` is an
internal module boundary. Vite 8 + React 18 + TypeScript 5.5 + zustand 5 + react-router-dom 6.
Deployed as `dist/` to GitHub Pages; SPA deep-link recovery via `public/404.html`.
Also a self-hosting toolchain repo: 18 `scripts/*.mjs` generators/guards, 7 with their own tests.

**Audience is end users first**, maintainer second (`AGENTS.md`, `README.md`, `docs/FEATURES.md`).
Maturity: late-production, single maintainer, v1.0.0.

| Layer | Package | Manifest |
|---|---|---|
| UI | react / react-dom | `^18.3.1` |
| State | zustand | `^5.0.15` |
| Routing | react-router-dom | `^6.30.6` |
| Gestures | `@use-gesture/react` | `^10.3.1` |
| Worker RPC | `comlink` | `^4.4.2` |
| Compression | `fflate` | `^0.8.3` |
| IndexedDB | `idb` | `^8.0.3` |
| PDF | `jspdf` | `^4.2.1` (lazy chunk) |
| ONNX | `onnxruntime-web` | `1.21.0` (pinned) |
| ML | `@imgly/background-removal` | `1.7.0` (pinned, **AGPL-3.0**) |
| Build | vite | `^8.3.0` |
| Test | vitest `^5.0.0`, `@playwright/test ^1.63.0`, `@axe-core/playwright ^4.13.0` |
| Lint | eslint `^10.10.0`, `typescript-eslint ^8.3.0` |
| Node | `.nvmrc` / `engines.node` | `>=24.21.0` |

## Entry points

| # | Entry | Location |
|---|---|---|
| 1 | HTML document | `index.html` (210 lines; no external font link by design, `:41-49`) |
| 2 | Module entry | `index.html:187` -> `src/main.tsx` |
| 3 | Bootstrap | `src/main.tsx:22` `createRoot`, `StrictMode` at `:23` |
| 4 | Diagnostics install | `src/main.tsx:20`, **first statement** (`:10-19` admits it is not truly earliest) |
| 5 | Router | `src/router.tsx:63` `createBrowserRouter` |
| 6 | Hub | `src/router.tsx:21,55,60` lazy `/` + `*` catch-all |
| 7 | Editor | `src/router.tsx:22,56,57` lazy `/editor` + `/editor/:tool` |
| 8 | Lazy shell | `src/router.tsx:33-52` Suspense + `aria-busy` + `RouteError`. Rationale `:9-20`: static imports put jspdf (405 kB) + imgly/onnx (865 kB JS + 23.9 MB WASM) in the entry chunk |
| 9 | Generated pre-paint script | `index.html:51-148` from `appearanceBootstrapScript()` |
| 10 | SPA redirect restore | `index.html:149-166` (GitHub Pages has no rewrites) |
| 11 | SW registration | `index.html:188-208`, scope from `document.baseURI` |
| 12 | Service worker | `public/sw.js` (90 lines, `VERSION='ie-shell-v1'`) |
| 13 | 404 doc | `public/404.html` |
| 14 | Licences page | `public/licenses.html` |
| 15 | Manifest | `public/manifest.webmanifest` |
| 16 | Gate CLIs | `scripts/*.mjs` (18) |
| 17 | CI | `.github/workflows/ci.yml`, `deploy.yml` |

## Module map — 336 files, ~91.0k LOC under `src/`

| Dir | Files | LOC | Role |
|---|---|---|---|
| `src/components/` | 148 | 35,411 | Presentation + store wiring |
| `src/lib/` | 80 | 19,990 | Pure testable logic |
| `src/features/` | 38 | 7,984 | export / layers / ml / passport |
| `src/gl/` | 27 | 7,935 | WebGL2 backend + GLSL |
| `src/render/` | 17 | 5,487 | backend contract, CPU parity, compositor |
| `src/store/` | 13 | 3,656 | docStore, pure history, actions, uiStore |
| `src/model/` | 12 | 3,430 | Doc schema, AssetStore, migrations |
| `src/pages/` | 9 | 3,080 | Hub + Editor |
| `src/hooks/` | 10 | 2,251 | React effects |
| `src/styles/` | 5 | 1,634 | tokens + global sheets |

Notable files: `src/pages/Editor.tsx` (569 lines — routing, lifecycle, three import routes, session
resume, autosave, presets/recipes, export); `src/hooks/useRenderLoop.ts` (490 — backend ownership,
rAF, frame keying, context-loss recovery); `src/store/actions.ts` (617, 50 exported actions);
`src/model/migrate.ts` (720, hand-written defensive remapping); `src/gl/shaders/index.ts` (684 GLSL);
`src/render/cpu-passes.ts` (`runCpuPasses` `:903`, CPU mirror of every pass, 99.8% covered);
`src/lib/diagnostics.ts` (ring buffer + `console.error` wrapper at `:694-731`, redaction, report).

## Data flow (adjust slider as the worked example)

```
AdjustPanel.tsx:101  onChange -> setAdjust(spec.key, value)
  actions.ts:131     setAdjust -> useDocStore.getState().update(recipe, {key:`adjust:${key}`})
  docStore.ts:85-95  recipe(present) -> structurallyEqual short-circuit -> applyEdit -> set(...)
  history.ts:74      applyEdit: Object.is check; transient -> not an undo step; inside an
                     interaction span -> push `past` once only; else coalesce by key in
                     COALESCE_MS=600 (history.ts:15)
  useRenderLoop.ts:311-312  subscribe to BOTH stores
  useRenderLoop.ts:375,383,384  one FrameInputs snapshot + frameKey + shouldRenderFrame
  useRenderLoop.ts:349  backend.render({source, sourceSize, doc, size})
    gl/renderer.ts:269  computeOutputToSource -> withLeadingGeometry(planPasses(...))
                        -> planHash skip -> planRender (tiling) -> runChain / blitTile
    render/fallback2d.ts:141  runCpuPasses(geometry, passes, ...)
  useRenderLoop.ts:347,356,362,364  computeProxySize -> resize only when changed ->
                        presentCtx.drawImage -> drawLayers
```

Both backends consume the **same `Pass[]` from `planPasses`** — that is what makes parity possible.
`src/render/backend.ts:16-20` states the rule: *"`Editor` never branches on engine."*

Backend selection is pure-then-construct: `selectBackend.ts:24 backendKind(preference, caps)`;
`flagOff('webgl')` is a **veto, not a preference** (`:40-45`); `createBackend` `:46` try/catches GL
and falls through to Canvas2D.

Three degradation paths, all instrumented:
- Context loss — `useRenderLoop.ts:291 onLost`, backoff `contextRetryDelay` `:70` (10s -> 40s cap),
  swap `:278`. `:261-277` documents a real bug: a replacement backend must `invalidate()`, because
  the loop resets `dirty=false` on a frame it declines to draw, so an unchanged `LoopKey` would
  leave the previous backend's last frame on screen.
- Render error — `useRenderLoop.ts:396-419`, swaps to Canvas2D, pushes `RENDER_FALLBACK_MESSAGE`
  **once at `info`**, because "an error chip for a working editor is how people learn to ignore
  error chips."
- Unsupported passes — `caps.ts:80 CANVAS2D_SUPPORT` / `:108 unsupportedPasses`.

Two stores, deliberately separate: `docStore.ts:80` = undoable/persisted content;
`uiStore.ts:217` = chrome (tool, sheet detent, viewport, compare, selection, jobs, toasts, errors).
`useRenderLoop` folds both into one `FrameInputs` snapshot so the frame and the change-test can never
describe different frames — forced by a real bug (`useRenderLoop.ts:74-91`): a 1:1 crop changed no
document, so every key field matched, `shouldRenderFrame` said no, and the canvas kept painting the
**uncropped** photo until a resize forced a frame.

Asset GC: `docStore.ts:197 liveAssetIds()` walks `past` **and** `future`, "so a generation-based GC
never closes a bitmap that undo could still need."

## Persistence surfaces

- **Read:** `decode.ts:213/227/240`; accepted set `accept.ts:3`; `MAX_INPUT_BYTES = 256 MB`
  (`accept.ts:21`); `isHeic` `:29`; header probe `decode.ts:152` rejects oversized before pixels
  materialise; `estimatePixels` `:47`; `proxyResize` `:196`.
- **Write:** `ExportFormat = 'jpeg'|'png'|'webp'|'avif'|'pdf'` (`model/types.ts:318`),
  `encode.ts:61/116/101/131`. Unsupported formats are **refused**, not silently substituted
  (`caps.ts:159 probeFormats`).
- **Recipe format:** plain JSON. `recipes.ts:16 serializeRecipe`, `:24 applyRecipe`, capped
  `MAX_RECIPE_CHARS = 128 KB` (`:9`) to fit clipboard + localStorage. Clipboard `:96/115/128` with a
  localStorage mirror; named presets `:132-173`, `MAX_PRESET_NAME = 40`. Wired at
  `Editor.tsx:392/402/413/419/439/453`. **There is no `.ieproj` file format.**
- **IndexedDB:** `persist/session.ts:25-27` db `image-editor`, `DB_VERSION=1`, one session row
  `'current'`, stores `sessions` + `assets`. Four load-bearing decisions: `doc` is typed `unknown`
  (`:68-70`) so any older build's row goes through `migrateDoc`; only JSON `Doc` + encoded source
  bytes are stored, never decoded pixels (`:12-13`); `SourceBytes` carries the asset id *inside* the
  payload (`:53-58`) because "storing the original bytes under a replacement asset's id silently
  reverts the cut-out on reload"; **nothing expires anything** (`:18-22` — an earlier version deleted
  rows older than a week on read "with no prompt, no warning and no way to get the photo back").
  Only `forgetSession` (`:292`), user-pressed, deletes.
- **Retention:** `persist/retention.ts` — default 180 days, min 7, max 3650, `shouldWarn`,
  `describeRetention`, ack key.
- **localStorage keys:** `image-editor-appearance`, `image-editor-theme` (legacy),
  `image-editor:doc-mirror` (schema 1, 64 KB / 256 KB caps), `ie-retention`, `ie-retention-ack`,
  `image-editor-error-log` (20 entries, 7-day TTL, `uiStore.ts:74-78`), preset keys.
- **Save result classification:** `session.ts:117 classify` -> `'ok'|'mismatch'|'quota'|
  'unavailable'|'error'`, turned into sentences by `Editor.tsx:113 SAVE_MESSAGES`. A failed `openDB`
  is **not cached** (`:102-107`) so Safari users can grant storage without a reload.

## Invariant enforcement — mechanically enforced vs convention only

| # | Invariant | Enforcement |
|---|---|---|
| 1 | `Doc` is JSON-only | **Type system only** (`types.ts:373`). **No runtime guard** — a `as unknown as Doc` cast defeats it silently |
| 2 | Two backends behind `backend.ts` | **Four independent gates**: interface `backend.ts:21`, caps `caps.ts:80/108`, parity `render/parity.test.ts` (43 cases) + `fallback2d.test.ts`, real driver `e2e/shader-parity.spec.ts` + `shader-compile.spec.ts` (both record the renderer string so a skip can't read as a pass) |
| 3 | `history.ts` is pure | **Mechanically enforced**: the file has **zero imports**; it re-implements timing via injectable `options.now` (`:94`) |
| 4 | New `Doc` field needs default + migration | **Tests only.** `DOC_SCHEMA=3` (`types.ts:22`), `createDoc` (`defaults.ts:192`), `migrateDoc` (`migrate.ts:680`). **No checker fails if a field lacks either** |
| 5 | Pure logic in `lib/`/`features/` | **Convention only.** No eslint rule. Closest: per-area coverage thresholds + `ToolSurface.test.tsx:21/68/77` which walks the `.tsx` tree by path |
| 6 | Store updates via `actions.ts` | **NOT ENFORCED.** `docStore.ts:80` exports the raw zustand hook. `EditorCanvas.tsx:102/125` already calls `useDocStore.getState().update()` directly. **Weakest invariant in the set** |
| 7 | Appearance is chrome | **Enforced by three tests** + structurally (no appearance field exists on `Doc`) |
| 8 | `index.html` script is generated | **Enforced** by a byte-identical guard in `appearance.test.ts` |
| 9 | Deps need `licenses.ts` entries | **Enforced, and early** — `assets:check` is step 1 of `build` (`package.json:13`); CI proves the guard bites |
| 10 | `public/` must be fully tracked | **Enforced by nothing in-repo.** Stated state is stale: `git status --porcelain public/` is **empty** (74 tracked files) |
| 11 | `public/models/` | **All three claims stale**: dir is **empty**, and the hard-coded prefix exemption was **removed** (`check-public-budget.mjs:71-88` documents the removal; exemption is now a real `models.lock.json` pin check at `:137`). `models.lock.json` carries `"models": []` on purpose. The *advice* still stands |

## Debt markers — unusually clean tree

`TODO` 0, `FIXME` 0, `HACK` 0, `XXX` 0, `@ts-ignore` 0, `@ts-expect-error` 1
(`docStore.test.ts:125`, intentional — it proves a recipe-only patch is a type error),
`eslint-disable` 6 (**all justified**: `useRenderLoop.ts:186`, `RatioChip.tsx:1`, four icon modules,
`fake2d.ts:64`). Literal `any`: 1, in a test. ~100 `as unknown as` casts, mostly test doubles;
8 in production code, of which **`migrate.ts:707/709` is the one to watch** — the deserialisation
trust boundary, narrowed by a cast rather than validated. No rule is globally disabled
(`eslint.config.js` is 2010 bytes). No `console.log`/`debug` anywhere; `console.error` is wrapped,
never replaced (`diagnostics.ts:679-731`), with a test asserting the wrapper is restorable/idempotent.

**Dead code:** `src/components/ui/Chip.tsx` — 5 lines, imported by nothing, 0% coverage. Unlike
`CrashOnPurpose.tsx` (0% but intentional and DEV-stripped) nothing references or guards it.
**Precedent for the fix:** `vite.config.ts:181` records `src/hooks/useSafeArea.ts` as deleted at 0%
rather than kept and covered.

**Unproven, not dead:** `gl/pixel-scale.ts` branches 0/2; `render/exportCanvas.ts` 73.9/55.6;
`lib/decode.ts` 74.8/72.2; `ui/ThemeToggle.tsx` branches 40%; `render/fallback2d.ts` branches 40%.

## Documentation drift — the largest block of real debt

`AGENTS.md` §Counting: "If a number in a document disagrees with a command's output, the command wins
and the document is the bug." Several do:

| Claim | Where | Reality |
|---|---|---|
| Coverage **RED**, `src/pages/**` branches 37.4 vs 38 | `AGENTS.md` gate table | **Wrong.** `vite.config.ts:199` = `60/48/47/57`. Measured `63.0/51.3/50.9/60.9` — **green**. All three docs disagree with each other and the gate is not red |
| thresholds `49/38/43/48`, "0.6 under" | `docs/FEATURES.md:601` (D9-F02) | **Wrong twice** |
| `public/` dirty | `AGENTS.md` inv. 10 | **Stale** — clean |
| `public/models/` holds a 3.7 MB `.task` | `AGENTS.md` inv. 11 | **Stale** — empty; prefix exemption removed |
| 623 e2e / 38 specs | `AGENTS.md` x3, `README.md:196/243`, `FEATURES.md:580/600/747/930/972` | **Stale** — **659 / 41** (see recon-runbook) |
| 2974 tests / 148 files | `AGENTS.md` x2, `README.md:194/241`, `FEATURES.md:943/1020` | **Stale** — **3060 / 153** |
| coverage % figures | `FEATURES.md:601` | From a different run than the one `vite.config.ts:158` records |

**Row accounting in `FEATURES.md` is internally sound**: 179 rows, 171 Working / 4 Partial /
3 Missing / 1 Untested / 8 open, and every figure appears exactly 2x (district table + §5 index).
`FEATURES.md` uniquely **names the test title for every row** — that is why its status counts can be
trusted even where its prose counts are not. `AGENTS.md` §Feature work binds implementers: never
invent a test title; never quietly promote a `Partial`; update all seven count locations in one pass.

## Docs

`docs/` contains exactly one file: `docs/FEATURES.md` (1396 lines). `README.md` (425) has unusual
honest sections at the end: **Known release blockers** (`:389`) and **Known inaccuracies** (`:406`).
There is **no `docs/ARCHITECTURE.md`, no `docs/CONTRIBUTING.md`, no ADR directory**. Architectural
knowledge lives in `AGENTS.md`, in unusually argumentative code header comments
(`docStore.ts:43-50`, `backend.ts:16-20`, `useRenderLoop.ts:74-91`), and `FEATURES.md` §4.

The 8 open rows (§6): `D4-F11` P1 (histogram `aria-hidden`); `D1-F08` P2 (selector memoisation);
`D3-F25` P2 (whole-store subscription wakes rAF on every toast); `D4-F12` P2 (**no colour
management, "not built, and not disclosed"**); `D5-F05` P2 (a product decision, not a gap);
`D6-F11` P2 (matte repair brush, copy says so); `D9-F05` (`FEATURES.md` itself, `Untested`);
`D7-F12` unscheduled `Partial` (AVIF DPI read but never written; sheet discloses it).

## Notes for implementers (things the docs do not say plainly)

1. `Doc` JSON-only is the load-bearing wall. There is no runtime guard.
2. **Adding a pass means writing it three times**: GLSL, the GL executor, and the CPU mirror in
   `cpu-passes.ts`. `render/parity.test.ts` keeps them honest. Budget for it.
3. Do not add a store read inside `renderOnce` or a field to `frameKey` that is not in `FrameInputs`.
4. Route-level code splitting is load-bearing; a new static import in `pages/` can undo a 1.3 MB win.
5. Do not add to `public/` without a generator and a `--check` mode.
6. Invariant 6 is convention only. If you touch the store, consider the lint rule that would make it real.
7. jsdom has no WebGL and computes no layout — `scrollWidth === clientWidth === 0` for every element.
8. **Fix the coverage docs before writing coverage tests.** A stale "RED" on a green gate sends the
   next implementer to write tests that are not needed.
9. Do not resolve the AGPL decision in a comment — `NOTICE:75-98` leaves it to the owner.