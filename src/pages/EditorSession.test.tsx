import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markOnboardingSeen } from '../components/editor/onboardingKeys'
import { RouteError } from '../components/ui/RouteError'
import { installFakeIndexedDb } from '../lib/persist/fakeIndexedDb'
import { MIRROR_KEY, writeMirror } from '../lib/persist/mirror'
import { clearSession, saveSession, type StoredSession } from '../lib/persist/session'
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
import { useUiStore } from '../store/uiStore'
import Editor from './Editor'

/**
 * The session half of the page: what it offers, what it takes, and what it is not
 * allowed to throw away.
 *
 * `clearSession` is the only call in this application that deletes a
 * photograph — the row *and* every asset row behind it. It is reached from exactly
 * two places: the resume card's "Discard", and the error screen's "start over".
 * Both show the user what is going before it happens. Nothing else may reach it,
 * and in particular not "I opened a different photo", which is what a reader
 * assumes an import does. So the mock below watches the call rather than
 * replacing it: the real implementation still runs, and the tests that need a
 * session they can actually delete keep one.
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
  close(): void {}
}

const fake = installFakeIndexedDb()

const harness = createHarness()

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

function storedBytes(): Blob {
  return new Blob([pngBytes(400, 300)], { type: 'image/png' })
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Poll until `condition` holds, or the deadline passes.
 *
 * A wall-clock deadline rather than a count of turns: a count is generous on an
 * idle machine and far too short on a loaded one.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (condition()) return
    if (Date.now() > deadline) return
    await flush()
  }
}

function routerAt(path: string) {
  return createMemoryRouter(
    [
      { path: '/', element: <p>hub</p> },
      { path: '/editor', element: <Editor />, errorElement: <RouteError /> },
      { path: '/editor/:tool', element: <Editor />, errorElement: <RouteError /> },
    ],
    { initialEntries: [path] },
  )
}

async function renderAt(path: string) {
  harness.unmount()
  const router = routerAt(path)
  act(() => {
    harness.render(<RouterProvider router={router} />)
  })
  await act(async () => {
    await router.state.initialized
  })
  await flush()
  return router
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(harness.container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  )
  if (!found) throw new Error(`no "${label}" button in ${harness.container.textContent}`)
  return found as HTMLButtonElement
}

function resumeCard(): HTMLElement | null {
  const found = Array.from(harness.container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Resume',
  )
  return (found?.parentElement?.parentElement ?? null) as HTMLElement | null
}

function errorText(): string | null {
  return harness.container.querySelector('[role="alert"]')?.textContent ?? null
}

/** Put a document with real pixels behind it into the live store. */
function loadLiveDocument(doc = createDoc({ source: SOURCE })): void {
  const assetId = doc.source?.assetId ?? ''
  if (assetId && !assetStore.has(assetId)) assetStore.add(new FakeImageBitmap(400, 300), assetId)
  useDocStore.getState().load(doc)
}

/** Store a resumable session: a real row *and* the bytes its document names. */
async function storeSession(doc = createDoc({ source: SOURCE })): Promise<void> {
  const assetId = doc.source?.assetId ?? ''
  const result = await saveSession(doc, { assetId, blob: storedBytes(), mime: 'image/png' }, null)
  if (result !== 'ok') throw new Error(`could not store a session: ${result}`)
}

/** Follow `/editor/<slug>` to the point where the sheet for that tool is open. */
async function openToolAt(path: string): Promise<Element | null> {
  loadLiveDocument()
  await renderAt(path)
  return harness.container.querySelector('[role="dialog"]')
}

const SOURCE = {
  assetId: 'asset_resume',
  width: 400,
  height: 300,
  name: 'Saved photo',
  mime: 'image/png',
}

beforeEach(async () => {
  stubCanvas()
  stubResizeObserver()
  stubMatchMedia()
  await clearSession()
  resetStores()
  markOnboardingSeen()
  vi.mocked(clearSession).mockClear()
  vi.stubGlobal('ImageBitmap', FakeImageBitmap)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => new FakeImageBitmap(400, 300)),
  )
})

afterEach(async () => {
  harness.unmount()
  assetStore.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  await flush()
})

