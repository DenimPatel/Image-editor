/* eslint-disable react-refresh/only-export-components -- an icon module is a
   catalogue, not a stateful component tree: there is no hook state to lose on a hot
   reload, and splitting the lookups away from the marks they name would make the
   system harder to read, not easier. */
import type { AdjustKey } from '../../../model/types'
import { icon, type IconComponent, type IconProps } from './base'

/**
 * One glyph per `ADJUST_SPECS` entry, exported as a lookup rather than fifteen
 * imports.
 *
 * `ParameterRow` used to render a single slider-meter glyph fifteen times, in
 * a `role="toolbar"` where the only thing separating Exposure from Vignette was
 * a 12px label. Worse than blank, because the glyph looked meaningful: the eye
 * went to it and found nothing there.
 *
 * The panel is scanned, not read, so the marks work by silhouette and are
 * designed to be told apart at 42px inside a circular progress ring. Two
 * constraints follow from that:
 *
 *  1. Every mark lives inside roughly a 10-unit radius of the centre, because
 *     the ring is a circle and anything on the diagonals of the 24 grid runs
 *     under its stroke.
 *  2. Where two adjustments are one axis — Highlights/Shadows, Warmth/Tint —
 *     they share a skeleton and differ only in *which end is filled*, because
 *     that is what the slider does.
 */

/** Aperture: six blades around an open centre. The one radial mark in the set. */
const exposureGlyph = icon(
  <>
    <polygon points="12 4.5 18.37 8.25 18.37 15.75 12 19.5 5.63 15.75 5.63 8.25" />
    <circle cx="12" cy="12" r="2.6" />
    <line x1="12" y1="4.5" x2="12" y2="9.4" />
    <line x1="18.37" y1="8.25" x2="14.25" y2="10.7" />
    <line x1="18.37" y1="15.75" x2="14.25" y2="13.3" />
    <line x1="12" y1="19.5" x2="12" y2="14.6" />
    <line x1="5.63" y1="15.75" x2="9.75" y2="13.3" />
    <line x1="5.63" y1="8.25" x2="9.75" y2="10.7" />
  </>,
)

/**
 * A lift weighted to the midtones (`brilliance * 0.25 * mid` in
 * `render/cpu-passes.ts`), so: a flat baseline with a bump in the middle and
 * the ends untouched.
 */
const brillianceGlyph = icon(
  <>
    <path d="M4.5 17Q12 6 19.5 17" />
    <line x1="2.5" y1="17" x2="21.5" y2="17" />
  </>,
)

/**
 * A three-band tonal bar: shadows, midtones, highlights. Highlights and
 * Shadows are the two ends of one axis, so they are one drawing with one end
 * filled — top band for Highlights, bottom band for Shadows. The band order
 * matches the bar order in every histogram in the app, so the mark is read
 * against the same mental image the histogram draws.
 */
const tonalBar = (bandY: number) => (
  <>
    <rect x="5.5" y="4.5" width="13" height="15" rx="1.5" />
    <line x1="5.5" y1="9.5" x2="18.5" y2="9.5" />
    <line x1="5.5" y1="14.5" x2="18.5" y2="14.5" />
    <rect x="6.5" y={bandY} width="11" height="3" rx="1" fill="currentColor" stroke="none" />
  </>
)

const highlightsGlyph = icon(tonalBar(5.5))
const shadowsGlyph = icon(tonalBar(15.5))

/** The classic S on a square: global contrast, ends flattened, midtones steepened. */
const contrastGlyph = icon(
  <>
    <rect x="4" y="4" width="16" height="16" rx="1.5" />
    <path d="M7 17C10.5 17 9.5 7 17 7" />
  </>,
)

/** Half a tone card. A disc, not a curve — nothing else in the set is round and half-filled. */
const brightnessGlyph = icon(
  <>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" stroke="none" />
  </>,
)

/** The tone ramp starting partway along the axis: the floor of the image has moved up. */
const blackPointGlyph = icon(
  <>
    <line x1="3" y1="19" x2="21" y2="19" />
    <line x1="3" y1="19" x2="3" y2="12" />
    <line x1="5.5" y1="15.5" x2="10.5" y2="15.5" />
    <path d="M8 19H19L8 8Z" fill="currentColor" stroke="none" />
    <line x1="8" y1="8" x2="19" y2="19" />
  </>,
)

/** A full drop of colour. */
const saturationGlyph = icon(
  <path
    d="M12 4.5c3.4 3.8 5.5 6.5 5.5 9.1a5.5 5.5 0 0 1-11 0c0-2.6 2.1-5.3 5.5-9.1z"
    fill="currentColor"
    stroke="none"
  />,
)

