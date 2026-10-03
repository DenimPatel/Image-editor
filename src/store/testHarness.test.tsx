import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastStack } from '../components/controls/Toast'
import { createDoc } from '../model/defaults'
import { useDocStore } from './docStore'
import { createHarness, resetStores } from './testHarness'
import { useUiStore } from './uiStore'

/**
 * `resetStores` is the shared `beforeEach` of thirty-six test files, so what it
 * leaves behind is shared state by definition.
 *
 * The one it got wrong was the toast list, and it was found by a flake rather than
 * by inspection: `EditorImport.test.tsx > "report a sample that could not be
 * fetched"` failed about one full run in three with
 *
 *     expected <div role="status">
 *       A frame failed to render, so the preview is now using the slower renderer…
 *     </div> to be null
 *
 * The reason is four steps long and none of them is the import screen:
 *
 *  1. `Editor` renders `<ToastStack />` unconditionally, so the stack is mounted on
 *     the import screen as well as in the workspace.
 *  2. `useRenderLoop`'s frame runs from a rAF that no test awaits, so it can still
 *     be in flight when the test that started it has unmounted and cleared the
 *     asset store. When it throws there, it pushes the render-fallback notice.
 *  3. That latch is module state — once per page load, so once per test *file* —
 *     and the toast it pushes lives in the ui store, which outlives every tree.
 *  4. `ToastStack` schedules its 3.2 s dismissal in an effect, and `unmount()`
 *     clears that effect's timers, so nothing ever removes the toast. It is still
 *     in the container for every test after it.
 *
 * Whether step 2's frame beat the unmount is a race the full suite's load decides.
 * That is the whole reason it passed in isolation twenty times out of twenty and
 * failed in one full run out of three: nothing here is intermittent except the
 * timing, and the timing was load.
 */

const harness = createHarness()

function liveStatuses(): Element[] {
  return [...harness.container.querySelectorAll('[role="status"]')]
}

beforeEach(() => {
  localStorage.clear()
  resetStores()
})

afterEach(async () => {
  harness.unmount()
  localStorage.clear()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('resetStores', () => {
  it('takes a pushed toast out of the store and off the screen', async () => {
    useUiStore.getState().pushToast('left over from a test that has finished')
    act(() => {
      harness.render(<ToastStack />)
    })
    expect(liveStatuses()).toHaveLength(1)

    // What the next test's `beforeEach` does.
    resetStores()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(useUiStore.getState().toasts).toEqual([])
    expect(liveStatuses()).toEqual([])
  })

  it('clears the error log an error toast appends to, which also outlives a reload', () => {
    useUiStore.getState().pushToast('Storage is full', 'error')
    expect(useUiStore.getState().errorLog).toHaveLength(1)
    resetStores()
    expect(useUiStore.getState().errorLog).toEqual([])
  })

  it('clears jobs, which have a lifetime of their own', () => {
    useUiStore
      .getState()
      .startJob({ id: 'j1', label: 'Background removal', progress: 0.5, status: 'running' })
    expect(useUiStore.getState().jobs).toHaveLength(1)
    resetStores()
    expect(useUiStore.getState().jobs).toEqual([])
  })

  it('still puts the document and the three chrome fields back', () => {
    useDocStore.getState().load(
      createDoc({
        source: { assetId: 'a1', width: 4, height: 4, name: 'p', mime: 'image/png' },
      }),
    )
    useUiStore.setState({ activeTool: 'crop', compareHeld: true, showHelp: true })
    resetStores()
    expect(useDocStore.getState().present.source).toBeNull()
    expect(useUiStore.getState().activeTool).toBeNull()
    expect(useUiStore.getState().compareHeld).toBe(false)
    expect(useUiStore.getState().showHelp).toBe(false)
  })
})
