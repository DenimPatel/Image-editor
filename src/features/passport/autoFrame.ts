import type { NormRect, Point, Size } from '../../model/types'
import { clamp, mmToPx, pxToMm } from '../../lib/crop/geometry'
import { specGeometry, type PassportSpec } from './specs'

export type FaceLandmarks = {
  chin: Point
  crown: Point
  leftEye: Point
  rightEye: Point
}

export type AutoFrameResult = {
  crop: NormRect
  /** Chin-to-crown height in the output, in output pixels. */
  headHeightPx: number
  /** Eye line's distance from the bottom edge, in the same pixels. */
  eyeLineFromBottomPx: number
  /** Output pixels per source pixel. */
  scale: number
  /** The two measurements above as millimetres, which is what a spec declares. */
  headHeightMm: number
  eyeLineMmFromBottom: number
  /** Horizontal distance from the face axis to the frame centre, in mm. */
  centeredOffsetMm: number
  /**
   * Clear space between the top edge of the frame and the crown, in mm. The
   * shift guard makes this non-negative whenever the source has room to move;
   * a negative value would mean even a full-height frame cuts the crown off.
   */
  crownClearanceMm: number
}

/**
 * Frame a face for a passport spec.
 *
 * Everything is solved in **source pixels** and converted back to normalized at
 * the end, so the crop's pixel aspect is the spec's, not the frame's.
 *
 * Two things make the crown fit. The vertical placement targets the spec's
 * solved eye line (`specGeometry`) rather than the midpoint of a range that
 * cannot be honoured on its own, and the crop is then shifted — never resized —
 * if clamping against the edge of the source would have left the crown or the
 * chin outside. Resizing is what used to do it: a head that filled the frame
 * kept its scale and simply lost its top.
 */
export function autoFrame(
  landmarks: FaceLandmarks,
  spec: PassportSpec,
  source: Size,
): AutoFrameResult {
  const geometry = specGeometry(spec)
  const targetHeadPx = mmToPx(geometry.headMm, spec.dpi)
  const specWidthPx = mmToPx(spec.widthMm, spec.dpi)
  const specHeightPx = mmToPx(spec.heightMm, spec.dpi)

  const crownY = landmarks.crown.y * source.height
  const chinY = landmarks.chin.y * source.height
  const eyeY = ((landmarks.leftEye.y + landmarks.rightEye.y) / 2) * source.height
  const eyeMidX = ((landmarks.leftEye.x + landmarks.rightEye.x) / 2) * source.width

  const headPx = Math.abs(chinY - crownY)
  const scale = headPx > 0 ? targetHeadPx / headPx : 0

  const wantedW = scale > 0 ? specWidthPx / scale : source.width
  const wantedH = scale > 0 ? specHeightPx / scale : source.height
  const widthPx = Math.min(wantedW, source.width)
  const heightPx = Math.min(wantedH, source.height)

  const eyeFromBottomPx = scale > 0 ? mmToPx(geometry.eyeMm, spec.dpi) / scale : 0

  // The eye line sits `eyeFromBottomPx` above the bottom edge, so the frame's
  // bottom edge is that far below the eyes.
  const left = clamp(eyeMidX - widthPx / 2, 0, Math.max(0, source.width - widthPx))
  let top = clamp(eyeY + eyeFromBottomPx - heightPx, 0, Math.max(0, source.height - heightPx))

  // Shifting keeps the scale — and therefore the head size the spec asked for
  // — intact, which shrinking cannot. `heightPx` is at least the head height
  // (the spec's frame is never shorter than the head it asks for), so moving to
  // the crown and then to the chin cannot push the other one out.
  if (crownY < top) top = clamp(crownY, 0, Math.max(0, source.height - heightPx))
  if (chinY > top + heightPx)
    top = clamp(chinY - heightPx, 0, Math.max(0, source.height - heightPx))

  const crop: NormRect = {
    x: left / source.width,
    y: top / source.height,
    width: widthPx / source.width,
    height: heightPx / source.height,
  }

  const appliedScale = scale > 0 ? specWidthPx / widthPx : 0
  const headHeightMm = pxToMm(headPx * appliedScale, spec.dpi)
  const eyeFromBottom = Math.max(0, (top + heightPx - eyeY) * appliedScale)
  const centeredOffsetMm = pxToMm((eyeMidX - (left + widthPx / 2)) * appliedScale, spec.dpi)
  const crownClearanceMm = pxToMm((crownY - top) * appliedScale, spec.dpi)

  return {
    crop,
    headHeightPx: headPx * appliedScale,
    eyeLineFromBottomPx: eyeFromBottom,
    scale: appliedScale,
    headHeightMm,
    eyeLineMmFromBottom: pxToMm(eyeFromBottom, spec.dpi),
    centeredOffsetMm,
    crownClearanceMm,
  }
}
