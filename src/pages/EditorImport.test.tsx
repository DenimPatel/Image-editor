import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markOnboardingSeen } from '../components/editor/onboardingKeys'
import { loadCaps } from '../gl/caps'
import { ACCEPT_ATTR } from '../lib/accept'
import { megapixels } from '../lib/decode'
import { installFakeIndexedDb } from '../lib/persist/fakeIndexedDb'
import { MIRROR_KEY, readMirror, writeMirror } from '../lib/persist/mirror'
import { clearSession } from '../lib/persist/session'
import { assetStore } from '../model/assetsSingleton'
import { createDoc } from '../model/defaults'
import { useDocStore } from '../store/docStore'
import {
  createHarness,
  resetStores,
  stubCanvas,
  stubMatchMedia,
  stubResizeObserver,
} from '../store/testHarness'
import Editor from './Editor'

/**
 * The three ways in.
 *
 * `ImportScreen` offers a drop zone, a file picker and the system clipboard, and
 * the page's own `handleFile` is the only thing all three converge on. Until now
 * only the sample tiles had been driven, from `Editor.test.tsx`, and only as far
 * as the failure message — so `handleFile` itself had never run in this area, and
 * with it the whole set of claims that are easy to get wrong and invisible when
 * they are:
 *
 * - the file's extension is dropped for the name in the top bar, because
 *   `IMG_4821.HEIC` and `IMG_4821` are not two things the user chose between;
 * - a second import while a decode is in flight is *refused*, not queued and not
 *   raced, so the document can never end up holding one image's edits over
 *   another's pixels;
 * - importing something is not "starting over": it must not call
 *   `clearSession`, which is the one call that deletes a photograph;
 * - and it clears the localStorage mirror, because a reload inside the next
 *   save's debounce would otherwise offer the image the user just replaced.
 *
 * jsdom implements no `DataTransfer` and no `ClipboardEvent`, so the drop and the
 * paste are dispatched as plain events carrying hand-built `dataTransfer` /
 * `clipboardData` properties. That is not a shortcut around the app's code: the
 * handlers read exactly those two properties off the native event, so what is
 * under test is the real path with the one object jsdom lacks supplied by hand.
 */

/**
 * `clearSession` is the only call in the app that deletes a photograph, so it is
 * worth being able to see who makes it. The real implementation runs underneath —
 * the resume tests need a session they can actually delete.
 */
vi.mock('../lib/persist/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/persist/session')>()
  return { ...actual, clearSession: vi.fn(actual.clearSession) }
})

class FakeImageBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  /** The asset store closes what it holds; a bitmap that cannot be closed leaks. */
  close(): void {}
}

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(32))
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

// One factory for the whole file: the session module opens the database once, so
// a fresh fake per test would leave it pointing at the first one.
installFakeIndexedDb()

