import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeIndexedDb } from '../lib/persist/fakeIndexedDb'
import { MIRROR_KEY, writeMirror } from '../lib/persist/mirror'
import { loadSession, saveSession } from '../lib/persist/session'
import { markOnboardingSeen } from '../components/editor/onboardingKeys'
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
 * IMP-001 / IMP-006 at the page level — the whole round trip, through the real menu.
 *
 * `journey.new-image.spec.ts` drives this in two browsers and pays for it in minutes;
 * this file drives the same path in jsdom so a regression in the wiring between the
 * menu row, the confirmation, the store and the two durable copies fails in the unit
 * suite rather than in CI's e2e leg. What only a browser can answer stays there: this
 * cannot prove the dialog *looks* modal, or that a reload really tears the page down.
 */

const harness = createHarness()

/**
 * A gate that can hold a save open across the gesture under test.
 *
 * `vi.hoisted` because `vi.mock`'s factory is lifted above the imports, so it
 * cannot close over a `const` declared here. The gate *replaces nothing*: the real
 * `saveSession` runs once released, and only the timing is controlled. That is what
 * makes the assertion honest — the row that would have been resurrected is written
 * by the real implementation, not by a stand-in.
 */
const gate = vi.hoisted(() => {
  let holding = false
  let waiters: Array<() => void> = []
  const state = {
    /** How many writes have been *dispatched*, held or not. */
    calls: 0,
    /** How many times the gate has been closed — the offset a real write needs. */
    held: 0,
    hold(next: boolean) {
      holding = next
      if (holding) state.held += 1
      if (!holding) {
        const open = waiters
        waiters = []
        for (const open_ of open) open_()
      }
    },
    async pass<T>(run: () => Promise<T>): Promise<T> {
      if (holding) await new Promise<void>((resolve) => waiters.push(resolve))
      return run()
    },
  }
  return state
})

vi.mock('../lib/persist/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/persist/session')>()
  return {
    ...actual,
    saveSession: (doc: Parameters<typeof actual.saveSession>[0], ...rest: unknown[]) => {
      gate.calls += 1
      return gate.pass(
        () =>
          (actual.saveSession as (...args: unknown[]) => Promise<unknown>)(
            doc,
            ...rest,
          ) as Promise<never>,
      )
    },
  }
})

const saveCalls = (): number => gate.calls
const dispatchedSaves = (): number => gate.calls - gate.held

/** Open or close the gate that holds every `saveSession` open. */
const holdSaves = (holding: boolean): void => gate.hold(holding)

/** Wait until at least `count` saves have been dispatched. */
async function waitForSave(count: number, attempts = 200): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (saveCalls() >= count) return
    await flush()
  }
  if (saveCalls() < count) throw new Error(`only ${saveCalls()} of ${count} saves were dispatched`)
}

class FakeImageBitmap {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  close(): void {}
}

/** A PNG header is all the decode guard reads before it asks for pixels. */
function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(32))
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  view.setUint32(12, 0x49484452)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

// One factory for the whole file, as in `Editor.test.tsx`: the session module opens
// the database once, so a fresh fake per test would leave it pointing at the first.
installFakeIndexedDb()

const fetchMock = vi.fn(async () =>
  Promise.resolve(
    new Response(pngBytes(400, 300).buffer as ArrayBuffer, {
      headers: { 'content-type': 'image/png' },
    }),
  ),
)

function renderEditor(): void {
  harness.render(
    <MemoryRouter initialEntries={['/editor']} future={{ v7_startTransition: true }}>
      <Editor />
    </MemoryRouter>,
  )
}

/**
 * A button by accessible name.
 *
 * By `aria-label` rather than by text, because the overflow trigger is a glyph:
 * `IconButton` renders no text at all, so a `textContent` lookup cannot find the one
 * control this file has to reach.
 */
function buttonByName(name: string): HTMLButtonElement {
  const found = Array.from(harness.container.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`no button named "${name}" in ${harness.container.textContent}`)
  return found
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Wait until `condition` holds, or the deadline passes.
 *
 * `condition` may be async, and it is unwrapped rather than tested for truthiness:
 * an unawaited promise is always truthy, so an async predicate passed here without
 * this would make every wait succeed on its first turn and the assertion after it
 * vacuous. That is not hypothetical — it is exactly how this file's own in-flight
 * case passed against a deliberately reverted fix.
 *
 * A wall-clock deadline rather than a count of turns: a count is generous on an
 * idle machine and far too short on a loaded one.
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() > deadline) {
      throw new Error(`the condition never held within ${timeoutMs} ms`)
    }
    await flush()
  }
}

