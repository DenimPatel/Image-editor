import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkReport, DEFAULT_REPORT_DIR, reportFiles } from './check-perf.mjs'
import { PERF_BUDGET, VSYNC_MS } from '../src/lib/perf.ts'

/**
 * The performance budget, asserted against hand-written reports.
 *
 * A frame-time gate that can only be exercised by driving a real browser on a
 * real machine is a gate that is red on a developer's laptop twice a year and
 * green everywhere else. The measurement is real — `src/lib/perf.ts` records it
 * and `e2e/journey.perf-budget.spec.ts` takes it in a browser — but the *rules*
 * are checkable here, against a fixture, with no build and no browser. That is
 * the same standard `check-bundle.test.mjs` set for the bundle gate.
 *
 * The fixtures are the two states this app has actually been in: a healthy drag
 * on an M4, and the Canvas2D pipeline re-running on every pan frame. The second
 * one is not invented — it is what happens if the `lastHash` short-circuit in
 * `src/render/fallback2d.ts` stops matching, and it is 387 ms a frame.
 */

/** @type {string[]} */
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * @param {Record<string, unknown>} report
 * @returns {string}
 */
function writeReport(report) {
  const root = mkdtempSync(join(tmpdir(), 'ie-perf-'))
  roots.push(root)
  const path = join(root, 'report.json')
  writeFileSync(path, JSON.stringify(report, null, 2))
  return path
}

/**
 * The numbers the app meets today, on a real machine, on a real drag.
 *
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function healthy(overrides = {}) {
  return {
    environment: 'production',
    engine: 'gl',
    observing: false,
    frames: 61,
    frameMs: { samples: 61, p50: 0.1, p95: 0.2, max: 0.4, mean: 0.11 },
    intervalMs: { samples: 60, p50: 16.7, p95: 16.8, max: 18.6, mean: 16.68 },
    longTasks: { count: 0, totalMs: 0, maxMs: 0 },
    heap: { usedBytes: 39_321_856, limitBytes: 4_395_630_592, source: 'performance.memory' },
    storage: { usageBytes: 2_940_384, quotaBytes: 10_740_358_624 },
    ...overrides,
  }
}

/**
 * The Canvas2D fallback re-running its whole pipeline on every pan frame.
 *
 * @returns {Record<string, unknown>}
 */
function canvas2dPipelineRegression() {
  return healthy({
    engine: 'canvas2d',
    frames: 31,
    frameMs: { samples: 31, p50: 387, p95: 387, max: 387, mean: 387 },
    intervalMs: { samples: 30, p50: 387, p95: 387, max: 387, mean: 387 },
    longTasks: { count: 30, totalMs: 11_610, maxMs: 389.6 },
    heap: { usedBytes: 81_721_402, limitBytes: 4_395_630_592, source: 'performance.memory' },
  })
}

