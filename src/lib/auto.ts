import type { Adjust, AdjustKey } from '../model/types'
import { ADJUST_SPEC_BY_KEY } from '../model/defaults'

export type Histogram = {
  luma: Uint32Array
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  total: number
}

function clampToSpec(key: AdjustKey, value: number): number {
  const spec = ADJUST_SPEC_BY_KEY[key]
  return Math.max(spec.min, Math.min(spec.max, value))
}

/** Histogram of an RGBA pixel buffer (4 bytes per pixel). */
export function buildHistogram(data: Uint8ClampedArray | number[]): Histogram {
  const luma = new Uint32Array(256)
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  let total = 0

  for (let i = 0; i + 3 < data.length; i += 4) {
    const rv = data[i]
    const gv = data[i + 1]
    const bv = data[i + 2]
    r[rv] += 1
    g[gv] += 1
    b[bv] += 1
    const lv = Math.max(0, Math.min(255, Math.round(0.2126 * rv + 0.7152 * gv + 0.0722 * bv)))
    luma[lv] += 1
    total += 1
  }

  return { luma, r, g, b, total }
}

/**
 * The keys `autoAdjust` owns. Everything else - saturation, vibrance, warmth,
 * tint, the three kernels - is the user's, and Auto leaves it alone.
 */
export const AUTO_ADJUST_KEYS = [
  'exposure',
  'brightness',
  'blackPoint',
  'contrast',
  'highlights',
  'shadows',
] as const satisfies readonly AdjustKey[]

/**
 * Where Auto puts the white point, as an sRGB-encoded 0..1 level. Just under
 * the top of the range so a bright sky lands on 245 rather than on a flat
 * 255 plateau.
 */
export const AUTO_WHITE_TARGET = 0.96

/**
 * Where the midtones are *allowed* to be pulled, again sRGB-encoded. This is a
 * bound, not a goal: exposure only ever darkens this far, because the white
 * point is the thing that decides whether an image is correctly exposed.
 */
export const AUTO_MID_TARGET = 0.22

/**
 * The share of the frame Auto is willing to push off either end of the range.
 * At 3% a brightening keeps some highlight or shadow detail, and the specular
 * pixels it loses are the ones no viewer would have resolved anyway.
 */
export const AUTO_CLIP_BUDGET = 0.03

/**
 * The tonal range, as a fraction of the full 0..1 scale, that counts as
 * "correctly exposed". Inside +/- `AUTO_CONTRAST_DEADZONE` of it Auto does
 * nothing: a full-range image and a slightly soft one are both fine, and
 * nudging either one is the noise this replaced.
 */
export const AUTO_RANGE_TARGET = 0.92
export const AUTO_CONTRAST_DEADZONE = 0.07

/**
 * The black level, as an sRGB-encoded level, that Auto treats as "this frame
 * has real blacks". Below it there is nothing to crush and Auto leaves
 * `blackPoint` at zero rather than inventing a lift.
 */
export const AUTO_BLACK_FLOOR = 0.06

/** The black level a fully lifted (hazy, fogged, scanned-flat) frame sits at. */
export const AUTO_BLACK_CEILING = 0.3

/**
 * The level below which a pixel reads as lost black rather than as shadow, and
 * the share of the frame that has to sit under it before Auto treats the
 * shadows as crushed rather than as deep.
 */
export const AUTO_CRUSHED_LEVEL = 0.02

/**
 * The share of the frame allowed to sit at each end before Auto calls it a
 * defect. Without a dead zone the two anchors fight: the white anchor puts the
 * 99th percentile exactly on `AUTO_WHITE_TARGET`, so a frame that was never
 * blown would still measure as blown the moment it was corrected.
 */
export const AUTO_BLOWN_BUDGET = 0.03
export const AUTO_BLACK_BUDGET = 0.025

/**
 * The level at which a highlight counts as *lost* rather than merely bright.
 *
 * This is the whole difference between "the sky is bright" and "the sky is
 * blown", and getting it wrong is visible: a beach photo whose white sky tops
 * out at 246 has no clipped pixels at all, so there is no detail for
 * `highlights` to recover — but measuring "blown" as the mass above the white
 * *target* (0.96) reported 35% of that frame as blown and Auto answered with
 * `highlights: -39`, turning a white sky into flat grey.
 *
 * 250/255 is the level to measure at because it is the last point with detail
 * below it: five 8-bit levels still separate 250 from 251, and past that a
 * highlight is a plateau whatever its exact value. A smooth sky peaking at 246
 * reads as clear; a plateau at 250 reads as blown.
 *
 * The budget still means a small specular does nothing: `AUTO_BLOWN_BUDGET` of
 * the frame has to be lost before `highlights` moves at all.
 */
export const AUTO_BLOWN_LEVEL = 0.98

/** Exposure step used by the clipping search. Fine enough to land on the spec grid. */
const EV_STEP = 0.01

function neutral(): Partial<Adjust> {
  return { exposure: 0, brightness: 0, blackPoint: 0, contrast: 0, highlights: 0, shadows: 0 }
}

