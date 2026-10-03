import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCENTS,
  ACCENT_IDS,
  ACCENT_SURFACES,
  APPEARANCE_STORAGE_KEY,
  DENSITIES,
  DEFAULT_APPEARANCE,
  ICON_SCALES,
  MOTION_PREFERENCES,
  TEXT_SCALES,
  THEME_PREFERENCES,
  readAppearance,
  type Density,
} from '../../lib/appearance'
import { createHarness, resetStores } from '../../store/testHarness'
import { AppearanceMenu, AppearancePanel } from './AppearanceMenu'

/**
 * The appearance settings had a complete implementation, a complete stylesheet
 * and no way to reach any of it. These are the tests for the surface that
 * exposes it, and they are written to fail in the ways the absence would have
 * hidden: a control that is not labelled, a value that is not shown, a setting
 * that writes and is then believed, and a preview that disagrees with the
 * multiplier it is previewing.
 *
 * The "did the app actually change" question is not answerable in jsdom — there
 * is no cascade here — so it lives in `e2e/journey.appearance.spec.ts`, which
 * asserts a computed style. What jsdom *can* answer, and what this file
 * answers, is whether the control is real: named, checked, keyboard-reachable,
 * and writing the value it claims to write.
 */

const harness = createHarness()

const GROUPS = {
  theme: { legend: 'Theme', values: THEME_PREFERENCES },
  accent: { legend: 'Accent', values: ACCENT_IDS },
  density: { legend: 'Density', values: DENSITIES },
  textScale: { legend: 'Text size', values: TEXT_SCALES },
  motion: { legend: 'Motion', values: MOTION_PREFERENCES },
  iconScale: { legend: 'Icon size', values: ICON_SCALES },
} as const

type GroupId = keyof typeof GROUPS

const panel = () => harness.container.querySelector<HTMLElement>('[role="dialog"]')
const trigger = () => harness.container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')