describe('the session the editor offers', () => {
  it('is offered with the facts a person needs before deciding', async () => {
    await storeSession()
    await renderAt('/editor')
    await waitFor(() => resumeCard() !== null)
    const card = resumeCard()
    expect(card?.textContent).toContain('Continue editing?')
    // The card used to show a machine-formatted timestamp and nothing else, so
    // accepting was a guess and discarding was permanent.
    expect(card?.textContent).toMatch(/\d/)
    expect(card?.textContent).not.toContain('undefined')
  })

  it('restores the document, the pixels and the file name', async () => {
    await storeSession()
    await renderAt('/editor')
    await waitFor(() => resumeCard() !== null)

    await act(async () => {
      button('Resume').click()
    })
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))

    const source = useDocStore.getState().present.source
    expect(source?.name).toBe('Saved photo')
    expect(source?.assetId).toBe('asset_resume')
    // The decoded bitmap is registered under the *stored* asset id, so every
    // later read of the document finds pixels rather than a name.
    expect(assetStore.has('asset_resume')).toBe(true)
    expect(harness.container.querySelector('header bdi')?.textContent).toBe('Saved photo')
    // Taking the session back is not a reason to delete it.
    expect(vi.mocked(clearSession)).not.toHaveBeenCalled()
    expect(resumeCard()).toBeNull()
  })

  it('says so, and keeps the document untouched, when the image is gone', async () => {
    // A row whose asset row has gone. This is not a rare corruption: it is what a
    // browser that evicted the origin's storage leaves behind, and the page must
    // say the image is missing rather than show an empty editor.
    const row = createDoc({ source: SOURCE }) as unknown as StoredSession
    fake.write('sessions', 'current', {
      id: 'current',
      doc: row,
      updatedAt: Date.now(),
      thumb: null,
    })
    await renderAt('/editor')
    await waitFor(() => resumeCard() !== null)

    await act(async () => {
      button('Resume').click()
    })
    await waitFor(() => (errorText() ?? '').length > 0)
    expect(errorText()).toContain('image is no longer stored')
    // The offer is withdrawn rather than left on screen to be pressed again.
    expect(resumeCard()).toBeNull()
    expect(useDocStore.getState().present.source).toBeNull()
    expect(vi.mocked(clearSession)).not.toHaveBeenCalled()
  })

  it('discards the session and its mirror, and nothing else', async () => {
    await storeSession()
    writeMirror(createDoc({ source: SOURCE }))
    expect(localStorage.getItem(MIRROR_KEY)).not.toBeNull()
    await renderAt('/editor')
    await waitFor(() => resumeCard() !== null)

    await act(async () => {
      button('Discard').click()
    })
    await waitFor(() => vi.mocked(clearSession).mock.calls.length > 0)
    expect(vi.mocked(clearSession)).toHaveBeenCalledTimes(1)
    // The mirror is the only other copy of the document, so discarding has to take
    // it too — otherwise a reload re-offers what was just thrown away.
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
    expect(resumeCard()).toBeNull()
    expect(useDocStore.getState().present.source).toBeNull()
    // Discarding leaves the import screen exactly where it was.
    expect(harness.container.textContent).toContain('Edit an image')
  })

  it('prefers the mirror when it is newer and names the same image', async () => {
    // The mirror exists for the hard reload that lands inside the save's debounce
    // window: the IndexedDB write never committed, the synchronous one did. The
    // edits it carries are the ones the user would otherwise lose.
    await storeSession()
    writeMirror(createDoc({ source: SOURCE, adjust: { ...createDoc().adjust, exposure: 0.5 } }), {
      now: () => Date.now() + 10_000,
    })
    await renderAt('/editor')
    await waitFor(() => resumeCard() !== null)
    await act(async () => {
      button('Resume').click()
    })
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(useDocStore.getState().present.adjust.exposure).toBe(0.5)
  })

  it('ignores a mirror that names a different image', async () => {
    // The mirror carries edits, not pixels. Adopting one that names an asset
    // nothing has bytes for would resume into a blank canvas — and the previous
    // save is exactly what the user would have got anyway.
    await storeSession()
    writeMirror(
      createDoc({
        source: { ...SOURCE, assetId: 'asset_other' },
        adjust: { ...createDoc().adjust, exposure: 0.5 },
      }),
      { now: () => Date.now() + 10_000 },
    )
    await renderAt('/editor')
    await waitFor(() => resumeCard() !== null)
    await act(async () => {
      button('Resume').click()
    })
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    expect(useDocStore.getState().present.adjust.exposure).toBe(0)
    expect(useDocStore.getState().present.source?.assetId).toBe('asset_resume')
  })

  it('says nothing at all when there is no session to offer', async () => {
    await renderAt('/editor')
    await flush()
    expect(resumeCard()).toBeNull()
    expect(errorText()).toBeNull()
    expect(vi.mocked(clearSession)).not.toHaveBeenCalled()
  })
})

describe('the route a card opens', () => {
  it('opens the tool the URL names, and only that one', async () => {
    const sheet = await openToolAt('/editor/adjust')
    expect(useUiStore.getState().activeTool).toBe('adjust')
    expect(sheet?.getAttribute('aria-label')).toBe('Adjust')
  })

  it('leaves no tool open for a name that is not one', async () => {
    // The dead route, seen from the other end: the router matches, the page
    // renders, and nothing says the name was not a tool. This is why the Hub's
    // cards are checked against `TOOL_IDS` rather than against the router.
    useUiStore.getState().setActiveTool(null)
    const sheet = await openToolAt('/editor/nonsense')
    expect(useUiStore.getState().activeTool).toBeNull()
    expect(sheet).toBeNull()
  })
})

