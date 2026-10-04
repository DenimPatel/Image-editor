# Recon / Runbook — gate map and PRE-EXISTING BASELINE

Branch `improve/auto-20261004` (from `main` at `10ade26`). Working tree clean except
untracked `.improve/` (this loop's own scaffolding). Baseline captured **2026-10-04**.

Every number below is a command's output. Where `AGENTS.md` disagrees, the command
wins and `AGENTS.md` is the bug — several of its load-bearing numbers are stale.

---

## 1. Verified commands (copy-pasteable)

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"

# 1. Unit suite — 3060 tests / 153 files, ~70 s
npm test

# 2. Coverage suite — same tests + per-area thresholds, ~123 s
npm run test:coverage

# 3. Per-area coverage from coverage-summary.json, aggregated
#    covered/total over the files under each glob (NOT the banner):
#    node -e 'const s=require("./coverage/coverage-summary.json");/* see §5 */'

# 4. Typecheck — clean
npm run typecheck

# 5. Lint — clean
npm run lint

# 6. Format — see PRE-EXISTING FAILURES
npx prettier --check .

# 7. Build — assets:check + tsc -b + vite build + bundle + public budget, ~30 s
npm run build

# 8. e2e inventory (DO NOT run the suite; it is minutes and needs 3 browsers)
npx playwright test --list | tail -1

# 9. Dev server / public hygiene
lsof -nP -iTCP:5173 -sTCP:LISTEN
git status --porcelain public/

# 10. Environment / deps
node -e "console.log(process.version)"
npm ls --depth=0
```

**Do not run:** `npm run test:e2e` (minutes × 3 projects) and `npm run dev` in the
foreground. The e2e dev server is pinned to 5317 and does not collide with 5173.

**Scope discipline:** `npx vitest run src/lib/curves.ts` for a single file. Never `-u`.
Under concurrent load `src/render/parity.test.ts` can hit the 20 s `testTimeout`;
re-run it alone before believing a timeout.

---

## 2. Baseline results

| #   | Gate          | Command                                 | Exit  | Summary line                                                                                                                     |
| --- | ------------- | --------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Unit          | `npm test`                              | **0** | `Test Files 153 passed (153)` / `Tests 3060 passed (3060)` / `Duration 70.40s`                                                   |
| 2   | Typecheck     | `npm run typecheck`                     | **0** | `tsc -b`, no output                                                                                                              |
| 3   | Lint          | `npm run lint`                          | **0** | `eslint .`, no output                                                                                                            |
| 4   | Format        | `npx prettier --check .`                | **1** | 1 file: `.improve/STATE.md`                                                                                                      |
| 5   | Build         | `npm run build`                         | **0** | `✓ built in 1.50s` / `bundle check passed` / `✓ public/ is 1.95 MB across 74 files`                                              |
| 6   | Coverage      | `npm run test:coverage`                 | **0** | `Statements 89.57% (10813/12071)` / `Branches 81.42% (5463/6709)` / `Functions 88.83% (2300/2589)` / `Lines 92.23% (9687/10502)` |
| 7   | e2e inventory | `npx playwright test --list \| tail -1` | **0** | `Total: 659 tests in 41 files`                                                                                                   |
| 8   | Port 5173     | `lsof -nP -iTCP:5173 -sTCP:LISTEN`      | —     | **OCCUPIED** — see §6                                                                                                            |
| 9   | `public/`     | `git status --porcelain public/`        | —     | **EMPTY** (0 lines) — see §6                                                                                                     |
| 10  | Deps          | `npm ls --depth=0`                      | **0** | 29 top-level deps, no `invalid`, no `UNMET`                                                                                      |

Unit run wall clock: **70.40 s** (vitest's own figure, `tests 45% environment 44%`).
Coverage run wall clock: **123.08 s**.

---

## 3. PRE-EXISTING FAILURES (red at baseline — do not blame new work)

### FAIL-1 — `npx prettier --check .` → exit 1, one file

```
Checking formatting...
[warn] .improve/STATE.md
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

**Diagnosis: loop-induced, not repo breakage.**

- `.improve/STATE.md` is **untracked** (`git status --porcelain .improve/` → `?? .improve/`),
  created at 20:27 today by the improvement loop, and is written by hand, not by prettier.
- **Every tracked source file in the repo is format-clean.** Running prettier against
  the tracked tree is green.
- `.prettierignore` exists and already excludes `node_modules/`, `dist/`, `coverage/`,
  `test-results/`, `playwright-report/`, `blob-report/`, `.playwright-mcp/`,
  `public/models/`, `.kilo/` — **but not `.improve/`**.
- This matters: `npx prettier --check .` is a gate in **both** workflows —
  `.github/workflows/ci.yml:33` and `.github/workflows/deploy.yml:36` — repo-wide.
  So this one untracked file will turn CI and deploy red on every push.

**Verdict for later verifiers:** a format failure whose only `[warn]` is under
`.improve/` is this baseline failure, not a regression. A format failure naming any
path under `src/`, `e2e/`, `scripts/`, or a root config file **is** new.
The durable fix is a `.improve/` line in `.prettierignore` (or a `state/` subdir that
is ignored) — **not** a one-off `prettier --write`, because the loop rewrites
`STATE.md` every cycle and will re-break the gate.

### Everything else is green

No other gate is red. Typecheck, lint, unit, coverage, build and the e2e inventory
are all exit 0 at baseline.

### Benign noise that is NOT a failure

`npm test` and `npm run test:coverage` exit 0 but print a large volume of jsdom
`Error:` output on stderr. These are expected and pre-existing; do not report them as
regressions:

- `Error: The document names a source the editor no longer holds (asset_not_a_bitmap).
The stored asset is not an ImageBitmap. Reload the page to recover it.`
  — thrown from `bitmapFor` at `src/pages/Editor.tsx:104` and re-thrown during a
  render at `src/pages/Editor.tsx:147`. A test deliberately exercises that path.
- `Error: Not implemented: HTMLCanvasElement.prototype.getContext (without installing
the canvas npm package)` and `… .toDataURL` — from `probeFormats`/`probeCanvasArea`
  at `src/gl/caps.ts:166` and `src/gl/caps.ts:181`, reached via
  `defaultMaxPixels` → `decodeImageBlob` → `decodeStickerFile`
  (`src/features/layers/stickers.test.ts:115`). jsdom has no WebGL; the caps
  probes are supposed to degrade.

Both are also why the run prints vitest's
`Environment jsdom was created 153 times` performance hint. That hint is not a gate.

---

## 4. Coverage per area, measured from `coverage/coverage-summary.json`

Aggregated the way `vite.config.ts` aggregates a glob: covered ÷ total, summed over
the files under the area. Every area clears its threshold. Format is
`pct (verdict vs threshold)`.

| Area                | Files | Lines       | Branches                 | Functions   | Statements  | Thresholds L/B/F/S |
| ------------------- | ----- | ----------- | ------------------------ | ----------- | ----------- | ------------------ |
| `src/model/**`      | 7     | 95.7 ok     | 88.6 ok                  | 99.0 ok     | 93.3 ok     | 94/86/96/91        |
| `src/lib/**`        | 41    | 95.9 ok     | 86.6 ok                  | 96.6 ok     | 92.8 ok     | 93/84/93/90        |
| `src/store/**`      | 6     | 97.2 ok     | 90.0 ok                  | 95.3 ok     | 96.2 ok     | 94/88/92/93        |
| `src/features/**`   | 19    | 98.0 ok     | 87.0 ok                  | 95.7 ok     | 95.0 ok     | 96/85/93/93        |
| `src/gl/**`         | 18    | 93.2 ok     | 74.5 ok                  | 92.0 ok     | 89.2 ok     | 91/72/89/87        |
| `src/render/**`     | 10    | 95.5 ok     | 80.5 ok                  | 87.5 ok     | 93.7 ok     | 94/78/86/92        |
| `src/components/**` | 79    | 87.3 ok     | 79.8 ok                  | 82.1 ok     | 85.0 ok     | 84/76/79/81        |
| **`src/pages/**`**  | 2     | **63.0 ok** | **51.3 ok** (thr **48**) | **50.9 ok** | **60.9 ok** | 60/48/47/57        |
| `src/hooks/**`      | 6     | 83.9 ok     | 72.9 ok                  | 84.7 ok     | 82.3 ok     | 80/69/80/79        |
| `src/router.tsx`    | 1     | 100.0 ok    | n/a (0 branches)         | 33.3 ok     | 77.8 ok     | 100/100/33/77      |

`src/pages/**` per file, branches:

| File                   | Branches        |
| ---------------------- | --------------- |
| `src/pages/Editor.tsx` | 48.6 % (51/105) |
| `src/pages/Hub.tsx`    | 80.0 % (8/10)   |

Thresholds live at `vite.config.ts:191-207`. Thinnest margin in the tree is
`src/render/**` functions (87.5 vs 86, +1.5) and `src/components/**` lines
(87.3 vs 84, +3.3); `src/pages/**` branches has +3.3.

---

## 5. How to recompute §4

`coverage-summary.json` keys are absolute paths, and the banner is whole-tree, not
per-area. Match on the path segment, then sum covered/total:

```bash
node -e '
const s=require("./coverage/coverage-summary.json");
const defs=[["src/model/**","/src/model/",94,86,96,91],["src/lib/**","/src/lib/",93,84,93,90],
["src/store/**","/src/store/",94,88,92,93],["src/features/**","/src/features/",96,85,93,93],
["src/gl/**","/src/gl/",91,72,89,87],["src/render/**","/src/render/",94,78,86,92],
["src/components/**","/src/components/",84,76,79,81],["src/pages/**","/src/pages/",60,48,47,57],
["src/hooks/**","/src/hooks/",80,69,80,79]];
const pct=([c,t])=>t?+(100*c/t).toFixed(1):NaN;
for(const [g,p,l,b,f,s] of defs){
  const t={lines:[0,0],branches:[0,0],functions:[0,0],statements:[0,0]};
  for(const [k,v] of Object.entries(s0=s)){ if(k==="total"||!k.includes(p))continue;
    for(const m of ["lines","branches","functions","statements"]){t[m][0]+=v[m].covered;t[m][1]+=v[m].total;} }
  console.log(g,pct(t.lines),pct(t.branches),pct(t.functions),pct(t.statements),"vs",l,b,f,s);}
'
```

---

## 6. Environment, ports, dependency and `public/` health

### Port 5173 — **OCCUPIED. Do not kill it.**

```
COMMAND   PID  USER   FD   TYPE   DEVICE  SIZE/OFF NODE NAME
node    27068 pvrun   14u  IPv4   0x1...  0t0  TCP *:5173 (LISTEN)
```

- PID **27068**, PPID 27052.
- Command line: `node /Users/pvrun/Desktop/Denim/git/Image-editor/node_modules/.bin/vite
--host 0.0.0.0 --port 5173 --strictPort`
- `lsof -a -p 27068 -d cwd` → `/Users/pvrun/Desktop/Denim/git/Image-editor`
  — it is **this repo's** dev server, deliberately left up for interactive work.
- Port 5317 (the e2e server) is free, so `npm run test:e2e` would not have collided
  even had 5173 been busy.

### `git status --porcelain public/` — **EMPTY**

`public/` is fully clean and fully tracked: **74 tracked files**
(`404.html`, `apple-touch-icon.png`, `public/fonts/**` 16,
`icon-192.png`, `icon-512.png`, `licenses.html`, `public/look-thumbs/**` 24,
`public/luts/**` 24, `manifest.webmanifest`, `public/sample-images/**` 3, `sw.js`).
Invariant 10's "all untracked" claim no longer holds. The invariant's _rule_ — that
the output must be empty before a release — still holds and still passes.

### Dependency health — clean

`node -v` → **v24.21.0**. `npm ls --depth=0` → exit 0, 29 packages, **no `invalid`,
no `UNMET`, no `deduped` warnings**. Notable: `@imgly/background-removal@1.7.0` (AGPL-3.0),
`@playwright/test@1.63.0`, `vite@8.3.0`, `vitest@5.0.2`, `typescript@5.9.3`,
`eslint@10.10.0`, `onnxruntime-web@1.21.0`, `jspdf@4.2.1`, `react@18.3.1`.

### `public/models/` is empty

`ls -la public/models/` → no files. Root `models.lock.json` carries
`"models": []` and 14 font entries, and `scripts/check-public-budget.mjs` no longer
exempts by path prefix — it checks the lock per file. So the build's
`(sha256-pinned) 266.7 kB 14 files exempt from the per-file cap; each is listed in
models.lock.json` line is the **14 woff2 fonts**, not models.

---

## 7. Stale claims in `AGENTS.md` (verified corrections)

Verified numbers, current as of 2026-10-04:

| AGENTS.md claim                                                                                                | Actual                                                                                                                                       | Where the claim lives                  |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `npm test` = **2974 tests in 148 files**                                                                       | **3060 tests in 153 files**                                                                                                                  | gate table, and the Counting bullet    |
| coverage is **RED**, `src/pages/**` branches **37.4 vs 38**                                                    | **GREEN**; `src/pages/**` branches **51.3 vs 48** (thr 48)                                                                                   | gate table, and the paragraph under it |
| e2e = **623 cases in 38 spec files**                                                                           | **659 cases in 41 files**                                                                                                                    | gate table                             |
| `public/` is full of untracked files                                                                           | `git status --porcelain public/` is **empty**; 74 tracked files                                                                              | invariant 10                           |
| `public/models/` holds an unpinned 3 758 596 B `face_landmarker.task`; budget exempted it by hard-coded prefix | `public/models/` is **empty**, lock has `"models": []`, no prefix exemption                                                                  | invariant 11                           |
| e2e matrix "did not include `mobile` until 2026-10-03"                                                         | **correct** — `ci.yml:134-139` is `chromium/chromium`, `webkit/webkit`, `mobile/chromium`; `playwright.config.ts:44,68,81` defines all three | accurate                               |
| `e2e/a11y.spec.ts` `ALLOWED` list empty                                                                        | `ALLOWED` is empty as described                                                                                                              | accurate                               |

Counts for the loop to reuse:

- unit: **3060 tests, 153 files** (`find src e2e scripts -name '*.test.ts*' -o -name '*.test.mjs' | wc -l` → 153, consistent)
- e2e: **659 cases, 41 files** = 320 chromium + 320 webkit + 19 mobile
- mobile cases: 19, owned by `journey.mobile.spec.ts` + `journey.mobile-touch.spec.ts` (the prefix is correct in AGENTS.md — it is not one filename)
- non-mobile e2e specs: 39 of 41

---

## 8. What a change must clear

For a **pure-logic** change, the minimum bar is:

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
npx vitest run <the test file>     # fast path
npm run typecheck
npm run lint
npx prettier --check <files you touched>   # scoped; see FAIL-1 for the repo-wide form
```

For a **UI/interaction** change, additionally author a case in an
`e2e/journey.*.spec.ts` file on the `test` from `e2e/fixtures.ts`, never a raw
`import { test } from '@playwright/test'`. Locate by accessible name or role, never a
CSS-module class. Assert on `readDoc()` / `persistedDoc()`, and on download **bytes**
via `readImageHeader`.

For a **release**, additionally require:

```bash
npm run build
git status --porcelain public/   # must be empty
```

Baseline-diff rules for verifiers:

- New failure in `npm test` → a real regression; baseline is 3060/153, exit 0.
- New failure in `typecheck` or `lint` → real; baseline exit 0 with no output.
- New failure in `build` → real; baseline exit 0. If `assets:check` is what fails, the
  message names the generator — re-run that generator with `--check` to reproduce.
- New failure in `test:coverage` → real; baseline exit 0. Check the per-area table in
  §4 for the area you touched; all clear their thresholds.
- `prettier` failure whose only `[warn]` is under `.improve/` → **baseline FAIL-1**, not
  a regression. See §3.
- A `parity.test.ts` timeout under load → not a failure; re-run it alone.
- e2e inventory count moving is expected when e2e cases are added; a _unit_ count moving
  with no test files added is not.
