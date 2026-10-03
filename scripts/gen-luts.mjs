#!/usr/bin/env node
/**
 * Write `public/luts/<id>.png` for every look in `scripts/lut-looks.mjs`.
 *
 * The output is committed, not built. The alternative — generating in a
 * prebuild hook — was rejected for three reasons: `npm run dev` serves
 * `public/` straight off disk, so a fresh clone would show 24 dead Look chips
 * until someone remembered a step nobody documents; the committed files are
 * what `src/lib/assets/assetIntegrity.test.ts` decodes to verify the strip
 * layout against `LUT3D_FRAG`, and a test that has to run a generator before it
 * can assert anything is a test that can be fooled by a failed generator; and
 * `npm run luts:check` in CI then catches a recipe edit that was not
 * regenerated, which a prebuild hook would silently paper over.
 *
 *   node scripts/gen-luts.mjs            write the strips
 *   node scripts/gen-luts.mjs --check    fail if the committed bytes differ
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LUT_IDS, LUT_SIZE, LUT_STRIP_WIDTH, buildStrip, generateStripPng } from './lut-looks.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'luts')
const check = process.argv.includes('--check')

/**
 * Refuse to write a strip that is not a grade.
 *
 * A NaN anywhere in a recipe becomes `Math.round(NaN) === 0` when it lands in
 * the Uint8Array, so a broken look still produces a valid-looking PNG — it just
 * has a hole in it, and a hole at the white corner is invisible until someone
 * picks that look on a bright photo. These three checks are what caught exactly
 * that.
 *
 * @param {string} id
 * @param {Uint8Array} rgb
 */
function assertStripIsSound(id, rgb) {
  const last = LUT_SIZE - 1
  /** @param {number} x @param {number} y @returns {number} */
  const at = (x, y) => (y * LUT_STRIP_WIDTH + x) * 3
  for (let i = 0; i < rgb.length; i += 1) {
    if (!Number.isInteger(rgb[i]))
      throw new Error(`look "${id}" produced a non-integer channel at byte ${i}`)
  }
  const black = rgb.subarray(at(0, 0), at(0, 0) + 3)
  const white = rgb.subarray(
    at(LUT_SIZE * LUT_SIZE - 1, last),
    at(LUT_SIZE * LUT_SIZE - 1, last) + 3,
  )
  /** @param {Uint8Array} px @returns {number} */
  const luma = (px) => 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]
  // A deliberately faded look lifts black to ~0.1; anything past ~0.19 means the
  // toe was blown, not graded.
  if (luma(black) > 48) throw new Error(`look "${id}" lifts black to ${luma(black).toFixed(1)}`)
  if (luma(white) < 224) throw new Error(`look "${id}" darkens white to ${luma(white).toFixed(1)}`)
  // The neutral diagonal has to rise, or the look inverts a grey ramp.
  let previous = -1
  for (let step = 0; step < LUT_SIZE; step += 1) {
    const node = step * LUT_SIZE + step
    const value = luma(rgb.subarray(at(node, step), at(node, step) + 3))
    if (value < previous)
      throw new Error(`look "${id}" is non-monotonic at neutral ${step}/${last}`)
    previous = value
  }
}

await mkdir(outDir, { recursive: true })

let drifted = 0
for (const id of LUT_IDS) {
  const file = join(outDir, `${id}.png`)
  const png = generateStripPng(id)
  assertStripIsSound(id, buildStrip(id))
  if (check) {
    let current
    try {
      current = await readFile(file)
    } catch {
      console.error(`✗ ${id}: missing — run \`npm run luts:gen\``)
      drifted += 1
      continue
    }
    if (!current.equals(png)) {
      console.error(`✗ ${id}: committed strip differs from the recipe — run \`npm run luts:gen\``)
      drifted += 1
      continue
    }
    console.log(`✓ ${id} (${png.length} bytes)`)
    continue
  }
  await writeFile(file, png)
  console.log(`✓ ${id} (${png.length} bytes)`)
}

if (drifted > 0) {
  console.error(`${drifted} look${drifted === 1 ? '' : 's'} out of date.`)
  process.exit(1)
}
