#!/usr/bin/env node
/**
 * Write `public/look-thumbs/<id>.png` for every look in `scripts/lut-looks.mjs`.
 *
 * The output is committed, not built, for the same three reasons
 * `scripts/gen-luts.mjs` gives and for the same three reasons they apply here:
 * `npm run dev` serves `public/` straight off disk, so a `prebuild` hook would
 * leave a fresh clone showing 24 broken chips until someone remembered a step
 * nobody documents; the committed files are the bytes
 * `src/lib/assets/assetIntegrity.test.ts` decodes to verify what the app will
 * actually fetch, and a test that has to run a generator before it can assert
 * anything is a test that can be fooled by a failed generator; and
 * `npm run thumbs:check` then catches a recipe edit that was not regenerated,
 * which a prebuild hook would silently paper over. Which is why this is wired
 * into `assets:check` — the gate that already runs in `npm run build` — and not
 * only into CI: a thumbnail that is stale in the build but fresh in the
 * workflow is still a broken chip in the shipped app.
 *
 *   node scripts/gen-look-thumbs.mjs            write the thumbnails
 *   node scripts/gen-look-thumbs.mjs --check    fail if the committed bytes differ
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { THUMB_IDS, renderThumb } from './look-thumb-scene.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'look-thumbs')
const check = process.argv.includes('--check')

await mkdir(outDir, { recursive: true })

let drifted = 0
for (const id of THUMB_IDS) {
  const file = join(outDir, `${id}.png`)
  // Graded from the recipe, asserted as a grade, then encoded. The assertion
  // runs on the floats, before the rounding that would turn a NaN into a valid
  // hole in a valid PNG — which is the same reason `gen-luts.mjs` asserts before
  // it writes.
  const png = renderThumb(id)
  if (check) {
    let current
    try {
      current = await readFile(file)
    } catch {
      console.error(`✗ ${id}: missing — run \`npm run thumbs:gen\``)
      drifted += 1
      continue
    }
    if (!current.equals(png)) {
      console.error(
        `✗ ${id}: committed thumbnail differs from the recipe — run \`npm run thumbs:gen\``,
      )
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
