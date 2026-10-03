import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../model/defaults'
import { installFakeIndexedDb, type FakeIndexedDb } from '../lib/persist/fakeIndexedDb'
import { clearSession, saveSession, type StoredSession } from '../lib/persist/session'
import { createHarness, resetStores, stubCanvas, stubResizeObserver } from '../store/testHarness'
import Editor from './Editor'

const harness = createHarness()

class FakeImageBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

/** A PNG header is all the decode guard reads before it asks for pixels. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

// One factory for the whole file: the session module opens the database once,
// so a fresh fake per test would leave it pointing at the first one.
const fake: FakeIndexedDb = installFakeIndexedDb()

const fetchMock = vi.fn(async () =>
  Promise.resolve(
    new Response(pngBytes(400, 300).buffer as ArrayBuffer, {
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

const clipboardMock = {
  text: '',
  writeText: vi.fn(async (text: string) => {
    clipboardMock.text = text
  }),
  readText: vi.fn(async () => clipboardMock.text),
}

function renderEditor(): void {
  harness.render(
    <MemoryRouter initialEntries={['/editor']} future={{ v7_startTransition: true }}>
      <Editor />
    </MemoryRouter>,
  )
}

function sampleButtons(): HTMLButtonElement[] {
  return Array.from(harness.container.querySelectorAll('button')).filter((button) =>
    (button.textContent ?? '').startsWith('Sample'),
  )
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(harness.container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  )
  if (!found) throw new Error(`no "${label}" button in ${harness.container.textContent}`)
  return found
}

function busy(): Element | null {
  return harness.container.querySelector('[role="status"]')
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Decode runs across several microtask/macrotask hops; poll instead of guessing. */
async function waitFor(condition: () => boolean, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return
    await flush()
  }
}

beforeEach(async () => {
  await clearSession()
  resetStores()
  fetchMock.mockClear()
  fetchMock.mockImplementation(async () =>
    Promise.resolve(
      new Response(pngBytes(400, 300).buffer as ArrayBuffer, {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  )
  clipboardMock.text = ''
  clipboardMock.readText.mockClear()
  clipboardMock.writeText.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { clipboard: clipboardMock })
  // The editor only renders an asset it can prove is an ImageBitmap, and jsdom
  // has no such constructor.
  vi.stubGlobal('ImageBitmap', FakeImageBitmap)
})

afterEach(() => {
  harness.unmount()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Editor import', () => {
  it('D7-F02: shows a busy state while an image opens and refuses re-entry', async () => {
    let release: (() => void) | null = null
    let started: () => void = () => {}
    const decoding = new Promise<void>((resolve) => {
      started = resolve
    })
    const bitmapMock = vi.fn(() => {
      started()
      return new Promise<never>((_resolve, reject) => {
        release = () => reject(new Error('decode failed on purpose'))
      })
    })
    vi.stubGlobal('createImageBitmap', bitmapMock)
    renderEditor()
    expect(busy()).toBeNull()

    await act(async () => {
      sampleButtons()[0].click()
      await decoding
    })
    expect(bitmapMock).toHaveBeenCalledOnce()
    expect(busy()?.textContent).toBe('Opening image…')
    expect(harness.container.querySelector('[aria-busy="true"]')).not.toBeNull()

    // A second click while the first decode is still running is a no-op.
    await act(async () => {
      sampleButtons()[1].click()
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(bitmapMock).toHaveBeenCalledOnce()

    await act(async () => {
      release?.()
      await Promise.resolve()
    })
    expect(busy()).toBeNull()
    expect(harness.container.textContent).toContain('Could not load that sample image.')
  })

  it('D7-F03: an image past the device pixel limit is refused with a readable message', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 1, height: 1 })),
    )
    fetchMock.mockImplementation(async () =>
      Promise.resolve(
        new Response(pngBytes(6000, 4000).buffer as ArrayBuffer, {
          headers: { 'content-type': 'image/png' },
        }),
      ),
    )
    renderEditor()
    await act(async () => {
      sampleButtons()[0].click()
    })
    await waitFor(() => busy() === null)
    expect(harness.container.textContent).toContain('24 megapixels')
    expect(harness.container.textContent).toContain('16.8 megapixels')
    expect(busy()).toBeNull()
  })

  it('D2-F14: the system clipboard is read on mount, not a localStorage key', async () => {
    clipboardMock.text = JSON.stringify({ schema: 3, adjust: { exposure: 1 } })
    renderEditor()
    await flush()
    expect(clipboardMock.readText).toHaveBeenCalled()
    expect(harness.container.textContent).toContain('Edit an image')
  })
})

