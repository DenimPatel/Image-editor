/**
 * Feeds `checkCompliance` from what can actually be observed.
 *
 * The panel used to pass `mid(spec)` for both measurable inputs and a literal
 * `0` for the offset, so three of five rules could never fail (D5-F12). This
 * module is the honest version: anything measured from the rendered photo is
 * marked `measured`, and anything the document merely *claims* is marked
 * `assumed` so the checklist can say which is which rather than implying a
 * verification that did not happen.
 */

import { parseHexColor } from '../../lib/hex-color'
import { pxToMm } from '../../lib/crop/geometry'
import { effectiveOutputSize } from '../../model/selectors'
import type { Doc, Size } from '../../model/types'
import type { ComplianceInput, ComplianceRuleId, ComplianceSource } from './compliance'
import type { PhotoMeasurement } from './measureFace'
import { specGeometry, type PassportSpec } from './specs'

export type ComplianceProvenance = Partial<Record<ComplianceRuleId, ComplianceSource>>

export type ComplianceInputResult = {
  input: ComplianceInput
  provenance: ComplianceProvenance
}

/** Face measurements that only mean something inside the spec's own frame. */
const HEAD_HEIGHT_RULES: ComplianceRuleId[] = ['head-height', 'eye-line', 'centring']
const BACKGROUND_RULES: ComplianceRuleId[] = [
  'background',
  'background-colour',
  'background-present',
]

/**
 * How far the output may sit from the frame it is supposed to fill before the
 * normalized landmarks stop meaning millimetres. `mmToPx` rounding alone moves
 * the ratio by well under a percent, so this only trips on a real mismatch.
 */
const FRAME_ASPECT_TOLERANCE = 0.01

function provenance(
  measured: ComplianceRuleId[],
  ok: boolean,
  out: ComplianceProvenance,
): ComplianceProvenance {
  for (const id of measured) out[id] = ok ? 'measured' : 'assumed'
  return out
}

/**
 * The millimetres the document is actually printing at. A passport frame can
 * be turned landscape, and then the spec's own `widthMm`/`heightMm` are the
 * *other* way round — comparing a correctly transposed 45×35 mm print against
 * the 35×45 mm spec failed a photo that was right (D5-F15).
 */
export function docFrameMm(doc: Doc, spec: PassportSpec) {
  const resize = doc.output.resize
  if (resize.mode === 'physical' && resize.widthMm > 0 && resize.heightMm > 0) {
    return { widthMm: resize.widthMm, heightMm: resize.heightMm }
  }
  return { widthMm: spec.widthMm, heightMm: spec.heightMm }
}

/** True when normalized photo coordinates convert to this frame's millimetres. */
function frameMatchesOutput(frame: { widthMm: number; heightMm: number }, output: Size): boolean {
  if (!(output.width > 0) || !(output.height > 0)) return false
  const wanted = frame.widthMm / frame.heightMm
  const actual = output.width / output.height
  return Math.abs(actual - wanted) / wanted <= FRAME_ASPECT_TOLERANCE
}

/**
 * Millimetres from the export canvas. The canvas *is* the cropped photo at the
 * spec's physical size, so normalized coordinates on it are millimetres times
 * the DPI and nothing else.
 */
function faceMeasurements(measurement: PhotoMeasurement, spec: PassportSpec, output: Size) {
  const face = measurement.face
  if (!face) return null
  const { crown, chin, leftEye, rightEye } = face.landmarks
  const eyeMidX = (leftEye.x + rightEye.x) / 2
  const eyeY = (leftEye.y + rightEye.y) / 2
  return {
    headHeightMm: pxToMm(Math.abs(chin.y - crown.y) * output.height, spec.dpi),
    eyeLineMmFromBottom: pxToMm((1 - eyeY) * output.height, spec.dpi),
    centeredOffsetMm: pxToMm((eyeMidX - 0.5) * output.width, spec.dpi),
  }
}

/**
 * Build the checklist input for a document. `measurement` is what
 * `measureCanvas` read off the rendered photo; without it the face rules fall
 * back to the spec's own advisory values and say so.
 *
 * A measurement is only usable when the output is the frame the spec asks for.
 * The panel holds the measurement across every later edit, so a 1:1 reading was
 * being scaled by whatever output happened to be current — a 600×600 square
 * reading re-measured against a 1271×810 16:9 export reported a 30.6 mm head
 * as 41.3 mm while still labelling the rule `measured` (D5-F12).
 */
export function complianceInputFor(
  doc: Doc,
  spec: PassportSpec,
  measurement: PhotoMeasurement | null,
  output: Size = effectiveOutputSize(doc),
): ComplianceInputResult {
  const sources: ComplianceProvenance = {}
  const geometry = specGeometry(spec)
  const frameMm = docFrameMm(doc, spec)
  const usable = frameMatchesOutput(frameMm, output)
  const face = measurement && usable ? faceMeasurements(measurement, spec, output) : null

  const background = measurement?.background ?? null
  const fallbackColor = doc.background.mode === 'color' ? parseHexColor(doc.background.color) : null

  const input: ComplianceInput = {
    spec,
    frameMm,
    headHeightMm: face?.headHeightMm ?? geometry.headMm,
    eyeLineMmFromBottom: face?.eyeLineMmFromBottom ?? geometry.eyeMm,
    centeredOffsetMm: face?.centeredOffsetMm ?? 0,
    outputWidthPx: output.width,
    outputHeightPx: output.height,
    backgroundUniformity: background?.uniformity ?? (fallbackColor ? 1 : 0),
    backgroundColor: background?.color ?? (fallbackColor ? to255(fallbackColor) : null),
    backgroundPresent: background?.present ?? doc.background.mode !== 'none',
    provenance: sources,
  }

  provenance(HEAD_HEIGHT_RULES, face !== null, sources)
  provenance(BACKGROUND_RULES, background !== null, sources)

  return { input, provenance: sources }
}

/** `parseHexColor` answers in 0..1; the compliance rules talk in 0..255. */
function to255(color: [number, number, number]) {
  return { r: color[0] * 255, g: color[1] * 255, b: color[2] * 255 }
}
