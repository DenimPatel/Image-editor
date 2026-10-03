import { useEffect, useRef, useState } from 'react'
import { buildHistogram } from '../../lib/auto'
import { curveChannelFill } from '../../lib/curves'
import { croppedSize } from '../../model/selectors'
import { renderExportCanvas } from '../../render/exportCanvas'
import { useDocStore } from '../../store/docStore'
import styles from './tools.module.css'

const WIDTH = 256
const HEIGHT = 80

/** Which step of the pass gave up, so the sentence names the step. */
type Stage = 'render' | 'read' | 'draw'

type Failure = { stage: Stage; reason: string; hasGraph: boolean }

/**
 * Live RGB + luma histogram, rendered from a small proxy of the edit.
 *
 * ## Why it talks instead of swallowing
 *
 * This used to end in `catch {}` under the comment "Histogram is advisory". That
 * is true, and it is exactly why it was a defect: the histogram is the *only*
 * visual feedback in the Adjust panel, so every failure was a 400 ms blank
 * followed by a box that never filled in — indistinguishable from a panel that
 * had crashed, and unreportable because nothing said what happened.
 *
 * There is no partial histogram to fall back on, and that is a fact about the
 * pipeline rather than about this component: the graph is built out of pixels,
 * so a device that cannot render the edit cannot produce a truthful graph of it.
 * Each of the three substitutes is a different lie — the *source* image's
 * histogram, a flat baseline, or the previous graph left up without comment —
 * and a wrong graph is worse than a missing one in the one panel whose job is
 * saying where the tones are.
 *
 * So the degradation is: keep the last good drawing, and say directly beneath it
 * that it is out of date and what stopped the new one. Same shape as
 * `FiltersPanel`, which leaves the look in the document, un-highlights the chip
 * and writes "The look is not applied." An instrument that has lost lock still
 * shows its last reading, as long as it admits it. And the sentence is scoped to
 * the graph on purpose: it does not claim the photo on the canvas still updated,
 * because a lost WebGL context — the failure this most often reports — takes the
 * preview with it, and a status line that says otherwise is the next P0.
 */
export function Histogram({ source }: { source: ImageBitmap | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const revision = useDocStore((state) => state.revision)
  // `null` until a pass has actually failed, so the panel is silent while it is
  // working and honest the moment it is not. `hasGraph` is a ref rather than
  // state because it only ever moves once, false to true, and reading it must
  // not be a reason to re-render.
  const [failure, setFailure] = useState<Failure | null>(null)
  const drawnRef = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!source || !canvas) return
    let cancelled = false
    // The debounce can fire again long before a full-resolution export render
    // has finished, so each pass carries its own signal and the cleanup aborts
    // the one it replaced instead of leaving it to finish into the void.
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const doc = useDocStore.getState().present
        const base = croppedSize(doc)
        const width = 160
        const height = Math.max(1, Math.round((width * base.height) / base.width))
        const size = { width, height }
        const proxy = await renderExportCanvas(source, doc, size, { signal: controller.signal })
        if (cancelled || controller.signal.aborted) return
        const context = proxy.getContext('2d')
        if (!context) {
          setFailure({
            stage: 'read',
            reason: 'the browser gave the preview no canvas',
            hasGraph: drawnRef.current,
          })
          return
        }
        const data = context.getImageData(0, 0, proxy.width, proxy.height).data
        const histogram = buildHistogram(data)
        if (!drawHistogram(canvas, histogram)) {
          setFailure({
            stage: 'draw',
            reason: 'the browser gave the graph no canvas',
            hasGraph: drawnRef.current,
          })
          return
        }
        drawnRef.current = true
        setFailure(null)
      } catch (error) {
        // An abort is this pass being replaced by a newer one, not a failure:
        // the next pass owns the panel now and has not had its turn to fail.
        if (cancelled || controller.signal.aborted || isAbort(error)) return
        setFailure({ stage: 'render', reason: describeReason(error), hasGraph: drawnRef.current })
      }
    }, 400)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [source, revision])

  // With no source there is no preview to fail, so a message left over from
  // before would be describing a render that is no longer being attempted.
  const problem = source ? failure : null

  return (
    <div>
      <canvas
        ref={canvasRef}
        className={styles.histogram}
        width={WIDTH}
        height={HEIGHT}
        aria-hidden="true"
      />
      {problem && (
        // `role="status"`, not `role="alert"`: this is the panel reporting a
        // condition it may sit in for a while, the same as the look-failure line
        // in `FiltersPanel`, and it is not an emergency. The canvas is
        // `aria-hidden`, so without this a screen-reader user is told the panel
        // is fine and nothing else.
        <p role="status" className={styles.error}>
          {histogramProblem(problem)}
        </p>
      )}
    </div>
  )
}

