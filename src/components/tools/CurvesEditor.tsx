import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TONAL_CURVE_COLORS, buildCurveLut } from '../../lib/curves'
import type { CurveChannel, CurvePoint } from '../../model/types'
import { setCurveChannel } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { nextRovingIndex } from '../ui/rovingTabindex'
import styles from './adjust.module.css'
import toolStyles from './tools.module.css'

const SIZE = 260
/**
 * The graph is drawn in a viewBox larger than the 0..255 plot, so a 9px handle
 * and its focus ring at the very corners are not clipped in half by the edge of
 * the SVG. Without it the two end points — the ones a curve edit is almost
 * always about — render as semicircles.
 */
const PAD = 18
const VIEW = SIZE + PAD * 2

/** Coarse step for the coarse keys: one press of the plain arrow is 1/255. */
const NUDGE = 1
const NUDGE_COARSE = 10

const CHANNELS: CurveChannel[] = ['rgb', 'r', 'g', 'b']

const CHANNEL_NAME: Record<CurveChannel, string> = {
  rgb: 'All channels',
  r: 'Red',
  g: 'Green',
  b: 'Blue',
}

/**
 * The chip text is the full channel name, not `R`/`G`/`B`.
 *
 * The letters were doing no work: a first-time user cannot tell what `R` is, and
 * in a panel whose whole job is making colour and tone legible, a one-letter
 * label is the opposite. `RGB` stays as the three letters because it is a name.
 */
const CHANNEL_LABEL: Record<CurveChannel, string> = {
  rgb: 'RGB',
  r: 'Red',
  g: 'Green',
  b: 'Blue',
}

/**
 * How far back an unselected channel is drawn.
 *
 * The colour is the first channel of the signal and it is not the only one: an
 * inactive line is thinner *and* fainter, so the pair survives a greyscale
 * print, a colour-blind reader, and forced-colors mode, where the channel
 * colours are replaced by system colours and hue stops distinguishing anything
 * at all. `aria-pressed` on the chip is the third channel and is the only one
 * that survives all three.
 */
const ACTIVE_WIDTH = 3
const ACTIVE_OPACITY = 1
const INACTIVE_WIDTH = 1.5
const INACTIVE_OPACITY = 0.38

function sortPoints(points: CurvePoint[]): CurvePoint[] {
  return [...points].sort((a, b) => a.x - b.x)
}

/** Plot coordinates (0..255, y up) to SVG user units. */
function toSvgX(value: number): number {
  return PAD + (value / 255) * SIZE
}
function toSvgY(value: number): number {
  return PAD + SIZE - (value / 255) * SIZE
}

