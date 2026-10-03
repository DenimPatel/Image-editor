import { describe, expect, it } from 'vitest'

import { LOOKS, grade, shoulder } from './lut-looks.mjs'
import {
  THUMB_HEIGHT,
  THUMB_WIDTH,
  buildScene,
  gradeScene,
  toRgbBytes,
} from './look-thumb-scene.mjs'

/**
 * D3-F23 — the look recipes' half of the filmic shoulder.
 *
 * The shoulder in this file shipped with a knee at 0.86 and a doc comment
 * claiming it kept pure white white. It did not: an exponential that asymptotes
 * at 1 arrives at it by definition, so a 0.86 knee put the asymptote *below* the
 * pixel's own value and every one of the 24 committed strips carried the dim in
 * its bytes — a white corner at 242/255, and every near-white node above 0.86
 * pulled down with it.
 *
 * These assertions are on `grade()` rather than on the committed PNGs because the
 * useful claim is the one a *recipe* makes about its own shoulder, and it is
 * exactly the claim the committed bytes cannot make: four of the looks
 * deliberately grade white down a little, so "the white corner is 255" is a
 * statement about their art direction. "The shoulder does not darken anything" is
 * a statement about the operator, and it holds whatever the art direction is.
 */
describe('the look shoulder (D3-F23)', () => {
  const byte = (/** @type {number} */ value) => Math.round(value * 255)

  it('is the identity on [0, 1], so a look cannot dim a value it was given', () => {
    for (let i = 0; i <= 100; i += 1) {
      const value = i / 100
      for (const strength of [0.3, 0.7, 0.9, 1]) {
        expect(shoulder(value, strength), `dimmed ${value} at ${strength}`).toBe(value)
      }
    }
  })

  it('leaves a white input white', () => {
    // The assertion the old implementation failed on: 0.9485, or 242/255. The
    // sRGB round trip `grade` makes on the way is 1 - 1.1e-16, which is a
    // rounding artefact of the recipe's own encode, so the byte is what is
    // asserted here and the exactness is asserted on `shoulder` below.
    expect(grade({ shoulder: 1 }, [1, 1, 1])[0]).toBeCloseTo(1, 12)
    expect(byte(grade({ shoulder: 1 }, [1, 1, 1])[0])).toBe(255)
  })

  it('puts its knee at full scale, exactly', () => {
    // `toBe`, not `toBeCloseTo`: the two arms of the operator agree at the knee
    // only if `1 - exp(0)` is exactly zero.
    expect(shoulder(0, 1)).toBe(0)
    expect(shoulder(1, 1)).toBe(1)
    for (const strength of [0, 0.3, 0.7, 0.9, 1]) {
      expect(shoulder(1, strength), `at ${strength}`).toBe(1)
    }
  })

  it('compresses the blown range instead of clipping it flat', () => {
    // Above full scale the rolloff still pulls the value down, and still keeps it
    // above 1, so 1.25 and 2.0 are two different values where `min(x, 1)` makes
    // one. The strip clamps after this, so both end at 255 on purpose — the
    // ordering is preserved on the way there, which is the whole point of
    // spending a headroom instead of clipping.
    for (const x of [1.01, 1.25, 1.5, 2, 4, 64]) {
      expect(shoulder(x, 1), `${x} is not compressed`).toBeLessThan(x)
    }
    expect(shoulder(2, 1)).toBeGreaterThan(shoulder(1.5, 1))
    expect(shoulder(1.5, 1)).toBeGreaterThan(shoulder(1.25, 1))
    expect(shoulder(1.25, 1)).toBeGreaterThan(1)
    // And a weaker strength is a weaker rolloff: a tighter curve towards the
    // hard clip, never a dimmer one.
    expect(shoulder(2, 0.3)).toBeLessThan(shoulder(2, 1))
    expect(shoulder(2, 0)).toBe(1)
  })

  it('never darkens a shipped look, at any strength it declares', () => {
    // The per-look form of the same claim, over the inputs a 3D LUT is actually
    // addressed with: white, and a near-white neighbour. A look's own gain, lgg
    // and split tone are allowed to do whatever they like to those; the shoulder
    // is not.
    for (const look of LOOKS) {
      const strength = look.spec.shoulder ?? 0
      for (const level of [1, 0.98, 0.9]) {
        const withShoulder = grade(look.spec, [level, level, level])
        const without = grade({ ...look.spec, shoulder: 0 }, [level, level, level])
        for (let c = 0; c < 3; c += 1) {
          expect(
            withShoulder[c],
            `${look.id} dimmed ${level} on channel ${c} (shoulder ${strength})`,
          ).toBeGreaterThanOrEqual(without[c] - 0.5 / 255)
        }
      }
    }
  })
})

