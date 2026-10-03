import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setOutput } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { createHarness, resetStores, setNativeValue } from '../../store/testHarness'
import { effectiveOutputSize } from '../../model/selectors'
import { FLAGS_STORAGE_KEY, initFlags, resetFlags, setFlagState } from '../../lib/flags'
import type { Doc, Size } from '../../model/types'
import { createFakeCanvas } from '../../features/export/fakeCanvas'
import { normalizeWidths } from '../../features/export/multiSize'
import { NAME_TOKENS } from '../../features/export/naming'
import panel from './exportSheet.module.css'
import controls from '../controls/controls.module.css'
import { ExportSheet } from './ExportSheet'

const state = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  rendered: [] as Size[],
  /** Set to make every `renderExportCanvas` reject, as a lost context would. */
  failWith: null as Error | null,
}))

vi.mock('../../render/exportCanvas', () => ({
  renderExportCanvas: async (_source: unknown, doc: Doc, size?: Size) => {
    if (state.gate) await state.gate
    if (state.failWith) throw state.failWith
    const { effectiveOutputSize: sizeOf } = await import('../../model/selectors')
    const resolved = size ?? sizeOf(doc as never)
    state.rendered.push(resolved)
    const { createFakeCanvas: make } = await import('../../features/export/fakeCanvas')
    return make(resolved.width, resolved.height)
  },
}))

const harness = createHarness()
const source = { width: 4000, height: 3000 } as unknown as ImageBitmap

/** The `download` attribute of every anchor the panel clicked, in order. */
const downloads: string[] = []
let realCreateObjectURL: unknown
let realAnchorClick: unknown

function mount() {
  harness.render(<ExportSheet source={source} fileName="holiday" />)
}

function buttons(): HTMLButtonElement[] {
  return Array.from(harness.container.querySelectorAll('button'))
}

function button(label: string): HTMLButtonElement | undefined {
  return buttons().find((candidate) => candidate.textContent === label)
}

function checkboxNear(text: string): HTMLInputElement | undefined {
  const label = Array.from(harness.container.querySelectorAll('label')).find((candidate) =>
    candidate.textContent?.includes(text),
  )
  return label?.querySelector('input[type=checkbox]') ?? undefined
}

async function waitFor(predicate: () => boolean, timeout = 3000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
  }
}

function widthLabels(): HTMLLabelElement[] {
  return Array.from(harness.container.querySelectorAll('label')).filter((label) =>
    /^\d+px/.test(label.textContent ?? ''),
  )
}

beforeEach(() => {
  state.gate = null
  state.rendered = []
  state.failWith = null
  // jsdom has no canvas: seed the capability cache so `loadCaps` never probes.
  localStorage.setItem(
    'ie-caps-v1',
    JSON.stringify({
      webgl2: false,
      colorBufferHalfFloat: false,
      linearFloat: false,
      maxTextureSize: 4096,
      maxRenderbufferSize: 4096,
      maxCanvasArea: 4096 * 4096,
      formats: { webp: false, avif: false },
      saveData: false,
      offscreenCanvas: false,
      workerWebgl: false,
    }),
  )
  resetStores()
  useDocStore.getState().update((doc) => ({
    ...doc,
    source: {
      assetId: 'asset_1',
      width: 4000,
      height: 3000,
      name: 'holiday.jpg',
      mime: 'image/jpeg',
    },
  }))
  useUiStore.setState({ jobs: [], toasts: [] })
  // jsdom cannot download, and `downloadBlob` hands the name to a real anchor.
  // Capturing the click is the honest way to read the name: it is the same
  // string the browser would have saved, taken at the last possible moment.
  downloads.length = 0
  realCreateObjectURL = URL.createObjectURL
  URL.createObjectURL = () => 'blob:export-sheet-test'
  realAnchorClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function capture(this: HTMLAnchorElement) {
    downloads.push(this.download)
  }
  mount()
})

afterEach(() => {
  URL.createObjectURL = realCreateObjectURL as typeof URL.createObjectURL
  HTMLAnchorElement.prototype.click = realAnchorClick as () => void
  harness.unmount()
})

function templateField(): HTMLInputElement {
  const field = harness.container.querySelector<HTMLInputElement>(
    'input[aria-label="File name template"]',
  )
  if (!field) throw new Error('the export sheet has no file name template field')
  return field
}

