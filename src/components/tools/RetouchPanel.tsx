import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { croppedSize } from '../../model/selectors'
import type { Doc, Point } from '../../model/types'
import { ExportAbortedError, renderExportCanvas } from '../../render/exportCanvas'
import {
  addHealSpot,
  addRedEye,
  clearRedEye,
  clearRetouch,
  removeHealSpot,
  removeRedEye,
  setRetouchSmooth,
} from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Slider } from '../controls/Slider'
import { EmptyState } from '../ui/EmptyState'
import styles from './retouchPanel.module.css'
import tools from './tools.module.css'

/**
 * D1-F13 — the panel that writes `doc.retouch`.
 *
 * The pass was here before the control was: `planPasses` has planned `retouch`,
 * `heal` and `redeye` since the kernel landed, both backends run them, and
 * `render/parity.test.ts` proves the two agree within 2/255. What did not exist
 * was a way to reach any of it, so the tab this panel hangs off used to open a
 * note saying so. A tab is a promise that a peer of Crop and Layers does
 * something to the photo, and an honest paragraph under an honest-looking
 * affordance is still a broken affordance: the first-time user cannot tell a
 * panel that is coming from a panel that is broken.
 *
 * ## Why the pad is a button
 *
 * A spot is a position on the photo, and the photo is on the canvas — which this
 * panel cannot claim, because `EditorCanvas` gives each tool its own gesture
 * branch and a capture listener on the document would have to re-derive the zoom
 * and pan to name a point. So the panel draws the crop itself, through the real
 * pipeline (`renderExportCanvas`), and that figure is the control: a click places
 * at the click, Enter places at the crosshair, and the two position sliders
 * move the crosshair. One control, one meaning, reachable both ways.
 *
 * It is the *crop*, not the whole photo, because `HealSpot.at` is normalized
 * whole-output space (`planPasses` runs the retouch passes after the geometry
 * warp, and the kernels read `v_uv` of the frame they are drawing). A pad that
 * showed the uncropped photo would place spots in the wrong space whenever a
 * crop was set, so the pad is the frame and the copy says so.
 */

/** What a click on the pad places. */
type Kind = 'heal' | 'redeye'

const KINDS: { value: Kind; label: string }[] = [
  { value: 'heal', label: 'Heal spot' },
  { value: 'redeye', label: 'Red-eye' },
]

/**
 * How many of each this panel will place at once.
 *
 * Every spot is a full-frame pass in both backends — `planPasses` emits one
 * `heal` pass per spot and one `redeye` pass per eye — so the count is a render
 * cost, not a data-model limit. Eight clones of a 24 MP photo on the Canvas2D
 * fallback is several hundred million pixel reads, and the cap is stated in the
 * panel rather than enforced silently, so a user who wants the ninth spot is
 * told what is in the way instead of watching a button stop working.
 */
const LIMITS: Record<Kind, number> = { heal: 8, redeye: 6 }

/** Spot radius in percent of the frame's width, which is the unit `retouchHalo` reads. */
const SIZE_MIN = 1
const SIZE_MAX = 20
const SIZE_DEFAULT = 4

/** The pad's proxy render, in pixels. A placement target, not a print. */
const PROXY_WIDTH = 480
const PREVIEW_DEBOUNCE_MS = 200

/**
 * The pad's height cap, and the width cap that goes with it.
 *
 * A pad as wide as the sheet is as tall as the crop's aspect asks — 500 px for a
 * 3:4 crop in a 380 px inspector, which put the position sliders and the Add
 * button under the fold. Capping the height alone crops the figure, because
 * `aspect-ratio` does not shrink a box that has a definite width; so the cap is
 * written twice, once as a height and once as that height in the crop's aspect,
 * and the two can only agree.
 */
const PAD_MAX_HEIGHT = 260

const clamp = (value: number) => Math.max(0, Math.min(100, value))

const isUntouched = (doc: Doc): boolean =>
  doc.retouch.smooth === 0 && doc.retouch.healSpots.length === 0 && doc.retouch.redEye.length === 0

