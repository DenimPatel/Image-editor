#!/usr/bin/env node
/**
 * Fail the build when a declared asset is not actually shipped.
 *
 * This is the gate D6-F16/D4-F05 needed. Before it, `public/luts/` and
 * `public/fonts/` did not exist, every one of the 24 Look chips and 14 font
 * entries 404'd, and nothing noticed: `loadLut` returned `null`, the renderer
 * skipped the pass, `ensureFont` swallowed the rejection, and the panel still
 * highlighted the chip as selected.
 *
 * Checks, in order of how badly they lie to the user:
 *   1. every `LUT_PRESETS` id in src/gl/luts.ts has a `public/luts/<id>.png`
 *      that is a real PNG of exactly 1089 x 33 — the strip shape LUT3D_FRAG
 *      addresses;
 *   2. there are no orphaned strips nobody can select, and no recipe without a
 *      declaration;
 *   3. every font in the `fonts` section of models.lock.json is present, the
 *      right size, hashes to its pinned sha256, and is a woff2;
 *   4. the lock's font ids are exactly the ids in src/features/layers/fonts.ts,
 *      so the runtime catalogue and the build manifest cannot drift apart;
 *   5. every runtime dependency in package.json and every pinned font has an
 *      entry in src/lib/licenses.ts, with the font licences matching the lock —
 *      the attribution obligation, enforced.
 *   6. `public/` is within its byte budget, per directory and per file, with a
 *      cap for every directory that ships. The five checks above all ask whether
 *      a *declared* asset is real; none of them can see the file nobody declared,
 *      and `public/` is copied into every build and every clone.
 *
 *   node scripts/verify-assets.mjs  the only form; it always exits non-zero on failure
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { analyzePublic, PUBLIC_MAX_BYTES } from './check-public-budget.mjs'
import { LUT_IDS, LUT_STRIP_HEIGHT, LUT_STRIP_WIDTH } from './lut-looks.mjs'
import { fileMatches, readLock, root } from './lockfile.mjs'
// Node 24 strips the types, so the gate and the Vitest suite run the same rules
// against the same table. The alternative — re-parsing `licenses.ts` here with a
// regex — is how this check ended up with two implementations of one idea the
// first time, and two implementations of an obligation is one too many.
import {
  BUNDLED_WORKS,
  danglingTransitiveEntries,
  fontLicenceProblems,
  incompleteEntries,
  missingDependencyEntries,
  orphanDirectEntries,
  undeclaredFontEntries,
} from '../src/lib/licenses.ts'

/** @type {string[]} */
const problems = []

/** @param {string} message */
function fail(message) {
  problems.push(message)
}

/** @param {string} relative */
function readSource(relative) {
  return readFile(join(root, relative), 'utf8')
}

/**
 * The ids, urls and licences, lifted out of the TypeScript sources so the build
 * gate cannot go stale. Both catalogues are plain object literals; matching per
 * object rather than per line keeps the gate working across a reformat, and a
 * catalogue it cannot read is a hard failure here rather than a check that
 * silently passes because it found nothing.
 *
 * @param {string} source
 * @returns {string[]}
 */
function declaredLutIds(source) {
  return [...source.matchAll(/\{\s*id:\s*'([a-z0-9-]+)',[\s\S]{0,80}?label:/g)].map(
    (match) => /** @type {string} */ (match[1]),
  )
}

/**
 * @param {string} source
 * @returns {{ id: string, url: string, licence: string }[]}
 */
function declaredFontIds(source) {
  return [
    ...source.matchAll(/id:\s*'([a-z0-9-]+)'[\s\S]*?url:\s*'([^']+)'[\s\S]*?licence:\s*'([^']+)'/g),
  ].map((match) => ({
    id: /** @type {string} */ (match[1]),
    url: /** @type {string} */ (match[2]),
    licence: /** @type {string} */ (match[3]),
  }))
}

/**
 * Enough of a PNG header to know it is one, and how big it is.
 * @param {string} relative
 * @returns {Promise<{ width: number, height: number, bytes: number } | null>}
 */
async function pngSize(relative) {
  const bytes = await readFile(join(root, relative))
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20), bytes: bytes.length }
}

// ── 1 + 2: the look strips ──────────────────────────────────────────────────

const declaredLuts = declaredLutIds(await readSource('src/gl/luts.ts'))
if (declaredLuts.length === 0) {
  fail('no LUT_PRESETS ids found in src/gl/luts.ts — the extractor is stale')
}
for (const id of declaredLuts) {
  if (!LUT_IDS.includes(id)) {
    fail(
      `look "${id}" is declared in src/gl/luts.ts but scripts/lut-looks.mjs has no recipe for it`,
    )
    continue
  }
  const relative = `public/luts/${id}.png`
  /** @type {{ width: number, height: number, bytes: number } | null} */
  let size
  try {
    size = await pngSize(relative)
  } catch {
    fail(
      `look "${id}" is declared in src/gl/luts.ts but ${relative} does not exist — run \`npm run luts:gen\``,
    )
    continue
  }
  if (!size) {
    fail(`${relative} is not a PNG`)
    continue
  }
  if (size.width !== LUT_STRIP_WIDTH || size.height !== LUT_STRIP_HEIGHT) {
    fail(
      `${relative} is ${size.width}x${size.height}; LUT3D_FRAG addresses a ${LUT_STRIP_WIDTH}x${LUT_STRIP_HEIGHT} strip`,
    )
  }
}
for (const id of LUT_IDS) {
  if (!declaredLuts.includes(id)) {
    fail(`scripts/lut-looks.mjs generates look "${id}" that the Filters panel cannot select`)
  }
}

// ── 3 + 4: the fonts ────────────────────────────────────────────────────────

