import { useEffect, useState } from 'react'
import { constrainToAspect, cropFrameSize, pxToMm } from '../../lib/crop/geometry'
import { downloadBlob } from '../../lib/encode'
import { parseRatio } from '../../lib/format'
import { effectiveOutputSize } from '../../model/selectors'
import type { Doc, NormRect } from '../../model/types'
import { renderExportCanvas } from '../../render/exportCanvas'
import { setAspectLock, setCrop, setOutput } from '../../store/actions'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { RatioChipRow, proportionChip, type RatioChipOption } from '../controls/RatioChip'
import { SegmentedControl } from '../controls/SegmentedControl'
import { Stepper } from '../controls/Stepper'
import { autoFrame } from '../../features/passport/autoFrame'
import {
  checkCompliance,
  inputFrameMm,
  type ComplianceInput,
  type ComplianceRule,
  type ComplianceStatus,
} from '../../features/passport/compliance'
import { guideLayout, type GuideLayout } from '../../features/passport/guides'
import { complianceInputFor, docFrameMm } from '../../features/passport/measure'
import { measureCanvas, type PhotoMeasurement } from '../../features/passport/measureFace'
import {
  orientedFrame,
  specFrameMm,
  type FrameOrientation,
} from '../../features/passport/orientation'
import {
  isSheetName,
  planSheet,
  sheetCapacity,
  sheetOptions,
  sheetSizeMm,
  type SheetName,
  type SheetLayout,
} from '../../features/passport/sheet'
import { exportPassportSheetPdf } from '../../features/passport/sheetExport'
import {
  getSpec,
  PASSPORT_SPECS,
  specBackgroundColor,
  type PassportSpec,
} from '../../features/passport/specs'
import panel from './passportPanel.module.css'
import styles from './tools.module.css'

const FULL: NormRect = { x: 0, y: 0, width: 1, height: 1 }

/** Long edge of the throwaway render used to find the head. */
const DETECT_EDGE = 480

/**
 * How long the panel waits after the last edit before it re-measures.
 *
 * A crop or a straighten drag emits a change per pointer move and every one of
 * them wants a full-resolution render, so a trailing debounce is the only
 * affordable way to keep the reading current.
 */
const MEASURE_DEBOUNCE_MS = 400

/** Copies the stepper starts at, and returns to whenever the sheet changes. */
const DEFAULT_COPIES = 6

const SIZE_ERROR_ID = 'passport-size-error'

/** One tint per verdict, keyed the way `ComplianceStatus` spells them. */
const PILL_CLASS: Record<ComplianceStatus, string> = {
  pass: panel.pillPass,
  warn: panel.pillWarn,
  fail: panel.pillFail,
}

/**
 * What each of the eleven specs is a photo *of*, read off `specs.ts`.
 *
 * The catalogue's own `label` puts the country first and the size in the title
 * case of a product ("US Passport 2×2 in"), which is fine in a lookup table and
 * useless to a user who has to decide which one their document asks for: the
 * question in this panel is never "which country", it is "which document", and
 * two of these eleven are not countries at all. So every id is mapped to the
 * document it names, from that spec's own `label`, `country` and `notes`, and the
 * millimetres come from `widthMm`/`heightMm` rather than from the label.
 *
 * The grouping is the second half of the same point: a user who knows they want
 * a passport photo should not have to read all eleven chips to find the seven
 * that are one, and a `Schengen visa` sitting among passports reads as a
 * country rather than as the zone it is.
 *
 * An id in neither list gets no chip and no invented name: a new document in the
 * catalogue needs a human to say what it is, and `PassportPanel.test.tsx` is red
 * until they do.
 */
const DOCUMENT_GROUPS: readonly { title: string; ids: readonly string[] }[] = [
  {
    title: 'Passport photos',
    ids: [
      'us-2x2',
      'india-2x2',
      'uk-35x45',
      'canada-50x70',
      'australia-35x45',
      'china-33x48',
      'japan-35x45',
    ],
  },
  { title: 'Visa and card photos', ids: ['us-visa-2x2', 'schengen-35x45', 'oci-51x51'] },
  { title: 'Other ID photos', ids: ['generic-35x45'] },
]

/** Spec id -> the document a user is trying to satisfy. See `DOCUMENT_GROUPS`. */
const DOCUMENTS: Record<string, string> = {
  'us-2x2': 'US passport',
  'india-2x2': 'India passport',
  'uk-35x45': 'UK passport',
  'canada-50x70': 'Canada passport',
  'australia-35x45': 'Australia passport',
  'china-33x48': 'China passport',
  'japan-35x45': 'Japan passport',
  'us-visa-2x2': 'US visa',
  'schengen-35x45': 'Schengen visa',
  'oci-51x51': 'India OCI card',
  'generic-35x45': 'Generic ID photo',
}

