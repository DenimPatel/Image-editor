import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_ADJUST_KEYS } from '../../lib/auto'
import { ADJUST_SPECS } from '../../model/defaults'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores } from '../../store/testHarness'
import { AdjustPanel } from './AdjustPanel'

const harness = createHarness()

const section = (name: string) =>
  harness.container.querySelector<HTMLButtonElement>(`[aria-label="Adjustment section"] button`)
    ? Array.from(
        harness.container.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Adjustment section"] button',
        ),
      ).find((button) => button.textContent === name)!
    : undefined

function show(name: string) {
  act(() => section(name)?.click())
}

const button = (label: string) =>
  Array.from(harness.container.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.textContent?.trim() === label,
  )

const explanation = () => harness.container.querySelector('[data-adjust-explanation]')

const NO_SOURCE = { width: 800, height: 600 } as never as ImageBitmap

beforeEach(() => {
  resetStores()
  harness.render(<AdjustPanel source={NO_SOURCE} onAuto={() => {}} />)
})

afterEach(() => harness.unmount())

describe('the three sub-panels are reachable and named', () => {
  it('offers Sliders, Curves and Colour bands, and only those three', () => {
    const names = Array.from(
      harness.container.querySelectorAll('[aria-label="Adjustment section"] button'),
    ).map((node) => node.textContent)
    expect(names).toEqual(['Sliders', 'Curves', 'Colour bands'])
  })

  it('starts on Sliders and swaps to the panel that was asked for', () => {
    expect(harness.container.querySelector('[role="toolbar"]')).not.toBeNull()
    show('Curves')
    expect(harness.container.querySelector('[role="toolbar"]')).toBeNull()
    expect(
      harness.container.querySelector('[role="group"][aria-label="Curve channel"]'),
    ).not.toBeNull()
    show('Colour bands')
    expect(harness.container.querySelector('[aria-label="Colour bands"]')).not.toBeNull()
  })

  it('spells Colour bands the way the rest of the app does, and never Color Mix', () => {
    // The rename is only worth making if it is complete: a panel whose segmented
    // control says "Colour bands" while its own group is labelled "Color band"
    // holds two vocabularies at once, which is the defect the decision removed.
    expect(harness.container.textContent).not.toMatch(/color/i)
    expect(harness.container.textContent).toMatch(/colour/i)
    expect(harness.container.querySelector('[aria-label="Color band"]')).toBeNull()
    show('Colour bands')
    expect(harness.container.querySelector('[aria-label="Color band"]')).toBeNull()
    expect(harness.container.querySelector('[aria-label="Colour bands"]')).not.toBeNull()
  })

  it('writes the units of every readout with a space before a letter unit', () => {
    // `DialSlider` and `ParameterRow` concatenate, so the panel spaces the unit
    // itself: the dial beside Exposure must read "0 EV", never "0EV".
    expect(harness.container.querySelector('[aria-valuetext="0 EV"]')).not.toBeNull()
    expect(harness.container.textContent).not.toMatch(/\dEV/)
  })
})

describe('the Auto button says what it does', () => {
  it('is no longer a bare "Auto", which read as auto for the selected slider', () => {
    expect(button('Auto')).toBeUndefined()
    expect(button('Auto tone')).toBeDefined()
  })

  it('names all six parameters it sets, and they are the six auto really writes', () => {
    const title = button('Auto tone')?.getAttribute('title') ?? ''
    expect(title).toContain('Exposure')
    expect(title).toContain('Brightness')
    expect(title).toContain('Black Point')
    expect(title).toContain('Contrast')
    expect(title).toContain('Highlights')
    expect(title).toContain('Shadows')
    // If Auto ever grows or loses a key, the sentence under the button has to
    // follow it, or the button starts lying about what it touches.
    expect(AUTO_ADJUST_KEYS).toHaveLength(6)
    expect(title).toMatch(new RegExp(`Sets ${AUTO_ADJUST_KEYS.length} sliders`))
    for (const key of AUTO_ADJUST_KEYS) {
      const label = ADJUST_SPECS.find((spec) => spec.key === key)!.label
      expect(title, key).toContain(label)
    }
  })

  it('says what it leaves alone, and that it overwrites the selected parameter', () => {
    const title = button('Auto tone')?.getAttribute('title') ?? ''
    expect(title).toContain('left alone')
    expect(title).toMatch(/whole photo/)
  })

  it('still runs the handler it was given', () => {
    harness.unmount()
    const onAuto = vi.fn()
    harness.render(<AdjustPanel source={NO_SOURCE} onAuto={onAuto} />)
    act(() => button('Auto tone')?.click())
    expect(onAuto).toHaveBeenCalledTimes(1)
  })

  it('is not offered at all when there is nothing to run', () => {
    harness.unmount()
    harness.render(<AdjustPanel source={NO_SOURCE} />)
    expect(button('Auto tone')).toBeUndefined()
  })
})

