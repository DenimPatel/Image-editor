/**
 * The subject every look thumbnail is graded over — and the thumbnail raster.
 *
 * ── why a scene and not a swatch ────────────────────────────────────────────
 * A look is a *grade*, so the only thing that can show a grade is a picture with
 * a range of subjects in it: a cool sky and warm skin in the same frame is what
 * makes "Teal & Orange" mean anything, and it is the only way a split-tone's
 * shadow tint is visible at all. A flat colour swatch shows what the look does
 * to exactly one RGB triple; a grey ramp shows only the tone curve. Both are
 * unreadable as a preview.
 *
 * ── why *this* scene ───────────────────────────────────────────────────────
 * The first version of this file was a backlit portrait in a landscape: one
 * mid-tone ramp in three or four related hues. It graded correctly — the
 * thumbnails predicted the applied result — but it did not *separate* the
 * catalogue. Measured on that scene, `Vista` and `Faded Matte` came out
 * 1.7/255 apart and `Polaroid` and `Vintage Fade` 2.9/255, against 4.5/255 and
 * 4.7/255 when the same two looks were applied to a real photograph: the scene
 * compressed every pair by about a third, so twenty-four chips read as "the
 * same faded photo" side by side even though the grades were measurably
 * different.
 *
 * A grade separates on *hue* far more readily than on luma, because a warm/cool
 * split moves red and blue in opposite directions while two mid-grey ramps move
 * together. So the subject is built to carry hues at *separated luminances*:
 *
 *   - a **blue sky**, deep azure at the zenith grading to a pale cyan haze at
 *     the roofline, with the sun as a hard disc inside a wide halo — cool, and
 *     the frame's highlight;
 *   - a **neutral wall**, the biggest region in frame, running from sunlit
 *     off-white at the top through a mid grey to a shadowed band at the bottom.
 *     It is the reference patch: it is the only region a white balance can be
 *     read against, and it is deliberately *achromatic*, so a look that shifts
 *     its white point moves this wall and nothing else;
 *   - a **red subject** — a painted door panel, the one large saturated mass in
 *     frame — lit on its left edge and shadowed on its right, so white balance
 *     and the tone curve are both legible on it;
 *   - a **near-black doorway** beside it, the deepest value in frame and the
 *     region a split tone tints hardest;
 *   - three **warm yellow windows**, a saturated accent at a high luminance —
 *     the pair (warm, bright) that the sky alone cannot supply;
 *   - a **green hedge** across the bottom, saturated and cool — the pair (cool,
 *     dark) that the wall alone cannot supply;
 *   - a dark **roofline** silhouette, which keeps the frame reading as a
 *     photograph of a place rather than as a diagram of six rectangles, and is
 *     the horizon a gradient has to run into.
 *
 * Blue, neutral, red, yellow, green, black: six hues at six different
 * luminances. That is what makes the chips comparable, and it is measured —
 * `scripts/lut-looks.test.mjs` asserts the property the scene exists for, and
 * the numbers come out of this file.
 *
 * ── determinism ────────────────────────────────────────────────────────────
 * Every one of the 24 thumbnails is the grade of the *identical* scene, so the
 * grid is a contact sheet and any difference between two chips is the look. The
 * scene is a pure function of `(x, y)`: no RNG, no clock, no sampling of a real
 * photograph, and no `Math.sin`-based value noise (`Math.sin` is
 * implementation-approximated, so it is not portable enough to hang a
 * `--check` byte-compare on). The one high-frequency texture is an integer hash
 * built from `Math.imul`, which ECMAScript specifies exactly.
 */

import { LUT_IDS, grade, lookById } from './lut-looks.mjs'
import { encodeRgbPng } from './png.mjs'

/**
 * 144 x 96 is 2x the 72 x 48 CSS box `lookThumb.module.css` renders it in, and
 * 3:2 — the aspect a 72px-wide chip can afford next to its label without the
 * grid turning into a wall. `THUMB_ASPECT` is the same number in CSS.
 */
export const THUMB_WIDTH = 144
export const THUMB_HEIGHT = 96

/** Every look gets a thumbnail, and the set is the LUT catalogue, not a list here. */
export const THUMB_IDS = LUT_IDS

// ── geometry, in normalised frame coordinates (u right, v down) ─────────────