describe('checkReport', () => {
  it('passes a healthy drag on the WebGL2 engine', () => {
    const result = checkReport(writeReport(healthy()))
    expect(result.problems).toEqual([])
    expect(result.skipped).toEqual([])
    expect(result.lines.join('\n')).toMatch(/gl \/ production — 61 frames, 60 intervals/)
  })

  it('passes the same drag on the Canvas2D fallback, which is the weaker engine', () => {
    const result = checkReport(
      writeReport(
        healthy({
          engine: 'canvas2d',
          heap: { usedBytes: 81_721_402, limitBytes: null, source: 'performance.memory' },
        }),
      ),
    )
    expect(result.problems).toEqual([])
  })

  it('fails the regression the budget exists to catch, and names all three metrics', () => {
    const result = checkReport(writeReport(canvas2dPipelineRegression()))
    const text = result.problems.join('\n')
    expect(text).toMatch(/intervalP50Ms is 387\.0 ms/)
    expect(text).toMatch(/intervalP95Ms is 387\.0 ms/)
    expect(text).toMatch(/the slowest render took 387\.0 ms/)
    expect(text).toMatch(/30 long tasks/)
  })

  it('fails a single dropped frame, not only a uniformly slow one', () => {
    // The realistic shape: 59 frames at 16.7 ms and one at 240 ms, which is what
    // a synchronous readback or a GC pause in the middle of a drag looks like.
    // The p95 of that sample set is still fine — the max is the signal.
    const result = checkReport(
      writeReport(
        healthy({
          frameMs: { samples: 61, p50: 0.1, p95: 0.2, max: 240, mean: 4 },
        }),
      ),
    )
    expect(result.problems.join('\n')).toMatch(/the slowest render took 240\.0 ms/)
  })

  it('fails one long task, because one is one too many during a drag', () => {
    const result = checkReport(
      writeReport(healthy({ longTasks: { count: 1, totalMs: 387, maxMs: 387 } })),
    )
    expect(result.problems.join('\n')).toMatch(/1 long task \(387\.0 ms total\)/)
  })

  it('fails a heap that has run away, and says so in MB', () => {
    const result = checkReport(
      writeReport(
        healthy({
          heap: { usedBytes: 900 * 1024 * 1024, limitBytes: null, source: 'performance.memory' },
        }),
      ),
    )
    expect(result.problems.join('\n')).toMatch(/900\.0 MB.*256 MB budget/)
  })

  it('fails storage that has outgrown the retention window', () => {
    const result = checkReport(
      writeReport(healthy({ storage: { usageBytes: 256 * 1024 * 1024, quotaBytes: null } })),
    )
    expect(result.problems.join('\n')).toMatch(/256\.0 MB.*128 MB budget/)
  })

  it('names the metrics it did not measure rather than counting them as passes', () => {
    const result = checkReport(
      writeReport(
        healthy({
          heap: { usedBytes: null, limitBytes: null, source: 'unavailable' },
          storage: { usageBytes: null, quotaBytes: null },
        }),
      ),
    )
    expect(result.problems).toEqual([])
    expect(result.skipped.some((entry) => entry.startsWith('heapUsedMb'))).toBe(true)
    expect(result.skipped.some((entry) => entry.startsWith('storageUsageMb'))).toBe(true)
  })

  it('fails a report with no frames in it, rather than passing a measurement of nothing', () => {
    const result = checkReport(
      writeReport(
        healthy({
          frames: 0,
          frameMs: { samples: 0, p50: 0, p95: 0, max: 0, mean: 0 },
          intervalMs: { samples: 0, p50: 0, p95: 0, max: 0, mean: 0 },
        }),
      ),
    )
    expect(result.problems).toEqual([])
    expect(result.skipped).toContain('intervalMs (no rendered frames were recorded)')
  })
})

describe('a report has to be a report', () => {
  it('fails when the file is missing, because a gate that passes on silence is a claim', () => {
    const result = checkReport(join(tmpdir(), 'ie-perf-does-not-exist.json'))
    expect(result.problems.join('\n')).toMatch(/nothing was measured/)
  })

  it('fails on malformed JSON instead of crashing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ie-perf-'))
    roots.push(root)
    const path = join(root, 'report.json')
    writeFileSync(path, '{ not json')
    const result = checkReport(path)
    expect(result.problems.join('\n')).toMatch(/is not valid JSON/)
  })

  it('fails a report missing a field the budget reads', () => {
    for (const key of [
      'environment',
      'engine',
      'frames',
      'frameMs',
      'intervalMs',
      'longTasks',
      'heap',
      'storage',
    ]) {
      const report = healthy()
      delete report[key]
      const result = checkReport(writeReport(report))
      expect(result.problems.join('\n'), `removing "${key}" must fail`).toMatch(
        new RegExp(`"${key}" is not a`),
      )
    }
  })

  it('fails a report whose metrics are the wrong shape', () => {
    const result = checkReport(writeReport(healthy({ intervalMs: 'fast' })))
    expect(result.problems.join('\n')).toMatch(/"intervalMs" is not an object/)
  })
})