describe('Editor resume', () => {
  const stored = createDoc({
    source: { assetId: 'asset_resume', width: 400, height: 300, name: 'saved', mime: 'image/png' },
  })

  it('D2-F10: a stored row that is not a document is refused, not loaded verbatim', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    expect(
      await saveSession(
        stored,
        {
          assetId: 'asset_resume',
          blob: new Blob(['png-bytes'], { type: 'image/png' }),
          mime: 'image/png',
        },
        null,
      ),
    ).toBe('ok')
    // A row this build cannot read: it names a source, but it is not a document.
    const row = fake.read<StoredSession>('sessions', 'current')
    if (!row) throw new Error('no stored session')
    row.doc = { source: { assetId: 'asset_resume' } }

    renderEditor()
    await flush()
    await act(async () => {
      button('Resume').click()
    })
    await waitFor(() => (harness.container.textContent ?? '').includes('cannot read it'))
    expect(harness.container.textContent).toContain('cannot read it')
    expect(harness.container.textContent).toContain('Edit an image')
  })
})

/**
 * The workspace shell. These are the pieces that only exist once a document is
 * open — the skip link, the landmarks, the top bar, and the route in from the
 * Hub's "Start editing" — and they are what `smoke.test.tsx` could not reach,
 * because it renders the import screen to a string and stops.
 */