const fetchMock = vi.fn(async () =>
  Promise.resolve(
    new Response(pngBytes(400, 300).buffer as ArrayBuffer, {
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

const harness = createHarness()

function image(name = 'beach.jpg', type = 'image/jpeg', width = 400, height = 300): File {
  return new File([pngBytes(width, height)], name, { type })
}

/**
 * Mount the page the way the router does: a real route table, so the import
 * screen and the workspace are the same components the app serves and the only
 * thing this file replaces is where the URL says we are.
 */
function EditorAt({ path }: { path: string }) {
  return (
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true }}>
      <Routes>
        <Route path="/editor" element={<Editor />} />
        <Route path="/editor/:tool" element={<Editor />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderEditor(): void {
  harness.render(<EditorAt path="/editor" />)
}

function sampleButtons(): HTMLButtonElement[] {
  return Array.from(harness.container.querySelectorAll('button')).filter((button) =>
    (button.textContent ?? '').startsWith('Sample'),
  )
}

function dropZone(): HTMLElement {
  const zone = harness.container.querySelector('[data-testid="import-screen"] [role="button"]')
  if (!zone) throw new Error('no drop zone on the import screen')
  return zone as HTMLElement
}

function fileInput(): HTMLInputElement {
  const input = dropZone().querySelector('input[type="file"]')
  if (!input) throw new Error('no file input inside the drop zone')
  return input as HTMLInputElement
}

function busy(): Element | null {
  return harness.container.querySelector('[role="status"]')
}

/**
 * The pending indicator, and nothing else.
 *
 * `busy()` answers "is any live region on screen", which on this page also matches a
 * toast — `Editor` renders `<ToastStack />` unconditionally, so the import screen
 * carries one. That made "report a sample that could not be fetched" fail once per
 * few runs on a toast some earlier test's frame had pushed, with nothing to do with
 * the sample; `resetStores` now clears the toast list, but the two questions are
 * different questions and this is the one the tests mean.
 */
function pending(): Element | null {
  return harness.container.querySelector('[data-testid="import-screen"] [role="status"]')
}

function errorText(): string | null {
  return harness.container.querySelector('[role="alert"]')?.textContent ?? null
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Poll until `condition` holds, or the deadline passes.
 *
 * A decode runs across several microtask *and* macrotask hops, so this is a
 * wall-clock deadline rather than a count of turns. A count is generous on an
 * idle machine and far too short on a loaded one, which is how a test like "a
 * sample that 404s says so" turns into a flake that only ever fails in CI.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (condition()) return
    if (Date.now() > deadline) return
    await flush()
  }
}

/**
 * A `drop` event carrying a file list.
 *
 * `DragEvent` and `DataTransfer` are both absent from jsdom, so the property is
 * defined on a plain cancelable event — which is all `ImportScreen` reads
 * (`event.dataTransfer.files`) and all React copies onto the synthetic event.
 */
function dropFiles(files: File[]): void {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } })
  act(() => {
    dropZone().dispatchEvent(event)
  })
}

/** A `paste` event carrying clipboard items, in the shape the handler walks. */
function pasteItems(items: unknown[] | undefined): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: items ? { items } : undefined })
  act(() => {
    window.dispatchEvent(event)
  })
}

function clipboardFile(file: File): unknown {
  return { kind: 'file', type: file.type, getAsFile: () => file }
}

