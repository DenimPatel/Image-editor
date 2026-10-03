import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { Histogram } from './Histogram'

/**
 * The histogram re-renders a proxy of the whole edit every time the document
 * settles, so a superseded pass has to be cancellable — otherwise a slider drag
 * leaves a queue of full GPU renders racing to paint a canvas nobody is looking
 * at any more.
 */
const renderExportCanvas = vi.hoisted(() => vi.fn())

vi.mock('../../render/exportCanvas', () => ({ renderExportCanvas }))

const harness = createHarness()

const SOURCE = { assetId: 'a1', width: 800, height: 600, name: 'p', mime: 'image/png' }

const lastSignal = () => {
  const calls = renderExportCanvas.mock.calls
  return calls[calls.length - 1]?.[3]?.signal as AbortSignal | undefined
}

/** jsdom has no 2D context, so the graph needs a canvas that hands one back.
 *  Both the proxy the pipeline returns and the visible canvas the component draws
 *  on go through `HTMLCanvasElement.prototype.getContext`, so it is stubbed once
 *  here rather than per-canvas. */
const CONTEXT = {
  clearRect: () => {},
  fillRect: () => {},
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  closePath: () => {},
  fill: () => {},
  getImageData: (_x: number, _y: number, width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4).fill(128),
    width,
    height,
  }),
}

let realGetContext: HTMLCanvasElement['getContext']

function canvasThatDraws(): HTMLCanvasElement {
  return document.createElement('canvas')
}

const statusLine = () => harness.container.querySelector('p[role="status"]')

function mount(source: ImageBitmap | null = { width: 800, height: 600 } as never) {
  harness.render(<Histogram source={source} />)
}

async function settle(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  resetStores()
  useDocStore.getState().load(createDoc({ source: SOURCE }))
  realGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = (() => CONTEXT) as never
  renderExportCanvas.mockReset()
  renderExportCanvas.mockResolvedValue(canvasThatDraws())
  vi.useFakeTimers()
  mount()
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext
  harness.unmount()
  vi.useRealTimers()
})

describe('Histogram', () => {
  it('renders a bounded proxy at the document aspect, never the full output', async () => {
    await settle()
    const [, , size] = renderExportCanvas.mock.calls[0] as [
      unknown,
      unknown,
      { width: number; height: number },
    ]
    expect(size.width).toBe(160)
    expect(size.height).toBe(120)
  })

  it('passes an abort signal with the render', async () => {
    await settle()
    expect(lastSignal()).toBeInstanceOf(AbortSignal)
    expect(lastSignal()?.aborted).toBe(false)
  })

  it('aborts the in-flight render when the component goes away', async () => {
    await settle()
    const signal = lastSignal()
    act(() => {
      harness.unmount()
    })
    expect(signal?.aborted).toBe(true)
  })

  it('aborts the previous pass when a new document revision arrives', async () => {
    await settle()
    const first = lastSignal()
    act(() => {
      useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 0.5 } }))
    })
    expect(first?.aborted).toBe(true)
    await settle()
    expect(lastSignal()?.aborted).toBe(false)
  })
})

/**
 * The failure path used to be `catch {}` under the comment "Histogram is
 * advisory". It is the only visual feedback in the Adjust panel, so that made
 * every failure a permanently blank box with nothing to report — and silence
 * reads as a broken panel rather than as an absent one.
 */
describe('a failed pass says so instead of leaving a blank box', () => {
  it('is silent while it is working, and says so only once a pass has failed', async () => {
    expect(statusLine()).toBeNull()
    await settle()
    expect(statusLine()).toBeNull()
  })

  it('names the reason the engine gave when the render throws', async () => {
    renderExportCanvas.mockRejectedValue(
      new Error('The WebGL context was lost while rendering the export. Nothing was written.'),
    )
    await settle()
    const text = statusLine()?.textContent ?? ''
    expect(text).toMatch(/Histogram unavailable/)
    expect(text).toMatch(/the preview could not be drawn/)
    // The reason is the engine's own words, not an inference about the cause.
    expect(text).toMatch(/WebGL context was lost/)
  })

  it('does not claim a graph is out of date when none was ever drawn', async () => {
    renderExportCanvas.mockRejectedValue(new Error('boom'))
    await settle()
    expect(statusLine()?.textContent).toMatch(/Histogram unavailable/)
    expect(statusLine()?.textContent).not.toMatch(/out of date|graph above/)
  })

  it('distinguishes a render that failed from pixels that could not be read', async () => {
    // A canvas that exists but has no 2D context: the render worked, the read
    // did not, and saying "could not be drawn" would be a different defect.
    renderExportCanvas.mockResolvedValue({
      width: 160,
      height: 120,
      getContext: () => null,
    })
    await settle()
    expect(statusLine()?.textContent).toMatch(/the preview could not be read/)
  })

  it('keeps the last good graph and calls it out of date, rather than blanking it', async () => {
    await settle()
    expect(statusLine()).toBeNull()
    // A later revision fails, after a graph has already been drawn.
    renderExportCanvas.mockRejectedValue(new Error('device lost the context'))
    act(() => {
      useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 0.5 } }))
    })
    await settle()
    expect(statusLine()?.textContent).toMatch(/Histogram out of date/)
    expect(statusLine()?.textContent).toMatch(/The graph above is from an earlier edit/)
  })

  it('clears the message as soon as a pass succeeds again', async () => {
    renderExportCanvas.mockRejectedValue(new Error('boom'))
    await settle()
    expect(statusLine()).not.toBeNull()
    renderExportCanvas.mockResolvedValue(canvasThatDraws())
    act(() => {
      useDocStore
        .getState()
        .update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 0.25 } }))
    })
    await settle()
    expect(statusLine()).toBeNull()
  })

  it('stays silent for a pass that was merely superseded', async () => {
    // The abort path is the common case — every revision cancels the one before
    // it — so treating it as a failure would put a permanent red line under a
    // panel that is working.
    renderExportCanvas.mockRejectedValue(
      Object.assign(new Error('Export cancelled'), {
        name: 'AbortError',
      }),
    )
    await settle()
    expect(statusLine()).toBeNull()
  })

  it('says the render reported no reason rather than inventing one', async () => {
    renderExportCanvas.mockRejectedValue(new Error(''))
    await settle()
    expect(statusLine()?.textContent).toMatch(/the render reported no reason/)
  })

  it('trims a runaway engine message to one clause', async () => {
    renderExportCanvas.mockRejectedValue(new Error('x'.repeat(400)))
    await settle()
    const text = statusLine()?.textContent ?? ''
    expect(text.length).toBeLessThan(200)
    expect(text).toMatch(/…/)
  })

  it('withdraws the message when there is no source to fail', async () => {
    renderExportCanvas.mockRejectedValue(new Error('boom'))
    await settle()
    expect(statusLine()).not.toBeNull()
    act(() => {
      mount(null)
    })
    expect(statusLine()).toBeNull()
  })
})

describe('the histogram message is reachable without seeing it', () => {
  it('is a polite live region, not an alert, on a canvas that is hidden from AT', async () => {
    renderExportCanvas.mockRejectedValue(new Error('boom'))
    await settle()
    // The graph itself is `aria-hidden`, so this line is the only thing a
    // screen reader has: without it the panel reports itself as fine.
    expect(harness.container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
    expect(statusLine()?.getAttribute('role')).toBe('status')
    expect(statusLine()?.getAttribute('aria-live')).toBeNull()
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
  })
})
