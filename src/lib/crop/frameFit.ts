/**
 * The box an image is drawn in — and therefore the box every overlay that claims
 * to be pointing at that image has to be drawn in.
 *
 * `useRenderLoop` sizes the presentation canvas from this and `CropOverlay` sizes
 * the crop frame from this, and they are the same function rather than two copies
 * of `container - 32` because the difference is not cosmetic: while the Crop tool
 * is open the preview deliberately drops the crop so the box has the pixels it
 * discards around it, and the overlay draws that box in whole-frame coordinates.
 * An overlay fitted a single pixel differently from the canvas is a crop box whose
 * corners are on the wrong pixels, which is what
 * `e2e/journey.crop-preview.spec.ts` exists to catch.
 *
 * Pure, so both consumers can be held to it by one unit test instead of two
 * measurements that have to be compared in a browser.
 */
import type { Size } from '../../model/types'

/** Air between the image and the edge of the area it is fitted into, per side. */
export const FRAME_PADDING = 16

export type FrameFit = {
  /** The image as drawn, in CSS px. */
  width: number
  height: number
  /** The factor both of those are the source size multiplied by. */
  scale: number
}

/** Fit `frame` into `area`, preserving its aspect. Both in CSS px. */
export function cropFrameFit(frame: Size, area: Size): FrameFit {
  const frameW = Math.max(1, frame.width)
  const frameH = Math.max(1, frame.height)
  const availableW = Math.max(1, area.width - 2 * FRAME_PADDING)
  const availableH = Math.max(1, area.height - 2 * FRAME_PADDING)
  const scale = Math.min(availableW / frameW, availableH / frameH)
  return { width: Math.max(1, frameW * scale), height: Math.max(1, frameH * scale), scale }
}
