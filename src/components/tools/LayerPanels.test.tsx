import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureFont, resetFontCache } from '../../features/layers/fonts'
import { StickerDecodeError } from '../../features/layers/stickers'
import { assetStore } from '../../model/assetsSingleton'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores, setNativeValue } from '../../store/testHarness'
import { useUiStore } from '../../store/uiStore'
import { StickersPanel, TextPanel } from './LayerPanels'

const decodeStickerFile = vi.hoisted(() => vi.fn())

vi.mock('../../features/layers/stickers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../features/layers/stickers')>()
  return { ...actual, decodeStickerFile }
})

const harness = createHarness()

/** `close()` is part of DisposableAsset: the store calls it when it prunes. */
const FAKE_BITMAP = { width: 64, height: 32, close: () => {} }

const upload = (file: File) => {
  const input = harness.container.querySelector('input[type="file"]') as HTMLInputElement
  // jsdom refuses a real `value` on a file input, and React drops a `change` it
  // thinks it has already seen — so the fake path has to differ per file for a
  // second upload to register at all.
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  Object.defineProperty(input, 'value', {
    value: `C:\\fakepath\\${file.name}`,
    writable: true,
    configurable: true,
  })
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const alert = () => harness.container.querySelector('[role="alert"]')

beforeEach(() => {
  resetStores()
  decodeStickerFile.mockReset()
  decodeStickerFile.mockResolvedValue(FAKE_BITMAP)
  harness.render(<StickersPanel />)
})

afterEach(() => harness.unmount())

describe('StickersPanel upload (D6-F10)', () => {
  it('accepts the formats the decoder accepts and caps the long edge in the label', () => {
    const input = harness.container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/gif,image/avif')
    expect(harness.container.textContent).toContain('2048px')
  })

  it('adds a sticker layer pointing at the uploaded pixels, not at a path', async () => {
    await act(async () => {
      upload(new File(['x'], 'my-cat.png', { type: 'image/png' }))
    })
    const layers = useDocStore.getState().present.layers
    const layer = layers[layers.length - 1]
    expect(layer?.kind).toBe('sticker')
    if (layer?.kind !== 'sticker') throw new Error('expected a sticker layer')
    expect(layer.svg).toBe('')
    expect(layer.assetId).not.toBeNull()
    // The pixels are in the vault, so a Doc never carries them.
    expect(assetStore.get(layer.assetId as string)).toBeTruthy()
    expect(layer.name).toBe('my-cat')
    expect(useUiStore.getState().selectedLayerId).toBe(layer.id)
    expect(alert()).toBeNull()
  })

  it('reports a decode failure inline instead of adding an empty layer', async () => {
    decodeStickerFile.mockRejectedValue(new StickerDecodeError('notes.txt', 'not an image'))
    await act(async () => {
      upload(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    })
    expect(alert()?.textContent).toContain('notes.txt')
    expect(useDocStore.getState().present.layers.filter((l) => l.kind === 'sticker')).toHaveLength(
      0,
    )
  })

  it('reports an unexpected failure too, with the file named', async () => {
    decodeStickerFile.mockRejectedValue(new Error('boom'))
    await act(async () => {
      upload(new File(['x'], 'cat.png', { type: 'image/png' }))
    })
    expect(alert()?.textContent).toBe('"cat.png" could not be used as a sticker.')
  })

  it('clears a previous error on the next upload', async () => {
    decodeStickerFile.mockImplementation((file: File) =>
      file.name === 'cat.png' ? Promise.reject(new Error('boom')) : Promise.resolve(FAKE_BITMAP),
    )
    await act(async () => {
      upload(new File(['x'], 'cat.png', { type: 'image/png' }))
    })
    expect(alert()).not.toBeNull()
    await act(async () => {
      upload(new File(['x'], 'dog.png', { type: 'image/png' }))
    })
    expect(alert()).toBeNull()
    expect(decodeStickerFile).toHaveBeenCalledTimes(2)
  })

  it('still adds a built-in sticker with no file at all', () => {
    act(() => {
      const star = Array.from(harness.container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Star',
      ) as HTMLButtonElement
      star.click()
    })
    const layers = useDocStore.getState().present.layers
    const layer = layers[layers.length - 1]
    expect(layer?.kind).toBe('sticker')
    if (layer?.kind !== 'sticker') throw new Error('expected a sticker layer')
    expect(layer.svg).toBe('star')
    expect(layer.assetId).toBeNull()
  })
})

describe('TextPanel font failures (D6-F16)', () => {
  const options = () =>
    Array.from(harness.container.querySelectorAll('option')).map((option) => option.textContent)

  beforeEach(() => {
    resetFontCache()
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        layers: [
          {
            id: 't1',
            kind: 'text',
            name: 'Caption',
            visible: true,
            transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
            text: 'Caption',
            style: {
              fontId: 'inter',
              size: 10,
              color: '#ffffff',
              bold: false,
              italic: false,
              align: 'left',
              lineHeight: 1.2,
              tracking: 0,
              arc: 0,
              strokeWidth: 0,
              strokeColor: '#000000',
              shadow: false,
              pillBackground: null,
            },
          },
        ],
      }))
      useUiStore.getState().selectLayer('t1')
    })
  })

  afterEach(() => resetFontCache())

  it('badges a font that failed to load instead of quietly using the system stack', async () => {
    // jsdom has no FontFace, so every ensureFont records a failure.
    await act(async () => {
      await ensureFont('inter')
    })
    harness.render(<TextPanel />)
    expect(options()).toContain('Inter (unavailable)')
    expect(options().filter((label) => label?.includes('unavailable'))).toHaveLength(1)
  })

  it('leaves the rest of the list unbadged', async () => {
    await act(async () => {
      await ensureFont('inter')
    })
    harness.render(<TextPanel />)
    expect(options()).toContain('Playfair')
  })
})

