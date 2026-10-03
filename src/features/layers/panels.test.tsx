import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DrawPanel,
  FramePanel,
  LayersPanel,
  RedactPanel,
  StickersPanel,
  TextPanel,
} from '../../components/tools/LayerPanels'
import {
  BLEND_LABELS,
  BRUSH_LABELS,
  FRAME_STYLE_LABELS,
  FRAME_STYLES,
  REDACT_MODE_LABELS,
  SHAPE_LABELS,
  SHAPES,
} from '../../components/ui/displayLabels'
import { STICKER_ART } from '../../components/ui/icons'
import { createDoc } from '../../model/defaults'
import type { Doc, Layer } from '../../model/types'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import {
  BLEND_LABELS as FACTORY_BLEND_LABELS,
  BRUSHES,
  REDACT_MODES,
  blendModes,
  createDrawLayer,
  createFrameLayer,
  createRedactLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  createWatermarkLayer,
} from './factory'

function show(...layers: Layer[]): Layer {
  const doc: Doc = { ...createDoc(), layers }
  useDocStore.getState().load(doc)
  useUiStore.getState().selectLayer(layers[0]?.id ?? null)
  return layers[0]
}

/**
 * A real client render: zustand's server snapshot is the *initial* state, so
 * `renderToString` would always show an empty document.
 */
function html(node: ReactElement): string {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  const markup = container.innerHTML
  act(() => root.unmount())
  container.remove()
  return markup
}

function sliderLabels(markup: string): string[] {
  return [...markup.matchAll(/>([A-Za-z][A-Za-z ]*?) <span class="[^"]*dialValue/g)].map(
    (match) => match[1],
  )
}

function click(node: Element | null): void {
  if (!node) throw new Error('element not found')
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!found) throw new Error(`no button labelled ${label}`)
  return found
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function commit(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

function panel(node: ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return container
}

/** The range input belonging to the slider whose label starts with `label`. */
function rangeFor(container: HTMLElement, label: string): HTMLInputElement {
  const wrapper = [...container.querySelectorAll('label')].find((candidate) =>
    (candidate.textContent ?? '').trim().startsWith(label),
  )
  const input = wrapper?.querySelector<HTMLInputElement>('input[type="range"]')
  if (!input) throw new Error(`no slider labelled ${label}`)
  return input
}

/**
 * The accessible name, computed the way the accname algorithm computes it for
 * these controls: `aria-label` if there is one, otherwise the text of every
 * descendant that is not inside an `aria-hidden` subtree.
 *
 * jsdom has no `getComputedAccessibleName` and this repository does not depend on
 * `dom-accessibility-api`, so this is the honest substitute for "what a screen
 * reader says". It matters here because the whole point of the change under test
 * is that adding a drawing to a chip must not change what the chip is *called*:
 * a test that scraped markup could not tell the difference between a chip that
 * still says "Normal" with a glyph beside it and one that says nothing at all.
 */
function accessibleName(element: Element): string {
  const labelled = element.getAttribute('aria-label')
  if (labelled) return labelled.trim()
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof Element)) return ''
    if (node.getAttribute('aria-hidden') === 'true') return ''
    return [...node.childNodes].map(walk).join(' ')
  }
  return walk(element).replace(/\s+/g, ' ').trim()
}

/** The chips of one `group`, in document order. */
function chipsIn(container: HTMLElement, groupLabel: string): HTMLButtonElement[] {
  const group = container.querySelector(`[role="group"][aria-label="${groupLabel}"]`)
  if (!group) throw new Error(`no group labelled ${groupLabel}`)
  return [...group.querySelectorAll('button')]
}

/** `chipsIn`, as the pairs a chip is judged on: what it is called, and whether it is pressed. */
function chipStates(
  container: HTMLElement,
  groupLabel: string,
): { name: string; pressed: boolean; drawn: boolean }[] {
  return chipsIn(container, groupLabel).map((chip) => ({
    name: accessibleName(chip),
    pressed: chip.getAttribute('aria-pressed') === 'true',
    drawn: chip.querySelector('svg') !== null,
  }))
}

/** Every button in a panel that carries a drawing, as its accessible name. */
function drawnButtonNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')]
    .filter((button) => button.querySelector('svg'))
    .map(accessibleName)
}

/** A button found by its visible text, for the actions that are words not icons. */
function action(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (candidate) => accessibleName(candidate) === text,
  )
  if (!found) throw new Error(`no button saying ${text}`)
  return found
}

