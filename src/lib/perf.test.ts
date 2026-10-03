import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPerfMonitor,
  evaluateBudget,
  frameBudgetMs,
  IDLE_DISARM_MS,
  PERF_BUDGET,
  PERF_RING,
  readEnvironment,
  VSYNC_MS,
  type PerfMonitor,
  type PerfReport,
} from './perf'

/**
 * The runtime monitor, asserted on the two properties that make it worth having
 * at all: it costs nothing when the app is idle, and a slow frame is visible in
 * what it reports.
 *
 * A `PerformanceObserver` fixture rather than a spy on the global. The claim
 * under test is "the observer is disconnected when nothing is scheduled", and
 * the only way to assert that is to hold a handle on the object that was
 * constructed and check what was called on it — a spy on the constructor proves
 * an observer was created, not that it stopped.
 */

type ObserverRecord = {
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  callback: PerformanceObserverCallback
}

let observers: ObserverRecord[] = []
const ORIGINAL_OBSERVER = globalThis.PerformanceObserver
let realNow: () => number

/** A `longtask` entry, which is the only shape this monitor reads. */
function longTaskEntry(duration: number): PerformanceEntry {
  return { duration, name: 'self', entryType: 'longtask' } as PerformanceEntry
}

function deliver(index: number, entries: PerformanceEntry[]): void {
  const callback = observers[index]?.callback
  if (!callback) throw new Error(`observer ${index} was never constructed`)
  const list = { getEntries: () => entries } as unknown as PerformanceObserverEntryList
  callback(list, {} as PerformanceObserver)
}

/** Replace `PerformanceObserver` with a constructor whose instances are recorded. */
function installObserver(entryTypes: string[]): void {
  const Patched = function (this: Record<string, unknown>, callback: PerformanceObserverCallback) {
    const record: ObserverRecord = {
      observe: vi.fn(),
      // A real observer stops delivering the moment it is disconnected, so the
      // fake has to as well — otherwise "stops counting after disconnect" is a
      // statement about the fixture rather than about the code.
      disconnect: vi.fn(() => {
        observers = observers.filter((candidate) => candidate !== record)
      }),
      callback,
    }
    Object.assign(this, record)
    observers.push(record)
  } as unknown as typeof PerformanceObserver
  Object.defineProperty(Patched, 'supportedEntryTypes', {
    value: entryTypes,
    configurable: true,
  })
  globalThis.PerformanceObserver = Patched
}

beforeEach(() => {
  observers = []
  realNow = performance.now.bind(performance)
  installObserver(['longtask'])
  // Only the timers are faked. `performance` is stubbed per-test below, and
  // faking it here fights jsdom's read-only accessor before a test even starts.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.PerformanceObserver = ORIGINAL_OBSERVER
  performance.now = realNow
  delete (performance as { memory?: unknown }).memory
})

/** A monitor whose clock the test drives, so intervals are exact. */
function monitorWithClock(): { monitor: PerfMonitor; now: (value: number) => void } {
  let clock = 0
  performance.now = () => clock
  const monitor = createPerfMonitor()
  return { monitor, now: (value: number) => void (clock = value) }
}

