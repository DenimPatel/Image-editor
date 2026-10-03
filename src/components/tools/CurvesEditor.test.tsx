import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TONAL_CURVE_COLORS } from '../../lib/curves'
import { useDocStore } from '../../store/docStore'
import { createHarness, pointerEvent, resetStores } from '../../store/testHarness'
import { CurvesEditor } from './CurvesEditor'

const harness = createHarness()

const svg = () => harness.container.querySelector('svg') as SVGSVGElement

/** The editor reads `getBoundingClientRect`, which jsdom reports as empty. */
function stubRect(element: Element) {
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 260, height: 260, right: 260, bottom: 260, x: 0, y: 0 }) as DOMRect
}

const past = () => useDocStore.getState().past.length

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
  harness.render(<CurvesEditor />)
  stubRect(svg())
})

function dragPoint(index: number, xs: number[]) {
  act(() => {
    svg().querySelectorAll('circle')[index].dispatchEvent(pointerEvent('pointerdown'))
  })
  for (const x of xs) {
    act(() => {
      svg().dispatchEvent(pointerEvent('pointermove', { clientX: x, clientY: 260 - x }))
    })
  }
}

describe('CurvesEditor undo steps', () => {
  it('D2-F04: a curve-point drag of 100 frames is one undo step', () => {
    const xs = Array.from({ length: 100 }, (_, i) => 60 + (i % 40) * 3)
    dragPoint(0, xs)
    expect(useDocStore.getState().interaction.key).toBe('curves:point')
    act(() => {
      svg().dispatchEvent(pointerEvent('pointerup'))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    expect(past()).toBe(1)
    act(() => useDocStore.getState().undo())
    expect(useDocStore.getState().present.curves.rgb).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
  })

  it('closes the span when the pointer leaves the graph and on pointercancel', () => {
    dragPoint(0, [100])
    act(() => {
      // React synthesises onPointerLeave from `pointerout`.
      svg().dispatchEvent(pointerEvent('pointerout'))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    expect(past()).toBe(1)

    dragPoint(0, [120])
    act(() => {
      svg().dispatchEvent(pointerEvent('pointercancel'))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    expect(past()).toBe(2)
  })

  it('D2-F06: switching tools mid-drag closes the span instead of freezing undo', () => {
    dragPoint(0, [100, 110])
    expect(useDocStore.getState().interaction.key).toBe('curves:point')
    harness.unmount()
    expect(useDocStore.getState().interaction.key).toBeNull()
    useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    expect(past()).toBe(2)
    useDocStore.getState().undo()
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
  })

  it('a double-tap that adds a point is a single step', () => {
    act(() => {
      svg().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 130, clientY: 130 }))
    })
    expect(past()).toBe(1)
    expect(useDocStore.getState().present.curves.rgb).toHaveLength(3)
  })
})

describe('D8-F10: the curve graph is operable without a pointer', () => {
  const key = (target: Element, init: KeyboardEventInit) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
      )
    })

  const curve = () => useDocStore.getState().present.curves.rgb
  const point = (index: number) =>
    svg().querySelectorAll('circle[role="button"]')[index] as SVGCircleElement

  it('does not declare role="application", which suppressed the screen reader', () => {
    expect(svg().getAttribute('role')).toBe('group')
    expect(svg().getAttribute('tabindex')).toBe('0')
    expect(svg().getAttribute('aria-label')).toMatch(/curves/i)
  })

  it('every point is a focusable button that names its own position', () => {
    const points = svg().querySelectorAll('circle[role="button"]')
    expect(points).toHaveLength(2)
    for (const node of points) {
      expect(node.getAttribute('tabindex')).toBe('0')
      expect(node.getAttribute('aria-label')).toMatch(/input \d+, output \d+/)
    }
    // The end points cannot be removed, so they must not offer it.
    expect(point(0).getAttribute('aria-label')).not.toMatch(/Delete to remove/)
    expect(point(1).getAttribute('aria-label')).not.toMatch(/Delete to remove/)
  })

  it('Enter on the graph adds a point and hands focus to it', () => {
    key(svg(), { key: 'Enter' })
    expect(curve()).toHaveLength(3)
    expect(curve()[1]).toEqual({ x: 128, y: 128 })
  })

  it('the arrow keys nudge a point, and each press is its own undo step', () => {
    key(svg(), { key: 'Enter' })
    const pastAfterAdd = past()
    key(point(1), { key: 'ArrowUp' })
    key(point(1), { key: 'ArrowUp' })
    key(point(1), { key: 'ArrowUp' })
    expect(curve()[1]).toEqual({ x: 128, y: 131 })
    expect(past()).toBe(pastAfterAdd + 3)
    for (let i = 0; i < 3; i++) useDocStore.getState().undo()
    expect(curve()[1]).toEqual({ x: 128, y: 128 })
  })

  it('Shift makes a nudge coarse, and the axis follows the arrow', () => {
    key(svg(), { key: 'Enter' })
    key(point(1), { key: 'ArrowRight', shiftKey: true })
    expect(curve()[1]).toEqual({ x: 138, y: 128 })
    key(point(1), { key: 'ArrowDown', shiftKey: true })
    expect(curve()[1]).toEqual({ x: 138, y: 118 })
  })

  it('Delete removes an interior point and refuses to remove an end point', () => {
    key(svg(), { key: 'Enter' })
    key(point(0), { key: 'Delete' })
    expect(curve()).toHaveLength(3)
    key(point(1), { key: 'Delete' })
    expect(curve()).toHaveLength(2)
  })

  it('a nudge stops at the ends of the value range instead of wrapping', () => {
    key(svg(), { key: 'Enter' })
    for (let i = 0; i < 5; i++) key(point(0), { key: 'ArrowUp', shiftKey: true })
    expect(curve()[0]).toEqual({ x: 0, y: 50 })
    expect(curve()[0].y).toBeLessThanOrEqual(255)
  })

  it('the graph key handler stops the key reaching the global Enter shortcut', () => {
    const seen = vi.fn()
    window.addEventListener('keydown', seen)
    key(svg(), { key: 'Enter' })
    // The global handler binds `Enter` to "close the tool"; it listens on
    // `window`, so a handled key that did not stop propagation would close the
    // panel out from under the edit.
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener('keydown', seen)
  })

  it('a focused point is visible', () => {
    // `.curvePoint:focus-visible` has its outline removed in the stylesheet, so
    // the ring element is the *only* thing that says which point the arrow keys
    // will move. React's `onFocus` is the native `focusin` and bubbles, so an
    // unguarded handler on the <svg> used to overwrite the index the point had
    // just set and the ring never rendered: a keyboard user nudged points
    // blind.
    act(() => point(0).focus())
    expect(svg().querySelector('[data-focus-ring]')).not.toBeNull()
    act(() => point(1).focus())
    const ring = svg().querySelector('[data-focus-ring]') as SVGCircleElement | null
    expect(ring).not.toBeNull()
    // The ring tracks the point that actually holds focus, not the first one.
    expect(Number(ring?.getAttribute('cy'))).toBeCloseTo(Number(point(1).getAttribute('cy')), 6)
  })

  it('the ring goes away when focus leaves the graph', () => {
    act(() => point(0).focus())
    expect(svg().querySelector('[data-focus-ring]')).not.toBeNull()
    act(() => point(0).blur())
    expect(svg().querySelector('[data-focus-ring]')).toBeNull()
  })

  it('the ring is hidden from assistive tech, since the point already names itself', () => {
    act(() => point(0).focus())
    const ring = svg().querySelector('[data-focus-ring]')
    expect(ring?.getAttribute('aria-hidden')).toBe('true')
  })
})

