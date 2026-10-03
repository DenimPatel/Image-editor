import { act, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { setAdjust, toggleFlipH } from '../store/actions'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { createHarness, resetStores } from '../store/testHarness'
import { useKeyboardShortcuts, type ShortcutHandlers } from './useKeyboardShortcuts'

const harness = createHarness()

type HandlerMocks = {
  onExport: Mock<() => void>
  onCommit: Mock<() => void>
  onCancel: Mock<() => void>
}

function spyHandlers(): HandlerMocks {
  return {
    onExport: vi.fn(() => undefined),
    onCommit: vi.fn(() => undefined),
    onCancel: vi.fn(() => undefined),
  }
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }))
  })
}

function release(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
  })
}

function typedArea() {
  const area = document.createElement('textarea')
  harness.container.appendChild(area)
  return area
}

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
})

describe('modifier shortcuts versus typing targets', () => {
  it('D8-F08: ⌘Z in a focused textarea does not run the app undo', () => {
    setAdjust('exposure', 1)
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const area = typedArea()
    act(() => {
      area.focus()
    })
    press('z', { metaKey: true }, area)
    expect(useDocStore.getState().past).toHaveLength(1)
    expect(useDocStore.getState().present.adjust.exposure).toBe(1)
  })

  it('D8-F08: ⌘S in a focused textarea does not open the export sheet', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const area = typedArea()
    act(() => {
      area.focus()
    })
    press('s', { metaKey: true }, area)
    expect(handlers.onExport).not.toHaveBeenCalled()
  })

  it('D8-F08: Ctrl+Z and Ctrl+S in a text input stay the browser’s', () => {
    setAdjust('exposure', 1)
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const input = document.createElement('input')
    input.type = 'text'
    harness.container.appendChild(input)
    act(() => {
      input.focus()
    })
    press('z', { ctrlKey: true }, input)
    expect(useDocStore.getState().past).toHaveLength(1)
    press('s', { ctrlKey: true }, input)
    expect(handlers.onExport).not.toHaveBeenCalled()
  })

  it('does not fire ⌘Z in a contenteditable div', () => {
    setAdjust('exposure', 1)
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const div = document.createElement('div')
    div.contentEditable = 'true'
    Object.defineProperty(div, 'isContentEditable', { value: true })
    harness.container.appendChild(div)
    press('z', { metaKey: true }, div)
    expect(useDocStore.getState().past).toHaveLength(1)
  })

  it('still undoes when a range slider holds focus — it has no text to undo', () => {
    setAdjust('exposure', 1)
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const range = document.createElement('input')
    range.type = 'range'
    harness.container.appendChild(range)
    act(() => {
      range.focus()
    })
    press('z', { metaKey: true }, range)
    expect(useDocStore.getState().past).toHaveLength(0)
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
  })

  it('undoes and redoes with no focused field at all', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    setAdjust('exposure', 2)
    expect(useDocStore.getState().past).toHaveLength(1)
    press('z', { metaKey: true })
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
    expect(useDocStore.getState().past).toHaveLength(0)
    press('z', { metaKey: true, shiftKey: true })
    expect(useDocStore.getState().present.adjust.exposure).toBe(2)
    expect(useDocStore.getState().future).toHaveLength(0)
  })

  it('opens the export sheet with ⌘S outside a text field', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('s', { metaKey: true })
    expect(handlers.onExport).toHaveBeenCalledTimes(1)
  })
})

describe('single-key shortcuts', () => {
  it('switches tools and rotates and flips', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('a')
    expect(useUiStore.getState().activeTool).toBe('adjust')
    press(']')
    expect(useDocStore.getState().present.geometry.orientation.quarterTurns).toBe(1)
    press('f')
    expect(useDocStore.getState().present.geometry.orientation.flipH).toBe(true)
    toggleFlipH()
  })

  it('ignores single keys while a text field has focus', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const area = typedArea()
    press('a', {}, area)
    expect(useUiStore.getState().activeTool).toBeNull()
  })
})

