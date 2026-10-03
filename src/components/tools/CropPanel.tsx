import { useState } from 'react'
import { UNLOCKED, RatioChipRow, proportionChip, type RatioChipOption } from '../controls/RatioChip'
import { StraightenDial } from '../controls/StraightenDial'
import { IconButton } from '../controls/IconButton'
import {
  FillFrameGlyph,
  FlipHorizontalGlyph,
  RotateLeftGlyph,
  RotateRightGlyph,
  SwapRatioGlyph,
} from '../ui/icons'
import {
  ASPECT_PRESETS,
  PRINT_SIZES,
  aspectForCustomRatio,
  isRatio,
  platformShapeRows,
  printSizeMm,
  type PlatformShapeRow,
  type PrintSize,
} from '../../lib/crop/presets'
import { constrainToAspect, cropFrameSize, fillFrameCrop } from '../../lib/crop/geometry'
import { cropPixelReadout } from '../../lib/crop/readout'
import {
  rotateBy,
  setAspectLock,
  setCrop,
  setOutput,
  setStraighten,
  toggleFlipH,
} from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore, type SafeAreaPreset } from '../../store/uiStore'
import styles from './tools.module.css'

const FULL = { x: 0, y: 0, width: 1, height: 1 }
const RATIO_ERROR_ID = 'crop-custom-ratio-error'

function safeAreaFor(id: string): SafeAreaPreset {
  if (/story/i.test(id)) return 'story'
  if (/reel|tiktok/i.test(id)) return 'reel'
  if (/youtube/i.test(id)) return 'youtube'
  return 'none'
}

/** The generic ratios, plus the one chip that is not a ratio. */
const ratioOptions: RatioChipOption[] = ASPECT_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
  // `Free` has no ratio to draw and means the lock is off, so it is not handed
  // a rectangle: a fake frame beside eight real ones is worse than no frame,
  // because it is the one the eye cannot check. It is told apart from the shape
  // chips by having no shape at all and by the dashed outline, which is the one
  // thing a dashed border reliably says.
  shape:
    preset.aspect === null
      ? UNLOCKED
      : {
          kind: 'viewfinder',
          ratio: preset.aspect,
        },
}))

/** The platform catalogue, six rows of the shapes its presets share. */
const platformRows: PlatformShapeRow[] = platformShapeRows()

/**
 * What a platform chip adds that the generic ratio row cannot: safe-area guides.
 *
 * This is the answer to "why does the crop panel have twenty-two chips in it when
 * eight ratios are on screen", printed on the chips themselves rather than in a
 * sentence under a heading, so a reader can see which of them are the only route
 * to the overlay before they tap anything. The three families below are the whole
 * of it: `safeAreaFor` above turns the id into `'none'` for everything else, and
 * that is why a platform preset with no safe area gets no second line.
 */
const SAFE_AREA_DETAIL: Record<Exclude<SafeAreaPreset, 'none'>, string> = {
  story: 'Story guides',
  reel: 'Reel guides',
  youtube: 'YouTube guides',
}

/** The safe-area words, for the disclosure's summary line. */
const SAFE_AREA_NAME: Record<Exclude<SafeAreaPreset, 'none'>, string> = {
  story: 'Story',
  reel: 'Reel',
  youtube: 'YouTube',
}

const platformOptions: RatioChipOption[][] = platformRows.map((row) =>
  row.presets.map((preset) => {
    const safeArea = safeAreaFor(preset.id)
    return {
      value: preset.id,
      label: preset.label,
      detail: safeArea === 'none' ? undefined : SAFE_AREA_DETAIL[safeArea],
      shape: { kind: 'viewfinder', ratio: preset.aspect },
    }
  }),
)

const PLATFORM_COUNT = platformRows.reduce((total, row) => total + row.presets.length, 0)

/**
 * The five geometric sizes, as pages rather than photographs.
 *
 * `sheet: true` is the whole of the distinction and it is not a style choice: a
 * print size is a piece of paper you hand to a printer, and the passport panel's
 * document sizes are photographs a form asks for, so the two draw differently. The
 * rule and the reason live with `proportionChip`, which is what keeps the two rows
 * from drifting apart again.
 */