const lock = await readLock()
const declaredFonts = declaredFontIds(await readSource('src/features/layers/fonts.ts'))
if (declaredFonts.length === 0) {
  fail('no FONTS entries found in src/features/layers/fonts.ts — the extractor is stale')
}

const byId = new Map(lock.fonts.map((font) => [font.id, font]))
for (const font of declaredFonts) {
  const entry = byId.get(font.id)
  if (!entry) {
    fail(`font "${font.id}" is in the Text panel but not pinned in models.lock.json`)
    continue
  }
  if (entry.licence !== font.licence) {
    fail(
      `font "${font.id}" is ${font.licence} in src/features/layers/fonts.ts but ${entry.licence} in models.lock.json`,
    )
  }
  if (entry.target !== `public/${font.url}`) {
    fail(`font "${font.id}" is fetched as ${font.url} but the lock pins ${entry.target}`)
  }
  if (!(await fileMatches(entry))) {
    fail(
      `font "${font.id}" is declared but ${entry.target} is missing, the wrong size, or does not match its pinned sha256 — run \`npm run models:fetch\``,
    )
    continue
  }
  const bytes = await readFile(join(root, entry.target))
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') {
    fail(`${entry.target} is not a woff2`)
  }
}
for (const entry of lock.fonts) {
  if (!declaredFonts.some((font) => font.id === entry.id)) {
    fail(
      `models.lock.json pins font "${entry.id}" that src/features/layers/fonts.ts no longer offers`,
    )
  }
}

// ── 5: the licences ─────────────────────────────────────────────────────────

/**
 * The obligation, enforced rather than asserted.
 *
 * The app's own `LICENSE` is MIT and covers none of this. Thirteen SIL OFL
 * 1.1 fonts and a copyleft matting library were being redistributed with no
 * attribution anywhere, and nothing in the build noticed — which is the state
 * this section exists to make unreachable.
 */
const { dependencies } = JSON.parse(await readSource('package.json'))
const names = Object.keys(dependencies)
for (const name of missingDependencyEntries(names)) {
  fail(
    `package.json depends on "${name}" but src/lib/licenses.ts has no entry for it — add the work, its licence and why it is bundled`,
  )
}
for (const id of orphanDirectEntries(names)) {
  fail(`src/lib/licenses.ts lists "${id}" as a direct dependency but package.json no longer does`)
}
for (const id of danglingTransitiveEntries(names)) {
  fail(
    `src/lib/licenses.ts lists "${id}" as transitive but the package.json dependency it arrives through is gone`,
  )
}
// `lock.fonts` entries are `LockEntry`s, whose `id` and `licence` are both
// optional — the font sections are the only ones where every entry carries them,
// but the type cannot know that. Narrows it once here rather than making every
// rule accept a half-populated entry.
const pinnedFonts = lock.fonts.map((font) => ({
  id: /** @type {string} */ (font.id),
  licence: /** @type {string} */ (font.licence),
}))
for (const id of undeclaredFontEntries(pinnedFonts)) {
  fail(
    `src/lib/licenses.ts lists font "${id}", which models.lock.json does not pin — a subset with no sha256 is the D7-F07 defect`,
  )
}
for (const problem of fontLicenceProblems(pinnedFonts)) fail(problem)
for (const id of incompleteEntries()) {
  fail(`src/lib/licenses.ts entry "${id}" has no licence or no https upstream URL`)
}

// The licence texts OFL 1.1 §2 and Apache-2.0 §4(a) require to travel with the
// files. A link to them from a page is not a copy of them, so their absence is a
// build failure rather than a documentation gap.
for (const text of ['public/fonts/OFL-1.1.txt', 'public/fonts/Apache-2.0.txt']) {
  try {
    const body = await readFile(join(root, text), 'utf8')
    if (body.trim().length < 2000) fail(`${text} is too short to be a licence text`)
  } catch {
    fail(`${text} is missing — the OFL and Apache texts have to ship beside the fonts`)
  }
}

// ── 6: the size of what is shipped ───────────────────────────────────────────

/**
 * The byte budget, run over the real tree rather than left to a separate step.
 *
 * `npm run build` already calls this script, so folding the budget in means the
 * `public/` budget cannot be skipped by a pipeline that only knows how to run
 * `assets:check` — which is every pipeline, because that is the one `build`
 * invokes. The rules and their fixtures live in `check-public-budget.mjs`; this
 * is the call site, and it is the call site that makes them a gate rather than
 * a script somebody can run or not.
 */
const publicReport = analyzePublic(join(root, 'public'))
for (const problem of publicReport.problems) fail(problem)

// ── report ──────────────────────────────────────────────────────────────────

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`)
  // No "set REQUIRE_ASSETS=1 to make this a hard failure" here, because this is
  // the hard failure: the `process.exit(1)` below is unconditional and always
  // was, so the advice described a switch this script never read — the only
  // thing the variable changed was which stream the summary went to. It is real
  // and it belongs to `scripts/fetch-models.mjs`, which `prebuild` runs and which
  // warns by default; naming it here pointed at the wrong script.
  const summary = `${problems.length} shipped-asset problem${problems.length === 1 ? '' : 's'}.`
  console.error(summary)
  process.exit(1)
}

/** @param {number} bytes */
const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`
console.log(
  `✓ ${declaredLuts.length} look strips (${LUT_STRIP_WIDTH}x${LUT_STRIP_HEIGHT}), ` +
    `${declaredFonts.length} fonts and ${BUNDLED_WORKS.length} licence entries verified; ` +
    `public/ is ${megabytes(publicReport.totalBytes)} of a ${megabytes(PUBLIC_MAX_BYTES)} budget`,
)