describe('the two adjustments that cannot be told apart explain themselves', () => {
  it('puts one line under Brilliance and one under Brightness, and none under the rest', () => {
    const explained = () =>
      Array.from(harness.container.querySelectorAll('[data-adjust-explanation]')).map((node) =>
        node.getAttribute('data-adjust-explanation'),
      )
    expect(explained()).toEqual([])

    act(() => useUiStore.getState().selectAdjustKey('brilliance'))
    expect(explained()).toEqual(['brilliance'])
    expect(explanation()?.textContent).toBe(
      'The same offset as Brightness, weighted to the midtones — it falls away in the deepest shadows and in the brightest highlights.',
    )

    act(() => useUiStore.getState().selectAdjustKey('brightness'))
    expect(explained()).toEqual(['brightness'])
    expect(explanation()?.textContent).toBe(
      'A flat offset added to every pixel, shadows and highlights alike.',
    )
  })

  it('says nothing about the other thirteen, which do not need it', () => {
    for (const spec of ADJUST_SPECS) {
      if (spec.key === 'brilliance' || spec.key === 'brightness') continue
      act(() => useUiStore.getState().selectAdjustKey(spec.key))
      expect(explanation(), spec.key).toBeNull()
    }
  })

  it('tells the two apart in terms of what each does to a pixel', () => {
    act(() => useUiStore.getState().selectAdjustKey('brilliance'))
    const brilliance = explanation()!.textContent ?? ''
    act(() => useUiStore.getState().selectAdjustKey('brightness'))
    const brightness = explanation()!.textContent ?? ''
    // `TONE_FRAG` runs `c += u_brightness * 0.25` and then
    // `c += u_brilliance * 0.25 * mid`: same offset, different mask. A reader
    // has to be able to tell that from two labels and two zeroes.
    expect(brilliance).toMatch(/midtones/i)
    expect(brightness).toMatch(/flat offset/i)
    expect(brilliance).not.toBe(brightness)
  })
})

describe('the sliders section wires the rings to the dial', () => {
  it('renders one ring per adjustment, each with its own glyph', () => {
    const rings = harness.container.querySelectorAll('[role="toolbar"] button')
    expect(rings).toHaveLength(ADJUST_SPECS.length)
    // The ring draws two `<svg>`s: the progress arc, then the glyph. The glyph
    // is the one `AdjustIcon` renders, and it is last in the ring's markup.
    const marks = Array.from(rings).map((ring) => {
      const svgs = ring.querySelectorAll('svg')
      return svgs[svgs.length - 1]?.innerHTML ?? ''
    })
    // Fifteen rings, fifteen different marks: the generic glyph repeated fifteen
    // times looked meaningful and said nothing.
    expect(new Set(marks).size).toBe(ADJUST_SPECS.length)
    for (const [index, ring] of Array.from(rings).entries()) {
      expect(marks[index], ring.getAttribute('aria-label') ?? '').not.toBe('')
    }
  })

  it('re-titles the dial and the reset button to the ring that was picked', () => {
    act(() => useUiStore.getState().selectAdjustKey('vignette'))
    expect(harness.container.querySelector('[role="slider"]')?.getAttribute('aria-label')).toBe(
      'Vignette',
    )
    expect(button('Reset Vignette')).toBeDefined()
  })

  it('writes a dial edit through the store', () => {
    act(() => useUiStore.getState().selectAdjustKey('exposure'))
    act(() => {
      const dial = harness.container.querySelector('[role="slider"]')!
      dial.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
      dial.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
    })
    expect(useDocStore.getState().present.adjust.exposure).toBeGreaterThan(0)
  })
})
