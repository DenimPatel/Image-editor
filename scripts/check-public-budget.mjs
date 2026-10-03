#!/usr/bin/env node
/**
 * A byte budget for `public/`, because `verify-assets.mjs` only checks that the
 * assets it knows about *exist*.
 *
 * Every committed file in `public/` is shipped to every visitor: `npm run dev`
 * and `vite build` both copy the directory verbatim, so a 30 MB directory is a
 * 30 MB deployment and a 30 MB `git clone`, and not one line of the existing
 * gate notices. `verify-assets.mjs` asks "is `public/luts/kodak-portra.png` a
 * real 1089x33 PNG?" — a question about the files that were *meant* to be
 * there. Nothing asked what else is in the directory, which is the half of the
 * problem where the damage is: a runaway is always a file nobody declared.
 *
 * The shape of the check follows `check-bundle.mjs`: a total cap, a per-directory
 * cap, and a per-file cap, with a generator-check pattern borrowed from
 * `gen-luts.mjs` so a file that *does* have a generator is held to the shape
 * that generator produces rather than to the shape a human guessed.
 *
 * ## The thumbnail decision this has to respect
 *
 * `public/look-thumbs/` is 232.7 kB across 24 files — about 9.7 kB each — and
 * that is deliberately over the 150 kB the thumbnail work was given as a guide.
 * The guide assumed thumbnails would be a preview of a small crop; they are full
 * 24-bit graded renders, because a chip that does not show what the look does is
 * a caption, not a thumbnail. So the per-directory cap for `look-thumbs` is set
 * from the **measured** 232.7 kB with ~1.5x headroom (384 kB), and the
 * per-file cap is set to the largest thumbnail plus the same headroom rather than
 * to a 150 kB total that would have failed a decision somebody already made and
 * explained. What it still catches is the thing that actually goes wrong: a
 * generator re-run at a larger size, or an uncompressed intermediate dropped in
 * beside the outputs. Both blow through a per-file cap that 24 files at 9.7 kB
 * each never approach.
 *
 *   node scripts/check-public-budget.mjs                # check ./public
 *   node scripts/check-public-budget.mjs some/dir       # check somewhere else
 *
 * Wired into `npm run build` and into CI, and imported by
 * `check-public-budget.test.mjs`, which asserts the same rules against fixtures.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Total bytes in `public/`, measured 2026-09-30 at 5,787,834 B (5.52 MB) across
 * 75 files.
 *
 * The figure the brief cares about is the jump from here to 30 MB, so the cap is
 * set to bracket that rather than to sit just above today: 8 MB is 1.46x the
 * current tree, which leaves room for a fourth sample image, a new look, or a
 * handful of licence files as ordinary commits, and leaves no room at all for a
 * generator that started writing full-resolution output.
 *
 * 3.59 MB of the 5.52 MB was `public/models/`, a `face_landmarker.task` that
 * nothing referenced and `models.lock.json` does not pin — the lock's `models`
 * array is empty on purpose, and the file is gone. What is left in `public/` is
 * 2.2 MB of luts, thumbnails, fonts, samples and loose files, and every byte of
 * it is counted against the cap. The report prints the total both with and
 * without the sha256-pinned files, because "the total went up by 400 kB" and
 * "the total went up by 400 kB of something nobody declared" are different
 * problems and the second one is invisible without the split.
 */
export const PUBLIC_MAX_BYTES = 8 * 1024 * 1024

/**
 * The lock, and the one question this check asks of it.
 *
 * ## Why the lock and not a directory name
 *
 * This used to exempt anything under `public/models/`, by prefix, and print a
 * line calling those bytes "sha256-pinned in models.lock.json". Both halves of
 * that sentence were a guess dressed as a check. `models.lock.json` carries
 * `"models": []` and says in its own note that it is empty on purpose — nothing in
 * the app self-hosts weights — so the directory held a 3 758 596 B
 * `face_landmarker.task` that no entry pinned, no code referenced and no gate
 * would have complained about, and the report called it pinned while counting it
 * out of the budget. A prefix cannot be right about a file: `models/` is a place,
 * and what makes a binary legitimate is a sha256 somebody wrote down and
 * `scripts/fetch-models.mjs` verifies before it writes a byte.
 *
 * So the exemption is the lock's own list of targets, and a file in
 * `public/models/` that the lock does not name is an ordinary file held to
 * `PUBLIC_FILE_MAX_BYTES` like any other. Nothing stops a model being added: pin
 * it, and the cap makes room for it and the fetch script keeps it honest.
 *
 * A lock that cannot be read pins nothing. That is the direction to fail in — an
 * unreadable lock must not quietly exempt a whole directory — and the per-file
 * cap is what then says so, out loud.
 *
 * @param {string} [lockPath] absolute path to `models.lock.json`
 * @returns {{ targets: string[] }}
 */