export function RetouchPanel({ source }: { source: ImageBitmap | null }) {
  const retouch = useDocStore((state) => state.present.retouch)
  const revision = useDocStore((state) => state.revision)
  const untouched = useDocStore((state) => isUntouched(state.present))
  const aspect = useDocStore((state) => {
    const frame = croppedSize(state.present)
    return frame.width / frame.height
  })

  const [kind, setKind] = useState<Kind>('heal')
  const [size, setSize] = useState(SIZE_DEFAULT)
  const [across, setAcross] = useState(50)
  const [up, setUp] = useState(50)
  const [previewFailed, setPreviewFailed] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  /**
   * The pad is a render of the live document, so the edit a spot makes is visible
   * in the pad itself a moment after it is placed — at 480 px it is not a
   * substitute for the canvas, and it is not asked to be: the canvas is where
   * the photo is.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!source || !canvas) return
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const doc = useDocStore.getState().present
        const frame = croppedSize(doc)
        const proxySize = {
          width: PROXY_WIDTH,
          height: Math.max(1, Math.round((PROXY_WIDTH * frame.height) / frame.width)),
        }
        const proxy = await renderExportCanvas(source, doc, proxySize, {
          signal: controller.signal,
        })
        if (cancelled || controller.signal.aborted) return
        const context = canvas.getContext('2d')
        if (!context) {
          setPreviewFailed(true)
          return
        }
        canvas.width = proxy.width
        canvas.height = proxy.height
        context.drawImage(proxy, 0, 0)
        setPreviewFailed(false)
      } catch (error) {
        // A superseded pass is not a failure: the next one owns the pad now and
        // has not had its turn to fail.
        if (cancelled || controller.signal.aborted || error instanceof ExportAbortedError) return
        setPreviewFailed(true)
      }
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [source, revision])

  const place = (what: Kind, at: Point, radiusPercent: number) => {
    if (what === 'heal') addHealSpot(at, radiusPercent / 100)
    else addRedEye(at, radiusPercent / 100)
  }

  /**
   * One control, two ways in.
   *
   * A pointer activation places at the point that was pressed; a keyboard
   * activation places at the crosshair, which is the two sliders' value. The
   * browser tells them apart with `detail`: a `click` synthesised by Enter or
   * Space on a `<button>` has `detail === 0` and `clientX/clientY === 0`, so
   * reading the coordinates unconditionally put every keyboard-placed spot in
   * the top-left corner of the crop — a real defect this panel's own test found
   * by pressing Enter rather than by reading the code.
   *
   * A pointer press moves the crosshair first, so the sliders report where the
   * spot actually went rather than where the panel was before the tap; the two
   * disagreeing is how a spot ends up in the wrong place with every number on
   * screen agreeing it is in the right one.
   *
   * `onClick` and not `onPointerDown`: a pointerdown also fires for the first
   * millimetre of a drag, and the sheet is scrollable, so a flick to scroll the
   * panel past the pad would leave a spot behind.
   */
  const onPadClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      place(kind, { x: across / 100, y: up / 100 }, size)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    // A pad with no box has no photo in it to aim at, so there is nothing to
    // convert a coordinate against and the press is not an edit.
    if (rect.width === 0 || rect.height === 0) return
    const x = clamp(Math.round(((event.clientX - rect.left) / rect.width) * 100))
    const y = clamp(Math.round(((event.clientY - rect.top) / rect.height) * 100))
    setAcross(x)
    setUp(y)
    place(kind, { x: x / 100, y: y / 100 }, size)
  }

  const count = kind === 'heal' ? retouch.healSpots.length : retouch.redEye.length
  const full = count >= LIMITS[kind]
  const noun = kind === 'heal' ? 'heal spot' : 'red-eye mark'
  const pending: Point = { x: across / 100, y: up / 100 }

  return (
    <div>
      <p className={tools.sectionTitle}>Skin smoothing</p>
      <Slider
        label="Smoothing"
        value={retouch.smooth}
        min={0}
        max={100}
        unit="%"
        interactionKey="retouch:smooth"
        onChange={setRetouchSmooth}
      />
      <p className={tools.hint}>
        Softens skin texture across the whole photo. Edges and contrast stay where they were, and 0
        is off.
      </p>

      <p className={tools.sectionTitle}>Spots</p>
      <SegmentedControl
        ariaLabel="What a click on the crop places"
        options={KINDS}
        value={kind}
        onChange={setKind}
      />
      <Slider
        label="Size"
        value={size}
        min={SIZE_MIN}
        max={SIZE_MAX}
        unit="%"
        interactionKey="retouch:size"
        onChange={setSize}
      />
      <p className={tools.hint}>
        The diameter of the next {noun}, as a share of the photo&apos;s width. The circle on the
        crop is that size.
      </p>

      {!source ? (
        <EmptyState
          title="No photo yet"
          description="Smoothing and spots need a photo to work on. Open an image and this panel will place on it."
        />
      ) : (
        <>
          <button
            type="button"
            className={styles.pad}
            style={{
              aspectRatio: String(aspect),
              maxWidth: `calc(min(40vh, ${PAD_MAX_HEIGHT}px) * ${aspect})`,
            }}
            aria-label={`Place a ${noun} at ${across}% across, ${up}% up`}
            disabled={full}
            onClick={onPadClick}
          >
            <canvas
              ref={canvasRef}
              className={styles.padCanvas}
              width={PROXY_WIDTH}
              height={PROXY_WIDTH}
              aria-hidden="true"
            />
            {retouch.healSpots.map((spot) => (
              <span
                key={spot.id}
                aria-hidden="true"
                className={`${styles.spot} ${styles.spotHeal}`}
                style={{
                  left: `${spot.at.x * 100}%`,
                  top: `${spot.at.y * 100}%`,
                  width: `${spot.radius * 200}%`,
                }}
              />
            ))}
            {retouch.redEye.map((spot, index) => (
              <span
                key={`redeye-${index}`}
                aria-hidden="true"
                className={`${styles.spot} ${styles.spotRedEye}`}
                style={{
                  left: `${spot.at.x * 100}%`,
                  top: `${spot.at.y * 100}%`,
                  width: `${spot.radius * 200}%`,
                }}
              />
            ))}
            <span
              aria-hidden="true"
              className={styles.crosshair}
              style={{ left: `${across}%`, top: `${up}%` }}
            />
          </button>
          {previewFailed && (
            // `role="status"`, not `role="alert"`: a pad that could not be drawn
            // is a condition this panel may sit in, and the pad is the pointer
            // shortcut rather than the only route — the two sliders below place
            // the same spot, so a lost preview must say so rather than take the
            // feature with it.
            <p role="status" className={tools.hint}>
              The crop could not be drawn here, so there is nothing to aim at on screen. The
              position controls below place the same spot.
            </p>
          )}
          <div className={styles.positions}>
            <Slider
              label="Across"
              value={across}
              min={0}
              max={100}
              unit="%"
              interactionKey="retouch:across"
              onChange={setAcross}
            />
            <Slider
              label="Up"
              value={up}
              min={0}
              max={100}
              unit="%"
              interactionKey="retouch:up"
              onChange={setUp}
            />
          </div>
          {/*
           * Honest about what the pad is, and it used to be evasive about it. The
           * audit's reading — "a spot lands on the part of the photo the canvas is
           * showing" is a sentence that says nothing a reader can check — was
           * right, and so was the fix that followed it: a rectangle drawn on the
           * canvas over the crop, so the claim could be made about something on
           * screen. That rectangle is gone, because the canvas *is* the crop now —
           * the render loop lays the presentation out from `effectiveOutputSize`,
           * and a box drawn on the visible frame would be a decoration pretending
           * to be an explanation. So the sentence has to go back to naming the two
           * things that are actually there and are actually the same region, and
           * `e2e/journey.panel-seams.spec.ts` asserts the pad and the canvas agree
           * on their bytes, which is what makes the sentence checkable.
           *
           * `HealSpot.at` is whole-output space, so the pad has to render the crop
           * whatever the canvas is doing; this says so rather than implying the two
           * are the same image at all times.
           */}
          <p className={tools.hint}>
            The pad is the crop. The pad and the canvas are the same region, so a spot lands where
            you can see it.
          </p>
          {full && (
            <p role="status" className={tools.hint}>
              {LIMITS[kind]} {noun}
              {LIMITS[kind] === 1 ? '' : 's'} is the most this panel places at once — each one is a
              full pass over the photo. Remove one to place another.
            </p>
          )}

          {kind === 'heal' ? (
            retouch.healSpots.length === 0 ? (
              <EmptyState
                title="No heal spots"
                description="Click the crop, or set a position and use Add, to blend a blemish into the skin around it."
              />
            ) : (
              <ul className={tools.list}>
                {retouch.healSpots.map((spot, index) => (
                  <li key={spot.id} className={styles.spotRow}>
                    <span className={styles.spotFigures}>
                      Spot {index + 1} — {Math.round(spot.at.x * 100)}% across,{' '}
                      {Math.round(spot.at.y * 100)}% up, {Math.round(spot.radius * 100)}% size
                    </span>
                    <button
                      type="button"
                      className={tools.textButton}
                      onClick={() => removeHealSpot(spot.id)}
                    >
                      Remove spot {index + 1}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : retouch.redEye.length === 0 ? (
            <EmptyState
              title="No red-eye marks"
              description="Put a mark on an eye and the red in it is pulled out to the greys around it."
            />
          ) : (
            <ul className={tools.list}>
              {retouch.redEye.map((spot, index) => (
                <li key={`redeye-${index}`} className={styles.spotRow}>
                  <span className={styles.spotFigures}>
                    Mark {index + 1} — {Math.round(spot.at.x * 100)}% across,{' '}
                    {Math.round(spot.at.y * 100)}% up, {Math.round(spot.radius * 100)}% size
                  </span>
                  <button
                    type="button"
                    className={tools.textButton}
                    onClick={() => removeRedEye(index)}
                  >
                    Remove mark {index + 1}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={tools.buttonRow}>
            <button
              type="button"
              className={`${tools.textButton} ${tools.textButtonPrimary}`}
              disabled={full}
              onClick={() => place(kind, pending, size)}
            >
              Add {noun}
            </button>
            {kind === 'redeye' && retouch.redEye.length > 0 && (
              <button type="button" className={tools.textButton} onClick={() => clearRedEye()}>
                Remove all red-eye marks
              </button>
            )}
            <button
              type="button"
              className={tools.textButton}
              disabled={untouched}
              onClick={() => clearRetouch()}
            >
              Reset retouch
            </button>
          </div>
        </>
      )}
    </div>
  )
}
