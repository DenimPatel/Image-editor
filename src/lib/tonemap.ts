/**
 * CPU twin of the tone-stage and output-stage maths in
 * `src/gl/shaders/index.ts`, so the GL transfer functions can be reasoned about
 * (and regression-tested) without a GPU. Every value here operates on
 * sRGB-encoded 0..1 components, matching both backends.
 */

export const BLACK_POINT_STRENGTH = 0.2

/**
 * Rec.709 luma weights, the `luma()` in the shader `HEADER`. Read out of one
 * place so `whiteBalance` and its GLSL twin cannot drift apart on a constant.
 */
export const LUMA_WEIGHTS: readonly [number, number, number] = [0.2126, 0.7152, 0.0722]

/** Guards both divides in `whiteBalance`; below this a pixel is already black. */
const WHITE_BALANCE_EPSILON = 1e-6

/**
 * Black point, the mirror of the two `TONE_FRAG` lines that implement it.
 *
 * `blackPoint` is the normalized -1..1 slider value (`adjust.blackPoint / 100`).
 * Raising it must *crush* the blacks, lowering it must *lift* them:
 *
 *   positive: (c - k) / (1 - k), k > 0 — 0 maps below 0, 1 is a fixed point
 *   negative: (c + k) / (1 + k) — 1 is a fixed point, 0 rises above 0
 *
 * The slope is `1 / (1 - k) > 0` for every reachable `k`, so the curve is
 * strictly increasing and never reorders two input levels. The divisor is
 * floored at 0.05 purely as a guard against a divide-by-zero if the strength
 * ever exceeds 1.
 */
export function blackPointTransfer(value: number, blackPoint: number): number {
  const offset = blackPoint * BLACK_POINT_STRENGTH
  return (value - offset) / Math.max(1 - offset, 0.05)
}

/**
 * D4-F07: one decorrelated white-balance step.
 *
 * `delta` is the change in Rec.709 luma the shadows or highlights slider is
 * asking for. The old code added that same scalar to R, G and B, which is a
 * luminance shift wearing a colour grade's clothes — the channels keep their
 * differences, so the pixel desaturates toward its own grey, and the moment a
 * channel clips the differences stop being what they were and the hue turns
 * outright. A blue sky lifting its shadows came out 4 degrees closer to violet.
 *
 * Here the whole pixel is scaled by one gain instead, so every channel moves by
 * its *own* share of the luma. Two properties follow:
 *
 *  - the channel ratios are untouched, so the hue is preserved exactly, up to
 *    the gamut bound below;
 *  - the luma moves by exactly `delta`, since `luma(c) * gain == luma(c) + delta`.
 *    That is the energy claim: the step spends what it was asked to spend and
 *    not a byte more.
 *
 * The gain is capped at the headroom the pixel has left. For a pixel under full
 * scale that is `1 / peak`, the largest scale at which no channel is pushed
 * past 1.0: clamping instead would desaturate and rotate the hue, and scaling
 * the pixel back down to make room would *darken* the very shadows the slider
 * is trying to lift, so the push is simply refused. For a pixel already past
 * full scale the headroom is 1 — it may not be pushed further, but it must not
 * be dragged back either, or a neutral `delta` of zero would quietly rescale
 * every blown pixel and leave the filmic shoulder nothing to compress.
 */
export function whiteBalance(
  rgb: readonly [number, number, number],
  luma: number,
  delta: number,
): [number, number, number] {
  const gain = 1 + delta / Math.max(luma, WHITE_BALANCE_EPSILON)
  const peak = Math.max(rgb[0], rgb[1], rgb[2], WHITE_BALANCE_EPSILON)
  const scale = Math.min(Math.max(gain, 0), Math.max(1, 1 / peak))
  return [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale]
}

/**
 * Where the filmic shoulder starts compressing: full scale itself, so nothing
 * the user can still see detail in is touched. `scripts/lut-looks.mjs` bakes the
 * same two constants into the 24 shipped looks.
 */
export const SHOULDER_KNEE = 1

