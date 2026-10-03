import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  evaluateBudget,
  frameBudgetMs,
  PERF_BUDGET,
  VSYNC_MS,
  type BudgetContext,
  type PerfReport,
} from '../src/lib/perf'
import type { Viewport } from '../src/store/uiStore'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * The runtime performance gate, in a real browser, on a real drag.
 *
 * Everything else about this app's performance was a claim. `check-bundle.mjs`
 * holds the download, `gen-luts.mjs --check` holds the asset bytes, and nothing
 * held what happens when a user drags a 2.4 megapixel photograph across the
 * screen. This spec measures that, and asserts the budget in the place the app
 * actually runs — not in a benchmark page, not in a dev-only branch, and not on
 * a number copied out of a comment.
 *
 * ## Which environment these numbers belong to
 *
 * The Playwright config starts `npm run dev` on port 5317, and runs four workers
 * on one host. So the **heap and storage** figures in the report are
 * dev-server figures: unminified modules, React in development mode, source maps
 * retained. They are recorded and gated against `PERF_BUDGET.heapUsedMb` /
 * `storageUsageMb`, which are set with headroom above exactly that, and
 * `report.environment` says `'dev'` in the JSON so a CI number can never be read
 * as a phone number.
 *
 * The **frame interval** is reported, not gated, and the reason is in the file
 * rather than in a comment somebody has to find. Measured in this same headless
 * Chromium, one worker: idle with no input, the page delivers 16.7 ms frames; the
 * identical drag, driven over CDP, delivers 33.3 ms. Each `mouse.move` is a round
 * trip, so the drag only asks for a new frame at about 30 Hz and the render loop
 * is timing Playwright's pointer rate, not a dropped frame. Asserting 33.4 ms
 * there would be asserting a property of the test harness.
 *
 * So `E2E_HARNESS` names the two interval metrics as paced and carries the
 * measurement with them; `evaluateBudget` puts both in `skipped` with that
 * reason, in the log and in the JSON, where a reader can see the omission. The
 * numbers behind them still travel in the report, and
 * `node scripts/check-perf.mjs` gates them for a report taken on real hardware —
 * which is the only place a 60 Hz figure means anything.
 *
 * What *is* gated absolutely here is `frameMs` and the long-task count, because
 * those are the app's own work. `frameMs` measures 0.3 ms max on this runner and
 * 0.3 ms max on an M4, and the Canvas2D regression this budget exists to catch
 * is 387 ms a frame — it trips both of them by two orders of magnitude.
 *
 * ## What makes this a gate and not a report
 *
 * Three things. The drag is driven through real pointer events on the real
 * canvas, so `useGesture` and the render loop do what they do for a user. The
 * samples come from `src/lib/perf.ts` — the *app's* module instance, resolved
 * rather than assumed; see `RESOLVE` below, and the `frames > 10` assertion that
 * catches it when the resolution is wrong. And the assertion is
 * `expect(violations).toEqual([])` on the *same* `evaluateBudget` that
 * `scripts/check-perf.mjs` applies to the JSON this run writes, so a report
 * cannot be green here and red there.
 *
 *   npx playwright test e2e/journey.perf-budget.spec.ts
 */

const REPORT_DIR = join('test-results', 'perf')

/** Sample 1, the largest bundled sample at 1271x1920 = 2.44 MP. */
const SAMPLE = 'Sample 1'

/**
 * Pointer moves per drag. 60 is about a second of continuous movement, which is
 * what "a pan" means to a person, and it is enough for a p95 to mean something:
 * the 96th percentile of 59 samples is the 57th, so the tail is measured rather
 * than interpolated from three points.
 */
const DRAG_STEPS = 60

/**
 * How far the pointer travels, in CSS pixels. A drag that does not move the
 * viewport is not a drag, and the spec asserts that it moved — a performance
 * assertion is most prone to passing on an editor that ignored the pointer.
 */
const DRAG_DX = 240
const DRAG_DY = 320

type Reading = { report: PerfReport; viewport: Viewport }

/**
 * Both page evaluations, as source strings rather than as functions.
 *
 * The reason `e2e/fixtures.ts` reads the store this way is that a dynamic
 * `import()` of a *source-relative* module path has to be resolved by the browser
 * at runtime; a literal `/Image-editor/src/...` inside a serialised function
 * would instead be a module TypeScript tries to resolve at compile time, and it
 * does not exist on disk. The string is the same trick, and the result is cast
 * to the shape the page actually returns.
 */