/**
 * The graph used to draw one `<path>` — the selected channel's — and the
 * channels were coloured from a table in this file that `Histogram` did not
 * share, so "the red curve" and the red histogram were two different reds and
 * nothing could have noticed.
 */
describe('every channel is drawn, in the colour its chip carries', () => {
  const curves = () =>
    Array.from(svg().querySelectorAll<SVGPathElement>('path[data-curve-channel]'))
  const chip = (name: string) => {
    const found = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>('[role="group"] button'),
    ).find((button) => button.textContent?.trim() === name)
    if (!found) throw new Error(`no channel chip named ${name}`)
    return found
  }
  const select = (name: string) => act(() => chip(name).click())

  it('draws all four channels at once, not just the selected one', () => {
    expect(curves().map((node) => node.getAttribute('data-curve-channel'))).toHaveLength(4)
    expect(new Set(curves().map((node) => node.getAttribute('data-curve-channel'))).size).toBe(4)
  })

  it('takes every stroke from the table the histogram reads, so the two cannot drift', () => {
    for (const node of curves()) {
      const channel = node.getAttribute('data-curve-channel') as keyof typeof TONAL_CURVE_COLORS
      expect(node.getAttribute('stroke'), channel).toBe(TONAL_CURVE_COLORS[channel])
    }
    // The claim is about a *shared* source, so assert the shared-ness: a stroke
    // can only equal the table if the table is where it came from.
    expect(Object.keys(TONAL_CURVE_COLORS).sort()).toEqual(['b', 'g', 'r', 'rgb'])
  })

  /** jsdom rewrites `background: #ffffff` as `rgb(255, 255, 255)`. */
  function asHex(css: string): string {
    const rgbMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)
    if (!rgbMatch) return css.toLowerCase()
    const [, r, g, b] = rgbMatch
    return `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
  }

  const CHIP_CHANNEL: Record<string, keyof typeof TONAL_CURVE_COLORS> = {
    RGB: 'rgb',
    Red: 'r',
    Green: 'g',
    Blue: 'b',
  }

  it('paints a channel dot the same colour as that channel curve', () => {
    for (const [name, channel] of Object.entries(CHIP_CHANNEL)) {
      const dot = chip(name).querySelector('span') as HTMLElement
      const curve = curves().find((node) => node.getAttribute('data-curve-channel') === channel)
      // One source, one string: the dot on a chip and the line that chip selects
      // cannot be two different colours for the same channel.
      expect(asHex(dot.style.background), name).toBe(TONAL_CURVE_COLORS[channel])
      expect(curve?.getAttribute('stroke'), name).toBe(TONAL_CURVE_COLORS[channel])
    }
  })

  it('makes the active channel findable without colour: thicker, opaque, last', () => {
    select('Green')
    const active = curves().filter((node) => node.getAttribute('data-curve-active') === 'true')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('data-curve-channel')).toBe('g')
    expect(Number(active[0].getAttribute('stroke-width'))).toBeGreaterThan(
      Number(curves()[0].getAttribute('stroke-width')),
    )
    expect(Number(active[0].getAttribute('stroke-opacity'))).toBe(1)
    for (const node of curves().filter((n) => n.getAttribute('data-curve-active') === 'false')) {
      expect(
        Number(node.getAttribute('stroke-opacity')),
        node.getAttribute('stroke') ?? '',
      ).toBeLessThan(1)
    }
    // Painted last, so where two curves coincide the selected one is the line on
    // top rather than the one underneath.
    expect(curves()[curves().length - 1].getAttribute('data-curve-active')).toBe('true')
  })

  it('moves the emphasis when the channel changes, and keeps the chip pressed', () => {
    select('Blue')
    const active = curves().find((node) => node.getAttribute('data-curve-active') === 'true')
    expect(active?.getAttribute('data-curve-channel')).toBe('b')
    expect(active?.getAttribute('stroke')).toBe(TONAL_CURVE_COLORS.b)
    expect(chip('Blue').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Green').getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps the chip colour out of the accessible name', () => {
    for (const name of ['RGB', 'Red', 'Green', 'Blue']) {
      const dot = chip(name).querySelector('span') as HTMLElement
      expect(dot.getAttribute('aria-hidden'), name).toBe('true')
      expect(chip(name).getAttribute('aria-label'), name).toBeNull()
      expect(chip(name).textContent?.trim(), name).toBe(name)
    }
  })

  it('is one tab stop, and the arrow keys move selection, tab stop and focus', () => {
    const chips = () =>
      Array.from(harness.container.querySelectorAll<HTMLButtonElement>('[role="group"] button'))
    expect(chips().filter((button) => button.tabIndex === 0)).toHaveLength(1)
    expect(chips()[0].tabIndex).toBe(0)
    act(() => {
      chips()[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
    })
    expect(chip('Red').getAttribute('aria-pressed')).toBe('true')
    expect(chip('Red').tabIndex).toBe(0)
    expect(document.activeElement).toBe(chip('Red'))
  })

  it('leaves the point handles on the selected channel, so only those are editable', () => {
    select('Green')
    expect(svg().querySelectorAll('circle[role="button"]')).toHaveLength(2)
    for (const node of Array.from(svg().querySelectorAll('circle[role="button"]'))) {
      expect(node.getAttribute('aria-label')).toMatch(/^Green curve point/)
    }
    // The graph's own label follows the channel too, so a screen-reader user
    // knows which curve the arrows are about to move.
    expect(svg().getAttribute('aria-label')).toMatch(/^Green curves/)
  })

  it('still edits a curve with the keyboard alone after switching channels', () => {
    const key = (target: Element, init: KeyboardEventInit) =>
      act(() => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
        )
      })
    select('Red')
    key(svg(), { key: 'Enter' })
    const points = svg().querySelectorAll('circle[role="button"]')
    expect(points).toHaveLength(3)
    key(points[1], { key: 'ArrowUp' })
    key(points[1], { key: 'ArrowUp' })
    expect(useDocStore.getState().present.curves.r[1]).toEqual({ x: 128, y: 130 })
    // And the composite curve was left alone, which is what "on the selected
    // channel" has to mean.
    expect(useDocStore.getState().present.curves.rgb).toHaveLength(2)
  })
})
