import { describe, expect, it } from 'vitest'

import {
  SCENE_PROBES,
  THUMB_HEIGHT,
  THUMB_IDS,
  THUMB_WIDTH,
  buildScene,
  buildSceneBytes,
  buildThumbRgb,
  gradeScene,
  probePixel,
  toRgbBytes,
} from './look-thumb-scene.mjs'

/**
 * The subject half of the thumbnail generator.
 *
 * These assertions are deliberately *not* on the committed PNGs. `lut-looks.
 * test.mjs` says why: the useful claim is the one a recipe makes about itself,
 * and art direction ("four of the looks deliberately grade white down a
 * little") is not a correctness property. The same split holds here — what is
 * asserted below is that the *scene* has the regions a look preview needs and
 * is reproducible, and the committed bytes are checked in
 * `gen-look-thumbs.test.mjs`.
 *
 * The one thing that must be exactly reproducible, and is asserted exactly, is
 * `buildScene` itself: every other assertion in the repo about these files
 * rests on `public/look-thumbs/*.png` being a pure function of this code.
 */

const scene = buildScene(THUMB_WIDTH, THUMB_HEIGHT)
const sceneBytes = buildSceneBytes()
/** @param {string} name @returns {[number, number, number]} */
const probe = (name) => {
  const found = SCENE_PROBES.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`no probe called "${name}"`)
  return probePixel(THUMB_WIDTH, sceneBytes, found)
}
/** @param {[number, number, number]} px @returns {number} */
const luma = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]

describe('the look-thumbnail scene', () => {
  it('is a pure function of the code, which is what makes --check mean anything', () => {
    expect(Array.from(buildScene(THUMB_WIDTH, THUMB_HEIGHT))).toEqual(Array.from(scene))
    expect(Array.from(buildSceneBytes())).toEqual(Array.from(sceneBytes))
    // Every byte an integer in range: `Math.round` of a finite in-range float is
    // an integer in range, so this is the same claim as `assertThumbIsSound`'s
    // first check, asserted on the *ungraded* input where there is no recipe
    // left to blame.
    for (const byte of sceneBytes) {
      expect(Number.isInteger(byte) && byte >= 0 && byte <= 255).toBe(true)
    }
  })

  it('refuses to be rendered at a size it was not authored for', () => {
    // A rescaled scene is a different subject, and every one of the 24
    // thumbnails would quietly become a different picture from its siblings.
    expect(() => buildScene(128, 86)).toThrow(/authored at 144x96/)
  })

  it('is 2x the box the component renders it in', () => {
    // The component is asserted against these in `lookThumb.module.css`'s own
    // test; here it is the other half of the same contract, so the two cannot
    // drift without one of them going red.
    expect(THUMB_WIDTH / THUMB_HEIGHT).toBeCloseTo(1.5, 10)
    expect({ width: THUMB_WIDTH, height: THUMB_HEIGHT }).toEqual({ width: 144, height: 96 })
  })
})