/** Where the wall's roofline sits; the sky is everything above it. */
const ROOF = 0.5
const SUN = { u: 0.8, v: 0.135, r: 0.03, glow: 0.22 }
/** A string course across the wall, and the skirting at its foot. */
const LEDGE = 0.665
const SKIRT = 0.895

/** The red subject: a figure in a red coat, so the mass has a silhouette. */
const HEAD = { u: 0.4, v: 0.6, rx: 0.062, ry: 0.078 }
const BODY = { u: 0.4, v: 0.78, rx: 0.135, ry: 0.15 }
/** The deep shadow beside it — the darkest value in frame. */
const DOORWAY = { u: 0.735, v: 0.735, rx: 0.055, ry: 0.13 }
/** Three tall warm windows: the saturated bright accent the sky cannot supply. */
const WINDOWS = [
  { u: 0.125, v: 0.585, rx: 0.042, ry: 0.062 },
  { u: 0.185, v: 0.585, rx: 0.042, ry: 0.062 },
  { u: 0.885, v: 0.6, rx: 0.038, ry: 0.058 },
]
/** Two chimneys, so the roofline reads as a building and not as a wave. */
const CHIMNEYS = [
  { u: 0.24, rx: 0.026, top: 0.4 },
  { u: 0.63, rx: 0.02, top: 0.435 },
]
/** The hedge along the bottom, plus two taller shrubs. */
const HEDGE = { u: 0.5, v: 0.995, rx: 0.8, ry: 0.085 }
const SHRUBS = [
  { u: 0.09, v: 0.9, r: 0.075 },
  { u: 0.93, v: 0.915, r: 0.065 },
]

/**
 * A roofline from three incommensurate sines: enough that it reads as a
 * building rather than as a ruler, few enough that it stays deterministic and
 * survives being 96 rows tall.
 *
 * @param {number} u @returns {number}
 */
const ridgeTop = (u) =>
  ROOF +
  0.012 -
  0.055 * Math.abs(Math.sin(u * 5.1 + 0.9)) -
  0.022 * Math.sin(u * 13.7 + 2.1) -
  0.01 * Math.sin(u * 23.3 + 0.4)

// ── named points, so both the assertions and the tests read the same pixels ─

/**
 * Points whose job is to be *readable*, not pretty. Every probe is checked to
 * land in the region its name claims in `look-thumb-scene.test.mjs`, because a
 * probe that quietly drifted onto a neighbour is how an ordering assertion
 * starts passing for the wrong reason.
 *
 * Each one sits inside its region with room to spare, and none of them sits on
 * a mullion, a seam or a lit edge: the separations these probes exist to assert
 * are exactly the ones a probe on the wrong side of a hard edge would destroy.
 *
 * @typedef {{ name: string, u: number, v: number, role: string }} Probe
 */

/** @type {Probe[]} */
export const SCENE_PROBES = [
  { name: 'sun', u: 0.8, v: 0.135, role: 'the highlight' },
  { name: 'sky', u: 0.16, v: 0.2, role: 'the blue sky' },
  { name: 'roof', u: 0.6, v: 0.487, role: 'the roofline' },
  { name: 'wallLit', u: 0.62, v: 0.6, role: 'the sunlit wall' },
  { name: 'wallShade', u: 0.62, v: 0.86, role: 'the shadowed wall' },
  { name: 'skin', u: 0.4, v: 0.6, role: 'the subject’s face' },
  { name: 'coat', u: 0.33, v: 0.75, role: 'the red coat' },
  { name: 'coatLit', u: 0.5, v: 0.75, role: 'the coat’s lit side' },
  { name: 'doorway', u: 0.735, v: 0.76, role: 'the shadow' },
  { name: 'window', u: 0.115, v: 0.6, role: 'the warm accent' },
  { name: 'foliage', u: 0.09, v: 0.9, role: 'the cool accent' },
]

// ── maths ───────────────────────────────────────────────────────────────────

const clamp01 = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** @param {number} a @param {number} b @param {number} x @returns {number} */
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Antialiased coverage across a signed distance, exactly as `gen-icons.mjs`. */
const feather = 0.75
/** @param {number} d @returns {number} */
const coverage = (d) => clamp01(0.5 - d / (feather / THUMB_WIDTH))