/** Open the overflow menu and press one row of it, the way a user does. */
async function pressMenuRow(label: string): Promise<void> {
  await act(async () => {
    buttonByName('More options').click()
  })
  await flush()
  const row = Array.from(harness.container.querySelectorAll('[role="menuitem"]')).find(
    (node) => node.textContent === label,
  )
  if (!row) throw new Error(`no "${label}" row in the overflow menu`)
  await act(async () => {
    ;(row as HTMLButtonElement).click()
  })
  await flush()
}

/**
 * The confirmation, and only the confirmation.
 *
 * Not by `[aria-modal="true"]`: the first-run panel and the mobile tool sheet are both
 * modal dialogs too, and a selector that matches those turns "the confirmation was
 * not asked" into a claim about whichever panel happened to be open. Located by the
 * question it asks, which is also how a reader finds it.
 */
function confirmation(): HTMLElement | null {
  const found = Array.from(harness.container.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
    (node) => node.textContent?.includes('Start a new image?'),
  )
  return found ?? null
}

function confirmationButton(label: string): HTMLButtonElement {
  const found = Array.from(confirmation()?.querySelectorAll('button') ?? []).find(
    (node) => node.textContent === label,
  )
  if (!found) throw new Error(`no "${label}" control in the confirmation`)
  return found as HTMLButtonElement
}

async function loadSample(index = 0): Promise<string> {
  const samples = Array.from(harness.container.querySelectorAll('button')).filter((button) =>
    (button.textContent ?? '').startsWith('Sample'),
  )
  const label = (samples[index]?.textContent ?? '').slice(0, 8)
  await act(async () => {
    ;(samples[index] as HTMLButtonElement).click()
  })
  await waitFor(() => !!harness.container.querySelector('nav[aria-label="Editor tools"]'))
  return label
}

/**
 * One undoable edit per call, through the store's own `update`.
 *
 * The property under test is the *count the dialog states*, and `past.length` is what
 * the dialog reads, so the edit has to be a real undo step rather than a keystroke:
 * the crop handle's own arithmetic belongs to `CropPanel`, which has its own tests.
 */
function makeOneEdit(key: 'exposure' | 'warmth' | 'contrast' = 'exposure'): void {
  act(() => {
    useDocStore
      .getState()
      .update((current) => ({ ...current, adjust: { ...current.adjust, [key]: 0.5 } }), { key })
  })
}

beforeEach(async () => {
  stubCanvas()
  stubResizeObserver()
  stubMatchMedia()
  resetStores()
  // The first-run panel is a modal dialog over the import screen, so leaving the
  // marker unset would put a second dialog between this file and the one under test.
  markOnboardingSeen()
  localStorage.clear()
  gate.calls = 0
  gate.held = 0
  gate.hold(false)
  fetchMock.mockClear()
  fetchMock.mockImplementation(async () =>
    Promise.resolve(
      new Response(pngBytes(400, 300).buffer as ArrayBuffer, {
        headers: { 'content-type': 'image/png' },
      }),
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  // The editor only renders an asset it can prove is an `ImageBitmap`, and jsdom has
  // no such constructor.
  vi.stubGlobal('ImageBitmap', FakeImageBitmap)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => new FakeImageBitmap(400, 300)),
  )
})

afterEach(async () => {
  // Release before unmount, or a held write keeps the harness's teardown waiting on
  // a promise that nothing in this file will resolve.
  gate.hold(false)
  harness.unmount()
  assetStore.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  await flush()
})

