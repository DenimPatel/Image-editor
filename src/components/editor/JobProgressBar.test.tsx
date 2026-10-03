import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, resetStores } from '../../store/testHarness'
import { useUiStore } from '../../store/uiStore'
import { JobProgressBar } from './JobProgressBar'

const harness = createHarness()

const bar = () => harness.container.querySelector<HTMLElement>('[role="progressbar"]')
const fill = () => harness.container.querySelector<HTMLElement>('[role="progressbar"] > div')
const label = () => harness.container.querySelector<HTMLElement>('.jobLabel, [aria-live]')

function startJob(id: string, name: string, progress = 0) {
  act(() => {
    useUiStore.getState().startJob({ id, label: name, progress, status: 'running' })
  })
}

function report(id: string, progress: number) {
  act(() => {
    useUiStore.getState().updateJob(id, { progress })
  })
}

/** The store's own number, so an assertion cannot pass on a view-local floor. */
function job(id: string) {
  return useUiStore.getState().jobs.find((entry) => entry.id === id)!
}

beforeEach(() => {
  resetStores()
  useUiStore.setState({ jobs: [] })
  harness.render(<JobProgressBar />)
})

afterEach(() => harness.unmount())

describe('the job progress bar has a name', () => {
  it('renders nothing when no job is running', () => {
    expect(bar()).toBeNull()
  })

  it('is named by the job it belongs to, not by a number', () => {
    // The old markup had `role="progressbar"` and an `aria-valuenow` and no
    // name, relying entirely on a sibling live region — so anything reaching the
    // bar by its role heard "progress bar, 42%" with no idea what was counting.
    startJob('job_1', 'Exporting')
    const labelledBy = bar()?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(label()?.id).toBe(labelledBy)
    expect(label()?.textContent).toBe('Exporting')
    // One string, two consumers: the live region and the bar's name are the same
    // text, so the two cannot disagree about what the job is.
    expect(harness.container.textContent).toBe('Exporting')
  })

  it('states the range its value is measured in', () => {
    startJob('job_1', 'Exporting')
    expect(bar()?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar()?.getAttribute('aria-valuemax')).toBe('100')
  })

  it('keeps the name on the bar, not on the label element', () => {
    // Putting the name on the bar is the whole fix; `aria-label` on the live
    // region would only duplicate it.
    startJob('job_1', 'Multi-size zip')
    expect(bar()?.hasAttribute('aria-label')).toBe(false)
    expect(label()?.hasAttribute('aria-label')).toBe(false)
    expect(label()?.getAttribute('aria-live')).toBe('polite')
  })
})

describe('the value actually moves', () => {
  it('follows the reported progress, in the units the ARIA role expects', () => {
    startJob('job_1', 'Exporting')
    expect(bar()?.getAttribute('aria-valuenow')).toBe('0')
    report('job_1', 0.42)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('42')
    report('job_1', 1)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('100')
  })

  it('moves the drawn fill as well as the reported value', () => {
    startJob('job_1', 'Exporting')
    report('job_1', 0.25)
    expect(fill()?.style.width).toBe('25%')
    report('job_1', 0.8)
    expect(fill()?.style.width).toBe('80%')
  })

  it('never moves backwards, because the store floors it', () => {
    // The monotonic floor lives in `useUiStore.updateJob`, which every reporter
    // goes through — deliberately not here, because a floor in the view is a
    // second copy of state that nothing else can see. Asserted against the
    // rendered value *and* the store's own number, so a future "fix" that moves
    // the rule into a `setState` in an effect (which would satisfy the first
    // assertion alone) fails the second.
    //
    // The sequence is matting's real one: `total > 0 ? current / total : 0`, so
    // a second event arriving before a total is known reports 0 after 0.5.
    startJob('job_1', 'Removing background')
    report('job_1', 0.5)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('50')
    report('job_1', 0)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('50')
    expect(job('job_1').progress).toBe(0.5)
    // And a genuinely larger report still gets through — a floor that also stuck
    // at the ceiling would be a different lie.
    report('job_1', 0.9)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('90')
    expect(job('job_1').progress).toBe(0.9)
  })

  it('clamps a reporter that leaves 0..1, and never lets it rewind the bar', () => {
    startJob('job_1', 'Exporting')
    report('job_1', 1.4)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('100')
    // A negative report is clamped to 0 and then floored against the current
    // value, so it cannot walk a finished bar backwards off the end.
    report('job_1', -0.5)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('100')
    expect(job('job_1').progress).toBe(1)
    // A fresh job is not poisoned by the last one's ceiling.
    act(() => {
      useUiStore.getState().finishJob('job_1', 'done')
    })
    startJob('job_2', 'Exporting')
    report('job_2', 0.5)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('50')
    expect(job('job_2').progress).toBe(0.5)
  })

  it('reports a non-finite progress as 0 rather than as NaN', () => {
    // `NaN * 100` is `NaN`, and `width: NaN%` is not a width: the bar would stop
    // rendering at all rather than reporting something wrong.
    startJob('job_1', 'Exporting')
    report('job_1', Number.NaN)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('0')
    expect(job('job_1').progress).toBe(0)
    report('job_1', Number.POSITIVE_INFINITY)
    expect(job('job_1').progress).toBe(0)
  })

  it('starts a new job at its own value, not the last one’s', () => {
    startJob('job_1', 'Exporting')
    report('job_1', 0.9)
    act(() => {
      useUiStore.getState().finishJob('job_1', 'done')
    })
    expect(bar()).toBeNull()
    startJob('job_2', 'Preparing share')
    expect(bar()?.getAttribute('aria-valuenow')).toBe('0')
    expect(label()?.textContent).toBe('Preparing share')
    report('job_2', 0.3)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('30')
  })

  it('disappears when the job stops running, so a finished bar is not a stuck one', () => {
    startJob('job_1', 'Exporting')
    report('job_1', 1)
    for (const status of ['done', 'error', 'cancelled'] as const) {
      act(() => {
        useUiStore.getState().finishJob('job_1', status)
      })
      expect(bar(), status).toBeNull()
    }
  })

  it('rounds a sub-percentage tick to a readable number rather than a fraction', () => {
    startJob('job_1', 'Exporting')
    report('job_1', 0.004)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('0')
    report('job_1', 0.006)
    expect(bar()?.getAttribute('aria-valuenow')).toBe('1')
  })
})