function typeTemplate(value: string): void {
  const field = templateField()
  act(() => {
    setNativeValue(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The line that shows what Download and the zip will be called. */
function previewLine(): string {
  const found = Array.from(harness.container.querySelectorAll('p')).find((node) =>
    node.textContent?.includes('Download as'),
  )
  return found?.textContent ?? ''
}

describe('ExportSheet metadata policy (D7-F01, D7-F08)', () => {
  it('offers only the two policies it can actually honour', () => {
    const group = harness.container.querySelector('[aria-label="Metadata policy"]')
    expect(group).not.toBeNull()
    const labels = Array.from(group?.querySelectorAll('button') ?? []).map((b) => b.textContent)
    expect(labels).toEqual(['Strip', 'Keep the rotation tag'])
    expect(labels).not.toContain('Keep all')
  })

  it('names the tag it writes rather than the orientation it would confuse', () => {
    // "Orientation" is portrait-or-landscape everywhere else in the app — the
    // passport panel's "Print orientation" — so the control cannot spend the word
    // on the EXIF rotation flag as well.
    const group = harness.container.querySelector('[aria-label="Metadata policy"]')
    const labels = Array.from(group?.querySelectorAll('button') ?? []).map((b) => b.textContent)
    expect(labels).not.toContain('Keep orientation')
    expect(labels.join(' ')).not.toMatch(/orientation/i)
  })

  it('spells out what Strip removes and that source metadata never survives', () => {
    const hint = Array.from(harness.container.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('Strip removes EXIF'),
    )
    // `XMP` was added when the copy was audited against `MetadataPolicy`, which
    // names five containers and the sentence named four.
    expect(hint?.textContent).toMatch(/colour profile, IPTC, XMP and comments/)
  })
})

/**
 * Seed the capability cache the shape `readCachedCaps` actually reads.
 *
 * The `beforeEach` above still writes the `ie-caps-v1` bare shape, which the
 * current envelope (`{ v, at, caps }` under `ie-caps-v4`) rejects — so the sheet
 * under test has been *probing* in jsdom, where every `toDataURL` throws and so
 * every format reads as unencodable. That is the right answer for WebP and
 * AVIF by accident, which is not a thing to build the AVIF copy on, so the
 * branch that matters is seeded explicitly here.
 */
function seedAvif(avif: boolean): void {
  localStorage.setItem(
    'ie-caps-v4',
    JSON.stringify({
      v: 4,
      at: Date.now(),
      caps: {
        webgl2: false,
        colorBufferHalfFloat: false,
        linearFloat: false,
        maxTextureSize: 4096,
        maxRenderbufferSize: 4096,
        maxCanvasArea: 4096 * 4096,
        formats: { webp: true, avif },
        saveData: false,
        offscreenCanvas: false,
        workerWebgl: false,
      },
    }),
  )
}

const formatButtons = () =>
  Array.from(
    harness.container.querySelectorAll<HTMLButtonElement>('[aria-label="Export format"] button'),
  ).map((button) => button.textContent)

const avifNote = () =>
  Array.from(harness.container.querySelectorAll('p')).find((p) => /AVIF/.test(p.textContent ?? ''))

describe('the format picker never goes quietly short', () => {
  it('says why AVIF is missing when the browser cannot encode it', () => {
    // The Hub says "plus AVIF where your browser can encode it", and a format
    // the browser cannot encode is dropped from the options — so where that
    // condition is false the picker was one button short with nothing on screen
    // to account for it. Absence is only silent to someone who already knows.
    seedAvif(false)
    harness.unmount()
    mount()
    expect(formatButtons()).not.toContain('AVIF')
    expect(avifNote()?.textContent).toBe('AVIF is missing because this browser cannot encode it.')
  })

  it('keeps AVIF in the picker, and says nothing about it, when the browser can encode it', () => {
    seedAvif(true)
    harness.unmount()
    mount()
    expect(formatButtons()).toContain('AVIF')
    // The line is for the gap, not for the format. Naming a format that is
    // present is a second thing to read and a first thing to go stale.
    expect(avifNote()).toBeUndefined()
  })
})

describe('ExportSheet target size (D7-F14)', () => {
  it('drops a size cap when switching to a format that cannot enforce it', () => {
    act(() => {
      setOutput({ targetBytes: 500 * 1024 })
    })
    act(() => {
      button('PNG')?.click()
    })
    expect(useDocStore.getState().present.output.targetBytes).toBeNull()
  })

  it('keeps a size cap when switching between lossy formats', () => {
    act(() => {
      setOutput({ format: 'webp', targetBytes: 500 * 1024 })
    })
    act(() => {
      button('JPEG')?.click()
    })
    expect(useDocStore.getState().present.output.targetBytes).toBe(500 * 1024)
  })

  it('says the export is over target in the error tone', async () => {
    act(() => {
      setOutput({ format: 'jpeg', targetBytes: 5 * 1024, quality: 0.92 })
    })
    await waitFor(() => Boolean(checkboxNear('Fit under a maximum size')))
    // The estimated export is far larger than 5 KB at any searched quality.
    await waitFor(() => Boolean(harness.container.querySelector('[role=alert]')))
    const alert = harness.container.querySelector('[role=alert]')
    expect(alert?.textContent).toMatch(/Over target/)
    expect(alert?.getAttribute('style')).toContain('color')
    const readout = Array.from(harness.container.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('over target'),
    )
    expect(readout).toBeDefined()
  })

  it('explains that a lossless format cannot be squeezed to a size', () => {
    act(() => {
      setOutput({ format: 'png' })
    })
    const note = Array.from(harness.container.querySelectorAll('p')).find((p) =>
      p.textContent?.includes('lossless'),
    )
    expect(note?.textContent).toMatch(/cannot be re-encoded to hit a byte target/)
  })
})

/**
 * "matte" is a VFX word, and the aria-label was the only place a user met it:
 * the field a screen reader announces as "Export matte colour" is a colour
 * picker. The heading moved too, from "Background behind transparency" — which
 * reads as the Background tab — to a sentence about where the colour goes.
 */
describe('ExportSheet behind transparent areas (plain words, not "matte")', () => {
  const COLOUR_FIELD = 'input[aria-label="Colour behind transparent areas"]'
  const matteRadio = (value: string) =>
    harness.container.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`)

  it('never puts the word "matte" in anything a user can read or hear', () => {
    const text = harness.container.textContent ?? ''
    expect(text).not.toMatch(/matte/i)
    for (const element of harness.container.querySelectorAll('[aria-label]')) {
      expect(element.getAttribute('aria-label')).not.toMatch(/matte/i)
    }
    const headings = Array.from(harness.container.querySelectorAll('p'))
      .map((p) => p.textContent)
      .filter((value): value is string => Boolean(value))
      .filter((value) => /^\s*[A-Z]/.test(value) && value.length < 60)
    expect(headings.join(' ')).not.toMatch(/matte|transparency/i)
  })

  it('names the heading by where the colour goes, not after the Background tab', () => {
    const text = harness.container.textContent ?? ''
    expect(text).toContain('Behind transparent areas')
    expect(text).not.toContain('Background behind transparency')
  })

  it('exposes a colour field and a transparent option', () => {
    const colour = harness.container.querySelector<HTMLInputElement>(COLOUR_FIELD)
    expect(colour).not.toBeNull()
    expect(colour?.type).toBe('color')
    expect(matteRadio('transparent')).toBeDefined()
    expect(matteRadio('colour')).toBeDefined()
  })

  it('styles the colour field, which an `aria-label` is not', () => {
    // It carried a name and nothing else, so it never picked up
    // `controls.module.css`'s `.colorInput` and stayed at the UA's 50 × 27 — a
    // bare target on the one row where two halves have to be aimed at the same
    // decision. jsdom has no layout, so the *size* is asserted in a real
    // browser (`journey.export-sheet.spec.ts`); what jsdom can hold is that the
    // class is the one that carries the size.
    const colour = harness.container.querySelector<HTMLInputElement>(COLOUR_FIELD)
    expect(colour?.className).toContain(controls.colorInput)
    // And not the string "undefined", which is what a class from the wrong
    // module resolves to and which looks like a class in the DOM.
    expect(colour?.className).not.toContain('undefined')
  })

  it('stores a chosen background colour in the document', () => {
    const colour = harness.container.querySelector<HTMLInputElement>(COLOUR_FIELD)
    if (!colour) throw new Error('no background colour field')
    act(() => {
      setNativeValue(colour, '#ff8800')
      colour.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(useDocStore.getState().present.output.matte).toBe('#ff8800')
  })

  it('stores the transparent option', () => {
    act(() => {
      matteRadio('transparent')?.click()
    })
    expect(useDocStore.getState().present.output.matte).toBe('transparent')
  })
})

describe('ExportSheet multi-size widths (D7-F15)', () => {
  it('lets the user choose the widths instead of hard-coding three', () => {
    const labels = widthLabels()
    const widths = labels.map((label) => Number(/(\d+)px/.exec(label.textContent ?? '')?.[1]))
    expect(widths.length).toBeGreaterThan(3)
    expect(widths).toContain(720)
    expect(widths).toContain(3840)
  })

  it('never lets the last width be unticked', () => {
    const labels = widthLabels()
    // Untick everything that is currently ticked, one at a time.
    for (const label of labels) {
      const input = label.querySelector<HTMLInputElement>('input')
      if (input?.checked) act(() => input.click())
    }
    const remaining = labels.filter(
      (label) => label.querySelector<HTMLInputElement>('input')?.checked,
    )
    expect(remaining).toHaveLength(1)
  })
})

describe('ExportSheet jobs and cancellation (D7-F16)', () => {
  it('drives uiStore progress and offers a cancel while an export runs', async () => {
    let release: () => void = () => {}
    state.gate = new Promise<void>((resolve) => {
      release = resolve
    })
    act(() => {
      button('Download')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'running'))
    expect(button('Cancel')).toBeDefined()
    expect(button('Working…')?.disabled).toBe(true)

    act(() => {
      button('Cancel')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'cancelled'))
    expect(useUiStore.getState().toasts.some((toast) => toast.message === 'Export cancelled')).toBe(
      true,
    )

    act(() => release())
  })

  it('reports success and finishes the job on a normal export', async () => {
    act(() => {
      button('Download')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.length > 0)
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    expect(useUiStore.getState().toasts.some((toast) => toast.message === 'Exported')).toBe(true)
  })

  it('reports a real failure instead of swallowing it', async () => {
    const original = URL.createObjectURL
    URL.createObjectURL = () => {
      throw new Error('object URLs are gone')
    }
    try {
      act(() => {
        button('Download')?.click()
      })
      await waitFor(() => useUiStore.getState().jobs.length > 0)
      await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'error'))
      expect(useUiStore.getState().toasts.some((toast) => toast.message === 'Export failed')).toBe(
        true,
      )
    } finally {
      URL.createObjectURL = original
    }
  })
})

describe('ExportSheet share and copy gating', () => {
  it('hides Share and Copy when the browser cannot do them', () => {
    expect(button('Share')).toBeUndefined()
    expect(button('Copy')).toBeUndefined()
  })

  it('hides Share on a browser that has share() but no canShare({files})', () => {
    const original = navigator.share
    Object.defineProperty(navigator, 'share', { value: () => {}, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    try {
      act(() => {
        setOutput({ quality: 0.5 })
      })
      expect(button('Share')).toBeUndefined()
    } finally {
      Object.defineProperty(navigator, 'share', { value: original, configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
    }
  })
})

describe('ExportSheet size estimate', () => {
  it('renders at the effective output size and reports an estimate', async () => {
    await waitFor(() => state.rendered.length > 0)
    expect(state.rendered[0]).toEqual(effectiveOutputSize(useDocStore.getState().present))
    expect(state.rendered[0]).toEqual({ width: 4000, height: 3000 })
    await waitFor(() => Boolean(harness.container.textContent?.includes('Output:')))
    expect(harness.container.textContent).toMatch(/300 DPI/)
  })
})

/**
 * The estimate used to become `null` on failure and the readout rendered `''`
 * for it, so moving the Quality slider made the size silently vanish and nothing
 * said why. A blank clause is the defect: it is indistinguishable from "no size
 * information applies here", which is a different and wrong claim.
 */
describe('the size estimate never disappears without a reason', () => {
  const status = () => harness.container.querySelector('p[role="status"]')
  const readout = () =>
    Array.from(harness.container.querySelectorAll('p')).find((p) =>
      p.textContent?.startsWith('Output:'),
    )

  it('names the size as unknown and gives the reason, and keeps the rest of the line', async () => {
    state.failWith = new Error('The WebGL context was lost while rendering the export.')
    harness.unmount()
    mount()
    await waitFor(() => Boolean(status()))
    // The dimensions and the DPI did not stop being known, so they stay.
    expect(readout()?.textContent).toBe('Output: 4000 × 3000 px · 300 DPI · size unknown')
    expect(status()?.textContent).toMatch(/The size estimate failed/)
    expect(status()?.textContent).toMatch(/WebGL context was lost/)
  })

  it('does not claim the download still works, because it runs the same encode', async () => {
    state.failWith = new Error('boom')
    harness.unmount()
    mount()
    await waitFor(() => Boolean(status()))
    expect(status()?.textContent).toMatch(/same encode/)
    // The tempting sentence, asserted absent: this is the whole difference
    // between an honest degradation and a new lie.
    expect(status()?.textContent).not.toMatch(/still works|you can still|no problem/i)
  })

  it('reports no reason of its own when the failure carries none', async () => {
    state.failWith = new Error('')
    harness.unmount()
    mount()
    await waitFor(() => Boolean(status()))
    expect(status()?.textContent).toMatch(/the render reported no reason/)
  })

  it('keeps the last good figure while a new one is being computed, not a blank', async () => {
    await waitFor(() => Boolean(readout()?.textContent?.includes('~')))
    const before = readout()?.textContent
    // A new debounced pass is now in flight for the new key.
    act(() => {
      setOutput({ quality: 0.42 })
    })
    expect(readout()?.textContent).toMatch(/estimating…/)
    // …and the moment it lands the figure is back, with no flash of nothing.
    await waitFor(() => Boolean(readout()?.textContent?.includes('~')))
    expect(readout()?.textContent).not.toBe(before)
  })

  it('says "estimating" on first paint rather than showing nothing at all', () => {
    // `null` used to mean both "not started yet" and "failed", so the first
    // 350 ms read as a panel with no size. The two are now distinct states.
    expect(readout()?.textContent).toBe('Output: 4000 × 3000 px · 300 DPI · estimating…')
  })

  it('re-estimates when the output size changes, so both halves describe one document', async () => {
    await waitFor(() => Boolean(readout()?.textContent?.includes('~')))
    expect(readout()?.textContent).toMatch(/4000 × 3000/)
    const rendersBefore = state.rendered.length
    // A crop applied behind the panel: the pixel count changes, so the old `~`
    // figure described a different image than the `×` beside it.
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: {
          ...doc.geometry,
          crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },
      }))
    })
    await waitFor(() => state.rendered.length > rendersBefore)
    await waitFor(() => Boolean(readout()?.textContent?.includes('~')))
    expect(readout()?.textContent).toMatch(/2000 × 1500/)
  })
})

describe('ExportSheet canvas contract', () => {
  it('never touches toDataURL anywhere in the export path', () => {
    // The fake canvas throws from `toDataURL`; a full Download run above proves
    // the PDF path no longer builds a base64 string.
    const canvas = createFakeCanvas(10, 10)
    expect(() => canvas.toDataURL()).toThrow(/toDataURL must not be used/)
  })
})

/**
 * D7-F17 — the filename templating that was built and never wired.
 *
 * The names are read off the anchor `downloadBlob` clicks, so what is asserted
 * is the string the browser would have written to disk, not a copy of it.
 */
describe('ExportSheet filename template (D7-F17)', () => {
  it('advertises every token the naming module implements', () => {
    const text = harness.container.textContent ?? ''
    for (const token of NAME_TOKENS) expect(text).toContain(token)
    expect(text).toContain('Using the default name.')
  })

  it('previews both names from the default fallback', () => {
    const line = previewLine()
    expect(line).toContain('holiday-4000x3000.jpg')
    // The archive is named for the widths the zip holds, not the tick boxes.
    expect(line).toContain('holiday-3-sizes.zip')
  })

  it('downloads under the name the template builds', async () => {
    typeTemplate('{name}-{width}x{height}-{format}')
    expect(previewLine()).toContain('holiday-4000x3000-jpg.jpg')

    act(() => {
      button('Download')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.length > 0)
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    expect(downloads).toEqual(['holiday-4000x3000-jpg.jpg'])
  })

  it('drops a token the file cannot fill and collapses its separators', async () => {
    act(() => {
      setOutput({ format: 'pdf' })
    })
    typeTemplate('{name}-{dpi}-{format}')

    act(() => {
      button('Download')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.length > 0)
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    // A PDF has no density header, so "{dpi}" is gone and the two separators it
    // left behind have collapsed into one.
    expect(downloads).toEqual(['holiday-pdf.pdf'])
  })

  it('names the multi-size zip from the same template', async () => {
    typeTemplate('{name}-set')
    expect(previewLine()).toContain('holiday-set.zip')

    act(() => {
      button('Multi-size zip')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.length > 0)
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    expect(downloads).toEqual(['holiday-set.zip'])
  })

  it('keeps the template out of the document and off the undo stack', () => {
    // `load` is the only way back to a history with nothing in it, so an undo
    // here can only be explained by the template itself.
    const state = useDocStore.getState()
    state.load(state.present)
    const base = useDocStore.getState()
    const doc = base.present

    typeTemplate('{name}-{dpi}')

    const after = useDocStore.getState()
    expect(after.present).toEqual(doc)
    expect(after.past).toHaveLength(0)
    expect(after.revision).toBe(base.revision)
    // Nothing to undo: a file name is not an edit to the picture.
    act(() => {
      useDocStore.getState().undo()
    })
    expect(useDocStore.getState().present).toEqual(doc)
    // And the field the user typed is still what the panel shows.
    expect(previewLine()).toContain('holiday-300.jpg')
  })
})

describe('ExportSheet · the export flag', () => {
  /** Every Blob handed to `URL.createObjectURL`, i.e. every file that reached one. */
  let saved: Blob[]

  beforeEach(() => {
    saved = []
    // Only the flag key: the outer setup seeds `ie-caps-v1` so `loadCaps` never
    // probes, and clearing all of storage would put that noise back.
    localStorage.removeItem(FLAGS_STORAGE_KEY)
    act(() => {
      resetFlags()
      setFlagState('export', 'off')
    })
    const real = URL.createObjectURL
    URL.createObjectURL = function capture(blob: Blob | MediaSource) {
      saved.push(blob as Blob)
      return real.call(URL, blob)
    } as typeof URL.createObjectURL
  })

  afterEach(() => {
    localStorage.removeItem(FLAGS_STORAGE_KEY)
    act(() => {
      resetFlags()
    })
  })

  it('is exactly the shipped sheet when the flag is default', () => {
    localStorage.removeItem(FLAGS_STORAGE_KEY)
    act(() => {
      resetFlags()
    })
    harness.render(<ExportSheet source={source} fileName="holiday" />)
    expect(button('Download')).toBeDefined()
    expect(button('Multi-size zip')).toBeDefined()
    expect(templateField()).toBeTruthy()
  })

  it('says the sheet is off and names the address bar for a url flag', () => {
    act(() => {
      resetFlags()
      initFlags({ search: '?off=export' })
    })
    harness.render(<ExportSheet source={source} fileName="holiday" />)

    const notice = harness.container.querySelector('[role="status"]')
    expect(notice?.textContent).toBe(
      'Full export is turned off for this page by ?off=export in the address bar. ' +
        'Remove it from the address bar to turn it back on.',
    )
    // No restore button: nothing here can undo a query parameter.
    expect(button('Turn the full export sheet back on')).toBeUndefined()
  })

  it('is not a dead end — the fallback actually reaches a file', async () => {
    harness.render(<ExportSheet source={source} fileName="holiday" />)
    // The whole sheet is gone, and what is left is not a dead end.
    expect(button('Download')).toBeUndefined()
    expect(button('Multi-size zip')).toBeUndefined()
    expect(harness.container.querySelector('[aria-label="File name template"]')).toBeNull()

    act(() => {
      button('Save as PNG')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.length > 0)
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))

    // The bytes, not just the fact that something was clicked.
    expect(saved).toHaveLength(1)
    expect(saved[0].type).toBe('image/png')
    expect(saved[0].size).toBeGreaterThan(0)
    expect(downloads).toEqual(['holiday-4000x3000.png'])
  })

  it('says exactly what the fallback does not do', () => {
    harness.render(<ExportSheet source={source} fileName="holiday" />)
    const text = harness.container.textContent ?? ''
    expect(text).toContain('You can still save the picture')
    // Promising format choice, metadata or a zip here would be a lie: none of
    // that path exists while the sheet is off.
    for (const absent of ['Target size', 'File name', 'Behind transparent areas']) {
      expect(text).not.toContain(absent)
    }
  })

  it('brings the whole sheet back from its own button', () => {
    harness.render(<ExportSheet source={source} fileName="holiday" />)
    act(() => {
      button('Turn the full export sheet back on')?.click()
    })
    expect(button('Download')).toBeDefined()
    expect(button('Multi-size zip')).toBeDefined()
    expect(button('Save as PNG')).toBeUndefined()
  })

  it('does not pay for a size estimate it is not going to use', () => {
    act(() => {
      setFlagState('export', 'off')
    })
    harness.render(<ExportSheet source={source} fileName="holiday" />)
    // The estimate runs the very render and encode this panel is declared
    // suspect of; while the flag is off it must not fire at all.
    expect(state.rendered).toEqual([])
  })
})

/* ==========================================================================
   The panel fits its column.

   The panel's content measured 690 px in a 360 px inspector — seven width
   chips in a non-wrapping flex row, and a five-button segmented control whose
   buttons are `white-space: nowrap` — so the whole surface scrolled sideways to
   reach controls that were always on screen.

   jsdom has no layout engine: `scrollWidth` and `clientWidth` are both `0` for
   every element, so an assertion of `scrollWidth <= clientWidth` written here
   would pass on a panel that overflows by 330 px. It is *not* written here. The
   real measurement is `e2e/journey.export-width.spec.ts`, which asserts
   `scrollWidth <= clientWidth` at 360 / 430 / 1280 in a real browser; it is in
   `e2e/`, which this change does not own, and the diff is in the handoff.

   What this file can honestly check is the thing the measurement depends on: the
   stylesheet the build ships really does wrap every row that can outgrow the
   column, really never scrolls sideways itself, and the panel really renders
   those containers. A grep of the source is not the claim — the claim is "this
   rule set, as written, cannot lay out wider than its container", and the
   structural assertions are what connect it to the markup.
   ========================================================================== */

const PANEL_CSS = readFileSync(
  resolve(process.cwd(), 'src/components/tools/exportSheet.module.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of one top-level rule, read from the file the build ships. */
function ruleBody(selector: string): string {
  const at = PANEL_CSS.indexOf(`${selector} {`)
  expect(at, `${selector} is declared in exportSheet.module.css`).toBeGreaterThan(-1)
  return PANEL_CSS.slice(at, PANEL_CSS.indexOf('}', at))
}

describe('the panel cannot lay out wider than the column it is given', () => {
  it('never scrolls sideways itself', () => {
    // The tempting fix for a too-wide panel is `overflow-x: auto`. It hides the
    // symptom by moving the content out of reach, which is the defect.
    expect(PANEL_CSS).not.toMatch(/overflow(-x)?\s*:\s*(auto|scroll)/)
  })

  it('wraps the width chips, and keeps each chip at its own width', () => {
    const widths = ruleBody('.widths')
    expect(widths).toMatch(/display:\s*flex/)
    expect(widths).toMatch(/flex-wrap:\s*wrap/)
    // `flex: 0 0 auto` and not `1 1 auto`: a shrinkable chip is squeezed below
    // its own text and overflows it, which is the same defect one level down.
    expect(ruleBody('.widths > *')).toMatch(/flex:\s*0 0 auto/)
  })

  it('lets the segmented controls wrap instead of holding a nowrap floor', () => {
    // "No resize | Width | Height | Long edge | Percent" is ~381 px of
    // non-breaking text. Wrapping it here rather than in `SegmentedControl` is
    // deliberate: the control owns its look, this panel owns its column, and
    // changing the shared control to fix one column would change all of them.
    expect(ruleBody('.segments')).toMatch(/flex-wrap:\s*wrap/)
    const inner = ruleBody('.segments > *')
    expect(inner).toMatch(/flex-wrap:\s*wrap/)
    expect(inner).toMatch(/min-width:\s*0/)
  })

  it('lets a number input shrink, which is the one control with a 20-char floor', () => {
    const input = ruleBody('.numberInput')
    expect(input).toMatch(/min-width:\s*0/)
    expect(input).toMatch(/width:\s*100%/)
  })

  it('breaks the unbreakable strings — tokens and file names', () => {
    // `overflow-wrap: anywhere` and not `break-word`: the strings that overflow
    // here are `{width}` and `holiday-4000x3000-sizes.zip`, which contain no
    // spaces for `break-word` to find.
    expect(ruleBody('.panel')).toMatch(/overflow-wrap:\s*anywhere/)
    expect(ruleBody('.panel')).toMatch(/min-width:\s*0/)
  })

  it('renders the width chips inside that wrapping container', () => {
    const group = harness.container.querySelector('[aria-label="Multi-size zip widths"]')
    expect(group?.getAttribute('class')).toContain(panel.widths)
    const labels = widthLabels()
    expect(labels).toHaveLength(7)
    for (const label of labels) expect(label.parentElement).toBe(group)
  })

  it('wraps every segmented control on the panel', () => {
    for (const name of ['Export format', 'Resize mode', 'Metadata policy']) {
      const group = harness.container.querySelector(`[aria-label="${name}"]`)
      expect(group, name).not.toBeNull()
      expect(group?.parentElement?.getAttribute('class'), name).toContain(panel.segments)
    }
  })

  it('carries no inline width anywhere, because an inline width is how it started', () => {
    for (const element of Array.from(harness.container.querySelectorAll('[style]'))) {
      expect(element.getAttribute('style')).not.toMatch(/(^|;)\s*(width|min-width)\s*:/)
    }
  })

  it('puts the five actions in a wrapping row of flexible buttons', () => {
    const download = button('Download')
    const actions = download?.parentElement
    expect(actions?.getAttribute('class')).toContain(panel.actions)
    expect(ruleBody('.actions')).toMatch(/flex-wrap:\s*wrap/)
    expect(ruleBody('.actions > button')).toMatch(/flex:\s*1 1 140px/)
    expect(ruleBody('.actions svg')).toMatch(/calc\(16px \* var\(--icon-scale\)\)/)
  })
})

/* ==========================================================================
   The five actions: a mark each, and a name that did not move.

   `DownloadGlyph`, `ShareGlyph`, `CopyGlyph`, `ArchiveGlyph` and `CancelGlyph`
   were drawn, exported, deduped by the icon system — and never rendered
   anywhere, while `ExportGlyph` sat on the Hub card for a tool nobody had
   opened. Wiring them in is the easy half. The half that has bitten twice is the
   accessible name: a decorative glyph is `aria-hidden`, and the moment it is not
   the button is announced twice, so these assertions are on the *name* first and
   the artwork second.
   ========================================================================== */

type ShareDataLike = { files?: File[]; title?: string }

function define(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
}

/** jsdom has no share sheet and no async clipboard; both are opt-in per test. */
type Capabilities = {
  canShare?: (data?: ShareDataLike) => boolean
  share?: (data: ShareDataLike) => Promise<void>
  write?: (items: { items: Record<string, Blob> }[]) => Promise<void>
  supports?: (type: string) => boolean
}

function installBrowserCapabilities(capabilities: Capabilities): () => void {
  if (capabilities.canShare) define(navigator, 'canShare', capabilities.canShare)
  if (capabilities.share) define(navigator, 'share', capabilities.share)
  if (capabilities.write || capabilities.supports) {
    class FakeClipboardItem {
      static supports: (type: string) => boolean = capabilities.supports ?? (() => true)
      readonly items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }
    define(globalThis, 'ClipboardItem', FakeClipboardItem)
    define(navigator, 'clipboard', { write: capabilities.write ?? (() => Promise.resolve()) })
  }
  return () => {
    define(navigator, 'canShare', undefined)
    define(navigator, 'share', undefined)
    define(navigator, 'clipboard', undefined)
    define(globalThis, 'ClipboardItem', undefined)
  }
}

/**
 * Remount with the given capabilities, run the body, then take them away again.
 *
 * The `await` is load-bearing rather than stylistic: a `return body()` inside a
 * `try` restores the stubs the instant the promise is *created*, so the export
 * under test runs with the real jsdom navigator and every stubbed rejection
 * quietly becomes a success. A stub that is removed before the thing it stubs is
 * exercised is worse than no stub, because it passes.
 */
async function withCapabilities<T>(
  capabilities: Capabilities,
  body: () => T | Promise<T>,
): Promise<T> {
  const restore = installBrowserCapabilities(capabilities)
  try {
    harness.unmount()
    mount()
    return await body()
  } finally {
    restore()
  }
}

/** The four always-present actions, in the order the panel renders them. */
const ACTIONS = ['Download', 'Share', 'Copy', 'Multi-size zip']

/** The names of the action row's buttons, which is what a screen reader reads. */
function actionNames(): (string | null)[] {
  return Array.from(button('Download')?.parentElement?.children ?? []).map(
    (element) => element.textContent,
  )
}

/** Capabilities for a browser that offers all five actions. */
const EVERYTHING: Capabilities = {
  canShare: () => true,
  share: () => Promise.resolve(),
  supports: () => true,
  write: () => Promise.resolve(),
}

describe('the five actions carry a mark and keep the name they had', () => {
  it('puts a glyph inside each of the four always-present actions', async () => {
    await withCapabilities(EVERYTHING, () => {
      for (const name of ACTIONS) {
        const element = button(name)
        expect(element, `${name} is missing`).toBeDefined()
        expect(element?.querySelector('svg'), `${name} has no icon`).not.toBeNull()
      }
    })
  })

  it('leaves every accessible name exactly as it was', async () => {
    // The pinned set, in the order the panel renders them. A glyph added to the
    // left of the label is fine; a glyph that joins the name is a regression, and
    // this is the assertion that says so.
    await withCapabilities(EVERYTHING, () => {
      expect(actionNames()).toEqual(ACTIONS)
    })
  })

  it('keeps the glyphs decorative, so the label is still the whole name', async () => {
    await withCapabilities(EVERYTHING, () => {
      for (const name of ACTIONS) {
        const svg = button(name)?.querySelector('svg')
        expect(svg?.getAttribute('aria-hidden'), name).toBe('true')
        expect(svg?.getAttribute('role'), name).toBeNull()
        expect(svg?.getAttribute('aria-label'), name).toBeNull()
      }
    })
  })

  it('draws a different shape for each of them', async () => {
    // "Copy" beside "Download" and "Share" was the vaguest triad in the product,
    // so the fix has to be four marks rather than three words with one mark.
    await withCapabilities(EVERYTHING, () => {
      const artwork = ACTIONS.map((name) => button(name)?.querySelector('svg')?.innerHTML)
      expect(new Set(artwork).size, 'two buttons share one piece of artwork').toBe(ACTIONS.length)
    })
  })

  it('marks the button that is running, and only that one', async () => {
    // The row used to render every label as `Working…` while any one of them ran,
    // so a zip in progress showed "Download · Working…" — a label on the wrong
    // button claiming the wrong work.
    let release: () => void = () => {}
    state.gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    await withCapabilities(EVERYTHING, async () => {
      act(() => {
        button('Multi-size zip')?.click()
      })
      await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'running'))
      // Download keeps its own name; the fourth slot is the one that is busy.
      expect(actionNames()).toEqual(['Download', 'Share', 'Copy', 'Working…', 'Cancel'])
      act(() => release())
      await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    })
  })

  it('marks Cancel too, so stopping a job looks like the action it is', async () => {
    let release: () => void = () => {}
    state.gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    await withCapabilities(EVERYTHING, async () => {
      act(() => {
        button('Download')?.click()
      })
      await waitFor(() => Boolean(button('Cancel')))
      expect(button('Cancel')?.querySelector('svg')).not.toBeNull()
      act(() => release())
      await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    })
  })
})

/* ==========================================================================
   The zip says what it is before it costs it.

   One button, unlabelled as to scale, could be seven full-resolution renders.
   `multiWidths` is the source of truth — `normalizeWidths(widths)` is the exact
   list `buildMultiSizeZip` iterates — so the summary reads that list rather than
   counting tick boxes, and the count it prints is compared against the number of
   entries the archive actually contained.
   ========================================================================== */

function zipSummary(): HTMLElement | null {
  return harness.container.querySelector(`.${panel.zipSummary}`)
}

/** Tick or untick one width chip, the way a user would. */
function tick(width: number, on: boolean): void {
  const label = widthLabels().find(
    (candidate) => Number(/(\d+)px/.exec(candidate.textContent ?? '')?.[1]) === width,
  )
  const box = label?.querySelector<HTMLInputElement>('input')
  if (!box) throw new Error(`the panel has no ${width}px checkbox`)
  if (box.checked !== on) act(() => box.click())
}

describe('the multi-size zip is described before it is committed to', () => {
  it('names the widths, the format and the count from the normalised list', () => {
    const expected = normalizeWidths([720, 1080, 1920])
    expect(expected).toEqual([720, 1080, 1920])
    expect(zipSummary()?.textContent).toContain('3 files: 720 px, 1080 px and 1920 px wide')
    expect(zipSummary()?.textContent).toContain('saved as JPEG')
  })

  it('follows the format switch, because the archive does', () => {
    act(() => {
      setOutput({ format: 'png' })
    })
    expect(zipSummary()?.textContent).toContain('saved as PNG')
  })

  it('says plainly when the job is a long one', () => {
    for (const width of [640, 1440, 1920, 2560, 3840]) tick(width, true)
    const text = zipSummary()?.textContent ?? ''
    expect(text).toContain(
      '7 files: 640 px, 720 px, 1080 px, 1440 px, 1920 px, 2560 px and 3840 px',
    )
    expect(text).toContain('7 full-resolution renders')
    expect(text).toContain('Cancel stops it')
  })

  it('warns about the widths that are upscaled past the crop', () => {
    // 3840 px from a 4000 px crop is not; 640 and 720 are, only if the crop is
    // narrower. Tick 3840 against a 4000 px crop and the warning must not fire.
    tick(3840, true)
    expect(zipSummary()?.textContent).not.toMatch(/wider than your/)
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        geometry: { ...doc.geometry, crop: { x: 0, y: 0, width: 0.1, height: 0.1 } },
      }))
    })
    expect(zipSummary()?.textContent).toMatch(/wider than your 400 px crop/)
    expect(zipSummary()?.textContent).toMatch(/no extra detail/)
  })

  it('says the resize setting does not apply to the archive', () => {
    expect(zipSummary()?.textContent).not.toMatch(/resize above/)
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        output: { ...doc.output, resize: { mode: 'width', width: 800 } },
      }))
    })
    expect(zipSummary()?.textContent).toMatch(/resize above does not apply/)
  })

  it('counts the same files the archive really contained', async () => {
    const claimed = /^(\d+) file/.exec(zipSummary()?.textContent ?? '')?.[1]
    act(() => {
      button('Multi-size zip')?.click()
    })
    await waitFor(() => useUiStore.getState().jobs.length > 0)
    await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'done'))
    const toast = useUiStore
      .getState()
      .toasts.find((entry) => entry.message.startsWith('Multi-size zip exported'))
    const written = Number(/(\d+) sizes/.exec(toast?.message ?? '')?.[1])
    expect(claimed).toBe(String(written))
    expect(written).toBe(3)
  })
})

/* ==========================================================================
   Share: offered only where it works, and never one word for two events.

   `navigator.share` exists on desktop Chrome and Firefox, and
   `navigator.canShare({ files })` is `false` there. The old gate asked only for
   `share`, so those browsers were offered a button that could not work — after a
   full-resolution render, in front of a user who had been told it would.
   ========================================================================== */

describe('sharing is offered only where it can work', () => {
  it('asks canShare about a real file, not about the existence of share()', () => {
    let probed: File | undefined
    withCapabilities(
      {
        canShare: (data) => {
          probed = data?.files?.[0]
          return true
        },
        share: () => Promise.resolve(),
      },
      () => {
        expect(button('Share')).toBeDefined()
        expect(probed).toBeInstanceOf(File)
      },
    )
  })

  it('hides Share on a desktop browser whose canShare({files}) is false', () => {
    withCapabilities({ canShare: () => false, share: () => Promise.resolve() }, () => {
      expect(button('Share')).toBeUndefined()
    })
  })

  it('treats a user who dismissed the sheet as a cancellation, not a failure', async () => {
    await withCapabilities(
      {
        canShare: () => true,
        share: () => Promise.reject(new DOMException('Share canceled', 'AbortError')),
      },
      async () => {
        act(() => {
          button('Share')?.click()
        })
        await waitFor(() => useUiStore.getState().jobs.length > 0)
        await waitFor(() => useUiStore.getState().jobs.every((job) => job.status === 'cancelled'))
        expect(
          useUiStore.getState().toasts.some((entry) => entry.message === 'Share cancelled'),
        ).toBe(true)
        // No error, and nothing held on the panel: the user closed a window.
        expect(useUiStore.getState().jobs.some((job) => job.status === 'error')).toBe(false)
        expect(harness.container.querySelector('[role=alert]')).toBeNull()
      },
    )
  })

  it('tells a refused share apart, and always leaves a way to a file', async () => {
    await withCapabilities(
      {
        canShare: () => true,
        share: () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError')),
      },
      async () => {
        act(() => {
          button('Share')?.click()
        })
        await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'error'))
        const alert = harness.container.querySelector('[role=alert]')
        expect(alert?.textContent).toContain('The browser blocked the share.')
        // The dead end: this is the panel where a failure loses someone's work,
        // so the message names the control that cannot fail the same way.
        expect(alert?.textContent).toContain('Download writes the same picture')
        expect(button('Download')).toBeDefined()
      },
    )
  })

  it('says so when the browser will not carry the file at all', async () => {
    await withCapabilities(
      {
        canShare: () => true,
        share: () => Promise.reject(new TypeError('Failed to execute share')),
      },
      async () => {
        act(() => {
          button('Share')?.click()
        })
        await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'error'))
        expect(harness.container.querySelector('[role=alert]')?.textContent).toContain(
          'This browser will not share this file.',
        )
      },
    )
  })

  it('shares the file Download would write, under the name Download would write', async () => {
    let shared: File | undefined
    let title: string | undefined
    await withCapabilities(
      {
        canShare: () => true,
        share: async (data) => {
          shared = data.files?.[0]
          title = data.title
        },
      },
      async () => {
        // The name the panel already promises for Download, read off the panel.
        const promised = /Download as ([^·]+)/.exec(previewLine())?.[1]?.trim()
        expect(promised).toBe('holiday-4000x3000.jpg')
        act(() => {
          button('Share')?.click()
        })
        await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'done'))
        // A share that arrived as `holiday.png` when the download was
        // `holiday-4000x3000.jpg` was the file being renamed on the way out.
        expect(shared?.name).toBe(promised)
        expect(shared?.type).toBe('image/jpeg')
        expect(title).toBe('holiday')
        // And Share still writes no file of its own.
        expect(downloads).toEqual([])
      },
    )
  })
})

/* ==========================================================================
   Copy: "unsupported" and "refused" are different problems.

   They were one message. A refusal is a permission the user can grant and
   re-pressing Copy fixes; a type this browser cannot carry is one they cannot.
   Telling a user to "allow the clipboard" on an engine that will never carry a
   JPEG is a dead end wearing a helpful hat.
   ========================================================================== */

describe('the copy path names which of the two problems it hit', () => {
  const message = async (capabilities: Capabilities, name = 'Copy') => {
    let text = ''
    await withCapabilities(capabilities, async () => {
      // The jobs from the previous attempt are still in the store, and waiting
      // on them would return before this run had even started.
      useUiStore.setState({ jobs: [] })
      act(() => {
        button(name)?.click()
      })
      await waitFor(() => Boolean(harness.container.querySelector('[role=alert]')))
      expect(useUiStore.getState().jobs.some((job) => job.status === 'error')).toBe(true)
      text = harness.container.querySelector('[role=alert]')?.textContent ?? ''
    })
    return text
  }

  it('says "refused" when the browser denied access, and what to do about it', async () => {
    const text = await message({
      supports: () => true,
      write: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')),
    })
    expect(text).toContain('The browser refused clipboard access.')
    expect(text).toMatch(/Allow the clipboard/)
  })

  it('says "not supported" when the clipboard cannot carry the format', async () => {
    const text = await message({ supports: () => false, write: () => Promise.resolve() })
    expect(text).toContain('Copy is not supported here for image/jpeg.')
    // The sentence a refusal earns and a limitation must not: there is nothing
    // for the user to allow.
    expect(text).not.toMatch(/Allow the clipboard/)
  })

  it("reads Safari's TypeError as a limitation, which is what it is", async () => {
    const text = await message({
      supports: () => true,
      write: () => Promise.reject(new TypeError('Type image/jpeg not supported on write.')),
    })
    expect(text).toContain('Copy is not supported here for image/jpeg.')
  })

  it('never calls a refusal "not supported"', async () => {
    const refused = await message({
      supports: () => true,
      write: () => Promise.reject(new DOMException('nope', 'NotAllowedError')),
    })
    const unsupported = await message({ supports: () => false, write: () => Promise.resolve() })
    expect(refused).not.toBe(unsupported)
    expect(refused).toMatch(/refused/)
    expect(unsupported).toMatch(/not supported/)
  })

  it('leaves the picture reachable after a clipboard refusal', async () => {
    await message({
      supports: () => true,
      write: () => Promise.reject(new DOMException('nope', 'NotAllowedError')),
    })
    expect(button('Download')).toBeDefined()
    expect(harness.container.querySelector('[role=alert]')?.textContent).toContain(
      'Download writes the same picture',
    )
  })

  it('copies exactly what Download would write — the bytes, not just a success', async () => {
    const written: Record<string, Blob>[] = []
    await withCapabilities(
      {
        supports: () => true,
        write: async (items) => {
          written.push(...items.map((item) => item.items))
        },
      },
      async () => {
        act(() => {
          button('Copy')?.click()
        })
        await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'done'))
        expect(written).toHaveLength(1)
        expect(Object.keys(written[0] ?? {})).toEqual(['image/jpeg'])
        expect((written[0]?.['image/jpeg'] as Blob).size).toBeGreaterThan(0)
      },
    )
  })

  it('hides Copy when the clipboard object exists but has no write()', () => {
    // jsdom's default state has no clipboard at all; this is the neighbouring
    // case, where the constructor is present and the call is not.
    class UselessClipboardItem {
      static supports(): boolean {
        return true
      }
    }
    define(globalThis, 'ClipboardItem', UselessClipboardItem)
    define(navigator, 'clipboard', { read: () => Promise.resolve([]) })
    try {
      harness.unmount()
      mount()
      expect(button('Copy')).toBeUndefined()
    } finally {
      define(navigator, 'clipboard', undefined)
      define(globalThis, 'ClipboardItem', undefined)
    }
  })
})

/* ==========================================================================
   Every failure the panel can raise ends with the user holding the picture.
   ========================================================================== */

describe('a failure is never a dead end', () => {
  it('says what was not written and offers the control that is left', async () => {
    const original = URL.createObjectURL
    URL.createObjectURL = () => {
      throw new Error('object URLs are gone')
    }
    try {
      act(() => {
        button('Download')?.click()
      })
      await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'error'))
      const alert = harness.container.querySelector('[role=alert]')
      // The reason the engine gave, not a guess at a friendlier one.
      expect(alert?.textContent).toContain('object URLs are gone')
      expect(alert?.textContent).toContain('No file was written')
      expect(button('Download')).toBeDefined()
      expect(button('Multi-size zip')).toBeDefined()
    } finally {
      URL.createObjectURL = original
    }
  })

  it('clears the message when the user tries again, so a fix is not shadowed', async () => {
    await withCapabilities(
      {
        supports: () => true,
        write: () => Promise.reject(new DOMException('nope', 'NotAllowedError')),
      },
      async () => {
        act(() => {
          button('Copy')?.click()
        })
        await waitFor(() => Boolean(harness.container.querySelector('[role=alert]')))
        expect(harness.container.querySelector('[role=alert]')?.textContent).toContain('refused')
        act(() => {
          button('Download')?.click()
        })
        await waitFor(() => useUiStore.getState().jobs.some((job) => job.status === 'done'))
        expect(harness.container.querySelector('[role=alert]')).toBeNull()
      },
    )
  })
})