/** @param {number} dx @param {number} dy @returns {number} */
const length = (dx, dy) => Math.sqrt(dx * dx + dy * dy)

/**
 * Signed distance to an axis-aligned ellipse, in frame-width units. The
 * geometric mean is the local length scale, so `coverage` sees pixels.
 *
 * @param {number} u @param {number} v
 * @param {{ u: number, v: number, rx: number, ry: number }} e
 * @returns {number}
 */
const ellipseDistance = (u, v, e) =>
  (length((u - e.u) / e.rx, (v - e.v) / e.ry) - 1) * Math.sqrt(e.rx * e.ry)

/**
 * Signed distance to an axis-aligned rectangle, same length scale.
 *
 * @param {number} u @param {number} v
 * @param {{ u: number, v: number, rx: number, ry: number }} e
 * @returns {number}
 */
const boxDistance = (u, v, e) => {
  const dx = Math.abs(u - e.u) - e.rx
  const dy = Math.abs(v - e.v) - e.ry
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const inside = Math.min(Math.max(dx, dy), 0)
  return outside + inside
}

/**
 * An integer hash in [0, 1). `Math.imul` is specified to the bit, which is what
 * makes the hedge dapple portable enough for `--check` to mean anything.
 *
 * @param {number} x @param {number} y @returns {number}
 */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Bilinearly interpolated value noise over a `cells`-across lattice.
 *
 * Interpolation is not decoration. Per-pixel hash dapple reads as leaves at
 * 144px but it is worst-case entropy for every PNG filter in `png.mjs`, and it
 * took the whole set from ~140 KB to ~270 KB. Smooth noise still reads as
 * dappled canopy and costs a third of that.
 *
 * @param {number} u @param {number} v @param {number} cells @returns {number}
 */
function valueNoise(u, v, cells) {
  const fx = u * cells
  const fy = v * cells
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const top = hash2(ix, iy) + (hash2(ix + 1, iy) - hash2(ix, iy)) * sx
  const bottom = hash2(ix, iy + 1) + (hash2(ix + 1, iy + 1) - hash2(ix, iy + 1)) * sx
  return top + (bottom - top) * sy
}

/** @param {number[]} dst @param {number[]} src @param {number} t */
const blend = (dst, src, t) => {
  for (let c = 0; c < 3; c += 1) dst[c] += (src[c] - dst[c]) * t
}

// ── the palette ─────────────────────────────────────────────────────────────
//
// Three families, deliberately far apart: cool and light (the sky), achromatic
// and mid (the wall), warm and dark (the subject), plus one black and two
// saturated accents at the luma ends the sky and the wall do not reach.

const SKY_ZENITH = [0.05, 0.16, 0.62]
const SKY_MID = [0.19, 0.44, 0.86]
const SKY_HAZE = [0.6, 0.79, 0.95]
const CLOUD = [0.85, 0.89, 0.94]
const SUN_CORE = [1.0, 1.0, 0.97]
const SUN_HALO = [0.78, 0.87, 0.93]

const ROOF_DARK = [0.035, 0.045, 0.075]

const WALL_LIT = [0.89, 0.85, 0.77]
const WALL_MID = [0.49, 0.5, 0.53]
const WALL_DEEP = [0.18, 0.2, 0.26]
const WALL_CAST = [0.11, 0.13, 0.18]
const LEDGE_LIGHT = [0.92, 0.9, 0.85]
const LEDGE_DARK = [0.31, 0.31, 0.32]

const SKIN_MID = [0.82, 0.62, 0.5]
const SKIN_LIT = [0.98, 0.88, 0.76]
const SKIN_SHADOW = [0.36, 0.22, 0.19]
const HAIR_DARK = [0.06, 0.045, 0.04]

const RED_MID = [0.6, 0.09, 0.11]
const RED_LIT = [0.95, 0.36, 0.28]
const RED_SHADOW = [0.24, 0.04, 0.055]

const DOOR_BLACK = [0.04, 0.04, 0.05]

const LEAF_DARK = [0.05, 0.2, 0.07]
const LEAF_LIT = [0.38, 0.72, 0.21]
const WINDOW_PANE = [0.99, 0.79, 0.28]
const WINDOW_FRAME = [0.16, 0.15, 0.13]

// ── the scene ───────────────────────────────────────────────────────────────