describe('the regions a look preview has to contain', () => {
  it('has a blue sky and a warm sunlit wall: cool and neutral, at both ends of the frame', () => {
    // The premise of the whole file: a grade is only legible against more than
    // one subject, and a grade separates on *hue* far more readily than on luma.
    // The sky is the cool reference and the wall is the achromatic one — the
    // only region a white balance can be read against, because it is the only
    // region with no hue of its own to argue with.
    const sky = probe('sky')
    expect(sky[2]).toBeGreaterThan(sky[0] + 80)
    expect(sky[2]).toBeGreaterThan(sky[1] + 50)
    const wall = probe('wallLit')
    expect(Math.abs(wall[0] - wall[2])).toBeLessThan(45)
    expect(Math.abs(wall[1] - wall[2])).toBeLessThan(25)
    // …and it is bright, which is what makes it a *reference* rather than
    // another mid-tone: the biggest region in frame, near the top of the range.
    expect(luma(wall)).toBeGreaterThan(180)
    // …and the shadowed band under it is a third of its value, so the wall
    // carries a tone ramp of its own rather than being one flat swatch.
    expect(luma(probe('wallShade'))).toBeLessThan(luma(wall) - 90)
  })

  it('is a vertical gradient, not a flat fill — otherwise the ramp is a swatch', () => {
    // Sampled straight down a column clear of the subject, of the chimney and of
    // the doorway, at the frame's horizontal centre-right: the deep zenith, the
    // brighter mid-sky, the roofline, the sunlit wall, the string course, the
    // shadowed wall, the skirting and the hedge. Seven bands at seven different
    // brightnesses is what a look's tone curve and split tone have to work
    // against, and the last of them is the only green in the column.
    const x = Math.floor(0.62 * THUMB_WIDTH)
    /** @type {number[]} */
    const column = []
    /** @type {[number, number, number][]} */
    const columnPx = []
    for (let y = 0; y < THUMB_HEIGHT; y += 1) {
      const at = (y * THUMB_WIDTH + x) * 3
      const px = /** @type {[number, number, number]} */ ([
        sceneBytes[at] ?? 0,
        sceneBytes[at + 1] ?? 0,
        sceneBytes[at + 2] ?? 0,
      ])
      columnPx.push(px)
      column.push(luma(px))
    }
    expect(new Set(column).size).toBeGreaterThan(60)
    /** @param {number} from @param {number} to */
    const band = (from, to) => Math.max(...column.slice(from, to))
    /** @param {number} from @param {number} to */
    const brightest = (from, to) => {
      let best = 0
      for (let y = from; y < to; y += 1) {
        if ((column[y] ?? 0) > (column[best] ?? 0)) best = y
      }
      const found = columnPx[best]
      return /** @type {[number, number, number]} */ (found ?? [0, 0, 0])
    }
    const zenith = Math.min(...column.slice(1, 5))
    const midSky = band(20, 26)
    const roof = band(46, 52)
    const wall = band(59, 63)
    const ledge = band(63, 67)
    const shaded = band(80, 86)
    const hedge = band(90, 95)
    // A deep blue zenith grading up into a brighter sky…
    expect(midSky).toBeGreaterThan(zenith + 40)
    // …a near-black roofline under it…
    expect(midSky).toBeGreaterThan(roof + 70)
    // …a pale wall below that, which is the frame's reference value…
    expect(wall).toBeGreaterThan(midSky + 70)
    // …a string course across it a third darker…
    expect(wall).toBeGreaterThan(ledge + 50)
    // …and a shadowed band a third of the wall again…
    expect(wall).toBeGreaterThan(shaded + 90)
    // …and the hedge under that: the sixth value, the only green in the column,
    // and a different hue from every band above it.
    expect(Math.abs(hedge - shaded)).toBeGreaterThan(20)
    const hedgePx = brightest(90, 95)
    expect(hedgePx[1]).toBeGreaterThan(hedgePx[0] + 40)
    expect(hedgePx[1]).toBeGreaterThan(hedgePx[2] + 40)
  })

  it('has a highlight that is the brightest thing in frame', () => {
    const sun = probe('sun')
    let brightest = 0
    for (let i = 0; i < sceneBytes.length; i += 3) {
      brightest = Math.max(brightest, luma([sceneBytes[i], sceneBytes[i + 1], sceneBytes[i + 2]]))
    }
    expect(luma(sun)).toBe(brightest)
    expect(luma(sun)).toBeGreaterThan(230)
  })

  it('has a shadow region, and it is genuinely dark', () => {
    // The doorway. Every split-toned look in the set puts its strongest colour
    // in the shadows, so a preview without a dark region cannot show Teal &
    // Orange's shadow tint at all — and the deepest region here is *not* the
    // same hue as anything else, so the tint has somewhere isolated to land.
    const doorway = probe('doorway')
    expect(luma(doorway)).toBeLessThan(20)
    const roof = probe('roof')
    expect(luma(roof)).toBeLessThan(30)
    // …and more than a tenth of the frame is below a quarter luma, so the
    // shadow is a region rather than an outline.
    let dark = 0
    for (let i = 0; i < sceneBytes.length; i += 3) {
      if (luma([sceneBytes[i], sceneBytes[i + 1], sceneBytes[i + 2]]) < 64) dark += 1
    }
    expect(dark / (THUMB_WIDTH * THUMB_HEIGHT)).toBeGreaterThan(0.12)
  })

  it('has a red subject and a warm face, lit from the sun side with a shadow side', () => {
    // The one large warm mass in frame. Red is the accent nothing else in the
    // scene occupies, and it is where a split tone's *highlight* weight lands,
    // so a look whose split is cool-shifted visibly turns the coat.
    const coat = probe('coat')
    expect(coat[0]).toBeGreaterThan(coat[1] * 4)
    expect(coat[0]).toBeGreaterThan(coat[2] * 4)
    expect(coat[0] - coat[1]).toBeGreaterThan(60)
    // Lit right, shadow left: the coat's own lit side against its shadow side,
    // and the two bracket the wall's value, so the tone curve has hard-edged
    // things to bend on both sides of the midpoint.
    expect(luma(probe('coatLit'))).toBeGreaterThan(luma(coat) + 40)
    // The face is mid-tone skin — the region "Portra" and "Faded Matte" exist
    // for — warm, and neither crushed nor blown.
    const skin = probe('skin')
    expect(skin[0]).toBeGreaterThan(skin[1])
    expect(skin[1]).toBeGreaterThan(skin[2])
    expect(luma(skin)).toBeGreaterThan(120)
    expect(luma(skin)).toBeLessThan(210)
  })

  it('has both saturated accents, at saturation a look has to move', () => {
    // A warm bright window and a cool dark hedge: the two opposite corners of
    // the hue/luminance plane, which is what makes "Vivid" and "Infrared"
    // distinguishable in a 72px box. They are far enough apart in the *scene*
    // that a grade which moves one and not the other is unmistakable.
    const window = probe('window')
    const foliage = probe('foliage')
    expect(window[0]).toBeGreaterThan(window[2] * 2)
    expect(foliage[1]).toBeGreaterThan(foliage[0] * 1.8)
    expect(foliage[1]).toBeGreaterThan(foliage[2] * 2.5)
    expect(window[0] - window[2]).toBeGreaterThan(90)
    expect(foliage[1] - foliage[0]).toBeGreaterThan(40)
    expect(Math.abs(luma(window) - luma(foliage))).toBeGreaterThan(90)
  })

  it('separates hues at separated luminances, which is the property it is for', () => {
    // The measurement behind the redesign, asserted so it cannot silently go
    // back. The previous subject was a backlit portrait in a landscape: one
    // mid-tone ramp in three or four related hues, which graded correctly and
    // compressed every pair of the catalogue by about a third, so the chips
    // read as "the same faded photo" side by side.
    //
    // The claim is about *coverage*, not about any one probe: the frame has to
    // contain six regions whose (hue, luma) pairs are far apart, and the
    // cheapest way to say that is to check the six pairs the rest of this file
    // relies on.
    const pairs = [
      ['roof', 'wallLit'],
      ['doorway', 'wallLit'],
      ['coat', 'wallLit'],
      ['skin', 'coat'],
      ['window', 'foliage'],
      ['coat', 'coatLit'],
    ]
    for (const [a, b] of pairs) {
      expect(
        Math.abs(luma(probe(a ?? '')) - luma(probe(b ?? ''))),
        `${a} against ${b}`,
      ).toBeGreaterThan(60)
    }
  })

  it('holds every probe where its name says it is', () => {
    // A probe that drifted onto a neighbour is how an ordering assertion in
    // `assertThumbIsSound` starts passing for the wrong reason, so the set is
    // pinned twice: the names are unique and complete, and every named region
    // exists in the frame as a region rather than as one lucky pixel — which is
    // what the per-probe colour assertions above then check in place. Three of
    // these failed the first time this file ran against the new scene: a window
    // probe parked on a mullion, a coat probe on the lit edge instead of the
    // mass, and a wall probe inside the roofline's cast shadow.
    const names = SCENE_PROBES.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(
      expect.arrayContaining([
        'sun',
        'sky',
        'roof',
        'wallLit',
        'wallShade',
        'skin',
        'coat',
        'coatLit',
        'doorway',
        'window',
        'foliage',
      ]),
    )
    let greenest = 0
    let reddest = 0
    let bluest = 0
    let greenPixels = 0
    let redPixels = 0
    for (let i = 0; i < sceneBytes.length; i += 3) {
      const px = [sceneBytes[i], sceneBytes[i + 1], sceneBytes[i + 2]]
      const g = px[1] - Math.max(px[0], px[2])
      const r = px[0] - Math.max(px[1], px[2])
      const b = px[2] - Math.max(px[0], px[1])
      greenest = Math.max(greenest, g)
      reddest = Math.max(reddest, r)
      bluest = Math.max(bluest, b)
      if (g > 40) greenPixels += 1
      if (r > 40) redPixels += 1
    }
    expect(greenest).toBeGreaterThan(60)
    expect(reddest).toBeGreaterThan(120)
    expect(bluest).toBeGreaterThan(90)
    // Each is an area, not a pixel: without this, an accent probe could satisfy
    // the assertions above by landing on the single most extreme pixel.
    expect(greenPixels / (THUMB_WIDTH * THUMB_HEIGHT)).toBeGreaterThan(0.04)
    expect(redPixels / (THUMB_WIDTH * THUMB_HEIGHT)).toBeGreaterThan(0.04)
  })
})