/** The id the panel reads against before anything is chosen. */
const DEFAULT_DOCUMENT = 'us-2x2'

/**
 * The size of the document this panel assumes, in the units every chip uses.
 *
 * It was written as "2 × 2 in" — the figure the US government publishes — while
 * every chip in this panel, and the summary line further down, say millimetres.
 * Two units for one document on one screen is the same defect as the three
 * spellings of a print size, so it is derived from the spec rather than typed:
 * the sentence cannot be a millimetre out from the chip beside it.
 */
function defaultDocumentSize(): string {
  const spec = getSpec(DEFAULT_DOCUMENT)
  if (!spec) return ''
  return `${mm(spec.widthMm)} × ${mm(spec.heightMm)} mm`
}

/**
 * A millimetre figure, printed exactly as the spec and the rules print it.
 *
 * Nothing rounds here: a compliance message quotes `34.925` because that is the
 * figure the rule compares, and a summary that said `34.9` would be a second,
 * different number for the same requirement.
 */
function mm(value: number): string {
  return `${value}`
}

/** A derived millimetre coordinate, to a tenth, so a viewBox stays readable. */
function at(value: number): number {
  return Math.round(value * 10) / 10
}

/** The plain backdrop a spec asks for, in the words its own rule uses. */
function backgroundWords(spec: PassportSpec): string {
  if (spec.background === 'white') return 'a plain white background'
  if (spec.background === 'light-grey') return 'a plain light grey background'
  return 'any plain background'
}

/** The chips for one group, each drawn at the proportion it actually prints. */
function chipOptions(ids: readonly string[]): RatioChipOption[] {
  return ids.flatMap((id) => {
    const spec = getSpec(id)
    const document = DOCUMENTS[id]
    if (!spec || !document) return []
    return [
      // The physical scale cue: the glyph is the photo's own proportion rather than
      // a decoration beside it, so 35 × 45 and 50 × 70 are told apart by silhouette
      // before either label is read. `sheet: false` is what says so to
      // `proportionChip` — the same function the crop panel's print sizes use, and
      // the reason those draw a sheet and these draw a photograph is recorded there.
      proportionChip({
        value: spec.id,
        label: document,
        detail: `${mm(spec.widthMm)} × ${mm(spec.heightMm)} mm`,
        widthMm: spec.widthMm,
        heightMm: spec.heightMm,
        sheet: false,
      }),
    ]
  })
}

/**
 * The rule as a picture: the frame that will print, the head band the document
 * asks for, and the eye line with the two bounds it has to stay between.
 *
 * `guideLayout` returns its placements as fractions of the *spec's* frame, so
 * they are converted to millimetres here against `spec.heightMm` — the same unit
 * change of numbers the guide overlay already makes, and the anatomy is neither
 * re-derived nor re-solved. After that they are absolute distances, which is why
 * the figure can draw a transposed landscape frame without turning the head
 * sideways: a crown 4 mm below the top edge is 4 mm below it either way up.
 *
 * The bands are drawn only where they land inside the frame. A custom size can
 * be smaller than the head the document asks for, and a band hanging outside the
 * frame it belongs to would draw a claim the panel cannot make.
 */
