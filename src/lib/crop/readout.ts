/**
 * The numbers the crop overlay shows, as pure strings. They used to be
 * computed in the component as `crop.width * effectiveOutputSize(fullDoc).width`
 * — i.e. after `output.resize` — so with a passport spec applied the overlay
 * said "300 x 300 px" while the export was 600 x 600 px. The crop's size is
 * the crop's size, in source pixels; the export size is a separate number and
 * is reported separately.
 */
import type { Doc, Size } from '../../model/types'
import { croppedPixelSize, resolveOutputSize } from '../sizing'
import { cropFrameSize, pxToMm } from './geometry'
import { ratioLabel } from './presets'

export type CropReadout = {
  /** Size of the selected crop in source pixels, before any output resize. */
  width: number
  height: number
  /** width / height of the crop in real pixels. */
  pixelAspect: number
  /** '1600 × 900 px' */
  pixels: string
  /** '16:9' for a ratio close to one, otherwise '1.78:1'. */
  ratio: string
  /** '12.0°' while the doc is straightened, otherwise null. */
  angle: string | null
  /** '42.3 × 23.8 mm' at the document DPI, otherwise null. */
  print: string | null
  /** '600 × 600 px' — what the export will actually write. */
  output: string
}

function sizeText(size: Size): string {
  return `${size.width} × ${size.height} px`
}

/**
 * The ratio, spelled the one way the crop panel spells it.
 *
 * This file used to hold a private `SIMPLE_RATIOS` — a copy of `presets.ts`'s
 * table missing `5:7` — so a 5:7 crop put `5:7` on the chip and `0.71:1` on the
 * canvas. A ratio the panel offers but the readout cannot name is a control that
 * contradicts its own readout, and the fix is not a second entry in the copy: it
 * is deleting the copy. `ratioLabel` is the same table the chips are selected
 * from and the same `RATIO_TOLERANCE`, so the two agree by construction.
 */
function ratioText(aspect: number): string {
  return ratioLabel(aspect)
}

/** Size of the whole straightened frame the crop is drawn over, in pixels. */
export function straightenedFrameSize(doc: Doc): Size {
  if (!doc.source) return { width: 1, height: 1 }
  return cropFrameSize(doc.source, doc.geometry.orientation, doc.geometry.straighten)
}

export function cropPixelReadout(doc: Doc): CropReadout {
  const crop = croppedPixelSize(doc)
  const pixelAspect = crop.height > 0 ? crop.width / crop.height : 0
  const dpi = doc.output.dpi
  const straighten = doc.geometry.straighten

  return {
    width: crop.width,
    height: crop.height,
    pixelAspect,
    pixels: sizeText(crop),
    ratio: ratioText(pixelAspect),
    angle: straighten === 0 ? null : `${straighten.toFixed(1)}°`,
    print:
      dpi > 0
        ? `${pxToMm(crop.width, dpi).toFixed(1)} × ${pxToMm(crop.height, dpi).toFixed(1)} mm`
        : null,
    output: sizeText(resolveOutputSize(doc)),
  }
}
