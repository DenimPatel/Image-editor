/**
 * On-canvas guide geometry for the ID Photobooth.
 *
 * The fractions a spec publishes — the eye line's distance from the bottom, the
 * head's height — are relative to the *passport frame*, so they are only
 * percentages of the crop box once the crop is that frame. The overlay used to
 * draw them against the whole image (`PassportGuides` was a child of
 * `.imageFrame` with `inset: 0`), which put every line at the wrong height
 * unless the crop happened to be the entire photo (D5-F10). Everything here is
 * therefore expressed as a fraction **of the crop**, and taking the crop as an
 * argument is what makes the overlay positionable rather than decorative.
 */

import type { NormRect } from '../../model/types'
import { specGeometry, type PassportSpec } from './specs'

const FULL: NormRect = { x: 0, y: 0, width: 1, height: 1 }

export type GuideLineKind = 'advisory' | 'bound'

export type GuideLine = {
  id: 'eye-advisory' | 'eye-min' | 'eye-max'
  kind: GuideLineKind
  /** Distance from the top of the crop, 0..1. */
  fromTop: number
  /** The spec figure this line is, in millimetres from the bottom. */
  labelMm: number
  label: string
}

export type GuideLayout = {
  /** Crown-to-chin band, as a fraction of the crop. */
  band: { fromTop: number; height: number }
  lines: GuideLine[]
  /** Set when the spec's own numbers cannot place a head in its own frame. */
  warning: string | null
}

/** Frame fraction -> crop fraction. */
function intoCrop(fraction: number, crop: NormRect): number {
  return (fraction - crop.y) / Math.max(1e-6, crop.height)
}

export function guideLayout(spec: PassportSpec, crop: NormRect = FULL): GuideLayout {
  const geometry = specGeometry(spec)
  const height = spec.heightMm
  const mm = (value: number) => value.toFixed(1)

  const band: GuideLayout['band'] = {
    fromTop: intoCrop(1 - geometry.crownMm / height, crop),
    height: geometry.headMm / height / Math.max(1e-6, crop.height),
  }

  const lines: GuideLine[] = [
    {
      id: 'eye-advisory',
      kind: 'advisory',
      fromTop: intoCrop(1 - geometry.eyeMm / height, crop),
      labelMm: geometry.eyeMm,
      label: `eye ${mm(geometry.eyeMm)} mm`,
    },
    {
      id: 'eye-min',
      kind: 'bound',
      fromTop: intoCrop(1 - spec.eyeLineMmFromBottom.max / height, crop),
      labelMm: spec.eyeLineMmFromBottom.max,
      label: `max ${mm(spec.eyeLineMmFromBottom.max)} mm`,
    },
    {
      id: 'eye-max',
      kind: 'bound',
      fromTop: intoCrop(1 - spec.eyeLineMmFromBottom.min / height, crop),
      labelMm: spec.eyeLineMmFromBottom.min,
      label: `min ${mm(spec.eyeLineMmFromBottom.min)} mm`,
    },
  ]

  const warning = geometry.degenerate
    ? `${spec.label}: a ${geometry.headMm.toFixed(1)} mm head cannot clear a ${height} mm frame at these eye-line figures.`
    : null

  return { band, lines, warning }
}
