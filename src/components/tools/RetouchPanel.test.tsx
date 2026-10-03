import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores, setNativeValue } from '../../store/testHarness'
import { RetouchPanel } from './RetouchPanel'

/**
 * D1-F13's panel: the thing that makes the Retouch tab a peer of Crop.
 *
 * The render pipeline has applied `doc.retouch` since the kernel landed, in both
 * backends, with `render/parity.test.ts` holding them to 2/255. Until this panel
 * existed nothing in the app wrote the fields, so the tab was a peer of Crop in
 * the bar and inert everywhere else. These are the tests that make the tab's
 * copy true: every control here has to change the document, in one undo step,
 * from the keyboard as well as the pointer.
 */

const renderExportCanvas = vi.hoisted(() => vi.fn())

vi.mock('../../render/exportCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../render/exportCanvas')>()
  return { ...actual, renderExportCanvas }
})

const harness = createHarness()

/** jsdom has no ImageBitmap and no 2D context; the pad needs both. */
const SOURCE = { width: 640, height: 480, close: () => {} } as unknown as ImageBitmap

const drawn: unknown[][] = []

const CONTEXT = {
  drawImage: (...args: unknown[]) => {
    drawn.push(args)
  },
}

const realGetContext = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  resetStores()
  // A real source, so `croppedSize` has a frame to read and the pad's aspect
  // ratio is a number rather than a division by nothing.
  useDocStore.getState().load(
    createDoc({
      source: { assetId: 'a1', width: 640, height: 480, name: 'p', mime: 'image/png' },
    }),
  )
  drawn.length = 0
  renderExportCanvas.mockReset()
  renderExportCanvas.mockResolvedValue({ width: 480, height: 360 } as HTMLCanvasElement)
  HTMLCanvasElement.prototype.getContext = function getContext(kind: string) {
    return kind === '2d' ? (CONTEXT as unknown as CanvasRenderingContext2D) : null
  } as typeof HTMLCanvasElement.prototype.getContext
  vi.useFakeTimers()
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext
  harness.unmount()
  vi.useRealTimers()
})

/** Run the pad's debounced proxy render to completion. */
async function settle(ms = 400) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const retouch = () => useDocStore.getState().present.retouch

const button = (name: string | RegExp) => {
  const match = Array.from(harness.container.querySelectorAll('button')).find((node) =>
    typeof name === 'string' ? node.textContent === name : name.test(node.textContent ?? ''),
  )
  if (!match) throw new Error(`no button matching ${name}`)
  return match as HTMLButtonElement
}

/**
 * The mode buttons inside the segmented control: the two buttons on the panel
 * that change what the next spot is rather than the document itself.
 */
const modeButton = (label: string) =>
  Array.from(harness.container.querySelectorAll('[role="group"] button')).find(
    (node) => node.textContent === label,
  ) as HTMLButtonElement

const press = (node: Element) => {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/**
 * A keyboard activation, which is not the same event as a pointer one: the
 * browser synthesises a `click` with `detail === 0` and no coordinates.
 */
const pressEnter = (node: Element) => {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
  })
}

const rangeFor = (label: string) => {
  const field = Array.from(harness.container.querySelectorAll('label')).find((node) =>
    node.textContent?.trim().startsWith(label),
  )
  const input = field?.querySelector('input[type="range"]') as HTMLInputElement | undefined
  if (!input) throw new Error(`no slider labelled ${label}`)
  return input
}

/**
 * Drive a range input the way a keyboard would: focus, change, release. `Slider`
 * brackets a continuous adjustment in one undo interaction between the first
 * keydown and the release, so a test that skipped the bracket would be testing a
 * history this app does not have.
 */
const nudge = (input: HTMLInputElement, value: number) => {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    setNativeValue(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
  })
}

const pad = () =>
  harness.container.querySelector('button[aria-label^="Place a"]') as HTMLButtonElement

/** A click at a point on the pad, in the pad's own 0..1 space. */
const clickPadAt = (x: number, y: number) => {
  const element = pad()
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240, x: 0, y: 0 }) as DOMRect
  const event = new MouseEvent('click', {
    bubbles: true,
    detail: 1,
    clientX: x * 320,
    clientY: y * 240,
  })
  act(() => {
    element.dispatchEvent(event)
  })
}

/** The titles of the panel's own empty states, not the segmented control's group. */
const emptyGroups = () =>
  Array.from(harness.container.querySelectorAll('[role="group"]'))
    .map((node) => node.querySelector('h3')?.textContent)
    .filter((title): title is string => Boolean(title))