/** The sRGB-encoded level of bin `i`, 0..1. */
function levelOf(i: number): number {
  return i / 255
}

/**
 * The level at `fraction` of the mass, walking from black up. This is the only
 * way Auto reads "how dark is this frame" and "how bright is it": the two
 * answers come from opposite ends of the histogram and cannot cancel, which is
 * what a single scalar lifted off the mean could not do.
 */
function percentileAt(hist: Uint32Array, total: number, fraction: number): number {
  if (total <= 0) return 0
  const target = Math.max(1, Math.round(fraction * total))
  let cumulative = 0
  for (let i = 0; i < 256; i += 1) {
    cumulative += hist[i]
    if (cumulative >= target) return levelOf(i)
  }
  return 1
}

type Scaled = { hist: Float64Array; clippedHigh: number; clippedLow: number; mean: number }

/**
 * The histogram as `TONE_FRAG` would leave it after `ev` stops of exposure.
 *
 * The shader multiplies *sRGB-encoded* components (`c *= exp2(u_exposure)`), so
 * the gain this models is applied to encoded levels. Anything measured in
 * linear light here would be an EV the shader does not implement, which is the
 * bias this function exists to remove.
 */
function scaleByExposure(hist: Uint32Array, total: number, ev: number): Scaled {
  const gain = Math.pow(2, ev)
  const out = new Float64Array(256)
  let clippedHigh = 0
  let clippedLow = 0
  let sum = 0
  for (let i = 0; i < 256; i += 1) {
    const count = hist[i]
    if (count === 0) continue
    const value = levelOf(i) * gain
    if (value > 1) {
      clippedHigh += count
      out[255] += count
      sum += count
    } else if (value < 0) {
      clippedLow += count
      out[0] += count
    } else {
      const bin = Math.round(value * 255)
      out[bin] += count
      sum += value * count
    }
  }
  return { hist: out, clippedHigh, clippedLow, mean: total > 0 ? sum / total : 0 }
}

function percentileOf(hist: Float64Array, total: number, fraction: number): number {
  if (total <= 0) return 0
  const target = Math.max(1, Math.round(fraction * total))
  let cumulative = 0
  for (let i = 0; i < 256; i += 1) {
    cumulative += hist[i]
    if (cumulative >= target) return levelOf(i)
  }
  return 1
}

/**
 * The exposure Auto settles on.
 *
 * Two independent anchors:
 *
 * - The **white point** says how bright the frame currently ends. Moving it to
 *   `AUTO_WHITE_TARGET` is the smallest change that makes the frame as bright as
 *   a correctly exposed frame is allowed to be, and it is the anchor that
 *   decides: a beach photo with a white sky is already correctly exposed, and
 *   a photo whose only bright pixels are clipped needs a lift, not a crush.
 * - The **midtones** say how far the frame is off, but only in the direction
 *   that darkens. Auto is not a grading tool: it must never be the reason a
 *   good photograph comes out dimmer than it went in.
 *
 * The midtone pull is then capped by how much clipping that would cost, so an
 * image already sitting on its white point is left alone however dark its
 * shadows are - its shadows are the scene's, not Auto's to invent.
 */
export function autoExposure(hist: Uint32Array, total: number): number {
  if (total <= 0) return 0
  const white = percentileAt(hist, total, 0.99)
  const mid = percentileAt(hist, total, 0.5)
  // A frame with no bright pixels at all still has a white point to place, so
  // the floor is the target rather than 1: otherwise a low-contrast image
  // reports a white point of 1 and no exposure is ever applied.
  const evWhite = Math.log2(AUTO_WHITE_TARGET / Math.max(AUTO_MID_TARGET, white))
  const evMid = Math.log2(AUTO_MID_TARGET / Math.max(0.02, mid))
  const evCeiling = clippingCeiling(hist, total)
  return clampToSpec('exposure', Math.min(Math.max(evWhite, evMid), evCeiling))
}

/**
 * The most exposure the frame can take before it starts clipping. Searching the
 * real histogram is what stops a dark frame from being lifted until its
 * speculars blow: the answer is whatever its own highlight mass allows, not a
 * constant.
 */
function clippingCeiling(hist: Uint32Array, total: number): number {
  const spec = ADJUST_SPEC_BY_KEY.exposure
  for (let ev = spec.max; ev >= spec.min; ev -= EV_STEP) {
    const scaled = scaleByExposure(hist, total, ev)
    if ((scaled.clippedHigh + scaled.clippedLow) / total <= AUTO_CLIP_BUDGET) return ev
  }
  return spec.min
}

/**
 * Share of the frame sitting at or above `level`.
 *
 * Takes either a source histogram or an exposure-scaled one: `blown` is read off
 * the source (that is where the clipping happened) while `crushed` is read off
 * the scaled one (that is where the shadow loss is), so the two answers have to
 * come from different arrays.
 */
