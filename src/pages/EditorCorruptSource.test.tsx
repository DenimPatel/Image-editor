import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeIndexedDb } from '../lib/persist/fakeIndexedDb'
import { assetStore } from '../model/assetsSingleton'
import { createDoc } from '../model/defaults'
import type { DisposableAsset } from '../model/assets'
import { createHarness, resetStores } from '../store/testHarness'
import { useDocStore } from '../store/docStore'
import Editor from './Editor'

/**
 * A document that names a source the editor cannot produce pixels for is
 * corrupt, and the two things the page can do about it are both wrong: rendering
 * the import screen reads as "no image loaded" and strands a document that still
 * holds every edit, and quietly carrying on renders a canvas that will never
 * paint. The page raises instead, and the route's error element offers the one
 * action that fixes it — start over.
 *
 * The assertion is on what the render does, not on a helper: a helper that threw
 * while a caller swallowed it would pass a test aimed at the helper.
 */

const harness = createHarness()

class FakeImageBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

// One factory for the whole file: the session module opens the database once.
installFakeIndexedDb()

function renderEditor(): void {
  harness.render(
    <MemoryRouter initialEntries={['/editor']} future={{ v7_startTransition: true }}>
      <Editor />
    </MemoryRouter>,
  )
}

/**
 * Render and report what came out.
 *
 * React logs every error it re-throws, and a render that raises on purpose is
 * the whole point here, so its own logging is muted for the duration.
 */
function expectRenderToRaise(match: RegExp): void {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(() => renderEditor()).toThrow(match)
  } finally {
    logged.mockRestore()
  }
}

function corruptableAsset(width: number, height: number): DisposableAsset {
  return { width, height, close: () => {} }
}

beforeEach(() => {
  resetStores()
  // The editor only renders an asset it can prove is an ImageBitmap, and jsdom
  // has no such constructor.
  vi.stubGlobal('ImageBitmap', FakeImageBitmap)
  localStorage.setItem('ie-caps-v1', JSON.stringify({ maxCanvasArea: 16_000_000 }))
})

afterEach(() => {
  harness.unmount()
  assetStore.clear()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('Editor with a source it cannot render', () => {
  it('raises rather than showing the import screen for an asset that is gone', () => {
    useDocStore.getState().load(
      createDoc({
        source: {
          assetId: 'asset_vanished',
          width: 400,
          height: 300,
          name: 'a',
          mime: 'image/png',
        },
      }),
    )

    expectRenderToRaise(/no longer holds \(asset_vanished\)/)
  })

  it('raises when the stored asset is not pixels at all', () => {
    assetStore.add(corruptableAsset(400, 300), 'asset_not_a_bitmap')
    useDocStore.getState().load(
      createDoc({
        source: { assetId: 'asset_not_a_bitmap', width: 400, height: 300, name: 'b', mime: 'x' },
      }),
    )

    expectRenderToRaise(/not an ImageBitmap/)
  })

  it('still shows the import screen for a document with no source at all', () => {
    useDocStore.getState().load(createDoc())

    renderEditor()

    expect(harness.container.textContent).toContain('Edit an image')
  })
})
