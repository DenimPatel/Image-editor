/**
 * Portrait/landscape for the passport frame (D5-F15).
 *
 * Every spec in `PASSPORT_SPECS` is portrait and there was no control that
 * could say otherwise, so a 45×35 mm landscape print — which is what a counter
 * or a lanyard pass actually wants — was impossible to produce. The swap
 * transposes the millimetres, inverts the aspect lock and transposes the crop
 * with it, so the same content stays selected after the frame turns.
 */

import { constrainToAspect } from '../../lib/crop/geometry'
import type { Doc, NormRect } from '../../model/types'
import type { PassportSpec } from './specs'

export type FrameOrientation = 'portrait' | 'landscape'

export function isLandscape(spec: PassportSpec, orientation: FrameOrientation): boolean {
  return orientation === 'landscape' && spec.widthMm !== spec.heightMm
}

/** The spec's own millimetres, transposed for a landscape print. */
export function specFrameMm(spec: PassportSpec, orientation: FrameOrientation) {
  return orientation === 'landscape'
    ? { widthMm: spec.heightMm, heightMm: spec.widthMm }
    : { widthMm: spec.widthMm, heightMm: spec.heightMm }
}

export function transposedRect(crop: NormRect): NormRect {
  return { x: crop.y, y: crop.x, width: crop.height, height: crop.width }
}

/**
 * The document fields a frame swap writes. Kept separate from the store call
 * so the arithmetic is testable without a store, and so the panel applies the
 * whole swap as one undoable edit rather than three.
 */
export function orientedFrame(doc: Doc, spec: PassportSpec, orientation: FrameOrientation) {
  const frame = specFrameMm(spec, orientation)
  const aspect = frame.widthMm / frame.heightMm
  return {
    output: {
      ...doc.output,
      dpi: spec.dpi,
      resize: {
        mode: 'physical' as const,
        widthMm: frame.widthMm,
        heightMm: frame.heightMm,
        dpi: spec.dpi,
      },
    },
    geometry: {
      ...doc.geometry,
      aspectLock: aspect,
      crop:
        orientation === 'landscape'
          ? constrainToAspect(transposedRect(doc.geometry.crop), aspect, {
              frame: doc.source ?? undefined,
            })
          : constrainToAspect(doc.geometry.crop, aspect, { frame: doc.source ?? undefined }),
    },
  }
}
