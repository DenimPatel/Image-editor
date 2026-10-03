import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import { setCrop } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { setNativeValue } from '../../store/testHarness'
import { checkCompliance } from '../../features/passport/compliance'
import { complianceInputFor } from '../../features/passport/measure'
import type { PhotoMeasurement } from '../../features/passport/measureFace'
import { planSheet } from '../../features/passport/sheet'
import { getSpec, PASSPORT_SPECS, type PassportSpec } from '../../features/passport/specs'
import { PassportPanel } from './PassportPanel'

/**
 * The panel's render and its reading, faked.
 *
 * `renderExportCanvas` is replaced so a measurement costs a promise instead of a
 * 48-megapixel encode, and `measureCanvas` is replaced so the reading is a value
 * the test chose rather than whatever the head-detector makes of a blank canvas.
 * Both are module-level, so the effect under test is still the real one: it
 * decides *when* to call them and what to do with the answer.
 */
const state = vi.hoisted(() => ({
  renders: 0,
  gate: null as Promise<void> | null,
  measured: 0,
  reading: null as PhotoMeasurement | null,
}))

vi.mock('../../render/exportCanvas', () => ({
  // The signal is ignored on purpose: a real abort rejects the render, and the
  // panel's own guard is what this file is checking.
  renderExportCanvas: async () => {
    state.renders += 1
    if (state.gate) await state.gate
    return {} as HTMLCanvasElement
  },
}))

vi.mock('../../features/passport/measureFace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/passport/measureFace')>()
  return {
    ...actual,
    measureCanvas: () => {
      state.measured += 1
      return state.reading
    },
  }
})

/** A head in the top half of a squared-up ID photo, on a plain backdrop. */
const READING: PhotoMeasurement = {
  face: {
    landmarks: {
      crown: { x: 0.5, y: 0.1 },
      chin: { x: 0.5, y: 0.5 },
      leftEye: { x: 0.42, y: 0.3 },
      rightEye: { x: 0.58, y: 0.3 },
    },
    box: { x: 0.35, y: 0.1, width: 0.3, height: 0.4 },
    confidence: 0.9,
  },
  background: { color: { r: 240, g: 240, b: 240 }, uniformity: 0.97, present: true },
}

/**
 * A head that fills nine tenths of the frame. No shipped spec allows that much
 * head, so every framing it is read against fails — which is what the "what was
 * measured" assertions need.
 */
const OVERSIZED_HEAD: PhotoMeasurement = {
  face: {
    landmarks: {
      crown: { x: 0.5, y: 0.0 },
      chin: { x: 0.5, y: 0.9 },
      leftEye: { x: 0.4, y: 0.4 },
      rightEye: { x: 0.6, y: 0.4 },
    },
    box: { x: 0.3, y: 0, width: 0.4, height: 0.9 },
    confidence: 0.9,
  },
  background: { color: { r: 240, g: 240, b: 240 }, uniformity: 0.97, present: true },
}

const photo = { width: 600, height: 600 } as unknown as ImageBitmap

/**
 * A real client render: zustand's server snapshot is the *initial* state, so
 * `renderToString` would always show an empty document.
 */
function mount(source: ImageBitmap | null = null): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render((<PassportPanel source={source} />) as ReactElement))
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

