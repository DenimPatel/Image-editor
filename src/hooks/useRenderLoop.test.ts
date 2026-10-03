import { describe, expect, it } from 'vitest'
import { TOOL_IDS } from '../store/uiStore'
import {
  contextRetryDelay,
  frameKey,
  isEditingCrop,
  shouldRenderFrame,
  sizeKey,
  type FrameInputs,
  type LoopKey,
} from './useRenderLoop'

/**
 * The loop itself needs a real WebGL2 context, a real rAF and a real
 * ResizeObserver, none of which jsdom has, so the decisions that were actually
 * wrong are pinned here instead: when a lost context is retried, and what makes a
 * frame worth rendering.
 *
 * The last of those is not a formality. A set crop that the preview ignored was a
 * `LoopKey` with no field for `editingCrop`, so closing the Crop tool produced a
 * key identical to the open one and no frame ran at all — the canvas kept the
 * uncropped photo, element and pixels together, until a resize changed
 * `containerSize`. `e2e/journey.crop-preview.spec.ts` is the one that proves it on
 * real pixels; this is the one that says why the key was wrong.
 */

const INPUTS: FrameInputs = {
  revision: 1,
  compareHeld: false,
  editingCrop: false,
  viewport: { scale: 1, x: 0, y: 0 },
  containerSize: { width: 800, height: 600 },
  dpr: 1,
}

const BASE: LoopKey = {
  revision: 1,
  compareHeld: false,
  editingCrop: false,
  viewportScale: 1,
  viewportX: 0,
  viewportY: 0,
  size: '800x600',
  dpr: 1,
}

describe('contextRetryDelay (D3-F08)', () => {
  it('backs off from 10 s and stops growing at 40 s', () => {
    // `attempt` is the number of losses so far, so the first retry is the
    // second entry of the 5000 x min(8, 1 + attempt) ladder.
    expect(contextRetryDelay(1)).toBe(10_000)
    expect(contextRetryDelay(2)).toBe(15_000)
    expect(contextRetryDelay(3)).toBe(20_000)
  })

  it('caps the wait instead of growing without limit', () => {
    expect(contextRetryDelay(8)).toBe(40_000)
    expect(contextRetryDelay(50)).toBe(40_000)
  })

  it('never returns a non-positive delay for a nonsense attempt count', () => {
    expect(contextRetryDelay(0)).toBe(5000)
    expect(contextRetryDelay(-1)).toBe(5000)
  })

  it('retries often enough that a loss is not a one-way door', () => {
    // The old latch downgraded to Canvas2D after a fixed 700 ms and never
    // looked at WebGL again, so the editor stayed on the slow engine forever.
    expect(contextRetryDelay(1)).toBeLessThan(60_000)
  })
})

describe('shouldRenderFrame (D3-F09)', () => {
  it('skips an identical frame', () => {
    expect(shouldRenderFrame(BASE, { ...BASE })).toBe(false)
  })

  it('renders after a document revision', () => {
    expect(shouldRenderFrame(BASE, { ...BASE, revision: 2 })).toBe(true)
  })

  it('renders when compare is pressed and released', () => {
    expect(shouldRenderFrame(BASE, { ...BASE, compareHeld: true })).toBe(true)
  })

  it('renders on a pan or a zoom', () => {
    expect(shouldRenderFrame(BASE, { ...BASE, viewportX: 12 })).toBe(true)
    expect(shouldRenderFrame(BASE, { ...BASE, viewportScale: 1.5 })).toBe(true)
  })

  it('re-lays out on a pure container resize, which changes nothing else', () => {
    // The ResizeObserver only set `dirty`, and the frame test used to compare
    // revision/compare/viewport — so a window resize never re-ran `applyLayout`
    // and the canvas kept the fit it had at the old container size.
    expect(shouldRenderFrame(BASE, { ...BASE, size: sizeKey({ width: 1200, height: 600 }) })).toBe(
      true,
    )
  })

  it('stays quiet for a resize back to the size it already laid out for', () => {
    const first = shouldRenderFrame(BASE, { ...BASE, size: '1000x700' })
    expect(first).toBe(true)
    expect(shouldRenderFrame({ ...BASE, size: '1000x700' }, { ...BASE, size: '1000x700' })).toBe(
      false,
    )
  })

  it('renders when the Crop tool opens or closes, in both directions', () => {
    // The defect. A 1:1 crop set, the Crop tool closed: `revision` is unchanged
    // by opening the tool, and so is everything else in the key, so with no
    // `editingCrop` field `shouldRenderFrame` answered false and the frame that
    // should show the whole frame — and, on the way out, the frame that should
    // show the crop — never ran.
    expect(shouldRenderFrame(BASE, { ...BASE, editingCrop: true })).toBe(true)
    expect(shouldRenderFrame({ ...BASE, editingCrop: true }, BASE)).toBe(true)
  })

  it('renders when the display scale changes, which `computeProxySize` reads', () => {
    // A window dragged onto a second display changes `devicePixelRatio` and
    // nothing else: no store write, no resize, no new revision. The proxy size
    // and so the backing store were then a frame behind the screen.
    expect(shouldRenderFrame(BASE, { ...BASE, dpr: 2 })).toBe(true)
  })
})

describe('frameKey', () => {
  it('reads every field of FrameInputs, so no input can be left out of the key', () => {
    // The whole mechanism of the fix: the key and the frame are two readings of
    // one object. If a new input is added to `FrameInputs` and not to `frameKey`,
    // the key is stale in the same way this bug was — and TypeScript cannot see
    // that, so this comparison of the key's field names against the inputs' does.
    expect(Object.keys(frameKey(INPUTS)).sort()).toEqual([
      'compareHeld',
      'dpr',
      'editingCrop',
      'revision',
      'size',
      'viewportScale',
      'viewportX',
      'viewportY',
    ])
  })

  it('is equal for identical inputs and different when any one of them moves', () => {
    expect(frameKey(INPUTS)).toEqual(frameKey({ ...INPUTS }))
    const moved = {
      revision: 2,
      compareHeld: true,
      editingCrop: true,
      viewport: { scale: 1.5, x: 0, y: 0 },
      containerSize: { width: 801, height: 600 },
      dpr: 2,
    }
    for (const key of Object.keys(moved) as (keyof typeof moved)[]) {
      const next = { ...INPUTS, [key]: moved[key] }
      expect(frameKey(next)).not.toEqual(frameKey(INPUTS))
      expect(shouldRenderFrame(frameKey(INPUTS), frameKey(next))).toBe(true)
    }
  })
})

describe('isEditingCrop', () => {
  it('is true for the Crop tool alone, so no other tool can blank the crop', () => {
    // Every tool id the tab bar can hold, because a rule of the form
    // `activeTool !== null` would blank the crop for twelve tools and pass a
    // test written against one of them.
    expect(isEditingCrop('crop')).toBe(true)
    // Every other id in `TOOL_IDS`, read off the export rather than retyped, so
    // a tool added later is covered by construction: a rule of the form
    // `activeTool !== null` would blank the crop for thirteen tools and pass a
    // test written against one of them.
    for (const tool of TOOL_IDS.filter((id) => id !== 'crop')) {
      expect(isEditingCrop(tool)).toBe(false)
    }
    expect(isEditingCrop(null)).toBe(false)
  })
})

describe('sizeKey', () => {
  it('is equal for identical sizes and different otherwise', () => {
    expect(sizeKey({ width: 320, height: 240 })).toBe(sizeKey({ width: 320, height: 240 }))
    expect(sizeKey({ width: 320, height: 240 })).not.toBe(sizeKey({ width: 321, height: 240 }))
  })
})