describe('the smoothing dial writes doc.retouch.smooth', () => {
  beforeEach(() => {
    harness.render(<RetouchPanel source={SOURCE} />)
  })

  it('starts at the document value, not at a hard-coded zero', () => {
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        retouch: { ...doc.retouch, smooth: 42 },
      }))
    })
    expect(rangeFor('Smoothing').value).toBe('42')
  })

  it('a keyboard adjustment lands in the document and is one undo step', () => {
    nudge(rangeFor('Smoothing'), 60)
    expect(retouch().smooth).toBe(60)
    // One step, not one per event: the panel brackets the span, so a whole drag
    // is a single undo and a user cannot spend their history on a slider.
    act(() => {
      useDocStore.getState().undo()
    })
    expect(retouch().smooth).toBe(0)
  })

  it('undoing it leaves the rest of the retouch alone', () => {
    press(button(/^Add heal spot$/))
    nudge(rangeFor('Smoothing'), 30)
    act(() => {
      useDocStore.getState().undo()
    })
    expect(retouch().smooth).toBe(0)
    expect(retouch().healSpots).toHaveLength(1)
  })
})

describe('the pad places a spot, and a spot is a real edit', () => {
  beforeEach(() => {
    harness.render(<RetouchPanel source={SOURCE} />)
  })

  it('a click on the pad writes the point it landed on', () => {
    clickPadAt(0.25, 0.75)
    expect(retouch().healSpots).toHaveLength(1)
    expect(retouch().healSpots[0]?.at.x).toBeCloseTo(0.25, 6)
    expect(retouch().healSpots[0]?.at.y).toBeCloseTo(0.75, 6)
  })

  it('moves the position sliders to where the spot went, or the two would disagree', () => {
    // The pad places at the click and the sliders report the last position state;
    // if only one of them moved, a spot would sit where the panel did not say.
    clickPadAt(0.8, 0.2)
    expect(rangeFor('Across').value).toBe('80')
    expect(rangeFor('Up').value).toBe('20')
    expect(pad().getAttribute('aria-label')).toContain('80% across, 20% up')
  })

  it('carries the size slider into the spot, as a share of the frame width', () => {
    nudge(rangeFor('Size'), 12)
    clickPadAt(0.5, 0.5)
    expect(retouch().healSpots[0]?.radius).toBeCloseTo(0.12, 6)
  })

  it('Enter on the pad places at the crosshair, which the keyboard can move', () => {
    nudge(rangeFor('Across'), 90)
    nudge(rangeFor('Up'), 10)
    pressEnter(pad())
    expect(retouch().healSpots[0]?.at).toEqual({ x: 0.9, y: 0.1 })
  })

  it('a keyboard activation ignores the corner a synthesised click reports', () => {
    // A `click` from Enter or Space carries `clientX/clientY === 0`. Reading
    // those unconditionally put every keyboard-placed spot in the top-left of the
    // crop, which is the one place on the photo a user did not choose.
    pressEnter(pad())
    expect(retouch().healSpots[0]?.at).toEqual({ x: 0.5, y: 0.5 })
  })

  it('one placement is one undo step, and it takes the spot back with it', () => {
    clickPadAt(0.4, 0.4)
    clickPadAt(0.6, 0.6)
    expect(retouch().healSpots).toHaveLength(2)
    act(() => {
      useDocStore.getState().undo()
    })
    expect(retouch().healSpots).toHaveLength(1)
    act(() => {
      useDocStore.getState().undo()
    })
    expect(retouch().healSpots).toHaveLength(0)
  })

  it('removes one spot by name, leaving the others', () => {
    clickPadAt(0.2, 0.2)
    clickPadAt(0.8, 0.8)
    press(button('Remove spot 1'))
    expect(retouch().healSpots).toHaveLength(1)
    expect(retouch().healSpots[0]?.at.x).toBeCloseTo(0.8, 6)
  })
})

describe('red-eye is a second kind of spot, not a second panel', () => {
  beforeEach(() => {
    harness.render(<RetouchPanel source={SOURCE} />)
  })

  it('places into the other list when the segmented control is on red-eye', () => {
    press(button('Red-eye'))
    clickPadAt(0.35, 0.35)
    expect(retouch().redEye).toHaveLength(1)
    expect(retouch().healSpots).toHaveLength(0)
    expect(harness.container.textContent).toContain('Mark 1')
  })

  it('removes a mark by name, and clears the lot in one step', () => {
    press(button('Red-eye'))
    clickPadAt(0.3, 0.3)
    clickPadAt(0.7, 0.7)
    press(button('Remove mark 1'))
    expect(retouch().redEye).toHaveLength(1)
    press(button('Remove all red-eye marks'))
    expect(retouch().redEye).toHaveLength(0)
  })

  it('leaves the heal spots alone when it clears the red-eye marks', () => {
    press(button('Add heal spot'))
    press(button('Red-eye'))
    clickPadAt(0.3, 0.3)
    press(button('Remove all red-eye marks'))
    expect(retouch().healSpots).toHaveLength(1)
  })
})

