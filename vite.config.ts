/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The build stamp, injected into the bundle as `__APP_VERSION__` /
 * `__COMMIT_SHA__` (declared in `src/vite-env.d.ts`, read by
 * `src/lib/buildInfo.ts`).
 *
 * `package.json` is the single source for the version. The alternative — a
 * literal in `defaults.ts` plus a test that greps for a second copy — is what
 * this replaces: `APP_VERSION` was a hardcoded `'1.0.0'` that nothing derived
 * from `package.json`, so a release bump moved one and not the other with
 * nothing failing. Reading the file here makes divergence impossible to
 * express rather than merely tested against.
 *
 * The SHA is best-effort by design. A release tarball, a Docker `COPY`, and a
 * vendored tree have no `.git`, and `git rev-parse` then exits non-zero — which
 * would fail the build. `UNKNOWN_COMMIT_SHA` is returned instead, because a UI
 * that prints `undefined` reads as a bug and a blank reads as "unavailable".
 */
const UNKNOWN_COMMIT_SHA = 'unknown'

function resolveCommitSha(): string {
  try {
    return (
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: import.meta.dirname,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || UNKNOWN_COMMIT_SHA
    )
  } catch {
    return UNKNOWN_COMMIT_SHA
  }
}

function resolveAppVersion(): string {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
  )
  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('package.json has no usable "version" to stamp the build with')
  }
  return version
}

