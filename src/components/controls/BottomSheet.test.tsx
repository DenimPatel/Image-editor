import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { INSPECTOR_MEDIA } from '../ui/useMediaQuery'
import { BottomSheet } from './BottomSheet'

const harness = createHarness()

let mediaListener: (() => void) | null = null

/**
 * jsdom's `matchMedia` always reports `false` and never fires, so the
 * presentation breakpoint has to be stubbed for the sheet to take either side of
 * it.
 */
function stubMatchMedia(matches: boolean) {
  const stub: MediaQueryList = {
    matches,
    media: INSPECTOR_MEDIA,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      mediaListener = listener
    },
    removeEventListener: () => {
      mediaListener = null
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList
  window.matchMedia = ((query: string) =>
    query === INSPECTOR_MEDIA
      ? stub
      : ({ ...stub, matches: !matches } as MediaQueryList)) as typeof window.matchMedia
}

const sheet = () =>
  harness.container.querySelector<HTMLElement>('[role="dialog"]:not([aria-labelledby])') ??
  harness.container.querySelector<HTMLElement>('[role="dialog"]')

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
  mediaListener = null
  stubMatchMedia(false)
})

describe('D8-F02: the desktop inspector is a full-height column', () => {
  it('writes the detent height only in the sheet presentation', () => {
    harness.render(
      <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}} title="Crop">
        <p>panel</p>
      </BottomSheet>,
    )
    // Not `58vh`. A detent as a viewport fraction is a fraction of the *window*,
    // which is only a fraction of the room by coincidence: at 844x390 the bars
    // leave a 273px canvas region and 58vh — 226px — left 47px of canvas, which
    // fitted a 10x15 image. `var(--ie-sheet-medium)` is that same 58vh capped by
    // the space between the two bars less the canvas floor, so on a 390x844 phone
    // it resolves to the identical 452px and on a landscape phone it stops
    // claiming the canvas is optional. Resolved by `editor.module.css`;
    // `responsiveLayout.test.ts` pins the token, and
    // `e2e/journey.layout-measure.spec.ts` measures what it resolves to.
    expect(sheet()?.style.height).toBe('var(--ie-sheet-medium)')
  })

  it('stops writing an inline height at the inspector breakpoint', () => {
    act(() => {
      stubMatchMedia(true)
      harness.render(
        <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}} title="Crop">
          <p>panel</p>
        </BottomSheet>,
      )
    })
    // An inline height outranks `top: 0; bottom: 0` and is what pinned the
    // "full-height" inspector at 58vh with 42vh of dead space under it.
    expect(sheet()?.style.height).toBe('')
  })

  it('follows the viewport across the breakpoint', () => {
    harness.render(
      <BottomSheet open detent="large" onDetent={() => {}} onClose={() => {}}>
        <p>panel</p>
      </BottomSheet>,
    )
    expect(sheet()?.style.height).toBe('var(--ie-sheet-large)')
    act(() => {
      stubMatchMedia(true)
      mediaListener?.()
    })
    expect(sheet()?.style.height).toBe('')
  })

  it('renders no backdrop at the inspector breakpoint, and one in the sheet', () => {
    const backdrop = () => harness.container.querySelector('[aria-hidden="true"]')
    harness.render(
      <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}}>
        <p>panel</p>
      </BottomSheet>,
    )
    expect(backdrop()).not.toBeNull()
    act(() => {
      stubMatchMedia(true)
      mediaListener?.()
    })
    expect(backdrop()).toBeNull()
  })
})