describe('nothing on the panel is a control that does nothing', () => {
  beforeEach(() => {
    harness.render(<RetouchPanel source={SOURCE} />)
  })

  it('every button that claims to edit the photo does edit it', () => {
    // The whole defect this panel replaces was a tab that opened a note. So each
    // control is exercised and the document is compared, rather than each label
    // being read and believed.
    //
    // The segmented control's two buttons are excluded, and by name rather than
    // by position: they choose what the next spot *is*, they do not change the
    // photo, and the next case checks that they change what "Add" writes. "Reset
    // retouch" is excluded because it has to be skipped while the document is
    // already at its default, which is the case below.
    let before = JSON.stringify(retouch())
    for (const node of Array.from(harness.container.querySelectorAll('button'))) {
      const element = node as HTMLButtonElement
      if (element.disabled) continue
      const name = element.textContent ?? ''
      if (name === 'Reset retouch') continue
      if (name === 'Heal spot' || name === 'Red-eye') continue
      press(element)
      expect(JSON.stringify(retouch()), name).not.toBe(before)
      before = JSON.stringify(retouch())
    }
  })

  it('the mode buttons decide what the next placement writes', () => {
    expect(modeButton('Heal spot').getAttribute('aria-pressed')).toBe('true')
    press(modeButton('Red-eye'))
    expect(modeButton('Red-eye').getAttribute('aria-pressed')).toBe('true')
    press(button(/^Add red-eye mark$/))
    expect(retouch().redEye).toHaveLength(1)
    expect(retouch().healSpots).toHaveLength(0)
  })

  it('Reset retouch is disabled until there is something to reset, and then undoes it all', () => {
    const reset = button('Reset retouch') as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    nudge(rangeFor('Smoothing'), 50)
    press(button('Add heal spot'))
    expect((button('Reset retouch') as HTMLButtonElement).disabled).toBe(false)
    press(button('Reset retouch'))
    expect(retouch()).toEqual({ smooth: 0, healSpots: [], redEye: [] })
    expect((button('Reset retouch') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why the cap is reached instead of quietly stopping the button', () => {
    // Eight full-frame passes is a render cost, not a model limit, so the panel
    // states the number rather than letting a control stop responding.
    for (let index = 0; index < 8; index += 1) press(button(/^Add heal spot$/))
    expect(retouch().healSpots).toHaveLength(8)
    const add = button(/^Add heal spot$/) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(pad().disabled).toBe(true)
    const status = harness.container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('8 heal spots')
    expect(status?.textContent).toMatch(/full pass/)
    // And it is a cap, not a dead end: removing one makes room again.
    press(button('Remove spot 1'))
    expect((button(/^Add heal spot$/) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('the empty states say what is here and what will happen', () => {
  it('names the two lists when they are empty', () => {
    harness.render(<RetouchPanel source={SOURCE} />)
    expect(emptyGroups()).toContain('No heal spots')
    press(button('Red-eye'))
    expect(emptyGroups()).toContain('No red-eye marks')
  })

  it('replaces the empty state once there is something in the list', () => {
    harness.render(<RetouchPanel source={SOURCE} />)
    press(button(/^Add heal spot$/))
    expect(emptyGroups()).toEqual([])
    expect(harness.container.textContent).toContain('Spot 1')
  })

  it('is inert, so an empty state does not steal focus or read as an alert', () => {
    harness.render(<RetouchPanel source={SOURCE} />)
    const groups = Array.from(harness.container.querySelectorAll('[role="group"]')).filter((node) =>
      node.querySelector('h3'),
    )
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      expect(group.getAttribute('aria-labelledby')).toBeTruthy()
      expect(group.getAttribute('aria-live')).toBeNull()
      expect(group.getAttribute('tabindex')).toBeNull()
    }
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('says the panel needs a photo rather than offering a spot nothing can land on', () => {
    harness.render(<RetouchPanel source={null} />)
    expect(emptyGroups()).toContain('No photo yet')
    expect(harness.container.querySelector('button[aria-label^="Place a"]')).toBeNull()
    // Smoothing still works: it is not a spot, and the pass does not need a frame.
    nudge(rangeFor('Smoothing'), 25)
    expect(retouch().smooth).toBe(25)
  })
})

describe('the pad draws the crop through the pipeline, and admits it when it cannot', () => {
  beforeEach(() => {
    harness.render(<RetouchPanel source={SOURCE} />)
  })

  it('paints the pad from renderExportCanvas at the crop, not from the source bitmap', async () => {
    // The pad has to be the crop: `HealSpot.at` is normalized whole-output space,
    // so drawing the uncropped photo would place every spot in the wrong place
    // whenever a crop is set.
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: { ...doc.geometry, crop: { x: 0, y: 0.25, width: 1, height: 0.5 } },
      }))
    })
    await settle()
    const call = renderExportCanvas.mock.calls[renderExportCanvas.mock.calls.length - 1]
    expect(call?.[0]).toBe(SOURCE)
    expect((call?.[1] as { geometry: { crop: { width: number } } }).geometry.crop.width).toBe(1)
    // 480 px across, and the 240-tall crop's own aspect: 480 × 180.
    expect(call?.[2]).toEqual({ width: 480, height: 180 })
    expect(drawn.length).toBeGreaterThan(0)
  })

  it('gives the pad the crop aspect, so the photo on it is not stretched', () => {
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: { ...doc.geometry, crop: { x: 0, y: 0.25, width: 1, height: 0.5 } },
      }))
    })
    // 640 × 480 source with the top and bottom quarters cropped away: 640 × 240,
    // so a 16:9-ish pad and not the source's 4:3.
    expect(pad().style.aspectRatio).toBe(String(640 / 240))
  })

  it('says the crop could not be drawn, and leaves the sliders as the way through', async () => {
    renderExportCanvas.mockRejectedValue(new Error('no context'))
    await settle()
    const status = Array.from(harness.container.querySelectorAll('[role="status"]')).find((node) =>
      node.textContent?.includes('could not be drawn'),
    )
    expect(status?.textContent).toContain('position controls below place the same spot')
    nudge(rangeFor('Across'), 70)
    press(button(/^Add heal spot$/))
    expect(retouch().healSpots[0]?.at.x).toBeCloseTo(0.7, 6)
  })
})