/**
 * The ungraded subject, as `width * height * 3` floats in 0..1 — floats, not
 * bytes, because the assertion that catches a NaN has to see the NaN *before*
 * `Math.round` folds it to zero.
 *
 * @param {number} width @param {number} height @returns {Float32Array}
 */
export function buildScene(width, height) {
  if (width !== THUMB_WIDTH || height !== THUMB_HEIGHT) {
    throw new Error(`scene is authored at ${THUMB_WIDTH}x${THUMB_HEIGHT}, got ${width}x${height}`)
  }
  const px = new Float32Array(width * height * 3)
  const sky = [0, 0, 0]
  const paint = [0, 0, 0]

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width
      const at = (y * width + x) * 3

      // Sky: zenith to mid, then a pale haze banked up against the roofline,
      // with one soft cloud band so the gradient has a feature to run behind.
      const t = clamp01(v / ROOF)
      blend(sky, SKY_ZENITH, 1)
      blend(sky, SKY_MID, smoothstep(0, 0.66, t))
      blend(sky, SKY_HAZE, Math.pow(smoothstep(0.5, 1, t), 1.5))
      const cloud =
        smoothstep(0.44, 0.5, v) *
        smoothstep(0.72, 0.6, v) *
        smoothstep(0.06, 0.2, u) *
        smoothstep(0.62, 0.48, u)
      blend(sky, CLOUD, cloud * 0.45)
      // The sun: a hard little disc inside a wide haze halo.
      const sunD = length((u - SUN.u) / SUN.r, (v - SUN.v) / SUN.r) - 1
      const halo = Math.pow(
        clamp01(1 - length((u - SUN.u) / SUN.glow, (v - SUN.v) / SUN.glow)),
        2.4,
      )
      blend(sky, SUN_HALO, halo * 0.55)
      blend(sky, SUN_CORE, Math.max(halo * halo * 1.6, coverage(sunD * SUN.r)))
      paint[0] = sky[0]
      paint[1] = sky[1]
      paint[2] = sky[2]

      // The wall: three bands of one achromatic ramp, sunlit to shadowed. It is
      // the reference patch — the only region a white balance reads against —
      // and the low-frequency noise is plaster, not texture: 8% amplitude, which
      // keeps the PNG cheap and keeps the wall readable as neutral.
      if (v > ROOF - 0.03) {
        const plaster = 0.96 + 0.08 * valueNoise(u, v, 9)
        blend(paint, WALL_LIT, clamp01(smoothstep(ROOF - 0.03, ROOF + 0.09, v)))
        blend(paint, WALL_MID, smoothstep(ROOF + 0.06, ROOF + 0.24, v))
        blend(paint, WALL_DEEP, smoothstep(ROOF + 0.22, ROOF + 0.44, v))
        // The roofline throws a hard band of shadow across the top of the wall:
        // the wall's own darkest value, and a hard edge for the tone curve.
        blend(paint, WALL_CAST, smoothstep(ROOF + 0.1, ROOF + 0.02, v))
        // A string course, and the skirting at the foot. Two lines that stop the
        // wall reading as one flat swatch — and both of them tilted, because a
        // frontal rectangle is a diagram and a receding one is a photograph.
        /** @param {number} line */
        const tilt = (line) => line - 0.028 * u
        blend(
          paint,
          LEDGE_DARK,
          coverage(boxDistance(u, v, { u: 0.5, v: tilt(LEDGE), rx: 0.62, ry: 0.016 })) * 0.9,
        )
        blend(
          paint,
          LEDGE_LIGHT,
          coverage(boxDistance(u, v, { u: 0.5, v: tilt(LEDGE - 0.026), rx: 0.62, ry: 0.012 })) *
            0.8,
        )
        blend(
          paint,
          LEDGE_DARK,
          coverage(boxDistance(u, v, { u: 0.5, v: tilt(SKIRT), rx: 0.62, ry: 0.018 })) * 0.7,
        )
        // A shallow falloff away from the sun, so the wall has a light *side*
        // and not just a vertical ramp — the last thing it needs to stop being
        // a rectangle.
        const across = 1 - 0.13 * smoothstep(0.1, 1, 1 - u)
        for (let c = 0; c < 3; c += 1) paint[c] *= plaster * across
      }

      // Roofline: the darkest value against the sky, and the horizon the
      // gradient runs into. Chimneys first, so they read as part of the
      // silhouette rather than as marks painted on top of it.
      const roofMask =
        clamp01(smoothstep(ridgeTop(u) - 0.004, ridgeTop(u) + 0.004, v)) *
        clamp01(smoothstep(ROOF + 0.045, ROOF - 0.005, v))
      let chimneys = 0
      for (const stack of CHIMNEYS) {
        chimneys = Math.max(
          chimneys,
          coverage(
            boxDistance(u, v, {
              u: stack.u,
              v: (stack.top + ROOF + 0.012) / 2 + 0.02,
              rx: stack.rx,
              ry: (ROOF + 0.032 - stack.top) / 2,
            }),
          ),
        )
      }
      blend(paint, ROOF_DARK, Math.max(roofMask, chimneys))

      // Windows: a saturated warm accent at a high luminance, which the sky
      // (cool) and the wall (neutral) between them cannot supply.
      for (const win of WINDOWS) {
        const shape = { u: win.u, v: win.v, rx: win.rx, ry: win.ry }
        const frame = coverage(
          boxDistance(u, v, { ...shape, rx: win.rx + 0.009, ry: win.ry + 0.009 }),
        )
        if (frame <= 0) continue
        const pane = coverage(boxDistance(u, v, shape))
        blend(paint, WINDOW_FRAME, frame)
        blend(paint, WINDOW_PANE, pane)
        // A mullion and a transom, so the window reads as a window and not as
        // a swatch.
        blend(
          paint,
          WINDOW_FRAME,
          pane * coverage(boxDistance(u, v, { ...shape, rx: win.rx * 0.16, ry: win.ry })),
        )
        blend(
          paint,
          WINDOW_FRAME,
          pane * coverage(boxDistance(u, v, { ...shape, rx: win.rx, ry: win.ry * 0.14 })),
        )
      }

      // The subject: a warm face and a saturated red coat — the one large warm
      // mass in frame. Lit from the right, where the sun is, so its lit edge and
      // its shadow side bracket the wall's own value and the tone curve has
      // hard-edged things to bend. The coat overlaps the wall's lower bands, so
      // the silhouette reads against both.
      const bodyA = coverage(ellipseDistance(u, v, BODY))
      const headA = coverage(ellipseDistance(u, v, HEAD))
      const figureA = Math.max(bodyA, headA)
      if (figureA > 0) {
        const gx = (u - BODY.u) / BODY.rx
        blend(paint, RED_MID, figureA)
        blend(paint, RED_SHADOW, figureA * (1 - smoothstep(-0.85, -0.05, gx)))
        blend(paint, RED_LIT, figureA * smoothstep(0.2, 0.95, gx))
        // A shoulder seam, so the coat has a fold in it.
        blend(
          paint,
          RED_SHADOW,
          figureA *
            coverage(
              boxDistance(u, v, {
                u: BODY.u + BODY.rx * 0.35,
                v: BODY.v,
                rx: 0.004,
                ry: BODY.ry * 0.9,
              }),
            ) *
            0.7,
        )
      }
      if (headA > 0) {
        const gx = (u - HEAD.u) / HEAD.rx
        // Hair first, so the hairline is the top of the head and not a hat.
        const hairline = HEAD.v - HEAD.ry * 0.52
        const hairA = headA * clamp01(smoothstep(hairline + 0.006, hairline - 0.006, v))
        blend(paint, SKIN_MID, headA)
        blend(paint, SKIN_SHADOW, headA * (1 - smoothstep(-0.85, -0.05, gx)))
        blend(paint, SKIN_LIT, headA * smoothstep(0.2, 0.95, gx) * 0.8)
        blend(paint, HAIR_DARK, hairA)
      }

      // The doorway: the deepest value in frame, and the region a split tone
      // tints hardest, which is what makes Teal & Orange readable at 72px.
      const doorA = coverage(boxDistance(u, v, DOORWAY))
      if (doorA > 0) {
        blend(paint, DOOR_BLACK, doorA)
        // A jamb catching light on the sun side, so the recess has a near edge.
        blend(
          paint,
          LEDGE_LIGHT,
          doorA *
            coverage(
              boxDistance(u, v, {
                u: DOORWAY.u + DOORWAY.rx + 0.012,
                v: DOORWAY.v,
                rx: 0.012,
                ry: DOORWAY.ry + 0.012,
              }),
            ) *
            0.7,
        )
      }

      // The hedge and two shrubs: saturated, cool and dark — the accent at that
      // corner of the hue/luminance plane nothing else in the frame occupies.
      for (const shrub of SHRUBS) {
        const a = coverage(
          ellipseDistance(u, v, { u: shrub.u, v: shrub.v, rx: shrub.r, ry: shrub.r * 1.1 }),
        )
        if (a <= 0) continue
        blend(paint, LEAF_DARK, a)
        blend(paint, LEAF_LIT, a * smoothstep(-0.6, 0.9, (u - shrub.u) / shrub.r))
        const dappleShrub = 0.76 + 0.48 * valueNoise(u, v, 20)
        for (let c = 0; c < 3; c += 1) paint[c] *= dappleShrub
      }
      const hedgeA = coverage(ellipseDistance(u, v, HEDGE))
      if (hedgeA > 0) {
        blend(paint, LEAF_DARK, hedgeA)
        blend(paint, LEAF_LIT, hedgeA * smoothstep(0.15, 0.95, (u - 0.1) / 0.9))
        const dapple = 0.74 + 0.52 * valueNoise(u, v, 20)
        for (let c = 0; c < 3; c += 1) paint[c] *= dapple
      }

      // A shallow vignette: it is the only thing in here that is not a subject,
      // and it is here so the chip reads as a photograph rather than a diagram.
      const vig = 1 - 0.14 * smoothstep(0.45, 1.06, length((u - 0.5) / 0.63, (v - 0.5) / 0.63))
      px[at] = clamp01(paint[0] * vig)
      px[at + 1] = clamp01(paint[1] * vig)
      px[at + 2] = clamp01(paint[2] * vig)
    }
  }
  return px
}