const printOptions: RatioChipOption[] = PRINT_SIZES.map((size) =>
  proportionChip({
    value: size.id,
    label: size.label,
    detail: printSizeMm(size),
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    sheet: true,
  }),
)

export function CropPanel() {
  const doc = useDocStore((state) => state.present)
  const aspectLock = doc.geometry.aspectLock
  const setSafeArea = useUiStore((state) => state.setSafeArea)
  const safeArea = useUiStore((state) => state.safeArea)
  const [typed, setTyped] = useState('')

  // A ratio is a claim about pixels, not about the unit square, so every aspect
  // fit is told which frame it is reasoning about (D5-F01). Without it "Square
  // 1:1" on a 3:2 photo hands back the whole frame.
  const frame = doc.source
    ? cropFrameSize(doc.source, doc.geometry.orientation, doc.geometry.straighten)
    : undefined
  const typedAspect = aspectForCustomRatio(typed)
  const readout = cropPixelReadout(doc)

  // The W:H field is a control that writes a claim about the crop, so it has to
  // stop making that claim when the crop stops honouring it. It is a draft while
  // the user is typing and derived the moment it is not: typing `16:9` fills it
  // in, then "Reset crop" or a corner drag leaves it claiming a ratio the readout
  // no longer prints. Showing nothing rather than the new truth is deliberate —
  // the canvas overlay already states the current ratio, and a field that
  // silently retyped itself would be a second readout nobody asked for. An
  // unparseable draft is left alone, because then the field is complaining about
  // what was typed rather than claiming a ratio.
  const custom = typedAspect === null || isRatio(readout.pixelAspect, typedAspect) ? typed : ''
  const ratioError = custom.trim().length > 0 && typedAspect === null

  // Which chip is lit has to answer "what shape is the crop right now", because
  // that is the question a user is asking when they look at it. Deriving it from
  // `aspectLock` instead meant the row kept claiming 16:9 after "Reset crop"
  // released the box, while the canvas readout — which measures the crop in real
  // pixels — honestly said 2:3: the panel and the thing it was labelling
  // disagreed. `cropPixelReadout` is the same number the overlay prints, so the
  // chip and the readout cannot drift apart.
  //
  // The same derivation answers for the platform and print rows, and that is the
  // whole of the `value={null}` that used to be hardcoded into them: a user who
  // picked "Instagram Story 9:16" saw nothing lit anywhere, in a panel whose
  // generic row lit up. A shape row can light more than one chip — five presets
  // are 9:16 — and that is the truth rather than a bug: they are five ways to
  // set the crop the canvas is currently showing.
  const activeRatio = ASPECT_PRESETS.find((preset) => isRatio(readout.pixelAspect, preset.aspect))

  const applyAspect = (aspect: number | null, presetId = '') => {
    // One chip tap is one undo step: aspect lock, crop and the safe-area
    // preset are a single edit, so the whole write set runs inside one span.
    useDocStore.getState().beginInteraction('crop:preset')
    setAspectLock(aspect)
    setCrop(aspect ? constrainToAspect(FULL, aspect, { frame }) : FULL)
    setSafeArea(safeAreaFor(presetId))
    useDocStore.getState().endInteraction()
  }

  const swapSides = (text: string) => {
    const sides = text.split(':')
    if (sides.length !== 2) return null
    return `${sides[1].trim()}:${sides[0].trim()}`
  }

  const applyPrintSize = (size: PrintSize) => {
    const dpi = doc.output.dpi
    // Three fields, one undo step: the physical resize is a real edit here, so
    // it opts out of the transient default `setOutput` carries.
    useDocStore.getState().beginInteraction('print:size')
    setOutput(
      { resize: { mode: 'physical', widthMm: size.widthMm, heightMm: size.heightMm, dpi } },
      { transient: false },
    )
    applyAspect(size.widthMm / size.heightMm, size.id)
    useDocStore.getState().endInteraction()
  }

  const activeGeneric = activeRatio?.id ?? (readout.pixelAspect > 0 ? 'free' : null)

  return (
    <div>
      <p className={styles.sectionTitle}>Aspect ratio</p>
      <RatioChipRow
        ariaLabel="Aspect ratio presets"
        options={ratioOptions}
        selected={activeGeneric ? [activeGeneric] : []}
        onChange={(id) => {
          const preset = ASPECT_PRESETS.find((candidate) => candidate.id === id)
          applyAspect(preset?.aspect ?? null, id)
        }}
      />

      <p className={styles.sectionTitle}>Custom ratio</p>
      <div className={styles.row}>
        <input
          className={styles.grow}
          type="text"
          inputMode="decimal"
          placeholder="W:H"
          aria-label="Custom aspect ratio"
          aria-invalid={ratioError || undefined}
          aria-describedby={ratioError ? RATIO_ERROR_ID : undefined}
          value={custom}
          onChange={(event) => {
            const text = event.target.value
            setTyped(text)
            // An unparseable ratio must leave the lock exactly where it was, so
            // nothing is written until `aspectForCustomRatio` agrees (D5-F14).
            const aspect = aspectForCustomRatio(text)
            if (aspect !== null) applyAspect(aspect)
          }}
        />
        <button
          type="button"
          className={styles.textButton}
          aria-label="Swap ratio sides"
          onClick={() => {
            const swapped = swapSides(custom)
            if (swapped !== null) {
              const aspect = aspectForCustomRatio(swapped)
              if (aspect !== null) {
                setTyped(swapped)
                applyAspect(aspect)
                return
              }
            }
            if (aspectLock) applyAspect(1 / aspectLock)
          }}
        >
          <SwapRatioGlyph />
        </button>
      </div>
      {ratioError && (
        <p className={styles.error} id={RATIO_ERROR_ID} role="alert">
          Use a W:H ratio like 3:2 — both sides must be numbers above zero.
        </p>
      )}

      {/* A disclosure, not a wall and not a deletion.
       *
       * The audit found 600px of twenty-two chips pushing the working Straighten
       * dial 920px down the panel, and asked for a disclosure or for the section
       * to go. It does not go, and the reason is the one thing those chips can do
       * that the row above cannot: `applyAspect` above passes the preset id to
       * `setSafeArea`, and `safeAreaFor` turns an Instagram / TikTok / YouTube id
       * into a safe-area preset. Deleting the section deletes the only route to
       * the safe-area overlay — the dashed bands `SafeAreaOverlay` draws on the
       * canvas and `PassportPanel`'s compliance read — so "remove twenty-two chips"
       * would have been "remove a feature", which is the auditor's recommendation
       * and a different thing entirely.
       *
       * So the section stays, folded. `<details>` rather than a button and a
       * `useState`, because the browser then owns the open state, the disclosure
       * works with no JavaScript, and it is announced as a disclosure rather than
       * as a button that happens to hide something.
       *
       * The summary carries the count and, when guides are on, which ones — so a
       * user who has set a Story crop can see that from the panel without opening
       * twenty-two chips to find out. */}
      <details className={styles.disclosure}>
        <summary className={styles.disclosureSummary}>
          <span className={styles.sectionTitle}>Platform</span>
          <span className={styles.disclosureNote}>
            {PLATFORM_COUNT} sizes
            {safeArea !== 'none' ? ` · ${SAFE_AREA_NAME[safeArea]} guides on` : ''}
          </span>
        </summary>
        {/* One row per *shape*, not per platform. Grouping by platform is what
            produced seven headed groups of which five held a single chip reading
            "Square 1:1" and nothing else. Six rows, one per ratio the catalogue
            offers, each chip still carrying its platform's own label and its own
            shape: every one of the twenty-two presets is still one tap away, and
            the seven square chips are one row of seven squares rather than seven
            rows of one square each.

**Which chips light, and why it is still none of them.** They used to
            light on the pixel aspect, all of them at once: a 1:1 crop put seven
            lit chips in this block, plus the generic "1:1" above them, so the
            panel read as eight things selected. Nothing in the document records
            that the crop *came from* Instagram — `geometry.aspectLock` stores a
            number, not a preset id — so a lit platform chip was claiming state the
            document does not have, and it went out again the moment a corner
            handle moved the box a pixel.

            Lighting them by safe-area family was tried and rejected, and the reason
            is the rule above: three 9:16 presets are a Story crop, so it lights
            three chips and the panel is back to N things selected for one tap.
            There is no single-valued chip state here to show, so the disclosure's
            **summary** carries it instead: folded, it reads "22 sizes · Story guides
            on" when the guides are on, which is one pressed-looking statement
            about the one thing these chips add and no claim about which chip was
            tapped. The chips themselves now say what they do on the chip — the
            second line names the guides — so the answer to "what will this do" is
            on the button rather than in a paragraph 900px above the dial.

            Lighting only the chip that was tapped was weighed and rejected earlier
            for the same reason: it needs that tap remembered in component state,
            which dies with the panel and is still wrong after a drag, and it would
            leave two lit controls in the panel with nothing to say which is the
            truth. */}
        <p className={styles.hint}>
          Every chip here sets the same crop. The lit ratio above is the shape the canvas is
          showing.
        </p>
        {platformRows.map((row, index) => (
          <div key={row.key}>
            <p className={styles.subhead}>{row.label}</p>
            <RatioChipRow
              ariaLabel={`${row.label} presets`}
              options={platformOptions[index] ?? []}
              selected={[]}
              onChange={(id) => {
                const preset = row.presets.find((candidate) => candidate.id === id)
                if (preset) applyAspect(preset.aspect, preset.id)
              }}
            />
          </div>
        ))}
      </details>

      <p className={styles.sectionTitle}>Print size</p>
      {/* A page outline and the millimetres, because a print size is a piece of
          paper: the icon says "sheet", the second line says how big, and the
          first says which of the app's five canonical spellings it is.

          This row is the one that still lights, and the difference from the
          platform block above is the difference between a *size* and a *route to
          a size*. `activePrintSize` answers "is the output this piece of paper
          right now", which is a claim the document holds and the export honours
          — press 4 × 6 in and the export really is 4 × 6 in. Seven chips
          claiming "1:1" all at once make seven claims about the same number and
          one lit chip in each of two rows makes two claims about two different
          numbers, and only the first of those reads as a selection list. None of
          the five sizes is square, so a 1:1 crop lights nothing here. */}
      <RatioChipRow
        ariaLabel="Print sizes"
        options={printOptions}
        selected={PRINT_SIZES.filter((size) =>
          isRatio(readout.pixelAspect, size.widthMm / size.heightMm),
        ).map((size) => size.id)}
        onChange={(id) => {
          const size = PRINT_SIZES.find((candidate) => candidate.id === id)
          if (size) applyPrintSize(size)
        }}
      />

      <div className={styles.straightenHead}>
        <StraightenDial
          value={doc.geometry.straighten}
          onChange={setStraighten}
          onInteractionStart={() => useDocStore.getState().beginInteraction('straighten')}
          onInteractionEnd={() => useDocStore.getState().endInteraction()}
        />
      </div>

      <div className={styles.buttonRow}>
        <IconButton label="Rotate left" onClick={() => rotateBy(-90)}>
          <RotateLeftGlyph />
        </IconButton>
        <IconButton label="Rotate right" onClick={() => rotateBy(90)}>
          <RotateRightGlyph />
        </IconButton>
        <IconButton label="Flip horizontally" onClick={toggleFlipH}>
          <FlipHorizontalGlyph />
        </IconButton>
        <IconButton
          label="Fill frame after straighten"
          onClick={() => {
            if (!doc.source) return
            setCrop(
              fillFrameCrop(
                doc.source,
                doc.geometry.orientation,
                doc.geometry.straighten,
                aspectLock,
              ),
            )
          }}
        >
          <FillFrameGlyph />
        </IconButton>
      </div>

      <p className={styles.hint}>
        Drag the corners to choose what the photo keeps, and the dial to straighten it. The grid
        marks where each platform puts its own text and buttons, so nothing important lands
        underneath.
      </p>
    </div>
  )
}
