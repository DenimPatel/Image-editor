import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createDoc } from '../model/defaults'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'

type Harness = {
  render: (element: JSX.Element) => void
  unmount: () => void
  container: HTMLElement
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// jsdom implements none of the pointer-capture API. Without these stubs every
// drag test fails on `setPointerCapture is not a function` instead of on the
// behaviour under test.
if (typeof Element !== 'undefined' && typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = function setPointerCapture() {}
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false
  }
}

// jsdom implements no layout, so it implements no `scrollIntoView` either — and a
// component that scrolls a chip into view when a document is reopened throws
// here on every open. Inert rather than recorded: a test that wants to know
// whether the call happened spies on the prototype itself, and one that wants to
// know the component survives *without* it deletes it back off. Installing a
// recording stub here would quietly make the second question unaskable.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

/**
 * Minimal jsdom render harness. The repo has no @testing-library, so this
 * mounts into a detached container with `react-dom/client` and React's own
 * `act` — enough to drive real pointer/keyboard events at real components.
 */
export function createHarness(): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  // One root for the life of the harness: the container must stay attached to
  // the document, or events dispatched inside it never reach `window`.
  const root = createRoot(container)
  return {
    container,
    render: (element) => {
      act(() => {
        root.render(element)
      })
    },
    unmount: () => {
      act(() => {
        root.render(null)
      })
    },
  }
}

/** A `PointerEvent`-shaped event; jsdom has no `PointerEvent` constructor. */
export function pointerEvent(
  type: string,
  init: { pointerId?: number; clientX?: number; clientY?: number } = {},
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: init.pointerId ?? 1 })
  Object.defineProperty(event, 'clientX', { value: init.clientX ?? 0 })
  Object.defineProperty(event, 'clientY', { value: init.clientY ?? 0 })
  return event
}

/**
 * Set a controlled input's value the way a user would. React patches the
 * instance `value` property with a tracker, so a plain assignment is treated
 * as "no change" and never reaches `onChange` — the native prototype setter
 * has to be used instead.
 */
export function setNativeValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('no native value setter')
  setter.call(element, value)
}

/**
 * Make `<canvas>` answer, so a component that paints can mount under jsdom.
 *
 * jsdom has no 2D context and no `toDataURL`, and `src/render/backend.ts` builds a
 * real backend on mount — which throws and takes the whole tree with it. That is
 * why no page-level test used to open a workspace: the import screen was the only
 * part of the Editor unit tests could reach. The proxy returned here answers
 * `getImageData` and `measureText` with something and every other property with a
 * no-op, which is enough to mount and not enough to paint anything: no assertion
 * in this repo treats a canvas pixel from a unit test as evidence.
 */
export function stubCanvas(): void {
  const noop = () => undefined
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    const store: Record<string, unknown> = {}
    return new Proxy(store, {
      get(target, prop) {
        if (prop in target) return target[prop as string]
        if (prop === 'getImageData') {
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
        }
        if (prop === 'measureText') return () => ({ width: 0 })
        return noop
      },
      set(target, prop, value) {
        target[prop as string] = value
        return true
      },
    })
  } as unknown as HTMLCanvasElement['getContext']
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'
}

/** jsdom has no `ResizeObserver`, and the editor's layout effects ask for one. */
export function stubResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === 'function') return
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

/**
 * Answer `matchMedia` with `matches(query)`.
 *
 * jsdom implements none of it, and both pages ask: `Nav` reads the reduced-motion
 * and pointer queries, `Hub`'s reveal effect reads `prefers-reduced-motion`, and
 * `useAppearance` reads the colour-scheme one. A missing method is not a false
 * answer, it is a `TypeError` inside whichever effect ran first — and React
 * unmounts the whole tree when a render throws, so a page renders *nothing* and
 * the failure reads as "the component is empty" rather than "the environment is
 * missing an API".
 */
export function stubMatchMedia(matches: (query: string) => boolean = () => false): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches(query)
    },
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/**
 * Put both stores back the way a fresh page load would find them.
 *
 * The ui store's transient state is in this list because it is module state that
 * outlives the tree: `ToastStack` is rendered by `Editor` *unconditionally*, so it
 * is on the import screen as well as in the workspace, and a toast pushed by one
 * test is still in the store — and still in the container — for every test after
 * it. Nothing dismisses it, because `ToastStack` schedules its 3.2 s dismissal in
 * an effect and `harness.unmount()` clears that effect's timers on the way out.
 *
 * That is not hypothetical. `EditorImport.test.tsx > "report a sample that could
 * not be fetched"` fails about one run in three, with
 *
 *     expected <div class="_toast_…" role="status">
 *       A frame failed to render, so the preview is now using the slower renderer…
 *     </div> to be null
 *
 * because a frame from an *earlier* test in the same file — the render loop's rAF
 * is not awaited, so it runs after that test has finished and torn its world down
 * — threw, and `useRenderLoop` pushes that notice once per page load, which for a
 * test file means once for the file. `resetStores` reset three fields and left the
 * toast list alone, so the notice landed in whichever test ran next. Whether the
 * frame beat the unmount is a race the full suite's load decides, which is why it
 * passed in isolation every time.
 *
 * `errorLog` and `jobs` are here for the same reason: an error toast appends to
 * `errorLog` and writes it to `localStorage`, and a background-removal job is a
 * progress bar with a lifetime. Neither is document state, and neither survives a
 * reload.
 */
export function resetStores(): void {
  useDocStore.getState().load(createDoc())
  useUiStore.setState({
    activeTool: null,
    compareHeld: false,
    showHelp: false,
    toasts: [],
    errorLog: [],
    jobs: [],
  })
}