/**
 * @param {Float32Array} floats @returns {Uint8Array}
 */
export function toRgbBytes(floats) {
  const out = new Uint8Array(floats.length)
  for (let i = 0; i < floats.length; i += 1) out[i] = Math.round(clamp01(floats[i]) * 255)
  return out
}

/**
 * The scene, quantised exactly as a thumbnail would be. The identity comparison
 * in `assertThumbIsSound` needs the *same* rounding, or a look that only moves
 * every pixel by a third of a level would read as "does nothing" — which, at
 * 8 bits, it does.
 */
export function buildSceneBytes() {
  return toRgbBytes(buildScene(THUMB_WIDTH, THUMB_HEIGHT))
}

// ── thumbnail raster ────────────────────────────────────────────────────────

/**
 * @param {string} id @param {Float32Array} scene @returns {Float32Array}
 */
export function gradeScene(id, scene) {
  const look = lookById(id)
  if (!look) throw new Error(`Unknown look "${id}"`)
  const out = new Float32Array(scene.length)
  for (let i = 0; i < scene.length; i += 3) {
    const graded = grade(look.spec, [scene[i], scene[i + 1], scene[i + 2]])
    out[i] = graded[0]
    out[i + 1] = graded[1]
    out[i + 2] = graded[2]
  }
  return out
}