export function CurvesEditor() {
  const curves = useDocStore((state) => state.present.curves)
  const [channel, setChannel] = useState<CurveChannel>('rgb')
  const svgRef = useRef<SVGSVGElement>(null)
  const pointRefs = useRef<(SVGCircleElement | null)[]>([])
  /** Roving tabindex for the channel chips: one tab stop, arrows move it. */
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const dragging = useRef<number | null>(null)
  /**
   * Which element inside the graph holds focus, so the ring is drawn in SVG
   * rather than left to a UA `:focus-visible` outline that Chromium and WebKit
   * paint differently on a `<circle>`.
   */
  const [focused, setFocused] = useState<'graph' | number | null>(null)
  /**
   * Set when a point has just been created, so the effect below can move focus
   * onto it. `requestAnimationFrame` was tried first and lost the race in
   * WebKit: the key press that created the point could be followed immediately
   * by another key press, which then went to `<body>` instead of to the point.
   */
  const pendingFocus = useRef<number | null>(null)
  const points = curves[channel]
  /**
   * All four curves, not just the selected one.
   *
   * This used to draw one `<path>` — the selected channel's — so the graph was
   * a line you edit rather than a picture of the edit. The composite RGB curve
   * is applied to all three channels *before* the per-channel ones, so seeing it
   * beside them is the only way to tell "this curve moved" from "the photo got
   * darker": with one line at a time, switching channels told you a channel had
   * changed and nothing about how it related to the others.
   */
  const paths = useMemo(() => {
    const built: Record<CurveChannel, string> = {
      rgb: '',
      r: '',
      g: '',
      b: '',
    }
    for (const candidate of CHANNELS) {
      const lut = buildCurveLut(curves[candidate])
      built[candidate] = Array.from(lut)
        .map(
          (value, x) => `${x === 0 ? 'M' : 'L'}${toSvgX(x).toFixed(2)},${toSvgY(value).toFixed(2)}`,
        )
        .join(' ')
    }
    return built
  }, [curves])
  const path = paths[channel]

  // One curve drag is one undo step. The span is closed on every exit path and
  // on unmount, because a leaked span makes the whole editor's history
  // collapse into a single step.
  const endDrag = useCallback(() => {
    if (dragging.current === null) return
    dragging.current = null
    useDocStore.getState().endInteraction()
  }, [])

  const startDrag = useCallback((index: number) => {
    dragging.current = index
    useDocStore.getState().beginInteraction('curves:point')
  }, [])

  // Switching tools mid-drag unmounts this panel, and the span has to close
  // with it or every later edit is swallowed into one undo step.
  useEffect(() => () => endDrag(), [endDrag])

  useEffect(() => {
    const onWindowBlur = () => endDrag()
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [endDrag])

  // The new point's circle only exists after the store write has committed, so
  // the focus move has to happen from an effect rather than inline.
  useEffect(() => {
    const index = pendingFocus.current
    if (index === null) return
    if (index === -1) {
      // The point was removed: the graph is the only element left, and dropping
      // focus to <body> would restart the tab run from the top of the document.
      if (points.length < 2) return
      pendingFocus.current = null
      svgRef.current?.focus()
      return
    }
    if (!pointRefs.current[index]) return
    pendingFocus.current = null
    pointRefs.current[index]?.focus()
  }, [points])

  const positionFromEvent = (event: React.PointerEvent): CurvePoint => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return { x: 128, y: 128 }
    // The event maps onto the padded viewBox, not onto the 0..255 plot.
    const scale = VIEW / rect.width
    return {
      x: Math.round(((event.clientX - rect.left) * scale - PAD) * (255 / SIZE)),
      y: Math.round(255 - ((event.clientY - rect.top) * scale - PAD) * (255 / SIZE)),
    }
  }

  const updatePoint = (index: number, point: CurvePoint) => {
    const clamped: CurvePoint = {
      x: Math.max(0, Math.min(255, point.x)),
      y: Math.max(0, Math.min(255, point.y)),
    }
    if (index === 0) clamped.x = 0
    if (index === points.length - 1) clamped.x = 255
    const next = sortPoints(points.map((existing, i) => (i === index ? clamped : existing)))
    setCurveChannel(channel, next)
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragging.current === null) return
    const point = positionFromEvent(event)
    const index = dragging.current
    const cloned = [...points]
    const previous = cloned[index - 1]
    const following = cloned[index + 1]
    if (previous) point.x = Math.max(previous.x + 1, point.x)
    if (following) point.x = Math.min(following.x - 1, point.x)
    updatePoint(index, point)
  }

  const removePoint = (index: number) => {
    if (index === 0 || index === points.length - 1) return false
    setCurveChannel(
      channel,
      points.filter((_, candidate) => candidate !== index),
    )
    return true
  }

  const addPointAt = (point: CurvePoint) => {
    const clamped: CurvePoint = {
      x: Math.max(0, Math.min(255, point.x)),
      y: Math.max(0, Math.min(255, point.y)),
    }
    const next = sortPoints([...points, clamped])
    setCurveChannel(channel, next)
    return next.findIndex((candidate) => candidate === clamped)
  }

  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const point = positionFromEvent(event as unknown as React.PointerEvent)
    const existing = points.findIndex(
      (candidate) => Math.abs(candidate.x - point.x) < 8 && Math.abs(candidate.y - point.y) < 8,
    )
    if (existing !== -1) {
      removePoint(existing)
      return
    }
    addPointAt(point)
  }

  /**
   * D8-F10 — the keyboard half of the graph.
   *
   * Each point is a focusable button whose `aria-label` carries both axes, so a
   * screen reader announces where the point is without the graph having to
   * pretend it is a two-dimensional slider. Every press is one undo step: the
   * key repeat of a held arrow key would otherwise collapse into a single
   * history entry, which is the one thing an undo stack must never do.
   */
  const handlePointKeyDown = (event: React.KeyboardEvent<SVGCircleElement>, index: number) => {
    const step = event.shiftKey ? NUDGE_COARSE : NUDGE
    const current = points[index]
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
      removePoint(index)
      // Focus has nowhere to go on the removed point; the graph is the only
      // element left, and dropping it to <body> would restart the tab run.
      pendingFocus.current = -1
      return
    }
    const delta: Record<string, CurvePoint> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    // `stopPropagation` is not optional here. `useKeyboardShortcuts` listens on
    // `window` in the bubble phase and binds `Enter` to "close the tool", so a
    // handled key that is only `preventDefault`-ed still reaches that handler
    // and closes the panel out from under the edit.
    event.stopPropagation()
    const clamped = {
      x: Math.max(0, Math.min(255, current.x + move.x)),
      y: Math.max(0, Math.min(255, current.y + move.y)),
    }
    if (clamped.x === current.x && clamped.y === current.y) return
    useDocStore.getState().beginInteraction('curves:point')
    updatePoint(index, clamped)
    useDocStore.getState().endInteraction()
  }

  /** Enter on the graph itself adds a point in the middle and focuses it. */
  const handleGraphKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    pendingFocus.current = addPointAt({ x: 128, y: 128 })
  }

  return (
    <div>
      {/*
        The channel picker, hand-built rather than a `SegmentedControl`,
        because a segmented control can only print a label and the label is no
        longer enough: each chip now carries a dot in the colour it draws. The
        dots are `aria-hidden`, so the chip's accessible name is still its own
        channel name, and `aria-pressed` still says which one is selected — the
        three signals together are the legend, which is why there is no separate
        legend below.
      */}
      <div
        className={styles.channelChips}
        role="group"
        aria-label="Curve channel"
        onKeyDown={(event) => {
          const index = CHANNELS.indexOf(channel)
          const next = nextRovingIndex(event.key, index, CHANNELS.length)
          if (next === null) return
          event.preventDefault()
          const target = CHANNELS[next]
          setChannel(target)
          chipRefs.current[next]?.focus()
        }}
      >
        {CHANNELS.map((candidate, index) => (
          <button
            key={candidate}
            ref={(node) => {
              chipRefs.current[index] = node
            }}
            type="button"
            className={`${styles.channelChip}${candidate === channel ? ` ${styles.channelChipActive}` : ''}`}
            aria-pressed={candidate === channel}
            tabIndex={candidate === channel ? 0 : -1}
            onClick={() => setChannel(candidate)}
          >
            <span
              className={styles.channelDot}
              style={{ background: TONAL_CURVE_COLORS[candidate] }}
              aria-hidden="true"
            />
            {CHANNEL_LABEL[candidate]}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className={toolStyles.curves}
        viewBox={`${-PAD} ${-PAD} ${VIEW} ${VIEW}`}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onPointerLeave={endDrag}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleGraphKeyDown}
        // React's `onFocus` is the native `focusin`, which bubbles: with a
        // plain handler this fired for every point too and overwrote the index
        // the point's own `onFocus` had just set, so `focused` settled on
        // 'graph' and the point's ring — the *only* focus indicator, since
        // `.curvePoint:focus-visible` has its outline removed — never rendered.
        // A keyboard user could move a point blind. The container only claims
        // focus when the container is what actually took it.
        onFocus={(event) => {
          if (event.target === event.currentTarget) setFocused('graph')
        }}
        onBlur={(event) => {
          if (event.target === event.currentTarget) setFocused(null)
        }}
        // `role="application"` used to sit here with no `tabIndex` and no key
        // handler anywhere in the file: it told assistive tech to stop reading
        // the page while binding nothing, and the graph itself was unreachable.
        // A labelled `group` describes the container and leaves the points to
        // announce themselves.
        role="group"
        tabIndex={0}
        aria-label={`${CHANNEL_NAME[channel]} curves. Press Enter to add a point, then Tab to the points and use the arrow keys to shape the curve.`}
      >
        <rect x={PAD} y={PAD} width={SIZE} height={SIZE} fill="rgba(255,255,255,0.04)" />
        {[0.25, 0.5, 0.75].map((fraction) => (
          <g key={fraction}>
            <line
              x1={toSvgX(255 * fraction)}
              y1={PAD}
              x2={toSvgX(255 * fraction)}
              y2={PAD + SIZE}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
            <line
              x1={PAD}
              y1={toSvgY(255 * fraction)}
              x2={PAD + SIZE}
              y2={toSvgY(255 * fraction)}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
          </g>
        ))}
        {/* Inactive channels first, so the selected one is painted over them
            rather than under: two curves overlap exactly on an untouched
            document, and z-order is the difference between "one line" and "four". */}
        {CHANNELS.filter((candidate) => candidate !== channel).map((candidate) => (
          <path
            key={candidate}
            data-curve-channel={candidate}
            data-curve-active="false"
            d={paths[candidate]}
            fill="none"
            stroke={TONAL_CURVE_COLORS[candidate]}
            strokeWidth={INACTIVE_WIDTH}
            strokeOpacity={INACTIVE_OPACITY}
          />
        ))}
        <path
          data-curve-channel={channel}
          data-curve-active="true"
          d={path}
          fill="none"
          stroke={TONAL_CURVE_COLORS[channel]}
          strokeWidth={ACTIVE_WIDTH}
          strokeOpacity={ACTIVE_OPACITY}
        />
        {points.map((point, index) => {
          const removable = index !== 0 && index !== points.length - 1
          const isFocused = focused === index
          return (
            // Keyed by index, not by `point.x`: a key that changes when the
            // point moves makes React unmount and remount the circle on every
            // arrow key, which silently throws focus back to <body> after the
            // first nudge. The doc has no per-point id, and a sorted list is
            // positional by construction, so the index is the honest identity.
            <g key={index}>
              {isFocused && (
                <circle
                  className={toolStyles.curveFocusRing}
                  data-focus-ring=""
                  cx={toSvgX(point.x)}
                  cy={toSvgY(point.y)}
                  r={15}
                  fill="none"
                  stroke={TONAL_CURVE_COLORS[channel]}
                  strokeWidth="2"
                  strokeDasharray="3 3"
                  aria-hidden="true"
                />
              )}
              <circle
                ref={(node) => {
                  pointRefs.current[index] = node
                }}
                className={toolStyles.curvePoint}
                cx={toSvgX(point.x)}
                cy={toSvgY(point.y)}
                r={9}
                fill="#121214"
                stroke={TONAL_CURVE_COLORS[channel]}
                strokeWidth="2"
                style={{ cursor: 'grab', touchAction: 'none' }}
                role="button"
                tabIndex={0}
                aria-label={`${CHANNEL_NAME[channel]} curve point ${index + 1} of ${points.length}: input ${point.x}, output ${point.y}.${removable ? ' Delete to remove it.' : ''}`}
                onFocus={() => setFocused(index)}
                onBlur={() => setFocused(null)}
                onKeyDown={(event) => handlePointKeyDown(event, index)}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  ;(event.target as Element).setPointerCapture?.(event.pointerId)
                  startDrag(index)
                }}
              />
            </g>
          )
        })}
      </svg>
      {/*
        "Double-tap" was the word on both a phone and a desktop, where the
        gesture is a double-click; and the two halves read as one long sentence
        with the gesture buried in it. Now: what each channel means, then what
        the pointer does, then what the keyboard does.
      */}
      <p className={toolStyles.hint}>
        RGB is the composite curve: it moves all three channels at once, before the Red, Green and
        Blue curves are applied. Each curve is drawn in the colour of its chip, and the selected one
        is the thick one. Double-click the graph to add a point, drag a point to shape the curve,
        double-click a point to remove it. With a keyboard: Tab to the graph and press Enter to add
        a point, Tab on to the points, arrow keys to nudge (hold Shift for bigger steps), Delete to
        remove.
      </p>
    </div>
  )
}
