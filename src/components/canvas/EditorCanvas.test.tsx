import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import { addLayerToDoc } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore, type ToolId } from '../../store/uiStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { EditorCanvas } from './EditorCanvas'

// The render loop sizes itself from a ResizeObserver; jsdom has none.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

/**
 * jsdom has no canvas implementation, and the render loop builds a real backend
 * on mount. Nothing here paints — the gesture layer under test is a sibling of
 * the canvas — so a no-op 2D context is enough to let the mount finish.
 */
function stubCanvas() {
  const noop = () => undefined
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    const store: Record<string, unknown> = {}
    return new Proxy(store, {
      get(target, prop) {
        if (prop in target) return target[prop as string]
        if (prop === 'getImageData') {
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
        }
        if (prop === 'measureText') return () => ({ width: 0 })
        return noop
      },
      set(target, prop, value) {
        target[prop as string] = value
        return true
      },
    })
  } as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'
}

/** jsdom has no ImageBitmap; the render loop only reads its size. */
const SOURCE_BITMAP = { width: 1600, height: 900 } as unknown as ImageBitmap

const harness = createHarness()

const past = () => useDocStore.getState().past.length
const layers = () => useDocStore.getState().present.layers

const gesture = () => harness.container.querySelector('[class*="gestureLayer"]') as HTMLElement

/**
 * jsdom has no `PointerEvent` *and* no `TouchEvent`, so `@use-gesture` — which
 * probes the browser and binds touch handlers when pointer events are missing —
 * is driven with a plain `Event` carrying a hand-built touch point.
 */
function touchAt(type: string, clientX: number, clientY: number) {
  const target = gesture()
  const event = new Event(type, { bubbles: true, cancelable: true })
  const point = {
    identifier: 1,
    target,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    screenX: clientX,
    screenY: clientY,
  }
  for (const name of ['changedTouches', 'touches', 'targetTouches']) {
    Object.defineProperty(event, name, { value: [point] })
  }
  // A real browser drives this component with PointerEvents, which carry
  // `clientX` on the event itself; a TouchEvent does not, so the stand-in does.
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'clientY', { value: clientY })
  return event
}

/** jsdom lays nothing out, so the canvas claims a 400x400 box at the origin. */
function stubCanvasBox() {
  const canvas = harness.container.querySelector('.ie-canvas-el') as HTMLCanvasElement | null
  if (!canvas) throw new Error('no canvas element')
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 400,
    height: 400,
    right: 400,
    bottom: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
}

/**
 * A press, a drag and a release. The first move only has to clear the tap
 * threshold — that is the event `onDragStart` rides on — so the real position
 * arrives on the second one.
 */
function drag(fromX: number, fromY: number, toX: number, toY: number) {
  const target = gesture()
  act(() => {
    target.dispatchEvent(touchAt('touchstart', fromX, fromY))
  })
  act(() => {
    target.dispatchEvent(touchAt('touchmove', fromX + 8, fromY))
  })
  act(() => {
    target.dispatchEvent(touchAt('touchmove', toX, toY))
  })
  act(() => {
    target.dispatchEvent(touchAt('touchend', toX, toY))
  })
}

/** The gesture handlers close over the tool, so the switch has to land first. */
function setTool(tool: ToolId) {
  act(() => {
    useUiStore.getState().setActiveTool(tool)
  })
}

function loadImage() {
  useDocStore.getState().load(
    createDoc({
      source: { assetId: 'a1', width: 1600, height: 900, name: 'p', mime: 'image/png' },
    }),
  )
}

beforeEach(() => {
  stubCanvas()
  resetStores()
  loadImage()
  act(() => {
    harness.render(<EditorCanvas source={SOURCE_BITMAP} />)
  })
  stubCanvasBox()
})

afterEach(() => harness.unmount())