function FrameFigure({
  frameMm,
  spec,
  guides,
}: {
  frameMm: { widthMm: number; heightMm: number }
  spec: PassportSpec
  guides: GuideLayout
}) {
  const pad = Math.max(2, Math.round(Math.max(spec.widthMm, spec.heightMm) * 0.1))
  const headTop = guides.band.fromTop * spec.heightMm
  const headHeight = guides.band.height * spec.heightMm
  const fits = headTop >= 0 && headTop + headHeight <= frameMm.heightMm
  const eyeAt = (id: GuideLayout['lines'][number]['id']) => {
    const line = guides.lines.find((candidate) => candidate.id === id)
    return line ? at(line.fromTop * spec.heightMm) : null
  }
  const bounds = (['eye-min', 'eye-max'] as const)
    .map(eyeAt)
    .filter((y): y is number => y !== null)
    .filter((y) => y >= 0 && y <= frameMm.heightMm)
  const advisory = eyeAt('eye-advisory')
  return (
    <span className={panel.frameFigure}>
      <svg
        data-figure="document-frame"
        viewBox={`0 0 ${at(pad * 2 + frameMm.widthMm)} ${at(pad * 2 + frameMm.heightMm)}`}
        aria-hidden="true"
        focusable="false"
        strokeWidth={1}
      >
        <rect
          className={panel.frameEdge}
          x={mm(pad)}
          y={mm(pad)}
          width={mm(frameMm.widthMm)}
          height={mm(frameMm.heightMm)}
          vectorEffect="non-scaling-stroke"
        />
        {fits && (
          <rect
            className={panel.frameHead}
            x={mm(pad)}
            y={mm(at(pad + headTop))}
            width={mm(frameMm.widthMm)}
            height={mm(at(headHeight))}
          />
        )}
        {bounds.map((y) => (
          <line
            key={y}
            className={panel.frameEyeBound}
            x1={mm(pad)}
            x2={mm(at(pad + frameMm.widthMm))}
            y1={mm(at(pad + y))}
            y2={mm(at(pad + y))}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {advisory !== null && advisory >= 0 && advisory <= frameMm.heightMm && (
          <line
            className={panel.frameEye}
            x1={mm(pad)}
            x2={mm(at(pad + frameMm.widthMm))}
            y1={mm(at(pad + advisory))}
            y2={mm(at(pad + advisory))}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </span>
  )
}

/**
 * The print sheet, drawn.
 *
 * `planSheet` has already done the arithmetic — how many fit, where each one
 * sits, and how far apart they are — so the figure is those rectangles and
 * nothing else. The viewBox is the sheet in the pixels `planSheet` planned in,
 * which is what makes it a scale cue rather than a picture of a sheet: a
 * 50 × 70 mm photo on 4 × 6 in paper looks as small on screen as it is in the
 * hand. The strokes carry `non-scaling-stroke`, because a 300-DPI viewBox drawn
 * at panel size would otherwise render a 0.3 px hairline.
 */
function SheetFigure({ layout }: { layout: SheetLayout }) {
  return (
    <div className={panel.sheetFigure}>
      <svg
        className={panel.sheetSvg}
        data-figure="sheet"
        viewBox={`0 0 ${layout.sheetWidthPx} ${layout.sheetHeightPx}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          className={panel.sheetPaper}
          x={0}
          y={0}
          width={layout.sheetWidthPx}
          height={layout.sheetHeightPx}
          vectorEffect="non-scaling-stroke"
        />
        {layout.photos.map((photo) => (
          <rect
            key={`${photo.x}:${photo.y}`}
            className={panel.sheetPhoto}
            x={photo.x}
            y={photo.y}
            width={photo.width}
            height={photo.height}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  )
}

/**
 * What a rule read, against what it wanted.
 *
 * `checkCompliance` decides the status and `rule.detail` explains it; what the
 * panel adds is the two figures side by side, in the units the rule itself
 * compares, taken from the same `ComplianceInput` the engine was handed — so a
 * rule that says "Head height is 42.0 mm — the required range is 29–34 mm" also
 * shows `42.0 mm` and `29–34 mm` as numbers, and the two cannot disagree
 * because neither is recomputed here.
 *
 * The three background rules answer in words about a colour and a uniformity, so
 * a measured/required pair would only flatten them; they return null and keep
 * the engine's sentence.
 */
function readingFor(
  rule: ComplianceRule,
  input: ComplianceInput,
  effectiveDpi: number,
): { measured: string; required: string } | null {
  const spec = input.spec
  if (rule.id === 'head-height') {
    return {
      measured: `${input.headHeightMm.toFixed(1)} mm`,
      required: `${mm(spec.headHeightMm.min)}–${mm(spec.headHeightMm.max)} mm`,
    }
  }
  if (rule.id === 'eye-line') {
    return {
      measured: `${input.eyeLineMmFromBottom.toFixed(1)} mm`,
      required: `${mm(spec.eyeLineMmFromBottom.min)}–${mm(spec.eyeLineMmFromBottom.max)} mm`,
    }
  }
  if (rule.id === 'centring') {
    return {
      measured: `${Math.abs(input.centeredOffsetMm).toFixed(1)} mm off centre`,
      required: 'within 3 mm',
    }
  }
  if (rule.id === 'aspect') {
    const frame = inputFrameMm(input)
    return {
      measured: `${input.outputWidthPx} × ${input.outputHeightPx} px`,
      required: `${mm(frame.widthMm)} × ${mm(frame.heightMm)} mm`,
    }
  }
  if (rule.id === 'dpi') {
    return { measured: `${Math.round(effectiveDpi)} DPI`, required: `${spec.dpi} DPI` }
  }
  return null
}

/** The spec a document is set to, which is the frame the reading is read against. */
function specIdOf(doc: Doc): string {
  return doc.passport?.specId ?? 'us-2x2'
}

/**
 * Everything a measurement is a reading *of*.
 *
 * The head and the backdrop are read off one rendering, and the checklist then
 * converts them to millimetres through the frame that rendering was made in. So
 * the reading is only about the document as it stood here: the pixels it names,
 * the crop and straighten that decide which of them are in frame, the print size
 * the millimetres come from, the spec those millimetres are judged against, and
 * the backdrop the subject was read against.
 *
 * Deliberately not the whole document. An exposure or hue drag changes what the
 * photo looks like without moving a millimetre, and re-rendering the full export
 * on every frame of one would cost far more than the reading is worth.
 */
function measureKeyFor(doc: Doc, specId: string): string {
  return JSON.stringify([
    doc.source?.assetId ?? null,
    doc.geometry.crop,
    doc.geometry.orientation,
    doc.geometry.straighten,
    doc.output.resize,
    specId,
    doc.background.mode,
    doc.background.color,
  ])
}

/**
 * Render the document as it stands and read the photo off it.
 *
 * `key` is re-checked against the live document before the reading is returned:
 * a render that was still in flight when the document moved again describes a
 * picture the user no longer has, and stamping it with the new key would put
 * those millimetres back on the checklist as if they had just been verified.
 */
async function readPhoto(
  source: ImageBitmap,
  key: string,
  signal?: AbortSignal,
): Promise<PhotoMeasurement | null> {
  const doc = useDocStore.getState().present
  try {
    const canvas = await renderExportCanvas(source, doc, undefined, { signal })
    if (signal?.aborted) return null
    if (
      measureKeyFor(useDocStore.getState().present, specIdOf(useDocStore.getState().present)) !==
      key
    )
      return null
    return measureCanvas(canvas)
  } catch {
    // An aborted render, a lost context, a document too large to render: none of
    // them is a reading, and reporting no reading says so. The panel shows the
    // spec's advisory values until the next attempt succeeds.
    return null
  }
}

type Busy = 'idle' | 'measuring' | 'framing' | 'exporting'

export function PassportPanel({ source }: { source: ImageBitmap | null }) {
  const doc = useDocStore((state) => state.present)
  const pushToast = useUiStore((state) => state.pushToast)
  const specId = specIdOf(doc)
  const spec: PassportSpec = getSpec(specId) ?? PASSPORT_SPECS[0]
  const documentName = DOCUMENTS[spec.id] ?? spec.label
  // Orientation is read back off the document rather than kept in component
  // state, so it survives a reload the way the sheet choice now does.
  const orientation: FrameOrientation =
    doc.output.resize.mode === 'physical' && doc.output.resize.widthMm > doc.output.resize.heightMm
      ? 'landscape'
      : 'portrait'
  const landscape = orientation === 'landscape'
  const sheet: SheetName = isSheetName(doc.output.sheet) ? doc.output.sheet : '4x6'
  // The millimetres the document is actually printing, which are the spec's own
  // unless a custom size has replaced them.
  const frameMm = docFrameMm(doc, spec)
  const specFrame = specFrameMm(spec, orientation)
  const custom = frameMm.widthMm !== specFrame.widthMm || frameMm.heightMm !== specFrame.heightMm
  /**
   * The sheet packs what will actually print, so a typed size replaces the
   * spec's millimetres for the sheet as well as for the export. Left alone, a
   * 4 × 6 in sheet of 35 × 45 mm rectangles sat under a 40 × 50 mm print, and the
   * figure would have been drawing a sheet the exporter never builds. The
   * orientation is passed separately because `planSheet` is the thing that
   * transposes a landscape photo, so the spec carries the upright millimetres.
   */
  const printSpec: PassportSpec = custom
    ? {
        ...spec,
        widthMm: landscape ? frameMm.heightMm : frameMm.widthMm,
        heightMm: landscape ? frameMm.widthMm : frameMm.heightMm,
      }
    : spec

  const capacity = Math.max(1, sheetCapacity(printSpec, sheet, spec.dpi, landscape))
  /**
   * Copies is the one control whose answer depends on two others, so the request
   * is stored against the spec, sheet and orientation it was made for: thirty
   * requested on a sheet that holds two becomes six — not thirty in waiting —
   * when a bigger sheet is chosen, instead of silently jumping to its capacity.
   */
  const capacityKey = `${spec.id} ${sheet} ${orientation}`
  const [request, setRequest] = useState({ key: capacityKey, value: DEFAULT_COPIES })
  const copies = Math.min(request.key === capacityKey ? request.value : DEFAULT_COPIES, capacity)
  const layout = planSheet(printSpec, sheet, copies, spec.dpi, landscape)

  /**
   * The millimetre fields are a control that writes the print size, so they show
   * the size the document is printing and hold a typed draft only while that
   * draft belongs to the current document. Anything else — a spec chip, a
   * landscape swap — puts the truth back rather than leaving a number in a box
   * that no longer describes anything. The key carries the spec as well as the
   * millimetres, because two documents can print at the same size and a draft
   * typed against one of them still describes the other.
   */
  const draftKey = `${spec.id} ${mm(frameMm.widthMm)}×${mm(frameMm.heightMm)}`
  const [typed, setTyped] = useState<{ key: string; width: string; height: string } | null>(null)
  const draft = typed !== null && typed.key === draftKey ? typed : null
  const width = draft ? draft.width : mm(frameMm.widthMm)
  const height = draft ? draft.height : mm(frameMm.heightMm)
  // `parseRatio` is the app's one definition of a usable W:H, so these fields and
  // the crop panel's ratio field reject exactly the same strings.
  const parsedSize = parseRatio(`${width}:${height}`)
  const sizeError = draft !== null && width.trim() !== '' && height.trim() !== '' && !parsedSize
  const sizeDiffers =
    parsedSize !== null &&
    (parsedSize.width !== frameMm.widthMm || parsedSize.height !== frameMm.heightMm)
  // A measurement is a reading of *one* rendering, so it is stored against the
  // document it was taken from. Holding the bare reading and only refreshing it
  // from three buttons meant a crop, a straighten or a resize left the panel
  // reinterpreting an old set of landmarks against new millimetres and still
  // reporting the result as `measured` (D5-F12 follow-up).
  const [reading, setReading] = useState<{ key: string; value: PhotoMeasurement | null } | null>(
    null,
  )
  const [busy, setBusy] = useState<Busy>('idle')

  const output = effectiveOutputSize(doc)
  const measureKey = measureKeyFor(doc, specId)
  // A reading only speaks for the document it was taken from, and only while
  // there is still a photo to take it from.
  const usable = source !== null && reading !== null && reading.key === measureKey
  const measurement = usable ? reading.value : null
  const remeasuring = source !== null && reading !== null && reading.key !== measureKey
  const input = complianceInputFor(doc, spec, measurement, output).input
  const report = checkCompliance(input)
  const guides = guideLayout(spec)

  // Re-measure whenever the geometry the reading is interpreted against moves.
  // The reading for the old geometry is treated as no reading at all in the
  // meantime, so the checklist says "not measured" rather than answering for a
  // photo the user has already changed.
  useEffect(() => {
    if (!source) return
    // A reading already taken for exactly this document needs no second render;
    // the explicit buttons below measure first and this effect would only
    // repeat them.
    if (reading !== null && reading.key === measureKey) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void readPhoto(source, measureKey, controller.signal).then((value) => {
        if (!controller.signal.aborted) setReading({ key: measureKey, value })
      })
    }, MEASURE_DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [measureKey, reading, source])

  const measure = async () => {
    if (!source) return null
    const doc = useDocStore.getState().present
    const key = measureKeyFor(doc, specId)
    const result = await readPhoto(source, key)
    setReading({ key, value: result })
    return result
  }

  const applySpec = (id: string) => {
    const next = getSpec(id)
    if (!next) return
    useDocStore.getState().update((current) => {
      const frame = orientedFrame(current, next, orientation)
      const background = specBackgroundColor(next)
      return {
        ...current,
        passport: { specId: id, backgroundApplied: background !== null },
        output: frame.output,
        geometry: frame.geometry,
        background: background
          ? { ...current.background, mode: 'color' as const, color: background }
          : current.background,
      }
    })
    void measure()
  }

  /**
   * A custom size is the same three writes as applying a spec's size — the
   * physical resize, the aspect lock, and a crop that honours it — so it is one
   * undoable edit and the crop can never be left claiming a proportion the print
   * does not have.
   */
  const applyCustomSize = () => {
    if (!parsedSize) return
    const aspect = parsedSize.width / parsedSize.height
    const cropFrame = doc.source
      ? cropFrameSize(doc.source, doc.geometry.orientation, doc.geometry.straighten)
      : undefined
    useDocStore.getState().beginInteraction('passport:size')
    setOutput(
      {
        resize: {
          mode: 'physical',
          widthMm: parsedSize.width,
          heightMm: parsedSize.height,
          dpi: spec.dpi,
        },
      },
      { transient: false },
    )
    setAspectLock(aspect)
    setCrop(constrainToAspect(FULL, aspect, { frame: cropFrame }))
    useDocStore.getState().endInteraction()
    void measure()
  }

  const handleCheck = async () => {
    setBusy('measuring')
    try {
      await measure()
    } catch {
      pushToast('Could not measure this photo', 'error')
    } finally {
      setBusy('idle')
    }
  }

  const handleAutoFrame = async () => {
    if (!source) return
    setBusy('framing')
    try {
      const present = useDocStore.getState().present
      if (!present.source) return
      const frame = cropFrameSize(
        present.source,
        present.geometry.orientation,
        present.geometry.straighten,
      )
      // The head is found on the *whole* photo: the export canvas is already
      // cropped, so framing it from its own crop would only ever confirm itself.
      const canvas = await renderExportCanvas(
        source,
        { ...present, geometry: { ...present.geometry, crop: FULL } },
        { width: DETECT_EDGE, height: Math.round(DETECT_EDGE * (frame.height / frame.width)) },
      )
      const face = measureCanvas(canvas)?.face
      if (!face) {
        pushToast(
          'No head found — auto-frame needs a plain, even background for the head to stand out against',
          'error',
        )
        return
      }
      const framed = autoFrame(face.landmarks, spec, frame)
      setCrop(framed.crop)
      await measure()
      pushToast(`Auto-framed · head ${framed.headHeightMm.toFixed(1)} mm`, 'success')
    } catch {
      pushToast('Could not frame this photo', 'error')
    } finally {
      setBusy('idle')
    }
  }

  const handleSheet = async () => {
    if (!source) return
    setBusy('exporting')
    try {
      const present = useDocStore.getState().present
      const canvas = await renderExportCanvas(source, present)
      const blob = await exportPassportSheetPdf(printSpec, sheet, copies, canvas, {
        landscape,
        format: present.output.format,
        quality: present.output.quality,
        matte: present.output.matte,
      })
      downloadBlob(blob, `${spec.id}-${sheet}-sheet.pdf`)
      pushToast('Sheet exported', 'success')
    } catch {
      pushToast('Could not build the sheet', 'error')
    } finally {
      setBusy('idle')
    }
  }

  // What each of the three controls does, in the order the panel asks for them.
  // A square document is its own landscape, and the caption says so rather than
  // promising a turn that transposes 50.8 mm onto 50.8 mm.
  const orientationCaption =
    spec.widthMm === spec.heightMm
      ? `This document is ${mm(spec.widthMm)} × ${mm(spec.heightMm)} mm, so turning it changes nothing.`
      : custom
        ? `Prints ${mm(frameMm.widthMm)} × ${mm(frameMm.heightMm)} mm — the size you typed. ${landscape ? 'Portrait turns it back upright.' : 'Landscape turns that frame on its side.'}`
        : `Prints ${mm(specFrame.widthMm)} × ${mm(specFrame.heightMm)} mm. ${landscape ? 'Portrait turns it back upright.' : 'Landscape turns the same photo on its side.'}`

  const failed = report.rules.filter((rule) => rule.status === 'fail').length
  const warned = report.rules.filter((rule) => rule.status === 'warn').length
  const assumed = report.rules.filter((rule) => rule.source === 'assumed').length
  // An `assumed` rule was scored against the *spec's own example figure*, not
  // against this photo, so whatever status the engine gave it is a statement
  // about the document and not a pass on the user's picture. It used to be
  // counted here as a pass — "4 of 8 checks pass" on a portrait with three of
  // the eight read straight off the spec — and it used to carry a green `pass`
  // pill on screen beside a grey "Not measured" badge, which is two labels
  // disagreeing about the same line.
  const passed = report.rules.length - failed - warned - assumed
  const unmeasured = assumed ? `, and ${assumed} could not be measured from this photo yet` : ''
  const verdict =
    failed > 0
      ? `${failed} of ${report.rules.length} checks ${failed === 1 ? 'fails' : 'fail'}${unmeasured} — the figures below say what to change.`
      : assumed
        ? `${passed} of ${report.rules.length} checks pass, and ${assumed} could not be measured from this photo yet.`
        : warned > 0
          ? `Nothing fails, but ${warned} ${warned === 1 ? 'check is' : 'checks are'} close to the limit.`
          : `All ${report.rules.length} checks pass.`

  const sheetMm = sheetSizeMm(sheet, landscape)
  const sheetLabel = sheetOptions().find((option) => option.value === sheet)?.label ?? sheet
  // `planSheet` plans the gap in pixels, and a 2 mm gap at 300 DPI is 23.6 px
  // rounded to 24 — which converts back to 2.032 mm. The gap is quoted to a
  // tenth so the caption says the 2 mm the sheet is actually cutting.
  const gapMm = at(pxToMm(layout.gapPx, layout.dpi))
  const copiesCaption =
    copies >= capacity
      ? `Printing all ${capacity}. Cut on the dashed lines.`
      : `Printing ${copies} of the ${capacity} this sheet holds at ${mm(frameMm.widthMm)} × ${mm(frameMm.heightMm)} mm. Cut on the dashed lines.`

  return (
    <div>
      <p className={styles.sectionTitle}>Document</p>
      {doc.passport === null && (
        <p className={styles.hint}>
          Nothing chosen yet, so the panel is reading everything against the US passport —{' '}
          {defaultDocumentSize()}. Pick the one your own document asks for.
        </p>
      )}
      {DOCUMENT_GROUPS.map((group) => (
        <div key={group.title}>
          <p className={styles.subhead}>{group.title}</p>
          <RatioChipRow
            ariaLabel={group.title}
            options={chipOptions(group.ids)}
            // Nothing is chosen until the user chooses. `specId` falls back to
            // the US passport so the *checks* have something to read against, and
            // lighting that chip said the user had picked it — while the sentence
            // directly above said "Nothing chosen yet" and the canvas showed no
            // guide lines, because none had been asked for. One document was
            // simultaneously chosen and not chosen; now nothing is lit until it is.
            selected={doc.passport ? [specId] : []}
            onChange={applySpec}
          />
        </div>
      ))}

      <div className={panel.summary}>
        <FrameFigure frameMm={frameMm} spec={spec} guides={guides} />
        <span className={panel.summaryText}>
          <span className={panel.summaryLine}>
            {documentName} — prints {mm(frameMm.widthMm)} × {mm(frameMm.heightMm)} mm at {spec.dpi}{' '}
            DPI. Needs {backgroundWords(spec)}.
          </span>
          <span className={panel.summaryFigures}>
            Head {mm(spec.headHeightMm.min)}–{mm(spec.headHeightMm.max)} mm from chin to crown. Eyes{' '}
            {mm(spec.eyeLineMmFromBottom.min)}–{mm(spec.eyeLineMmFromBottom.max)} mm from the bottom
            edge. The bands in the figure are where they go.
          </span>
        </span>
      </div>
      {guides.warning ? <p className={styles.error}>{guides.warning}</p> : null}

      {/* The one button that satisfies the background rule, put under the line that
          states the rule rather than in the row of size controls, where it read
          as a third way to set the print size. */}
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          onClick={() =>
            useDocStore.getState().update((current) => ({
              ...current,
              background: { ...current.background, mode: 'color', color: '#ffffff' },
            }))
          }
        >
          Plain white background
        </button>
      </div>

      <p className={styles.sectionTitle}>Print orientation</p>
      <SegmentedControl
        ariaLabel="Print orientation"
        options={[
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' },
        ]}
        value={orientation}
        onChange={(next) => applyOrientation(next as FrameOrientation, spec, orientation)}
      />
      <p className={styles.hint}>{orientationCaption}</p>

      <p className={styles.sectionTitle}>Custom size</p>
      <div className={panel.sizeFields}>
        <label className={panel.sizeField}>
          <span>Width</span>
          <span className={`${panel.sizeBox}${sizeError ? ` ${panel.sizeInvalid}` : ''}`}>
            <input
              className={panel.sizeInput}
              type="text"
              inputMode="decimal"
              aria-label="Width in millimetres"
              aria-invalid={sizeError || undefined}
              aria-describedby={sizeError ? SIZE_ERROR_ID : undefined}
              value={width}
              onChange={(event) => setTyped({ key: draftKey, width: event.target.value, height })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyCustomSize()
              }}
            />
            <span className={panel.sizeUnit}>mm</span>
          </span>
        </label>
        <label className={panel.sizeField}>
          <span>Height</span>
          <span className={`${panel.sizeBox}${sizeError ? ` ${panel.sizeInvalid}` : ''}`}>
            <input
              className={panel.sizeInput}
              type="text"
              inputMode="decimal"
              aria-label="Height in millimetres"
              aria-invalid={sizeError || undefined}
              aria-describedby={sizeError ? SIZE_ERROR_ID : undefined}
              value={height}
              onChange={(event) => setTyped({ key: draftKey, width, height: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyCustomSize()
              }}
            />
            <span className={panel.sizeUnit}>mm</span>
          </span>
        </label>
      </div>
      {sizeError && (
        <p className={styles.error} id={SIZE_ERROR_ID} role="alert">
          Width and height each need a number of millimetres above zero — 35 and 45, for example.
        </p>
      )}
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          disabled={!sizeDiffers}
          onClick={applyCustomSize}
        >
          Use this size
        </button>
        <button
          type="button"
          className={`${styles.textButton} ${styles.textButtonPrimary}`}
          onClick={() => applySpec(spec.id)}
        >
          {custom ? `Back to the ${documentName} size` : `Apply the ${documentName} size`}
        </button>
      </div>
      <p className={styles.hint}>
        A custom size replaces the {documentName} size for the print, the sheet and every check
        below.
      </p>

      <p className={styles.sectionTitle}>Framing</p>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => void handleAutoFrame()}
          disabled={busy !== 'idle' || !source}
        >
          {busy === 'framing' ? 'Framing…' : 'Auto-frame the head'}
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => void handleCheck()}
          disabled={busy !== 'idle' || !source}
        >
          {busy === 'measuring' ? 'Measuring…' : 'Re-measure'}
        </button>
      </div>
      <p className={styles.hint}>
        Auto-frame measures the head from the photo itself — it needs a plain background, and
        downloads no model.{' '}
        {doc.passport
          ? 'Without it, align the eyes and crown to the guides on the canvas.'
          : 'Pick a document above to see its guide lines on the canvas.'}
      </p>

      <p className={styles.sectionTitle}>Photo checks</p>
      <p className={panel.verdict}>{verdict}</p>
      <div className={styles.list}>
        {report.rules.map((rule) => {
          const figures = readingFor(rule, input, report.effectiveDpi)
          const unmeasured = rule.source === 'assumed'
          return (
            <div key={rule.id} className={panel.rule}>
              {/* The status pill is a claim about this photo, so it is withheld
                  where nothing was measured: a green `pass` printed next to the
                  spec's own midpoint is not a pass, it is the document's example
                  wearing the result's colour. The "Not measured" badge beside the
                  name says the same thing and says it truthfully. */}
              {unmeasured ? null : (
                <span className={`${panel.pill} ${PILL_CLASS[rule.status]}`}>{rule.status}</span>
              )}
              <span className={panel.ruleBody}>
                <span className={panel.ruleHead}>
                  <span className={panel.ruleName}>{rule.label}</span>
                  {unmeasured ? <span className={panel.badge}>Not measured</span> : null}
                </span>
                {figures && (
                  <span className={panel.reading}>
                    <span className={panel.measured}>
                      {rule.source === 'assumed' ? 'Spec value' : 'Measured'} {figures.measured}
                    </span>
                    <span className={panel.required}>Required {figures.required}</span>
                  </span>
                )}
                {/* The engine's sentence earns its place on a rule that needs
                    something changed; on one that passes, the measured and
                    required figures already say everything there is to say. */}
                {(figures === null || rule.status !== 'pass') && (
                  <span className={panel.detail}>{rule.detail}</span>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <p className={styles.hint}>
        {measurement
          ? 'Every figure above was read from the rendered photo, at the size it prints.'
          : remeasuring
            ? 'The photo changed since this reading — re-measuring, and until it lands these are the spec’s advisory values, not your photo.'
            : 'Not measured yet — where a check says “Spec value”, that is the document’s own example, not your photo.'}
      </p>

      <details className={panel.rules}>
        <summary className={panel.rulesSummary}>What a {documentName} photo has to be</summary>
        <ul className={panel.rulesList}>
          {spec.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>

      <p className={styles.sectionTitle}>Print sheet</p>
      <SegmentedControl
        ariaLabel="Sheet size"
        options={sheetOptions()}
        value={sheet}
        onChange={(next) => setOutput({ sheet: next })}
      />
      <SheetFigure layout={layout} />
      <p className={styles.hint}>
        {sheetLabel} sheet · {mm(sheetMm.widthMm)} × {mm(sheetMm.heightMm)} mm · {layout.columns}{' '}
        across × {layout.rows} down, {mm(gapMm)} mm between photos.
      </p>
      <div style={{ marginTop: 8 }}>
        <Stepper
          label="Copies"
          value={copies}
          min={1}
          max={capacity}
          onChange={(value) => setRequest({ key: capacityKey, value })}
        />
      </div>
      <p className={styles.hint}>{copiesCaption}</p>
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => void handleSheet()}
          disabled={busy !== 'idle' || !source}
        >
          {busy === 'exporting' ? 'Building…' : 'Export sheet (PDF)'}
        </button>
      </div>
    </div>
  )
}

/** Swap the frame between portrait and landscape, keeping the spec's crop. */
function applyOrientation(
  next: FrameOrientation,
  spec: PassportSpec,
  previous: FrameOrientation,
): void {
  if (next === previous) return
  useDocStore.getState().update((current) => {
    const frame = orientedFrame(current, spec, next)
    return { ...current, output: frame.output, geometry: frame.geometry }
  })
}
