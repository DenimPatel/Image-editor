# AGENTS.md

## Environment (important)

`node`/`npm` are **not** on the default PATH. Prefix every shell command:

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
```

## Commands

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
npm test              # vitest run (jsdom, pure/unit)
npm run test:coverage # vitest run --coverage, enforces the per-area thresholds
npm run test:e2e      # playwright test (chromium + webkit + a mobile project),
                      # starts its own dev server on 5317
npm run typecheck     # tsc -b
npm run lint          # eslint . (must be clean)
npm run build         # assets:check + tsc -b + vite build + bundle + public budget
npm run dev           # vite dev server, prints local URL

npm run assets:check     # every committed asset hashes and matches its generator
npm run luts:gen         # regenerate the 24 look strips   (-- --check to verify)
npm run thumbs:gen       # regenerate the 24 look thumbnails (-- --check to verify)
npm run icons:gen        # regenerate the PWA icons         (-- --check to verify)
npm run appearance:sync  # rewrite index.html's pre-paint appearance script
```

Vitest can also be scoped: `npx vitest run src/lib/curves.ts`. Do **not** use `-u`/`--update`
on snapshots unless asked.

### The gates, and which ones are currently red

| Gate       | Command                  | State on 2026-10-03                          |
| ---------- | ------------------------ | -------------------------------------------- |
| Unit       | `npm test`               | green — **2974 tests in 148 files**          |
| Typecheck  | `npm run typecheck`      | green                                        |
| Lint       | `npm run lint`           | green                                        |
| Format     | `npx prettier --check .` | green — repo-wide, and CI runs it repo-wide  |
| Build      | `npm run build`          | green                                        |
| Coverage   | `npm run test:coverage`  | **RED** — `src/pages/**` branches 37.4 vs 38 |
| End-to-end | `npm run test:e2e`       | 623 cases in 38 spec files, 3 projects       |

`npm run test:coverage` fails, and it is not to be "fixed" by lowering the threshold in
`vite.config.ts`. Add tests in `src/pages/`, or argue for the lower number in writing. See `D9-F02`.

## Testing

Three suites, three jobs, and they are not interchangeable.

| Suite      | Command                 | Runs on                                            |
| ---------- | ----------------------- | -------------------------------------------------- |
| Unit       | `npm test`              | `tsconfig`-checked, jsdom, 148 files               |
| Coverage   | `npm run test:coverage` | same, plus per-area thresholds in `vite.config.ts` |
| End-to-end | `npm run test:e2e`      | Chromium **and** WebKit **and** a mobile project   |

- **Prefer a unit test.** If the claim can be made without a browser, it must be. The
  e2e suite is minutes, not milliseconds. It runs on three projects: `chromium` and
  `webkit` both `testIgnore` `/journey\.mobile/`, and a `mobile` project (Pixel 7,
  `hasTouch`, `isMobile`) owns `testMatch: /journey\.mobile/` — which is **two** specs,
  `journey.mobile.spec.ts` and `journey.mobile-touch.spec.ts`, 19 cases. It is a prefix,
  not a filename; do not describe it as one spec.
- **All three projects must appear in `ci.yml`.** They did not until 2026-10-03: the
  matrix was `browser: [chromium, webkit]`, so the `mobile` project was configured,
  documented and selected by nobody, and every one-finger-drag and sheet-detent
  assertion in the repository was dark on every PR. **A gate that no workflow selects
  is worse than no gate**, because the badge and the docs both say it ran.
- **A UI or interaction feature needs an `e2e/journey.*.spec.ts` case.** Build it on the
  `test` from `e2e/fixtures.ts`; do not write a raw `import { test } from '@playwright/test'`
  in a new spec. The fixtures are the contract:
  - locate by **accessible name or role**, never by a CSS-module class. A `styles.foo`
    selector dies on the next rename and says nothing about keyboard reachability.
  - assert on `readDoc()` (the live store) or `persistedDoc()` (the stored row), not on
    a value copied into the test.
  - **`readDoc()` resolves the module URL out of `performance.getEntriesByType('resource')`
    and imports that**, because on a warm dev server the bare `src/store/docStore.ts`
    specifier can hand back a _second_, empty module instance. If you touch it, do not
    simplify it back: it will not error, it will return a truthy default document, and
    every assertion downstream will be about an empty editor while the screenshot shows
    the real one.
  - assert on the **bytes** of a download via `readImageHeader`, not on "not empty".
