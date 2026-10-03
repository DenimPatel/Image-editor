import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ASPECT_PRESETS,
  PLATFORM_GROUPS,
  PRINT_SIZES,
  platformShapeRows,
} from '../../lib/crop/presets'
import { createHarness, resetStores } from '../../store/testHarness'
import { PAGE, RatioChip, RatioChipRow, UNLOCKED, type RatioChipOption } from './RatioChip'
import styles from '../tools/ratioChips.module.css'

const harness = createHarness()

/** Every ratio the app can put on a chip, from every table that offers one. */
const catalogueRatios: { label: string; ratio: number }[] = [
  ...ASPECT_PRESETS.filter((preset) => preset.aspect !== null).map((preset) => ({
    label: preset.label,
    ratio: preset.aspect as number,
  })),
  ...PLATFORM_GROUPS.flatMap((group) =>
    group.presets.map((preset) => ({ label: preset.label, ratio: preset.aspect })),
  ),
  ...PRINT_SIZES.map((size) => ({
    label: size.label,
    ratio: size.widthMm / size.heightMm,
  })),
]

const option = (over: Partial<RatioChipOption> = {}): RatioChipOption => ({
  value: 'v',
  label: '4:5',
  shape: { kind: 'viewfinder', ratio: 4 / 5 },
  ...over,
})

const render = (element: JSX.Element) => harness.render(element)

/** The box a chip's shape occupies, read off the SVG's own parent. */
const frameOf = (element: Element): HTMLElement | null =>
  (element.querySelector('svg')?.parentElement as HTMLElement | null) ?? null

/** A frame's authored size in px, out of the `calc()` the chip writes. */
const framePx = (frame: HTMLElement, name: 'width' | 'height'): number =>
  Number.parseFloat(/(-?[\d.]+)px/.exec(frame.style.getPropertyValue(name))?.[1] ?? 'NaN')

afterEach(() => harness.unmount())

beforeEach(() => {
  resetStores()
})