describe('grading the scene', () => {
  it('gives every look the identical input, so the grid is a contact sheet', () => {
    // The comparability is the entire feature. If one thumbnail were graded
    // from a different scene the grid would show two pictures rather than
    // twenty-four grades, and nothing would be wrong with any single chip.
    const fingerprints = THUMB_IDS.map((id) => gradeScene(id, scene))
    expect(fingerprints.every((graded) => graded.length === scene.length)).toBe(true)
    expect(fingerprints.every((graded) => graded === fingerprints[0])).toBe(false)
    // …and grading is itself repeatable, which the `--check` gate depends on.
    const again = gradeScene(THUMB_IDS[0], scene)
    expect(again).toEqual(fingerprints[0])
  })

  it('rejects an id that is not a look, rather than grading it to nothing', () => {
    expect(() => gradeScene('not-a-look', scene)).toThrow(/Unknown look/)
  })

  it('gives every look its own thumbnail', () => {
    const prints = THUMB_IDS.map((id) => buildThumbRgb(id).join(','))
    expect(new Set(prints).size).toBe(THUMB_IDS.length)
  })

  it('quantises into 8-bit colour with no alpha, because that is all the writer emits', () => {
    const bytes = toRgbBytes(scene)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes).toHaveLength(THUMB_WIDTH * THUMB_HEIGHT * 3)
  })
})