describe('Editor workspace shell', () => {
  beforeEach(() => {
    // jsdom has no canvas implementation, and the workspace builds a real render
    // backend on mount — which throws `Canvas2D unavailable` from
    // `src/render/fallback2d.ts` and takes the whole tree down with it. That is
    // why no page-level test opened a workspace until `testHarness` grew the
    // same stub `EditorCanvas.test.tsx` uses; nothing here paints.
    stubCanvas()
    stubResizeObserver()
  })

  async function openWorkspace() {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => new FakeImageBitmap(400, 300)),
    )
    renderEditor()
    await act(async () => {
      sampleButtons()[0].click()
    })
    await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
    return harness.container
  }

  it('D8-F14: has a skip link aimed at a main landmark that exists', async () => {
    const root = await openWorkspace()
    const link = root.querySelector('a[href="#editor-main"]')
    expect(link?.textContent).toBe('Skip to the canvas')
    // The target is the thing under test: a skip link pointing at an id that is
    // not on the page is the single most common way for one of these to be a
    // no-op that still looks right in a snapshot.
    const main = root.querySelector('#editor-main')
    expect(main?.tagName).toBe('MAIN')
    expect(main?.getAttribute('tabindex')).toBe('-1')
  })

  it('the skip link is the first thing a Tab reaches', async () => {
    const root = await openWorkspace()
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]'),
    ).filter((node) => node.getAttribute('tabindex') !== '-1')
    expect(focusable[0]).toBe(root.querySelector('a[href="#editor-main"]'))
  })

  it('has exactly one banner, one main and one tool navigation', async () => {
    const root = await openWorkspace()
    expect(root.querySelectorAll('header')).toHaveLength(1)
    expect(root.querySelectorAll('main')).toHaveLength(1)
    expect(root.querySelectorAll('nav')).toHaveLength(1)
  })

  it('the tool navigation names every tool, and the open one is marked current', async () => {
    const root = await openWorkspace()
    const nav = root.querySelector('nav[aria-label="Editor tools"]') as HTMLElement
    const labels = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(labels).toHaveLength(13)
    expect(labels).toContain('Crop')
    expect(labels).toContain('Export')
    // Nothing is open yet, so nothing claims to be.
    expect(nav.querySelectorAll('button[aria-current]')).toHaveLength(0)
  })

  it('D8-F01: a tool tab is not a toggle, so tapping the open one keeps it open', async () => {
    const root = await openWorkspace()
    const nav = root.querySelector('nav[aria-label="Editor tools"]') as HTMLElement
    const exportTab = Array.from(nav.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Export',
    ) as HTMLButtonElement
    await act(async () => exportTab.click())
    expect(nav.querySelector('button[aria-current]')?.textContent?.trim()).toBe('Export')
    await act(async () => exportTab.click())
    expect(nav.querySelector('button[aria-current]')?.textContent?.trim()).toBe('Export')
    expect(root.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('D8-F15: the keyboard shortcut sheet is reachable without knowing the "?" key', async () => {
    const root = await openWorkspace()
    const more = root.querySelector('[aria-label="More options"]') as HTMLButtonElement
    await act(async () => more.click())
    const item = Array.from(root.querySelectorAll('[role="menuitem"]')).find(
      (node) => node.textContent === 'Keyboard shortcuts',
    )
    expect(item).toBeDefined()
    await act(async () => (item as HTMLElement).click())
    const dialog = root.querySelector('[role="dialog"][aria-modal="true"]')
    expect(dialog?.textContent).toContain('Keyboard shortcuts')
    // Focus goes to the sheet, and closing it hands focus back to the opener.
    expect(dialog?.contains(document.activeElement)).toBe(true)
    const close = Array.from(dialog?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Close',
    ) as HTMLButtonElement
    await act(async () => close.click())
    expect(root.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('every shortcut the sheet lists is a key the app actually binds', async () => {
    const root = await openWorkspace()
    const more = root.querySelector('[aria-label="More options"]') as HTMLButtonElement
    await act(async () => more.click())
    const item = Array.from(root.querySelectorAll('[role="menuitem"]')).find(
      (node) => node.textContent === 'Keyboard shortcuts',
    ) as HTMLElement
    await act(async () => item.click())
    const dialog = root.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement
    const rows = Array.from(dialog.querySelectorAll('dl > div')).map((row) => ({
      keys: row.querySelector('dt')?.textContent ?? '',
      effect: row.querySelector('dd')?.textContent ?? '',
    }))
    expect(rows.length).toBeGreaterThan(6)
    // A sheet that lists a shortcut the handler no longer has is a lie, and it
    // is the one string on this page that no other test can reach.
    const shortcutSource = readFileSync(
      resolve(process.cwd(), 'src/hooks/useKeyboardShortcuts.ts'),
      'utf8',
    )
    for (const row of rows) {
      if (/⌘|ctrl/i.test(row.keys)) continue
      // "c a t b e" is a sequence of five bindings, not one; each letter is a
      // key of its own and each has to be bound by the handler.
      const keys = row.keys.split(/\s+/).filter(Boolean)
      expect(keys.length, row.effect).toBeGreaterThan(0)
      for (const key of keys) {
        // The handler binds the tool letters through a lookup table, the
        // one-off keys through a `switch`, and the compare key through a
        // literal comparison whose backslash is escaped in the source. All
        // three are valid evidence that the listed key is handled.
        const bound = [key, `\\${key}`].some(
          (candidate) =>
            new RegExp(`case '${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(
              shortcutSource,
            ) ||
            new RegExp(`^\\s*${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*'`, 'm').test(
              shortcutSource,
            ) ||
            new RegExp(`key === '${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`).test(
              shortcutSource,
            ),
        )
        expect(bound, `${row.keys} → ${row.effect}`).toBe(true)
      }
    }
  })

  it('D8-F03: the sheet keeps its title and Close button while the body scrolls', () => {
    // The Export panel is taller than a phone viewport, and opening a sheet
    // focuses its first control, which scrolls the body — so a non-sticky
    // header scrolled the only visible way out of the panel off the screen on
    // a device with no Escape key. The rule is the thing under test; jsdom
    // does not load the stylesheet.
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/controls/controls.module.css'),
      'utf8',
    )
    const rule = css.slice(css.indexOf('.sheetTitleRow {'))
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/position:\s*sticky/)
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/top:\s*0/)
    // And the body is what scrolls, not the sheet.
    const body = css.slice(css.indexOf('.sheetBody {'))
    expect(body.slice(0, body.indexOf('}'))).toMatch(/overflow-y:\s*auto/)
  })

  it('D8-F13: the forced-colours rules give the dial a track and a needle', () => {
    // The forced-colors block reached the tick rulers through the `background`
    // shorthand, which also resets `background-image` — so every dial rendered
    // as one solid block of CanvasText with a CanvasText needle on top of it:
    // a value you could drag and could not see. Forced-colors mode drops
    // `background-image` on every element however it was written, so the ticks
    // cannot be brought back and the track-plus-needle pair has to carry the
    // value on its own.
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/controls/controls.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const forced = css.slice(css.indexOf('@media (forced-colors: active) {'))
    const dial = forced.slice(forced.indexOf('.dialRuler,'), forced.indexOf('.dialTrack,'))
    expect(dial).toMatch(/\.dialRuler,\s*\.dialRulerMajor \{\s*background: none/)
    expect(dial).toMatch(/\.dialNeedle \{[^}]*background-color:\s*Highlight/)
    // The needle must not *also* be in the CanvasText group: the two rules
    // would contradict each other and one would win by accident.
    const canvasTextGroup = forced.slice(
      forced.indexOf('.sheetClose,'),
      forced.indexOf('.dialRuler,'),
    )
    expect(canvasTextGroup).not.toMatch(/\.dialNeedle/)
    // And the track keeps a real edge, so the needle is positioned against
    // something rather than floating on the panel background.
    expect(forced).toMatch(/\.dialTrack,[^{]*\{\s*border: 1px solid CanvasText/)
  })

  it('D8-F13: the accent-coloured labels get a system pair under forced colours', () => {
    // The tool panels had no forced-colors block at all, and `.textButtonPrimary`
    // is `#fff` on `--ie-accent` — a literal the palette cannot fix. On WebKit's
    // light high-contrast theme that resolved to white on `#b3d7fe`, 1.49:1
    // against a 4.5:1 requirement. Same shape on the hub's `.eyebrow`.
    const tools = readFileSync(
      resolve(process.cwd(), 'src/components/tools/tools.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    const forced = tools.slice(tools.indexOf('@media (forced-colors: active) {'))
    expect(forced).toMatch(/\.textButton,\s*\.textButtonPrimary \{[^}]*background: ButtonFace/)
    expect(forced).toMatch(/\.textButton,\s*\.textButtonPrimary \{[^}]*color: ButtonText/)
    // A hard-coded #fff must not survive into the forced palette anywhere.
    expect(forced).not.toMatch(/#fff/)
    // …and the hub's has the same shape of fix. It has to be in `hub.css` and
    // not in `base.css`: a media query adds no cascade weight and `index.css`
    // loads `hub.css` last, so an override written in `base.css` loses to the
    // very rule it was meant to replace.
    const hub = readFileSync(resolve(process.cwd(), 'src/styles/hub.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )
    expect(hub.slice(hub.indexOf('@media (forced-colors: active) {'))).toMatch(
      /\.eyebrow \{[^}]*color: CanvasText/,
    )
    const index = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')
    expect(index.indexOf('hub.css')).toBeGreaterThan(index.indexOf('base.css'))
  })

  it('D8-F06: a crash in the tree shows a way out rather than a blank page', () => {
    const boundary = readFileSync(
      resolve(process.cwd(), 'src/components/ui/ErrorBoundary.tsx'),
      'utf8',
    )
    // "Try again" and "Reload" are the recovery; the context line must not
    // claim a moment it cannot know, because the boundary wraps the whole app
    // for the whole session and a panel can throw mid-edit.
    expect(boundary).toMatch(/onRetry=\{this\.retry\}/)
    expect(boundary).toMatch(/onReload=\{\(\) => window\.location\.reload\(\)\}/)
    expect(boundary).not.toMatch(/could not finish loading/i)
  })

  it('the crash flag cannot be reached in a production bundle', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    const crash = readFileSync(
      resolve(process.cwd(), 'src/components/ui/CrashOnPurpose.tsx'),
      'utf8',
    )
    // `import.meta.env.DEV` is statically false in a build, so Rollup drops the
    // component. The guard has to be *inside* the component, not in the caller:
    // a `&&` in main.tsx would be constant-folded only if the bundler could see
    // both halves, and a future refactor could drop it silently.
    expect(crash).toMatch(/import\.meta\.env\.DEV/)
    expect(main).toMatch(/<CrashOnPurpose \/>/)
  })
})
