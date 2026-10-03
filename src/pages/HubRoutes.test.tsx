import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markOnboardingSeen } from '../components/editor/onboardingKeys'
import { installFakeIndexedDb } from '../lib/persist/fakeIndexedDb'
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
import Hub from './Hub'

/**
 * Every door on the Hub has to open a room.
 *
 * `Hub.test.tsx` can check that a card's `href` is a well-formed path. That is not
 * enough, and it is not what went wrong: one of the eight cards pointed at
 * `/editor/transform`, which is a perfectly good-looking path. The router matched
 * it — `/editor/:tool` takes any string — and `Editor` only calls `setActiveTool`
 * for a name in `TOOL_IDS`, so `transform` selected nothing at all. The user
 * arrived with the photo loaded, no tab marked current, no sheet, and no message
 * saying the destination did not exist.
 *
 * So the invariant this file holds is the one a user would state: *follow the card,
 * get the thing the card promised*. Every card is clicked, the route is followed
 * through a real router with a real open document, and a panel has to be on screen
 * with the card's own tool marked current. A card that renders the
 * "no panel for this tool yet" fallback fails here, which is the shape the next
 * dead card would take.
 */

class FakeBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  close(): void {}
}

/** jsdom has none, and `Hub` reveals its cards by observing them. */
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return []
  }
}

const harness = createHarness()

// One factory for the whole file: the session module opens the database once, and
// a fresh fake per test would leave it pointing at the first one.
installFakeIndexedDb()

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Put a document with real pixels behind it into the live store. */
function openDocument(): void {
  const assetId = assetStore.add(new FakeBitmap(400, 300))
  useDocStore.getState().load(
    createDoc({
      source: { assetId, width: 400, height: 300, name: 'IMG_4821.png', mime: 'image/png' },
    }),
  )
}

function routerAt(path: string) {
  return createMemoryRouter(
    [
      { path: '/', element: <Hub /> },
      { path: '/editor', element: <Editor /> },
      { path: '/editor/:tool', element: <Editor /> },
    ],
    { initialEntries: [path] },
  )
}

/**
 * Follow `path` with an image already open, and wait for the router to match it.
 *
 * The unmount first is not tidiness: `RouterProvider` holds its "have I matched
 * yet" state internally, so swapping one router for another under the same React
 * root re-renders with the *previous* router's match, and the new route appears
 * a tick late. The loop below would then read the Hub's DOM and conclude that a
 * card opens nothing.
 */
async function follow(path: string): Promise<HTMLElement> {
  harness.unmount()
  useUiStore.getState().setActiveTool(null)
  const router = routerAt(path)
  act(() => {
    harness.render(<RouterProvider router={router} />)
  })
  await act(async () => {
    await router.state.initialized
  })
  await flush()
  return harness.container
}

/** Render the Hub and read back the destination of every card, in order. */
function cardDestinations(): string[] {
  act(() => {
    harness.render(<RouterProvider router={routerAt('/')} />)
  })
  return Array.from(harness.container.querySelectorAll('.tool-card')).map(
    (card) => (card as HTMLAnchorElement).getAttribute('href') ?? '',
  )
}

beforeEach(() => {
  stubCanvas()
  stubResizeObserver()
  stubMatchMedia()
  vi.stubGlobal('ImageBitmap', FakeBitmap)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  // The first-run orientation is a modal over the import screen and appears over
  // a workspace too; every test here is about the workspace, so it is answered.
  markOnboardingSeen()
  resetStores()
  // Every test here follows a card, and a card is followed *with a photo open* —
  // the editor's front page is a list of doors into a workspace, not into the
  // import screen. A document in the live store is also the cheapest way to get
  // one: no decode, no fetch, no fake bitmap through a promise.
  openDocument()
})

afterEach(async () => {
  harness.unmount()
  assetStore.clear()
  vi.unstubAllGlobals()
  localStorage.clear()
  await flush()
})