/** @param {string} id @returns {Uint8Array} */
export function buildThumbRgb(id) {
  return toRgbBytes(gradeScene(id, buildScene(THUMB_WIDTH, THUMB_HEIGHT)))
}

/** @param {string} id @returns {Uint8Array} */
export function generateThumbPng(id) {
  return encodeRgbPng(THUMB_WIDTH, THUMB_HEIGHT, buildThumbRgb(id))
}

// ── the assertions a byte-compare cannot make ────────────────────────────────

/** @param {number[]} px @returns {number} */
const luma = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]

/**
 * Read one probe out of a `width x height` RGB buffer.
 *
 * @param {number} width @param {Uint8Array} rgb @param {Probe} probe
 * @returns {[number, number, number]} r, g, b
 */
export function probePixel(width, rgb, probe) {
  const x = Math.min(width - 1, Math.floor(probe.u * width))
  const y = Math.min(THUMB_HEIGHT - 1, Math.floor(probe.v * THUMB_HEIGHT))
  const at = (y * width + x) * 3
  return [rgb[at] ?? 0, rgb[at + 1] ?? 0, rgb[at + 2] ?? 0]
}

/** Barely-separated-by-a-quantisation-step: the floor for "this look did nothing". */
const MIN_IDENTITY_DELTA = 8
/** And the mean, so a look cannot pass by moving one pixel. */
const MIN_MEAN_DELTA = 1
/** A thumbnail with fewer distinct levels than this on a channel is a flat fill. */
const MIN_CHANNEL_LEVELS = 48
/** Luma separation the sun / sky / shadow probes must keep, in 0..255. */
const MIN_HIGHLIGHT_MARGIN = 20
const MIN_SHADOW_MARGIN = 12
/** Peak-to-trough luma, so a look cannot wash the whole picture flat. */
const MIN_LUMA_RANGE = 90