beforeEach(async () => {
  stubCanvas()
  stubResizeObserver()
  stubMatchMedia()
  await clearSession()
  resetStores()
  markOnboardingSeen()
  fetchMock.mockClear()
  fetchMock.mockImplementation(async () =>
    Promise.resolve(
      new Response(pngBytes(400, 300).buffer as ArrayBuffer, {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  )
  vi.mocked(clearSession).mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('ImageBitmap', FakeImageBitmap)
})

afterEach(async () => {
  harness.unmount()
  assetStore.clear()
  vi.unstubAllGlobals()
  localStorage.clear()
  await flush()
})

describe('the drop zone', () => {
  it('opens the dropped image, and names it without its extension', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    dropFiles([image('IMG_4821.jpeg')])

    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(useDocStore.getState().present.source?.name).toBe('IMG_4821')
    // The name in the top bar is the user's own file name, trimmed to the stem:
    // the bar is 360px wide and truncates from the left, so the extension is the
    // part that has to go or `Sa…` is what is left.
    expect(harness.container.querySelector('header bdi')?.textContent).toBe('IMG_4821')
    expect(errorText()).toBeNull()
  })

  it('refuses a second drop while the first decode is still running', async () => {
    let release: (() => void) | null = null
    let started = () => {}
    const decoding = new Promise<void>((resolve) => {
      started = resolve
    })
    const decode = vi.fn(() => {
      started()
      return new Promise<never>((_resolve, reject) => {
        release = () => reject(new Error('decode failed on purpose'))
      })
    })
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()

    await act(async () => {
      dropFiles([image('first.jpg')])
      await decoding
    })
    // Pending, announced, and the tiles that would start a competing import are
    // disabled — but the drop zone itself is still live, because a file can be
    // dropped anywhere, so `busyRef` is the thing that has to refuse it.
    expect(busy()?.textContent).toBe('Opening image…')
    expect(harness.container.querySelector('[aria-busy="true"]')).not.toBeNull()
    for (const tile of sampleButtons()) expect(tile.disabled).toBe(true)

    dropFiles([image('second.jpg')])
    expect(decode).toHaveBeenCalledOnce()

    await act(async () => {
      release?.()
      await Promise.resolve()
    })
    expect(busy()).toBeNull()
    expect(errorText()).toBe('Could not read that file as an image.')
    expect(useDocStore.getState().present.source).toBeNull()
  })

  it('says why a format the browser cannot open was refused, without decoding it', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()

    // The drop zone's own accept list has to admit this, or the message would be
    // unreachable in the browser: the picker filters by `accept`, the drop path
    // does not, and a HEIC arrives either way.
    expect(ACCEPT_ATTR).not.toMatch(/heic/i)

    dropFiles([new File([pngBytes(4, 4)], 'holiday.HEIC', { type: 'image/heic' })])
    await waitFor(() => errorText() !== null)
    expect(errorText()).toContain('HEIC/HEIF isn’t supported')
    expect(decode).not.toHaveBeenCalled()
    expect(busy()).toBeNull()
  })

  it('reports a file the accept list does not name, and one past the size ceiling', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()

    dropFiles([new File([pngBytes(4, 4)], 'notes.pdf', { type: 'application/pdf' })])
    await waitFor(() => errorText() !== null)
    expect(errorText()).toContain('application/pdf')
    expect(decode).not.toHaveBeenCalled()

    // Over the encoded-byte ceiling but a real image, so this is the other guard
    // and it must name the file rather than the type.
    const huge = { size: 300 * 1024 * 1024, type: 'image/png', name: 'huge.png' } as File
    dropFiles([huge])
    await waitFor(() => (errorText() ?? '').includes('up to'))
    expect(errorText()).toMatch(/this editor works with files up to/)
    expect(decode).not.toHaveBeenCalled()
  })

  it('reports a decode that fails for a reason of its own', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('the bytes were not an image')
      }),
    )
    renderEditor()
    dropFiles([image()])
    await waitFor(() => errorText() !== null)
    expect(errorText()).toBe('Could not read that file as an image.')
  })

  it('reports an image past this device’s pixel ceiling with both numbers', async () => {
    // The file is a valid 24-megapixel PNG, which is over the ceiling whichever
    // ceiling the probe settled on, so this is `ImageTooLargeError` reaching the
    // page's own branch rather than the generic one.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(6000, 4000)),
    )
    renderEditor()
    dropFiles([image('huge.png', 'image/png', 6000, 4000)])
    await waitFor(() => errorText() !== null)
    // The limit is read back out of the app rather than written into the test.
    // It is a *probe*: `probeCanvasArea` asks a canvas whether a filled pixel
    // came back opaque, and what a stubbed canvas answers decides the number —
    // 16.8 megapixels with no canvas, 4.2 with a stub that reports a transparent
    // pixel. Hard-coding either would be a test that measures its own fixture.
    const limit = megapixels(loadCaps().maxCanvasArea)
    expect(errorText()).toContain('That image is about 24 megapixels')
    expect(errorText()).toContain(`handles up to ${limit} megapixels`)
    expect(errorText()).toContain('Resize or crop it first.')
  })

  it('an empty drop changes nothing', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()
    dropFiles([])
    await flush()
    expect(decode).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
  })

  it('does not delete the stored session, and drops the localStorage mirror', async () => {
    // The two halves of "a new image is a new document". `clearSession` throws
    // the stored photograph away, so importing must not reach it; the mirror is
    // the other copy of the same document, so importing *must* clear it or a
    // reload inside the next save's debounce offers the image just replaced.
    writeMirror(
      createDoc({
        source: { assetId: 'asset_old', width: 4, height: 4, name: 'old', mime: 'image/png' },
      }),
    )
    expect(localStorage.getItem(MIRROR_KEY)).not.toBeNull()

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    dropFiles([image('new.jpg')])

    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(vi.mocked(clearSession)).not.toHaveBeenCalled()
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
    expect(readMirror()).toBeNull()
  })
})

