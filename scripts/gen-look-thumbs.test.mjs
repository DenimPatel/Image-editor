import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  THUMB_HEIGHT,
  THUMB_IDS,
  THUMB_WIDTH,
  assertThumbIsSound,
  buildScene,
  gradeScene,
  renderThumb,
  toRgbBytes,
} from './look-thumb-scene.mjs'

/**
 * The generator half of the thumbnail pipeline: what it wrote, and whether it
 * is a preview of anything.
 *
 * The first describe is `node scripts/gen-look-thumbs.mjs --check`, run in
 * process rather than as a subprocess — the same comparison the build makes,
 * without spawning Node in a unit suite. The second is the part a byte compare
 * structurally cannot do: each assertion in `assertThumbIsSound` is handed the
 * broken recipe it was written for and has to throw, because the failure it
 * guards against is invisible in the output bytes. A NaN pixel is a *valid* PNG.
 * A thumbnail that is the ungraded scene is a *valid* PNG. A flat rectangle is
 * a *valid* PNG. All three would pass `--check` forever.
 */

const repoRoot = process.cwd()
const thumbDir = join(repoRoot, 'public', 'look-thumbs')
/**
 * @param {string} id
 * @returns {Uint8Array}
 */
const bytesOf = (id) => new Uint8Array(readFileSync(join(thumbDir, `${id}.png`)))
const scene = buildScene(THUMB_WIDTH, THUMB_HEIGHT)

describe('public/look-thumbs (what the generator wrote)', () => {
  it('ships one thumbnail per look, and nothing else', () => {
    const missing = THUMB_IDS.filter((id) => !existsSync(join(thumbDir, `${id}.png`)))
    expect(missing).toEqual([])
    // A stale thumbnail from a renamed look is dead weight that still ships and
    // is still fetched by nothing. Same assertion shape as the LUT strips'.
    const declared = new Set(THUMB_IDS.map((id) => `${id}.png`))
    const shipped = readdirSync(thumbDir, { withFileTypes: true })
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.png'))
    expect(shipped.filter((name) => !declared.has(name))).toEqual([])
    expect(THUMB_IDS).toHaveLength(24)
  })

  it.each(THUMB_IDS.map((id) => [id]))('writes %s as a %i x %i 8-bit truecolour PNG', (id) => {
    const bytes = bytesOf(id)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect({ width: view.getUint32(16), height: view.getUint32(20) }).toEqual({
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
    })
    expect({ depth: bytes[24], colourType: bytes[25], interlace: bytes[28] }).toEqual({
      depth: 8,
      colourType: 2,
      interlace: 0,
    })
  })

  it.each(THUMB_IDS.map((id) => [id]))('%s is byte-identical to a fresh render', (id) => {
    // The `--check` gate. Reproducible output is the whole claim, and it is
    // only a claim if it can fail.
    const fresh = renderThumb(id)
    expect(bytesOf(id).length, `public/look-thumbs/${id}.png is stale`).toBe(fresh.length)
    expect(
      Buffer.compare(Buffer.from(bytesOf(id)), Buffer.from(fresh)),
      `public/look-thumbs/${id}.png is stale — run \`npm run thumbs:gen\``,
    ).toBe(0)
  })

  it('ships 24 different pictures', () => {
    const prints = THUMB_IDS.map((id) => bytesOf(id).join(','))
    expect(new Set(prints).size).toBe(THUMB_IDS.length)
  })

  it('fits in the weight budget, and says so if it ever stops fitting', () => {
    // 24 thumbnails at 2x retina density is real weight, so it is pinned rather
    // than assumed: a scene that grew a texture, or a chip that got wider,
    // should have to move this number deliberately instead of quietly shipping
    // a quarter of a megabyte of new bytes to everyone who opens Filters.
    const total = THUMB_IDS.reduce((sum, id) => sum + bytesOf(id).length, 0)
    expect(total).toBeLessThanOrEqual(256 * 1024)
  })
})

