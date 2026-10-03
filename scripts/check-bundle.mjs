#!/usr/bin/env node
/**
 * D9-F08 — hold the line on route-level code splitting, from the build output.
 *
 * `React.lazy` in `src/router.tsx` took the entry chunk from 286 kB to about
 * 20 kB, and that number was true once. Nothing kept it true: a static import
 * anywhere in the entry's graph would fold the whole editor back into the entry
 * chunk, every route would be downloaded by a visitor who only ever read the
 * Hub, and no test would fail. A claim in a report is not a gate.
 *
 * So this reads what was actually emitted:
 *
 *   - `dist/index.html` — the *eager* set: the module script plus every
 *     `modulepreload`. That is precisely the JavaScript a visitor to the Hub
 *     downloads before touching anything. Everything else is on demand.
 *   - `dist/assets/**` — the chunk sizes, and the content of the eager ones.
 *
 * The content check is the interesting half. A `manualChunks` rule that names a
 * chunk makes Rolldown emit it as a *static* dependency of the entry, and Vite
 * then writes a `modulepreload` for it. That is how a `matting` rule put
 * `@imgly/background-removal` and `onnxruntime-web` — 865 kB of JavaScript on
 * top of a 23.9 MB WASM binary — into the Hub's critical path, with a `pdf`
 * rule doing the same for `jspdf`. Filenames would catch those two specific
 * regressions and nothing else, so the eager chunks are also scanned for the
 * libraries that must never appear in them.
 *
 *   node scripts/check-bundle.mjs            # check ./dist
 *   node scripts/check-bundle.mjs some/dir   # check somewhere else
 *
 * Wired into `npm run build`, so it runs in CI and on every deploy build, and
 * imported by `check-bundle.test.mjs`, which asserts the same rules against
 * fixtures rather than against whatever the last build happened to produce.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The entry chunk alone. 286 kB before the split, ~21 kB after; the cap is 3x. */
export const ENTRY_MAX_BYTES = 64 * 1024

/**
 * Everything the Hub downloads before a route is chosen: entry + react + the
 * Rolldown runtime. Measured at ~225 kB. With the `matting` rule in place it
 * was ~1089 kB, so this cap separates the two states by a wide margin rather
 * than by a hair.
 */
export const EAGER_MAX_BYTES = 400 * 1024

/** Filenames that mean "a heavy optional dependency got onto the critical path". */
export const HEAVY_CHUNK = /(matting|onnx|ort\.|jspdf|pdf-|html2canvas)/i

/** …and the same claim, checked against the bytes rather than the filename. */
export const HEAVY_MARKERS = ['onnxruntime', 'background-removal', 'jsPDF']

/** @param {string} path @returns {string | null} */
function readMaybe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** @param {string} path */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** @param {string} html @param {string} base @returns {string[]} */
function assetsIn(html, base) {
  const found = new Set()
  for (const match of html.matchAll(/(?:href|src)="([^"]+\.js)"/g)) {
    const href = match[1]
    // `base` is prepended by Vite as an absolute path; resolve it under dist.
    const path = join(base, href.replace(/^\/+/, '').replace(/^.*assets\//, 'assets/'))
    found.add(path)
  }
  return [...found]
}

/** @param {string} html @returns {string | null} */
function entryScriptIn(html) {
  const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/)
  return match ? match[1] : null
}

/**
 * Everything this check needs to know about a build, and the problems with it.
 * Pure over the filesystem so a test can point it at a fixture.
 */
/** @param {string} distDir */
export function analyzeBundle(distDir) {
  const dir = resolve(distDir)
  const html = readMaybe(join(dir, 'index.html'))
  if (html === null) {
    return { chunks: [], eager: [], entry: null, eagerBytes: 0, problems: ['no dist/index.html'] }
  }
  const entryHref = entryScriptIn(html)
  if (entryHref === null) {
    return {
      chunks: [],
      eager: [],
      entry: null,
      eagerBytes: 0,
      problems: ['dist/index.html declares no <script type="module" src>'],
    }
  }

  const assetDir = join(dir, 'assets')
  const chunks = readdirSync(assetDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, bytes: statSync(join(assetDir, name)).size }))
    .sort((a, b) => b.bytes - a.bytes)

  const eagerPaths = assetsIn(html, dir)
  const entryPath = join(dir, entryHref.replace(/^\/+/, '').replace(/^.*assets\//, 'assets/'))
  const entryName = entryPath.slice(assetDir.length + 1)
  const eager = eagerPaths
    .filter((path) => isFile(path))
    .map((path) => ({ name: path.slice(assetDir.length + 1), bytes: statSync(path).size, path }))
  if (!eager.some((chunk) => chunk.path === entryPath) && isFile(entryPath)) {
    eager.push({ name: entryName, bytes: statSync(entryPath).size, path: entryPath })
  }

  const problems = []
  const entry = eager.find((chunk) => chunk.path === entryPath)
  if (!entry) problems.push('the entry script is not in dist/assets')
  else if (entry.bytes > ENTRY_MAX_BYTES) {
    problems.push(
      `the entry chunk is ${entry.bytes} B, over the ${ENTRY_MAX_BYTES} B budget — a route is probably statically imported again`,
    )
  }

  const eagerBytes = eager.reduce((total, chunk) => total + chunk.bytes, 0)
  if (eagerBytes > EAGER_MAX_BYTES) {
    problems.push(
      `the eager set is ${eagerBytes} B, over the ${EAGER_MAX_BYTES} B budget — a manualChunks rule is preloading an optional dependency`,
    )
  }

  for (const chunk of eager) {
    if (HEAVY_CHUNK.test(chunk.name)) {
      problems.push(`dist/index.html eagerly preloads "${chunk.name}"`)
    }
    const source = readMaybe(chunk.path)
    if (source === null) continue
    for (const marker of HEAVY_MARKERS) {
      if (source.includes(marker)) {
        problems.push(`the eager chunk "${chunk.name}" contains "${marker}"`)
      }
    }
  }

  // Route-level splitting, asserted positively: both routes must exist as their
  // own chunks, and neither may be in the eager set.
  for (const route of ['Hub', 'Editor']) {
    const chunk = chunks.find((entry_) => entry_.name.startsWith(`${route}-`))
    if (!chunk) problems.push(`no ${route} chunk — the routes are not code-split any more`)
    else if (eager.some((item) => item.name === chunk.name)) {
      problems.push(`the ${route} route chunk is eagerly preloaded`)
    }
  }

  return { chunks, eager, entry: entry?.name ?? null, eagerBytes, problems }
}

function main() {
  const distDir = process.argv[2] ?? 'dist'
  const report = analyzeBundle(distDir)
  /** @param {number} bytes */
  const kib = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
  const eager = report.eager.map((chunk) => `${chunk.name} (${kib(chunk.bytes)})`)
  console.log(`eager set: ${eager.join(', ') || '(none)'} — ${kib(report.eagerBytes)} total`)
  if (report.problems.length > 0) {
    console.error('\nBundle check failed:')
    for (const problem of report.problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log('bundle check passed')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