describe('escape', () => {
  it('cancels and closes a leaked interaction so undo works again', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    useDocStore.getState().beginInteraction('stuck')
    useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, exposure: 1 } }))
    expect(useDocStore.getState().interaction.key).toBe('stuck')

    press('Escape')
    expect(handlers.onCancel).toHaveBeenCalledTimes(1)
    expect(handlers.onCommit).not.toHaveBeenCalled()
    expect(useDocStore.getState().interaction.key).toBeNull()

    setAdjust('warmth', 5)
    expect(useDocStore.getState().past).toHaveLength(2)
  })

  it('works while a range slider has focus', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const range = document.createElement('input')
    range.type = 'range'
    harness.container.appendChild(range)
    press('Escape', {}, range)
    expect(handlers.onCancel).toHaveBeenCalledTimes(1)
  })

  it('Enter commits and does not cancel', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('Enter')
    expect(handlers.onCommit).toHaveBeenCalledTimes(1)
    expect(handlers.onCancel).not.toHaveBeenCalled()
  })

  it('Enter on a control that activates itself is left to that control', () => {
    // The reported bug. The global Enter binding ran first, closed the open
    // tool, and the sheet's restore-focus moved focus back to the tab that had
    // opened it — so the browser then delivered the Enter *click* to the old
    // tab. Pressing Enter on "Adjust" while Crop was open gave you Crop again.
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const button = document.createElement('button')
    harness.container.appendChild(button)
    act(() => button.focus())
    press('Enter', {}, button)
    expect(handlers.onCommit).not.toHaveBeenCalled()
  })

  it('Enter on a role=button is left to that control', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const custom = document.createElement('div')
    custom.setAttribute('role', 'button')
    custom.tabIndex = 0
    harness.container.appendChild(custom)
    act(() => custom.focus())
    press('Enter', {}, custom)
    expect(handlers.onCommit).not.toHaveBeenCalled()
  })

  it('the guarded keys still fire from a non-interactive element', () => {
    // Only Enter is guarded. `0`, `1`, `[`, `]`, `f` and the tool letters are
    // meant to work from anywhere, and the shortcut sheet says so.
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const div = document.createElement('div')
    div.tabIndex = -1
    harness.container.appendChild(div)
    act(() => div.focus())
    press('Enter', {}, div)
    expect(handlers.onCommit).toHaveBeenCalledTimes(1)
  })

  it('does not escape out of a textarea', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    const area = typedArea()
    press('Escape', {}, area)
    expect(handlers.onCancel).not.toHaveBeenCalled()
  })
})

describe('compare-original hold', () => {
  it('holds on keydown and releases on keyup', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('\\')
    expect(useUiStore.getState().compareHeld).toBe(true)
    release('\\')
    expect(useUiStore.getState().compareHeld).toBe(false)
  })

  it('releases when the window loses focus mid-hold', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('\\')
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(useUiStore.getState().compareHeld).toBe(false)
  })

  it('releases when the tab is hidden mid-hold', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('\\')
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(useUiStore.getState().compareHeld).toBe(false)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('releases on escape', () => {
    const handlers = spyHandlers()
    harness.render(<Host handlers={handlers} />)
    press('\\')
    press('Escape')
    expect(useUiStore.getState().compareHeld).toBe(false)
  })
})

describe('subscription stability', () => {
  it('keeps exactly one keydown listener across re-renders', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    harness.render(<ResigningHost />)
    const keydownAdds = add.mock.calls.filter(([type]) => type === 'keydown')
    expect(keydownAdds).toHaveLength(1)
    const before = keydownAdds[0][1] as EventListener
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        harness.render(<ResigningHost tick={i} />)
      })
    }
    const keydownRemoves = remove.mock.calls.filter(([type]) => type === 'keydown')
    expect(keydownRemoves).toHaveLength(0)
    // The listener that is installed still works after five re-renders.
    press('a')
    expect(useUiStore.getState().activeTool).toBe('adjust')
    expect(before).toBeDefined()
  })

  it('calls the newest handler closure without resubscribing', () => {
    const first = spyHandlers()
    const second = spyHandlers()
    harness.render(<Host handlers={first} />)
    act(() => {
      harness.render(<Host handlers={second} />)
    })
    press('s', { metaKey: true })
    expect(first.onExport).not.toHaveBeenCalled()
    expect(second.onExport).toHaveBeenCalledTimes(1)
  })
})

function Host({ handlers }: { handlers: ShortcutHandlers }) {
  useKeyboardShortcuts(handlers)
  return <div>host</div>
}

/** Re-renders with fresh closures and fresh handler objects, like `Editor`. */
function ResigningHost({ tick = 0 }: { tick?: number }) {
  const [count, setCount] = useState(0)
  useKeyboardShortcuts({
    onExport: () => setCount(count + 1),
    onCommit: () => setCount(count + 1),
    onCancel: () => setCount(count + 1),
  })
  return <div data-testid="tick">{tick + count}</div>
}