const APP_VERSION = resolveAppVersion()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/Image-editor/',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __COMMIT_SHA__: JSON.stringify(resolveCommitSha()),
  },
  optimizeDeps: {
    // onnxruntime-web ships an optional WASM entry point; let it resolve at
    // runtime instead of being pre-bundled by esbuild.
    exclude: ['onnxruntime-web'],
  },
  worker: {
    // ES workers so `comlink` and dynamic imports work in every browser.
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * D9-F08 — only the chunks that are genuinely on the critical path.
         *
         * This function used to name a `matting` chunk
         * (`@imgly/background-removal` + `onnxruntime-web`) and a `pdf` chunk
         * (`jspdf`). Both are reached through a dynamic import, and both were
         * correct as *names* — and both were the reason the Hub eagerly
         * preloaded 865 kB of matting and 405 kB of PDF on first paint. Naming
         * a chunk in `manualChunks` makes Rolldown emit it as a static
         * dependency of the entry, and Vite writes a `modulepreload` for every
         * static dependency of the entry, so a `manualChunks` rule silently
         * moved an optional dependency onto the critical path of a page that
         * never uses it. `scripts/check-bundle.mjs` fails the build if that
         * comes back, and the test next to it asserts the same rules without
         * needing a build.
         *
         * `react` and `vendor-ui` are named because they *are* in the entry's
         * static graph; splitting them out is what keeps the entry chunk at
         * ~21 kB rather than 286 kB.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@use-gesture') || id.includes('zustand')) return 'vendor-ui'
          if (id.includes('react')) return 'react'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Vitest's default `include` is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // also matches the Playwright suite in `e2e/`. Running it under Vitest
    // fails on `test.describe`, and a runner collecting another runner's specs
    // is noise in every report. `playwright.config.ts` is outside `e2e/` and is
    // not matched by the default glob.
    //
    // Note for whoever owns the worktree layout: an Agent Manager worktree under
    // `.kilo/` carries its own copy of `src/`, so the default glob also collects
    // ~28 files and ~204 tests that belong to a *different* checkout. A reported
    // test count that silently includes another branch's tests is not a count
    // anyone can reason about, so the worktree is excluded.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '.kilo/**'],
    // V8 coverage instrumentation roughly doubles the cost of the parity and
    // shader suites, and Vitest's 5 s default is tight enough that
    // `src/render/parity.test.ts` times out *only* under `--coverage`. The
    // number is the default, not a per-test override: every suite still fails
    // fast on a real hang.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      // `include` with a glob rather than a bare extension list, so a source
      // file nobody ever wrote a test for is still reported — at 0% — instead
      // of being absent. A coverage number that quietly omits the untested
      // files is the number most likely to mislead. (Vitest 3 dropped the old
      // `all: true` flag; this is its replacement.)
      reportsDirectory: './coverage',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
      /**
       * Per-area thresholds, grouped the way the code is actually shaped.
       *
       * Every number below is the **measured** figure for that area minus three
       * points of headroom, and the table in this comment is the measurement it
       * came from. They are deliberately close to today, not aspirational: a red
       * coverage gate gets deleted within a week, and a deleted gate is worth
       * less than no gate. A threshold that is below what the area meets by an
       * order of magnitude is not a gate at all.
       *
       * Measured, from `npm run test:coverage` aggregated the way Vitest
       * aggregates a glob (covered over total, over the files under the glob):
       *
       *   area          lines  branches  funcs  stmts
       *   src/model       95.7     88.6   99.0   93.3
       *   src/lib         95.9     86.7   96.6   92.8
       *   src/store       97.2     90.0   95.3   96.2
       *   src/features    98.0     87.0   95.7   95.0
       *   src/gl          93.2     74.5   92.0   89.2
       *   src/render      95.5     80.5   87.5   93.7
       *   src/components  87.0     79.4   82.1   84.7
       *   src/pages       63.0     51.3   50.9   60.9
       *   src/hooks       83.9     72.6   83.9   82.2
       *   src/router.tsx 100.0       n/a   33.3   77.8
       *
       * A threshold is only raised when the area clears measured-minus-three
       * under that rule. `src/model`, `src/lib`, `src/features`, `src/gl`,
       * `src/render` and `src/router.tsx` are already at or above it and are
       * left exactly where they were.
       *
       * `src/gl` and `src/render` are *not* the uncovered outlier the roadmap
       * implies: `src/render/parity.test.ts` replays the real GLSL through an
       * interpreter, so lines and functions are high and it is branches that
       * lag.
       *
       * `src/pages` is still the lowest area, and the reason is structural rather
       * than a backlog. `Editor.tsx` is the routing, lifecycle and wiring layer
       * for a page that mounts a render backend, reads IndexedDB, decodes in
       * three different ways and owns an autosave with two copies of the
       * document; jsdom can reach all of that now, but not the parts of it that
       * need a GPU or a real layout, and those branches stay uncovered on
       * purpose rather than by accident.
       *
       * What moved it from 43/28/40/43 to where it is: `smoke.test.tsx` was three
       * `renderToString` string assertions, so no effect and no handler ever ran,
       * and nothing opened a workspace, because the Editor builds a real render
       * backend on mount and jsdom has no canvas. `testHarness` now carries the
       * canvas, `ResizeObserver`, `matchMedia` and `scrollIntoView` stubs a page
       * test needs to get past those four walls, and the three import routes,
       * the resume lifecycle, the route-error recovery and the Hub→route→panel
       * invariant are driven for real. `Hub.tsx` is at 100/80/100/95 on its own;
       * `Editor.tsx` is at 60/49/44/58, and the branches still missing in it are
       * the ones the e2e suite owns.
       */
      thresholds: {
        'src/model/**': { lines: 94, branches: 86, functions: 96, statements: 91 },
        'src/lib/**': { lines: 93, branches: 84, functions: 93, statements: 90 },
        'src/store/**': { lines: 94, branches: 88, functions: 92, statements: 93 },
        'src/features/**': { lines: 96, branches: 85, functions: 93, statements: 93 },
        'src/gl/**': { lines: 91, branches: 72, functions: 89, statements: 87 },
        'src/render/**': { lines: 94, branches: 78, functions: 86, statements: 92 },
        'src/components/**': { lines: 84, branches: 76, functions: 79, statements: 81 },
        'src/pages/**': { lines: 60, branches: 48, functions: 47, statements: 57 },
        'src/hooks/**': { lines: 80, branches: 69, functions: 80, statements: 79 },
        // `src/router.tsx` builds four lazy routes, and a `lazy()` callback only
        // runs when a route is navigated to — which jsdom never does. Lines and
        // branches are fully covered by the module-level `routes` array; the
        // two uncovered functions are the dynamic-import thunks the e2e suite
        // exercises instead. Measured 100 / 100 / 33 / 78.
        'src/router.tsx': { lines: 100, branches: 100, functions: 33, statements: 77 },
      },
    },
  },
})