async function waitFor(predicate: () => boolean, timeout = 4000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for the panel')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}

function loadPhoto(): void {
  useDocStore.getState().load(
    createDoc({
      source: { assetId: 'asset_photo', width: 600, height: 600, name: 'id', mime: 'image/png' },
    }),
  )
}

function button(markup: HTMLElement, label: string): HTMLButtonElement {
  const found = [...markup.querySelectorAll('button')].find((node) => node.textContent === label)
  if (!found) throw new Error(`no button labelled ${label}`)
  return found as HTMLButtonElement
}

function click(node: Element): void {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const GROUPS = ['Passport photos', 'Visa and card photos', 'Other ID photos'] as const

type Chip = {
  button: HTMLButtonElement
  label: string
  detail: string
  group: string
  pressed: boolean
  svg: SVGSVGElement | null
}

/**
 * Every document chip on screen, with the group it was offered in.
 *
 * A chip says two things — the document, and the millimetres under it — inside a
 * wrapper, so the button's `textContent` is the two run together and the first
 * span that says anything is that wrapper. The two *leaf* spans are the two
 * lines a reader sees, in order.
 */
function chips(markup: HTMLElement): Chip[] {
  return [...markup.querySelectorAll('[role="group"]')]
    .filter((group) =>
      (GROUPS as readonly string[]).includes(group.getAttribute('aria-label') ?? ''),
    )
    .flatMap((group) =>
      [...group.querySelectorAll('button')].map((node) => {
        const spans = [...node.querySelectorAll('span')]
        const said = spans
          .filter((span) => (span.textContent ?? '').trim().length > 0)
          .filter((span) => !spans.some((other) => other !== span && span.contains(other)))
          .map((span) => (span.textContent ?? '').trim())
        return {
          button: node as HTMLButtonElement,
          label: said[0] ?? '',
          detail: said[1] ?? '',
          group: group.getAttribute('aria-label') ?? '',
          pressed: node.getAttribute('aria-pressed') === 'true',
          svg: node.querySelector('svg'),
        }
      }),
    )
}

/** The one chip that names this document. */
function chip(markup: HTMLElement, document: string): Chip {
  const found = chips(markup).find((candidate) => candidate.label === document)
  if (!found) throw new Error(`no chip labelled ${document}`)
  return found
}

/** Choose a document, the way a reader does: by the name on the chip. */
function choose(markup: HTMLElement, document: string): void {
  click(chip(markup, document).button)
}

function field(markup: HTMLElement, name: string): HTMLInputElement {
  const found = markup.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!found) throw new Error(`no field labelled ${name}`)
  return found
}

function typeInto(element: HTMLInputElement, value: string): void {
  act(() => {
    setNativeValue(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pressEnter(element: HTMLInputElement): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

/** The one rule row that carries this rule's name, as one line of text. */
function ruleText(markup: HTMLElement, label: string): string {
  const name = [...markup.querySelectorAll('span')].find(
    (span) => (span.textContent ?? '').trim() === label,
  )
  const row = name?.closest('div')
  if (!row) throw new Error(`no rule row for ${label}`)
  return (row.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function sheetFigure(markup: HTMLElement): SVGSVGElement {
  const found = markup.querySelector<SVGSVGElement>('svg[data-figure="sheet"]')
  if (!found) throw new Error('no sheet figure')
  return found
}

function specOrThrow(id: string): PassportSpec {
  const found = getSpec(id)
  if (!found) throw new Error(`no spec ${id}`)
  return found
}

function textOf(markup: HTMLElement): string {
  return (markup.textContent ?? '').replace(/\s+/g, ' ')
}

/**
 * The eleven specs, the document each one is a photo *of*, and the group it is
 * offered in. Written out here rather than imported from the panel, because the
 * panel's table is the thing under test: a test that read the expected answer
 * out of the implementation would agree with every mistake it made.
 */
const DOCUMENTS: readonly (readonly [string, string, string])[] = [
  ['us-2x2', 'US passport', 'Passport photos'],
  ['india-2x2', 'India passport', 'Passport photos'],
  ['uk-35x45', 'UK passport', 'Passport photos'],
  ['canada-50x70', 'Canada passport', 'Passport photos'],
  ['australia-35x45', 'Australia passport', 'Passport photos'],
  ['china-33x48', 'China passport', 'Passport photos'],
  ['japan-35x45', 'Japan passport', 'Passport photos'],
  ['us-visa-2x2', 'US visa', 'Visa and card photos'],
  ['schengen-35x45', 'Schengen visa', 'Visa and card photos'],
  ['oci-51x51', 'India OCI card', 'Visa and card photos'],
  ['generic-35x45', 'Generic ID photo', 'Other ID photos'],
]

beforeEach(() => {
  state.renders = 0
  state.gate = null
  state.measured = 0
  state.reading = READING
  useDocStore.getState().load(createDoc())
})

describe('PassportPanel', () => {
  it('says which document it is reading against before one is chosen', () => {
    const { container, unmount } = mount()

    // With no spec in the document the panel falls back to the US passport, and
    // eight rules are already being judged against it. A user who has not chosen
    // anything has to be told, or a row of green pills is a claim about a
    // document they never asked for.
    expect(textOf(container)).toContain(
      'Nothing chosen yet, so the panel is reading everything against the US passport',
    )
    // The guide lines it points them at are drawn for a chosen spec, so it must
    // not promise them before there is one.
    expect(textOf(container)).toContain(
      'Pick a document above to see its guide lines on the canvas.',
    )

    choose(container, 'UK passport')
    expect(container.textContent).not.toContain('Nothing chosen yet')
    expect(textOf(container)).toContain('align the eyes and crown to the guides on the canvas')
    unmount()
  })

  it('does not claim a landmark model it cannot load', () => {
    const { container, unmount } = mount()
    const text = container.textContent ?? ''

    expect(text).not.toContain('self-hosted landmark model')
    expect(text).not.toContain('Face auto-detection')
    expect(text).toContain('Auto-frame the head')
    expect(text).toContain('downloads no model')
    unmount()
  })

  it('claims nothing else it cannot do either', () => {
    const { container, unmount } = mount()
    const text = container.textContent ?? ''

    // The auto-framer is a connected-component search over the pixels already on
    // the canvas, with no model of any kind behind it, so no word that implies
    // one belongs in this panel.
    expect(text).not.toMatch(/landmark|neural|machine learning|deep learning|\bAI\b|face detect/i)
    // What it does claim is that it reads the photo's own pixels, which is true.
    expect(text).toContain('measures the head from the photo itself')
    unmount()
  })

  it('labels the rules it could not measure instead of passing midpoints', () => {
    const { container, unmount } = mount()

    expect(container.textContent).toContain('Not measured yet')
    expect(ruleText(container, 'Head height')).toContain('Not measured')
    // The figure is the document's own example, and says so rather than
    // claiming a reading it never took.
    expect(ruleText(container, 'Head height')).toContain('Spec value')
    expect(ruleText(container, 'Background present')).toContain('Not measured')
    expect(ruleText(container, 'Photo shape')).toContain('Photo shape')
    unmount()
  })

  describe('the document the user is trying to satisfy', () => {
    it('offers every spec in the catalogue, once, under its document', () => {
      const { container, unmount } = mount()
      const onScreen = chips(container)

      expect(onScreen).toHaveLength(PASSPORT_SPECS.length)
      for (const [id, document, group] of DOCUMENTS) {
        const spec = specOrThrow(id)
        const found = onScreen.filter((candidate) => candidate.label === document)
        expect(found, document).toHaveLength(1)
        expect(found[0]?.group, document).toBe(group)
        // The millimetres are the spec's own, and they are the second line.
        expect(found[0]?.detail, document).toBe(`${spec.widthMm} × ${spec.heightMm} mm`)
      }
      unmount()
    })

    it('groups by what the document is, not by what the country is', () => {
      const { container, unmount } = mount()
      const groupOf = (document: string) => chip(container, document).group

      // Two of the eleven are not countries: `generic-35x45` says
      // `country: 'Any'` and `schengen-35x45` says `'Schengen Area'`, which is a
      // zone rather than a country. A row of passports is not where either goes.
      expect(groupOf('Generic ID photo')).toBe('Other ID photos')
      expect(groupOf('Schengen visa')).toBe('Visa and card photos')
      expect(DOCUMENTS.filter(([, , group]) => group === 'Passport photos')).toHaveLength(7)
      unmount()
    })

    it('names every document in the spec data that says so', () => {
      for (const [id, document] of DOCUMENTS) {
        const spec = specOrThrow(id)
        // The document *kind* — passport, visa, card, photo — is the claim that
        // would be wrong if it were wrong, so it has to be supported by the
        // spec's own label or notes rather than by a mapping the panel invented.
        const said = `${spec.label} ${spec.notes.join(' ')}`.toLowerCase()
        const words = document.toLowerCase().split(' ')
        const kind = words[words.length - 1] as string
        expect(said, `${id} is described as a ${kind}`).toContain(kind)
      }
    })

    it('names no chip after a country code and two numbers', () => {
      const { container, unmount } = mount()

      for (const found of chips(container)) {
        // The old chip was the spec id: `us-2x2`, `au-3.5x4.5`. A chip is a
        // document name now, and the millimetres carry their own unit.
        expect(found.label).not.toMatch(/^[a-z]{2}-?\d/i)
        expect(found.label).toMatch(/[a-z]/i)
        expect(found.detail).toMatch(/^\d+(\.\d+)? × \d+(\.\d+)? mm$/)
      }
      unmount()
    })

    it('draws each chip at the proportion it actually prints', () => {
      const { container, unmount } = mount()

      for (const [id, document] of DOCUMENTS) {
        const spec = specOrThrow(id)
        const rect = chip(container, document).svg?.querySelector('rect')
        if (!rect) throw new Error(`no frame drawn on the ${document} chip`)
        // 35 × 45 and 50 × 70 are told apart by silhouette before either label is
        // read, which is the whole point of drawing the millimetres.
        expect(
          Number(rect.getAttribute('width')) / Number(rect.getAttribute('height')),
          document,
        ).toBeCloseTo(spec.widthMm / spec.heightMm, 6)
      }
      unmount()
    })

    it('says what the chosen document prints and what it measures', () => {
      const { container, unmount } = mount()
      choose(container, 'Schengen visa')
      const spec = specOrThrow('schengen-35x45')
      const text = textOf(container)

      expect(text).toContain(
        `Schengen visa — prints ${spec.widthMm} × ${spec.heightMm} mm at ${spec.dpi} DPI. Needs a plain white background.`,
      )
      expect(text).toContain(`Head ${spec.headHeightMm.min}–${spec.headHeightMm.max} mm`)
      expect(text).toContain(
        `Eyes ${spec.eyeLineMmFromBottom.min}–${spec.eyeLineMmFromBottom.max} mm`,
      )
      unmount()
    })

    it('keeps the document’s own notes one tap away', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      const spec = specOrThrow('uk-35x45')
      const details = container.querySelector('details')

      expect(details?.querySelector('summary')?.textContent).toBe(
        'What a UK passport photo has to be',
      )
      for (const note of spec.notes) {
        expect(details?.textContent).toContain(note)
      }
      unmount()
    })
  })

  describe('portrait/landscape (D5-F15)', () => {
    it('transposes the print size and the aspect lock', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')

      click(button(container, 'Landscape'))

      const doc = useDocStore.getState().present
      expect(doc.output.resize).toEqual({
        mode: 'physical',
        widthMm: 45,
        heightMm: 35,
        dpi: 300,
      })
      expect(doc.geometry.aspectLock).toBeCloseTo(45 / 35, 6)
      unmount()
    })

    it('switches back', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      click(button(container, 'Landscape'))
      click(button(container, 'Portrait'))

      const doc = useDocStore.getState().present
      expect(doc.output.resize).toMatchObject({ widthMm: 35, heightMm: 45 })
      expect(doc.geometry.aspectLock).toBeCloseTo(35 / 45, 6)
      unmount()
    })

    it('says what the orientation does, and nothing when it does nothing', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      expect(textOf(container)).toContain(
        'Prints 35 × 45 mm. Landscape turns the same photo on its side.',
      )
      click(button(container, 'Landscape'))
      expect(textOf(container)).toContain('Prints 45 × 35 mm. Portrait turns it back upright.')

      // A square document is its own landscape, so promising a turn that
      // transposes 50.8 mm onto 50.8 mm would be promising nothing at all.
      choose(container, 'US passport')
      expect(textOf(container)).toContain(
        'This document is 50.8 × 50.8 mm, so turning it changes nothing.',
      )
      unmount()
    })
  })

  it('applies a background its own background rule passes', () => {
    const { container, unmount } = mount()
    choose(container, 'UK passport')

    const doc = useDocStore.getState().present
    const spec = getSpec('uk-35x45')
    if (!spec) throw new Error('missing uk-35x45')
    expect(doc.background.color).toBe('#f2f2f2')

    const report = checkCompliance(complianceInputFor(doc, spec, null).input)
    expect(report.rules.find((rule) => rule.id === 'background-colour')?.status).toBe('pass')
    unmount()
  })

  describe('the millimetre fields', () => {
    it('show the size that will print, in millimetres, on both fields', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      const width = field(container, 'Width in millimetres')
      const height = field(container, 'Height in millimetres')

      expect(width.value).toBe('35')
      expect(height.value).toBe('45')
      // The unit is on the field, and in the name a screen reader reads.
      expect(width.closest('label')?.textContent).toContain('mm')
      expect(height.closest('label')?.textContent).toContain('mm')
      unmount()
    })

    it('says what is wrong instead of going quiet', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      const width = field(container, 'Width in millimetres')

      for (const bad of ['0', 'abc', '-1', '3:2:1']) {
        typeInto(width, bad)
        expect(width.getAttribute('aria-invalid'), bad).toBe('true')
        const alert = container.querySelector('#passport-size-error')
        expect(alert?.getAttribute('role'), bad).toBe('alert')
        expect(alert?.textContent, bad).toContain(
          'Width and height each need a number of millimetres',
        )
        // And nothing was written: the document still prints what it printed.
        expect(useDocStore.getState().present.output.resize, bad).toMatchObject({
          widthMm: 35,
          heightMm: 45,
        })
      }

      // A field cleared to start typing again is not an error, it is mid-edit.
      typeInto(width, '')
      expect(width.getAttribute('aria-invalid')).toBeNull()
      unmount()
    })

    it('applies a size on Enter, as one edit that fits the crop to it', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      const before = useDocStore.getState().past.length
      typeInto(field(container, 'Width in millimetres'), '40')
      typeInto(field(container, 'Height in millimetres'), '50')
      pressEnter(field(container, 'Height in millimetres'))

      const doc = useDocStore.getState().present
      expect(doc.output.resize).toEqual({
        mode: 'physical',
        widthMm: 40,
        heightMm: 50,
        dpi: 300,
      })
      expect(doc.geometry.aspectLock).toBeCloseTo(0.8, 6)
      expect(doc.geometry.crop.width / doc.geometry.crop.height).toBeCloseTo(0.8, 2)
      // Three writes, one edit: the resize, the lock and the crop are one
      // gesture, and Undo has to take them back together.
      expect(useDocStore.getState().past.length).toBe(before + 1)
      unmount()
    })

    it('applies a size from the button, and the fields then show the truth', () => {
      const { container, unmount } = mount()
      typeInto(field(container, 'Width in millimetres'), '30')
      typeInto(field(container, 'Height in millimetres'), '40')

      const apply = button(container, 'Use this size')
      expect(apply.disabled).toBe(false)
      click(apply)

      expect(useDocStore.getState().present.output.resize).toMatchObject({
        widthMm: 30,
        heightMm: 40,
      })
      // A control that writes the frame shows the frame, not the draft.
      expect(field(container, 'Width in millimetres').value).toBe('30')
      expect(button(container, 'Use this size').disabled).toBe(true)
      unmount()
    })

    it('offers the way back to the document size, and takes it', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      typeInto(field(container, 'Width in millimetres'), '40')
      typeInto(field(container, 'Height in millimetres'), '50')
      click(button(container, 'Use this size'))
      expect(textOf(container)).toContain('Back to the UK passport size')

      click(button(container, 'Back to the UK passport size'))
      expect(useDocStore.getState().present.output.resize).toMatchObject({
        widthMm: 35,
        heightMm: 45,
      })
      expect(textOf(container)).toContain('Apply the UK passport size')
      unmount()
    })

    it('drops a draft that no longer describes the document', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      typeInto(field(container, 'Width in millimetres'), '40')

      // A spec chip replaces the frame, so a box that was mid-edit has to show
      // the new frame rather than a number that now describes nothing.
      choose(container, 'Japan passport')
      expect(field(container, 'Width in millimetres').value).toBe('35')
      expect(field(container, 'Height in millimetres').value).toBe('45')
      unmount()
    })
  })

  describe('the figures a rule compared', () => {
    it('shows the measurement and the requirement, not only a verdict', () => {
      const { container, unmount } = mount()
      const spec = specOrThrow('uk-35x45')
      choose(container, 'UK passport')

      const head = ruleText(container, 'Head height')
      expect(head).toContain(`Required ${spec.headHeightMm.min}–${spec.headHeightMm.max} mm`)
      const eye = ruleText(container, 'Eye line')
      expect(eye).toContain(
        `Required ${spec.eyeLineMmFromBottom.min}–${spec.eyeLineMmFromBottom.max} mm`,
      )
      expect(ruleText(container, 'Horizontal centring')).toContain('Required within 3 mm')
      expect(ruleText(container, 'Photo shape')).toContain(
        `Required ${spec.widthMm} × ${spec.heightMm} mm`,
      )
      expect(ruleText(container, 'Resolution')).toContain(`Required ${spec.dpi} DPI`)
      unmount()
    })

    it('keeps the engine’s own sentence for a rule it cannot put in figures', () => {
      const { container, unmount } = mount()

      // A background is a colour and a uniformity, and a measured/required pair
      // would only flatten what the rule actually says about them.
      expect(ruleText(container, 'Background colour')).toContain(
        'Background colour was not measured',
      )
      // A document with no background fails the presence rule, and the engine's
      // own sentence is what says so — the panel is not inventing a verdict.
      expect(ruleText(container, 'Background present')).toContain(
        'There is no plain background behind the subject',
      )
      expect(ruleText(container, 'Background uniformity')).toContain('Background uniformity')
      unmount()
    })
  })

  describe('print sheet', () => {
    it('takes its options from the sheet catalogue', () => {
      const { container, unmount } = mount()
      const group = [...container.querySelectorAll('[role="group"]')].find(
        (node) => node.getAttribute('aria-label') === 'Sheet size',
      )

      expect(
        [...(group?.querySelectorAll('button') ?? [])].map((node) => node.textContent),
      ).toEqual(['4 × 6 in', '5 × 7 in', 'A4'])
      unmount()
    })

    it('persists the sheet size in the document instead of component state', () => {
      const { container, unmount } = mount()
      click(button(container, 'A4'))

      expect(useDocStore.getState().present.output.sheet).toBe('a4')

      const { container: second, unmount: closeSecond } = mount()
      const group = [...second.querySelectorAll('[role="group"]')].find(
        (node) => node.getAttribute('aria-label') === 'Sheet size',
      )
      const pressed = [...(group?.querySelectorAll('button') ?? [])].find(
        (node) => node.getAttribute('aria-pressed') === 'true',
      )
      expect(pressed?.textContent).toBe('A4')
      closeSecond()
      unmount()
    })

    it('draws the sheet at its own proportions, on the plan it exports', () => {
      const { container, unmount } = mount()
      const spec = specOrThrow('us-2x2')
      // 4×6 in holds two 50.8 mm squares, and the stepper starts at six.
      const layout = planSheet(spec, '4x6', 2, spec.dpi, false)
      const figure = sheetFigure(container)

      expect(figure.getAttribute('viewBox')).toBe(
        `0 0 ${layout.sheetWidthPx} ${layout.sheetHeightPx}`,
      )
      // One rectangle for the paper and one per planned photo, at the positions
      // `planSheet` chose. None of it is the panel's own arithmetic.
      const rects = [...figure.querySelectorAll('rect')]
      expect(rects).toHaveLength(1 + layout.photos.length)
      layout.photos.forEach((planned, index) => {
        const drawn = rects[index + 1]
        expect({
          x: Number(drawn?.getAttribute('x')),
          y: Number(drawn?.getAttribute('y')),
          width: Number(drawn?.getAttribute('width')),
          height: Number(drawn?.getAttribute('height')),
        }).toEqual(planned)
      })
      unmount()
    })

    it('re-draws the sheet as the copies change', () => {
      const { container, unmount } = mount()
      const spec = specOrThrow('uk-35x45')
      choose(container, 'UK passport')
      // 4×6 in holds six 35 × 45 mm photos, and the stepper starts at six.
      expect(planSheet(spec, '4x6', 6, spec.dpi, false).count).toBe(6)

      const decrease = [...container.querySelectorAll('button')].find(
        (node) => node.getAttribute('aria-label') === 'Decrease Copies',
      )
      for (let i = 0; i < 2; i += 1) click(decrease as HTMLButtonElement)

      expect([...container.querySelectorAll('span')].map((node) => node.textContent)).toContain('4')
      const shown = sheetFigure(container).querySelectorAll('rect').length - 1
      expect(shown).toBe(planSheet(spec, '4x6', 4, spec.dpi, false).photos.length)
      unmount()
    })

    it('clamps the copies stepper to what the sheet holds', () => {
      const { container, unmount } = mount()
      choose(container, 'US passport')

      const increase = [...container.querySelectorAll('button')].find(
        (node) => node.getAttribute('aria-label') === 'Increase Copies',
      )
      for (let i = 0; i < 30; i += 1) click(increase as HTMLButtonElement)

      expect([...container.querySelectorAll('span')].map((node) => node.textContent)).toContain('2')
      const planned = planSheet(specOrThrow('us-2x2'), '4x6', 2, 300, false)
      const text = textOf(container)
      expect(text).toContain('Printing all 2.')
      expect(text).toContain(
        `${planned.columns} across × ${planned.rows} down, 2 mm between photos.`,
      )
      unmount()
    })

    it('says how many the sheet holds, and how many are being printed', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      click(button(container, 'A4'))
      const spec = specOrThrow('uk-35x45')
      const capacity = planSheet(spec, 'a4', Number.MAX_SAFE_INTEGER, spec.dpi, false).count
      const text = textOf(container)

      expect(text).toContain(`Printing 6 of the ${capacity}`)
      expect(text).toContain('A4 sheet · 210 × 297 mm')
      expect(text).toContain('2 mm between photos')
      expect(text).toContain('Cut on the dashed lines.')
      unmount()
    })

    it('packs the size that will print, not the spec it replaced', () => {
      const { container, unmount } = mount()
      choose(container, 'UK passport')
      typeInto(field(container, 'Width in millimetres'), '40')
      typeInto(field(container, 'Height in millimetres'), '50')
      click(button(container, 'Use this size'))

      // 4×6 in of 40 × 50 mm photos is a different plan from 4×6 in of 35 × 45 mm
      // ones, and a figure showing the spec's plan beside a 40 × 50 mm print
      // would be drawing a sheet the exporter never builds.
      const spec = specOrThrow('uk-35x45')
      const packed = planSheet({ ...spec, widthMm: 40, heightMm: 50 }, '4x6', 6, spec.dpi, false)
      const specOnly = planSheet(spec, '4x6', 6, spec.dpi, false)
      const text = textOf(container)
      expect(text).toContain(`${packed.columns} across × ${packed.rows} down`)
      expect(text).toContain(`Printing all ${packed.count}`)
      // The two plans are not the same sheet, which is the whole point.
      expect(`${packed.columns}x${packed.rows}`).not.toBe(`${specOnly.columns}x${specOnly.rows}`)
      unmount()
    })
  })
})