export function readLock(lockPath) {
  const path = lockPath ?? lockPathFromModule()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entries = [
      ...(Array.isArray(parsed.models) ? parsed.models : []),
      ...(Array.isArray(parsed.fonts) ? parsed.fonts : []),
    ]
    return {
      targets: entries
        .map((entry) => entry?.target)
        .filter((target) => typeof target === 'string')
        // Every target in the lock is written as `public/<path>`, and `relative`
        // is the path under `public/`, so the prefix comes off here rather than
        // at every call site.
        .map((target) => target.replace(/^public\//, '')),
    }
  } catch {
    return { targets: [] }
  }
}

/**
 * Where `models.lock.json` is, from the module itself where that works.
 *
 * `import.meta.url` is the honest answer — the lock belongs to the repository the
 * script was loaded from, not to wherever it was invoked from — but it is a
 * `file:` URL only outside a browser-shaped test environment, and `fileURLToPath`
 * throws rather than returning null when it is not one. So the working directory
 * is the fallback, which is this repository's root for every way the script is
 * run and for `vitest`.
 *
 * @returns {string}
 */
function lockPathFromModule() {
  try {
    return fileURLToPath(new URL('../models.lock.json', import.meta.url))
  } catch {
    return resolve('models.lock.json')
  }
}

/**
 * Whether `models.lock.json` pins this exact file, and therefore whether it is
 * exempt from the per-file cap.
 *
 * @param {string} relative path under `public/`, e.g. `models/foo.task`
 * @param {{ targets: string[] }} [lock]
 * @returns {boolean}
 */
export function lockPins(relative, lock) {
  return (lock ?? readLock()).targets.includes(relative)
}

/**
 * Per-directory caps, in bytes, with the measured figure in the comment.
 *
 * A total alone is too blunt to be useful: it says *something* grew, not what,
 * and the first thing anyone does is run `du public/` and find out anyway. These
 * turn that into the answer. A top-level directory that is not in this table is
 * itself a problem — a new shipped directory needs a cap and a reason, not a
 * silent exemption.
 */
export const PUBLIC_DIR_MAX_BYTES = {
  // 282.0 kB, 24 look strips. Generated; `gen-luts.mjs --check` holds the bytes.
  luts: 384 * 1024,
  // 232.7 kB, 24 graded thumbnails. See the module note: over its own 150 kB
  // guide on purpose, so the cap is the measurement plus headroom.
  'look-thumbs': 384 * 1024,
  // 283.1 kB, 13 woff2 fonts plus the two licence texts. Every file is pinned
  // by sha256 in models.lock.json, so this cannot drift without the lock moving.
  fonts: 384 * 1024,
  // 1,117.3 kB, 3 sample photos. This is the directory that can grow by an
  // ordinary mistake — a fourth sample, or a full-resolution export committed
  // by accident — so it carries the loosest per-directory cap of the three.
  'sample-images': 1536 * 1024,
}

/**
 * Shipped directories that exist only when the lock puts something in them.
 *
 * `public/models/` is the one, and it is here rather than in the table above
 * because requiring it to exist would fail every build from a clean checkout:
 * `"models"` in the lock is empty on purpose, `scripts/fetch-models.mjs` writes
 * nothing, and a fresh clone has no `public/models/` at all. A row that demands
 * a directory the product does not ship is a gate that can only be satisfied by
 * committing a stray file.
 *
 * The cap still applies the moment the directory is there — 3,670.5 kB when the
 * 3.59 MB matting weights were in it — and every file inside it is still held to
 * `PUBLIC_FILE_MAX_BYTES` unless the lock pins it by name. So a model added here
 * is a decision somebody has to write down twice, in the budget and in the lock,
 * which is the number of times a 3.6 MB binary ought to be argued for.
 */
export const PUBLIC_OPTIONAL_DIR_MAX_BYTES = {
  models: 8 * 1024 * 1024,
}

/**
 * The largest single unpinned file allowed in `public/`.
 *
 * Measured largest today among unpinned files: the 499 kB Sample 3. Set at
 * 1 MB, so a normal asset passes and the classic runaway — a full-resolution
 * export, an unminified bundle, a build artefact — does not. The licence texts
 * and `404.html` are kilobytes; nothing legitimate is near this.
 */
export const PUBLIC_FILE_MAX_BYTES = 1024 * 1024

/**
 * Per-file caps for directories whose files are uniform and generated.
 *
 * A *total* cap cannot see a generator that stops compressing: 24 files at
 * 9.7 kB is fine, and 24 files at 16 kB is still fine, and by the time the
 * total complains somebody has committed a quarter-megabyte of noise per chip.
 * These hold the shape. Each is the largest file in the directory plus ~1.5x.
 */
export const PUBLIC_UNIFORM_FILE_MAX_BYTES = {
  // Largest strip today: 13,203 B.
  luts: 24 * 1024,
  // Largest thumbnail today: 10,688 B.
  'look-thumbs': 24 * 1024,
}

/** Extensions that are never a real asset and are always a mistake. */
export const PUBLIC_JUNK_EXTENSIONS = ['.map', '.bak', '.tmp', '.log', '.zip', '.psd', '.ai']

/**
 * Every file under `dir`, as absolute paths. Symlinks are not followed: a link
 * into `node_modules` would make the total depend on something the repository
 * does not contain, which is the opposite of the point.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function walkFiles(dir) {
  /** @type {string[]} */
  const found = []
  /** @param {string} current */
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) found.push(path)
    }
  }
  walk(dir)
  return found.sort()
}

