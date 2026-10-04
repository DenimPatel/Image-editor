import { act, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness } from '../store/testHarness'
import { measureScrollEdges, useScrollEdges, type ScrollEdges } from './useScrollEdges'

/**
 * The measurement behind every edge fade in the product — the chip rows and the
 * tool tab bar — pinned once, in the one place that owns it.
 *
 * It used to live inside `ChipRowShell`, which is how a scroller ends up with
 * two fades and one of them quietly wrong: the tool tab bar has its own copy
 * now, with two edges rather than one, and nothing but this test standing
 * between the two.
 *
 * jsdom computes no layout, so every number below is *given* to a real element
 * rather than measured from one, exactly as `ChipRow.test.tsx` does it.
 */

const harness = createHarness()

/** The three answers, from the three numbers a browser would have measured. */
function read({ client, scroll, left = 0 }: { client: number; scroll: number; left?: number }) {
  return measureScrollEdges({
    clientWidth: client,
    scrollWidth: scroll,
    scrollLeft: left,
  } as Element)
}

/** A mounted scroller with the hook on it, which is how the wiring is proved. */
function Probe() {
  const ref = useRef<HTMLDivElement>(null)
  const { overflowing, beforeStart, afterEnd } = useScrollEdges(ref, 'never-changes')
  return (
    <div
      ref={ref}
      data-overflowing={String(overflowing)}
      data-before-start={String(beforeStart)}
      data-after-end={String(afterEnd)}
    />
  )
}

const STILL: ScrollEdges = { overflowing: false, beforeStart: false, afterEnd: false }

function row(): HTMLElement {
  return harness.container.querySelector('div') as HTMLElement
}

function flags(): ScrollEdges {
  const el = row()
  return {
    overflowing: el.dataset.overflowing === 'true',
    beforeStart: el.dataset.beforeStart === 'true',
    afterEnd: el.dataset.afterEnd === 'true',
  }
}

/** Give the mounted row a geometry and fire what a browser would fire. */
function lay(row: HTMLElement, over: { client: number; scroll: number; left?: number }) {
  for (const [name, value] of [
    ['clientWidth', over.client],
    ['scrollWidth', over.scroll],
    ['scrollLeft', over.left ?? 0],
  ]) {
    Object.defineProperty(row, name, { value, configurable: true, writable: true })
  }
  act(() => {
    row.dispatchEvent(new Event('scroll'))
  })
}

beforeEach(() => {
  harness.render(<Probe />)
})

afterEach(() => harness.unmount())

describe('measuring a scroller', () => {
  it('reports no edges at all for a row that fits', () => {
    expect(read({ client: 300, scroll: 300 })).toEqual(STILL)
    // Content narrower than the box is the same answer, not an error case.
    expect(read({ client: 300, scroll: 120 }).overflowing).toBe(false)
  })

  it('ignores an overflow no person could see', () => {
    // A row one pixel wider than its box is not a scroller, and fading it says
    // there is more when scrolling stops. The tolerance is 1px because
    // `scrollWidth` is a rounded layout number, so sub-pixel overflow is what it
    // rounds to — and the same tolerance has to apply at the far end, or the last
    // item is reported as still having something after it.
    expect(read({ client: 300, scroll: 301 }).overflowing).toBe(false)
    expect(read({ client: 300, scroll: 302 }).overflowing).toBe(true)
    // And the same tolerance at the far end, for the same reason: with 2px of
    // overflow, one pixel of scroll already counts as the end, so the last item
    // is never reported as having something after it.
    expect(read({ client: 300, scroll: 302, left: 0 }).afterEnd).toBe(false)
    expect(read({ client: 300, scroll: 302, left: 1 }).afterEnd).toBe(true)
  })

  it('fades the trailing edge only while there is more past it', () => {
    expect(read({ client: 100, scroll: 300 })).toEqual({
      overflowing: true,
      beforeStart: false,
      afterEnd: false,
    })
    expect(read({ client: 100, scroll: 300, left: 90 })).toEqual({
      overflowing: true,
      beforeStart: true,
      afterEnd: false,
    })
    // At the end the last item really is the last item, and a gradient over its
    // own label is a different defect rather than a milder one.
    expect(read({ client: 100, scroll: 300, left: 200 })).toEqual({
      overflowing: true,
      beforeStart: true,
      afterEnd: true,
    })
  })

  it('says nothing about the leading edge while the row is at its start', () => {
    expect(read({ client: 100, scroll: 300, left: 0 }).beforeStart).toBe(false)
    expect(read({ client: 100, scroll: 300, left: 1 }).beforeStart).toBe(false)
    expect(read({ client: 100, scroll: 300, left: 2 }).beforeStart).toBe(true)
  })
})

describe('the measurement inside a mounted scroller', () => {
  it('re-measures on scroll, which is the only event that changes the answer', () => {
    const el = row()
    expect(flags()).toEqual(STILL)

    lay(el, { client: 390, scroll: 897 })
    expect(flags()).toEqual({ overflowing: true, beforeStart: false, afterEnd: false })

    lay(el, { client: 390, scroll: 897, left: 250 })
    expect(flags()).toEqual({ overflowing: true, beforeStart: true, afterEnd: false })

    lay(el, { client: 390, scroll: 897, left: 507 })
    expect(flags()).toEqual({ overflowing: true, beforeStart: true, afterEnd: true })
  })

  it('stops answering once it is unmounted, rather than leaking the listener', () => {
    const el = row()
    lay(el, { client: 390, scroll: 897 })
    expect(flags().overflowing).toBe(true)

    harness.unmount()
    act(() => {
      el.dispatchEvent(new Event('scroll'))
    })
    // The row keeps the answer it was last rendered with; a leaked listener
    // would have re-run the measurement onto a component that is gone.
    expect(el.dataset.overflowing).toBe('true')
    expect(harness.container.querySelector('div')).toBeNull()
  })
})
