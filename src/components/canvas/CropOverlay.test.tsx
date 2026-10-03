import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import { setCrop } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { useUiStore } from '../../store/uiStore'
import { CropOverlay } from './CropOverlay'

// jsdom has no ResizeObserver, and the overlay sizes its box from one.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

const harness = createHarness()

const FULL = { x: 0, y: 0, width: 1, height: 1 }
const SOURCE = { width: 1600, height: 900 }

function loadDoc(
  patch: {
    output?: Partial<ReturnType<typeof createDoc>['output']>
    geometry?: Partial<ReturnType<typeof createDoc>['geometry']>
  } = {},
) {
  const base = createDoc({
    source: {
      assetId: 'a1',
      width: SOURCE.width,
      height: SOURCE.height,
      name: 'p',
      mime: 'image/png',
    },
  })
  useDocStore.getState().load({
    ...base,
    ...patch,
    output: { ...base.output, ...patch.output },
    geometry: { ...base.geometry, ...patch.geometry },
  })
}

const handle = (id: string) =>
  harness.container.querySelector(`[aria-label="Crop ${id} handle"]`) as HTMLElement

const handles = () =>
  Array.from(harness.container.querySelectorAll('[role="slider"]')) as HTMLElement[]

const press = (element: HTMLElement, key: string, shiftKey = false) => {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })
}

const crop = () => useDocStore.getState().present.geometry.crop

beforeEach(() => {
  resetStores()
  loadDoc()
  act(() => {
    harness.render(<CropOverlay />)
  })
})

// The perspective quad lives in component state, so a reused root would carry
// the previous test's toggle into the next one.
afterEach(() => harness.unmount())

describe('D5-F09: the readout is the crop in source pixels, and the export beside it', () => {
  it('reports the source pixels of the crop, not the post-resize export', () => {
    loadDoc({ output: { resize: { mode: 'width', width: 640 } } })
    act(() => {
      harness.render(<CropOverlay />)
    })
    const text = harness.container.textContent ?? ''
    expect(text).toContain('1600 × 900 px')
    expect(text).toContain('exports 640 × 360 px')
  })

  it('reports a partial crop against the frame, not the output', () => {
    loadDoc({ output: { resize: { mode: 'width', width: 640 } } })
    act(() => {
      setCrop({ x: 0.25, y: 0, width: 0.5, height: 1 })
    })
    const text = harness.container.textContent ?? ''
    expect(text).toContain('800 × 900 px')
  })

  it('names the ratio as well', () => {
    act(() => {
      setCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 })
    })
    const text = harness.container.textContent ?? ''
    expect(text).toContain('800 × 450 px')
    expect(text).toContain('16:9')
  })
})

describe('D5-F10: the guides are drawn over the crop, not over the whole image', () => {
  it('hands the crop rect to the passport guides', () => {
    act(() => {
      setCrop({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
      useDocStore.getState().update((doc) => ({
        ...doc,
        passport: { specId: 'uk-35x45', backgroundApplied: true },
      }))
    })
    act(() => {
      harness.render(<CropOverlay />)
    })
    // Without the crop prop the guides inherit `.imageFrame`, so they would be
    // a quarter of the way in and a quarter as wide as the crop box is.
    const guides = harness.container.querySelector('[class*="guides"]') as HTMLElement | null
    expect(guides).not.toBeNull()
    expect(guides?.style.left).toBe('25%')
    expect(guides?.style.top).toBe('25%')
    expect(guides?.style.width).toBe('50%')
    expect(guides?.style.height).toBe('50%')
  })

  it('insets the story safe area into the crop box', () => {
    act(() => {
      useUiStore.getState().setSafeArea('story')
      setCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 })
    })
    act(() => {
      harness.render(<CropOverlay />)
    })
    const safe = harness.container.querySelector('[class*="safeAreaLabel"]')?.parentElement as
      HTMLElement | undefined
    // left = crop.x + 6 % of the crop, width = 88 % of the crop.
    expect(safe?.style.left).toBe('23%')
    expect(safe?.style.width).toBe('44%')
    act(() => {
      useUiStore.getState().setSafeArea('none')
    })
  })
})