describe('assertThumbIsSound, handed the recipe it was written for', () => {
  it('passes every shipped look', () => {
    for (const id of THUMB_IDS) {
      expect(() => assertThumbIsSound(id, gradeScene(id, scene)), id).not.toThrow()
    }
  })

  it('catches a NaN, which the PNG writer would have shipped as a valid hole', () => {
    // The `contrast` sign error from `lut-looks.mjs`: `Math.pow(-0.06, 1.1)` is
    // NaN, `Math.round(NaN)` is NaN, and the `Uint8Array` coerces that to 0 — an
    // in-range integer. So the broken strip came out as a valid PNG with a black
    // hole where the highlight should have been, and the only defence is an
    // assertion on the floats, before the rounding.
    const broken = Float32Array.from(gradeScene('kodak-portra', scene))
    broken[0] = Number.NaN
    expect(() => assertThumbIsSound('nan-recipe', broken)).toThrow(
      /"nan-recipe" produced NaN on channel 0 of pixel 0, which lands in the PNG as 0/,
    )
  })

  it('catches an operator that pushed a value past full scale', () => {
    // A shoulder whose knee is back below 1, or any stage added after `grade`'s
    // final `clamp01`: the byte comes out 255 either way, but the value in
    // between was supposed to be compressed rather than clipped, and the
    // thumbnail is where that is visible.
    const broken = Float32Array.from(gradeScene('kodak-portra', scene))
    broken[30] = 1.5
    expect(() => assertThumbIsSound('unclamped-recipe', broken)).toThrow(
      /"unclamped-recipe" graded channel 0 of pixel \d+ to 1.5, past full scale/,
    )
  })

  it('catches a look that does nothing at all', () => {
    // The one `--check` cannot see. Every operator commented out, a spec reduced
    // to `{}`, a look pointed at the wrong pipeline: the thumbnail is then a
    // perfectly valid PNG of the ungraded scene, and it byte-compares clean
    // against itself for ever. Twenty-four identical chips, each claiming a look
    // it does not apply.
    expect(() => assertThumbIsSound('no-op-recipe', scene)).toThrow(
      /"no-op-recipe" grades the scene to itself \(max delta 0\/255, mean 0.00\/255\)/,
    )
  })

  it('catches a look that moves the picture by less than a quantisation step', () => {
    // The subtler version of the no-op, and the one a `--check` gate is most
    // likely to ship: `{}` plus a `sat` of 1.001 looks like a grade in review.
    const nudge = Float32Array.from(gradeScene('kodak-portra', scene))
    for (let i = 0; i < nudge.length; i += 1) nudge[i] = Math.min(1, scene[i] + 0.001)
    expect(() => assertThumbIsSound('nudge-recipe', nudge)).toThrow(
      /"nudge-recipe" grades the scene to itself/,
    )
  })

  it('catches a look that collapses the picture to a flat fill', () => {
    // `contrast` run up until everything clips, saturation exploding and pulled
    // back to grey by a later stage, an exposure push that tore the top off. The
    // output is a rectangle of one colour: a valid PNG, not the scene, so both
    // the byte compare and the identity check wave it through.
    const flat = new Float32Array(scene.length).fill(0.5)
    expect(() => assertThumbIsSound('flat-recipe', flat)).toThrow(
      /"flat-recipe" leaves channel 0 flat: 1 distinct levels/,
    )
  })

  it('catches a look that inverts the frame', () => {
    // A `contrast` sign error, a `lgg` gamma applied the wrong way round, a
    // shoulder knee below full scale: any of them can leave a picture where the
    // sun is darker than the sky and the sky is darker than the treeline, which
    // is still a valid PNG of something and is not a preview of this look.
    const inverted = new Float32Array(scene.length)
    for (let i = 0; i < scene.length; i += 1) inverted[i] = 1 - scene[i]
    expect(() => assertThumbIsSound('inverted-recipe', inverted)).toThrow(
      /"inverted-recipe" (loses the highlight|flattens the shadow)/,
    )
  })

  it('catches a look that washes every tone into one narrow band', () => {
    // The ordering can survive a washout — three values, correctly ordered, all
    // of them mid-grey — so the tonal range is asserted separately. `faded-matte`
    // and `agfa-vista` come within 60 levels of the floor and are deliberately
    // allowed to.
    const washed = new Float32Array(scene.length)
    for (let i = 0; i < scene.length; i += 3) {
      const level = 0.45 + (scene[i] - 0.45) * 0.2
      washed[i] = level
      washed[i + 1] = level
      washed[i + 2] = level
    }
    expect(() => assertThumbIsSound('washed-recipe', washed)).toThrow(/tonal range/)
  })

  it('allows the washed-out looks the catalogue actually ships', () => {
    // The floor is not aspirational: these two lift the treeline from 21/255 to
    // well past 150/255 and that is the look working. If a future edit tightened
    // the thresholds until they rejected these, this is what would go red.
    for (const id of ['faded-matte', 'agfa-vista', 'polaroid-600', 'pastel']) {
      expect(() => assertThumbIsSound(id, gradeScene(id, scene)), id).not.toThrow()
    }
  })

  it('allows noir to grade every channel to the same value', () => {
    // "No channel is constant" is about each channel spanning a picture, not
    // about the three differing from each other. Noir is the one look whose
    // recipe is mono end to end, and an assertion written the other way round
    // would have deleted it from the catalogue.
    const noir = toRgbBytes(gradeScene('noir', scene))
    for (let i = 0; i < noir.length; i += 3) {
      expect(noir[i]).toBe(noir[i + 1])
      expect(noir[i + 1]).toBe(noir[i + 2])
    }
    /** @type {Set<number>} */
    const levels = new Set()
    for (let i = 0; i < noir.length; i += 3) levels.add(noir[i])
    expect(levels.size).toBeGreaterThan(48)
  })

  it('refuses a buffer that is not the frame it claims to be', () => {
    expect(() => assertThumbIsSound('short', new Float32Array(16))).toThrow(
      /"short" produced 16 channels, expected 41472/,
    )
  })
})

describe('the generator script', () => {
  it('is wired into assets:check, not only into CI', () => {
    // `gen-luts.mjs` is the precedent and the reason: a stale thumbnail that is
    // fresh in the workflow is still a broken chip in the shipped app, and the
    // only gate that runs on every build is `npm run build`.
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    expect(manifest.scripts['thumbs:gen']).toBe('node scripts/gen-look-thumbs.mjs')
    expect(manifest.scripts['thumbs:check']).toBe('node scripts/gen-look-thumbs.mjs --check')
    expect(manifest.scripts['assets:check']).toContain('gen-look-thumbs.mjs --check')
    // And not in `prebuild`, for the reason `gen-luts.mjs` gives at length: a
    // fresh clone serves `public/` straight off disk.
    expect(manifest.scripts['prebuild'] ?? '').not.toContain('gen-look-thumbs')
    expect(manifest.scripts['build']).toContain('assets:check')
  })
})