/** Reset the app's own monitor and remember the viewport the drag starts from. */
/**
 * Resolve the URL the **app** loaded a source module from, not the one a
 * hand-written import would fetch.
 *
 * This is not pedantry. After any Vite invalidation the dev server serves the
 * tree with a cache-busting query — `useRenderLoop.ts?t=1790805298571` imports
 * `lib/perf.ts?t=1790805298571` — and a bare `import('/src/lib/perf.ts')` is a
 * *different URL*, so it is a second copy of the module with a second, empty
 * `perfMonitor`. The first version of this spec did exactly that and read zero
 * frames from a page that had rendered sixty; the `frames > 10` assertion is
 * what turned it into a failure rather than a green run, and it is why that
 * assertion exists and why it is not relaxed anywhere below.
 *
 * The resource timeline is the honest source of truth for "what did the app
 * actually load", and it needs no production hook: `e2e/fixtures.ts` reads the
 * store the same way, and the note there about not adding a `window.__` test
 * hook applies here too.
 */
const RESOLVE = `(() => {
  const loaded = performance.getEntriesByType('resource').map((entry) => entry.name)
  const pick = (suffix) => {
    // Match on the *pathname*, never on the whole URL: the app's copy carries a
    // '?t=' query, so an endsWith test on the full URL never matches it and the
    // fallback quietly builds a base-less path that 404s.
    const matching = loaded.filter((url) => {
      try { return new URL(url).pathname.endsWith(suffix) } catch { return false }
    })
    const stamped = matching.filter((url) => url.includes('?t='))
    const found = stamped.length > 0 ? stamped : matching
    return found.length > 0
      ? found[found.length - 1]
      : new URL(suffix.replace(/^\\//, ''), document.baseURI).href
  }
  return { perf: pick('/src/lib/perf.ts'), ui: pick('/src/store/uiStore.ts') }
})()`

const ARM = `(async () => {
  const urls = ${RESOLVE}
  const perf = await import(urls.perf)
  const store = await import(urls.ui)
  perf.perfMonitor.reset()
  return store.useUiStore.getState().viewport
})()`

/** The report, taken after the drag, with storage read on demand rather than polled. */
const READ = `(async () => {
  const urls = ${RESOLVE}
  const perf = await import(urls.perf)
  const store = await import(urls.ui)
  await perf.perfMonitor.readStorage()
  return {
    report: perf.perfMonitor.readReport(),
    viewport: store.useUiStore.getState().viewport,
  }
})()`

/** Whether the monitor is still observing — the "costs nothing when idle" claim. */
const OBSERVING = `(async () => {
  const urls = ${RESOLVE}
  const perf = await import(urls.perf)
  return perf.perfMonitor.readReport()
})()`

/** The idle state on the Hub: no frames, no observer. */
const IDLE_STATE = `(async () => {
  const urls = ${RESOLVE}
  const perf = await import(urls.perf)
  const report = perf.perfMonitor.readReport()
  return { observing: report.observing, frames: report.frames, engine: report.engine }
})()`

/** The proxy the render loop chose, which is what the frame numbers are about. */
const PROXY_SIZE = `(() => {
  const element = document.querySelector('canvas.ie-canvas-el')
  return element ? { width: element.width, height: element.height } : null
})()`

/**
 * The frame cadence of *this browser*, measured while the app draws nothing.
 *
 * Not an instrument of the app — an instrument of the harness, and that is the
 * point. Four headless workers on one host deliver 30 Hz; one headed browser on
 * an M4 delivers 60 Hz; the app's render is 0.3 ms in both. Gating a drag against
 * an absolute 60 Hz number in a four-worker run is a claim about the build agent,
 * so the baseline is taken here, in the same page, immediately before the drag.
 *
 * This is a `requestAnimationFrame` cadence probe rather than the app's monitor
 * on purpose: the app renders no frames when idle, so `intervalMs` is empty and
 * there is nothing in it to baseline against.
 */
const IDLE_CADENCE_MS = 1200
const IDLE_CADENCE = `(() => new Promise((resolve) => {
  const deltas = []
  let previous = 0
  const deadline = performance.now() + ${IDLE_CADENCE_MS}
  const tick = (now) => {
    if (previous) deltas.push(now - previous)
    previous = now
    if (now < deadline) { requestAnimationFrame(tick); return }
    deltas.sort((a, b) => a - b)
    const at = (p) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))] ?? 0
    resolve({ samples: deltas.length, p50: at(0.5), p95: at(0.95) })
  }
  requestAnimationFrame(tick)
}))()`

async function readMonitor(page: Page): Promise<Reading> {
  return (await page.evaluate(READ)) as Reading
}

async function readIdleState(page: Page): Promise<{
  observing: boolean
  frames: number
  engine: string
}> {
  return (await page.evaluate(IDLE_STATE)) as {
    observing: boolean
    frames: number
    engine: string
  }
}