describe('the file picker', () => {
  it('opens the chosen image, through the same path as a drop', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    const input = fileInput()
    expect(input.accept).toBe(ACCEPT_ATTR)
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [image('picked.png', 'image/png')],
    })

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(useDocStore.getState().present.source?.name).toBe('picked')
  })

  it('a cancelled picker changes nothing', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()
    const input = fileInput()
    Object.defineProperty(input, 'files', { configurable: true, value: [] })

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(decode).not.toHaveBeenCalled()
  })
})

describe('the clipboard', () => {
  it('opens a pasted image, which no page test had ever emulated', async () => {
    // The listener is on `window`, not on the drop zone, so it answers a paste
    // anywhere on the page — including after the workspace has replaced the
    // import screen, which is why the test dispatches on `window`.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    pasteItems([clipboardFile(image('pasted.webp', 'image/webp'))])

    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(useDocStore.getState().present.source?.name).toBe('pasted')
    expect(useDocStore.getState().present.source?.mime).toBe('image/webp')
  })

  it('takes the first file on the clipboard and ignores the rest', async () => {
    const decode = vi.fn(async () => new FakeImageBitmap(400, 300))
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()
    pasteItems([
      clipboardFile(image('one.png', 'image/png')),
      clipboardFile(image('two.png', 'image/png')),
    ])

    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(decode).toHaveBeenCalledOnce()
    expect(useDocStore.getState().present.source?.name).toBe('one')
  })

  it('ignores a clipboard that carries only text', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()
    // A real text paste: one item of kind `string`, whose `getAsFile` is null.
    pasteItems([{ kind: 'string', type: 'text/plain', getAsFile: () => null }])
    await flush()
    expect(decode).not.toHaveBeenCalled()
    expect(errorText()).toBeNull()
    expect(harness.container.textContent).toContain('Edit an image')
  })

  it('ignores a paste event with no clipboard data at all', async () => {
    // Some engines deliver a synthetic paste with `clipboardData` absent — a
    // context-menu paste, a browser-internal one. The handler has to shrug.
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    renderEditor()
    pasteItems(undefined)
    await flush()
    expect(decode).not.toHaveBeenCalled()
  })

  it('stops listening once the import screen is gone', async () => {
    // Otherwise a paste anywhere in a live workspace would silently replace the
    // document the user is editing — and nothing on screen would say so.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    dropFiles([image()])
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))

    pasteItems([clipboardFile(image('sneaky.png', 'image/png'))])
    await flush()
    expect(useDocStore.getState().present.source?.name).toBe('beach')
  })
})

describe('the sample tiles', () => {
  it('open the sample, name it after the tile, and record the type it came back as', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    await act(async () => {
      sampleButtons()[1].click()
    })
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    const source = useDocStore.getState().present.source
    expect(source?.name).toBe('Sample 2')
    // The document records the content type the *response* carried, not the file
    // name — a `.jpg` served as `image/avif` is an AVIF.
    expect(source?.mime).toBe('image/png')
    expect(vi.mocked(clearSession)).not.toHaveBeenCalled()
  })

  it('report a sample that could not be fetched', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    fetchMock.mockImplementationOnce(async () => Promise.resolve(new Response('', { status: 404 })))
    renderEditor()
    await act(async () => {
      sampleButtons()[0].click()
    })
    await waitFor(() => errorText() !== null)
    expect(errorText()).toBe('Could not load that sample image.')
    // The pending sentence is gone, by name and not merely "no status node": the
    // first render that shows the error must already have dropped the busy state,
    // because a stuck spinner on a failed import is a spinner with nothing behind it.
    expect(pending()).toBeNull()
    expect(busy()).toBeNull()
  })

  it('offers the paste route in the sentence above the drop zone', () => {
    // The clipboard is a route in and nothing else advertises it.
    renderEditor()
    expect(dropZone().textContent).toContain('paste from the clipboard')
  })
})