describe('D8-F09: the handles are sliders that announce a value and do something', () => {
  it('renders all nine handles', () => {
    const labels = handles().map((element) => element.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Crop nw handle',
      'Crop ne handle',
      'Crop sw handle',
      'Crop se handle',
      'Crop n handle',
      'Crop s handle',
      'Crop e handle',
      'Crop w handle',
    ])
  })

  it('every handle is focusable and carries a real value range', () => {
    for (const element of handles()) {
      expect(element.getAttribute('tabindex')).toBe('0')
      const min = Number(element.getAttribute('aria-valuemin'))
      const max = Number(element.getAttribute('aria-valuemax'))
      const now = Number(element.getAttribute('aria-valuenow'))
      expect(min).toBeGreaterThan(0)
      expect(max).toBe(100)
      expect(now).toBeGreaterThanOrEqual(min)
      expect(now).toBeLessThanOrEqual(max)
      expect(element.getAttribute('aria-valuetext')).toContain('% of the frame')
    }
  })

  it('the minimum is the real crop floor for the frame, not a round number', () => {
    // 64 px of a 1600x900 frame is 4% across but 7% down, and the floor is the
    // larger of the two, so the announced minimum is 7% and not the 2%
    // normalized default.
    expect(handle('nw').getAttribute('aria-valuemin')).toBe('7')
  })

  it('ArrowRight on the north-west handle moves crop.x and updates the value', () => {
    act(() => {
      setCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.5 })
    })
    const nw = handle('nw')
    const before = crop().x
    press(nw, 'ArrowRight')
    expect(crop().x).toBeCloseTo(before + 0.01, 6)
    expect(crop().width).toBeCloseTo(0.49, 6)
    expect(nw.getAttribute('aria-valuenow')).toBe('49')
  })

  it('Shift multiplies the step by ten', () => {
    act(() => {
      setCrop({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 })
    })
    press(handle('se'), 'ArrowRight', true)
    expect(crop().width).toBeCloseTo(0.5, 6)
  })

  it('each key press is one undo step and leaves no interaction open', () => {
    act(() => {
      setCrop({ x: 0.4, y: 0.4, width: 0.3, height: 0.3 })
    })
    const before = useDocStore.getState().past.length
    press(handle('e'), 'ArrowRight')
    press(handle('e'), 'ArrowRight')
    expect(useDocStore.getState().past.length).toBe(before + 2)
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('an edge handle only moves its own axis', () => {
    act(() => {
      setCrop({ x: 0.2, y: 0.3, width: 0.5, height: 0.4 })
    })
    press(handle('n'), 'ArrowUp')
    expect(crop().y).toBeCloseTo(0.29, 6)
    expect(crop().height).toBeCloseTo(0.41, 6)
    expect(crop().x).toBeCloseTo(0.2, 6)
    expect(crop().width).toBeCloseTo(0.5, 6)
  })

  it('an edge handle ignores the axis it cannot drive', () => {
    const revision = useDocStore.getState().revision
    press(handle('n'), 'ArrowLeft')
    expect(useDocStore.getState().revision).toBe(revision)
  })

  it('an edge handle announces its own extent', () => {
    act(() => {
      setCrop({ x: 0, y: 0.25, width: 1, height: 0.5 })
    })
    expect(handle('n').getAttribute('aria-valuenow')).toBe('50')
    expect(handle('n').getAttribute('aria-valuetext')).toContain('tall')
    expect(handle('e').getAttribute('aria-valuenow')).toBe('100')
  })
})

describe('D5-F16: edge handles and a reset action', () => {
  it('Reset crop returns the full frame and leaves the orientation alone', () => {
    act(() => {
      setCrop({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 })
    })
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: { ...doc.geometry, orientation: { quarterTurns: 1, flipH: true, flipV: false } },
      }))
    })
    const reset = Array.from(harness.container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Reset crop',
    )
    if (!reset) throw new Error('no Reset crop button')
    act(() => {
      reset.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(crop()).toEqual(FULL)
    expect(useDocStore.getState().present.geometry.orientation).toEqual({
      quarterTurns: 1,
      flipH: true,
      flipV: false,
    })
  })

  it('reset is one undo step, so it can be taken back', () => {
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(0)
      act(() => {
        setCrop({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 })
      })
      // Outside the coalesce window, so the reset is a step of its own.
      now.mockReturnValue(10_000)
      const before = useDocStore.getState().past.length
      const reset = Array.from(harness.container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Reset crop',
      ) as HTMLButtonElement
      act(() => {
        reset.click()
      })
      expect(useDocStore.getState().past.length).toBe(before + 1)
    } finally {
      now.mockRestore()
    }
    act(() => {
      useDocStore.getState().undo()
    })
    expect(crop()).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 })
  })
})

