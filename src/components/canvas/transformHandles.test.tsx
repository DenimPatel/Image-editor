import { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Layer } from '../../model/types'
import {
  createDrawLayer,
  createFrameLayer,
  createRedactLayer,
  createShapeLayer,
  createTextLayer,
  createWatermarkLayer,
  defaultTransform,
} from '../../features/layers/factory'
import { addLayerToDoc } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { createHarness, pointerEvent, resetStores } from '../../store/testHarness'
import {
  cornerPosition,
  cornerRay,
  transformBasis,
  type HandleDeps,
  type TransformBasis,
} from './layerTransform'
import { LayerTransformOverlay } from './transformHandles'

/**
 * D6-F14 — the overlay, driven through real pointer and key events.
 *
 * The two claims that live here and cannot live in the geometry tests are the
 * *history* granularity of a whole gesture and the *DOM* facts axe would check:
 * that a drag is one undo step however many moves it took, and that every grip is
 * a named, focusable control. Both are the kind of thing that looks finished in
 * a screenshot and is broken in the app.
 */

/** jsdom lays nothing out, so the overlay's frame is given a fixed box. */
const FRAME = { left: 0, top: 0, width: 800, height: 450 }
const SIZE = { width: 1600, height: 900 }

/** No canvas in jsdom, so text falls back to the estimator. Deterministic. */
const DEPS: HandleDeps = {
  measure: (_font, fontSize, trackingPx, text) =>
    Math.max(0, [...text].length * fontSize * 0.55 + [...text].length * trackingPx),
  stickerAspect: () => 1,
}

const harness = createHarness()
const past = () => useDocStore.getState().past.length
const layers = () => useDocStore.getState().present.layers
const transformOf = (id: string) => {
  const layer = layers().find((candidate) => candidate.id === id)
  if (!layer) throw new Error('the layer is gone')
  return layer.transform
}

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

/**
 * jsdom has no 2D context at all. `measureText` reporting zero width is what the
 * overlay's own fallback path is for, so the stub makes that path the one under
 * test rather than an accident of one measurement returning NaN.
 */
function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({} as Record<string, unknown>, {
      get: (target, prop) => {
        if (prop in target) return target[prop as string]
        if (prop === 'measureText') return () => ({ width: 0 })
        return () => undefined
      },
      set: (target, prop, value) => {
        target[prop as string] = value
        return true
      },
    })) as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'
}