describe('a report that names its environment', () => {
  /**
   * A report the e2e spec writes carries the frame cadence the browser was
   * already delivering while the app drew nothing. A four-worker CI run produces
   * exactly the numbers below — 48 ms frames, because five browsers are sharing
   * one host — and applying a 60 Hz absolute cap to them is a claim about the
   * build agent, not about the app.
   */
  const contended = healthy({
    intervalMs: { samples: 60, p50: 48.8, p95: 82.4, max: 95.1, mean: 51.2 },
    idleCadence: { samples: 71, p50: 16.7, p95: 16.7 },
  })

  it('reports the interval without gating it, and says so in the output', () => {
    const result = checkReport(writeReport(contended))
    expect(result.problems).toEqual([])
    expect(result.lines.join('\n')).toMatch(
      /reported, not gated: a harness was driving at 16\.7 ms/,
    )
    expect(result.skipped).toContain(
      'intervalP95Ms (measured in a harness delivering 16.7 ms idle frames)',
    )
  })

  it("still fails the app's own work in the same report", () => {
    /** @type {Record<string, unknown>} */
    const slow = {
      ...contended,
      frameMs: { samples: 60, p50: 387, p95: 387, max: 387, mean: 387 },
      longTasks: { count: 30, totalMs: 11_610, maxMs: 389.6 },
    }
    const result = checkReport(writeReport(slow))
    expect(result.problems.join('\n')).toMatch(/the slowest render took 387\.0 ms/)
    expect(result.problems.join('\n')).toMatch(/30 long tasks/)
  })

  it('does not gate the interval even when the harness is itself in trouble', () => {
    // 400 ms frames on the *idle* probe is a wedged browser, not a fast app.
    // Reporting the interval and declining to gate it is still right here: a
    // harness that cannot hold a frame rate has told you about the harness, and
    // the two numbers that still mean something — the render cost and the long
    // tasks — are gated, in the test above.
    const broken = healthy({
      intervalMs: { samples: 60, p50: 700, p95: 900, max: 950, mean: 720 },
      idleCadence: { samples: 4, p50: 400, p95: 400 },
    })
    const result = checkReport(writeReport(broken))
    expect(result.problems).toEqual([])
    expect(result.lines.join('\n')).toMatch(
      /reported, not gated: a harness was driving at 400\.0 ms/,
    )
  })

  it('applies the absolute budget to a report with no cadence, which is real hardware', () => {
    const fromADevice = healthy({
      environment: 'production',
      intervalMs: { samples: 60, p50: 16.7, p95: 17.2, max: 18.9, mean: 16.8 },
    })
    expect(checkReport(writeReport(fromADevice)).problems).toEqual([])

    const droppedFrames = healthy({
      environment: 'production',
      intervalMs: { samples: 60, p50: 24, p95: 41.2, max: 48, mean: 25 },
    })
    expect(checkReport(writeReport(droppedFrames)).problems.join('\n')).toMatch(
      /intervalP95Ms is 41\.2 ms, over the 33\.4 ms budget/,
    )
  })

  it('ignores a cadence that is not a usable number rather than trusting it', () => {
    for (const idleCadence of [undefined, { p95: 0 }, { p95: 'fast' }, null, '16.7']) {
      const report = healthy({
        intervalMs: { samples: 60, p50: 48.8, p95: 82.4, max: 95, mean: 51 },
      })
      if (idleCadence === undefined) delete report.idleCadence
      else report.idleCadence = idleCadence
      // A cadence the checker cannot read is no cadence, so the absolute cap
      // applies and the contended numbers fail. Trusting a malformed field to
      // relax a budget would be the whole problem in one line.
      expect(checkReport(writeReport(report)).problems.join('\n'), String(idleCadence)).toMatch(
        /over the 33\.4 ms budget/,
      )
    }
  })
})

describe('reportFiles', () => {
  it('is empty for a directory that does not exist, so the caller can fail loudly', () => {
    expect(reportFiles(join(tmpdir(), 'ie-perf-no-such-dir'))).toEqual([])
  })

  it('picks up only .json files, sorted', () => {
    const root = mkdtempSync(join(tmpdir(), 'ie-perf-'))
    roots.push(root)
    writeFileSync(join(root, 'b.json'), '{}')
    writeFileSync(join(root, 'a.json'), '{}')
    writeFileSync(join(root, 'notes.txt'), 'ignore me')
    expect(reportFiles(root).map((path) => path.slice(root.length + 1))).toEqual([
      'a.json',
      'b.json',
    ])
  })
})

describe('the budgets themselves', () => {
  it('sets the frame budget at two vsync periods on both engines', () => {
    // Measured: 16.8 ms on gl, 17.2 ms on canvas2d, 994x1502 proxy, Sample 1.
    // The regression floor: 387 ms, a full Canvas2D pipeline render per pan frame.
    expect(PERF_BUDGET.intervalP95Ms).toBeGreaterThan(17.2)
    expect(PERF_BUDGET.intervalP95Ms).toBeLessThan(387)
    expect(PERF_BUDGET.intervalP50Ms).toBeGreaterThan(16.7)
    expect(PERF_BUDGET.intervalP50Ms).toBe(20)
  })

  it('keeps the frame budget at the display period, not below the clock floor', () => {
    expect(PERF_BUDGET.frameMs).toBe(VSYNC_MS)
  })

  it('holds a memory cap that a phone would notice', () => {
    // A mobile tab is evicted somewhere north of this; 82 MB is the measured
    // dev-server figure for the fallback after a full edit session.
    expect(PERF_BUDGET.heapUsedMb).toBeGreaterThan(82)
    expect(PERF_BUDGET.heapUsedMb).toBeLessThan(512)
  })

  it('keeps the default report directory the one the e2e gate writes', () => {
    expect(DEFAULT_REPORT_DIR).toBe('test-results/perf')
  })
})