describe('every Hub card opens the tool it advertises', () => {
  it('reads its destinations off the rendered page, not off a table', () => {
    // If the list were hardcoded here it would drift the moment a card moved,
    // and this file would go on passing for a card that no longer exists.
    const destinations = cardDestinations()
    expect(destinations).toHaveLength(8)
    expect(destinations).toContain('/editor/crop')
  })

  it('follows each card to a panel with that tool marked current', async () => {
    const destinations = cardDestinations().filter((to) => to !== '/editor')
    expect(destinations.length).toBe(7)
    for (const to of destinations) {
      const root = await follow(to)
      const sheet = root.querySelector('[role="dialog"]')
      expect(sheet, `${to} opened no panel`).not.toBeNull()
      // A sheet whose body is the "no panel for this tool yet" note is the exact
      // shape a dead route has: something on screen, nothing behind it.
      expect(sheet?.textContent ?? '', to).not.toMatch(/No panel for this tool yet/)
      // `BottomSheet` labels the dialog with the tool's name, so a card that says
      // "Looks" has to arrive at the sheet called "Looks" and not merely at some
      // sheet.
      expect((sheet?.getAttribute('aria-label') ?? '').length, to).toBeGreaterThan(0)
      const current = root.querySelectorAll('nav[aria-label="Editor tools"] button[aria-current]')
      expect(current.length, `${to} marked no tab current`).toBe(1)
    }
  })

  it('names the tool the tab bar calls it, not the slug in the URL', async () => {
    // `/editor/filters` is the route; "Looks" is the name the tab, the sheet and
    // the keyboard-shortcut sheet all use. A card that called it "Filters" would
    // be asking the user to hold two names for one thing, which is the mistake the
    // tab bar was renamed to undo.
    const root = await follow('/editor/filters')
    const sheet = root.querySelector('[role="dialog"]')
    expect(sheet?.getAttribute('aria-label')).toBe('Looks')
    const current = root.querySelector('nav[aria-label="Editor tools"] button[aria-current]')
    expect(current?.textContent?.trim()).toBe('Looks')
  })

  it('the featured card opens the whole workspace, not a tool', async () => {
    // `/editor` legitimately opens nothing: that is the card's promise, and
    // pretending otherwise would make the invariant above wrong about it.
    const root = await follow('/editor')
    expect(root.querySelector('[role="dialog"]')).toBeNull()
    const tabs = Array.from(root.querySelectorAll('nav[aria-label="Editor tools"] button')).map(
      (tab) => tab.textContent?.trim(),
    )
    expect(tabs.length).toBe(13)
    expect(root.querySelector('nav[aria-label="Editor tools"] button[aria-current]')).toBeNull()
  })

  it('an unknown tool slug lands on the workspace with no tool, which is why cards need this gate', async () => {
    // The dead route, reproduced deliberately. The router matches `/editor/:tool`
    // for anything; nothing here throws, nothing says "no such tool", and the user
    // gets an editor with no panel. This test is the reason the loop above exists,
    // so it is written as the failure rather than left implicit.
    const root = await follow('/editor/transform')
    expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(root.querySelector('nav[aria-label="Editor tools"] button[aria-current]')).toBeNull()
    expect(root.querySelector('canvas')).not.toBeNull()
    expect(cardDestinations()).not.toContain('/editor/transform')
  })
})

describe('the workspace behind a card is the real one', () => {
  it('is the whole editor, with its landmarks and a canvas', async () => {
    const root = await follow('/editor/crop')
    expect(root.querySelectorAll('canvas').length).toBeGreaterThan(0)
    // The landmarks the skip link depends on, on the route a card leads to.
    expect(root.querySelector('main#editor-main')).not.toBeNull()
    expect(root.querySelector('a[href="#editor-main"]')).not.toBeNull()
    expect(root.querySelectorAll('header')).toHaveLength(1)
    // And the import screen is gone, which is what "the photo is loaded" means.
    expect(root.textContent).not.toContain('Edit an image')
  })
})