describe('idle cost', () => {
  it('connects no observer until a frame is actually rendered', () => {
    const { monitor } = monitorWithClock()
    // A render loop that has been mounted and told to arm itself, but has
    // nothing scheduled: the Hub, a paused tab, an editor with no photo.
    monitor.setEngine('gl')
    expect(observers).toHaveLength(0)
    expect(monitor.isObserving()).toBe(false)
    expect(monitor.readReport().observing).toBe(false)
  })

  it('disconnects the observer once nothing has been rendered for the idle window', () => {
    const { monitor, now } = monitorWithClock()
    now(1000)
    monitor.recordFrame(0.4)
    expect(observers).toHaveLength(1)
    const observer = observers[0]
    expect(observer.observe).toHaveBeenCalledWith({ type: 'longtask', buffered: false })
    expect(monitor.isObserving()).toBe(true)

    // One millisecond short of the idle window it is still live: a drag that
    // pauses for a moment must not pay to re-observe.
    now(1000 + IDLE_DISARM_MS - 1)
    vi.advanceTimersByTime(IDLE_DISARM_MS - 1)
    expect(observer.disconnect).not.toHaveBeenCalled()

    now(1000 + IDLE_DISARM_MS)
    vi.advanceTimersByTime(IDLE_DISARM_MS)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(monitor.isObserving()).toBe(false)
    expect(monitor.readReport().observing).toBe(false)
  })

  it('holds one observer across a whole drag rather than one per frame', () => {
    const { monitor, now } = monitorWithClock()
    for (let frame = 0; frame < 120; frame += 1) {
      now(frame * VSYNC_MS)
      monitor.recordFrame(0.2)
      vi.advanceTimersByTime(VSYNC_MS)
    }
    expect(observers).toHaveLength(1)
    expect(observers[0].disconnect).not.toHaveBeenCalled()
  })

  it('drops the observer and the samples on reset, so a torn-down loop leaves nothing running', () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.3)
    now(VSYNC_MS)
    monitor.recordFrame(0.3)
    const observer = observers[0]
    expect(observer.disconnect).not.toHaveBeenCalled()

    monitor.reset()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(monitor.isObserving()).toBe(false)
    const report = monitor.readReport()
    expect(report.frames).toBe(0)
    expect(report.intervalMs).toEqual({ samples: 0, p50: 0, p95: 0, max: 0, mean: 0 })
  })

  it('disarms explicitly, for the teardown path', () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    expect(monitor.isObserving()).toBe(true)
    monitor.disarm()
    expect(monitor.isObserving()).toBe(false)
    // And the idle timer it had armed is gone, so it cannot fire into a reset.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('arms one timer per idle window, not one per frame', () => {
    // The first version cleared and re-set a `setTimeout` on every recorded
    // frame. That is a timer object sixty times a second for the whole duration
    // of a drag — a per-frame allocation in the one path that promises not to
    // have one, and it measured 7.9 MB over 5000 frames. Asserting the timer
    // count is asserting the mechanism, which is the thing that has to hold.
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    expect(vi.getTimerCount()).toBe(1)
    for (let frame = 1; frame <= 5000; frame += 1) {
      now(frame * VSYNC_MS)
      monitor.recordFrame(0.2)
    }
    expect(vi.getTimerCount()).toBe(1)
    expect(monitor.readReport().frames).toBe(5001)
  })

  it('keeps the window alive across a drag longer than the idle timeout', () => {
    // 5000 frames at 16.7 ms is 83 seconds of continuous rendering, so the idle
    // timer has to fire and re-arm about 83 times. It must never conclude the
    // app is idle while frames are still arriving.
    const { monitor, now } = monitorWithClock()
    for (let frame = 0; frame <= 5000; frame += 1) {
      now(frame * VSYNC_MS)
      monitor.recordFrame(0.2)
      vi.advanceTimersByTime(VSYNC_MS)
    }
    expect(monitor.isObserving()).toBe(true)
    expect(observers).toHaveLength(1)
    expect(observers[0].disconnect).not.toHaveBeenCalled()
  })
})

