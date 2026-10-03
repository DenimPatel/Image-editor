import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assetStore } from '../../model/assetsSingleton'
import { ImageTooLargeError } from '../../lib/decode'
import { initFlags, resetFlags, setFlagState } from '../../lib/flags'
import { useDocStore } from '../../store/docStore'
import { createHarness, resetStores, setNativeValue } from '../../store/testHarness'
import { BackgroundPanel } from './BackgroundPanel'

const decodeImageBlob = vi.hoisted(() => vi.fn())

vi.mock('../../lib/decode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/decode')>()
  return { ...actual, decodeImageBlob }
})

const harness = createHarness()

/** `close()` is part of DisposableAsset: the store calls it when it prunes. */
const FAKE_BITMAP = { width: 640, height: 480, close: () => {} }

const modeButton = (label: string) =>
  Array.from(harness.container.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement | undefined

const status = () => harness.container.querySelector('[role="status"]') as HTMLElement | null

const rangeFor = (label: string) => {
  const field = Array.from(harness.container.querySelectorAll('label')).find((node) =>
    node.textContent?.trim().startsWith(label),
  )
  return field?.querySelector('input[type="range"]') as HTMLInputElement | undefined
}

const choose = (file: File) => {
  const inputs = Array.from(harness.container.querySelectorAll('input[type="file"]'))
  const input = inputs[inputs.length - 1] as HTMLInputElement
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

beforeEach(() => {
  resetStores()
  // jsdom's location.search is empty, so this reads the url tier as "nothing
  // said" and leaves every flag on its shipped default.
  localStorage.clear()
  resetFlags()
  decodeImageBlob.mockReset()
  decodeImageBlob.mockResolvedValue(FAKE_BITMAP)
  harness.render(<BackgroundPanel source={null} />)
})

afterEach(() => {
  harness.unmount()
  localStorage.clear()
  resetFlags()
})

describe('BackgroundPanel', () => {
  it('keep transparent png is one undo step', () => {
    const button = Array.from(harness.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Keep transparen'),
    )
    expect(button).toBeDefined()
    act(() => {
      ;(button as HTMLButtonElement).click()
    })
    expect(useDocStore.getState().past).toHaveLength(1)
    expect(useDocStore.getState().present.output.format).toBe('png')
    // `removed` is `false`, and it was `true` until this was measured: the button
    // claimed a subject matte that only `Remove background` can produce, which
    // silenced the panel's own "nothing has been removed yet" warning while the
    // canvas stayed byte-for-byte identical.
    expect(useDocStore.getState().present.background).toMatchObject({
      mode: 'none',
      removed: false,
    })
    expect(useDocStore.getState().present.output.matte).toBe('transparent')
    expect(useDocStore.getState().interaction.key).toBeNull()
    useDocStore.getState().undo()
    expect(useDocStore.getState().present.background.removed).toBe(false)
    // The format is part of the same step, so one undo reverts both fields.
    expect(useDocStore.getState().present.output.format).toBe('jpeg')
  })
})

describe('BackgroundPanel · the matting flag', () => {
  const buttonNamed = (label: string) =>
    Array.from(harness.container.querySelectorAll('button')).find((b) => b.textContent === label)

  it('offers the model exactly as it does today when nothing has touched it', () => {
    // `default` has to be today's behaviour, not "off until proven otherwise".
    expect(status()).toBeNull()
    expect(buttonNamed('Remove background')).toBeDefined()
    expect(harness.container.textContent).toContain('Best quality')
  })

  it('says the feature is off, and names the address bar, for a url flag', () => {
    initFlags({ search: '?off=matting' })
    harness.render(<BackgroundPanel source={null} />)

    const notice = status()
    // The whole point of the panel: the button is gone, and something says why.
    expect(notice?.textContent).toBe(
      'Background removal is turned off for this page by ?off=matting in the address bar. ' +
        'Remove it from the address bar to turn it back on.',
    )
    expect(buttonNamed('Remove background')).toBeUndefined()
  })

  it('offers no restore button for a url flag, because it could not work', () => {
    initFlags({ search: '?off=matting' })
    harness.render(<BackgroundPanel source={null} />)
    // A clear button here would clear storage, which the url still overrules —
    // a control that appeared to do something and did not.
    expect(buttonNamed('Turn background removal back on')).toBeUndefined()
  })

  it('offers a working restore button for a saved flag', () => {
    setFlagState('matting', 'off')
    harness.render(<BackgroundPanel source={null} />)

    expect(status()?.textContent).toBe(
      'Background removal is turned off in this browser. ' +
        'Turn it back on in Help → Debug switches.',
    )
    const restore = buttonNamed('Turn background removal back on')
    expect(restore).toBeDefined()

    act(() => {
      restore?.click()
    })

    // The affordance actually restores the feature, in the same commit.
    expect(buttonNamed('Remove background')).toBeDefined()
    expect(status()).toBeNull()
  })

  it('keeps the parts of the panel that never needed the model', () => {
    setFlagState('matting', 'off')
    harness.render(<BackgroundPanel source={null} />)
    // A matte is not the only way to reach a transparent background: the source
    // photo may already have one, so the manual route stays.
    expect(buttonNamed('Keep transparency (PNG)')).toBeDefined()
    expect(modeButton('Colour')).toBeDefined()
  })

  it('reacts to a flag change without a reload', () => {
    harness.render(<BackgroundPanel source={null} />)
    expect(buttonNamed('Remove background')).toBeDefined()
    act(() => {
      setFlagState('matting', 'off')
    })
    expect(buttonNamed('Remove background')).toBeUndefined()
    expect(status()?.textContent).toContain('turned off in this browser')
  })
})

describe('BackgroundPanel · image replacement (D3-F12/F13)', () => {
  it('offers an image mode next to the other three', () => {
    expect(modeButton('Image')).toBeDefined()
    expect(modeButton('Colour')).toBeDefined()
    expect(modeButton('Gradient')).toBeDefined()
    expect(modeButton('Transparent')).toBeDefined()
  })

  it('says out loud that a replacement does nothing until the background is removed', () => {
    // `backgroundComposites` is false until `removed` is set, so the control is
    // honest about being inert rather than looking broken — and it names the
    // button that fixes it, because "matte" is the compositing term `src/lib/copy.ts`
    // bans and this string is one the user reads.
    expect(status()).toBeNull()
    act(() => {
      modeButton('Colour')?.click()
    })
    expect(status()?.textContent).toContain('Nothing has been removed from the background yet')
    expect(status()?.textContent).toContain('Remove background')
    expect(status()?.textContent).not.toMatch(/matte/i)
  })

  it('stops claiming the replacement is blocked once a matte exists', () => {
    act(() => {
      useDocStore.getState().update((doc) => ({
        ...doc,
        background: { ...doc.background, removed: true },
      }))
    })
    expect(status()).toBeNull()
  })

  it('shows fit and blur only in image mode', () => {
    act(() => {
      modeButton('Image')?.click()
    })
    expect(harness.container.textContent).toContain('Fill frame')
    expect(harness.container.textContent).toContain('Fit inside')
    expect(harness.container.textContent).toContain('Blur')
  })

  it('stores a chosen image in the vault and points the doc at it', async () => {
    act(() => {
      modeButton('Image')?.click()
    })
    await act(async () => {
      choose(new File(['x'], 'studio.jpg', { type: 'image/jpeg' }))
    })
    const background = useDocStore.getState().present.background
    expect(background.mode).toBe('image')
    expect(background.imageAssetId).not.toBeNull()
    expect(assetStore.get(background.imageAssetId as string)).toBeTruthy()
    expect(harness.container.querySelector('[role="alert"]')).toBeNull()
  })

  it('reports an unreadable image instead of clearing the current one', async () => {
    decodeImageBlob.mockRejectedValue(new Error('not an image'))
    act(() => {
      modeButton('Image')?.click()
    })
    await act(async () => {
      choose(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    })
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toBe(
      'That file could not be read as an image.',
    )
    expect(useDocStore.getState().present.background.imageAssetId).toBeNull()
  })

  it('passes the decoder its own message when the image is too large', async () => {
    decodeImageBlob.mockRejectedValue(new ImageTooLargeError(9_000_000, 8_000_000))
    act(() => {
      modeButton('Image')?.click()
    })
    await act(async () => {
      choose(new File(['x'], 'huge.jpg', { type: 'image/jpeg' }))
    })
    expect(harness.container.querySelector('[role="alert"]')?.textContent).toContain('megapixels')
  })

  it('writes fit and blur through to the document', () => {
    act(() => {
      modeButton('Image')?.click()
    })
    act(() => {
      modeButton('Fit inside')?.click()
    })
    expect(useDocStore.getState().present.background.fit).toBe('contain')
    const blur = rangeFor('Blur')
    expect(blur).toBeDefined()
    act(() => {
      // jsdom does not implement the native arrow-key step of a range input, so
      // the change is dispatched the way a drag would arrive.
      setNativeValue(blur as HTMLInputElement, '40')
      blur?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useDocStore.getState().present.background.blur).toBeGreaterThan(0)
  })
})