/** The whole message, so the tests assert the promise and not just its prefix. */
function histogramProblem({ stage, reason, hasGraph }: Failure): string {
  const what =
    stage === 'read'
      ? 'the preview could not be read'
      : stage === 'draw'
        ? 'the graph could not be drawn'
        : 'the preview could not be drawn'
  const stale = hasGraph ? ' The graph above is from an earlier edit.' : ''
  return `Histogram ${hasGraph ? 'out of date' : 'unavailable'}: ${what} (${reason}).${stale}`
}

/** An abort is the normal path when a newer revision supersedes this pass. */
function isAbort(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
  )
}

/**
 * The engine's own words, trimmed to something a sentence can carry. Nothing is
 * inferred: when the only thing known is the exception, the exception is the
 * reason, and guessing a friendlier cause would be a second claim to get wrong.
 */
function describeReason(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (!message) return 'the render reported no reason'
  const first = message.split('\n')[0]
  return first.length > 140 ? `${first.slice(0, 137)}…` : first
}

function drawHistogram(
  canvas: HTMLCanvasElement,
  histogram: ReturnType<typeof buildHistogram>,
): boolean {
  const context = canvas.getContext('2d')
  if (!context) return false
  context.clearRect(0, 0, WIDTH, HEIGHT)
  // The washes go through the same table as the bands, and for the same reason:
  // this function used to spell five `rgba()` values inline, four of them the
  // exact members of `TONAL_CURVE_COLORS`, and the fifth the same white at a
  // lower alpha. One table cannot drift from itself.
  context.fillStyle = curveChannelFill('rgb', 0.04)
  context.fillRect(0, 0, WIDTH, HEIGHT)

  // The fills come from the app's one curve palette rather than from literals
  // spelled here, so the red band and the red curve cannot be two different reds
  // again. `curveChannelFill` returns the exact `rgba()` these were written as,
  // so this is a refactor and not a restyle. The background wash is not one of
  // them: it is the graph's own surface, not a channel's fill.
  const channels: { data: Uint32Array; color: string }[] = [
    { data: histogram.luma, color: curveChannelFill('rgb', 0.35) },
    { data: histogram.r, color: curveChannelFill('r', 0.5) },
    { data: histogram.g, color: curveChannelFill('g', 0.5) },
    { data: histogram.b, color: curveChannelFill('b', 0.5) },
  ]

  context.globalCompositeOperation = 'lighter'
  for (const { data, color } of channels) {
    const max = graphCeiling(data, histogram.total)
    context.fillStyle = color
    context.beginPath()
    context.moveTo(0, HEIGHT)
    for (let i = 0; i < 256; i += 1) {
      const value = Math.min(1, data[i] / max)
      context.lineTo((i / 255) * WIDTH, HEIGHT - value * HEIGHT)
    }
    context.lineTo(WIDTH, HEIGHT)
    context.closePath()
    context.fill()
  }
  context.globalCompositeOperation = 'source-over'
  return true
}

/**
 * How much of a bin's count is worth one full-height bar.
 *
 * The tallest bin is the wrong answer for any frame with a large flat area in
 * it. Sample 1 is exactly that frame: its blown, featureless sky holds 13,352 of
 * the proxy's 38,720 pixels at luma 245, and the next tallest bin holds 370.
 * Measuring every bin against that one put the entire tonal range inside the
 * bottom 3% of an 80px box, so the graph rendered as a flat block with a single
 * hairline down its right edge — a faithful picture of the data and useless as a
 * readout, because every other tone in the photograph was crushed into a 2px
 * sliver along the bottom.
 *
 * So the ceiling is the tallest bin that does not *dominate*. `PLATEAU_SHARE` of
 * the frame is what a flat area may hold before it counts as a plateau, and a
 * plateau is drawn clipped at the top rather than as the thing everything else is
 * measured against. The spike is still drawn, at full height, so nothing is
 * hidden and the shape stays honest; what changes is that the rest of the
 * distribution is legible again. A frame with no bin above the share — which is
 * almost every frame — is measured by its own tallest bin exactly as before.
 *
 * Bins 0 and 255 are left out, as they were before: the ends of the range are
 * where clipping lives, and a clipped pixel count is not a tone.
 */
const PLATEAU_SHARE = 0.02

function graphCeiling(counts: Uint32Array, total: number): number {
  const plateau = Math.max(1, total * PLATEAU_SHARE)
  let tallest = 0
  let ceiling = 0
  for (let i = 1; i < 255; i += 1) {
    const count = counts[i]
    if (count > tallest) tallest = count
    if (count > ceiling && count <= plateau) ceiling = count
  }
  // Every bin was a plateau — a two-tone frame, or a proxy that never drew.
  // There is no distribution to stretch, so fall back to the tallest bin, which
  // is what this always did.
  return Math.max(1, ceiling > 0 ? ceiling : tallest)
}