function massAbove(hist: Uint32Array | Float64Array, total: number, level: number): number {
  if (total <= 0) return 0
  const first = Math.max(0, Math.min(255, Math.ceil(level * 255)))
  let mass = 0
  for (let i = first; i < 256; i += 1) mass += hist[i]
  return mass / total
}

/** Share of the frame sitting at or below `level`, after the chosen exposure. */
function massBelow(hist: Float64Array, total: number, level: number): number {
  if (total <= 0) return 0
  const last = Math.max(0, Math.min(255, Math.floor(level * 255)))
  let mass = 0
  for (let i = 0; i <= last; i += 1) mass += hist[i]
  return mass / total
}

/**
 * Which of the six sliders Auto actually moved, in panel order.
 *
 * `autoAdjust` always returns all six keys, most of them at zero, so "Auto
 * applied" is technically true and practically empty: it says that something
 * happened to a control the user cannot see behind the toast. What they want to
 * know is which sliders moved, so they can undo the one they did not want — and
 * a toast that named only the first three of them would be worse than none,
 * because it would point at the wrong dial.
 *
 * Pure, and in this module because it is the same fact as `AUTO_ADJUST_KEYS`:
 * Auto's reach and what Auto changed are two answers to one question, and they
 * are compared against each other here rather than restated by a caller. A key
 * Auto does not own is never reported, whatever the document says about it.
 *
 * The tolerance is a rounding one, not a perceptual one. `autoAdjust` writes
 * whole numbers onto a slider whose steps are whole numbers, so an exact
 * comparison would be enough; `0.005` is here because a future value that lands
 * a hundredth of a step short of its own start would otherwise show a slider
 * moving to where it already was.
 */
export function autoChangedKeys(before: Partial<Adjust>, after: Partial<Adjust>): AdjustKey[] {
  return AUTO_ADJUST_KEYS.filter((key) => Math.abs((after[key] ?? 0) - (before[key] ?? 0)) > 0.005)
}

/**
 * A single button that reads the whole frame and writes six sliders, one from
 * each end of the histogram:
 *
 * | slider       | measured from                                   |
 * | ------------ | ----------------------------------------------- |
 * | `exposure`   | the 99th percentile, bounded by the median       |
 * | `blackPoint` | the 0.5th percentile after that exposure          |
 * | `contrast`   | the 99th-minus-1st percentile spread             |
 * | `highlights` | the mass sitting above the top of the range       |
 * | `shadows`    | the mass sitting below the bottom of the range    |
 * | `brightness` | nothing - exposure owns the overall level        |
 *
 * The measurements are drawn from opposite ends of the histogram, so a frame
 * that needs a shadow lift does not also get its highlights pulled and its
 * blacks crushed. That independence is the whole point: deriving every value
 * from one signed distance off the mean made a dark photo get six corrections
 * in the same direction and destroyed it.
 */
export function autoAdjust(histogram: Histogram): Partial<Adjust> {
  const total = histogram.total
  if (total <= 0) return neutral()

  const exposure = autoExposure(histogram.luma, total)
  const scaled = scaleByExposure(histogram.luma, total, exposure)
  const post = scaled.hist

  const blackFloor = percentileOf(post, total, 0.005)
  const low = percentileOf(post, total, 0.01)
  const high = percentileOf(post, total, 0.99)
  // A frame is "blown" from where detail is actually gone, not from where the
  // white anchor wants it: see AUTO_BLOWN_LEVEL. Read it off the *source*
  // histogram, not the exposure-corrected one — the correction is what erases
  // the evidence. Auto's own white anchor lands a clipped plateau on
  // `AUTO_WHITE_TARGET`, which is below the blown level, so measuring after
  // exposure would make `highlights` unreachable for the one case it exists for.
  const blown = massAbove(histogram.luma, total, AUTO_BLOWN_LEVEL)
  const crushed = massBelow(post, total, AUTO_CRUSHED_LEVEL)

  const blackSpan = AUTO_BLACK_CEILING - AUTO_BLACK_FLOOR
  const range = high - low
  const contrastGap = AUTO_RANGE_TARGET - range

  return {
    exposure: clampToSpec('exposure', exposure),
    brightness: 0,
    blackPoint: clampToSpec(
      'blackPoint',
      // One-sided: Auto crushes a lifted floor, and never *lifts* real blacks.
      blackFloor <= AUTO_BLACK_FLOOR ? 0 : ((blackFloor - AUTO_BLACK_FLOOR) / blackSpan) * 100,
    ),
    contrast: clampToSpec(
      'contrast',
      Math.abs(contrastGap) <= AUTO_CONTRAST_DEADZONE ? 0 : contrastGap * 150,
    ),
    highlights: clampToSpec(
      'highlights',
      blown <= AUTO_BLOWN_BUDGET ? 0 : -120 * (blown - AUTO_BLOWN_BUDGET),
    ),
    shadows: clampToSpec(
      'shadows',
      crushed <= AUTO_BLACK_BUDGET ? 0 : 50 * Math.sqrt((crushed - AUTO_BLACK_BUDGET) / 0.78),
    ),
  }
}
