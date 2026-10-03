#!/usr/bin/env node
/**
 * Apply the runtime performance budgets to a measured report.
 *
 * `scripts/check-bundle.mjs` gates what a visitor downloads. This gates what the
 * app does once it is running, and it is a *separate* script on purpose: the
 * bundle check is deterministic and runs on every build, while this one is fed a
 * report that was measured somewhere — a browser, a device, a CI runner — and
 * the only honest thing it can do is compare that report against a table and
 * print both numbers.
 *
 * The report itself comes from `src/lib/perf.ts`, which `useRenderLoop` records
 * into on every frame it actually renders. The e2e spec writes one to
 * `test-results/perf/`, which is where CI looks; a report taken on a real phone
 * goes in the same place and is checked by the same code, so a number that only
 * a device can produce is still a number with a gate on it.
 *
 *   node scripts/check-perf.mjs                       # check test-results/perf/
 *   node scripts/check-perf.mjs some/report.json      # check one file
 *   node scripts/check-perf.mjs a.json b.json         # check several
 *
 * A report that does not exist is a failure, not a pass. "No report" is the
 * state a gate silently sits in when a step upstream stopped running, and a
 * performance budget that is green because nobody measured anything is worse
 * than no budget at all — it is a claim.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Node 24 strips the types, so the gate and the Vitest suite run the same rules
// against the same table — the arrangement `verify-assets.mjs` already uses for
// `src/lib/licenses.ts`, and for the same reason: two implementations of one
// budget is one too many.
import { evaluateBudget, PERF_BUDGET } from '../src/lib/perf.ts'

/** Where the e2e gate writes its report, and what CI points this at. */
export const DEFAULT_REPORT_DIR = 'test-results/perf'

/**
 * Every field the budget reads. A report that is missing one of these is not a
 * report — it is a file that happens to be JSON — and silently treating absent
 * numbers as zero is how a budget starts passing on a shape it never saw.
 */
const REQUIRED_SHAPE = {
  environment: 'string',
  engine: 'string',
  frames: 'number',
  frameMs: 'object',
  intervalMs: 'object',
  longTasks: 'object',
  heap: 'object',
  storage: 'object',
}

/**
 * @param {unknown} value
 * @param {string} kind
 * @param {string} key
 * @returns {string | null}
 */
function typeProblem(value, kind, key) {
  if (kind === 'object') {
    return typeof value === 'object' && value !== null ? null : `"${key}" is not an object`
  }
  return typeof value === kind ? null : `"${key}" is not a ${kind}`
}

/** @param {string} path @returns {{ problems: string[], report: Record<string, unknown> | null }} */
function readReport(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { problems: [`${path} does not exist — nothing was measured`], report: null }
  }
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      problems: [`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`],
      report: null,
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { problems: [`${path} is not a JSON object`], report: null }
  }
  const report = /** @type {Record<string, unknown>} */ (parsed)
  const problems = []
  for (const [key, kind] of Object.entries(REQUIRED_SHAPE)) {
    const problem = typeProblem(report[key], kind, key)
    if (problem) problems.push(`${path}: ${problem}`)
  }
  return { problems, report: problems.length === 0 ? report : null }
}

/** @param {string} dir */
export function reportFiles(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(dir, name))
  } catch {
    return []
  }
}

/**
 * The frame cadence the browser was already delivering while the app drew
 * nothing, recorded beside the report by the e2e spec.
 *
 * Its presence means the report came from a **harness**, and that is the whole
 * signal. A harness drives the pointer over a wire, so the drag only asks for a
 * frame as often as the wire can ask; measured on a five-browser CI job, the
 * whole host delivers 49 ms frames and the pan measures 66 ms, and neither number
 * is about the editor. A report without the field came from real hardware, where
 * an absolute 60 Hz cap is exactly the right thing.
 *
 * So this does not compute a relaxed cap — it *omits* the interval from the
 * gate, with the reason, which is the same rule `e2e/journey.perf-budget.spec.ts`
 * applies through `evaluateBudget`'s `paced` context. Two implementations of one
 * budget is one too many, and the two are now the same rule rather than
 * approximately the same rule.
 *
 * @param {Record<string, unknown>} report
 * @returns {{ idleP95Ms: number } | null }
 */
function idleCadenceOf(report) {
  const cadence = report.idleCadence
  if (typeof cadence !== 'object' || cadence === null) return null
  const p95 = /** @type {{ p95?: unknown }} */ (cadence).p95
  return typeof p95 === 'number' && Number.isFinite(p95) && p95 > 0 ? { idleP95Ms: p95 } : null
}

/**
 * Check one report file. Pure over the filesystem so the test can point it at a
 * hand-written fixture rather than at whatever the last e2e run left behind.
 *
 * @param {string} path
 * @param {import('../src/lib/perf.ts').PerfBudget} [budget]
 */
export function checkReport(path, budget = PERF_BUDGET) {
  const { problems, report } = readReport(path)
  if (report === null) return { path, lines: [], problems, skipped: [] }

  const interval = /** @type {{p50: number, p95: number, samples: number}} */ (report.intervalMs)
  const frame = /** @type {{p50: number, p95: number, max: number, samples: number}} */ (
    report.frameMs
  )
  const longTasks = /** @type {{count: number, totalMs: number, maxMs: number}} */ (
    report.longTasks
  )

  const cadence = idleCadenceOf(report)
  const context = cadence
    ? {
        paced: {
          intervalP50Ms: `measured in a harness delivering ${cadence.idleP95Ms.toFixed(1)} ms idle frames`,
          intervalP95Ms: `measured in a harness delivering ${cadence.idleP95Ms.toFixed(1)} ms idle frames`,
        },
      }
    : {}

  const lines = [
    `${String(report.engine)} / ${String(report.environment)} — ` +
      `${report.frames} frames, ${interval.samples} intervals`,
    `  frame interval  p50 ${interval.p50.toFixed(1)} ms   p95 ${interval.p95.toFixed(1)} ms` +
      (cadence
        ? `   (reported, not gated: a harness was driving at ${cadence.idleP95Ms.toFixed(1)} ms)`
        : `   (budget ${budget.intervalP50Ms.toFixed(1)} / ${budget.intervalP95Ms.toFixed(1)})`),
    `  render cost     p50 ${frame.p50.toFixed(2)} ms   max ${frame.max.toFixed(2)} ms` +
      `   (budget ${budget.frameMs.toFixed(1)})`,
    `  long tasks      ${longTasks.count} (${longTasks.totalMs.toFixed(0)} ms total)`,
  ]

  const { violations, skipped } = evaluateBudget(
    /** @type {import('../src/lib/perf.ts').PerfReport} */ (report),
    budget,
    context,
  )
  return {
    path,
    lines,
    skipped,
    problems: violations.map((violation) => `${path}: ${violation.message}`),
  }
}

function main() {
  const args = process.argv.slice(2)
  const targets = args.length > 0 ? args : reportFiles(resolve(DEFAULT_REPORT_DIR))
  if (targets.length === 0) {
    console.error(
      `No performance report in ${DEFAULT_REPORT_DIR}/. Run the e2e gate first:\n` +
        '  npx playwright test e2e/journey.perf-budget.spec.ts',
    )
    process.exit(1)
  }

  const problems = []
  for (const target of targets) {
    const result = checkReport(target)
    console.log(`\n${result.path}`)
    for (const line of result.lines) console.log(line)
    for (const entry of result.skipped) console.log(`  not measured: ${entry}`)
    problems.push(...result.problems)
  }

  if (problems.length > 0) {
    console.error('\nPerformance budget check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('\nperformance budget check passed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