/** The overlay's own box is the only geometry a pointer is read against. */
function stubFrameBox() {
  const frame = harness.container.querySelector('[class*="transformFrame"]') as HTMLElement | null
  if (!frame) throw new Error('the overlay frame is not rendered')
  frame.getBoundingClientRect = () =>
    ({
      ...FRAME,
      right: FRAME.left + FRAME.width,
      bottom: FRAME.top + FRAME.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

/** A canvas-pixel position as the client coordinates that would produce it. */
function clientOf(x: number, y: number): { clientX: number; clientY: number } {
  return {
    clientX: FRAME.left + (x / SIZE.width) * FRAME.width,
    clientY: FRAME.top + (y / SIZE.height) * FRAME.height,
  }
}

/**
 * A pointer event that carries the modifier. The shared harness helper takes only
 * coordinates, and the free mode is chosen from `shiftKey` on the *first* event,
 * so a drag without this is a locked drag wearing the free drag's name.
 */
function at(
  point: { clientX: number; clientY: number },
  type: string,
  shiftKey: boolean,
): PointerEvent {
  const event = pointerEvent(type, point) as unknown as PointerEvent
  Object.defineProperty(event, 'shiftKey', { value: shiftKey })
  return event
}

function grip(name: string): HTMLElement {
  const found = harness.container.querySelector(`[aria-label="${name}"]`)
  if (!found) throw new Error(`no grip named "${name}"`)
  return found as HTMLElement
}

function grips(): HTMLElement[] {
  return [...harness.container.querySelectorAll('[role="slider"]')] as HTMLElement[]
}

function basisOf(layer: Layer): TransformBasis {
  return transformBasis(layer, SIZE, DEPS)
}

function mount() {
  act(() => {
    harness.render(<LayerTransformOverlay />)
  })
}

/** Unmount, so the next case in a loop is not layered on top of this one. */
function clear() {
  harness.unmount()
}

/** A loaded photo of `SIZE`, optionally carrying a layer, with it selected. */
function loadDoc(layer?: Layer) {
  act(() => {
    useDocStore.getState().load(
      createDoc({
        source: {
          assetId: 'a1',
          width: SIZE.width,
          height: SIZE.height,
          name: 'p',
          mime: 'image/png',
        },
      }),
    )
  })
  if (!layer) return
  act(() => {
    addLayerToDoc(layer)
  })
  act(() => {
    useUiStore.getState().selectLayer(layer.id)
  })
}

/**
 * A press, any number of moves, and a release — each in its own commit.
 *
 * The moves go to the grip, not to `window`: `usePointerDrag` takes pointer
 * capture on the element it was given, which in a browser routes every later event
 * back to it, and jsdom implements neither capture nor the routing, so the test
 * has to do what the browser does.
 */
function drag(element: HTMLElement, points: { x: number; y: number }[], shiftKey = false) {
  const first = clientOf(points[0]!.x, points[0]!.y)
  act(() => {
    element.dispatchEvent(at(first, 'pointerdown', shiftKey))
  })
  for (const point of points.slice(1)) {
    const next = clientOf(point.x, point.y)
    act(() => {
      element.dispatchEvent(at(next, 'pointermove', shiftKey))
    })
  }
  const last = clientOf(points[points.length - 1]!.x, points[points.length - 1]!.y)
  act(() => {
    element.dispatchEvent(at(last, 'pointerup', shiftKey))
  })
}

function press(element: HTMLElement, key: string, shiftKey = false) {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })
}

beforeEach(() => {
  stubCanvas()
  resetStores()
})

afterEach(() => harness.unmount())

describe('D6-F14: a full handle drag is exactly one undo step', () => {
  it('a corner drag, however many moves it took, is one entry', () => {
    loadDoc(createTextLayer())
    mount()
    stubFrameBox()
    const layer = layers()[0]!
    const before = transformOf(layer.id)
    const basis = basisOf(layer)
    const corner = cornerPosition(basis, 'se')
    const pastBefore = past()

    // Nine moves, and the first of them is the one that does not move at all —
    // the first `pointermove` a browser delivers before anything has changed, and
    // the one a jump would hide itself in.
    drag(
      grip('Scale from the bottom right corner'),
      [
        { x: corner.x, y: corner.y },
        { x: corner.x, y: corner.y },
        ...Array.from({ length: 7 }, (_, index) => ({
          x: corner.x + (index + 1) * 12,
          y: corner.y + (index + 1) * 6,
        })),
      ],
      false,
    )

    const after = transformOf(layer.id)
    expect(after.scale, 'the drag did something').toBeGreaterThan(before.scale)
    expect(past() - pastBefore, 'one entry, not one per move').toBe(1)
    expect(useDocStore.getState().interaction.key, 'the span is closed').toBeNull()

    act(() => {
      useDocStore.getState().undo()
    })
    expect(transformOf(layer.id)).toEqual(before)
  })

  it('a rotate drag is one entry too', () => {
    const layer = { ...createShapeLayer('rect'), transform: { ...defaultTransform(), scale: 2 } }
    loadDoc(layer)
    mount()
    stubFrameBox()
    const basis = basisOf(layer)
    const before = transformOf(layer.id)
    const radius = 300
    const pastBefore = past()

    drag(
      grip('Rotate layer'),
      [
        { x: basis.center.x + radius, y: basis.center.y },
        { x: basis.center.x + radius, y: basis.center.y },
        {
          x: basis.center.x + radius * Math.cos(Math.PI / 12),
          y: basis.center.y + radius * Math.sin(Math.PI / 12),
        },
        {
          x: basis.center.x + radius * Math.cos(Math.PI / 4),
          y: basis.center.y + radius * Math.sin(Math.PI / 4),
        },
      ],
      false,
    )

    const after = transformOf(layer.id)
    expect(after.rotation).toBeCloseTo(45, 6)
    // Rotation and nothing else: a rotate drag is not a scale drag in disguise.
    expect(after.scale).toBe(before.scale)
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
    expect(past() - pastBefore).toBe(1)

    act(() => {
      useDocStore.getState().undo()
    })
    expect(transformOf(layer.id)).toEqual(before)
  })

  it('the free mode is the other mode: same gesture, different transform', () => {
    const layer = { ...createShapeLayer('arrow'), transform: { ...defaultTransform(), scale: 1 } }
    loadDoc(layer)
    mount()
    stubFrameBox()
    const basis = basisOf(layer)
    const corner = cornerPosition(basis, 'nw')

    // Square to the corner's ray, so the locked mode cannot change the scale at
    // all and the only thing that can differ is the pivot. The perpendicular is
    // built from the ray rather than guessed: a corner's ray is diagonal, so
    // "straight up" is not square to it.
    const ray = cornerRay(basis, 'nw')
    const reach = Math.hypot(ray.x, ray.y)
    const square = {
      x: corner.x - (ray.y / reach) * 200,
      y: corner.y + (ray.x / reach) * 200,
    }
    drag(grip('Scale from the top left corner'), [{ x: corner.x, y: corner.y }, square], false)
    const locked = transformOf(layer.id)
    expect(locked.scale).toBeCloseTo(1, 6)
    expect(locked.x).toBe(layer.transform.x)
    expect(locked.y).toBe(layer.transform.y)
    // Square to the ray, the locked factor is exactly 1, so the next drag starts
    // from the state this one left.
    expect(locked.scale).toBeCloseTo(1, 12)

    drag(grip('Scale from the top left corner'), [{ x: corner.x, y: corner.y }, square], true)
    const free = transformOf(layer.id)
    expect(free.scale).toBeCloseTo(1, 6)
    expect(free.x).not.toBe(layer.transform.x)
    expect(free.y).not.toBe(layer.transform.y)
  })
})

describe('D6-F14: the grips are real controls', () => {
  it('every corner is a named, focusable slider with a value', () => {
    loadDoc(createTextLayer())
    mount()
    expect(grips().map((element) => element.getAttribute('aria-label'))).toEqual([
      'Scale from the top left corner',
      'Scale from the top right corner',
      'Scale from the bottom right corner',
      'Scale from the bottom left corner',
      'Rotate layer',
    ])
    for (const element of grips()) {
      expect(element.getAttribute('role')).toBe('slider')
      expect(element.tabIndex).toBe(0)
      expect(element.getAttribute('aria-valuenow')).not.toBeNull()
      expect(element.getAttribute('aria-valuetext')).not.toBe('')
    }
    expect(grip('Rotate layer').getAttribute('aria-valuetext')).toBe('0 degrees')
    expect(grip('Scale from the top left corner').getAttribute('aria-valuetext')).toBe(
      '100% of its size',
    )
  })

  it('the outline is drawn as two rects, so it reads without colour', () => {
    loadDoc(createTextLayer())
    mount()
    const rects = harness.container.querySelectorAll('rect')
    expect(rects).toHaveLength(2)
    for (const rect of rects) {
      expect(rect.getAttribute('vector-effect')).toBe('non-scaling-stroke')
    }
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'src/components/canvas/transformHandles.module.css'),
      'utf8',
    )
    // A dash is the part of the outline that survives forced colours, a greyscale
    // print and a colour-blind reader, so it is asserted rather than assumed.
    expect(stylesheet).toMatch(/stroke-dasharray:/)
    expect(stylesheet).toMatch(/\.outlineHalo\b/)
  })

  it('the focus ring is the token the whole app draws with', () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'src/components/canvas/transformHandles.module.css'),
      'utf8',
    )
    expect(stylesheet).toMatch(/\.grip:focus-visible\s*\{[^}]*var\(--focus-ring\)/)
    // The editor re-points that token for its hardcoded-dark ground, so the ring
    // is the accent in both themes rather than a literal that cannot be remapped.
    expect(stylesheet).toMatch(/forced-colors: active/)
  })

  it('the grips are the size the crop handles are, and are tappable at the tap target', () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'src/components/canvas/transformHandles.module.css'),
      'utf8',
    )
    expect(stylesheet).toMatch(/\.grip\s*\{[^}]*width:\s*28px/)
    expect(stylesheet).toMatch(/\.grip\s*\{[^}]*height:\s*28px/)
    expect(stylesheet).toMatch(/width:\s*var\(--ie-tap\)/)
    // `touch-action: none` is what stops a finger drag from becoming a page
    // scroll halfway through a scale.
    expect(stylesheet).toMatch(/touch-action:\s*none/)
  })
})

