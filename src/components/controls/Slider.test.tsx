import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import { setAdjust } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { COALESCE_MS } from '../../store/history'
import { createHarness, pointerEvent, resetStores, setNativeValue } from '../../store/testHarness'
import { Slider } from './Slider'

const harness = createHarness()
const input = () => harness.container.querySelector('input[type="range"]') as HTMLInputElement

function fireChange(value: number) {
  act(() => {
    setNativeValue(input(), String(value))
    input().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function pointerDown() {
  act(() => {
    input().dispatchEvent(pointerEvent('pointerdown'))
  })
}

function pointerUp(type = 'pointerup') {
  act(() => {
    input().dispatchEvent(pointerEvent(type))
  })
}

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
  harness.render(
    <Slider
      label="Exposure"
      value={0}
      min={-2}
      max={2}
      onChange={(value) => setAdjust('exposure', value)}
    />,
  )
})

describe('Slider undo bracketing', () => {
  it('D2-F04: 30 change events between one pointerdown and pointerup are one undo step', () => {
    pointerDown()
    for (let i = 1; i <= 30; i += 1) fireChange(i / 30)
    pointerUp()
    const state = useDocStore.getState()
    expect(state.past).toHaveLength(1)
    expect(state.interaction.key).toBeNull()
    act(() => state.undo())
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
  })

  it('D2-F04: a ten-second drag is still one undo step, not a dozen', () => {
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(0)
      setAdjust('exposure', 1)
      expect(useDocStore.getState().past).toHaveLength(1)
      pointerDown()
      // 100 frames spread over 10 s: the 600 ms implicit window alone would
      // split this into ~17 undo steps, so only the interaction span holds it
      // together.
      for (let i = 1; i <= 100; i += 1) {
        now.mockReturnValue(i * 100)
        fireChange(i / 100)
      }
      pointerUp()
    } finally {
      now.mockRestore()
    }
    expect(useDocStore.getState().past).toHaveLength(2)
  })

  it('D2-F04: 100 change events outside any interaction coalesce on the 600 ms window', () => {
    const start = Date.now()
    for (let i = 1; i <= 100; i += 1) fireChange(i / 100)
    // A synchronous loop lands well inside the window, so it is one step; the
    // test asserts the bound rather than the wall clock.
    expect(Date.now() - start).toBeLessThan(COALESCE_MS * 100)
    expect(useDocStore.getState().past.length).toBeLessThanOrEqual(1)
  })

  it('opens the span for a held arrow key and closes it on keyup', () => {
    act(() => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(useDocStore.getState().interaction.key).toBe('slider:Exposure')
    fireChange(1)
    act(() => {
      input().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    expect(useDocStore.getState().past).toHaveLength(1)
  })

  it('closes the span on pointercancel', () => {
    pointerDown()
    expect(useDocStore.getState().interaction.key).not.toBeNull()
    pointerUp('pointercancel')
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('closes the span on lost pointer capture', () => {
    pointerDown()
    act(() => {
      input().dispatchEvent(new Event('lostpointercapture', { bubbles: true }))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('closes the span on blur', () => {
    pointerDown()
    act(() => {
      input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('D2-F06: unmounting mid-drag closes the span instead of freezing undo', () => {
    pointerDown()
    fireChange(1)
    expect(useDocStore.getState().interaction.key).not.toBeNull()
    harness.unmount()
    expect(useDocStore.getState().interaction.key).toBeNull()
    setAdjust('warmth', 10)
    expect(useDocStore.getState().past).toHaveLength(2)
    useDocStore.getState().undo()
    expect(useDocStore.getState().present.adjust.warmth).toBe(0)
  })

  it('uses the supplied interaction key', () => {
    harness.unmount()
    harness.render(
      <Slider
        label="Hue"
        value={0}
        min={-30}
        max={30}
        interactionKey="hsl:red:hue"
        onChange={() => undefined}
      />,
    )
    pointerDown()
    expect(useDocStore.getState().interaction.key).toBe('hsl:red:hue')
  })

  it('clamps to min/max before it reaches the store', () => {
    act(() => {
      setNativeValue(input(), '99')
      input().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(useDocStore.getState().present.adjust.exposure).toBe(2)
  })

  it('is inert when the recipe is a no-op', () => {
    useDocStore.getState().load(createDoc())
    const revision = useDocStore.getState().revision
    fireChange(0)
    expect(useDocStore.getState().revision).toBe(revision)
  })
})