- `npm run test:e2e` starts its own dev server on **port 5317** so it never collides with
  a dev server you already have open on 5173. Do not stop that one.
- **Never let a test download the matting model.** `@imgly/background-removal` pulls
  ~42 MB from a CDN; the matting test is behind `E2E_MATTING=1` and is off in CI.
- **`src/render/parity.test.ts` takes ~4 minutes for 43 cases on a loaded machine and one
  case can hit the 20 s `testTimeout`.** A `parity.test.ts` timeout under concurrent load
  is not a failure; re-run it alone before believing it.
- `e2e/shader-parity.spec.ts` compiles the real GLSL in a real WebGL2 context and
  compares it to `runCpuPasses`. It **skips** on a software rasteriser (SwiftShader,
  llvmpipe) and records the renderer string in the report, so a skip can never be read
  as a pass. Do not make it trust a software renderer.
- `e2e/shader-compile.spec.ts` compiles every exported shader on the real driver. It is
  the gate for the whole class of "the shader does not compile" defects.
- `e2e/a11y.spec.ts` runs axe over WCAG 2.1 A/AA. The `ALLOWED` list is **empty**; it was
  empty by 2026-10-03. It is a decision record, so a new entry needs a one-line reason,
  and fixing a defect means deleting the entry, not adding a suppression.
- **A gate must be green on the branch that adds it.** A red gate gets disabled, and a
  disabled gate is worth less than no gate. If something cannot be made green, do not
  add it — report it instead. The coverage thresholds and the CI format gate were both
  scoped to what actually passes; the reasoning is in `vite.config.ts` and `ci.yml`.
- **jsdom has no WebGL, and jsdom computes no layout.** Any claim about what a shader
  does, about how the two backends differ, or about whether something is reachable or
  visible is unproven until a real GPU or a real engine has run it. `jsdom` reports
  `scrollWidth === clientWidth === 0` for every element, so a jsdom overlap assertion
  passes on a panel that covers the bar by any amount.

## Counting

Every number in `README.md`, `AGENTS.md` or `docs/FEATURES.md` is a claim like any other, and
three of them were stale on 2026-10-03 by enough releases to be a different product.

```bash
npx playwright test --list | tail -1     # e2e cases and spec files — never remember this
find src e2e scripts -name '*.test.ts*' -o -name '*.test.mjs' | wc -l
```

- `npm test` prints `Tests … passed` and `Test Files … passed`. Take the test count from
  there. **2974 in 148 files** as of 2026-10-03.
- Coverage figures come from `npm run test:coverage`, and the per-area ones from
  `coverage/coverage-summary.json`, aggregated the way `vite.config.ts` aggregates them
  (covered over total, over the files under the glob). Not from the summary banner, which
  is the whole tree rather than an area.
- If a number in a document disagrees with a command's output, the command wins and the
  document is the bug.

## Architecture invariants — never break these

1. `Doc` (`src/model/types.ts`) is **JSON-serializable only**. No `ImageBitmap`, `Blob`,
   canvas, class instance or function may be stored in a `Doc` field. Pixels live in
   `AssetStore` keyed by `AssetId` (`src/model/assets.ts`). This is what makes
   history, IndexedDB persistence, context-loss recovery and copy/paste-edits work.
2. `src/gl/*` is the WebGL2 backend; `src/render/fallback2d.ts` is the Canvas2D backend.
   Both sit behind `src/render/backend.ts`. A new render pass must work in **both**, or be
   explicitly feature-gated in `src/gl/caps.ts` with a Canvas2D fallback.
3. `src/store/history.ts` is a **pure** history engine with drag coalescing. It must stay
   pure and unit-testable (no React, no DOM).
4. Any new `Doc` field needs: a default in `src/model/defaults.ts` **and** a migration in
   `src/model/migrate.ts` (bump `DocSchema` if not backwards-compatible), plus tests in
   `migrate.test.ts`.
5. Pure logic belongs in `src/lib/*` (or `src/features/*`) as small testable functions, not
   inline in components. `src/components/*` is presentation + store wiring.
6. Store updates go through `src/store/actions.ts` so history stays correct. Do not
   `setState` the doc directly from a component.