/**
 * Refuse to write a thumbnail that is not a preview of anything.
 *
 * `gen-luts.mjs` has the same guard for the same reason: a NaN survives the
 * rounding and lands in the `Uint8Array` as `0`, so a broken recipe becomes a
 * valid-looking PNG with a hole in it, and a byte compare against the committed
 * file proves nothing about whether the file is *right*. A `--check` gate can only prove reproducibility; these are the checks
 * that make the reproducible thing correct. That is also why this takes the
 * *graded floats* rather than an id: the broken recipes it exists to catch are
 * exactly the ones no shipped id can demonstrate, so it has to be callable with
 * a grade somebody injected.
 *
 * The broken recipe each check catches:
 *
 * 1. **finite and in range** — an operator that produced a NaN or an Infinity,
 *    and a stage added after `grade`'s final `clamp01`. The NaN half is the
 *    class `assertStripIsSound` was written for and it is invisible in the
 *    bytes: `Math.round(NaN)` is `NaN` and the `Uint8Array` coerces it to `0`, an
 *    integer in range, so a NaN pixel is a *valid* hole in a valid PNG. The over-range half is the quieter version of the
 *    same defect — the highlight the shoulder just compressed past 1 comes
 *    out of the writer as one more flat 255, which is precisely what the
 *    operator existed to stop happening.
 * 2. **identity** — a recipe that came out neutral: every operator commented
 *    out, a spec reduced to `{}`, or a look pointed at the wrong pipeline. The
 *    thumbnail is then a perfectly valid PNG of the ungraded scene — a tidy
 *    contact sheet of twenty-four identical chips, each claiming a look it does
 *    not apply, and byte-comparing clean against itself forever. This is the one
 *    failure mode `--check` cannot see at all, because it is self-consistent.
 * 3. **flat channel** — a recipe that collapsed the picture: `contrast` run up
 *    until everything clips, saturation exploding and being pulled back to grey
 *    by a later stage, an exposure push that tore the top off. The thumbnail is
 *    then a rectangle of one colour, which passes the byte compare *and* the
 *    identity check, because a flat fill is emphatically not the scene.
 *    Asserted per *channel*, deliberately: `noir` grades r, g and b to the same
 *    values and that is its job, so the claim is that each channel still spans
 *    a picture, not that the three differ from each other.
 * 4. **order** — a grade that inverted the picture or crushed it: a `contrast`
 *    sign error, a `lgg` gamma applied the wrong way round, a shoulder whose
 *    knee is below full scale. Sun, sky and shadow are the three values a photo
 *    cannot reorder, and every look here has to keep them in that relationship
 *    or the chip is a picture of nothing. Absolute levels are *not* asserted:
 *    `faded-matte` lifting the doorway from 11/255 to well past 60/255 is the
 *    look working, and a threshold that forbade it would forbid the feature.
 *
 * @param {string} id
 * @param {Float32Array} floats the graded scene, unrounded, exactly as it will be written
 * @param {Uint8Array} [scene] the ungraded scene, quantised the same way
 */