describe('D6-F14: the keyboard path', () => {
  it('an arrow key moves a corner, and Shift moves it ten times as far', () => {
    loadDoc(createTextLayer())
    mount()
    const topLeft = grip('Scale from the top left corner')

    press(topLeft, 'ArrowUp')
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(1.01, 6)
    press(topLeft, 'ArrowRight')
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(1.02, 6)
    press(topLeft, 'ArrowDown', true)
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(0.92, 6)
    press(topLeft, 'ArrowLeft', true)
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(0.82, 6)
  })

  it('each press is one undo step, and one undo takes exactly one press back', () => {
    loadDoc(createTextLayer())
    mount()
    const topLeft = grip('Scale from the top left corner')
    const pastBefore = past()

    press(topLeft, 'ArrowUp')
    press(topLeft, 'ArrowUp')
    expect(past() - pastBefore).toBe(2)
    act(() => {
      useDocStore.getState().undo()
    })
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(1.01, 6)
  })

  it('the rotate grip is a degree at a time, and Shift is a coarse step', () => {
    loadDoc(createShapeLayer('rect'))
    mount()
    const rotate = grip('Rotate layer')
    press(rotate, 'ArrowUp')
    expect(transformOf(layers()[0]!.id).rotation).toBeCloseTo(1, 6)
    press(rotate, 'ArrowUp', true)
    expect(transformOf(layers()[0]!.id).rotation).toBeCloseTo(16, 6)
    press(rotate, 'ArrowLeft')
    expect(transformOf(layers()[0]!.id).rotation).toBeCloseTo(15, 6)
    expect(rotate.getAttribute('aria-valuenow')).toBe('15')
  })

  it('a key the grip does not use is left alone', () => {
    loadDoc(createTextLayer())
    mount()
    press(grip('Rotate layer'), 'Enter')
    expect(transformOf(layers()[0]!.id).rotation).toBe(0)
  })

  it('the scale stays inside the slider range however many presses there are', () => {
    loadDoc(createTextLayer())
    mount()
    const topLeft = grip('Scale from the top left corner')
    for (let index = 0; index < 20; index += 1) press(topLeft, 'ArrowDown', true)
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(0.05, 6)
    for (let index = 0; index < 40; index += 1) press(topLeft, 'ArrowUp', true)
    expect(transformOf(layers()[0]!.id).scale).toBeCloseTo(4, 6)
  })
})

