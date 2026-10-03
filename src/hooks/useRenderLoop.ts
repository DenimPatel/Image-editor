import { useEffect, useState, type RefObject } from 'react'
import { loadCaps } from '../gl/caps'
import { recordDiagnostic, setDiagnosticEngine } from '../lib/diagnostics'
import { useFlagState } from '../lib/flags'
import { createDoc } from '../model/defaults'
import { assetStore } from '../model/assetsSingleton'
import { effectiveOutputSize } from '../model/selectors'
import type { Doc, Size } from '../model/types'
import { clearLayerSurfaceCache, drawLayers } from '../render/layers'
import {
  createBackend,
  enginePreferenceFromState,
  type EnginePreference,
} from '../render/selectBackend'
import type { RenderBackend } from '../render/backend'
import { getDoc, getRevision, useDocStore } from '../store/docStore'
import { useUiStore, type ToolId, type Viewport } from '../store/uiStore'
import { measureFrame, perfMonitor } from '../lib/perf'

export type RenderLoopResult = {
  canvas: HTMLCanvasElement | null
  engineKind: 'gl' | 'canvas2d'
}

const MIN_PROXY = 512
const MAX_PROXY = 2048

/**
 * What the user is told when a frame throws and the editor is left on the
 * unaccelerated renderer.
 *
 * This sentence replaces a bare `catch {}`. A frame that used to fail swapped
 * the whole editor onto Canvas2D with no word to anybody: the user got a slower
 * preview, and the reason existed in exactly one place, which is not a place a
 * user can reach. So the degradation now says three things — what happened, that
 * their work is unaffected, and what to do about it. It is worded as a
 * degradation rather than a failure because that is what it is: the editor is
 * still editing. An error chip for a working editor is how people learn to
 * ignore error chips.
 */
export const RENDER_FALLBACK_MESSAGE =
  'A frame failed to render, so the preview is now using the slower renderer. Your edits are unaffected and still save. Reload the page to try the faster renderer again.'

/**
 * One mention per page load, not one per frame.
 *
 * The failure is per-frame by nature — a broken pass throws on every repaint —
 * and a toast per frame would bury the editor under a wall of identical notices,
 * which makes the one that matters unmissable by being invisible. The *count* is
 * not thrown away: `recordDiagnostic` keeps a per-tag tally outside the ring, so
 * a report says how many frames failed and not merely that one did.
 */
let renderFallbackTold = false

/**
 * Test seam. The "once" latch is module state on purpose — a per-effect ref
 * would fire again every time the loop was rebuilt, which is a reload away —
 * and module state has to be rewindable for a test to say anything about it.
 */
export function resetRenderFallbackNotice(): void {
  renderFallbackTold = false
}

/**
 * How long to wait before rebuilding the backend after a context loss. The first
 * retry is 10 s and the wait then grows to 40 s, capped there: the renderer
 * rebuilds everything from scratch on restore, so a loss is recoverable and
 * there is no reason to give up on WebGL entirely.
 */
export function contextRetryDelay(attempt: number): number {
  return 5000 * Math.min(8, 1 + Math.max(0, attempt))
}

/**
 * Everything one frame is computed from, and the single reason the loop key and
 * the painted frame cannot disagree.
 *
 * It used to be four separate `useUiStore.getState()` reads scattered through
 * `renderOnce` and one more in the loop, and the loop key was a hand-written
 * list of six fields next to them. That is the whole defect: a frame's inputs
 * and the test for "has anything changed" were two independent transcriptions of
 * the same list, so the field that decides whether the preview shows the crop or
 * the whole frame could be in one and absent from the other. It was. Leaving the
 * Crop tool with a 1:1 crop set changed no document, so every field of the key
 * matched, `shouldRenderFrame` said no, and the canvas kept painting the
 * uncropped photo — its element, its pixels and all — until a window resize
 * changed `containerSize` and forced the frame nobody had asked for.
 *
 * So the two are now derived from the same object literal in the same tick, and
 * `renderOnce` reads no store of its own.
 */
export type FrameInputs = {
  revision: number
  compareHeld: boolean
  /** The Crop tool is open, so this frame shows the whole frame, not the crop. */
  editingCrop: boolean
  viewport: Viewport
  containerSize: Size
  /** The backing-store scale. `computeProxySize` is a function of it. */
  dpr: number
}

/**
 * Whether the frame shows the whole frame rather than the crop.
 *
 * The crop lives in the document, so it is in the key by way of `revision`
 * already. What is not in the document is *whether the crop is being edited*:
 * while the Crop tool is open the preview deliberately drops the crop so the box
 * the user is dragging has the pixels it discards around it, and that is a
 * difference in what a frame *is*, not in what the document says.
 */