/**
 * The layer rows' name buttons, top of stack first.
 *
 * Located structurally: a row is the `draggable` div, and the only button in it
 * without an `aria-label` is the one that names the layer. Every other button in
 * a row is an `IconButton`, which always carries one.
 */
function layerRowNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[draggable="true"] > button:not([aria-label])')].map(
    accessibleName,
  )
}

beforeEach(() => {
  useDocStore.getState().load(createDoc())
  useUiStore.getState().selectLayer(null)
})

describe('StickersPanel inspector (D6-F12)', () => {
  it('exposes scale, rotation, opacity and blend for a sticker', () => {
    show(createStickerLayer('star'))
    const markup = html(<StickersPanel />)
    const labels = sliderLabels(markup)
    expect(labels).toContain('Scale')
    expect(labels).toContain('Rotation')
    expect(labels).toContain('Opacity')
    expect(labels).toContain('X')
    expect(markup).toContain('aria-label="Blend mode"')
  })

  it('exposes width and height for a shape', () => {
    show(createShapeLayer('rect'))
    const labels = sliderLabels(html(<StickersPanel />))
    expect(labels).toContain('Width')
    expect(labels).toContain('Height')
  })

  it('renders no inspector when nothing is selected', () => {
    show(createStickerLayer('star'))
    useUiStore.getState().selectLayer(null)
    expect(html(<StickersPanel />)).not.toContain('aria-label="Blend mode"')
  })
})