/**
 * A watermark used to be creatable and then completely unreachable: the Text
 * panel branched on `layer.kind !== 'text'`, so selecting one fell into the
 * "add a text layer" branch and offered nothing — not its text, its anchor, its
 * tiling, not even a delete. Everything the compositor honours was in the model
 * the whole time with no control anywhere that could reach it.
 */
describe('the watermark inspector (D8-F18)', () => {
  const WM = {
    id: 'w1',
    kind: 'watermark' as const,
    name: 'Watermark',
    visible: true,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' as const },
    text: '© Your Name',
    fontId: 'inter',
    color: '#ffffff',
    assetId: null,
    anchor: 'bottom-right' as const,
    tiled: false,
  }

  const wmLayer = () => {
    const layer = useDocStore.getState().present.layers[0]
    if (layer?.kind !== 'watermark') throw new Error('expected a watermark layer')
    return layer
  }

  /** An element named by `aria-label`, or by a `<label for>` pointing at it. */
  const byLabel = (label: string) => {
    const aria = harness.container.querySelector<HTMLElement>(`[aria-label="${label}"]`)
    if (aria) return aria
    const forLabel = Array.from(harness.container.querySelectorAll('label')).find(
      (node) => node.textContent?.trim() === label,
    )
    if (forLabel?.htmlFor) {
      return harness.container.querySelector<HTMLElement>(`#${forLabel.htmlFor}`)
    }
    if (forLabel) return forLabel.querySelector<HTMLElement>('select, input, textarea')
    return null
  }

  const sliderFor = (label: string) => {
    const field = Array.from(harness.container.querySelectorAll('label')).find((node) =>
      node.textContent?.trim().startsWith(label),
    )
    return field?.querySelector('input[type="range"]') as HTMLInputElement | null
  }

  const button = (name: string) =>
    Array.from(harness.container.querySelectorAll('button')).find(
      (node) => node.textContent?.trim() === name,
    ) as HTMLButtonElement | undefined

  beforeEach(() => {
    act(() => {
      useDocStore.getState().update((doc) => ({ ...doc, layers: [WM] }))
      useUiStore.getState().selectLayer('w1')
    })
    harness.render(<TextPanel />)
  })

  it('opens on a watermark and shows the mark itself', () => {
    const text = byLabel('Watermark text') as HTMLTextAreaElement
    expect(text).not.toBeNull()
    expect(text.value).toBe('© Your Name')
  })

  it('offers the anchor the compositor actually resolves', () => {
    const anchor = byLabel('Anchor') as HTMLSelectElement
    expect(anchor).not.toBeNull()
    expect(Array.from(anchor.options).map((option) => option.value)).toHaveLength(9)
    expect(anchor.value).toBe('bottom-right')
    act(() => {
      anchor.value = 'top-left'
      anchor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(wmLayer().anchor).toBe('top-left')
  })

  it('every control in the inspector carries an accessible name', () => {
    // A `<select>` labelled only by a paragraph above it is a combobox a screen
    // reader announces as "combo box", and axe calls that a critical violation.
    // This one arrived with the inspector and was the first critical the scan
    // found, so the labels are asserted rather than assumed.
    const unlabelled = Array.from(harness.container.querySelectorAll('select')).filter((select) => {
      if (select.getAttribute('aria-label')) return false
      const id = select.getAttribute('id')
      if (id && harness.container.querySelector(`label[for="${id}"]`)) return false
      return !select.closest('label')
    })
    expect(unlabelled).toEqual([])
    for (const name of ['Watermark text', 'Anchor', 'Font']) {
      expect(byLabel(name), name).not.toBeNull()
    }
  })

  it('tiling is a toggle that says whether it is on', () => {
    const tile = button('Tile across the image') as HTMLButtonElement
    expect(tile.getAttribute('aria-pressed')).toBe('false')
    act(() => tile.click())
    expect(wmLayer().tiled).toBe(true)
  })

  it('edits the text', () => {
    const text = byLabel('Watermark text') as HTMLTextAreaElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(text, '© Studio')
      text.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(wmLayer().text).toBe('© Studio')
  })

  it('can delete the watermark it just opened', () => {
    act(() => button('Delete layer')?.click())
    expect(useDocStore.getState().present.layers).toHaveLength(0)
  })

  it('labels a position that is really an offset, and puts 0 % on the anchor', () => {
    // `drawWatermarkLayer` computes `anchor + (x - 0.5)`, so a 0-100% position
    // slider reading 20 % put the mark at 65 % — a slider that disagreed with
    // the picture by 45 percentage points, under a label reading "X".
    const x = sliderFor('Offset X') as HTMLInputElement
    const y = sliderFor('Offset Y') as HTMLInputElement
    expect(x).not.toBeNull()
    expect(y).not.toBeNull()
    expect(sliderFor('X')).toBeFalsy()
    expect(sliderFor('Y')).toBeFalsy()
    expect(Number(x.value)).toBe(0)
    act(() => {
      setNativeValue(x, '20')
      x.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // 0.5 + 0.2 = 0.7: twenty per cent of the canvas to the right of the mark's
    // resting place, not a mark sitting at twenty per cent.
    expect(wmLayer().transform.x).toBeCloseTo(0.7, 6)
  })

  it('names the slider for the kind, not for the field', () => {
    // The same two numbers mean different things per kind, so one shared label
    // cannot be right for both. `transform.x` is an absolute position for a text
    // layer and an offset from an anchor for a watermark; the watermark branch
    // says so, and the text branch keeps the plain X/Y its drag handle matches.
    expect(sliderFor('Offset X')).toBeTruthy()
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        layers: [
          {
            id: 't1',
            kind: 'text',
            name: 'Caption',
            visible: true,
            transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
            text: 'Caption',
            style: {
              fontId: 'inter',
              size: 8,
              color: '#ffffff',
              bold: false,
              italic: false,
              align: 'center',
              lineHeight: 1.2,
              tracking: 0,
              arc: 0,
              strokeWidth: 0,
              strokeColor: '#000000',
              shadow: false,
              pillBackground: null,
            },
          },
        ],
      }))
      useUiStore.getState().selectLayer('t1')
    })
    harness.render(<TextPanel />)
    expect(sliderFor('X')).toBeTruthy()
    expect(sliderFor('Y')).toBeTruthy()
    expect(sliderFor('Offset X')).toBeFalsy()
  })

  it('exposes the transform the compositor honours', () => {
    for (const label of ['Scale', 'Rotation', 'Opacity']) {
      expect(sliderFor(label), label).not.toBeNull()
    }
    expect(harness.container.querySelector('[aria-label="Blend mode"]')).not.toBeNull()
  })

  it('reaches a watermark with no text layer present at all', () => {
    // "Add watermark" used to sit at the bottom of a *text* layer's inspector,
    // so a document with no text layer could not add one, and an existing
    // watermark could not be reselected once anything else was selected.
    act(() => {
      useDocStore.getState().update((doc) => ({ ...doc, layers: [] }))
      useUiStore.getState().selectLayer(null)
    })
    harness.render(<TextPanel />)
    expect(button('Add watermark')).toBeDefined()
    expect(button('Add text')).toBeDefined()
  })

  it('lists existing watermarks so one can be reselected', () => {
    act(() => {
      // The mark is still in the document; it is only the selection that moved,
      // which is exactly the state a user lands in after touching the canvas.
      useUiStore.getState().selectLayer(null)
    })
    harness.render(<TextPanel />)
    expect(harness.container.textContent).toContain('© Your Name')
  })
})