export function assertThumbIsSound(id, floats, scene = buildSceneBytes()) {
  if (floats.length !== THUMB_WIDTH * THUMB_HEIGHT * 3) {
    throw new Error(
      `look "${id}" produced ${floats.length} channels, expected ${THUMB_WIDTH * THUMB_HEIGHT * 3}`,
    )
  }

  // (1) Before the rounding, because the rounding is what hides it.
  for (let i = 0; i < floats.length; i += 1) {
    const value = floats[i]
    if (!Number.isFinite(value)) {
      // The point of the message: the byte `toRgbBytes` is about to store.
      // `Math.round(NaN)` is NaN, not 0 — it is the `Uint8Array` that coerces
      // it, which is the whole reason this check has to happen here, on the
      // float, rather than on the byte the file is built from.
      const lands = toRgbBytes(new Float32Array([value]))[0]
      throw new Error(
        `look "${id}" produced ${value} on channel ${i % 3} of pixel ${Math.floor(i / 3)}, which lands in the PNG as ${lands}`,
      )
    }
    if (value < 0 || value > 1) {
      throw new Error(
        `look "${id}" graded channel ${i % 3} of pixel ${Math.floor(i / 3)} to ${value}, past full scale`,
      )
    }
  }

  const graded = toRgbBytes(floats)
  for (let i = 0; i < graded.length; i += 1) {
    if (!Number.isInteger(graded[i]) || graded[i] < 0 || graded[i] > 255) {
      throw new Error(`look "${id}" wrote ${graded[i]} at byte ${i}`)
    }
  }

  // (2) Not the ungraded scene, and not the ungraded scene plus a rounding wobble.
  let worst = 0
  let total = 0
  for (let i = 0; i < graded.length; i += 1) {
    const delta = Math.abs(graded[i] - scene[i])
    worst = Math.max(worst, delta)
    total += delta
  }
  const mean = total / graded.length
  if (worst <= MIN_IDENTITY_DELTA || mean <= MIN_MEAN_DELTA) {
    throw new Error(
      `look "${id}" grades the scene to itself (max delta ${worst}/255, mean ${mean.toFixed(2)}/255)`,
    )
  }

  // (3) Every channel still spans a picture.
  for (let c = 0; c < 3; c += 1) {
    /** @type {Set<number>} */
    const levels = new Set()
    for (let i = c; i < graded.length; i += 3) levels.add(graded[i])
    if (levels.size < MIN_CHANNEL_LEVELS) {
      throw new Error(`look "${id}" leaves channel ${c} flat: ${levels.size} distinct levels`)
    }
  }

  // (4) The picture as a whole still has a tonal range left to grade. This is
  // checked before the ordering below because it is the more fundamental claim
  // and a buffer that has failed it usually fails both: a grade that washed the
  // whole frame into one band has flattened the shadow *and* the highlight, and
  // saying so is the useful message. (An inverted frame passes here — it has the
  // full range, in the wrong order — and is caught by the check after it.)
  /** @type {number[]} */
  const lumas = []
  for (let i = 0; i < graded.length; i += 3) {
    lumas.push(luma([graded[i], graded[i + 1], graded[i + 2]]))
  }
  lumas.sort((a, b) => a - b)
  const p05 = lumas[Math.floor(lumas.length * 0.05)] ?? 0
  const p95 = lumas[Math.floor(lumas.length * 0.95)] ?? 0
  if (p95 - p05 < MIN_LUMA_RANGE) {
    throw new Error(`look "${id}" has a ${(p95 - p05).toFixed(1)}-level tonal range`)
  }

  // (5) And the three values that make it a photograph are still in that order.
  const at = (/** @type {string} */ name) =>
    luma(
      probePixel(THUMB_WIDTH, graded, SCENE_PROBES.find((p) => p.name === name) ?? SCENE_PROBES[0]),
    )
  const sun = at('sun')
  const sky = at('sky')
  const doorway = at('doorway')
  if (sun - sky < MIN_HIGHLIGHT_MARGIN) {
    throw new Error(
      `look "${id}" loses the highlight: sun ${sun.toFixed(1)} vs sky ${sky.toFixed(1)}`,
    )
  }
  if (sky - doorway < MIN_SHADOW_MARGIN) {
    throw new Error(
      `look "${id}" flattens the shadow: sky ${sky.toFixed(1)} vs doorway ${doorway.toFixed(1)}`,
    )
  }
}

/**
 * Grade the scene once, assert the grade, then encode the grade — in that order.
 *
 * @param {string} id @returns {Uint8Array}
 */
export function renderThumb(id) {
  const floats = gradeScene(id, buildScene(THUMB_WIDTH, THUMB_HEIGHT))
  assertThumbIsSound(id, floats)
  return encodeRgbPng(THUMB_WIDTH, THUMB_HEIGHT, toRgbBytes(floats))
}