/**
 * D6-F24 — the catalogue has to be twenty-four *different* looks.
 *
 * Six of the twenty-four shipped pairs were 4–7 levels apart, which is the same
 * thing as saying "the same look with the slider in a slightly different
 * place". A user picks "Faded Matte" out of a grid and gets something
 * indistinguishable from "Vista", and concludes the feature is broken. Nothing
 * in the suite could see it: `assetIntegrity.test.ts` asserted that no two
 * *thumbnails* were byte-identical and that the mean per-channel distance
 * between them was over 2.5, which a pair 2.9 apart clears easily; and
 * `--check` only proves the committed bytes still match the recipe, which two
 * recipes that grade the scene to nearly the same picture satisfy perfectly.
 *
 * ── the threshold, and why it is this number ────────────────────────────────
 * It is not "whatever the current tree clears". It is measured, and the
 * measurement is asserted below rather than asserted about in a comment. Three
 * numbers, all RMS distance over a whole graded scene in 0–255:
 *
 *   1. *The defect.* The pairs named in the report, applied to a real
 *      photograph: `Vista`/`Faded Matte` 4.51, `Polaroid`/`Vintage Fade` 4.74,
 *      `Superia`/`Vista` 4.98, `Faded Matte`/`Pastel` 6.50 — and six looks
 *      inside 8 of one another.
 *   2. *The "same look, one slider notch" band.* Take a shipped recipe and move
 *      one of `exposure`, `contrast` or `sat` by 0.05 and the result is at most
 *      4.5 from itself; by 0.10, at most 8.6. Those are numbers a user would
 *      not call a different look, and they are the same size as the defect
 *      above: **any pair inside that band is not two looks.** The second test in
 *      this block measures the band and asserts the floor clears it.
 *   3. *The room available.* Over the 276 pairs the catalogue's median was 25.4
 *      and its 90th percentile 41.1, so the space above the band is not scarce.
 *      The crowded corner was a handful of recipes that had drifted into each
 *      other — `Vista`, `Faded Matte`, `Pastel` and `Vintage Fade` were all
 *      "lifted, warm, low-saturation, low-contrast" — not a property of the
 *      operator set.
 *
 * 12 is above all of that (it clears the ±0.10 band by 40%) and it is a round
 * number for a reason that can be checked rather than argued: 12/255 is 4.7% of
 * full scale, a mean per-channel error large enough to see in a 72px chip placed
 * next to its neighbour. 10 would have been defensible too, and the recipes were
 * driven past it anyway.
 *
 * ── what is measured ───────────────────────────────────────────────────────
 * The scene is `look-thumb-scene.mjs`'s, because that is the scene the
 * twenty-four chips are graded from and the one a user actually compares: a
 * blue sky, a warm neutral wall, a red coat, a near-black doorway, a yellow
 * window, a green hedge. An earlier version of that scene was one mid-grey ramp
 * in three related hues and compressed every pair by about a third, which is the
 * other half of this fix — see that file.
 */

/**
 * The floor, in 0–255 RMS over a whole graded scene.
 *
 * @type {number}
 */
const MIN_PAIRWISE_RMS = 12

/** @param {Uint8Array} a @param {Uint8Array} b @returns {number} */
function rmsDistance(a, b) {
  let total = 0
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i]
    total += d * d
  }
  return Math.sqrt(total / a.length)
}

/**
 * Grade the scene through one recipe with some of its knobs overridden, without
 * touching the catalogue. This is what makes the slider-nudge band measurable
 * rather than hypothetical.
 *
 * @param {{ spec: Record<string, unknown> }} look
 * @param {Record<string, number>} override
 * @param {Float32Array} scene
 * @returns {Uint8Array}
 */
