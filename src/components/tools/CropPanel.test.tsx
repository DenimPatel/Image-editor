import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import { fillFrameCrop, getTransformedSize } from '../../lib/crop/geometry'
import { platformShapeRows } from '../../lib/crop/presets'
import { setCrop } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores, setNativeValue } from '../../store/testHarness'
import { CropPanel } from './CropPanel'

const harness = createHarness()

const FULL = { x: 0, y: 0, width: 1, height: 1 }
const SOURCE = { width: 3000, height: 2000 }
const NO_TURN = { quarterTurns: 0, flipH: false, flipV: false }

/**
 * The chip whose own label reads one of `labels`.
 *
 * Found through the label element rather than the button's `textContent`,
 * because two chips now say more than one thing: a print chip prints its
 * millimetres under the size, and every platform chip is qualified by its
 * platform, so no two of the twenty-two read alike. `.closest('button')` is the
 * control that label belongs to, so the assertion is still about a chip a user
 * can tap.
 *
 * Several labels are accepted because the *behaviour* is what these tests are
 * about — "a story preset opens the story safe area" — and that has to survive
 * a copy change. Where a wording did move, the old spelling is still listed
 * beside the new one and the reason is at the call site.
 */
const chip = (...labels: string[]) => {
  const match = Array.from(harness.container.querySelectorAll('span'))
    .find((span) => labels.includes(span.textContent ?? ''))
    ?.closest('button')
  if (!match) throw new Error(`no chip labelled ${labels.join(' or ')}`)
  return match
}

const tap = (...labels: string[]) => {
  act(() => {
    chip(...labels).click()
  })
}

/**
 * A chip's own words, with the shape's span and any wrapper skipped.
 *
 * The shape is an `aria-hidden` SVG inside the first span of the button, and a
 * print chip nests its size inside a wrapper that also holds the millimetres, so
 * the label is the innermost span that says anything. Reading it this way is
 * what lets a chip say two things — `4 × 6 in` over `101.6 × 152.4 mm` — without
 * the two running together into one unmatchable string.
 */
const labelOf = (element: Element): string => {
  const said = Array.from(element.querySelectorAll('span')).filter(
    (span) => (span.textContent ?? '').trim().length > 0,
  )
  const leaf = said.find((span) => !said.some((other) => other !== span && span.contains(other)))
  return leaf?.textContent ?? ''
}

/** The box a chip's shape occupies, read off the SVG's own parent. */
const frameOf = (chipElement: Element): HTMLElement | null =>
  (chipElement.querySelector('svg')?.parentElement as HTMLElement | null) ?? null

/**
 * A frame's authored size in px, with the `--icon-scale` multiplier read back
 * out of the `calc()` the chip writes. The value is a `calc()` rather than a
 * number so the icon preference moves the shape with every other glyph.
 */
const framePx = (frame: HTMLElement, name: 'width' | 'height'): number =>
  Number.parseFloat(/(-?[\d.]+)px/.exec(frame.style.getPropertyValue(name))?.[1] ?? 'NaN')

/** Every pressed chip inside one labelled group, as its own label. */
const litIn = (group: string) => {
  const row = harness.container.querySelector(`[aria-label="${group}"]`)
  if (!row) throw new Error(`no group labelled ${group}`)
  return Array.from(row.querySelectorAll('[aria-pressed="true"]')).map(labelOf)
}

/** Every chip inside one labelled group, as its own label. */
const allIn = (group: string) => {
  const row = harness.container.querySelector(`[aria-label="${group}"]`)
  if (!row) throw new Error(`no group labelled ${group}`)
  return Array.from(row.querySelectorAll('button')).map(labelOf)
}

const byLabel = (label: string) => {
  const match = harness.container.querySelector(`[aria-label="${label}"]`)
  if (!match) throw new Error(`no control labelled ${label}`)
  return match
}

