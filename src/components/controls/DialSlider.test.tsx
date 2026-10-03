import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAdjust } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { createHarness, pointerEvent, resetStores } from '../../store/testHarness'
import { DialSlider } from './DialSlider'

const harness = createHarness()

const key = (name: string, init: { shiftKey?: boolean } = {}) =>
  new KeyboardEvent('keydown', { key: name, bubbles: true, shiftKey: init.shiftKey })

const dial = () => harness.container.querySelector('[role="slider"]') as HTMLElement

const past = () => useDocStore.getState().past.length

/**
 * The dial is controlled, so the test has to be too: the store is the single
 * source of truth and the panel feeds the committed value straight back in.
 * The interaction props are wired the way `AdjustPanel` wires them, because
 * that wiring *is* the thing under test.
 */
function ExposureDial(props: { onInteractionStart?: () => void; onInteractionEnd?: () => void }) {
  const [value, setValue] = useState(0)
  return (
    <DialSlider
      label="Exposure"
      value={value}
      min={-100}
      max={100}
      onChange={(next) => {
        setValue(next)
        setAdjust('exposure', next)
      }}
      onInteractionStart={() => {
        useDocStore.getState().beginInteraction('dial:exposure')
        props.onInteractionStart?.()
      }}
      onInteractionEnd={() => {
        useDocStore.getState().endInteraction()
        props.onInteractionEnd?.()
      }}
    />
  )
}

// The harness reuses one root, and the controlled value lives in component
// state, so the tree has to come down between tests.
afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
  act(() => {
    harness.render(<ExposureDial />)
  })
})

describe('D2-F04: the keyboard path is one undo span', () => {
  it('a held arrow key is one step, not one step per repeat', () => {
    const track = dial()
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        track.dispatchEvent(key('ArrowRight'))
      })
    }
    expect(useDocStore.getState().present.adjust.exposure).toBe(30)
    expect(past()).toBe(1)
  })

  it('keyup closes the span, so the next key is a new step', () => {
    const track = dial()
    act(() => {
      track.dispatchEvent(key('ArrowRight'))
    })
    act(() => {
      track.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    act(() => {
      track.dispatchEvent(key('ArrowRight'))
    })
    expect(past()).toBe(2)
  })

  it('losing focus closes the span too, so no interaction is left open', () => {
    const track = dial()
    act(() => {
      track.dispatchEvent(key('ArrowRight'))
    })
    act(() => {
      track.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    act(() => {
      useDocStore.getState().update(() => useDocStore.getState().present)
    })
    const next = dial()
    act(() => {
      next.dispatchEvent(key('ArrowLeft'))
    })
    expect(past()).toBe(2)
  })

  it('one span undoes the whole held run', () => {
    const track = dial()
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        track.dispatchEvent(key('ArrowUp'))
      })
    }
    act(() => {
      useDocStore.getState().undo()
    })
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
  })

  it('a pointer drag is still one step', () => {
    const track = dial()
    act(() => {
      track.dispatchEvent(pointerEvent('pointerdown', { clientX: 100 }))
    })
    for (let x = 104; x < 140; x += 4) {
      act(() => {
        track.dispatchEvent(pointerEvent('pointermove', { clientX: x }))
      })
    }
    act(() => {
      track.dispatchEvent(pointerEvent('pointerup', { clientX: 140 }))
    })
    expect(past()).toBe(1)
  })

  it('a key the dial does not handle changes nothing and opens nothing', () => {
    const revision = useDocStore.getState().revision
    act(() => {
      dial().dispatchEvent(key('a'))
    })
    expect(useDocStore.getState().revision).toBe(revision)
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('PageUp and Home still work, inside the same span', () => {
    const track = dial()
    act(() => {
      track.dispatchEvent(key('PageUp'))
    })
    expect(useDocStore.getState().present.adjust.exposure).toBe(10)
    act(() => {
      track.dispatchEvent(key('Home'))
    })
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
    expect(past()).toBe(1)
  })
})

describe('the keyboard path drives the store, not the component', () => {
  it('a spy sees the interaction bracketing a key press', () => {
    const events: string[] = []
    act(() => {
      harness.render(
        <ExposureDial
          onInteractionStart={() => events.push('start')}
          onInteractionEnd={() => events.push('end')}
        />,
      )
    })
    const track = dial()
    act(() => {
      track.dispatchEvent(key('ArrowRight'))
      track.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    expect(events).toEqual(['start', 'end'])
  })
})
