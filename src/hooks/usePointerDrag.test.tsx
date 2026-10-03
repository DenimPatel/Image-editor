import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { setAdjust } from '../store/actions'
import { useDocStore } from '../store/docStore'
import { createHarness, pointerEvent, resetStores } from '../store/testHarness'
import { usePointerDrag } from './usePointerDrag'

const harness = createHarness()

type Spy = { start: Mock; end: Mock; moves: Mock }

let spy: Spy = newSpy()

function newSpy(): Spy {
  return { start: vi.fn(), end: vi.fn(), moves: vi.fn() }
}

/** A control shaped like `DialSlider`: open an interaction, drive it, close it. */
function DragControl() {
  const { onPointerDown } = usePointerDrag({
    onStart: () => {
      spy.start()
      useDocStore.getState().beginInteraction('dial:exposure')
    },
    onMove: (_dx, _dy, event) => {
      spy.moves()
      setAdjust('exposure', (event.clientX ?? 0) / 100)
    },
    onEnd: () => {
      spy.end()
      useDocStore.getState().endInteraction()
    },
  })
  return (
    <button type="button" data-testid="dial" onPointerDown={onPointerDown}>
      dial
    </button>
  )
}

/** The tool switch: the panel that owns the dial leaves the tree mid-drag. */
function ToolHost() {
  const [tool, setTool] = useState('adjust')
  return (
    <div>
      <button
        type="button"
        data-testid="tool"
        onClick={() => setTool(tool === 'adjust' ? 'text' : 'adjust')}
      >
        {tool}
      </button>
      {tool === 'adjust' && <DragControl />}
    </div>
  )
}

const dial = () =>
  harness.container.querySelector('[data-testid="dial"]') as HTMLButtonElement | null

function pointerDown() {
  act(() => {
    dial()?.dispatchEvent(pointerEvent('pointerdown'))
  })
}

function pointerMove(clientX: number) {
  act(() => {
    dial()?.dispatchEvent(pointerEvent('pointermove', { clientX, clientY: clientX }))
  })
}

function pointerUp() {
  act(() => {
    dial()?.dispatchEvent(pointerEvent('pointerup'))
  })
}

function switchTool() {
  act(() => {
    ;(harness.container.querySelector('[data-testid="tool"]') as HTMLButtonElement).click()
  })
}

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
})

function setup(): Spy {
  spy = newSpy()
  harness.render(<ToolHost />)
  return spy
}

describe('usePointerDrag', () => {
  it('delivers start, moves and exactly one end', () => {
    const spy = setup()
    pointerDown()
    pointerMove(10)
    pointerMove(20)
    pointerUp()
    expect(spy.start).toHaveBeenCalledTimes(1)
    expect(spy.moves).toHaveBeenCalledTimes(2)
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('D2-F06: switching tools mid-drag fires onEnd and un-freezes undo', () => {
    const spy = setup()
    pointerDown()
    pointerMove(10)
    pointerMove(20)
    expect(useDocStore.getState().interaction.key).toBe('dial:exposure')
    expect(useDocStore.getState().past).toHaveLength(1)

    switchTool()

    // The catastrophe: without this, interaction.key stays non-null forever and
    // every later edit is swallowed into one undo step.
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(useDocStore.getState().interaction.key).toBeNull()

    setAdjust('warmth', 10)
    expect(useDocStore.getState().past).toHaveLength(2)
    useDocStore.getState().undo()
    expect(useDocStore.getState().present.adjust.warmth).toBe(0)
  })

  it('D2-F06: unmounting without any gesture never calls onEnd', () => {
    const spy = setup()
    act(() => {
      harness.unmount()
    })
    expect(spy.end).not.toHaveBeenCalled()
  })

  it('D2-F06: onEnd fires once even when a later pointerup arrives', () => {
    const spy = setup()
    pointerDown()
    switchTool()
    pointerUp()
    expect(spy.end).toHaveBeenCalledTimes(1)
  })

  it('ends the drag on window blur', () => {
    const spy = setup()
    pointerDown()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('ends the drag when the tab is hidden', () => {
    const spy = setup()
    pointerDown()
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(useDocStore.getState().interaction.key).toBeNull()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('ends the drag on lost pointer capture', () => {
    const spy = setup()
    pointerDown()
    act(() => {
      dial()?.dispatchEvent(new Event('lostpointercapture', { bubbles: true }))
    })
    expect(spy.end).toHaveBeenCalledTimes(1)
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('ends the drag on pointercancel', () => {
    const spy = setup()
    pointerDown()
    act(() => {
      dial()?.dispatchEvent(pointerEvent('pointercancel'))
    })
    expect(spy.end).toHaveBeenCalledTimes(1)
  })

  it('stops delivering moves after the drag ends', () => {
    const spy = setup()
    pointerDown()
    pointerUp()
    pointerMove(30)
    expect(spy.moves).not.toHaveBeenCalled()
  })

  it('ignores non-primary buttons and foreign pointer ids', () => {
    const spy = setup()
    act(() => {
      dial()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    })
    expect(spy.start).not.toHaveBeenCalled()
    pointerDown()
    act(() => {
      dial()?.dispatchEvent(pointerEvent('pointermove', { pointerId: 99, clientX: 5 }))
    })
    expect(spy.moves).not.toHaveBeenCalled()
    act(() => {
      dial()?.dispatchEvent(pointerEvent('pointerup', { pointerId: 99 }))
    })
    expect(spy.end).not.toHaveBeenCalled()
  })

  it('always calls the latest handler closure', () => {
    const first = vi.fn()
    const second = vi.fn()
    function Swapper() {
      const [swapped, setSwapped] = useState(false)
      const { onPointerDown } = usePointerDrag({
        onStart: swapped ? second : first,
        onMove: () => undefined,
        onEnd: () => undefined,
      })
      return (
        <div>
          <button type="button" data-testid="swap" onClick={() => setSwapped(true)}>
            swap
          </button>
          <button type="button" data-testid="dial" onPointerDown={onPointerDown}>
            dial
          </button>
        </div>
      )
    }
    harness.render(<Swapper />)
    pointerDown()
    act(() => {
      ;(harness.container.querySelector('[data-testid="swap"]') as HTMLButtonElement).click()
    })
    pointerDown()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
