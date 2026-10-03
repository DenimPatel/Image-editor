import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness } from '../../store/testHarness'
import Onboarding from './Onboarding'
import { ONBOARDING_KEY } from './onboardingKeys'
import { cdnDisclosure } from './privacy'

const harness = createHarness()

const panel = () => harness.container.querySelector('[role="dialog"]') as HTMLElement | null
const trigger = () =>
  harness.container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
const gotIt = () =>
  Array.from(harness.container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Got it',
  )

const key = (name: string, init: KeyboardEventInit = {}) =>
  act(() => {
    ;(document.activeElement ?? harness.container).dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }),
    )
  })

const render = () =>
  act(() => {
    harness.render(<Onboarding />)
  })

/** Unmount and mount again: the only honest way to say "a reload". */
const reload = () => {
  harness.unmount()
  render()
}

beforeEach(() => {
  window.localStorage.clear()
  render()
})

afterEach(() => harness.unmount())

describe('the orientation appears exactly once', () => {
  it('is open on a first run, and closed once it has been answered', () => {
    expect(panel()).not.toBeNull()

    act(() => {
      gotIt()?.click()
    })
    expect(panel()).toBeNull()
    expect(window.localStorage.getItem(ONBOARDING_KEY)).not.toBeNull()
  })

  it('does not come back on a reload', () => {
    act(() => {
      gotIt()?.click()
    })
    reload()
    expect(panel()).toBeNull()
  })

  it('does not come back when it was closed with Escape', () => {
    key('Escape')
    expect(panel()).toBeNull()
    reload()
    expect(panel()).toBeNull()
  })

  it('comes back only when it is asked for', () => {
    act(() => {
      gotIt()?.click()
    })
    const opener = trigger()
    expect(opener).not.toBeNull()
    expect(opener?.textContent).toBe('How this editor works')
    expect(opener?.getAttribute('aria-expanded')).toBe('false')

    act(() => {
      opener?.click()
    })
    expect(panel()).not.toBeNull()
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('a returning visitor is not thrown back into it', () => {
    markSeen()
    reload()
    expect(panel()).toBeNull()
    // And the trigger must not steal the document's focus on mount, which is
    // what would make a screen reader start somewhere nobody chose.
    expect(document.activeElement).not.toBe(trigger())
  })
})

function markSeen() {
  window.localStorage.setItem(ONBOARDING_KEY, '1')
}

describe('the orientation is operable with a keyboard alone', () => {
  it('takes focus when it opens, so Escape and Tab land somewhere', () => {
    expect(document.activeElement).toBe(panel())
  })

  it('closes on Escape', () => {
    key('Escape')
    expect(panel()).toBeNull()
  })

  it('closes on Escape even once focus has left the panel', () => {
    // The listener is on the document rather than on the panel, because a user
    // who clicks the background and then presses Escape is still inside a modal
    // that owns the whole viewport. With the handler on the scrim that keypress
    // is delivered to whatever is behind it and the panel stays open.
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    expect(panel()).toBeNull()
  })

  it('gives focus back to the way back in, on the way out', () => {
    key('Escape')
    expect(document.activeElement).toBe(trigger())
  })

  it('keeps Tab inside the panel instead of letting it reach the screen behind', () => {
    const stop = gotIt()
    expect(stop).toBeDefined()

    // Forward from the only stop wraps back to it rather than escaping.
    act(() => {
      stop?.focus()
    })
    key('Tab')
    expect(document.activeElement).toBe(stop)

    // Backward from the panel itself wraps forward to it, which is the other
    // half of the same cycle.
    act(() => {
      panel()?.focus()
    })
    key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(stop)
  })

  it('says what it is, and names the exception in the same breath', () => {
    const text = panel()?.textContent ?? ''
    expect(text).toContain('Before you start')
    expect(text).toContain('It runs in this tab.')
    expect(text).toContain('Every edit is reversible.')
    expect(text).toContain('Looks are settings, not filters.')
    expect(text).toContain('Export is the only destructive step.')
    expect(text).toContain(cdnDisclosure())
  })
})