/**
 * Saturation's neighbour, and the pair that was worst: they sit next to each
 * other in the panel and no user knows the difference. Saturation is a solid
 * drop — every pixel pushed the same amount. Vibrance is the same drop with
 * three ascending bars inside it: the weak ones lifted, the strong ones left
 * alone. Solid versus measured, in the same container, so the two are read
 * against each other rather than in isolation.
 */
const vibranceGlyph = icon(
  <>
    <path d="M12 4.5c3.4 3.8 5.5 6.5 5.5 9.1a5.5 5.5 0 0 1-11 0c0-2.6 2.1-5.3 5.5-9.1z" />
    <rect x="8.2" y="15.4" width="2.2" height="2.8" fill="currentColor" stroke="none" />
    <rect x="10.9" y="13.4" width="2.2" height="4.8" fill="currentColor" stroke="none" />
    <rect x="13.6" y="11.4" width="2.2" height="6.8" fill="currentColor" stroke="none" />
  </>,
)

/**
 * Warmth and Tint are two axes of the same thing — colour temperature and the
 * green/magenta axis — so both are drawn as the same wheel, and the mark
 * carries the axis: a filled *region* of the wheel for Warmth (one end of one
 * axis, hot side) against a filled *diameter* for Tint (an axis with two ends,
 * green and magenta).
 */
const warmthGlyph = icon(
  <>
    <circle cx="12" cy="12" r="7.5" />
    <path
      d="M12 12L14.57 4.95A7.5 7.5 0 0 1 19.38 10.7L15.45 11.39Z"
      fill="currentColor"
      stroke="none"
    />
  </>,
)

const tintGlyph = icon(
  <>
    <circle cx="12" cy="12" r="7.5" />
    <rect x="10.25" y="4.5" width="3.5" height="15" rx="1.75" fill="currentColor" stroke="none" />
  </>,
)

/** Two tone fields meeting at one hard seam, with the seam itself emphasised. */
const sharpnessGlyph = icon(
  <>
    <rect x="4" y="5" width="16" height="14" rx="1" />
    <rect x="5" y="6" width="7" height="12" fill="currentColor" stroke="none" />
    <line x1="12" y1="3" x2="12" y2="21" />
  </>,
)

/**
 * Fine structure, not a hard edge: a small hard-edged square inside a soft
 * rounded one — one small area, defined. (This was three nested arcs, which
 * turned out to be the Wi-Fi mark; concentric squares are the only nested
 * shape nothing else in the system uses.)
 */
const definitionGlyph = icon(
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <rect x="9" y="9" width="6" height="6" />
  </>,
)

/** Grain on the left, two clean sweeps on the right: the speckle taken out. */
const noiseReductionGlyph = icon(
  <>
    <circle cx="5.4" cy="8.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8.4" cy="6.6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.4" cy="13.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="5.2" cy="15.4" r="1.2" fill="currentColor" stroke="none" />
    <path d="M13.5 8.5c2.4-2.4 4.6 2.4 7 0" />
    <path d="M13.5 15.5c2.4-2.4 4.6 2.4 7 0" />
  </>,
)

/** The frame closing in from the corners. */
const vignetteGlyph = icon(
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M8 5.5H5.5V8M16 5.5h2.5V8M8 18.5H5.5V16M16 18.5h2.5V16" />
  </>,
)

/**
 * Keyed by `AdjustKey`, so the map is total by construction: add a spec to
 * `ADJUST_SPECS` and this stops compiling; delete one and the row stops
 * rendering a mark. A test asserts the same thing at runtime against the
 * imported list, so the two cannot drift.
 */
export const ADJUST_GLYPHS: Record<AdjustKey, IconComponent> = {
  exposure: exposureGlyph,
  brilliance: brillianceGlyph,
  highlights: highlightsGlyph,
  shadows: shadowsGlyph,
  contrast: contrastGlyph,
  brightness: brightnessGlyph,
  blackPoint: blackPointGlyph,
  saturation: saturationGlyph,
  vibrance: vibranceGlyph,
  warmth: warmthGlyph,
  tint: tintGlyph,
  sharpness: sharpnessGlyph,
  definition: definitionGlyph,
  noiseReduction: noiseReductionGlyph,
  vignette: vignetteGlyph,
}

/**
 * The mark for one adjustment. Takes the spec rather than a key so a caller
 * that already holds a spec cannot pass the wrong one, and so nothing here has
 * to be kept in step with the panel by hand.
 */
export function AdjustIcon({ spec, ...rest }: { spec: { key: AdjustKey } } & IconProps) {
  const Glyph = ADJUST_GLYPHS[spec.key]
  return <Glyph {...rest} />
}