/* ------------------------------------------------------------------ *
 * Perspective (D5-F08)
 * ------------------------------------------------------------------ */

const button = (label: string) =>
  Array.from(harness.container.querySelectorAll('button')).find(
    (node) => node.textContent === label,
  ) as HTMLButtonElement | undefined

const corner = (label: string) =>
  harness.container.querySelector(
    `[aria-label="Perspective ${label} corner"]`,
  ) as HTMLElement | null

const click = (element: HTMLElement | undefined) => {
  act(() => {
    element?.click()
  })
}

const perspective = () => useDocStore.getState().present.geometry.perspective

const openPerspective = () => click(button('Perspective'))

describe('D5-F08: the perspective quad is behind a toggle and really drags', () => {
  it('shows no corner handles until the toggle is on', () => {
    expect(button('Perspective')).toBeDefined()
    expect(corner('top left')).toBeNull()
    openPerspective()
    expect(corner('top left')).not.toBeNull()
    expect(corner('bottom right')).not.toBeNull()
  })

  it('marks the toggle pressed while the quad is up', () => {
    openPerspective()
    expect(button('Perspective')?.getAttribute('aria-pressed')).toBe('true')
    click(button('Perspective'))
    expect(button('Perspective')?.getAttribute('aria-pressed')).toBe('false')
    expect(corner('top left')).toBeNull()
  })

  it('says what the toggle is for, because "Perspective" has no referent of its own', () => {
    // The word was the whole of the affordance: a reader who has never
    // corrected a photo shot at an angle had a button and a picture and no way
    // to find out what pressing it wanted of them. It is not a stub — the quad
    // really drags — so the sentence says what it does and what it costs. Text
    // rather than `title` alone, because a `title` is not an accessible name
    // and a hover-only sentence reaches nobody on a phone.
    expect(harness.container.textContent).not.toContain('straight lines come back parallel')
    openPerspective()
    const text = harness.container.textContent ?? ''
    expect(text).toContain('Drag a corner')
    expect(text).toContain('straight lines come back parallel')
    expect(text).toContain('Nothing is detected for you')
    expect(text).toContain('baked into the exported pixels')
    // And it leaves with the quad, so it cannot become chrome nobody can dismiss.
    click(button('Perspective'))
    expect(harness.container.textContent).not.toContain('straight lines come back parallel')
  })

  it('moves one corner and leaves the other three alone', () => {
    openPerspective()
    press(corner('top right')!, 'ArrowRight')
    expect(perspective().topRight.x).toBeCloseTo(0.01, 5)
    expect(perspective().topLeft).toEqual({ x: 0, y: 0 })
    expect(perspective().bottomLeft).toEqual({ x: 0, y: 0 })
    expect(perspective().bottomRight).toEqual({ x: 0, y: 0 })
  })

  it('moves a corner in both axes', () => {
    openPerspective()
    const node = corner('bottom left')!
    press(node, 'ArrowRight')
    press(node, 'ArrowDown')
    expect(perspective().bottomLeft).toEqual({ x: 0.01, y: 0.01 })
  })

  it('takes 10% steps with shift held', () => {
    openPerspective()
    press(corner('top left')!, 'ArrowRight', true)
    expect(perspective().topLeft.x).toBeCloseTo(0.1, 5)
  })

  it('clamps a corner at ±0.5 so the quad cannot fold over itself', () => {
    openPerspective()
    const node = corner('top left')!
    for (let i = 0; i < 8; i += 1) press(node, 'ArrowRight', true)
    expect(perspective().topLeft.x).toBe(0.5)
    for (let i = 0; i < 16; i += 1) press(node, 'ArrowLeft', true)
    expect(perspective().topLeft.x).toBe(-0.5)
  })

  it('announces the corner it is about to change', () => {
    openPerspective()
    press(corner('bottom right')!, 'ArrowUp')
    const node = corner('bottom right')!
    expect(node.getAttribute('aria-valuenow')).toBe('0')
    expect(node.getAttribute('aria-valuetext')).toContain('down')
  })

  it('records a nudge as one undo step', () => {
    openPerspective()
    press(corner('top right')!, 'ArrowRight')
    expect(useDocStore.getState().interaction.key).toBeNull()
    useDocStore.getState().undo()
    expect(perspective().topRight.x).toBe(0)
  })

  it('resets every corner, and only offers the button once something moved', () => {
    openPerspective()
    expect(button('Reset perspective')?.disabled).toBe(true)
    press(corner('top right')!, 'ArrowRight')
    press(corner('bottom left')!, 'ArrowDown')
    expect(button('Reset perspective')?.disabled).toBe(false)
    click(button('Reset perspective'))
    expect(perspective()).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    })
    expect(button('Reset perspective')?.disabled).toBe(true)
  })

  it('draws the quad through the corner positions, not the frame corners', () => {
    openPerspective()
    press(corner('top right')!, 'ArrowRight')
    const polygon = harness.container.querySelector('polygon')
    const points = (polygon?.getAttribute('points') ?? '').split(' ')
    // topLeft, topRight, bottomRight, bottomLeft in 0..100 viewBox units.
    expect(points[0]).toBe('0,0')
    expect(points[1]).toBe('101,0')
    expect(points[2]).toBe('100,100')
    expect(points[3]).toBe('0,100')
  })

  it('is a no-op on the crop rect', () => {
    act(() => {
      setCrop({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
    })
    openPerspective()
    press(corner('top right')!, 'ArrowRight')
    expect(crop()).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
  })
})