describe('a document that cannot be rendered', () => {
  it('lands on the route error element with a recovery that does not throw work away', async () => {
    // React logs every error it re-throws and a render that raises on purpose is
    // the whole point here, so its own logging is muted for the duration.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      useDocStore.getState().load(createDoc({ source: { ...SOURCE, assetId: 'asset_vanished' } }))
      await renderAt('/editor/crop')

      const alert = harness.container.querySelector('[role="alert"]')
      expect(alert).not.toBeNull()
      // It names the asset, so the report can be matched to a session.
      expect(alert?.textContent).toContain('asset_vanished')
      expect(alert?.textContent).toContain('Reload the page to recover it.')
      const labels = Array.from(alert?.querySelectorAll('button') ?? []).map(
        (node) => node.textContent,
      )
      // Reload is the real recovery: it re-reads the row and re-decodes. "Start
      // over" is the destructive one and says so, because it deletes the photo.
      expect(labels).toContain('Reload')
      expect(labels).toContain('Start over — deletes your photo and edits')
      expect(labels).toContain('Back to the home page')
    } finally {
      logged.mockRestore()
    }
  })

  it('reaches the editor again only through the button that clears the session', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      useDocStore.getState().load(createDoc({ source: { ...SOURCE, assetId: 'asset_vanished' } }))
      const router = await renderAt('/editor/crop')
      const startOver = Array.from(
        harness.container.querySelectorAll('[role="alert"] button'),
      ).find((node) => node.textContent?.startsWith('Start over')) as HTMLButtonElement
      expect(startOver).toBeDefined()

      await act(async () => {
        startOver.click()
      })
      await flush()
      expect(vi.mocked(clearSession)).toHaveBeenCalledTimes(1)
      expect(router.state.location.pathname).toBe('/editor')
    } finally {
      logged.mockRestore()
    }
  })
})

describe('a document that reopens with a look already applied', () => {
  // Twenty-four looks in four families is roughly eleven hundred pixels of chips in
  // a scroller eight hundred tall, so the sheet opens at the top — which is
  // `LOOKS` and `None`. `vivid` is in *Creative*, the last family and the last
  // screenful. Before the panel scrolled the applied chip into view, such a
  // document reopened into a panel with no lit chip and no readable name, and the
  // photo on the canvas was the only evidence of what had been applied.
  const VIVID = createDoc({
    source: SOURCE,
    look: { id: 'vivid', amount: 1 },
  })

  /** Follow the card to `/editor/filters` and take the stored session back. */
  async function reopenWithTheLook(): Promise<void> {
    await storeSession(VIVID)
    await renderAt('/editor/filters')
    await waitFor(() => resumeCard() !== null)
    await act(async () => {
      button('Resume').click()
    })
    await waitFor(() => harness.container.querySelector('[role="dialog"]') !== null)
  }

  it('scrolls the applied chip into view, and only as far as it needs', async () => {
    const scrolled: unknown[] = []
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      ...args: unknown[]
    ) {
      scrolled.push(args[0])
    })
    await reopenWithTheLook()
    // The route opened the Looks sheet over the resumed document.
    const sheet = harness.container.querySelector('[role="dialog"]')
    expect(sheet?.getAttribute('aria-label')).toBe('Looks')
    const chip = sheet?.querySelector('button[aria-label="Vivid"]')
    expect(chip?.getAttribute('aria-pressed')).toBe('true')
    // …and the chip is brought on screen, not merely present in the tree. The
    // call is inside a `requestAnimationFrame`, so the wait is on the spy rather
    // than on a fixed delay: jsdom's rAF is a ~16 ms timer, which is longer than
    // the microtask-flush the rest of this file uses to settle effects.
    await waitFor(() => spy.mock.calls.length > 0)
    expect(spy).toHaveBeenCalled()
    // `block: 'nearest'` is the whole of the behaviour: scrolling the sheet's own
    // body, and only when the chip is genuinely outside it, so a look that is
    // already visible moves nothing.
    expect(scrolled).toContainEqual({ block: 'nearest' })
    spy.mockRestore()
  })

  it('does not throw where the DOM has no scrollIntoView at all', async () => {
    // jsdom implements none, so the harness installs an inert one. Removing it
    // again is the only way to reach the case this guard exists for: a throw
    // inside a `requestAnimationFrame` callback has no caller to reject, so it
    // surfaced as an unhandled error with a stack in a panel and nowhere else.
    const installed = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    try {
      await reopenWithTheLook()
      expect(
        harness.container
          .querySelector('[role="dialog"] button[aria-label="Vivid"]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true')
    } finally {
      if (installed) Object.defineProperty(Element.prototype, 'scrollIntoView', installed)
    }
  })

  it('names the look in the panel, so the canvas is not the only evidence', async () => {
    await reopenWithTheLook()
    const sheet = harness.container.querySelector('[role="dialog"]')
    const pressed = Array.from(sheet?.querySelectorAll('button[aria-pressed="true"]') ?? []).map(
      (node) => node.getAttribute('aria-label'),
    )
    // Exactly one chip claims to be applied, and it is the right one. The old
    // failure was zero chips claiming, on a document that had one applied — and
    // the chip's `aria-label` is the only place the name is written down.
    expect(pressed).toEqual(['Vivid'])
  })
})