describe('frame samples', () => {
  it('records the interval between rendered frames, not between rAF ticks', () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    for (let frame = 1; frame <= 60; frame += 1) {
      now(frame * 16.7)
      monitor.recordFrame(0.2)
    }
    const report = monitor.readReport()
    // The first frame has no predecessor, so it contributes no interval.
    expect(report.intervalMs.samples).toBe(60)
    expect(report.frames).toBe(61)
    expect(report.intervalMs.p50).toBeCloseTo(16.7, 1)
    expect(report.intervalMs.max).toBeCloseTo(16.7, 1)
  })

  it('keeps only the last PERF_RING frames', () => {
    const { monitor, now } = monitorWithClock()
    for (let frame = 0; frame < PERF_RING + 200; frame += 1) {
      now(frame * 16.7)
      monitor.recordFrame(0.2)
    }
    const report = monitor.readReport()
    expect(report.frames).toBe(PERF_RING + 200)
    expect(report.intervalMs.samples).toBe(PERF_RING)
  })

  it('reports the engine and the environment a number was taken in', () => {
    const { monitor, now } = monitorWithClock()
    monitor.setEngine('canvas2d')
    now(0)
    monitor.recordFrame(0.2)
    const report = monitor.readReport()
    expect(report.engine).toBe('canvas2d')
    expect(report.environment).toBe(readEnvironment())
  })
})

describe('long tasks', () => {
  it('counts a long task and attributes its duration', () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    deliver(0, [longTaskEntry(387), longTaskEntry(120)])
    const report = monitor.readReport()
    expect(report.longTasks).toEqual({ count: 2, totalMs: 507, maxMs: 387 })
  })

  it('stops counting the moment the observer is disconnected', () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    const observer = observers[0]
    now(IDLE_DISARM_MS)
    vi.advanceTimersByTime(IDLE_DISARM_MS)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(monitor.isObserving()).toBe(false)
    // The observer is gone, so there is nothing left to deliver a long task.
    expect(() => deliver(0, [longTaskEntry(500)])).toThrow(/never constructed/)
    expect(monitor.readReport().longTasks.count).toBe(0)
  })

  it('runs no observer at all on an engine without the longtask entry type', () => {
    observers = []
    installObserver(['resource'])
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    expect(observers).toHaveLength(0)
    expect(monitor.isObserving()).toBe(false)
    // And the frames are still measured: a missing number is not a broken one.
    expect(monitor.readReport().frames).toBe(1)
  })
})

describe('a slow frame, and the numbers a support conversation needs', () => {
  /**
   * The failure this exists to catch, at the size it actually happens: the
   * Canvas2D fallback re-running its whole pipeline because the "unchanged plan"
   * short-circuit stopped matching. One `renderOnce` costs 387 ms in that state
   * (measured, `src/lib/perf.ts`), so a drag is 23 frames a second.
   */
  function canvas2dPipelineRegression(): PerfReport {
    const { monitor, now } = monitorWithClock()
    let clock = 0
    for (let frame = 0; frame < 30; frame += 1) {
      now(clock)
      monitor.recordFrame(387)
      clock += 387
    }
    return monitor.readReport()
  }

  it('detects a slow frame from a synthetic drag', () => {
    const report = canvas2dPipelineRegression()
    expect(report.frameMs.samples).toBe(30)
    expect(report.frameMs.p50).toBe(387)
    expect(report.frameMs.max).toBe(387)
    expect(report.intervalMs.p50).toBe(387)
    expect(report.intervalMs.p95).toBe(387)
  })

  it('names every budget it breaks, with both numbers in the message', () => {
    const { violations } = evaluateBudget(canvas2dPipelineRegression())
    const metrics = violations.map((violation) => violation.metric)
    expect(metrics).toContain('intervalP50Ms')
    expect(metrics).toContain('intervalP95Ms')
    expect(metrics).toContain('frameMs')
    const text = violations.map((violation) => violation.message).join('\n')
    expect(text).toContain('387.0 ms')
    expect(text).toContain('33.4 ms budget')
  })

  it('passes a healthy drag, so the gate is not simply always red', () => {
    const { monitor, now } = monitorWithClock()
    let clock = 0
    for (let frame = 0; frame < 60; frame += 1) {
      now(clock)
      monitor.recordFrame(0.2)
      clock += 16.8
    }
    const { violations } = evaluateBudget(monitor.readReport())
    expect(violations).toEqual([])
  })
})