describe('the shape is a drawn viewfinder, not a character', () => {
  it('sizes the frame to the ratio, so 16:9 really is 16:9 and not a square', () => {
    render(
      <RatioChip
        option={option({ label: '16:9', shape: { kind: 'viewfinder', ratio: 16 / 9 } })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    const frame = frameOf(harness.container)
    if (!frame) throw new Error('the chip drew no shape')
    expect(framePx(frame, 'width') / framePx(frame, 'height')).toBeCloseTo(16 / 9, 6)
    // A square box would make every ratio in the row the same silhouette, which
    // is the one thing a viewfinder must never be.
    expect(framePx(frame, 'width')).not.toBeCloseTo(framePx(frame, 'height'), 3)
  })

  it('never clamps a frame the app can actually ask for', () => {
    // 9:16 is the narrowest and 1.91:1 the widest shape in the catalogue; both
    // are inside the frame's own limits, so every chip is drawn at its true
    // proportion rather than at a clamped one.
    expect(catalogueRatios.length).toBeGreaterThan(30)
    for (const { label, ratio } of catalogueRatios) {
      render(
        <RatioChip
          option={option({ label, shape: { kind: 'viewfinder', ratio } })}
          selected={false}
          onSelect={() => {}}
        />,
      )
      const frame = frameOf(harness.container)
      if (!frame) throw new Error(`${label} drew no shape`)
      expect(framePx(frame, 'width') / framePx(frame, 'height'), label).toBeCloseTo(ratio, 6)
      harness.render(<div />)
    }
  })

  it('clamps a ratio nothing in the app offers, rather than a four-hundred-pixel chip', () => {
    // The custom W:H field takes any two positive numbers, and a catalogue entry
    // can be added later, so the frame has a limit of its own. A clamped frame is
    // a shape that is not the ratio, which is why every chip carries its label.
    render(
      <RatioChip
        option={option({ label: '40:1', shape: { kind: 'viewfinder', ratio: 40 } })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    const frame = frameOf(harness.container)
    if (!frame) throw new Error('no shape')
    expect(framePx(frame, 'width') / framePx(frame, 'height')).toBeLessThan(3)
    expect(framePx(frame, 'width')).toBeLessThanOrEqual(24)
  })

  it('holds the stroke at one weight as the proportion changes', () => {
    // `non-scaling-stroke` is what pins 1:1 and 16:9 to the same optical weight
    // inside one row. It is the glyph's job, inherited from the icon module, and
    // this is the assertion that the chip is drawing *that* glyph.
    const at = (ratio: number) => {
      render(
        <RatioChip
          option={option({ shape: { kind: 'viewfinder', ratio } })}
          selected={false}
          onSelect={() => {}}
        />,
      )
      return harness.container.innerHTML
    }
    const square = at(1)
    const wide = at(16 / 9)
    expect(square).toContain('vector-effect="non-scaling-stroke"')
    expect(wide).toContain('vector-effect="non-scaling-stroke"')
    // And the bars really do move, or the glyph is lying about the ratio.
    expect(wide).not.toBe(square)
  })

  it('draws nothing that could render as tofu', () => {
    // The geometric-shape and box-drawing characters have patchy coverage across
    // DejaVu, Segoe UI Symbol, Apple Symbols and Android `system-ui`, and a
    // missing glyph is a hollow box — which on a screen full of rectangles is
    // also the universal symbol for "square". There is no character for 16:9 at
    // all, so the shapes cannot be characters in the first place.
    const forbidden = /[─-╿⺀-⻿⬀-⯿←-⇿⌀-⏿]/
    for (const { label, ratio } of catalogueRatios) {
      render(
        <RatioChip
          option={option({ label, shape: { kind: 'viewfinder', ratio } })}
          selected={false}
          onSelect={() => {}}
        />,
      )
      expect(harness.container.textContent ?? '', label).not.toMatch(forbidden)
      // A real SVG on the shared 24 grid, not a glyph in a font.
      const svg = harness.container.querySelector('svg')
      expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
      expect(svg?.querySelectorAll('rect').length ?? 0).toBeGreaterThan(0)
      harness.render(<div />)
    }
  })
})

describe('the text is the authority the shape sits beside', () => {
  it('announces the label alone, because the glyph is decorative', () => {
    render(
      <RatioChip
        option={option({ label: 'Instagram Story 9:16' })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    const button = harness.container.querySelector('button')
    expect(button?.textContent).toBe('Instagram Story 9:16')
    expect(harness.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('prints a print size’s millimetres as a second line', () => {
    render(
      <RatioChip
        option={option({ label: '4 × 6 in', detail: '101.6 × 152.4 mm', shape: PAGE })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    expect(harness.container.textContent).toBe('4 × 6 in101.6 × 152.4 mm')
    expect(harness.container.querySelector('svg')).not.toBeNull()
  })
})

describe('the one chip that is not a ratio is told apart by drawing no rectangle', () => {
  it('draws the open-corner mark, and no closed frame beside the viewfinders', () => {
    // `Free` used to render an empty shape slot, so the one chip that makes no
    // shape claim was also the one chip with no mark — beside eight rectangles
    // that are all checkable against their labels, there was nothing for the eye
    // to compare it against. It draws four open corners now.
    render(
      <RatioChip
        option={option({ label: 'Free', shape: UNLOCKED })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    const svg = harness.container.querySelector('svg')
    expect(svg).not.toBeNull()
    // No closed rectangle anywhere in the artwork: an open-corner mark is four
    // polylines, and the thing that would make it claim a shape is a `rect`.
    expect(svg?.querySelector('rect')).toBeNull()
    expect(svg?.querySelectorAll('polyline')).toHaveLength(4)

    // And it is unmistakably not one of the viewfinders, which are closed rects
    // with division bars — the same glyph would be a duplicate signature.
    render(
      <RatioChip
        option={option({ label: '1:1', shape: { kind: 'viewfinder', ratio: 1 } })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    expect(harness.container.querySelector('svg')?.querySelector('rect')).not.toBeNull()
  })

  it('carries the dashed outline, which is the one thing a dashed border reliably says', () => {
    render(
      <RatioChip
        option={option({ label: 'Free', shape: UNLOCKED })}
        selected={false}
        onSelect={() => {}}
      />,
    )
    const chip = harness.container.querySelector('button') as HTMLElement
    expect(chip.className.split(' ')).toContain(styles.unlocked)
  })
})

describe('a print size is a page, not a photograph', () => {
  it('uses one fixed mark for all five, so no size claims to be a camera frame', () => {
    const sizes: { label: string; width: number; height: number; markup: string }[] = []
    for (const size of PRINT_SIZES) {
      render(
        <RatioChip
          option={option({ label: size.label, shape: PAGE })}
          selected={false}
          onSelect={() => {}}
        />,
      )
      const frame = frameOf(harness.container)
      if (!frame) throw new Error(`${size.label} drew nothing`)
      sizes.push({
        label: size.label,
        width: framePx(frame, 'width'),
        height: framePx(frame, 'height'),
        markup: frame.innerHTML,
      })
    }
    expect(sizes).toHaveLength(5)
    for (const size of sizes.slice(1)) {
      expect(size.width, size.label).toBe(sizes[0]?.width)
      expect(size.height, size.label).toBe(sizes[0]?.height)
      expect(size.markup, size.label).toBe(sizes[0]?.markup)
    }
  })

  it('is not the viewfinder the same proportion would otherwise get', () => {
    // 4×6 in is 2:3, so a chip that drew it as a viewfinder would be byte for
    // byte the shape a 2:3 photo gets. A sheet and a photograph are different
    // claims about a picture and have to look different.
    const mark = (shape: RatioChipOption['shape']) => {
      render(<RatioChip option={option({ shape })} selected={false} onSelect={() => {}} />)
      return harness.container.innerHTML
    }
    const fourBySix = 101.6 / 152.4
    const page = mark(PAGE)
    const viewfinder = mark({ kind: 'viewfinder', ratio: fourBySix })
    expect(page).not.toBe(viewfinder)
    // The page is drawn as a sheet — a clipped corner and three lines of type —
    // and the viewfinder is a rectangle with division bars across it. They are
    // different shapes, which is the whole claim.
    expect(page).toContain('<polyline')
    expect(page).toContain('<path')
    expect(page).not.toContain('<rect')
    expect(viewfinder).toContain('<rect')
  })
})

describe('RatioChipRow is the group a screen reader reads and a finger scrolls', () => {
  const rows = [
    option({ value: 'a', label: 'Instagram 1:1', shape: { kind: 'viewfinder', ratio: 1 } }),
    option({ value: 'b', label: 'TikTok 1:1', shape: { kind: 'viewfinder', ratio: 1 } }),
    option({ value: 'c', label: 'X 4:5', shape: { kind: 'viewfinder', ratio: 4 / 5 } }),
  ]

  it('is a labelled group of buttons that report their own value', () => {
    const picked: string[] = []
    render(
      <RatioChipRow
        ariaLabel="1:1 presets"
        options={rows}
        selected={[]}
        onChange={(value) => picked.push(value)}
      />,
    )
    const group = harness.container.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('1:1 presets')
    act(() => {
      ;(group?.querySelectorAll('button')[1] as HTMLButtonElement).click()
    })
    expect(picked).toEqual(['b'])
  })

  it('lights every selected value, which is how a shape row reports five equal chips', () => {
    render(
      <RatioChipRow
        ariaLabel="1:1 presets"
        options={rows}
        selected={['a', 'b']}
        onChange={() => {}}
      />,
    )
    const pressed = Array.from(harness.container.querySelectorAll('[aria-pressed="true"]'))
    expect(pressed).toHaveLength(2)
    expect(pressed.map((button) => button.textContent)).toEqual(['Instagram 1:1', 'TikTok 1:1'])
  })

  it('fades the trailing edge only while there is more of the row to scroll to', () => {
    render(
      <RatioChipRow ariaLabel="1:1 presets" options={rows} selected={[]} onChange={() => {}} />,
    )
    const row = harness.container.querySelector('[role="group"]') as HTMLElement
    expect(row.className.split(' ')).not.toContain(styles.rowMore)

    // jsdom lays nothing out, so the row is told what it looks like.
    Object.defineProperty(row, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(row, 'scrollWidth', { value: 300, configurable: true })
    Object.defineProperty(row, 'scrollLeft', { value: 0, configurable: true, writable: true })
    act(() => {
      row.dispatchEvent(new Event('scroll'))
    })
    expect(row.className.split(' ')).toContain(styles.rowMore)

    // At the end of the row the last chip really is the last chip.
    act(() => {
      row.scrollLeft = 200
      row.dispatchEvent(new Event('scroll'))
    })
    expect(row.className.split(' ')).not.toContain(styles.rowMore)
  })

  it('renders a row it cannot measure, because the fade is an affordance', () => {
    // No ResizeObserver in jsdom, and no layout either: the row must still be a
    // group of chips rather than an error.
    expect(typeof ResizeObserver).toBe('undefined')
    render(
      <RatioChipRow
        ariaLabel="9:16 presets"
        options={platformShapeRows().map((row) =>
          option({
            value: row.key,
            label: row.label,
            shape: { kind: 'viewfinder', ratio: row.aspect },
          }),
        )}
        selected={[]}
        onChange={() => {}}
      />,
    )
    expect(harness.container.querySelectorAll('button')).toHaveLength(6)
  })
})