export function isEditingCrop(activeTool: ToolId | null): boolean {
  return activeTool === 'crop'
}

/**
 * What the rAF loop compares frame to frame. A container resize is part of this
 * on purpose: the ResizeObserver only sets `dirty`, and without the size in
 * here a pure resize never re-ran `applyLayout`, so the canvas kept the fit it
 * had at the old container size. Every field is `frameKey` reading one field of
 * `FrameInputs`, which is what keeps the list honest.
 */
export type LoopKey = {
  revision: number
  compareHeld: boolean
  editingCrop: boolean
  viewportScale: number
  viewportX: number
  viewportY: number
  size: string
  dpr: number
}

export function sizeKey(size: Size): string {
  return `${size.width}x${size.height}`
}

export function frameKey(inputs: FrameInputs): LoopKey {
  return {
    revision: inputs.revision,
    compareHeld: inputs.compareHeld,
    editingCrop: inputs.editingCrop,
    viewportScale: inputs.viewport.scale,
    viewportX: inputs.viewport.x,
    viewportY: inputs.viewport.y,
    size: sizeKey(inputs.containerSize),
    dpr: inputs.dpr,
  }
}

export function shouldRenderFrame(previous: LoopKey, next: LoopKey): boolean {
  return (
    previous.revision !== next.revision ||
    previous.compareHeld !== next.compareHeld ||
    previous.editingCrop !== next.editingCrop ||
    previous.viewportScale !== next.viewportScale ||
    previous.viewportX !== next.viewportX ||
    previous.viewportY !== next.viewportY ||
    previous.size !== next.size ||
    previous.dpr !== next.dpr
  )
}

const compositorAssets = {
  get: (id: string) =>
    assetStore.get(id) as (CanvasImageSource & { width: number; height: number }) | undefined,
}

function computeProxySize(output: Size, display: Size, dpr: number): Size {
  const longEdgeRaw = Math.max(display.width, display.height) * dpr * 2
  const longEdge = Math.min(MAX_PROXY, Math.max(MIN_PROXY, longEdgeRaw))
  const aspect = output.width / Math.max(1, output.height)
  if (aspect >= 1) {
    return { width: Math.round(longEdge), height: Math.max(1, Math.round(longEdge / aspect)) }
  }
  return { width: Math.max(1, Math.round(longEdge * aspect)), height: Math.round(longEdge) }
}

/**
 * Owns the render backend, the rAF loop and a 2D presentation canvas. The
 * backend renders the photo pipeline; layers are composited on top on the
 * presentation canvas, which is the single DOM element the user sees. That
 * keeps layer compositing identical between engines and lets a backend swap
 * (context loss) go unnoticed.
 */
/* eslint-disable react-hooks/set-state-in-effect -- this effect creates and
   owns external resources (canvas + backend) and must publish them to React. */