/** Every radio in one group, in DOM order. */
function radios(group: GroupId): HTMLInputElement[] {
  const legend = GROUPS[group].legend
  const field = Array.from(panel()?.querySelectorAll('fieldset') ?? []).find(
    (node) => node.querySelector('legend')?.textContent === legend,
  )
  if (!field) throw new Error(`no fieldset for ${legend}`)
  return Array.from(field.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
}

const labelFor = (group: GroupId, index: number) => {
  const radio = radios(group)[index]
  return radio.getAttribute('aria-label') ?? ''
}

/** The visible part of a value's accessible name, e.g. `roomy` -> `Roomy`. */
const labelOf = (value: string) =>
  labelFor('density', DENSITIES.indexOf(value as Density)).split(': ')[1]

const resetButton = (root: HTMLElement | null = panel()) =>
  Array.from(root?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent === 'Reset to defaults',
  ) as HTMLButtonElement

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const menuCss = readFileSync(
  resolve(process.cwd(), 'src/components/ui/appearanceMenu.module.css'),
  'utf8',
)

function mount() {
  harness.render(<AppearanceMenu />)
}

function open() {
  act(() => trigger()?.click())
}

beforeEach(() => {
  resetStores()
  localStorage.clear()
  document.documentElement.removeAttribute('data-density')
  document.documentElement.removeAttribute('data-text')
  document.documentElement.removeAttribute('data-accent')
  document.documentElement.removeAttribute('data-icons')
  document.documentElement.removeAttribute('data-motion')
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  harness.unmount()
  vi.restoreAllMocks()
})

describe('a group is operable with the arrow keys', () => {
  it('arrows walk the group, wrap at both ends, and take focus with them', () => {
    // The APG radio-group pattern, implemented rather than borrowed: Chromium's
    // native arrows wrap, WebKit's do not — they go quiet on the second press in
    // the same group, because React changed `checked` and the browser's internal
    // navigation anchor never followed. Measured on both engines, same markup.
    mount()
    open()
    const field = radios('density')[0].closest('fieldset') as HTMLElement
    const press = (key: string) =>
      act(() => {
        field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })

    act(() => radios('density')[1].focus())
    for (const value of ['roomy', 'compact', 'default', 'roomy']) {
      press('ArrowDown')
      expect(radios('density').find((radio) => radio.checked)?.value, value).toBe(value)
      expect(document.activeElement?.getAttribute('aria-label'), value).toBe(
        `Density: ${labelOf(value)}`,
      )
    }
    press('ArrowUp')
    expect(radios('density').find((radio) => radio.checked)?.value).toBe('default')
    // Left is the same roving as Up, so a horizontal habit still works.
    press('ArrowLeft')
    expect(radios('density').find((radio) => radio.checked)?.value).toBe('compact')
    // And the document followed every one of them.
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
  })

  it('leaves keys that are not part of the pattern alone', () => {
    mount()
    open()
    const field = radios('motion')[0].closest('fieldset') as HTMLElement
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    act(() => {
      field.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    expect(readAppearance().motion).toBe(DEFAULT_APPEARANCE.motion)
  })
})

describe('the appearance menu opens, closes and behaves like a popover', () => {
  it('is not rendered until it is asked for', () => {
    mount()
    expect(panel()).toBeNull()
  })

  it('declares the dialog relationship on its trigger up front', () => {
    mount()
    const button = trigger()
    expect(button?.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
    expect(button?.getAttribute('aria-controls')).toBeNull()
    expect(button?.textContent).toBe('Appearance')
  })

  it('wires aria-expanded and aria-controls to the open panel', () => {
    mount()
    open()
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true')
    expect(trigger()?.getAttribute('aria-controls')).toBe(panel()?.id)
    expect(panel()?.id).toBeTruthy()
  })

  it('is a non-modal dialog with an accessible name, not a bare div', () => {
    mount()
    open()
    const dialog = panel()
    expect(dialog?.getAttribute('aria-modal')).toBe('false')
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    const heading = Array.from(panel()?.querySelectorAll('h2') ?? []).find(
      (node) => node.id === labelledBy,
    )
    expect(heading?.textContent).toBe('Appearance')
  })

  it('toggles closed on a second activation', () => {
    mount()
    open()
    open()
    expect(panel()).toBeNull()
  })

  it('opens on ArrowDown from the trigger, like the other menu in the app', () => {
    mount()
    act(() => trigger()?.focus())
    act(() => {
      trigger()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      )
    })
    expect(panel()).not.toBeNull()
  })

  it('moves focus to the panel on open and back to the trigger on close', () => {
    mount()
    act(() => trigger()?.focus())
    open()
    expect(document.activeElement).toBe(panel())
    act(() => panel()?.querySelector<HTMLButtonElement>('.x, button')?.click())
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes on Escape and hands focus back', () => {
    mount()
    // A real click focuses the button in every browser; jsdom's `click()` does
    // not, and the panel restores focus to whatever held it when it opened.
    act(() => trigger()?.focus())
    open()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('closes when focus walks out of it, so Tab is not a trap', () => {
    mount()
    open()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => outside.focus())
    expect(panel()).toBeNull()
    outside.remove()
  })

  it('has a real Close control, so it is not dismissable only by gesture', () => {
    mount()
    open()
    const close = Array.from(panel()?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Close',
    )
    expect(close).toBeDefined()
    act(() => close?.click())
    expect(panel()).toBeNull()
  })
})

describe('every control is labelled, and shows what it currently is', () => {
  beforeEach(() => {
    mount()
    open()
  })

  it('renders all six settings, each as a fieldset with a legend', () => {
    const legends = Array.from(panel()?.querySelectorAll('legend') ?? []).map(
      (node) => node.textContent,
    )
    expect(legends).toEqual([
      GROUPS.theme.legend,
      GROUPS.accent.legend,
      GROUPS.density.legend,
      GROUPS.textScale.legend,
      GROUPS.motion.legend,
      GROUPS.iconScale.legend,
    ])
  })

  it.each(Object.entries(GROUPS))('offers every %s option', (group) => {
    const spec = GROUPS[group as GroupId]
    expect(radios(group as GroupId)).toHaveLength(spec.values.length)
  })

  it.each(Object.entries(GROUPS))('names every %s option accessibly', (group) => {
    const legend = GROUPS[group as GroupId].legend
    for (const radio of radios(group as GroupId)) {
      const name = radio.getAttribute('aria-label') ?? ''
      // The group has to be in the name: three different settings are all
      // offered as "Default", and a bare "Default" is not an accessible name
      // anyone can act on.
      expect(name, radio.value).toMatch(new RegExp(`^${legend}: \\S`))
      // The label element carries visible text, so a sighted keyboard user and
      // a screen-reader user are being told the same thing.
      expect((radio.closest('label')?.textContent ?? '').length, radio.value).toBeGreaterThan(0)
    }
  })

  it('gives all nineteen radios a unique accessible name', () => {
    // This is what makes `getByRole('radio', { name })` usable at all, in the
    // e2e suite and in a screen reader's list of controls.
    const names = Array.from(panel()?.querySelectorAll('input[type="radio"]') ?? []).map(
      (radio) => radio.getAttribute('aria-label') ?? '',
    )
    expect(names).toHaveLength(19)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((name) => name.length > 0)).toBe(true)
  })

  it('names the accents by their catalogue labels, not by their ids', () => {
    expect(radios('accent').map((radio) => radio.getAttribute('aria-label'))).toEqual(
      ACCENTS.map((accent) => `Accent: ${accent.label}`),
    )
  })

  it.each(Object.entries(GROUPS))('shows the current %s value as the checked option', (group) => {
    const id = group as GroupId
    const checked = radios(id).filter((radio) => radio.checked)
    expect(checked).toHaveLength(1)
    expect(checked[0].value).toBe(DEFAULT_APPEARANCE[id])
    // The current option is marked visually as well, which is what a row of
    // words could never do.
    expect(checked[0].closest('label')?.getAttribute('data-current')).toBe('true')
  })

  it.each(Object.entries(GROUPS))('leaves every %s option keyboard-reachable', (group) => {
    for (const radio of radios(group as GroupId)) {
      expect(radio.disabled, labelFor(group as GroupId, 0)).toBe(false)
      expect(radio.tabIndex, radio.value).toBe(0)
      // Native radios in one `name` group are the browser's own arrow-key
      // roving, so the group is operable without any script at all.
      expect(radio.getAttribute('name')).toBeTruthy()
    }
  })

  it('reflects a stored value on open rather than showing the defaults', () => {
    harness.unmount()
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APPEARANCE, density: 'roomy', accent: 'violet' }),
    )
    mount()
    open()
    expect(radios('density').find((radio) => radio.checked)?.value).toBe('roomy')
    expect(radios('accent').find((radio) => radio.checked)?.value).toBe('violet')
  })
})