describe('the budget table', () => {
  it('is bracketed: above the measured p95 and below the regression it catches', () => {
    // Measured on an M4/ANGLE-Metal build, Sample 1, 994x1502 proxy.
    const measuredP95 = 17.2
    // One full Canvas2D pipeline render, which is what a pan costs if the
    // unchanged-plan short-circuit stops matching.
    const regressionFloor = 387
    expect(PERF_BUDGET.intervalP95Ms).toBeGreaterThan(measuredP95)
    expect(PERF_BUDGET.intervalP95Ms).toBeLessThan(regressionFloor)
    // Two vsync periods, not a round number someone liked.
    expect(PERF_BUDGET.intervalP95Ms).toBeCloseTo(VSYNC_MS * 2, 0)
    expect(PERF_BUDGET.intervalP95Ms).toBe(33.4)
  })

  it('sets frameMs at one vsync, because the clock cannot resolve anything smaller', () => {
    // Chromium clamps performance.now() to 0.1 ms and a pan frame costs less
    // than that, so a cap under one vsync would be a cap under the noise floor.
    // This one is the exact value rather than a rounded literal, because it *is*
    // the display's frame period and there is nothing to round it to.
    expect(PERF_BUDGET.frameMs).toBe(VSYNC_MS)
    expect(PERF_BUDGET.frameMs).toBeGreaterThan(16.6)
    expect(PERF_BUDGET.frameMs).toBeLessThan(16.7)
  })

  it('holds memory figures above the dev-server measurement with real headroom', () => {
    // Measured against `npm run dev`, which retains unminified modules and runs
    // React in development mode. A production build is lower, not higher.
    expect(PERF_BUDGET.heapUsedMb).toBeGreaterThan(82)
    expect(PERF_BUDGET.storageUsageMb).toBeGreaterThan(3)
    expect(PERF_BUDGET.storageUsageMb).toBeLessThan(1024)
  })

  it('rejects the 387 ms regression and accepts the measured 17.2 ms', () => {
    expect(PERF_BUDGET.intervalP95Ms).toBeLessThan(387)
    expect(PERF_BUDGET.intervalP95Ms).toBeGreaterThan(17.2)
  })
})

/**
 * A report with the given frame intervals and render costs, built by hand so the
 * environment questions below do not need a browser.
 */
function syntheticDrag(intervals: number[], renderMs = 0.3): PerfReport {
  const stats = (values: number[]) => {
    const ordered = [...values].sort((a, b) => a - b)
    const at = (p: number): number =>
      ordered[Math.min(ordered.length - 1, Math.floor(p * ordered.length))]
    const mean = ordered.reduce((total, value) => total + value, 0) / ordered.length
    return {
      samples: ordered.length,
      p50: at(0.5),
      p95: at(0.95),
      max: ordered[ordered.length - 1] ?? 0,
      mean,
    }
  }
  return {
    environment: 'dev',
    engine: 'gl',
    observing: false,
    frames: intervals.length + 1,
    frameMs: stats(new Array(intervals.length).fill(renderMs)),
    intervalMs: stats(intervals),
    longTasks: { count: 0, totalMs: 0, maxMs: 0 },
    heap: { usedBytes: 23_400_000, limitBytes: null, source: 'performance.memory' },
    storage: { usageBytes: 300_000, quotaBytes: null },
  }
}