/**
 * How far past full scale the rolloff can push a value, in the same 0..1 units
 * the rest of the tone stage works in. It is the ceiling of the compressed
 * range, so the curve still resolves 1.25 from 1.5 from 2.0 — the whole blown
 * range is squeezed into 14% of headroom above a pixel that was already white,
 * and the clamp on the end of the pass has nothing left to flatten.
 */
export const SHOULDER_HEADROOM = 0.14

/**
 * D3-F23: the highlight rolloff, the same operator `scripts/lut-looks.mjs`
 * bakes into the looks — the identity up to full scale, then a rolloff with
 * unit slope at 1.0 that asymptotes to 1 + `SHOULDER_HEADROOM`.
 *
 * The knee *is* full scale. It has to be: an exponential that asymptotes at 1
 * arrives at it by definition, so anchoring it anywhere below 1 puts the
 * asymptote below the pixel's own value — a 0.86 knee turned a pure-white sky
 * into 0.9485, 242/255, in every document with a tone adjustment on. The
 * rolloff can only be the identity below 1 *and* approach 1 from above, so 1.0
 * is where it starts.
 *
 * It lives on the tone stage because that is the only pass that runs values
 * past 1.0: exposure, brightness and contrast all can, and today each of them
 * ends in a hard `clamp`, so 1.05 and 4.0 are the same pixel. Here they are
 * seven different ones. `min(x, 1)` has a flat top by construction — this
 * curve keeps rising, forever, approaching `1 + SHOULDER_HEADROOM` and never
 * crossing it, so the blowout still separates where a clip merges it while a
 * pure-white pixel is handed to the clamp already at 1.
 */
export function filmicShoulder(value: number): number {
  const rolled =
    SHOULDER_KNEE +
    SHOULDER_HEADROOM * (1 - Math.exp(-Math.max(value - SHOULDER_KNEE, 0) / SHOULDER_HEADROOM))
  // `mix(x, rolled, step(knee, x))` is the ternary, spelled so the GLSL twin is
  // one line: below the knee this returns `x` bit for bit, at the knee both
  // arms agree (`1 - exp(0)` is exactly 0), and the exp() above is evaluated
  // harmlessly either way.
  return value <= SHOULDER_KNEE ? value : rolled
}

/** Dither amplitude, in 8-bit output levels. One LSB is the whole point. */
export const DITHER_LSB = 1

/** The ordered matrix is 8x8, so a period covers eight pixels a side. */
export const DITHER_MATRIX_SIDE = 8

/**
 * D3-F23: an 8x8 *ordered* (Bayer) dither threshold at a top-down output
 * pixel, in `0..1`. Built from the recursive rule `M(a) = 2a + (a xor b)` per
 * level rather than a lookup table, so the GLSL twin is arithmetic both
 * engines can do exactly — no integer ops, no array indexing, no transpose for
 * someone to get wrong.
 *
 * Ordered rather than random because random dither trades a band for noise,
 * which is a different artefact. This one disperses the quantisation error to
 * the highest frequency the matrix can reach and leaves a one-LSB checker the
 * eye resolves as a smooth ramp.
 */
export function ditherThreshold(x: number, y: number): number {
  let value = 0
  let qx = Math.floor(x)
  let qy = Math.floor(y)
  for (let level = 0; level < 3; level += 1) {
    const bx = qx % 2
    const by = qy % 2
    qx = Math.floor(qx / 2)
    qy = Math.floor(qy / 2)
    // `by + bx - 2 * by * bx` is the xor of two 0/1 values.
    value = value * 4 + 2 * by + (by + bx - 2 * by * bx)
  }
  return (value + 0.5) / 64
}

/**
 * The dither offset in 8-bit output levels, centred on zero and spanning
 * `+/- amount / 2`, so `amount = 1` is one full LSB of headroom in each
 * direction and the quantised result can never be more than one step further
 * from the ideal than plain rounding already is.
 */
export function ditherOffsetLsb(x: number, y: number, amount = DITHER_LSB): number {
  return (ditherThreshold(x, y) - 0.5) * amount
}
