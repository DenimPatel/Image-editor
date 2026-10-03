import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rgbToHex } from '../../lib/curves'
import { hueToBand, hslToRgb } from '../../lib/hsl'
import { HSL_BANDS } from '../../model/defaults'
import type { HslBand } from '../../model/types'
import { useDocStore } from '../../store/docStore'
import { createHarness, pointerEvent, resetStores, setNativeValue } from '../../store/testHarness'
import { HslPanel } from './HslPanel'

const harness = createHarness()

const chips = () =>
  Array.from(harness.container.querySelectorAll<HTMLButtonElement>('[role="group"] button'))

const sliders = () =>
  Array.from(harness.container.querySelectorAll<HTMLInputElement>('input[type="range"]'))

const sliderLabels = () =>
  sliders().map((input) => input.closest('label')?.textContent?.trim().split(/\s/)[0] ?? '')

const resetButton = () =>
  harness.container.querySelector<HTMLButtonElement>('button:not([aria-pressed])')

const hsl = () => useDocStore.getState().present.hsl
const past = () => useDocStore.getState().past.length

/**
 * The middle of each band's hue range, written out again rather than imported.
 * `red` is the one wrapping band, so its middle is 0°, not 360°.
 */
const BAND_MIDDLE: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 230,
  purple: 290,
  magenta: 330,
}

/** The chroma and lightness every swatch is drawn at. */
const SWATCH_SATURATION = 0.66
const SWATCH_LIGHTNESS = 0.52

