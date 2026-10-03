import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildHistogram } from '../../lib/auto'
import { createDoc } from '../../model/defaults'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { Histogram } from './Histogram'

/**
 * How the histogram is *scaled*, which is a different question from how it is
 * read. `Histogram.test.tsx` covers the failure reporting; this covers the one
 * arithmetic decision that decides whether the graph can be read at all.
 *
 * The defect: `drawHistogram` measured every bin against the tallest one. That
 * is the obvious choice and it is wrong for any frame containing a large flat
 * area — a blown sky, a matte, a studio backdrop. Sample 1 is one: 13,352 of its
 * 38,720 proxy pixels sit at luma 245 and the next tallest bin holds 370, so
 * the whole tonal range was squeezed into the bottom 3% of an 80px box and the
 * panel showed a flat block with one hairline down the right edge.
 */

const renderExportCanvas = vi.hoisted(() => vi.fn())

vi.mock('../../render/exportCanvas', () => ({ renderExportCanvas }))

const harness = createHarness()

const SOURCE = { assetId: 'a1', width: 1271, height: 1920, name: 'p', mime: 'image/png' }

/** The proxy size `Histogram` asks for: 160 wide, at the document's aspect. */
const PROXY = { width: 160, height: 242 }
const PIXELS = PROXY.width * PROXY.height

/** Sample 1's shape, measured in the browser rather than invented. */
const PLATEAU = 13352
const DARK = 40
/** 2% of the frame — the share a flat area may hold and still not dominate. */
const PLATEAU_CEILING = PIXELS * 0.02
const BODY_FIRST = 60
const BODY_LAST = 200

/** How much of the body budget one level gets, peaked at 130. */
function bodyWeight(level: number): number {
  return 1 - Math.abs(level - 130) / 140
}

const BODY_TOTAL = PIXELS - PLATEAU - DARK
const BODY_WEIGHTS = Array.from({ length: BODY_LAST - BODY_FIRST + 1 }, (_, index) =>
  bodyWeight(BODY_FIRST + index),
)
const BODY_SUM = BODY_WEIGHTS.reduce((total, weight) => total + weight, 0)

/**
 * A frame with a plateau: one blown level holding a third of the pixels, and a
 * broad body of tones underneath it. `buildHistogram` of the result is asserted
 * before the drawing is, so if the shape drifts this fails as "the fixture is not
 * the frame it claims" rather than as a mystery.
 */
function plateauFrame(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(PIXELS * 4)
  let at = 0
  const put = (level: number, count: number) => {
    for (let i = 0; i < count && at < PIXELS; i += 1) {
      const offset = at * 4
      // A neutral grey: luma of r=g=b is the level itself.
      data[offset] = level
      data[offset + 1] = level
      data[offset + 2] = level
      data[offset + 3] = 255
      at += 1
    }
  }
  put(8, DARK)
  BODY_WEIGHTS.forEach((weight, index) => {
    put(BODY_FIRST + index, Math.round((BODY_TOTAL * weight) / BODY_SUM))
  })
  put(245, PLATEAU)
  put(8, PIXELS - at)
  return data
}

type Point = [x: number, y: number]

/** jsdom has no 2D context, so the visible canvas is given one that remembers. */
let passes: Point[][] = []
let pending: Point[] = []

const RECORDER = {
  clearRect: () => {},
  fillRect: () => {},
  beginPath: () => {
    pending = []
  },
  moveTo: (x: number, y: number) => pending.push([x, y]),
  lineTo: (x: number, y: number) => pending.push([x, y]),
  closePath: () => {},
  fill: () => {
    passes.push(pending)
    pending = []
  },
}

let realGetContext: HTMLCanvasElement['getContext']

async function settle(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  resetStores()
  useDocStore.getState().load(createDoc({ source: SOURCE }))
  realGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = (() => RECORDER) as never
  passes = []
  const data = plateauFrame()
  // The proxy carries its own `getContext`, so the prototype stub above is the
  // *drawing* surface and this is the readback. Two different objects on
  // purpose: reading the graph and drawing it are the two steps that failed
  // separately in this bug's history.
  renderExportCanvas.mockReset()
  renderExportCanvas.mockResolvedValue({
    width: PROXY.width,
    height: PROXY.height,
    getContext: () => ({
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: data.slice(0, width * height * 4),
        width,
        height,
      }),
    }),
  })
  vi.useFakeTimers()
  harness.render(<Histogram source={{ width: SOURCE.width, height: SOURCE.height } as never} />)
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext
  harness.unmount()
  vi.useRealTimers()
})

/** The luma area of the most recent drawing, as `[bin, fraction of box height]`. */
function drawnLuma(): [bin: number, height: number][] {
  expect(passes.length, 'the graph was never drawn').toBeGreaterThanOrEqual(4)
  const area = passes[passes.length - 4]
  // `drawHistogram` starts each area at the bottom-left corner and then walks
  // one vertex per bin across the full 256-wide box.
  return area.slice(1, 257).map(([x, y]) => [Math.round((x / 256) * 255), (80 - y) / 80])
}

describe('a frame with a blown plateau is still readable as a histogram', () => {
  it('the fixture really is the frame it claims to be', () => {
    // If this drifts, every assertion below is measuring a different picture.
    const histogram = buildHistogram(plateauFrame())
    expect(histogram.total).toBe(PIXELS)
    expect(histogram.luma[245]).toBe(PLATEAU)
    const bodyPeak = histogram.luma[130]
    // The plateau is over twenty times the body, so measuring against it flattens
    // the body — and the body is under the 2% share, so it is still the thing
    // everything else should be measured against.
    expect(PLATEAU / bodyPeak).toBeGreaterThan(20)
    expect(bodyPeak).toBeLessThanOrEqual(PLATEAU_CEILING)
    // And it is broad: a few spikes are not a histogram.
    const bodyBins = Array.from(histogram.luma.slice(BODY_FIRST, BODY_LAST + 1)).filter(Boolean)
    expect(bodyBins.length).toBe(BODY_LAST - BODY_FIRST + 1)
  })

  it('draws the tonal body at a readable height instead of a 2px sliver', async () => {
    await settle()
    const byBin = new Map(drawnLuma())
    // Before the fix this was 370/13352 = 2.8% of an 80px box: 2.2px, which is
    // where "a flat block with a thin rainbow strip down its right edge" came
    // from — the block was the 4% background fill and the strip was the sky.
    expect(byBin.get(130)!).toBeGreaterThan(0.6)
    expect(byBin.get(100)!).toBeGreaterThan(0.2)
    // Not a single spike either: the box has to be mostly filled.
    const tall = [...byBin.values()].filter((h) => h >= 0.25).length
    expect(tall).toBeGreaterThan(80)
  })

  it('still draws the plateau itself, clipped at the top, so nothing is hidden', async () => {
    await settle()
    const byBin = new Map(drawnLuma())
    expect(byBin.get(245)!).toBe(1)
  })
})