/* ------------------------------------------------------------------ *
 * A drag is the sum of its moves, not the last one
 * ------------------------------------------------------------------ */

/**
 * `usePointerDrag` reports the movement of a single event, so a handler that
 * re-applies its result from the gesture's start value keeps only the final
 * frame. jsdom has no PointerEvent, but the hook only reads `button`,
 * `pointerId` and `clientX`/`clientY` off the event, so a plain `Event` with
 * those four properties attached is enough to drive a real gesture.
 */
const pointer = (type: string, x: number, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: y })
  return event
}

const drag = (element: HTMLElement, points: [number, number][]) => {
  const last = points[points.length - 1]
  act(() => {
    element.dispatchEvent(pointer('pointerdown', points[0][0], points[0][1]))
  })
  for (const [x, y] of points.slice(1)) {
    act(() => {
      element.dispatchEvent(pointer('pointermove', x, y))
    })
  }
  act(() => {
    element.dispatchEvent(pointer('pointerup', last[0], last[1]))
  })
}

describe('a drag accumulates every move', () => {
  it('sums the crop handle moves instead of keeping the last one', () => {
    // Four 10 px steps inward is 30 px of crop; the overlay's frame is 288 px
    // wide, so the se handle has to shrink the rect by 30/288.
    const before = crop()
    drag(handle('se'), [
      [0, 0],
      [-10, 0],
      [-20, 0],
      [-30, 0],
    ])
    expect(before.width).toBe(1)
    expect(crop().width).toBeCloseTo(1 - 30 / 288, 3)
    expect(crop().height).toBeCloseTo(1, 3)
  })

  it('sums the perspective corner moves', () => {
    openPerspective()
    // The overlay's frame is the one `displayW`/`displayH` are computed from;
    // all that matters here is that the offset is the sum, not the last step.
    const node = corner('top left')!
    drag(node, [
      [0, 0],
      [40, 0],
      [80, 0],
      [120, 0],
    ])
    expect(perspective().topLeft.x).toBeCloseTo(120 / containerWidth(), 3)
    expect(perspective().topLeft.x).toBeGreaterThan(0.4)
  })

  it('closes the interaction so the next edit is its own undo step', () => {
    drag(handle('se'), [
      [0, 0],
      [-10, 0],
    ])
    expect(useDocStore.getState().interaction.key).toBeNull()
    useDocStore.getState().undo()
    expect(crop()).toEqual(FULL)
  })
})

/** The overlay's own on-screen frame width, which the drags are divided by. */
function containerWidth(): number {
  const frame = harness.container.querySelector('[class*="imageFrame"]') as HTMLElement
  return Number.parseFloat(frame.style.width)
}