describe('blend control (D6-F08)', () => {
  /**
   * This used to scrape `/<button[^>]*>([^<]+)</g` out of the panel's markup and
   * compare the captured text with `blendModes().map(BLEND_LABELS)`. That
   * asserted something real once and then quietly became a test of the *markup*:
   * it read the button's immediate text child, so it could only ever see a chip
   * whose first child was text, and the day a drawing was added beside the word
   * the regex stopped matching and would have reported "no chips" — a failure
   * about markup that says nothing about whether a user can pick "Multiply".
   *
   * What is worth asserting is the contract: one chip per blend mode, each chip
   * *named* after its mode, the current one pressed, and the drawing there
   * without displacing the name. All four are now read the way a screen reader
   * reads them, and none of them is a statement about tag structure.
   */
  it('offers one named chip per blend mode, with the current one pressed', () => {
    show(createTextLayer('Poster'))
    const container = panel(<TextPanel />)
    const states = chipStates(container, 'Blend mode')
    expect(states.map((chip) => chip.name)).toEqual(blendModes().map((mode) => BLEND_LABELS[mode]))
    expect(states.filter((chip) => chip.pressed).map((chip) => chip.name)).toEqual(['Normal'])
  })

  it('draws a glyph on every blend chip without taking the name away', () => {
    show(createTextLayer('Poster'))
    const container = panel(<TextPanel />)
    const states = chipStates(container, 'Blend mode')
    expect(states.every((chip) => chip.drawn)).toBe(true)
    // The drawing is the icon factory's own `aria-hidden`, so it is invisible to
    // the name; the name is the word and only the word.
    for (const chip of chipsIn(container, 'Blend mode')) {
      expect(chip.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('is eight chips long, and eight is what the factory and the type say', () => {
    // "The blend control is 9 options" has been asserted in review notes more
    // than once. `blendModes()` is the source of truth and it returns eight; the
    // `BlendMode` union has eight members; `BLEND_LABELS` and `BLEND_GLYPHS` are
    // `Record<BlendMode, …>` and have eight keys each. The panel rendering
    // anything but eight is therefore the only possible failure, so the count is
    // asserted against the list rather than against a number someone typed.
    expect(blendModes()).toHaveLength(8)
    show(createTextLayer('Poster'))
    const container = panel(<TextPanel />)
    expect(chipStates(container, 'Blend mode')).toHaveLength(blendModes().length)
    expect(Object.keys(BLEND_LABELS)).toEqual(blendModes())
  })

  it('names the abbreviated chips in full on hover, without changing the name', () => {
    const layer = createTextLayer('Poster')
    layer.transform = { ...layer.transform, blend: 'soft-light' }
    show(layer)
    const container = panel(<TextPanel />)
    const soft = chipsIn(container, 'Blend mode').find((chip) => accessibleName(chip) === 'Soft')
    expect(soft?.getAttribute('title')).toBe('Soft light')
    // `title` is the last step of the name algorithm, so the accessible name is
    // still the two letters the button shows.
    expect(accessibleName(soft as HTMLButtonElement)).toBe('Soft')
  })

  it('reflects a non-default blend in the selection', () => {
    const layer = createTextLayer('Poster')
    layer.transform = { ...layer.transform, blend: 'soft-light' }
    show(layer)
    const container = panel(<TextPanel />)
    const pressed = chipStates(container, 'Blend mode').filter((chip) => chip.pressed)
    expect(pressed.map((chip) => chip.name)).toEqual(['Soft'])
  })

  it('re-exports the factory table rather than keeping a second copy of it', () => {
    expect(BLEND_LABELS).toBe(FACTORY_BLEND_LABELS)
  })
})

describe('TextPanel', () => {
  it('offers tracking and arc, both of which the compositor reads', () => {
    show(createTextLayer('Poster'))
    const labels = sliderLabels(html(<TextPanel />))
    expect(labels).toContain('Tracking')
    expect(labels).toContain('Arc')
  })
})

describe('RedactPanel (D6-F06, D6-F09)', () => {
  it('lists redactions by name, not by raw id', () => {
    const layer = createRedactLayer()
    layer.name = 'Licence plate'
    show(layer)
    useUiStore.getState().selectLayer(null)
    const markup = html(<RedactPanel />)
    expect(markup).toContain('Licence plate')
    expect(markup).not.toContain(layer.id)
  })

  it('exposes the four modes and a clamped region', () => {
    show(createRedactLayer())
    const markup = html(<RedactPanel />)
    for (const mode of ['Pixelate', 'Blur', 'Solid', 'Emoji']) expect(markup).toContain(mode)
    const labels = sliderLabels(markup)
    expect(labels).toEqual(expect.arrayContaining(['X', 'Y', 'Width', 'Height']))
    // A redaction is placed by its region, so no X/Y transform is offered.
    expect(markup).not.toContain('>Scale<')
  })
  it('clamps the region back onto the canvas (D6-F06)', () => {
    show(createRedactLayer())
    const container = panel(<RedactPanel />)
    typeInto(rangeFor(container, 'X'), '90')
    typeInto(rangeFor(container, 'Width'), '100')
    const region = useDocStore.getState().present.layers[0]
    if (region.kind !== 'redact') throw new Error('expected a redaction')
    expect(region.region.x + region.region.width).toBeLessThanOrEqual(1 + Number.EPSILON)
    expect(region.region.x).toBeGreaterThanOrEqual(0)
    expect(region.region.width).toBeGreaterThan(0)
  })
})

describe('FramePanel', () => {
  it('picking a style with no frame creates one and selects it', () => {
    // Every other "add" in this file selects what it created. The frame did
    // not, so the tap drew a frame on the canvas and left the panel reading
    // `frame === undefined`: nothing pressed, no width or colour, and the
    // sub-panel still saying there is no frame — true when the panel opened and
    // a lie one tap later.
    const container = panel(<FramePanel />)
    click(
      chipsIn(container, 'Frame styles').find((chip) => accessibleName(chip) === 'Film strip') ??
        null,
    )
    const layers = useDocStore.getState().present.layers
    expect(layers).toHaveLength(1)
    expect(layers[0].kind).toBe('frame')
    if (layers[0].kind !== 'frame') throw new Error('expected a frame')
    expect(layers[0].style).toBe('film')
    const after = panel(<FramePanel />)
    expect(
      chipStates(after, 'Frame styles')
        .filter((chip) => chip.pressed)
        .map((chip) => chip.name),
    ).toEqual(['Film strip'])
    expect(after.textContent).not.toContain('No frame yet')
  })

  it('keeps the inside toggle and offers opacity and blend', () => {
    show(createFrameLayer('polaroid'))
    const markup = html(<FramePanel />)
    expect(markup).toContain('Inside the canvas')
    expect(sliderLabels(markup)).toContain('Opacity')
    expect(markup).toContain('aria-label="Blend mode"')
  })

  it('does not offer position sliders a frame cannot honour', () => {
    show(createFrameLayer('solid'))
    const labels = sliderLabels(html(<FramePanel />))
    expect(labels).not.toContain('X')
    expect(labels).not.toContain('Y')
    expect(labels).not.toContain('Scale')
    expect(labels).not.toContain('Rotation')
  })
})

describe('DrawPanel', () => {
  it('offers all five brushes, named and drawn', () => {
    show(createDrawLayer())
    const container = panel(<DrawPanel />)
    const states = chipStates(container, 'Brush')
    expect(states.map((chip) => chip.name)).toEqual(BRUSHES.map((brush) => BRUSH_LABELS[brush]))
    expect(states.every((chip) => chip.drawn)).toBe(true)
    expect(states.filter((chip) => chip.pressed).map((chip) => chip.name)).toEqual(['Pen'])
  })

  it('explains an empty drawing layer instead of showing a button and nothing else', () => {
    const container = panel(<DrawPanel />)
    // The wording is unchanged; it is split across a heading and a body rather than
    // run together with an em dash, because the four panels beside Draw used to
    // render a *different* component with no heading at all. Asserted in two parts
    // so the sentence still has to be here and still has to say what the button
    // creates — a join into one string would pass on either half missing.
    expect(container.textContent).toContain('No drawing layer yet')
    expect(container.textContent).toContain('create one, then sketch on the canvas.')
    expect(action(container, 'New drawing layer')).toBeTruthy()
  })
})

describe('chips carry artwork and keep their names', () => {
  it('every sticker tile draws its path and is still called by its label', () => {
    const container = panel(<StickersPanel />)
    // `stickers.ts` carried `path` and `fill` for all eight from the start and
    // the panel printed the label instead, so the expected list is exactly the
    // built-in set followed by the four shapes: twelve drawn chips, twelve
    // names, and nothing in the panel whose name is its own id.
    const expected = [
      ...Object.values(STICKER_ART).map((art) => art.label),
      ...SHAPES.map((shape) => SHAPE_LABELS[shape]),
    ]
    expect(drawnButtonNames(container)).toEqual(expected)
  })

  it('groups the two chip sets, because "Arrow" is a sticker and a shape', () => {
    const container = panel(<StickersPanel />)
    // The built-in sticker `arrow` is labelled "Arrow", and so is the shape.
    // While the chip printed the raw `arrow`, `exact: true` found one; with both
    // spelled out there are two controls called "Arrow" in one panel, and the
    // visible headings are not something a screen reader hears. Naming the
    // groups puts each chip in a context that says what it is.
    expect(container.querySelector('[role="group"][aria-label="Stickers"]')).toBeTruthy()
    expect(container.querySelector('[role="group"][aria-label="Shapes"]')).toBeTruthy()
    const all = [...container.querySelectorAll('button')].map(accessibleName)
    expect(all.filter((name) => name === 'Arrow')).toHaveLength(2)
    const shapes = container.querySelector<HTMLElement>('[role="group"][aria-label="Shapes"]')
    expect(shapes).toBeTruthy()
    expect(drawnButtonNames(shapes as HTMLElement)).toEqual(
      SHAPES.map((shape) => SHAPE_LABELS[shape]),
    )
  })

  it('every frame style chip draws and is named, and the sub-panel explains itself', () => {
    const container = panel(<FramePanel />)
    const states = chipStates(container, 'Frame styles')
    expect(states.map((chip) => chip.name)).toEqual(
      FRAME_STYLES.map((style) => FRAME_STYLE_LABELS[style]),
    )
    expect(states.every((chip) => chip.drawn)).toBe(true)
    // No frame selected: nothing is pressed, and the panel says what choosing
    // one does. It used to render a style picker and then nothing at all.
    expect(states.some((chip) => chip.pressed)).toBe(false)
    expect(container.textContent).toContain('No frame yet')
    expect(container.textContent).toContain('pick a style above')
  })

  it('the chosen frame style is the pressed chip, and the width says what it is', () => {
    show(createFrameLayer('polaroid'))
    const container = panel(<FramePanel />)
    const states = chipStates(container, 'Frame styles')
    expect(states.filter((chip) => chip.pressed).map((chip) => chip.name)).toEqual(['Polaroid'])
    // The compositor reads `width` as a percentage of the short edge, and this
    // was the only percentage slider in the panel with no unit on it.
    expect(Number(rangeFor(container, 'Width').value)).toBe(6)
    expect(container.textContent).toContain('6%')
  })

  it('every redaction mode chip draws and is named', () => {
    show(createRedactLayer())
    const container = panel(<RedactPanel />)
    const states = chipStates(container, 'Redaction mode')
    expect(states.map((chip) => chip.name)).toEqual(
      REDACT_MODES.map((mode) => REDACT_MODE_LABELS[mode]),
    )
    expect(states.every((chip) => chip.drawn)).toBe(true)
    expect(states.filter((chip) => chip.pressed).map((chip) => chip.name)).toEqual(['Pixelate'])
  })

  it('picking a chip writes the id the model stores, not the word on it', () => {
    show(createRedactLayer())
    const container = panel(<RedactPanel />)
    const blur = chipsIn(container, 'Redaction mode').find(
      (chip) => accessibleName(chip) === 'Blur',
    )
    click(blur ?? null)
    const layer = useDocStore.getState().present.layers[0]
    if (layer.kind !== 'redact') throw new Error('expected a redaction')
    expect(layer.mode).toBe('blur')
  })
})

describe('the empty panels explain themselves', () => {
  it('Text says what a text layer is and where one lands', () => {
    const container = panel(<TextPanel />)
    expect(container.textContent).toContain('No text layer yet')
    expect(container.textContent).toContain('lands in the middle of the image')
    expect(action(container, 'Add text')).toBeTruthy()
  })

  it('Layers says where layers come from and what a row does', () => {
    const container = panel(<LayersPanel />)
    expect(container.textContent).toContain('No layers yet')
    expect(container.textContent).toContain('every tool writes one')
    expect(container.textContent).toContain('drag one onto another to reorder the stack')
  })

  it('Redact says what is actually removed, not just covered', () => {
    const container = panel(<RedactPanel />)
    expect(container.textContent).toContain('No redaction yet')
    expect(container.textContent).toContain('removed from the exported file')
    expect(action(container, 'Add redaction')).toBeTruthy()
  })

  it('an explanation disappears once there is something to explain', () => {
    show(createTextLayer('Poster'))
    useUiStore.getState().selectLayer(null)
    expect(html(<TextPanel />)).not.toContain('No text layer yet')
    show(createRedactLayer())
    useUiStore.getState().selectLayer(null)
    expect(html(<RedactPanel />)).not.toContain('No redaction yet')
    show(createTextLayer('Poster'))
    expect(html(<LayersPanel />)).not.toContain('No layers yet')
  })
})

describe('layer rows are named in words', () => {
  it('spells out the kind and resolves a name that is only an id', () => {
    // `factory.ts` names a sticker after its id and a shape after its own kind,
    // so the row used to read `sticker · star` and `shape · rect` — the raw
    // enum, at the front of every row in the panel.
    show(
      createTextLayer('Edit this text'),
      createStickerLayer('star'),
      createShapeLayer('rect'),
      createDrawLayer(),
      createRedactLayer(),
      createWatermarkLayer(),
      createFrameLayer('film'),
    )
    const names = layerRowNames(panel(<LayersPanel />))
    expect(names).toEqual([
      'Frame · Film strip',
      'Watermark · © Your Name',
      'Redaction',
      'Drawing',
      'Shape · Rectangle',
      'Sticker · Star',
      'Text · Edit this text',
    ])
  })

  it('names a new text layer for what it is, not for the device it was added on', () => {
    // "Tap to edit" was the default text and therefore every row's name, so the
    // layers list said "Text · Tap to edit" on a desktop with a mouse. The panel
    // beside the list is where the text is edited, so the name says what it is.
    expect(createTextLayer().text).toBe('Edit this text')
    expect(createTextLayer().name).toBe('Edit this text')
    show(createTextLayer())
    const row = layerRowNames(panel(<LayersPanel />))
    expect(row).toContain('Text · Edit this text')
    expect(row.join(' ')).not.toMatch(/tap/i)
  })

  it('a name a person typed is left exactly as typed', () => {
    const shape = createShapeLayer('rect')
    shape.name = 'Accent bar'
    const frame = createFrameLayer('solid')
    frame.name = 'Gold border'
    show(shape, frame)
    expect(layerRowNames(panel(<LayersPanel />))).toEqual([
      'Frame · Gold border',
      'Shape · Accent bar',
    ])
  })

  it('no row prints a raw identifier', () => {
    show(createStickerLayer('heart'), createShapeLayer('arrow'), createFrameLayer('shadow-card'))
    const names = layerRowNames(panel(<LayersPanel />))
    for (const name of names) expect(name).toBe(name.replace(/^[a-z]/, (c) => c.toUpperCase()))
    expect(names).toEqual(['Frame · Shadow card', 'Shape · Arrow', 'Sticker · Heart'])
  })

  it('the alignment row says Centre, and never Center', () => {
    // The product is British everywhere else, and a word that is spelled two ways
    // inside one app is a word half of the team has to look up. The segmented
    // control's own name is "Alignment", so the buttons are read from the markup
    // rather than from a control that could be renamed around them.
    show(createTextLayer('Caption'))
    const markup = html(<TextPanel />)
    expect(markup).toContain('aria-label="Alignment"')
    expect([...markup.matchAll(/>(Left|Centre|Right|Center)</g)].map((m) => m[1])).toEqual([
      'Left',
      'Centre',
      'Right',
    ])
  })

  it('the redaction slider says Amount, and never Strength', () => {
    // Two panels said "Strength" for two unrelated numbers. The word is spent, and
    // `src/lib/copy.ts` bans it, so the pin is here as well as in the gate.
    const layer = createRedactLayer()
    layer.mode = 'pixelate'
    show(layer)
    const container = panel(<RedactPanel />)
    const amount = rangeFor(container, 'Amount')
    expect(amount).toBeTruthy()
    expect(rangeFor(container, 'Amount').value).toBe(String(layer.strength))
    expect(container.textContent).not.toMatch(/Strength/)
  })
})

describe('LayersPanel (D6-F09, D6-F13)', () => {
  it('offers rename, duplicate, bring to front and send to back on the selection', () => {
    show(createStickerLayer('star'))
    const markup = html(<LayersPanel />)
    expect(markup).toContain('aria-label="Rename layer"')
    expect(markup).toContain('aria-label="Duplicate layer"')
    expect(markup).toContain('aria-label="Bring to front"')
    expect(markup).toContain('aria-label="Send to back"')
    expect(markup).toContain('Move up')
    expect(markup).toContain('Delete layer')
  })

  it('is drag-reorderable', () => {
    show(createStickerLayer('star'))
    expect(html(<LayersPanel />)).toContain('draggable="true"')
  })

  it('keeps the ±1 reorder buttons for every row', () => {
    const first = createStickerLayer('star')
    const second = createTextLayer('Caption')
    show(first, second)
    useUiStore.getState().selectLayer(second.id)
    const markup = html(<LayersPanel />)
    expect([...markup.matchAll(/aria-label="Move (up|down)"/g)]).toHaveLength(4)
  })
})

describe('LayersPanel interactions', () => {
  it('writes a new name on rename (D6-F09)', () => {
    const layer = createTextLayer('Caption')
    show(layer)
    const container = panel(<LayersPanel />)
    click(button(container, 'Rename layer'))
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer name"]')
    expect(input).not.toBeNull()
    typeInto(input as HTMLInputElement, 'Wedding caption')
    commit(input as HTMLInputElement)
    expect(useDocStore.getState().present.layers[0].name).toBe('Wedding caption')
  })

  it('duplicates a layer with a fresh id and a " copy" name (D6-F13)', () => {
    const layer = createStickerLayer('star')
    show(layer)
    const container = panel(<LayersPanel />)
    click(button(container, 'Duplicate layer'))
    const layers = useDocStore.getState().present.layers
    expect(layers).toHaveLength(2)
    expect(layers.map((entry) => entry.name)).toEqual(['star', 'star copy'])
    expect(layers[1].id).not.toBe(layer.id)
    expect(layers[1].kind).toBe('sticker')
  })

  it('brings a layer to the front and sends it back (D6-F13)', () => {
    const first = createTextLayer('A')
    const second = createTextLayer('B')
    const third = createTextLayer('C')
    show(first, second, third)
    useUiStore.getState().selectLayer(first.id)
    const container = panel(<LayersPanel />)
    click(button(container, 'Bring to front'))
    expect(useDocStore.getState().present.layers.map((layer) => layer.name)).toEqual([
      'B',
      'C',
      'A',
    ])
    click(button(container, 'Send to back'))
    expect(useDocStore.getState().present.layers.map((layer) => layer.name)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  it('records one undo step per reorder', () => {
    const first = createTextLayer('A')
    const second = createTextLayer('B')
    show(first, second)
    useUiStore.getState().selectLayer(first.id)
    const container = panel(<LayersPanel />)
    click(button(container, 'Bring to front'))
    expect(useDocStore.getState().past).toHaveLength(1)
    click(button(container, 'Send to back'))
    expect(useDocStore.getState().past).toHaveLength(2)
  })
})