/** A human-readable line, so the CI log carries the measurement and not just a verdict. */
function summarise(report: PerfReport): string {
  const mib = (bytes: number | null): string =>
    bytes === null ? 'n/a' : `${(bytes / 1048576).toFixed(1)} MB`
  return (
    `${report.engine}/${report.environment}: ${report.frames} frames, ` +
    `interval p50 ${report.intervalMs.p50.toFixed(1)} / p95 ${report.intervalMs.p95.toFixed(1)} ms ` +
    `(${report.intervalMs.samples} intervals), render max ${report.frameMs.max.toFixed(2)} ms, ` +
    `${report.longTasks.count} long tasks, heap ${mib(report.heap.usedBytes)}, ` +
    `storage ${mib(report.storage.usageBytes)}`
  )
}

/**
 * What this harness cannot measure honestly, and why.
 *
 * Named rather than configured away: `evaluateBudget` moves every metric in here
 * into `skipped` with this text, so the CI log and the JSON both say what was not
 * checked and why. A budget that quietly drops a metric is a budget with a hole
 * in it; this one has a labelled one.
 */
const E2E_HARNESS: BudgetContext = {
  paced: {
    intervalP50Ms:
      'this harness paces synthetic pointer input at ~30 Hz, so the interval measures the test',
    intervalP95Ms:
      'this harness paces synthetic pointer input at ~30 Hz, so the interval measures the test',
  },
}

type Cadence = { samples: number; p50: number; p95: number }

function writeSidecar(
  browser: string,
  engine: string,
  report: PerfReport,
  proxy: unknown,
  idle: Cadence,
): void {
  mkdirSync(REPORT_DIR, { recursive: true })
  // The browser is in the filename, not just in the report. `npm run test:e2e`
  // runs chromium and webkit over the same output directory, and a bare
  // `webgl2.json` means whichever finished last silently overwrites the other —
  // which is how a WebKit report with no `performance.memory` ends up being the
  // one a reader attributes to the GL path.
  writeFileSync(
    join(REPORT_DIR, `${browser}-${engine}.json`),
    // `idleCadence` travels with the report so anyone reading the JSON can see
    // what the browser was delivering while the app drew nothing, and can tell an
    // app regression from a slow host without re-running anything.
    JSON.stringify(
      { ...report, proxy, idleCadence: idle, frameBudgetMs: frameBudgetMs(idle.p95) },
      null,
      2,
    ),
  )
}

/** One real drag, and the numbers it produced. */
async function panAndMeasure(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
): Promise<Reading> {
  const start = (await page.evaluate(ARM)) as Viewport
  const centreX = box.x + box.width / 2
  const centreY = box.y + box.height / 2
  await page.mouse.move(centreX, centreY)
  await page.mouse.down()
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    const progress = step / DRAG_STEPS
    await page.mouse.move(centreX - DRAG_DX * progress, centreY - DRAG_DY * progress)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  const reading = await readMonitor(page)
  // The drag has to have been a drag, or every number below is a measurement of
  // an editor that ignored the pointer. Asserting the exact travel would be a
  // false precision: `useGesture` damps and clamps the last move, so the landing
  // spot is a few pixels short of the pointer. What matters is that the viewport
  // travelled most of the way — a pan that did not move is a pan that measured
  // nothing.
  expect(start.x - reading.viewport.x).toBeGreaterThan(DRAG_DX * 0.8)
  expect(start.y - reading.viewport.y).toBeGreaterThan(DRAG_DY * 0.8)
  return reading
}