function gradeBytesOf(look, override, scene) {
  const spec = { ...look.spec, ...override }
  const out = new Float32Array(scene.length)
  for (let i = 0; i < scene.length; i += 3) {
    const graded = grade(spec, [scene[i], scene[i + 1], scene[i + 2]])
    out[i] = graded[0]
    out[i + 1] = graded[1]
    out[i + 2] = graded[2]
  }
  return toRgbBytes(out)
}

const SCENE = buildScene(THUMB_WIDTH, THUMB_HEIGHT)
/** Every look graded through the scene, keyed by id. */
/** @type {Map<string, Uint8Array>} */
const GRADED = new Map(LOOKS.map((look) => [look.id, toRgbBytes(gradeScene(look.id, SCENE))]))

describe('the catalogue is twenty-four different looks', () => {
  it('keeps every pair further apart than two looks a user can tell apart', () => {
    expect(LOOKS.length).toBe(24)
    /** @type {{ pair: string, rms: number }[]} */
    const measured = []
    for (let a = 0; a < LOOKS.length; a += 1) {
      for (let b = a + 1; b < LOOKS.length; b += 1) {
        measured.push({
          pair: `${LOOKS[a].id} / ${LOOKS[b].id}`,
          rms: rmsDistance(bytes(LOOKS[a].id), bytes(LOOKS[b].id)),
        })
      }
    }
    measured.sort((x, y) => x.rms - y.rms)
    const closest = measured[0]
    expect(
      closest?.rms ?? 0,
      `closest pair is ${closest?.pair} at ${closest?.rms.toFixed(2)}/255; the six closest are ` +
        measured
          .slice(0, 6)
          .map((m) => `${m.pair} ${m.rms.toFixed(1)}`)
          .join(', '),
    ).toBeGreaterThan(MIN_PAIRWISE_RMS)
  })

  it('sets the floor above the size of "the same look with one slider moved"', () => {
    // The measurement the floor is justified by, asserted rather than described:
    // how far a shipped recipe moves when 0.10 is taken off one of its knobs.
    // A nudge of that size changes a look's tone, exposure or saturation by less
    // than a person would call a different picture, so two looks closer than
    // that are the same look twice.
    //
    // This fails if the recipes ever become that sensitive, which is the
    // interesting direction: it would mean one slider notch now lands inside
    // another chip, and the floor would have to be re-argued rather than the
    // recipes quietly re-tuned.
    let band = 0
    let worst = ''
    for (const look of LOOKS) {
      const knobs = /** @type {Record<string, number | undefined>} */ (look.spec)
      /** @type {[string, number][]} */
      const nudges = [
        ['contrast', 0.1],
        ['sat', 0.1],
        ['exposure', 0.1],
      ]
      for (const [knob, delta] of nudges) {
        const current = knobs[knob]
        if (current === undefined) continue
        const rms = rmsDistance(
          gradeBytesOf(look, { [knob]: current + delta }, SCENE),
          bytes(look.id),
        )
        if (rms > band) {
          band = rms
          worst = `${look.id} with ${knob} ${current} -> ${current + delta}`
        }
      }
    }
    expect(worst).not.toBe('')
    expect(
      MIN_PAIRWISE_RMS,
      `a 0.10 slider nudge moves a shipped look by up to ${band.toFixed(2)}/255 (${worst})`,
    ).toBeGreaterThan(band)
  })

  it('separates the four looks the report named', () => {
    // The specific claim: these four were 4.5–6.5 apart on a photograph and
    // read as "the same faded photo" side by side. Asserting the catalogue
    // floor alone leaves room for all four to drift together; naming them does
    // not.
    const named = ['agfa-vista', 'faded-matte', 'polaroid-600', 'vintage-fade']
    for (let a = 0; a < named.length; a += 1) {
      for (let b = a + 1; b < named.length; b += 1) {
        expect(
          rmsDistance(bytes(named[a] ?? ''), bytes(named[b] ?? '')),
          `${named[a]} / ${named[b]}`,
        ).toBeGreaterThan(MIN_PAIRWISE_RMS)
      }
    }
  })
})

/** @param {string} id @returns {Uint8Array} */
function bytes(id) {
  const found = GRADED.get(id)
  if (!found) throw new Error(`no graded bytes for "${id}"`)
  return found
}