export function useRenderLoop(
  containerRef: RefObject<HTMLElement | null>,
  source: ImageBitmap | null,
  preference?: EnginePreference,
): RenderLoopResult {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [engineKind, setEngineKind] = useState<'gl' | 'canvas2d'>('canvas2d')
  /**
   * The engine pin, read from the flag store rather than from the URL once at
   * mount. Subscribing is what makes a mid-session change take effect without a
   * reload: `enginePreference` is a dependency of the effect below, so flipping
   * the flag re-runs it and the backend is rebuilt on the spot. `default` maps
   * to `auto`, which is what a build with no flag has always done.
   */
  const engineFlag = useFlagState('engine')
  const enginePreference = preference ?? enginePreferenceFromState(engineFlag)

  useEffect(() => {
    const container = containerRef.current
    if (!container || !source) return

    const caps = loadCaps()
    let backend: RenderBackend = createBackend(enginePreference, caps)
    setEngineKind(backend.kind)
    // The engine label the next report carries. A frame-time number without it
    // is ambiguous between the WebGL2 path and the Canvas2D fallback, and those
    // two are not remotely the same cost.
    perfMonitor.setEngine(backend.kind)
    setDiagnosticEngine(backend.kind)

    const presentation = document.createElement('canvas')
    presentation.className = 'ie-canvas-el'
    const presentCtx = presentation.getContext('2d')
    if (!presentCtx) return
    container.appendChild(presentation)
    setCanvas(presentation)

    let dirty = true
    let raf = 0
    let disposed = false
    let containerSize: Size = {
      width: container.clientWidth || 320,
      height: container.clientHeight || 320,
    }
    let lastFrame: LoopKey = {
      revision: -1,
      compareHeld: false,
      editingCrop: false,
      viewportScale: 1,
      viewportX: 0,
      viewportY: 0,
      size: '',
      dpr: 0,
    }
    let lossAttempts = 0
    let lossTimer = 0

    const schedule = () => {
      dirty = true
    }

    /**
     * `schedule` for a frame whose *content* changed without the document
     * changing - a LUT texture that finished loading, say. The rAF loop skips a
     * frame whose `LoopKey` matches the last one, and the key is derived from
     * the document revision, so a purely asynchronous change has to invalidate
     * the key as well as the flag or it is dropped on the floor.
     */
    const invalidate = () => {
      dirty = true
      lastFrame.revision = -1
    }

    /**
     * One place that replaces the backend, so the `webglcontextlost` listener
     * always leaves the canvas it was added to and the replaced backend is
     * always disposed. Doing either by hand at a call site is how the old code
     * ended up removing a listener from a canvas it had never been added to.
     *
     * A replacement also has to invalidate the frame key, and that is not
     * cosmetic. A new backend has drawn nothing, but the document revision, the
     * viewport and the container size are all unchanged, so `shouldRenderFrame`
     * compares equal to the frame that was painted by the *previous* backend and
     * skips it. `dirty = true` at the call site is not enough: the loop sets
     * `dirty = false` again on the frame it declines to draw. The preview then
     * keeps showing the last frame the lost context produced and nothing repaints
     * it until some unrelated edit bumps the revision — which is why the restore
     * path looked fine in every unit test and was not: `e2e/journey.context-loss
     * .spec.ts` drives a real loss and fails without this line.
     */
    const swapBackend = (next: RenderBackend) => {
      backend.canvas.removeEventListener('webglcontextlost', onLost)
      backend.dispose()
      backend = next
      if (next.kind === 'gl') next.canvas.addEventListener('webglcontextlost', onLost)
      setEngineKind(next.kind)
      perfMonitor.setEngine(next.kind)
      // The engine in use is one of the few facts a support conversation cannot
      // get any other way, and it changes here rather than only at mount.
      setDiagnosticEngine(next.kind)
      invalidate()
    }

    const onLost = () => {
      lossAttempts += 1
      window.clearTimeout(lossTimer)
      lossTimer = window.setTimeout(() => {
        if (disposed) return
        swapBackend(createBackend(enginePreference, caps))
        dirty = true
      }, contextRetryDelay(lossAttempts))
    }
    if (backend.kind === 'gl') backend.canvas.addEventListener('webglcontextlost', onLost)

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        containerSize = { width: rect.width, height: rect.height }
        dirty = true
      }
    })
    resizeObserver.observe(container)

    const unsubscribeDoc = useDocStore.subscribe(schedule)
    const unsubscribeUi = useUiStore.subscribe(schedule)

    const applyLayout = (output: Size, viewport: Viewport) => {
      const availableW = Math.max(1, containerSize.width - 32)
      const availableH = Math.max(1, containerSize.height - 32)
      const fit = Math.min(availableW / output.width, availableH / output.height)
      const displayW = Math.max(1, output.width * fit)
      const displayH = Math.max(1, output.height * fit)
      presentation.style.width = `${displayW}px`
      presentation.style.height = `${displayH}px`
      presentation.style.transform = `translate(-50%, -50%) translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
      return { width: displayW, height: displayH }
    }

    /**
     * Paints one frame from `inputs` and from nothing else.
     *
     * The absence of `useUiStore.getState()` here is the fix, not a style note:
     * the loop below tests `frameKey(inputs)` for "did anything change", so a
     * store read inside this function would be an input the test cannot see, and
     * the two disagreeing is what left a set crop sitting on an uncropped canvas
     * until a window resize happened to run a frame anyway.
     */
    const renderOnce = (inputs: FrameInputs) => {
      const doc = getDoc()
      const { compareHeld, editingCrop, viewport, dpr } = inputs
      let activeDoc: Doc = compareHeld ? createDoc({ source: doc.source, output: doc.output }) : doc
      if (editingCrop) {
        activeDoc = {
          ...activeDoc,
          geometry: { ...activeDoc.geometry, crop: { x: 0, y: 0, width: 1, height: 1 } },
        }
      }
      const output = effectiveOutputSize(activeDoc)
      const display = applyLayout(output, viewport)
      const proxy = computeProxySize(output, display, dpr)

      backend.render({
        source,
        sourceSize: { width: source.width, height: source.height },
        doc: activeDoc,
        size: proxy,
      })

      if (presentation.width !== proxy.width || presentation.height !== proxy.height) {
        presentation.width = proxy.width
        presentation.height = proxy.height
      }
      presentCtx.setTransform(1, 0, 0, 1, 0, 0)
      presentCtx.clearRect(0, 0, proxy.width, proxy.height)
      presentCtx.drawImage(backend.canvas, 0, 0, proxy.width, proxy.height)
      if (!compareHeld && activeDoc.layers.length > 0) {
        drawLayers(presentCtx, activeDoc, { size: proxy, assets: compositorAssets })
      }
    }

    const loop = () => {
      raf = window.requestAnimationFrame(loop)
      if (!dirty) return
      const ui = useUiStore.getState()
      // One snapshot, one object: the key and the frame are two readings of the
      // same values, taken in the same tick, so there is no window in which the
      // two could be describing different frames.
      const inputs: FrameInputs = {
        revision: getRevision(),
        compareHeld: ui.compareHeld,
        editingCrop: isEditingCrop(ui.activeTool),
        viewport: ui.viewport,
        containerSize,
        dpr: Math.min(2, window.devicePixelRatio || 1),
      }
      const next = frameKey(inputs)
      if (!shouldRenderFrame(lastFrame, next)) {
        dirty = false
        return
      }
      lastFrame = next
      dirty = false
      try {
        // The one place a frame is measured, and the only one that should be.
        // `measureFrame` records in a `finally`, so a frame that throws and
        // falls back to Canvas2D below is still counted — the cost of a failing
        // render is exactly the cost worth knowing about.
        measureFrame(() => renderOnce(inputs))
      } catch (error) {
        // The frame failed, so the editor is going to keep rendering on the
        // unaccelerated path whether or not it was already there. Both branches
        // used to be a bare `catch {}` with a silent swap, and both are now
        // recorded and, once, announced.
        recordDiagnostic({
          level: 'warn',
          tag: 'render.fallback',
          message: 'A preview frame threw; the editor fell back to the unaccelerated renderer.',
          error,
        })
        if (backend.kind === 'gl') {
          swapBackend(createBackend('canvas2d', caps))
          dirty = true
        }
        if (!renderFallbackTold) {
          renderFallbackTold = true
          // `info`, not `error`: this is a degradation, the editor is still
          // editing, and an error-severity toast for a working editor trains
          // people to dismiss error-severity toasts — which is the reaction
          // that loses the storage-full message a second later.
          useUiStore.getState().pushToast(RENDER_FALLBACK_MESSAGE, 'info')
        }
      }
    }

    const lookId = getDoc().look.id
    if (lookId && backend.kind === 'gl') {
      const gl = backend as RenderBackend & { prepare?: (doc: Doc) => Promise<void> }
      // A failed LUT load used to be silent: the look chip stayed highlighted and
      // nothing was applied, with no indication that anything had gone wrong.
      void gl
        .prepare?.(getDoc())
        .then(invalidate)
        .catch(() => {
          const id = getDoc().look.id
          if (!id) return
          useUiStore
            .getState()
            .pushToast(`The "${id}" look could not be loaded, so it is not applied.`, 'error')
        })
    }

    /**
     * `LUT3D_FRAG` is skipped while no texture is resident, so a look picked
     * after this effect last ran rendered nothing at all: all 24 chips were
     * live, selectable, and changed not one pixel. `prepare` is asynchronous -
     * the strip is a PNG off the network - so the pick lands first, the texture
     * follows, and the frame that carries it has to be *asked for*: nothing else
     * dirties the loop, and an unchanged `LoopKey` costs nothing.
     */
    const unsubscribeLook = useDocStore.subscribe((state) => {
      const id = state.present.look.id
      if (!id || backend.kind !== 'gl') return
      const gl = backend as RenderBackend & { prepare?: (doc: Doc) => Promise<void> }
      void gl
        .prepare?.(getDoc())
        .then(invalidate)
        .catch(() => {
          useUiStore
            .getState()
            .pushToast(`The "${id}" look could not be loaded, so it is not applied.`, 'error')
        })
    })

    dirty = true
    raf = window.requestAnimationFrame(loop)
    // A new loop starts a new measurement window, and the teardown below ends
    // it. Without this the samples of a discarded photo would still be in the
    // rings when the next one opened, and a report would describe two images.
    perfMonitor.reset()

    return () => {
      disposed = true
      window.cancelAnimationFrame(raf)
      window.clearTimeout(lossTimer)
      resizeObserver.disconnect()
      unsubscribeDoc()
      unsubscribeUi()
      unsubscribeLook()
      // A torn-down loop has to take the long-task observer with it, or it keeps
      // the browser delivering entries to a render loop that no longer exists.
      perfMonitor.reset()
      backend.canvas.removeEventListener('webglcontextlost', onLost)
      backend.dispose()
      // The redaction/eraser scratch surfaces are keyed by content and live for
      // the life of the process, so a torn-down loop would leave its canvases
      // resident forever.
      clearLayerSurfaceCache()
      presentation.remove()
    }
  }, [source, containerRef, enginePreference])

  return { canvas, engineKind }
}