/** The colour a swatch paints, as `#rrggbb`. jsdom normalises to `rgb()` or not. */
function swatchColour(chip: HTMLElement): string {
  const style = chip.getAttribute('style') ?? ''
  const rgbMatch = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(style)
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch
    return rgbToHex(Number(r), Number(g), Number(b))
  }
  return (style.match(/#[0-9a-f]{6}/i)?.[0] ?? '').toLowerCase()
}

function choose(label: string) {
  const chip = chips().find((button) => button.textContent?.trim().endsWith(label))
  if (!chip) throw new Error(`no chip named ${label}`)
  act(() => chip.click())
}

function press(target: Element, k: string) {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

/** A complete gesture: open the undo span, move, close it. */
function dragSlider(index: number, value: number) {
  const input = sliders()[index]
  act(() => {
    input.dispatchEvent(pointerEvent('pointerdown'))
  })
  act(() => {
    setNativeValue(input, String(value))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  act(() => {
    input.dispatchEvent(pointerEvent('pointerup'))
  })
}

function hint() {
  return harness.container.querySelector('p')?.textContent ?? ''
}

beforeEach(() => {
  resetStores()
  harness.render(<HslPanel />)
})

afterEach(() => harness.unmount())

describe('the eight colour bands are all on screen, each with its own swatch', () => {
  it('offers a chip for every band in the model, in the order the shader numbers them', () => {
    expect(chips()).toHaveLength(8)
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual([
      'Red',
      'Orange',
      'Yellow',
      'Green',
      'Aqua',
      'Blue',
      'Purple',
      'Magenta',
    ])
    // A chip per band is the point: a band added to the model and not rendered
    // here is a band the user cannot reach in the app.
    expect(chips()).toHaveLength(HSL_BANDS.length)
  })

  it('samples each swatch from the hue the shader gives that band', () => {
    for (const chip of chips()) {
      const band = chip.textContent?.trim()!.toLowerCase() as HslBand
      const { r, g, b } = hslToRgb(BAND_MIDDLE[band], SWATCH_SATURATION, SWATCH_LIGHTNESS)
      expect(swatchColour(chip.querySelector('span') as HTMLElement), band).toBe(rgbToHex(r, g, b))
    }
  })

  it('never paints two bands the same colour', () => {
    const fills = chips().map((chip) => swatchColour(chip.querySelector('span') as HTMLElement))
    expect(new Set(fills).size).toBe(HSL_BANDS.length)
  })

  it('keeps the swatch out of the accessible name, so the name is still the band', () => {
    for (const chip of chips()) {
      const name = chip.textContent?.trim()
      expect(name).toMatch(/^[A-Z][a-z]+$/)
      const swatch = chip.querySelector('span') as HTMLElement
      expect(swatch.getAttribute('aria-hidden')).toBe('true')
      expect(swatch.textContent).toBe('')
      // No `aria-label` at all: the name is the text, so the two cannot disagree.
      expect(chip.getAttribute('aria-label')).toBeNull()
    }
  })

  it('swatches the band by a hue that really lands in that band', () => {
    for (const [index, band] of HSL_BANDS.entries()) {
      const middle = BAND_MIDDLE[band]
      const lands = band === 'red' ? middle >= 345 || middle < 15 : hueToBand(middle) === band
      expect(lands, `${band} @ ${middle}°`).toBe(true)
      expect(chips()[index].textContent?.trim()).toBe(band[0].toUpperCase() + band.slice(1))
    }
  })
})

describe('the three targets name themselves and show the stored value', () => {
  it('is hue, saturation and lightness, not hue, saturation and luminance', () => {
    // The third target is HSL *lightness* (`hsl.z`). Calling it luminance names
    // a different quantity from the one the slider moves.
    expect(sliderLabels()).toEqual(['Hue', 'Saturation', 'Lightness'])
  })

  it('reads the value out of the document for the selected band', () => {
    expect(sliders().map((input) => input.value)).toEqual(['0', '0', '0'])
    act(() => {
      useDocStore
        .getState()
        .update((doc) => ({ ...doc, hsl: { ...doc.hsl, red: { hue: 12, sat: -30, lum: 0 } } }))
    })
    expect(sliders().map((input) => input.value)).toEqual(['12', '-30', '0'])
  })

  it('carries the unit each target is measured in', () => {
    expect(sliders()[0].min).toBe('-30')
    expect(sliders()[0].max).toBe('30')
    expect(sliders()[1].min).toBe('-100')
    expect(sliders()[2].max).toBe('100')
    expect(harness.container.textContent).toMatch(/0°/)
    expect(harness.container.textContent).toMatch(/0%/)
  })

  it('switches band, and with it the three values', () => {
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        hsl: { ...doc.hsl, red: { hue: 12, sat: 0, lum: 0 }, aqua: { hue: 0, sat: 0, lum: -8 } },
      }))
    })
    choose('Aqua')
    expect(sliders().map((input) => input.value)).toEqual(['0', '0', '-8'])
  })

  it('marks the selected band pressed and the rest not', () => {
    expect(chips().filter((chip) => chip.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true')
    choose('Blue')
    expect(chips()[5].getAttribute('aria-pressed')).toBe('true')
    expect(chips()[0].getAttribute('aria-pressed')).toBe('false')
  })
})

describe('an edit goes through the store, and undo takes it back', () => {
  it('writes the edited band and leaves the other seven alone', () => {
    dragSlider(1, 40)
    expect(hsl().red).toEqual({ hue: 0, sat: 40, lum: 0 })
    for (const band of HSL_BANDS.filter((candidate) => candidate !== 'red')) {
      expect(hsl()[band], band).toEqual({ hue: 0, sat: 0, lum: 0 })
    }
  })

  it('writes the band that is selected, not the first one', () => {
    choose('Green')
    dragSlider(2, -25)
    expect(hsl().green).toEqual({ hue: 0, sat: 0, lum: -25 })
    expect(hsl().red).toEqual({ hue: 0, sat: 0, lum: 0 })
  })

  it('pushes one undo step per drag and undoes back to neutral', () => {
    dragSlider(0, 10)
    dragSlider(0, 20)
    expect(past()).toBe(2)
    act(() => useDocStore.getState().undo())
    expect(hsl().red.hue).toBe(10)
    act(() => useDocStore.getState().undo())
    expect(hsl().red.hue).toBe(0)
  })

  it('closes the interaction span on pointerup, so a drag is one step', () => {
    const input = sliders()[0]
    act(() => {
      input.dispatchEvent(pointerEvent('pointerdown'))
    })
    expect(useDocStore.getState().interaction.key).toBe('hsl:red:hue')
    act(() => {
      input.dispatchEvent(pointerEvent('pointerup'))
    })
    expect(useDocStore.getState().interaction.key).toBeNull()
  })

  it('names the band in the interaction key, so two bands do not coalesce', () => {
    choose('Blue')
    dragSlider(1, 15)
    choose('Red')
    dragSlider(1, 15)
    expect(past()).toBe(2)
  })

  it('marks a band the user has touched, and only that band', () => {
    const edited = () =>
      chips()
        .map((chip) =>
          chip.getAttribute('data-edited') === 'true' ? chip.textContent?.trim() : null,
        )
        .filter(Boolean)
    expect(edited()).toEqual([])
    dragSlider(1, 30)
    expect(edited()).toEqual(['Red'])
    choose('Aqua')
    dragSlider(0, -5)
    expect(edited()).toEqual(['Red', 'Aqua'])
  })
})

describe('resetting a band', () => {
  it('is disabled until the band has something to reset', () => {
    expect(resetButton()?.textContent).toBe('Reset Red')
    expect(resetButton()?.disabled).toBe(true)
    dragSlider(1, 30)
    expect(resetButton()?.disabled).toBe(false)
  })

  it('puts the three numbers back to zero through the store, in one undo step', () => {
    dragSlider(0, 8)
    dragSlider(1, 30)
    dragSlider(2, -12)
    const before = past()
    act(() => resetButton()?.click())
    expect(hsl().red).toEqual({ hue: 0, sat: 0, lum: 0 })
    expect(past()).toBe(before + 1)
  })

  it('names the band it resets, and follows the selection', () => {
    choose('Purple')
    expect(resetButton()?.textContent).toBe('Reset Purple')
  })
})

describe('the grid is a keyboard-reachable group', () => {
  it('is one named group of toggle buttons with a single tab stop', () => {
    const group = harness.container.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('Colour bands')
    expect(chips().filter((chip) => chip.tabIndex === 0)).toHaveLength(1)
    expect(chips()[0].tabIndex).toBe(0)
  })

  it('is named for the eight bands, not for one of them', () => {
    // "Color band" was the group's name and one band's name at the same time, and
    // "Color" was the wrong side of the Atlantic on top of that. The group holds
    // all eight, so it says so.
    const group = harness.container.querySelector('[role="group"]')!
    expect(group.getAttribute('aria-label')).not.toBe('Color band')
    expect(chips()).toHaveLength(8)
  })

  it('moves the selection, the tab stop and focus together, in both axes', () => {
    press(chips()[0], 'ArrowRight')
    expect(chips()[1].getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(chips()[1])
    expect(chips()[1].tabIndex).toBe(0)
    // The grid wraps, so a down-arrow has to move too — or the bottom row is
    // only reachable by arrowing off the end of the row.
    press(chips()[1], 'ArrowDown')
    expect(chips()[2].getAttribute('aria-pressed')).toBe('true')
    press(chips()[4], 'End')
    expect(chips()[7].getAttribute('aria-pressed')).toBe('true')
    press(chips()[7], 'ArrowRight')
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('leaves a key it does not handle to the browser', () => {
    const event = press(chips()[0], 'a')
    expect(event.defaultPrevented).toBe(false)
    expect(chips()[0].getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the panel describes the model it actually implements', () => {
  it('says which band is being edited, and that the bands do not blend', () => {
    expect(hint()).toMatch(/Editing the Red band/)
    expect(hint()).toMatch(/no blending/)
    choose('Magenta')
    expect(hint()).toMatch(/Editing the Magenta band/)
  })

  it('does not claim anything about the portrait tools', () => {
    // There is no portrait tool in this app, and `applyHslMix` has no call site
    // outside the test that pins it, so the sentence the hint used to carry was
    // not checkable and was not true.
    expect(harness.container.textContent).not.toMatch(/portrait/i)
  })

  it('spells colour the way the rest of the app does', () => {
    // The panel's text must carry no American spelling. The assertion used to be
    // the other way round — it forbade `colour` — which is the opposite of what
    // its own title claims and of what the rest of this app writes: the
    // orientation panel, the import screen, the hub and the passport rules all
    // say "colour". The product settled on one spelling (`src/lib/copy.ts`), and
    // this is the half of it that is local: the words on this panel.
    expect(harness.container.textContent).not.toMatch(/\bcolors?\b/i)
    // …and where the panel has to name the thing it edits, it names it.
    expect(hint()).toMatch(/a colour that sits between two/)
  })
})