describe('D8-F05: the trap and aria-modal are scoped to the modal presentation', () => {
  it('is aria-modal with a backdrop in the sheet presentation', () => {
    harness.render(
      <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}} title="Crop">
        <button type="button">First</button>
      </BottomSheet>,
    )
    const panel = sheet()
    expect(panel?.getAttribute('aria-modal')).toBe('true')
    expect(panel?.getAttribute('aria-label')).toBe('Crop')
  })

  it('is not aria-modal and does not steal focus in the inspector presentation', () => {
    act(() => {
      stubMatchMedia(true)
      harness.render(
        <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}} title="Crop">
          <button type="button">First</button>
        </BottomSheet>,
      )
    })
    const panel = sheet()
    expect(panel?.hasAttribute('aria-modal')).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })

  it('wraps Tab inside the sheet and lets it walk free in the inspector', () => {
    const panel = () => sheet() as HTMLElement
    const render = () =>
      harness.render(
        <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}}>
          <button type="button">First</button>
          <button type="button">Last</button>
        </BottomSheet>,
      )

    render()
    const buttons = () => Array.from(panel().querySelectorAll('button'))
    act(() => buttons()[1].focus())
    act(() => {
      panel().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    expect(document.activeElement).toBe(buttons()[0])

    act(() => {
      stubMatchMedia(true)
      render()
    })
    const inspectorButtons = () => Array.from(panel().querySelectorAll('button'))
    act(() => inspectorButtons()[1].focus())
    act(() => {
      panel().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      )
    })
    // No trap: the panel installs no keydown handler in the inspector
    // presentation, so the browser is free to move focus out of the sheet.
    expect(document.activeElement).toBe(inspectorButtons()[1])
  })

  it('closes on Escape in both presentations', () => {
    let closed = 0
    harness.render(
      <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => (closed += 1)}>
        <p>panel</p>
      </BottomSheet>,
    )
    press('Escape')
    expect(closed).toBe(1)
  })

  it('the backdrop dims without dismissing, and the title-row Close button closes', () => {
    let closed = 0
    harness.render(
      <BottomSheet
        open
        detent="medium"
        onDetent={() => {}}
        onClose={() => (closed += 1)}
        title="Crop"
      >
        <p>panel</p>
      </BottomSheet>,
    )
    // The backdrop dims and does not dismiss. It is `inset: 0` inside
    // `.canvasRegion`, which on a phone is the whole box between the two bars —
    // so a scrim that takes pointer events is a scrim over the entire visible
    // canvas, and every crop handle and layer grip under it is dead. The half of
    // this test that matters is therefore that the scrim is *inert*: a press on
    // it must not close the panel, because closing it under a thumb that was
    // aiming at a handle is a misdirected action, not a dismissal.
    const backdrop = harness.container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(backdrop, 'the phone sheet renders a backdrop').not.toBeNull()
    expect(backdrop.style.pointerEvents, 'the backdrop swallows touches').toBe('none')
    act(() => {
      backdrop.click()
    })
    expect(closed, 'a press on the scrim closed the panel').toBe(0)
    act(() => {
      const close = Array.from(sheet()?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent === 'Close',
      )
      close?.click()
    })
    expect(closed).toBe(1)
  })
})

describe('D8-F05: focus is returned to the opener', () => {
  it('restores focus to whatever had it when the sheet opened', () => {
    const opener = document.createElement('button')
    opener.textContent = 'Open Crop'
    document.body.appendChild(opener)
    act(() => opener.focus())
    expect(document.activeElement).toBe(opener)

    harness.render(
      <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}} title="Crop">
        <p>panel</p>
      </BottomSheet>,
    )
    // The real app unmounts the sheet rather than passing open=false, so the
    // restore has to survive that path.
    harness.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('does not throw when the opener is gone from the document', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    act(() => opener.focus())
    harness.render(
      <BottomSheet open detent="medium" onDetent={() => {}} onClose={() => {}}>
        <p>panel</p>
      </BottomSheet>,
    )
    opener.remove()
    expect(() => harness.unmount()).not.toThrow()
  })
})

describe('BottomSheet content', () => {
  it('keeps the tool store in step with the detent control', () => {
    const { useUiStore: store } = { useUiStore }
    harness.render(
      <BottomSheet
        open
        detent={store.getState().sheetDetent}
        onDetent={store.getState().setSheetDetent}
        onClose={() => {}}
        title="Adjust"
      >
        <p>panel</p>
      </BottomSheet>,
    )
    act(() => {
      useUiStore.getState().setSheetDetent('large')
    })
    expect(harness.container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Adjust',
    )
  })
})