describe('the editor can be sent back to the import screen', () => {
  it('replaces the document without asking when there is nothing to lose', async () => {
    renderEditor()
    await loadSample(0)
    expect(assetStore.lruOrder()).toHaveLength(1)
    // The premise of the whole case: a freshly opened photograph has nothing to lose.
    expect(useDocStore.getState().past).toHaveLength(0)

    await pressMenuRow('New image')

    // No dialog: a confirmation in front of an action that destroys nothing is the
    // dialog that teaches people to press through dialogs.
    expect(confirmation()).toBeNull()
    expect(harness.container.textContent).toContain('Edit an image')
    expect(harness.container.querySelector('nav[aria-label="Editor tools"]')).toBeNull()
    expect(useDocStore.getState().present.source).toBeNull()
    // The replaced photograph's pixels are unreferenced, so they were released rather
    // than pinned by a history that no longer mentions them.
    expect(assetStore.lruOrder()).toEqual([])
  })

  it('asks first when there are edits, counts them, and Escape keeps the document', async () => {
    renderEditor()
    await loadSample(0)
    makeOneEdit()
    const kept = useDocStore.getState().present

    await pressMenuRow('New image')

    const panel = confirmation()
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(panel?.getAttribute('aria-describedby')).toBeTruthy()
    expect(panel?.textContent).toContain('Start a new image?')
    expect(panel?.textContent).toContain('1 edit')
    expect(panel?.textContent).not.toContain('1 edits')
    // Focus starts on the safe control: one `Enter` from here must not throw the
    // photograph away.
    expect(document.activeElement).toBe(confirmationButton('Cancel'))

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(confirmation()).toBeNull()
    expect(useDocStore.getState().present).toEqual(kept)
    expect(harness.container.querySelector('nav[aria-label="Editor tools"]')).not.toBeNull()
  })

  it('counts more than one edit in the plural', async () => {
    renderEditor()
    await loadSample(0)
    // Three edits on three *different* keys, because this test drives the store's
    // `update` directly rather than the Adjust panel's sliders.
    //
    // A slider keypress is NOT one of these: `DialSlider`'s keyboard path brackets
    // every press in `beginInteraction`/`endInteraction` (D2-F04), and an open
    // span pushes exactly one `past` entry, so three nudges of Exposure through the
    // real UI produce three undo steps, not one. That is the correct shape for a
    // discrete nudge — it is one deliberate act each — and `history.test.ts` pins
    // both halves of it ("starts a fresh undo step after an interaction ends" and
    // "restarts the step for a second span with the same key").
    //
    // The implicit `key` path is the one that coalesces, and the case below cannot
    // use it for three *different* controls, so this is still three real steps
    // rather than three keystrokes that happen to look like steps.
    for (const key of ['exposure', 'warmth', 'contrast'] as const) makeOneEdit(key)

    await pressMenuRow('New image')

    expect(confirmation()?.textContent).toContain('3 edits')
  })

  it('on yes, it takes both durable copies and drops the document', async () => {
    // IMP-006's whole claim: the stored row *and* the mirror go in the same
    // operation.
    //
    // Which half is the dangerous one is not symmetric, and getting it backwards
    // is how this comment was wrong before. A **mirror with no row** is inert —
    // `resolveResumableSession` returns `null` when the stored row is missing,
    // because a mirror carries edits and no pixels and cannot resume on its own.
    // A **row with no mirror** is what comes back: `resolveResumableSession`
    // returns `stored` unchanged when there is no mirror, so clearing only the
    // mirror leaves a reload offering the photograph that was just replaced. Both
    // go anyway — the pair is only ever read as a pair, and a half-cleared pair is
    // a state neither writer has an answer for — but the reason the row must not
    // survive is the resurrection, not symmetry.
    const saved = await saveSession(
      createDoc({
        source: { assetId: 'asset_saved', width: 8, height: 8, name: 'saved', mime: 'image/png' },
      }),
      {
        assetId: 'asset_saved',
        blob: new Blob([pngBytes(8, 8)], { type: 'image/png' }),
        mime: 'image/png',
      },
      null,
    )
    expect(saved).toBe('ok')
    writeMirror(createDoc({ source: useDocStore.getState().present.source ?? undefined }))
    expect(localStorage.getItem(MIRROR_KEY)).not.toBeNull()

    renderEditor()
    await loadSample(0)
    makeOneEdit()
    await pressMenuRow('New image')

    await act(async () => {
      confirmationButton('Start new image').click()
    })
    await flush()

    expect(confirmation()).toBeNull()
    expect(harness.container.textContent).toContain('Edit an image')
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
    expect(await loadSession()).toBeNull()
    expect(useDocStore.getState().present.source).toBeNull()
    expect(useDocStore.getState().past).toHaveLength(0)
  })

  it('does not let a save already in flight put the replaced photograph back', async () => {
    // The data-loss path, at the page level.
    //
    // `replaceDocument` used to `cancel()` the scheduler and delete the stored row
    // in the same tick, on the reasoning that `cancel()` covers the pending write.
    // It does not: a write *already dispatched* holds its own transaction, and
    // `cancel()` deliberately leaves it alone. It committed a moment later, and
    // because nothing schedules a write for the empty document that replaced it,
    // nothing overwrote it afterwards — so the replaced photograph's row survived
    // the replacement that was supposed to delete it.
    //
    // Driving that needs a save held open across the replace, which is why the
    // session module is taken over at the top of this file. The real implementation
    // still runs underneath: `saveCalls` is what proves a write was dispatched at
    // all, and every assertion is on the real store.
    renderEditor()
    await loadSample(0)
    makeOneEdit()

    // Dispatch the write rather than waiting out the 1000 ms debounce.
    //
    // `pagehide` is a real path the app already uses — `attachUnloadFlush` calls
    // `autosave.flush()` on it, which is how a mobile browser gets one last write
    // before discarding the page — so this is the app's own code bringing the
    // transaction forward rather than a timer being shortened in a test. It also
    // makes the held write the *last* one rather than one of several, which is
    // what makes the count below mean something.
    holdSaves(true)
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await waitForSave(1)

    await pressMenuRow('New image')
    await act(async () => {
      confirmationButton('Start new image').click()
    })

    // The replacement is committed to the store and the screen even while the write
    // is still held — those are synchronous steps, and the delete is the part that
    // waits. So the row is still there here, and must not be here afterwards.
    await waitFor(() => useDocStore.getState().present.source === null)
    expect(dispatchedSaves()).toBe(0)

    holdSaves(false)
    await flush()
    // Let the delete that was waiting on `idle()` finish.
    await waitFor(async () => (await loadSession()) === null)
    expect(localStorage.getItem(MIRROR_KEY)).toBeNull()
  })

  it('leaves focus on the import screen, not on the document body', async () => {
    // The quiet path is the one with no dialog to restore focus: the opener is the
    // More menu and the replacement unmounts the whole top bar, so the browser
    // falls back to `<body>`. A keyboard user pressing Enter on that menu row would
    // then be tabbing from the top of an empty document with nothing announced.
    renderEditor()
    await loadSample(0)

    await pressMenuRow('New image')

    expect(harness.container.textContent).toContain('Edit an image')
    await waitFor(() => document.activeElement?.id === 'editor-main')
    expect(document.activeElement).not.toBe(document.body)
  })

  it('leaves focus on the import screen after a confirmed replacement too', async () => {
    // The same trap on the other path: `ConfirmDialog` restores focus to whatever
    // opened it, and on a replacement that node is gone, so the restore lands on
    // nothing. `requestAnimationFrame` in `replaceDocument`'s effect defers past
    // the dialog's own restore rather than racing it.
    renderEditor()
    await loadSample(0)
    makeOneEdit()

    await pressMenuRow('New image')
    await act(async () => {
      confirmationButton('Start new image').click()
    })
    await waitFor(() => document.activeElement?.id === 'editor-main')
    expect(document.activeElement).not.toBe(document.body)
  })

  it('closes the tool panel it was opened over, because there is no photograph left', async () => {
    renderEditor()
    await loadSample(0)
    act(() => {
      useUiStore.getState().setActiveTool('crop')
    })
    expect(harness.container.querySelector('[aria-label="Crop & Straighten"]')).not.toBeNull()

    await pressMenuRow('New image')

    expect(useUiStore.getState().activeTool).toBeNull()
    expect(harness.container.querySelector('[aria-label="Crop & Straighten"]')).toBeNull()
  })

  it('offers a different photograph afterwards, and the store keeps only its pixels', async () => {
    renderEditor()
    await loadSample(0)
    const first = useDocStore.getState().present.source?.assetId
    await pressMenuRow('New image')

    await loadSample(1)

    const second = useDocStore.getState().present
    expect(second.source?.assetId).not.toBe(first)
    expect(second.source?.name).toBe('Sample 2')
    // A new document's state rather than the previous one's with the source swapped.
    expect(second.layers).toEqual(createDoc().layers)
    expect(second.adjust.exposure).toBe(0)
    expect(assetStore.lruOrder()).toEqual([second.source?.assetId])
  })

  it('the new photograph gets a name of its own, not the replaced one', async () => {
    // The top bar's title is `fileName`, which is page state rather than document
    // state, so a replacement that forgot it would leave "Sample 1" above "Sample 2".
    renderEditor()
    await loadSample(0)
    expect(harness.container.querySelector('header bdi')?.textContent).toBe('Sample 1')

    await pressMenuRow('New image')
    await loadSample(1)

    expect(harness.container.querySelector('header bdi')?.textContent).toBe('Sample 2')
  })
})