/**
 * Everything this check needs to know about a `public/` tree, and the problems
 * with it. Pure over the filesystem so a test can point it at a fixture.
 *
 * `lock` is a parameter rather than a read so a fixture can pin what it needs to
 * pin: the exemption is only interesting when something *is* pinned, and a test
 * that cannot supply the pin can only ever test the negative.
 *
 * @param {string} publicDir
 * @param {{ targets: string[] }} [lock]
 */
export function analyzePublic(publicDir, lock) {
  const pins = lock ?? readLock()
  const dir = resolve(publicDir)
  /** @type {string[]} */
  const problems = []
  let totalBytes = 0

  let files
  try {
    files = walkFiles(dir)
  } catch {
    return {
      files: [],
      totalBytes: 0,
      pinnedBytes: 0,
      pinnedFiles: [],
      unpinnedBytes: 0,
      directories: {},
      largest: null,
      problems: [`no ${publicDir} directory`],
    }
  }

  /** @type {Record<string, { bytes: number, files: number, largest: string, largestBytes: number }>} */
  const directories = {}
  /** @type {Set<string>} */
  const topLevelDirs = new Set()
  /** @type {{ path: string, bytes: number } | null} */
  let largest = null
  let pinnedBytes = 0
  /** @type {string[]} */
  const pinnedFiles = []

  for (const path of files) {
    const bytes = statSync(path).size
    totalBytes += bytes
    const relative = path.slice(dir.length + 1)
    const parts = relative.split('/')
    if (parts.length > 1) topLevelDirs.add(parts[0])
    // The lock, not the directory. See `readLock`.
    const pinned = lockPins(relative, pins)
    if (pinned) {
      pinnedBytes += bytes
      pinnedFiles.push(relative)
    }
    const entry = directories[parts[0]] ?? {
      bytes: 0,
      files: 0,
      largest: relative,
      largestBytes: 0,
    }
    entry.bytes += bytes
    entry.files += 1
    if (bytes > entry.largestBytes) {
      entry.largestBytes = bytes
      entry.largest = relative
    }
    directories[parts[0]] = entry
    if (largest === null || bytes > largest.bytes) largest = { path: relative, bytes }

    if (!pinned && bytes > PUBLIC_FILE_MAX_BYTES) {
      problems.push(
        `${relative} is ${kib(bytes)}, over the ${kib(PUBLIC_FILE_MAX_BYTES)} per-file budget — ` +
          'a full-resolution export or an unminified bundle does not belong in public/',
      )
    }
    const extension = relative.slice(relative.lastIndexOf('.')).toLowerCase()
    if (PUBLIC_JUNK_EXTENSIONS.includes(extension)) {
      problems.push(`${relative} is a "${extension}" file, which is never a shipped asset`)
    }
  }

  if (totalBytes > PUBLIC_MAX_BYTES) {
    problems.push(
      `public/ is ${mib(totalBytes)}, over the ${mib(PUBLIC_MAX_BYTES)} budget — every byte here ` +
        'is copied verbatim into the build and into every clone',
    )
  }

  for (const [name, cap] of Object.entries(PUBLIC_DIR_MAX_BYTES)) {
    const entry = directories[name]
    if (!entry) {
      problems.push(`public/${name} is missing — a declared shipped directory is not there`)
      continue
    }
    if (entry.bytes > cap) {
      problems.push(
        `public/${name} is ${kib(entry.bytes)} across ${entry.files} files, over the ` +
          `${kib(cap)} budget for that directory`,
      )
    }
  }
  // The optional table is capped but never *required*: see its own note for why
  // a fresh clone has no `public/models/`.
  for (const [name, cap] of Object.entries(PUBLIC_OPTIONAL_DIR_MAX_BYTES)) {
    const entry = directories[name]
    if (entry && entry.bytes > cap) {
      problems.push(
        `public/${name} is ${kib(entry.bytes)} across ${entry.files} files, over the ` +
          `${kib(cap)} budget for that directory`,
      )
    }
  }
  for (const name of topLevelDirs) {
    if (!(name in PUBLIC_DIR_MAX_BYTES) && !(name in PUBLIC_OPTIONAL_DIR_MAX_BYTES)) {
      problems.push(
        `public/${name}/ is not in the budget table — a new shipped directory needs a cap and ` +
          'a reason, not a silent exemption',
      )
    }
  }

  for (const [name, cap] of Object.entries(PUBLIC_UNIFORM_FILE_MAX_BYTES)) {
    const entry = directories[name]
    if (!entry) continue
    if (entry.largestBytes > cap) {
      problems.push(
        `public/${entry.largest} is ${kib(entry.largestBytes)}, over the ${kib(cap)} per-file ` +
          `budget for the generated set in public/${name} — a generator that stopped ` +
          'compressing, most likely',
      )
    }
  }

  return {
    files: files.map((path) => path.slice(dir.length + 1)),
    totalBytes,
    pinnedBytes,
    pinnedFiles,
    unpinnedBytes: totalBytes - pinnedBytes,
    directories,
    largest,
    problems,
  }
}