7. **Appearance is chrome, not content.** The six settings in `src/lib/appearance.ts`
   (`theme`, `density`, `textScale`, `motion`, `iconScale`, `accent`) live in one
   `localStorage` key and reach the page as six `<html>` data-attributes. None of them
   may enter `Doc`, history or IndexedDB: two people exporting the same recipe must get
   the same image, and an undo must never re-colour the canvas.
8. `index.html`'s pre-paint appearance script is **generated** by
   `appearanceBootstrapScript()`. Run `npm run appearance:sync`; never hand-edit it. A
   byte-identical guard in `appearance.test.ts` fails otherwise, and that guard is the
   whole mechanism.
9. A new runtime dependency needs an entry in `src/lib/licenses.ts` with its version,
   licence, upstream and a sentence saying why it is bundled. `npm run assets:check`
   — which `npm run build` runs first — fails without it. A new committed asset needs a
   generator and a `-- --check` mode, because `assets:check` byte-compares every
   catalogue entry against it.
10. **`public/` is copied verbatim by both `vite build` and `npm run dev`, and
    `npm run build` reads the working tree — so a file that exists on disk but is
    untracked passes every gate and ships as a 404.** `git status --porcelain public/`
    must be empty before a release. As of 2026-10-03 it was not: the 24 look strips,
    the 24 thumbnails, the 14 fonts, the licences page, the service worker, the
    manifest and the three icons are all untracked.
11. `public/models/` is gitignored, prettier-ignored, and exempt from the per-file byte
    cap by a hard-coded prefix in `check-public-budget.mjs` that assumes rather than
    checks the lock. It currently holds a 3 758 596 B `face_landmarker.task` that
    nothing references and nothing pins. Do not add to it, and do not trust a "pinned"
    line about it.

## Licence obligations are not attribution

`@imgly/background-removal@1.7.0` is **AGPL-3.0** — its own `LICENSE.md` opens with the
Affordable text. An end user running the hosted app is a _user_, not a conveyer, and owes
nothing. **Anyone who distributes this build is conveying a combined work** and owes the
corresponding source under AGPL §5(a).

This is an **open owner decision**, not a resolved question, and it is deliberately left
open. The three options — obtain permission, replace the dependency, publish the
corresponding source — and what each costs are written out in `NOTICE`, in
`AGPL_DECISION` in `src/lib/licenses.ts`, and in their own panel on `public/licenses.html`.
Do not resolve it in a comment and do not soften it back into "should read the upstream
licence before shipping it", which is advice and discharges nothing. A licence page that
lists a dependency accurately and omits the obligation is a worse problem than one that
says "we are shipping AGPL and here is what that means".

## Conventions

- TypeScript strict; no `any` (eslint `typescript-eslint` recommended is an error).
- No comments unless the surrounding code is heavily commented; match local density.
- Prettier: 2-space, single quotes, no semicolon at end of statements
  (see `.prettierrc.json`). Run `npx prettier --write <files>` on files you touch.
- Test file naming: `<sibling>.test.ts` next to the source. jsdom environment.
- Commit style: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`).
- **Do not commit.** Work is expected to stay in the working tree unless explicitly told.

## Feature work

`docs/FEATURES.md` is the catalogue of features and their status. When you implement or
verify a feature, update its row/status in that file and add tests. Pure-logic features need
unit tests; UI/interaction features need a Playwright check.

Its own rules bind you too:

- **A row's `Status` is a claim about a test.** `Working` means a named test exists that
  fails if the feature regresses. If you cannot name the file, the row is `Untested`.
- **A removed lie is `Missing`, not `Working`.** Deleting a false claim is a respectable
  outcome; the table has to be able to say which of the two happened.
- **Never invent a test title.** Every `describe`/`it` a row quotes has to be greppable in
  the file the row names. A catalogue that points at a test that does not exist is the
  exact failure mode this document exists to catch.
- **Never quietly promote a `Partial`.** If it is still partial, it stays `Partial` and the
  reason stays in §6.
- **The status vocabulary is six words.** `Working`, `Partial`, `Stub`, `Broken`, `Missing`,
  `Untested`. Anything else is a bug.
- **Update the counts in the same pass.** Header, district map, §5 index and distribution
  table, §6, §7.4 and §8 all quote numbers. They were three releases apart from each other
  on 2026-10-03 because a row was added without touching any of them.