test.describe('runtime performance budget', () => {
  test('a pan on the largest sample holds the frame budget on WebGL2', async ({
    page,
    goto,
    loadSample,
    canvas,
  }) => {
    test.slow()
    await goto('/editor?engine=gl')
    await loadSample(SAMPLE)
    // The first frame after the decode carries shader compilation and a cold
    // pipeline, and it is not what a drag feels like. Measuring it would put a
    // startup number in a frame budget — the same category error as putting a
    // dev-server heap figure in a phone budget.
    await page.waitForTimeout(1500)

    await expect(canvas()).toBeVisible()
    const box = await canvas().boundingBox()
    if (!box) throw new Error('the presentation canvas has no box')
    const proxy = (await page.evaluate(PROXY_SIZE)) as { width: number; height: number } | null
    if (!proxy) throw new Error('the presentation canvas reported no size')

    // The module the app actually loaded, asserted once. If this is wrong the
    // spec goes on to read a second, empty monitor, and `frames > 10` below
    // fails — but failing here says *why* instead of *what*.
    const urls = (await page.evaluate(RESOLVE)) as { perf: string; ui: string }
    expect(urls.perf).toContain('/src/lib/perf.ts')
    expect(urls.ui).toContain('/src/store/uiStore.ts')

    const idleCadence = (await page.evaluate(IDLE_CADENCE)) as Cadence
    expect(idleCadence.samples).toBeGreaterThan(10)

    const { report } = await panAndMeasure(page, box)

    expect(report.engine).toBe('gl')
    expect(report.environment).toBe('dev')
    expect(report.frames).toBeGreaterThan(10)
    expect(report.intervalMs.samples).toBeGreaterThan(10)

    // The monitor must have gone quiet again. An observer that outlives the
    // interaction is the failure the module exists to prevent, and nothing else
    // in the suite would notice it.
    await page.waitForTimeout(1200)
    const quiet = (await page.evaluate(OBSERVING)) as PerfReport
    expect(quiet.observing).toBe(false)

    const { violations, skipped } = evaluateBudget(report, PERF_BUDGET, E2E_HARNESS)
    console.log(
      `WebGL2 pan @ ${proxy.width}x${proxy.height}: ${summarise(report)}\n` +
        `  harness idle cadence, no input: p50 ${idleCadence.p50.toFixed(1)} / ` +
        `p95 ${idleCadence.p95.toFixed(1)} ms (a real-hardware cap would be ` +
        `${frameBudgetMs(idleCadence.p95).toFixed(1)} ms)`,
    )
    for (const entry of skipped) console.log(`  not gated: ${entry}`)
    expect(violations.map((violation) => violation.message)).toEqual([])

    const browser = test.info().project.name
    writeSidecar(browser, 'webgl2', report, proxy, idleCadence)
  })

  test('the Canvas2D fallback holds the same budget, because that is the weak device', async ({
    page,
    goto,
    loadSample,
    canvas,
  }) => {
    test.slow()
    await goto('/editor?engine=canvas2d')
    await loadSample(SAMPLE)
    await page.waitForTimeout(1500)

    await expect(canvas()).toBeVisible()
    const box = await canvas().boundingBox()
    if (!box) throw new Error('the presentation canvas has no box')

    const idleCadence = (await page.evaluate(IDLE_CADENCE)) as Cadence
    expect(idleCadence.samples).toBeGreaterThan(10)

    const { report } = await panAndMeasure(page, box)

    expect(report.engine).toBe('canvas2d')
    expect(report.frames).toBeGreaterThan(10)
    // The fallback gates the LUT3D family, so its plan is not the GL plan; the
    // frame budget is the same number and the assertion has to be too.
    expect(report.intervalMs.samples).toBeGreaterThan(10)

    const { violations, skipped } = evaluateBudget(report, PERF_BUDGET, E2E_HARNESS)
    console.log(
      `Canvas2D pan: ${summarise(report)}\n` +
        `  harness idle cadence, no input: p50 ${idleCadence.p50.toFixed(1)} / ` +
        `p95 ${idleCadence.p95.toFixed(1)} ms (a real-hardware cap would be ` +
        `${frameBudgetMs(idleCadence.p95).toFixed(1)} ms)`,
    )
    for (const entry of skipped) console.log(`  not gated: ${entry}`)
    expect(violations.map((violation) => violation.message)).toEqual([])

    writeSidecar(test.info().project.name, 'canvas2d', report, null, idleCadence)
  })

  test('the editor measures nothing at all when nothing is scheduled', async ({ page, goto }) => {
    // The Hub, where every visitor lands and where no frame is rendered.
    await goto('/')
    const state = await readIdleState(page)
    console.log(`idle: ${JSON.stringify(state)}`)
    expect(state.observing).toBe(false)
    expect(state.frames).toBe(0)
  })
})

test.describe('the budget itself', () => {
  test('is bracketed between what the app measures and the regression it catches', () => {
    // Measured on an M4 / ANGLE-Metal build, Sample 1, 994x1502 proxy, a look and
    // a full tonal stack applied, 60-step pan: interval p50 16.7, p95 16.8 (gl)
    // and 17.2 (canvas2d); zero long tasks. The regression floor is one full
    // Canvas2D pipeline render — 387 ms — which is what a pan costs if the
    // unchanged-plan short-circuit in `fallback2d.ts` stops matching.
    expect(PERF_BUDGET.intervalP50Ms).toBeGreaterThan(16.7)
    expect(PERF_BUDGET.intervalP50Ms).toBeLessThan(33.4)
    expect(PERF_BUDGET.intervalP95Ms).toBeGreaterThan(17.2)
    expect(PERF_BUDGET.intervalP95Ms).toBeLessThan(387)
    expect(PERF_BUDGET.frameMs).toBe(VSYNC_MS)
  })
})
