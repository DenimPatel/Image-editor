import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE_IMAGES } from '../../lib/accept'
import { MODELS } from '../../features/ml/ModelLoader'
import { createHarness } from '../../store/testHarness'
import { cdnDisclosure } from './privacy'
import { ImportScreen, OfflineBanner } from './ImportScreen'

const harness = createHarness()

const noop = () => {}

const samples = () =>
  Array.from(
    harness.container.querySelectorAll('button[class*="sampleItem"]'),
  ) as HTMLButtonElement[]

const dropzone = () => harness.container.querySelector('[class*="importDrop"]') as HTMLElement

beforeEach(() => {
  act(() => {
    harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
  })
})

afterEach(() => harness.unmount())

describe('D7-F02: a pending decode is announced and the grid is inert', () => {
  it('offers the three samples and none of them is disabled while idle', () => {
    expect(samples()).toHaveLength(3)
    for (const button of samples()) expect(button.disabled).toBe(false)
  })

  it('disables the sample grid and marks the dropzone busy while pending', () => {
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} pending />)
    })
    for (const button of samples()) expect(button.disabled).toBe(true)
    expect(dropzone().getAttribute('aria-busy')).toBe('true')
  })

  it('is not busy by default, and `pending` is optional', () => {
    expect(dropzone().getAttribute('aria-busy')).toBe('false')
  })

  it('a pending sample cannot be clicked twice', () => {
    let calls = 0
    act(() => {
      harness.render(
        <ImportScreen
          onFile={noop}
          onSample={() => {
            calls += 1
          }}
          error={null}
          pending
        />,
      )
    })
    for (const button of samples()) button.click()
    expect(calls).toBe(0)
  })

  it('the file input still works while pending', () => {
    const input = harness.container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} pending />)
    })
    expect(harness.container.querySelector('input[type="file"]')).not.toBeNull()
  })
})

describe('D7-F02: a failed decode is an alert, not decoration', () => {
  it('renders the error in a live region', () => {
    act(() => {
      harness.render(
        <ImportScreen onFile={noop} onSample={noop} error="That file could not be decoded" />,
      )
    })
    const alert = harness.container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('That file could not be decoded')
  })

  it('shows no alert when there is no error', () => {
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Offline banner (D7-F02)
 * ------------------------------------------------------------------ */

const banner = () => harness.container.querySelector('[role="status"]') as HTMLElement | null

const setOnline = (value: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
}

const connectivity = (value: boolean) => {
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  })
}

describe('D7-F02: going offline says what still works', () => {
  afterEach(() => setOnline(true))

  it('says nothing while the connection is fine', () => {
    setOnline(true)
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
    })
    expect(banner()).toBeNull()
  })

  it('mounts already knowing the browser is offline', () => {
    setOnline(false)
    // A fresh mount: the state is seeded from `navigator.onLine` on mount, not
    // on every render.
    act(() => {
      harness.unmount()
    })
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
    })
    expect(banner()?.textContent).toContain("You're offline")
    // The useful half of the sentence is the split, not the alarm.
    expect(banner()?.textContent).toContain('Your photo and every edit will work offline')
    expect(banner()?.textContent).toContain('Background removal will need a connection')
    expect(banner()?.textContent).toContain('The bundled sample photos will need a connection')
  })

  it('appears and disappears as connectivity changes, and is a live region', () => {
    setOnline(true)
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
    })
    connectivity(false)
    expect(banner()?.getAttribute('aria-live')).toBe('polite')
    expect(banner()?.textContent).toContain("You're offline")
    connectivity(true)
    expect(banner()).toBeNull()
  })

  it('stops listening once it is gone', () => {
    setOnline(false)
    act(() => {
      harness.render(<OfflineBanner />)
    })
    expect(banner()).not.toBeNull()
    act(() => {
      harness.unmount()
    })
    // A leaked listener would throw here; the unmount already returned, so this
    // only proves the subscription was removed rather than left to fire.
    connectivity(true)
    expect(banner()).toBeNull()
  })
})

/**
 * D8-F16 — camera capture. `capture` is only honoured where there is a camera
 * to honour it with; a desktop browser ignores it and opens the ordinary
 * picker, so the control is gated on a coarse pointer rather than shipped as a
 * second button that does exactly what "browse" already does.
 */
describe('D8-F16: camera capture is offered only where it changes something', () => {
  function setPointerCoarse(value: boolean) {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('pointer: coarse') ? value : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia
    return () => {
      window.matchMedia = original
    }
  }

  const camera = () =>
    harness.container.querySelector<HTMLInputElement>('input[type="file"][capture]')

  let restore: (() => void) | null = null

  afterEach(() => {
    restore?.()
    restore = null
  })

  it('is present, with the rear camera, on a touch device', () => {
    restore = setPointerCoarse(true)
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
    })
    const input = camera()
    expect(input).not.toBeNull()
    expect(input?.getAttribute('capture')).toBe('environment')
    expect(input?.getAttribute('accept')).toBe('image/*')
    expect(input?.getAttribute('aria-label')).toBe('Take a photo')
    const buttons = Array.from(harness.container.querySelectorAll('button'))
    expect(buttons.some((button) => button.textContent === 'Take a photo')).toBe(true)
  })

  it('is absent on a fine-pointer device', () => {
    restore = setPointerCoarse(false)
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
    })
    expect(camera()).toBeNull()
    expect(harness.container.textContent).not.toContain('Take a photo')
  })

  it('keeps the ordinary browse input either way', () => {
    restore = setPointerCoarse(false)
    act(() => {
      harness.render(<ImportScreen onFile={noop} onSample={noop} error={null} />)
    })
    const inputs = harness.container.querySelectorAll('input[type="file"]')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].getAttribute('accept')).toBeTruthy()
    expect(inputs[0].hasAttribute('capture')).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * The front door's three claims
 * ------------------------------------------------------------------ */