describe('metrics the environment cannot measure honestly', () => {
  /**
   * The headless-runner case, with its numbers. Same build, same Chromium, one
   * worker: no input, 16.7 ms frames; the identical CDP drag, 33.3 ms. The extra
   * 16.6 ms is the round trip per `mouse.move`, not a dropped frame.
   */
  const PACED = {
    paced: {
      intervalP50Ms: 'this harness paces synthetic pointer input at ~30 Hz',
      intervalP95Ms: 'this harness paces synthetic pointer input at ~30 Hz',
    },
  }

  it('names a paced metric in `skipped`, with the reason, instead of passing it', () => {
    const report = syntheticDrag([33.3, 33.3, 33.3, 34.4, 33.3, 35.0])
    const withoutContext = evaluateBudget(report)
    expect(withoutContext.violations.map((violation) => violation.metric)).toEqual([
      'intervalP50Ms',
      'intervalP95Ms',
    ])

    const { violations, skipped } = evaluateBudget(report, PERF_BUDGET, PACED)
    expect(violations).toEqual([])
    expect(skipped).toContain(
      'intervalP95Ms (this harness paces synthetic pointer input at ~30 Hz)',
    )
  })

  it("still gates the app's own work while the interval is not gated", () => {
    // The 387 ms Canvas2D frame: two metrics the app is responsible for, and one
    // the harness owns. Dropping the third must not rescue the first two.
    const report = syntheticDrag([387, 387, 387, 387], 387)
    report.longTasks = { count: 30, totalMs: 11_610, maxMs: 389.6 }
    const { violations, skipped } = evaluateBudget(report, PERF_BUDGET, PACED)
    const metrics = violations.map((violation) => violation.metric)
    expect(metrics).toContain('frameMs')
    expect(metrics).toContain('longTasks')
    expect(metrics).not.toContain('intervalP95Ms')
    expect(skipped.some((entry) => entry.startsWith('intervalP95Ms'))).toBe(true)
  })

  it('a paced metric with a reason is skipped; one without is not silently dropped', () => {
    const report = syntheticDrag([33.3, 33.3, 34.4])
    const { violations } = evaluateBudget(report, PERF_BUDGET, {
      paced: { intervalP50Ms: 'a real reason' },
    })
    // p95 was not named, so it is still checked — and it fails, which is the point
    // of requiring a reason rather than accepting a bare list of metrics.
    expect(violations.map((violation) => violation.metric)).toEqual(['intervalP95Ms'])
  })
})

describe('frameBudgetMs', () => {
  it('is the absolute budget for a 60 Hz browser: two vsync periods is 33.4 ms', () => {
    // `max(33.4, 2 * 16.8)`: at a real 60 Hz the absolute budget is already the
    // two-vsync figure, so the rule adds nothing and the cap stays the readable
    // 33.4 rather than drifting to 33.6 with the measurement.
    expect(frameBudgetMs(16.7)).toBe(PERF_BUDGET.intervalP95Ms)
    expect(PERF_BUDGET.intervalP95Ms).toBe(33.4)
  })

  it('follows a slower browser up, rather than reporting it as a dropped frame', () => {
    expect(frameBudgetMs(33.3)).toBeCloseTo(66.6, 5)
  })

  it('falls back to the absolute budget when the baseline is not a number', () => {
    expect(frameBudgetMs(0)).toBe(PERF_BUDGET.intervalP95Ms)
    expect(frameBudgetMs(Number.NaN)).toBe(PERF_BUDGET.intervalP95Ms)
  })

  it('still fails the regression it exists for, in either environment', () => {
    // One full Canvas2D pipeline render per pan frame.
    const regression = 387
    expect(regression).toBeGreaterThan(frameBudgetMs(16.8) * 10)
    expect(regression).toBeGreaterThan(frameBudgetMs(33.3) * 5)
  })
})