/** @param {number} bytes */
function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}

/** @param {number} bytes */
function mib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function main() {
  const publicDir = process.argv[2] ?? 'public'
  const report = analyzePublic(publicDir)
  if (report.problems.length > 0) {
    for (const problem of report.problems) console.error(`✗ ${problem}`)
    console.error(
      `public/ is ${mib(report.totalBytes)} across ${report.files.length} files ` +
        `(${mib(report.unpinnedBytes)} of it unpinned).`,
    )
    process.exit(1)
  }
  const rows = Object.entries(report.directories)
    .map(
      ([name, entry]) =>
        `  ${name.padEnd(18)} ${kib(entry.bytes).padStart(10)}  ${String(entry.files).padStart(3)} files`,
    )
    .join('\n')
  // The pinned row is printed only when there is something pinned to print, and it
  // is named after the list it came from. A row reading "(pinned models) 0 B" on
  // every build would be the same lie in smaller type.
  const pinnedRow =
    report.pinnedFiles.length === 0
      ? ''
      : `  ${'(sha256-pinned)'.padEnd(18)} ${kib(report.pinnedBytes).padStart(10)}` +
        `  ${String(report.pinnedFiles.length).padStart(3)} files exempt from the per-file cap; ` +
        'each is listed in models.lock.json\n'
  console.log(
    `✓ public/ is ${mib(report.totalBytes)} across ${report.files.length} files\n` +
      `${rows}\n` +
      pinnedRow +
      `  ${'(unpinned)'.padEnd(18)} ${kib(report.unpinnedBytes).padStart(10)}` +
      `  of the ${mib(PUBLIC_MAX_BYTES)} total budget ` +
      `(${kib(PUBLIC_MAX_BYTES - report.totalBytes)} left)`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