describe('a choice reaches the document and says so', () => {
  it.each([
    ['density', 'compact', 'data-density', 'compact'],
    ['textScale', 'xlarge', 'data-text', 'xlarge'],
    ['accent', 'blue', 'data-accent', 'blue'],
    ['iconScale', 'large', 'data-icons', 'large'],
    ['motion', 'reduced', 'data-motion', 'reduced'],
    ['theme', 'dark', 'data-theme', 'dark'],
  ] as const)(
    'choosing %s writes the attribute and stores the value',
    (group, value, attr, expected) => {
      mount()
      open()
      const radio = radios(group).find((node) => node.value === value)
      act(() => radio?.click())
      expect(document.documentElement.getAttribute(attr)).toBe(expected)
      expect(readAppearance()[group]).toBe(value)
    },
  )

  it('removes the attribute again when the value returns to the default', () => {
    // The model omits a default rather than writing it as a literal, because
    // `:root:not([data-theme])` is what lets the OS preference win. A control
    // that left `data-theme="system"` behind would break that.
    mount()
    open()
    act(() =>
      radios('theme')
        .find((node) => node.value === 'dark')
        ?.click(),
    )
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    act(() =>
      radios('theme')
        .find((node) => node.value === 'system')
        ?.click(),
    )
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('a refused write is visible, not believed', () => {
  function blockStorage() {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
  }

  /** The re-assert lands on the next frame, after React's own effects. */
  async function frame() {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
  }

  it('says so when localStorage refuses the write', async () => {
    mount()
    open()
    blockStorage()
    await act(async () => {
      radios('accent')
        .find((node) => node.value === 'amber')
        ?.click()
    })
    await frame()
    const status = panel()?.querySelector('[role="status"]')
    expect(status?.textContent).toMatch(/not saved/i)
    expect(status?.textContent).toMatch(/this session/i)
    expect(status?.textContent).toMatch(/reload/i)
  })

  it('still applies the setting for the session, because it did take', async () => {
    mount()
    open()
    blockStorage()
    await act(async () => {
      radios('density')
        .find((node) => node.value === 'roomy')
        ?.click()
    })
    await frame()
    // The attribute is what the reader is looking at; claiming the change did
    // nothing would be its own lie. Every mounted hook re-reads storage when the
    // write announces itself, so the document reverts once and is re-asserted
    // after the frame that outranks every one of those effects.
    expect(document.documentElement.getAttribute('data-density')).toBe('roomy')
    expect(radios('density').find((node) => node.checked)?.value).toBe('roomy')
  })

  it('shows nothing at all while the writes are landing', () => {
    mount()
    open()
    expect(panel()?.querySelector('[role="status"]')).toBeNull()
  })

  it('warns about a refused reset too, because the reset is a write as well', async () => {
    mount()
    open()
    act(() =>
      radios('density')
        .find((node) => node.value === 'roomy')
        ?.click(),
    )
    blockStorage()
    await act(async () => {
      resetButton().click()
    })
    await frame()
    expect(panel()?.querySelector('[role="status"]')?.textContent).toMatch(/not saved/i)
    // A reset is a claim about what the settings are, so it has to reset the
    // session state too, not only the stored one.
    expect(radios('density').find((node) => node.checked)?.value).toBe('default')
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
  })

  it('a later successful write takes the session override back off', async () => {
    mount()
    open()
    blockStorage()
    await act(async () => {
      radios('density')
        .find((node) => node.value === 'roomy')
        ?.click()
    })
    await frame()
    vi.restoreAllMocks()
    await act(async () => {
      radios('density')
        .find((node) => node.value === 'compact')
        ?.click()
    })
    expect(panel()?.querySelector('[role="status"]')).toBeNull()
    expect(radios('density').find((node) => node.checked)?.value).toBe('compact')
    expect(readAppearance().density).toBe('compact')
  })
})

describe('reset goes back to the defaults', () => {
  it('is disabled while nothing has been changed', () => {
    mount()
    open()
    expect(resetButton().disabled).toBe(true)
  })

  it('becomes available after a change and puts every setting back', () => {
    mount()
    open()
    act(() =>
      radios('accent')
        .find((node) => node.value === 'blue')
        ?.click(),
    )
    act(() =>
      radios('textScale')
        .find((node) => node.value === 'xlarge')
        ?.click(),
    )
    expect(resetButton().disabled).toBe(false)
    act(() => resetButton().click())
    for (const group of Object.keys(GROUPS) as GroupId[]) {
      expect(radios(group).find((radio) => radio.checked)?.value, group).toBe(
        DEFAULT_APPEARANCE[group],
      )
    }
    expect(resetButton().disabled).toBe(true)
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('clears the attributes, not just the stored values', () => {
    mount()
    open()
    act(() =>
      radios('density')
        .find((node) => node.value === 'roomy')
        ?.click(),
    )
    act(() => resetButton().click())
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
  })
})

describe('the previews show the option, not a word', () => {
  beforeEach(() => {
    mount()
    open()
  })

  it('previews every value of every one of the six settings', () => {
    // The panel's claim is that a reader can tell what a setting does from how
    // it looks. Theme and Motion were the two that broke it: three words and two
    // words, no preview, and their tiles came out 47.4px tall next to the 75-79px
    // tiles everywhere else, so the row announced its own exemption before the
    // reader had read a label. One `[data-preview]` per tile is the whole
    // claim — a control with nothing but words cannot pass it, and adding a
    // seventh setting cannot reintroduce it without failing here.
    const fields = Array.from(panel()?.querySelectorAll('fieldset') ?? [])
    expect(fields).toHaveLength(6)
    const bare: string[] = []
    for (const field of fields) {
      const legend = field.querySelector('legend')?.textContent ?? '?'
      for (const tile of field.querySelectorAll('label')) {
        const name = tile.querySelector('input')?.getAttribute('aria-label') ?? '?'
        if (!tile.querySelector('[data-preview]')) bare.push(`${legend} / ${name}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('gives Theme and Motion a preview the same height as the rows that had one', () => {
    // Every tile in the panel is `padding + preview + label`, so the only thing
    // that can make one row shorter than another is a row with no preview at
    // all. The assertion is on the classes the previews are drawn with, because
    // jsdom has no layout: `getBoundingClientRect` is 0 for all of them. The
    // rendered heights — 75.4 / 77.4 / 79.4px across all six rows, measured in
    // Chromium at 1280×900 — are what the shared `calc(30px * density-factor)`
    // and the same vertical stack produce.
    const rowFor = (legend: string) =>
      Array.from(panel()?.querySelectorAll('fieldset') ?? []).find((field) =>
        (field.querySelector('legend')?.textContent ?? '').includes(legend),
      )
    expect(rowFor('Theme')?.querySelector('[data-preview]')).not.toBeNull()
    expect(rowFor('Motion')?.querySelector('[data-preview]')).not.toBeNull()
    // Both are the 30px row the text and icon previews already used, so the
    // rhythm is set by one number rather than by six.
    expect(menuCss).toMatch(/\.themePreview \{[^}]*height: calc\(30px \* var\(--density-factor\)\)/)
    expect(menuCss).toMatch(/\.iconPreview \{[^}]*height: calc\(30px \* var\(--density-factor\)\)/)
  })

  it('paints the Theme previews from the two grounds, not from the panel’s own', () => {
    // A swatch built out of the tokens in scope would show the *current* theme
    // under all three labels, which is a preview that cannot be wrong and
    // therefore says nothing. These come from the same block the accent contrast
    // test measures, so the drawing and the measurement cannot drift apart.
    //
    // jsdom normalises an inline hex to `rgb()`, so the expectation is put
    // through the same normalisation rather than the two sides being compared as
    // written.
    const rgb = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16)
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
    }
    const barOf = (index: number) => {
      const field = Array.from(panel()?.querySelectorAll('fieldset') ?? []).find(
        (node) => node.querySelector('legend')?.textContent === 'Theme',
      )
      const tiles = field?.querySelectorAll('label')
      const preview = tiles?.[index]?.querySelector<HTMLElement>('[data-preview]')
      return {
        bar: preview?.querySelector<HTMLElement>(':scope > span')?.style.background,
        body: preview?.querySelectorAll<HTMLElement>(':scope > span')[1]?.style.background,
      }
    }
    expect(barOf(0).bar).toBe(rgb(ACCENT_SURFACES.lightSurface))
    expect(barOf(0).body).toBe(rgb(ACCENT_SURFACES.lightBg))
    expect(barOf(1).bar).toBe(rgb(ACCENT_SURFACES.darkSurface))
    expect(barOf(1).body).toBe(rgb(ACCENT_SURFACES.darkBg))
    // "Match system" is not a third palette. It is whichever the OS asks for, so
    // it is drawn as the two of them at once — the only drawing that is true
    // before the reader clicks anything.
    // A gradient value is not normalised the way a plain colour is, so this one
    // is read as written.
    expect(barOf(2).bar).toContain(ACCENT_SURFACES.lightSurface)
    expect(barOf(2).bar).toContain(ACCENT_SURFACES.darkSurface)
    expect(barOf(2).body).toContain(ACCENT_SURFACES.lightBg)
    expect(barOf(2).body).toContain(ACCENT_SURFACES.darkBg)
  })

  it('draws Motion as play for on and pause for reduced, and never as movement', () => {
    // The one preview that must not move is the one that demonstrates "reduced".
    // A triangle and two bars are the whole idiom, and they differ in *kind* —
    // one path against two rects — so this is a statement about the artwork
    // rather than about a class name.
    const mark = (index: number) => {
      const field = Array.from(panel()?.querySelectorAll('fieldset') ?? []).find(
        (node) => node.querySelector('legend')?.textContent === 'Motion',
      )
      return field?.querySelectorAll('label')[index]?.querySelector('[data-preview] svg')
    }
    expect(mark(0)?.querySelectorAll('path')).toHaveLength(1)
    expect(mark(1)?.querySelectorAll('rect')).toHaveLength(2)
    expect(mark(0)?.innerHTML).not.toBe(mark(1)?.innerHTML)
    // Nothing in the panel animates. If a future preview is tempted to demo a
    // transition, this is where it is caught.
    expect(panel()?.querySelectorAll('[style*="animation"]')).toHaveLength(0)
  })

  it('draws all four accents in the resolved theme’s own tokens', () => {
    const swatches = Array.from(panel()?.querySelectorAll('span') ?? []).filter((node) =>
      (node.className as string).includes('swatch'),
    )
    expect(swatches).toHaveLength(ACCENTS.length)
    for (const swatch of swatches) {
      // The swatch is painted from the accent's own measured pair rather than
      // from `--accent`, which is always the *current* accent — a preview built
      // out of the live token could only ever show you what you already chose.
      expect(swatch.style.background).toBeTruthy()
      expect(swatch.style.color).toBeTruthy()
    }
  })

  it('previews every density, every text size and every icon size', () => {
    // Scoped to the row, not to the panel: `iconPreview` is also the class the
    // Motion row uses for its play/pause glyph, and a count taken across the
    // whole panel would be asserting how many *other* rows share the class
    // rather than how many icon sizes are previewed.
    const rowFor = (legend: string) =>
      Array.from(panel()?.querySelectorAll('fieldset') ?? []).find((field) =>
        (field.querySelector('legend')?.textContent ?? '').includes(legend),
      )
    const steps = (className: string, legend: string, expected: number) => {
      const nodes = Array.from(rowFor(legend)?.querySelectorAll('span') ?? []).filter(
        (node) => typeof node.className === 'string' && node.className.includes(className),
      )
      expect(nodes, `${className} in the ${legend} row`).toHaveLength(expected)
      return nodes
    }
    steps('densityPreview', 'Density', DENSITIES.length)
    steps('textPreview', 'Text', TEXT_SCALES.length)
    steps('iconPreview', 'Icon size', ICON_SCALES.length)
  })

  it('uses the same multipliers the stylesheet declares, so a preview cannot lie', () => {
    // A preview that showed three densities at 0.8/1/1.2 while the app used
    // 0.875/1/1.125 would look right and describe the wrong thing. The factors
    // are read back out of `tokens.css` rather than trusted.
    for (const [attribute, values] of [
      ['--density-factor', ['0.875', '1.125']],
      ['--text-scale', ['0.875', '1.125', '1.25']],
      ['--icon-scale', ['0.875', '1.25']],
    ] as const) {
      for (const value of values) {
        const declared = new RegExp(`${attribute}:\\s*${value.replace('.', '\\.')}\\s*;`)
        expect(tokens, `${attribute}: ${value}`).toMatch(declared)
        expect(menuCss, `${attribute}: ${value}`).toContain(value)
      }
    }
  })

  it('multiplies the preview by the live factor as well as the option’s own', () => {
    // Both multipliers have to be in the declaration: the option's own is what
    // makes the three previews differ, and the live one is what makes the
    // chosen preview track the rest of the app.
    expect(menuCss).toMatch(/--preview-row: calc\(8px \* 0\.875\)/)
    expect(menuCss).toMatch(/height: calc\(var\(--preview-row\) \* var\(--density-factor\)\)/)
    expect(menuCss).toMatch(/width: calc\(var\(--preview-icon\) \* var\(--icon-scale\)\)/)
  })

  it('reads the text previews from named type steps, not from literals', () => {
    for (const step of ['--font-2xs', '--font-xs', '--font-sm', '--font-md']) {
      expect(menuCss, step).toContain(step)
    }
  })

  it('uses no raw hex and no bare rem in its own stylesheet', () => {
    expect(menuCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    // Every `rem` is inside a `calc()` that multiplies a multiplier, which is
    // the rule the rest of the app's stylesheets follow. `var()` has to come off
    // first — its own parentheses would stop the `calc` match short and leave
    // the very declaration this is looking for sitting in the remainder.
    const outsideCalc = menuCss.replace(/var\(--[a-z0-9-]+\)/g, '').replace(/calc\([^()]*\)/g, '')
    expect(outsideCalc).not.toMatch(/[\d.]+rem/)
  })
})

describe('the panel is reusable where a trigger would be wrong', () => {
  it('renders controlled, for the editor’s "More options" entry', () => {
    const onClose = vi.fn()
    harness.render(<AppearancePanel open={false} onClose={onClose} surface="editor" />)
    expect(panel()).toBeNull()
    harness.render(<AppearancePanel open onClose={onClose} surface="editor" />)
    expect(panel()?.className).toContain('editor')
    act(() => panel()?.querySelector<HTMLButtonElement>('button')?.click())
    expect(onClose).toHaveBeenCalled()
  })
})