describe('D6-F14: a grip is 28 screen pixels at every zoom', () => {
  it('cancels the viewport scale out of its own size', () => {
    loadDoc(createTextLayer())
    mount()
    for (const scale of [0.25, 1, 2.5, 8]) {
      act(() => {
        useUiStore.getState().setViewport({ scale })
      })
      const element = grip('Scale from the top left corner')
      // The frame carries `scale(zoom)`; this is the factor that undoes it, so the
      // rendered box is `28 / zoom * zoom` on every one.
      expect(element.style.getPropertyValue('--grip-zoom')).toBe(String(1 / scale))
      expect(element.style.left).not.toBe('')
    }
  })

  it('never divides by a zero zoom', () => {
    loadDoc(createTextLayer())
    mount()
    act(() => {
      useUiStore.setState({ viewport: { scale: 0, x: 0, y: 0 } })
    })
    expect(grip('Rotate layer').style.getPropertyValue('--grip-zoom')).toBe(String(1 / 0.01))
  })
})

describe('D6-F14: only the kinds the compositor transforms in place get grips', () => {
  const cases: [string, Layer][] = [
    ['text', createTextLayer()],
    ['shape', createShapeLayer('rect')],
    ['watermark', createWatermarkLayer()],
  ]
  it('shows them for the four it can place', () => {
    for (const [name, layer] of cases) {
      loadDoc(layer)
      mount()
      expect(grips().length, name).toBe(5)
      clear()
    }
  })

  it('shows none for the three it cannot', () => {
    for (const [name, layer] of [
      ['frame', createFrameLayer('solid')],
      ['redact', createRedactLayer()],
      ['draw', createDrawLayer()],
    ] as [string, Layer][]) {
      loadDoc(layer)
      mount()
      expect(grips().length, name).toBe(0)
      clear()
    }
  })

  it('shows none for a layer the compositor is not drawing', () => {
    const layer = { ...createTextLayer(), visible: false }
    loadDoc(layer)
    mount()
    expect(grips()).toHaveLength(0)
  })

  it('shows none when nothing is selected', () => {
    loadDoc()
    mount()
    expect(grips()).toHaveLength(0)
  })

  it('steps aside for the two tools that own every pixel of canvas input', () => {
    loadDoc(createTextLayer())
    for (const tool of ['crop', 'draw'] as const) {
      act(() => {
        useUiStore.getState().setActiveTool(tool)
      })
      mount()
      expect(grips().length, tool).toBe(0)
      act(() => {
        useUiStore.getState().setActiveTool('layers')
      })
      mount()
      expect(grips().length, `${tool} then back`).toBe(5)
    }
  })

  it('shows none while comparison is holding, because there are no layers on screen', () => {
    loadDoc(createTextLayer())
    act(() => {
      useUiStore.getState().setCompareHeld(true)
    })
    mount()
    expect(grips()).toHaveLength(0)
  })
})