describe('D2-F05: a first stroke is one undo step, not two', () => {
  it('the empty draw layer and the stroke land in the same span', () => {
    setTool('draw')
    const target = gesture()
    act(() => {
      target.dispatchEvent(touchAt('touchstart', 200, 200))
    })
    act(() => {
      target.dispatchEvent(touchAt('touchmove', 240, 240))
    })
    expect(layers()).toHaveLength(1)
    expect(layers()[0]?.kind).toBe('draw')
    // The layer used to be added *before* the interaction was opened, so the
    // first stroke on a new layer cost two undo steps.
    expect(past()).toBe(1)
  })

  it('one undo takes the stroke away again, and the interaction is closed', () => {
    setTool('draw')
    drag(200, 200, 240, 240)
    expect(layers()).toHaveLength(1)
    expect(useDocStore.getState().interaction.key).toBeNull()
    act(() => {
      useDocStore.getState().undo()
    })
    expect(layers()).toHaveLength(0)
  })

  it('a second stroke on the same layer is one further step, not a new layer', () => {
    setTool('draw')
    drag(200, 200, 240, 240)
    drag(260, 260, 300, 300)
    expect(layers()).toHaveLength(1)
    expect(past()).toBe(2)
  })
})

describe('a layer parked off-canvas by a slider can be dragged back', () => {
  it('the drag clamp matches the -20%..120% transform sliders', () => {
    act(() => {
      addLayerToDoc({
        id: 's1',
        kind: 'sticker',
        name: 'star',
        visible: true,
        transform: { x: 0.2, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
        svg: 'star',
        assetId: null,
      })
    })
    act(() => {
      useUiStore.getState().selectLayer('s1')
    })
    setTool('layers')
    // Grab the sticker to the right of its centre and pull to the left edge: the
    // grab offset is 12% of the frame, so the layer follows the pointer past 0 —
    // which a 0..1 clamp forbade.
    drag(120, 200, 0, 200)
    expect(layers()[0]?.transform.x).toBeCloseTo(-0.12, 6)
  })

  it('a layer grabbed on its own centre follows the pointer to the frame edge', () => {
    act(() => {
      addLayerToDoc({
        id: 's1',
        kind: 'sticker',
        name: 'star',
        visible: true,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
        svg: 'star',
        assetId: null,
      })
    })
    act(() => {
      useUiStore.getState().selectLayer('s1')
    })
    setTool('layers')
    // A layer grabbed on its centre stops at the frame edge, not past it.
    drag(200, 200, 0, 200)
    expect(layers()[0]?.transform.x).toBeCloseTo(-0.02, 6)
  })
})

/**
 * The canvas region draws nothing over the photo for Retouch.
 *
 * There used to be a component whose whole reason to exist was a canvas that was
 * showing the whole frame instead of the crop: it drew the crop rectangle over
 * the visible frame and put four corner marks on it, and it ran two
 * `ResizeObserver`s to keep that rectangle under the canvas. The canvas is the
 * crop now — `useRenderLoop` lays the presentation out from
 * `effectiveOutputSize`, which is the crop — so the rectangle would have coincided
 * with the frame, the marks would have invited a drag that does nothing, and the
 * observers were measuring a box that could not be anywhere else.
 *
 * The deletion is what these two cases hold. The first is the absence, and it is
 * the weaker of the two on purpose: a canvas that stopped drawing overlays
 * entirely would also have no rectangle. The second is the sibling that must still
 * be there, so the first cannot pass by everything disappearing.
 */
describe('the canvas region draws the crop overlay and nothing else', () => {
  it('puts no crop-region element on the canvas while Retouch is open', () => {
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: { ...doc.geometry, crop: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 } },
      }))
    })
    setTool('retouch')
    expect(harness.container.querySelectorAll('[data-crop-region]')).toHaveLength(0)
    // The corner marks went with it, and they were four more elements that read
    // as the crop overlay's own handles.
    expect(harness.container.querySelectorAll('[class*="cropRegion"]')).toHaveLength(0)
  })

  it('still draws the crop overlay while Crop is open, so the case above means something', () => {
    setTool('crop')
    const overlay = harness.container.querySelector('[class*="overlay"]')
    expect(overlay).not.toBeNull()
    // And the rectangle the deleted component drew is still a rectangle someone
    // could mistake for that overlay's handles.
    expect(overlay?.querySelectorAll('[class*="cropRegion"]')).toHaveLength(0)
    expect(harness.container.querySelectorAll('[class*="cropGrid"]')).toHaveLength(1)
  })
})