/**
 * A measurement is a reading of one rendering. The panel used to take it from
 * three explicit buttons and then hold it forever, so a crop, a straighten, a
 * flip or a resize left the checklist converting an old set of landmarks into
 * millimetres through geometry the landmarks no longer sat in — and still
 * labelling the result `measured`.
 */
describe('PassportPanel keeps the measurement current', () => {
  beforeEach(() => {
    loadPhoto()
  })

  it('measures on open, without anyone pressing anything', async () => {
    const { container, unmount } = mount(photo)
    expect(state.measured).toBe(0)

    await waitFor(() => state.measured === 1)

    expect(container.textContent).toContain('read from the rendered photo')
    // The head rule is a real reading, not the spec's advisory midpoint.
    expect(ruleText(container, 'Head height')).toContain('Measured')
    expect(ruleText(container, 'Head height')).not.toContain('Spec value')
    unmount()
  })

  it('drops the reading the moment the geometry it was taken in moves', async () => {
    const { container, unmount } = mount(photo)
    await waitFor(() => state.measured === 1)

    act(() => {
      setCrop({ x: 0.1, y: 0.15, width: 0.8, height: 0.8 })
    })

    // Still on screen, but no longer claimed as a reading of this photo.
    expect(container.textContent).toContain('The photo changed since this reading')
    expect(textOf(container)).toContain('could not be measured from this photo yet')
    expect(ruleText(container, 'Head height')).toContain('Spec value')

    await waitFor(() => state.measured === 2)

    expect(container.textContent).toContain('read from the rendered photo')
    expect(ruleText(container, 'Head height')).not.toContain('Spec value')
    unmount()
  })

  it('collapses a drag into one re-measure rather than one per frame', async () => {
    const { unmount } = mount(photo)
    await waitFor(() => state.measured === 1)

    for (let step = 1; step <= 6; step += 1) {
      act(() => {
        setCrop({ x: step / 40, y: 0, width: 1 - step / 40, height: 1 })
      })
    }

    await waitFor(() => state.measured === 2)
    // Well past the debounce: six edits in a burst are one reading, not six.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(state.measured).toBe(2)
    unmount()
  })

  it('throws away a render that was already in flight when the photo changed', async () => {
    let release = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { container, unmount } = mount(photo)
    await waitFor(() => state.renders === 1)

    act(() => {
      setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
    })
    await waitFor(() => state.renders === 2)

    act(() => {
      release()
    })
    await waitFor(() => state.measured === 1)

    // One reading, from the render that was still current — not from the one
    // the abandoned crop was about to produce.
    expect(state.measured).toBe(1)
    expect(container.textContent).toContain('read from the rendered photo')
    unmount()
  })

  it('has no reading to go stale when there is no photo', () => {
    const { container, unmount } = mount(null)

    expect(container.textContent).toContain('Not measured yet')
    expect(container.textContent).not.toContain('The photo changed since this reading')
    unmount()
  })
})