describe('metrics the engine cannot produce', () => {
  it('skips a null heap rather than reporting it as within budget', () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    now(16.7)
    monitor.recordFrame(0.2)
    const report = monitor.readReport()
    // No `performance.memory` here, which is what Firefox and Safari look like.
    expect(report.heap).toEqual({ usedBytes: null, limitBytes: null, source: 'unavailable' })
    const { violations, skipped } = evaluateBudget(report)
    expect(violations).toEqual([])
    expect(skipped).toContain('heapUsedMb (unavailable is unavailable on this engine)')
  })

  it('reads performance.memory when the engine has it', () => {
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 41_248_378, jsHeapSizeLimit: 4_395_630_592 },
      configurable: true,
    })
    const report = createPerfMonitor().readReport()
    expect(report.heap.source).toBe('performance.memory')
    expect(report.heap.usedBytes).toBe(41_248_378)
    expect(report.heap.limitBytes).toBe(4_395_630_592)
    const { violations, skipped } = evaluateBudget(report)
    expect(violations).toEqual([])
    // Only storage is missing here: jsdom has no Storage API, but the heap did
    // report, and a reported number is never in the skipped list.
    expect(skipped.some((entry) => entry.startsWith('heapUsedMb'))).toBe(false)
  })

  it('fails a heap that has run away, and says so in MB', () => {
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 900 * 1024 * 1024, jsHeapSizeLimit: 4_395_630_592 },
      configurable: true,
    })
    const { violations } = evaluateBudget(createPerfMonitor().readReport())
    const heap = violations.find((violation) => violation.metric === 'heapUsedMb')
    expect(heap).toBeDefined()
    expect(heap?.message).toContain('900.0 MB')
    expect(heap?.message).toContain('256 MB budget')
  })

  it('reads storage on demand and folds it into the next report', async () => {
    const { monitor, now } = monitorWithClock()
    now(0)
    monitor.recordFrame(0.2)
    now(VSYNC_MS)
    monitor.recordFrame(0.2)
    const estimate = vi.fn(async () => ({ usage: 2_940_384, quota: 10_740_358_624 }))
    Object.defineProperty(navigator, 'storage', {
      value: { estimate },
      configurable: true,
    })
    // Nothing polls it: a report taken before the call knows nothing about it.
    expect(monitor.readReport().storage).toEqual({ usageBytes: null, quotaBytes: null })
    expect(estimate).not.toHaveBeenCalled()

    await monitor.readStorage()
    expect(estimate).toHaveBeenCalledTimes(1)
    const report = monitor.readReport()
    expect(report.storage.usageBytes).toBe(2_940_384)
    expect(report.storage.quotaBytes).toBe(10_740_358_624)
    const { violations, skipped } = evaluateBudget(report)
    expect(violations).toEqual([])
    expect(skipped.some((entry) => entry.startsWith('storageUsageMb'))).toBe(false)
  })

  it('treats a blocked Storage API as unmeasured, not as zero', async () => {
    const monitor = createPerfMonitor()
    Object.defineProperty(navigator, 'storage', {
      value: {
        estimate: async () => {
          throw new Error('SecurityError')
        },
      },
      configurable: true,
    })
    await monitor.readStorage()
    const report = monitor.readReport()
    expect(report.storage).toEqual({ usageBytes: null, quotaBytes: null })
    const { violations, skipped } = evaluateBudget(report)
    expect(violations).toEqual([])
    expect(skipped.some((entry) => entry.startsWith('storageUsageMb'))).toBe(true)
  })

  it('fails storage that has run past the retention budget', async () => {
    const monitor = createPerfMonitor()
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: async () => ({ usage: 512 * 1024 * 1024 }) },
      configurable: true,
    })
    await monitor.readStorage()
    const { violations } = evaluateBudget(monitor.readReport())
    const storage = violations.find((violation) => violation.metric === 'storageUsageMb')
    expect(storage).toBeDefined()
    expect(storage?.message).toContain('512.0 MB')
  })
})

describe('report serialisation', () => {
  it('is JSON, so a report can be handed to scripts/check-perf.mjs as a file', () => {
    const { monitor, now } = monitorWithClock()
    monitor.setEngine('gl')
    now(0)
    monitor.recordFrame(0.4)
    now(16.7)
    monitor.recordFrame(0.4)
    const round = JSON.parse(JSON.stringify(monitor.readReport())) as PerfReport
    expect(round).toEqual(monitor.readReport())
    expect(round.engine).toBe('gl')
    expect(typeof round.intervalMs.p95).toBe('number')
  })
})