const typeInto = (element: HTMLInputElement, value: string) => {
  act(() => {
    setNativeValue(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const crop = () => useDocStore.getState().present.geometry.crop
const aspectLock = () => useDocStore.getState().present.geometry.aspectLock

/** Load a photo-sized document; the panel re-renders off the store. */
function loadSource(width = SOURCE.width, height = SOURCE.height) {
  act(() => {
    useDocStore.getState().load(
      createDoc({
        source: { assetId: 'a1', width, height, name: 'p.jpg', mime: 'image/jpeg' },
      }),
    )
  })
}

const past = () => useDocStore.getState().past.length

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
  harness.render(<CropPanel />)
})

describe('CropPanel undo steps', () => {
  it('D2-F05: one aspect chip tap is exactly one undo step', () => {
    tap('16:9')
    expect(past()).toBe(1)
    const doc = useDocStore.getState().present
    expect(doc.geometry.aspectLock).toBeCloseTo(16 / 9, 6)
    expect(doc.geometry.crop.height).toBeCloseTo(9 / 16, 6)
    act(() => useDocStore.getState().undo())
    const undone = useDocStore.getState().present
    expect(undone.geometry.aspectLock).toBeNull()
    expect(undone.geometry.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('D2-F05: a square ratio that leaves the crop alone is still one step', () => {
    tap('1:1')
    expect(past()).toBe(1)
    expect(useDocStore.getState().present.geometry.crop).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })
  })

  it('D2-F05: the print-size chip is one undo step across three fields', () => {
    tap('4 × 6 in')
    expect(past()).toBe(1)
    const doc = useDocStore.getState().present
    expect(doc.output.resize).toMatchObject({ mode: 'physical', widthMm: 101.6, heightMm: 152.4 })
    expect(doc.geometry.aspectLock).toBeCloseTo(101.6 / 152.4, 6)
    act(() => useDocStore.getState().undo())
    const undone = useDocStore.getState().present
    expect(undone.output.resize).toEqual({ mode: 'none' })
    expect(undone.geometry.aspectLock).toBeNull()
    expect(undone.geometry.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('D2-F07: re-tapping the active chip pushes nothing and does not re-render', () => {
    tap('16:9')
    expect(past()).toBe(1)
    const revision = useDocStore.getState().revision
    tap('16:9')
    expect(past()).toBe(1)
    expect(useDocStore.getState().revision).toBe(revision)
  })

  it('switches aspect without leaving an interaction open', () => {
    tap('1:1')
    tap('16:9')
    expect(past()).toBe(2)
    expect(useDocStore.getState().interaction.key).toBeNull()
    expect(useUiStore.getState().safeArea).toBe('none')
  })

  it('opens a safe area for a story preset and closes it for a plain ratio', () => {
    // "Story 9:16" became "Instagram Story 9:16": seven chips read "Square 1:1"
    // and three read "Story 9:16" with nothing on screen to say which platform
    // any of them belonged to, so the label is now qualified by its platform.
    // Both spellings are looked up so the case keeps asserting the safe-area
    // behaviour rather than the copy.
    tap('Instagram Story 9:16', 'Story 9:16')
    expect(useUiStore.getState().safeArea).toBe('story')
    tap('1:1')
    expect(useUiStore.getState().safeArea).toBe('none')
  })

  it('a straighten dial drag and its release are one step', () => {
    const dial = harness.container.querySelector('[role="slider"]') as HTMLElement
    act(() => {
      dial.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    act(() => {
      dial.dispatchEvent(pointerMove(20, 4))
    })
    act(() => {
      dial.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
    act(() => useDocStore.getState().undo())
    expect(useDocStore.getState().present.geometry.straighten).toBe(0)
  })
})

function pointerMove(clientX: number, clientY: number) {
  const event = new MouseEvent('pointermove', { bubbles: true, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'clientY', { value: clientY })
  return event
}

describe('D5-F01/D5-F04: the aspect lock is a claim about pixels', () => {
  it('a square lock on a 3:2 photo is square, not the whole frame', () => {
    loadSource()
    tap('1:1')
    expect(crop().width).toBeLessThan(1)
    expect(crop().width * SOURCE.width).toBeCloseTo(crop().height * SOURCE.height, 6)
    // 3000x2000 frame, so a square crop is 2000x2000 out of 3000x2000.
    expect(crop().width * SOURCE.width).toBeCloseTo(2000, 0)
  })

  it('a 16:9 lock on a 3:2 photo keeps the 16:9 pixel aspect', () => {
    loadSource()
    tap('16:9')
    expect((crop().width * SOURCE.width) / (crop().height * SOURCE.height)).toBeCloseTo(16 / 9, 6)
  })

  it('a square photo behaves exactly as before the frame was threaded through', () => {
    loadSource(2000, 2000)
    tap('1:1')
    expect(crop()).toEqual(FULL)
  })

  it('a document with no source still locks in normalized space', () => {
    tap('16:9')
    expect(crop().height).toBeCloseTo(9 / 16, 6)
  })

  it('a print size is a pixel aspect on the real frame', () => {
    loadSource()
    tap('4 × 6 in')
    const expected = 101.6 / 152.4
    expect(aspectLock()).toBeCloseTo(expected, 6)
    expect((crop().width * SOURCE.width) / (crop().height * SOURCE.height)).toBeCloseTo(expected, 6)
  })
})

describe('D5-F14: the custom W:H field', () => {
  const field = () =>
    harness.container.querySelector<HTMLInputElement>(
      '[aria-label="Custom aspect ratio"]',
    ) as HTMLInputElement | null

  it('accepts 3:2 and applies it as one undo step', () => {
    typeInto(field() as HTMLInputElement, '3:2')
    expect(aspectLock()).toBeCloseTo(1.5, 6)
    expect(past()).toBe(1)
    expect(crop().width).toBeCloseTo(1)
    expect(crop().height).toBeCloseTo(2 / 3, 6)
  })

  it('locks in pixels, like the presets do', () => {
    loadSource()
    typeInto(field() as HTMLInputElement, '1:1')
    expect(crop().width * SOURCE.width).toBeCloseTo(crop().height * SOURCE.height, 6)
  })

  it.each(['0:0', 'abc', '-1:2', '3:2:1', '5:'])(
    'rejects %s: the lock is untouched and the error is announced',
    (bad) => {
      typeInto(field() as HTMLInputElement, '3:2')
      const before = { aspect: aspectLock(), crop: crop(), past: past() }
      typeInto(field() as HTMLInputElement, bad)
      expect(aspectLock()).toBe(before.aspect)
      expect(crop()).toEqual(before.crop)
      expect(past()).toBe(before.past)
      const alert = harness.container.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain('W:H')
      expect(field()?.getAttribute('aria-invalid')).toBe('true')
    },
  )

  it('clears the error as soon as the value parses', () => {
    typeInto(field() as HTMLInputElement, '0:0')
    expect(harness.container.querySelector('[role="alert"]')).not.toBeNull()
    typeInto(field() as HTMLInputElement, '4:3')
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
    expect(field()?.getAttribute('aria-invalid')).toBeNull()
    expect(aspectLock()).toBeCloseTo(4 / 3, 6)
  })

  it('the swap glyph turns 3:2 into 2:3, lock and crop together', () => {
    loadSource()
    typeInto(field() as HTMLInputElement, '3:2')
    const before = past()
    act(() => {
      byLabel('Swap ratio sides').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(field()?.value).toBe('2:3')
    expect(aspectLock()).toBeCloseTo(2 / 3, 6)
    expect((crop().width * SOURCE.width) / (crop().height * SOURCE.height)).toBeCloseTo(2 / 3, 6)
    expect(past()).toBe(before + 1)
  })
})

describe('D5-F04: "Fill frame after straighten" measures the rotated frame', () => {
  it('leaves a straight photo at the full frame', () => {
    loadSource()
    act(() => {
      byLabel('Fill frame after straighten').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(crop()).toEqual(FULL)
  })

  it('insets the crop to the largest rotated rectangle, not the unrotated one', () => {
    loadSource()
    act(() => {
      useDocStore
        .getState()
        .update((doc) => ({ ...doc, geometry: { ...doc.geometry, straighten: 20 } }), {
          key: 'straighten',
        })
    })
    act(() => {
      byLabel('Fill frame after straighten').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    const expected = fillFrameCrop(SOURCE, NO_TURN, 20, null)
    expect(crop()).toEqual(expected)
    // The old body normalised by the *unrotated* source, so it clamped to the
    // full frame and left the rotation with empty corners.
    expect(crop().width).toBeLessThan(1)
  })

  it('honours the active aspect lock', () => {
    loadSource()
    tap('1:1')
    act(() => {
      useDocStore
        .getState()
        .update((doc) => ({ ...doc, geometry: { ...doc.geometry, straighten: 20 } }), {
          key: 'straighten',
        })
    })
    act(() => {
      byLabel('Fill frame after straighten').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(crop()).toEqual(fillFrameCrop(SOURCE, NO_TURN, 20, 1))
    // The crop lives in the straightened frame, so "1:1" means square there.
    const box = getTransformedSize(SOURCE.width, SOURCE.height, 20)
    expect(crop().width * box.width).toBeCloseTo(crop().height * box.height, 6)
  })
})

/** What the overlay's "Reset crop" button does: the box goes back, the lock stays. */
const resetCrop = () => {
  act(() => {
    setCrop(FULL)
  })
}

describe('the platform block is folded away, and says what it is for', () => {
  it('is closed by default, so the Straighten dial is not 900px down the panel', () => {
    loadSource()
    // The audit's measurement: 1553px of panel content in a 468px window at
    // 390x844, with the working dial 1397px from the top. All of it was the twenty-
    // two chips. A `<details>` is the disclosure the audit recommended over
    // deleting them, and deleting them was not available: they are the only route
    // to a safe-area preset, which the canvas overlay and `PassportPanel` both read.
    const disclosure = harness.container.querySelector('details')
    expect(disclosure).not.toBeNull()
    expect(disclosure?.hasAttribute('open')).toBe(false)
    // Still in the document, still reachable: folding is not removing.
    expect(allIn('9:16 presets').length).toBeGreaterThan(0)
    expect(allIn('1:1 presets')).toHaveLength(7)
  })

  it('is a real disclosure, so it works and is announced without this component', () => {
    loadSource()
    const summary = harness.container.querySelector('details > summary')
    expect(summary).not.toBeNull()
    // The count is in the summary, because a closed section that says only
    // "Platform" is a section nobody can tell is worth opening.
    expect(summary?.textContent).toContain('Platform')
    expect(summary?.textContent).toMatch(/22 sizes/)
  })

  it('names the live safe-area guides on the summary, which is the pressed state', () => {
    loadSource()
    // There is no honest single chip to light in this block: three of the 9:16
    // presets produce a Story crop, so lighting them would put the panel back to
    // three lit controls for one tap. The safe-area preset *is* single-valued and
    // only these chips can set it, so the summary carries it — one statement about
    // the one thing the block adds, and no claim about which chip was tapped.
    const summary = () => harness.container.querySelector('details > summary')?.textContent ?? ''
    expect(summary()).not.toMatch(/guides on/)
    tap('Instagram Story 9:16')
    expect(summary()).toMatch(/Story guides on/)
  })

  it('says on the chip what a platform preset adds that the generic row cannot', () => {
    loadSource()
    // The three families that add guides say so on the chip, so "what will this do"
    // is answered by the button rather than by a paragraph 900px above the dial.
    const story = chip('Instagram Story 9:16')
    expect(story.textContent).toContain('Story guides')
    // A preset with no safe area carries no second line rather than a false one.
    expect(chip('TikTok Video 9:16').textContent).toContain('Reel guides')
    expect(chip('YouTube Shorts 9:16').textContent).toContain('YouTube guides')
    expect(chip('Pinterest Story 9:16').textContent).toContain('Story guides')
    // `Pinterest` matches `/story/i`, so the whole 9:16 row carries a guide line.
    // The one that must not claim one is a row with no platform in its id at all.
    expect(chip('X 16:9').textContent).not.toContain('guides')
  })
})

describe('the shape rows say what the crop is, not what was last tapped', () => {
  /** Every lit chip in the whole panel — the point of the one-lighting rule. */
  const litEverywhere = () =>
    Array.from(harness.container.querySelectorAll('[aria-pressed="true"]')).map(labelOf)

  it('lights no platform chip at all, whatever set the crop', () => {
    loadSource()
    tap('Instagram Story 9:16', 'Story 9:16')
    // Five presets are 9:16 and all five produce this crop, so this used to light
    // all five: a panel that reads as five things selected for a crop the user
    // only ever chose once. Nothing in the document records that the crop *came
    // from* Instagram, so there is no state here for a chip to be showing.
    expect(litIn('9:16 presets')).toEqual([])
    expect(litIn('1:1 presets')).toEqual([])
    // The one lit chip is the generic row, and it is the same string the canvas
    // overlay prints — the panel's selection and its readout are one fact.
    expect(litIn('Aspect ratio presets')).toEqual(['9:16'])
    expect(litEverywhere()).toEqual(['9:16'])
  })

  it('lights no platform chip from the generic row either, because the crop is the same', () => {
    loadSource()
    tap('1:1')
    // The panel once passed `null` to every platform row, and a user who picked
    // a platform preset saw nothing change; the fix for that was to light all
    // twenty-two matches at once, which is the defect this is. The honest middle
    // is a row of unpressed toggles and one pressed chip above them.
    expect(litIn('1:1 presets')).toEqual([])
    expect(litEverywhere()).toEqual(['1:1'])
  })

  it('says in words that the platform block is a way to set a crop, not a selection', () => {
    loadSource()
    // "Nothing is lit" is a claim the panel has to make in words, or a first-time
    // reader takes it for a row that has stopped working.
    expect(harness.container.textContent).toContain(
      'Every chip here sets the same crop. The lit ratio above is the shape the canvas is showing.',
    )
  })

  it('lights the print chip whose size the crop now is, and prints its millimetres', () => {
    loadSource()
    tap('4 × 6 in')
    // 101.6/152.4 is 2:3 exactly, so the print row is honest about the shape it
    // would produce — and it is the one row here that still lights beside the
    // generic one, because a size in millimetres is a *different* fact from a
    // ratio and the one the export will actually honour.
    expect(litIn('Print sizes')).toEqual(['4 × 6 in'])
    expect(litIn('2:3 presets')).toEqual([])
    expect(litEverywhere()).toEqual(['2:3', '4 × 6 in'])
    expect(chip('4 × 6 in').textContent).toContain('101.6 × 152.4 mm')
  })

  it('stops claiming a ratio "Reset crop" released', () => {
    loadSource()
    tap('16:9')
    expect(litIn('16:9 presets')).toEqual([])
    resetCrop()
    // The lock is still 16:9 — "Reset crop" moves the box, not the lock — and the
    // panel used to read the lock, so it kept lighting a 16:9 that the canvas
    // readout was no longer honouring. The full frame of a 3:2 photo is 3:2, so
    // that is what every row says now.
    expect(aspectLock()).toBeCloseTo(16 / 9, 6)
    expect(litIn('16:9 presets')).toEqual([])
    expect(litIn('Aspect ratio presets')).toEqual(['3:2'])
  })

  it('stops the W:H field claiming a ratio the crop no longer honours', () => {
    loadSource()
    const field = byLabel('Custom aspect ratio') as HTMLInputElement
    typeInto(field, '16:9')
    expect(field.value).toBe('16:9')
    resetCrop()
    expect(field.value).toBe('')
    // And the error state goes with it: the field is no longer claiming anything.
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })

  it('keeps a W:H that the crop still honours', () => {
    loadSource()
    const field = byLabel('Custom aspect ratio') as HTMLInputElement
    typeInto(field, '1:1')
    expect(field.value).toBe('1:1')
    expect(litIn('Aspect ratio presets')).toEqual(['1:1'])
    expect(litIn('1:1 presets')).toHaveLength(0)
  })
})

describe('the platform block is six shapes, not seven near-identical words', () => {
  it('has one row per ratio, holding every platform that offers it', () => {
    loadSource()
    const rows = platformShapeRows()
    expect(rows.map((row) => row.label)).toEqual(['1:1', '4:5', '1.91:1', '9:16', '16:9', '2:3'])
    // Every one of the twenty-two presets is still one tap away, under the
    // platform's own name: the collapse moved the rows, it did not lose a chip.
    const total = rows.reduce((sum, row) => sum + allIn(`${row.label} presets`).length, 0)
    expect(total).toBe(22)
    for (const row of rows) {
      expect(allIn(`${row.label} presets`)).toEqual(row.presets.map((preset) => preset.label))
    }
  })

  it('gives every platform chip the shape of its own row', () => {
    loadSource()
    for (const row of platformShapeRows()) {
      const group = harness.container.querySelector(`[aria-label="${row.label} presets"]`)
      if (!group) throw new Error(`no group for ${row.label}`)
      const frames = Array.from(group.querySelectorAll('button'))
        .map((button) => frameOf(button))
        .filter((frame): frame is HTMLElement => frame !== null)
      expect(frames).toHaveLength(row.presets.length)
      // 20px on the long edge, proportionally shorter on the other, so the
      // printed box *is* the ratio: a square frame would make all six rows the
      // same silhouette, which is the one thing a viewfinder must never be.
      for (const frame of frames) {
        expect(framePx(frame, 'width') / framePx(frame, 'height'), row.label).toBeCloseTo(
          row.aspect,
          6,
        )
      }
    }
  })

  it('draws the open-corner mark for the one chip that makes no ratio claim', () => {
    loadSource()
    // A fake frame beside eight real ones is worse than no frame, because it is
    // the one the eye cannot check. `Free` is the one such chip now rather than
    // two — `Original` and `Free` were the same control under two names — and it
    // draws open corners rather than nothing: no edge, so no shape claimed. It
    // is told apart from the shapes by the dashed outline as well.
    const free = chip('Free')
    expect(free.querySelector('svg')?.querySelector('rect')).toBeNull()
    expect(free.querySelectorAll('polyline')).toHaveLength(4)
    expect(free.className).toMatch(/unlocked/)
    // Every other chip in the generic row is a closed rectangle with division
    // bars, so the one that is not is unmistakable in both directions.
    for (const label of ['1:1', '4:5', '3:2', '16:9', '9:16', '2:3', '5:7', '4:3']) {
      expect(chip(label).querySelector('svg')?.querySelector('rect'), label).not.toBeNull()
    }
    // And the word the merge removed is not on screen anywhere in the panel.
    expect(document.body.textContent).not.toContain('Original')
    // The print sizes are pages, not photographs.
    expect(chip('A4').querySelector('svg')).not.toBeNull()
  })
})

/* ==========================================================================
   The custom-ratio row, as a control.

   jsdom has no layout engine: `getBoundingClientRect` is 0×0 for every element
   and `scrollWidth`/`clientWidth` are both 0, so an assertion of "the icon is
   18×18" written here would pass on an icon that renders at 0×0 — which is what
   it did. The measurement is in a real browser; the diff is in the handoff.

   What this file can honestly check is the two things the measurement depends
   on: that the markup is the shape the stylesheet's selectors name, and that
   the stylesheet the build ships really does give that markup a size and a skin.
   ========================================================================== */

const TOOLS_CSS = readFileSync(
  resolve(process.cwd(), 'src/components/tools/tools.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

describe('the custom-ratio row is a control, not a hole in the panel', () => {
  const swap = () =>
    harness.container.querySelector<HTMLButtonElement>('[aria-label="Swap ratio sides"]')
  const field = () =>
    harness.container.querySelector<HTMLInputElement>('[aria-label="Custom aspect ratio"]')

  it('renders the swap control as one glyph and nothing else', () => {
    // The connective step between the two rules below: a `.textButton` rule that
    // sizes `svg` is only a claim until the button really is a `.textButton`
    // wrapping an `<svg>` and nothing else. It is an icon-only button — no
    // caption, no `aria-hidden` on the glyph's sibling — which is exactly why a
    // zero-sized glyph left a visible empty rectangle rather than a small gap.
    const button = swap()
    expect(button?.querySelectorAll('svg')).toHaveLength(1)
    expect(button?.textContent?.trim() ?? '').toBe('')
    expect(button?.getAttribute('type')).toBe('button')
    // Three drawable primitives: the axis and two arrowheads.
    expect(button?.querySelector('svg')?.children.length).toBe(3)
  })

  it('gives every `.textButton` glyph a size that follows the icon scale', () => {
    const at = TOOLS_CSS.indexOf('.textButton svg {')
    expect(at, '.textButton svg is declared').toBeGreaterThan(-1)
    const rule = TOOLS_CSS.slice(at, TOOLS_CSS.indexOf('}', at))
    // Without a width there is nothing for the UA's default `300×150` to
    // shrink: the `<svg>` resolved to `0 × 0` and the button rendered as an empty
    // rounded rectangle with an accessible name and no visible mark.
    expect(rule).toMatch(/width:\s*calc\(\d+px \* var\(--icon-scale\)\)/)
    expect(rule).toMatch(/height:\s*calc\(\d+px \* var\(--icon-scale\)\)/)
    expect(rule).toMatch(/flex-shrink:\s*0/)
  })

  it('skins the ratio field with the panel’s own tokens, at every text size', () => {
    // `.grow` is a width, not a skin, and this was the only bare `<input>` left
    // in a tool panel: with no rule of its own it took the UA default —
    // `background: #fff`, `color: #000`, `2px inset`, `border-radius: 0`, 13.33px
    // type — so a white Windows text box sat on the editor's near-black chrome
    // and its type ignored `--text-scale`, and so the reader's text size too.
    expect(field()?.getAttribute('type'), 'the selector the rule names').toBe('text')
    const at = TOOLS_CSS.indexOf(".grow[type='text'],")
    expect(at, ".grow[type='text'] is declared").toBeGreaterThan(-1)
    const rule = TOOLS_CSS.slice(at, TOOLS_CSS.indexOf('}', at))
    for (const token of [
      'var(--ie-hairline)',
      'var(--ie-fill-rest)',
      'var(--ie-ink)',
      'var(--radius-sm)',
    ]) {
      expect(rule, token).toContain(token)
    }
    expect(rule).toMatch(/font-size:\s*calc\(0\.8125rem \* var\(--text-scale\)\)/)
    expect(rule).toMatch(/min-height:\s*calc\(40px \* var\(--density-factor\)\)/)
    // The placeholder was `2px` from the border, which is why "W:H" read as
    // jammed against the edge of the field.
    expect(rule).toMatch(/padding:\s*0 10px/)
    // Nothing in the app writes a font size in px, and nothing here may either.
    expect(rule).not.toMatch(/font-size:\s*[\d.]+px/)
  })

  it('states the field’s pair in both forced-colors grounds', () => {
    // `e2e/a11y.spec.ts` runs axe on both surfaces with an empty allowlist, so a
    // rule that names a brand colour and is then overwritten by the forced
    // palette is a pairing nobody contrast-checked. `Canvas` on `CanvasText` is
    // the pair the system defines.
    const forcedAt = TOOLS_CSS.indexOf('@media (forced-colors: active) {')
    const forced = TOOLS_CSS.slice(forcedAt)
    const ruleAt = forced.indexOf(".grow[type='text'],")
    expect(ruleAt, 'the forced-colors entry').toBeGreaterThan(-1)
    const rule = forced.slice(ruleAt, forced.indexOf('}', ruleAt))
    expect(rule).toContain('Canvas')
    expect(rule).toContain('CanvasText')
    const contrastAt = TOOLS_CSS.indexOf('@media (prefers-contrast: more) {')
    expect(contrastAt, 'the increased-contrast block').toBeGreaterThan(-1)
    expect(TOOLS_CSS.slice(contrastAt)).toContain(".grow[type='text']")
  })
})