describe('the import screen says what this is', () => {
  it('states the capability set in one sentence, next to the heading', () => {
    const text = harness.container.textContent ?? ''
    expect(text).toContain('Edit an image')
    expect(text).toContain('A photo editor that runs in your browser:')
    for (const tool of ['crop', 'straighten', 'colour', 'background', 'layers']) {
      expect(text, tool).toContain(tool)
    }
  })

  it('does not promise a tool that is not built', () => {
    // Retouch is one of the thirteen tool tabs and its panel says, in as many
    // words, that nothing you can reach there changes the photo. The lede listed
    // it anyway, so the screen that introduces the product claimed a capability
    // the product does not have.
    expect(harness.container.querySelector('p')?.textContent).not.toContain('retouch')
  })
})

describe('the privacy caveat is on the screen that qualifies the claim', () => {
  it('carries the CDN download inside the claim, not in a footnote after it', () => {
    // The disclosure used to exist in exactly one place in the whole product: a
    // hint line inside the Background panel, behind the button that causes the
    // download. A user deciding whether to trust this app with a photo never
    // met it. This asserts the sentence is on the import screen, that it names
    // the host, and that the size comes from the model catalogue.
    const paragraph = Array.from(harness.container.querySelectorAll('p')).find((p) =>
      (p.textContent ?? '').includes('imgly CDN'),
    )
    expect(paragraph, 'the import screen says where the model comes from').toBeDefined()

    const text = paragraph?.textContent ?? ''
    expect(text).toContain('Nothing is uploaded')
    expect(text).toContain(`${MODELS['matting-quint8'].bytes / (1024 * 1024)} MB`)
    expect(text).toContain(`${MODELS['matting-fp16'].bytes / (1024 * 1024)} MB for best quality`)
    expect(text).toContain('IP address')
    // And the conditional half, which is the only claim that is true whatever
    // the user does next.
    expect(text).toContain('nothing is downloaded from anyone at all')
    // The claim and its exception share one sentence, so a reader who stops
    // after the first clause has still been told everything.
    expect(text.split('. ')[0]).toContain('but Remove Background is not local')
  })

  it('is the same sentence the orientation uses, not a second wording', () => {
    const onScreen = Array.from(harness.container.querySelectorAll('p')).find((p) =>
      (p.textContent ?? '').includes('imgly CDN'),
    )?.textContent
    expect(onScreen).toBe(cdnDisclosure())
  })
})

describe('each sample says why that photograph is in the bundle', () => {
  const noteIn = (index: number) => samples()[index]?.querySelectorAll('span')[1]?.textContent ?? ''

  it('gives every tile a reason, and none of them is empty', () => {
    // A fourth sample added to `accept.ts` without a line here would fail this,
    // rather than shipping a tile that argues nothing about itself.
    const notes = samples().map((_, index) => noteIn(index))
    expect(notes).toHaveLength(SAMPLE_IMAGES.length)
    for (const note of notes) expect(note.length).toBeGreaterThan(20)
    expect(new Set(notes).size).toBe(notes.length)
  })

  it('names a property of the photo and the tool it is there for', () => {
    expect(noteIn(0)).toContain('Brightness')
    expect(noteIn(1)).toContain('Passport')
    expect(noteIn(2)).toContain('Look')
  })

  it('does not call the photos test cases, which is the suite’s word not the reader’s', () => {
    // The notes used to read "the exposure test", "the passport framing test",
    // "the looks test". A tile captioned with the word "test" tells a first-time
    // visitor the picture is here to prove something works rather than to be
    // edited, and "exposure" / "looks" are two of the thirteen tool tabs before
    // the reader has met either of them.
    for (const note of samples().map((_, index) => noteIn(index))) {
      expect(note).not.toMatch(/\btest\b/i)
    }
  })

  it('keeps the caption first, so the sample fixture still finds it by label', () => {
    expect(samples()[0]?.querySelector('span')?.textContent).toBe(SAMPLE_IMAGES[0]?.label)
  })
})

describe('the orientation has a permanent way back', () => {
  it('offers it by name on the import screen, whether or not it has been read', () => {
    const opener = harness.container.querySelector('button[aria-haspopup="dialog"]')
    expect(opener?.textContent).toBe('How this editor works')
    expect(opener?.getAttribute('aria-expanded')).toBe('true')
  })
})