describe('a failing check says what to change', () => {
  beforeEach(() => {
    loadPhoto()
    state.reading = OVERSIZED_HEAD
  })

  it('puts the measured millimetres and the required range on the rule', async () => {
    const { container, unmount } = mount(photo)
    choose(container, 'UK passport')
    await waitFor(() => state.measured > 0)
    const spec = specOrThrow('uk-35x45')
    const row = ruleText(container, 'Head height')

    // The rule failed, and both figures it compared are on screen: what the
    // photo measures, and the range the document asks for. `Head height is …`
    // is the engine's own sentence, kept because it says which of the two moved.
    expect(row).toMatch(/^failHead heightMeasured \d+\.\d mmRequired \d+–\d+ mm/)
    expect(row).toContain(`Required ${spec.headHeightMm.min}–${spec.headHeightMm.max} mm`)
    expect(row).toContain('Head height is')
    expect(row).not.toContain('Spec value')
    unmount()
  })

  it('says the verdict once, in plain words, above the list', async () => {
    const { container, unmount } = mount(photo)
    choose(container, 'UK passport')
    await waitFor(() => state.measured > 0)
    const lines = [...container.querySelectorAll('p')].map((node) =>
      (node.textContent ?? '').trim(),
    )

    expect(
      lines.some((line) => /^\d+ of 8 checks fail/.test(line)),
      `no headline among ${JSON.stringify(lines)}`,
    ).toBe(true)
    unmount()
  })
})