/**
 * What the caption is allowed to claim about the canvas.
 *
 * The sentence used to be "The rectangle drawn on the canvas is that same region",
 * and it was false for as long as it was there: a rectangle was drawn only while
 * the canvas was showing the whole frame, because no frame had run — `LoopKey` had
 * no field for whether the crop was being edited, so closing the Crop tool produced
 * a key identical to the open one. With the canvas showing the crop, the rectangle
 * was dropped rather than kept as a coincidence, and the sentence had to follow it.
 *
 * A caption describing something that is not drawn is the same defect as drawing
 * it, and neither jsdom nor axe can see it: both of these claims are about a
 * sentence. So they are asserted here, in full, and the negative form is asserted
 * too — a caption can be made true again by accident and stay true by accident
 * after the next change to the canvas.
 */
describe("the caption's claim about the canvas", () => {
  /** The pad's caption: the paragraph a reader is told to check the claim on. */
  function caption() {
    const found = Array.from(harness.container.querySelectorAll('p')).find((node) =>
      node.textContent?.includes('The pad is the crop'),
    )
    expect(found, 'the pad has no caption at all').toBeTruthy()
    return (found?.textContent ?? '').replace(/\s+/g, ' ').trim()
  }

  beforeEach(() => {
    harness.render(<RetouchPanel source={SOURCE} />)
  })

  it('names the pad and the canvas, which are the two things that are on screen', () => {
    expect(caption()).toBe(
      'The pad is the crop. The pad and the canvas are the same region, so a spot lands where you can see it.',
    )
  })

  it('promises no rectangle, because none is drawn', () => {
    // The exact false claim, in the negative. A caption is not "close enough".
    expect(caption()).not.toMatch(/rectangle/i)
    // "Drawn", "marked" and "outlined" are the same promise in other words.
    expect(caption()).not.toMatch(/drawn|outline/i)
  })

  it('does not change with the crop, so it cannot become true only when it is checked', () => {
    const withNoCrop = caption()
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: { ...doc.geometry, crop: { x: 0, y: 0.25, width: 1, height: 0.5 } },
      }))
    })
    expect(caption()).toBe(withNoCrop)
  })
})
