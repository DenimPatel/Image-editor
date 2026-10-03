import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzeBundle,
  EAGER_MAX_BYTES,
  ENTRY_MAX_BYTES,
  HEAVY_CHUNK,
  HEAVY_MARKERS,
} from './check-bundle.mjs'

/**
 * D9-F08 — the bundle gate, asserted against fixtures rather than against
 * whatever the last build produced. A check that only runs after `vite build`
 * is green on the machine that ran it and silent everywhere else; this one
 * fails on a hand-written `index.html`, which is how a regression is caught
 * while it is being written rather than after somebody ships it.
 */

/** @type {string[]} */
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A `dist/` with the given eager chunks and a Hub/Editor pair.
 * @param {Record<string, string>} chunks
 * @param {string[]} [preloads]
 * @param {string} [entryName]
 * @returns {string}
 */
function dist(chunks, preloads = [], entryName = 'index-AAA.js') {
  const root = mkdtempSync(join(tmpdir(), 'ie-bundle-'))
  roots.push(root)
  mkdirSync(join(root, 'assets'))
  for (const [name, source] of Object.entries(chunks)) {
    writeFileSync(join(root, 'assets', name), source)
  }
  const links = [
    `<script type="module" crossorigin src="/Image-editor/assets/${entryName}"></script>`,
  ]
  for (const name of preloads) {
    links.push(`<link rel="modulepreload" crossorigin href="/Image-editor/assets/${name}">`)
  }
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html><html><head>${links.join('\n')}</head><body></body></html>`,
  )
  return root
}

const REACT = 'react-BBB.js'
const RUNTIME = 'rolldown-runtime-CCC.js'
const ROUTES = { 'Hub-DDD.js': 'x', 'Editor-EEE.js': 'y' }

describe('analyzeBundle', () => {
  it('D9-F08: passes a split build with a small entry and a lean eager set', () => {
    const report = analyzeBundle(
      dist({ ...ROUTES, 'index-AAA.js': 'a'.repeat(21_000), [REACT]: 'b', [RUNTIME]: 'c' }, [
        REACT,
        RUNTIME,
      ]),
    )
    expect(report.problems).toEqual([])
    expect(report.entry).toBe('index-AAA.js')
    expect(report.eager.map((chunk) => chunk.name).sort()).toEqual(
      ['index-AAA.js', REACT, RUNTIME].sort(),
    )
  })

  it('D9-F08: a statically re-imported route is caught by the entry budget', () => {
    const report = analyzeBundle(
      dist({
        ...ROUTES,
        'index-AAA.js': 'a'.repeat(ENTRY_MAX_BYTES + 1),
        [REACT]: 'b',
      }),
    )
    expect(report.problems.join('\n')).toMatch(/entry chunk/)
  })

  it('D9-F08: a matting chunk preloaded on the Hub is caught by name and by content', () => {
    // The exact shape that shipped: a `manualChunks` rule naming the chunk
    // makes Rolldown emit it as a static dependency of the entry, and Vite
    // writes the preload for it.
    const report = analyzeBundle(
      dist(
        {
          ...ROUTES,
          'index-AAA.js': 'a'.repeat(21_000),
          [REACT]: 'b',
          'matting-FFF.js': `onnxruntime-web @imgly/background-removal${'x'.repeat(865_000)}`,
        },
        [REACT, 'matting-FFF.js'],
      ),
    )
    expect(report.problems.join('\n')).toMatch(/eagerly preloads "matting-FFF\.js"/)
    expect(report.problems.join('\n')).toMatch(/contains "onnxruntime"/)
    expect(report.eagerBytes).toBeGreaterThan(EAGER_MAX_BYTES)
  })

  it('D9-F08: a heavy dependency under a harmless filename is still caught', () => {
    // A chunk name is not a guarantee. The bytes are.
    const report = analyzeBundle(
      dist({ ...ROUTES, 'index-AAA.js': 'a', 'vendor-GGG.js': 'import "jsPDF"' }, [
        'vendor-GGG.js',
      ]),
    )
    expect(report.problems.join('\n')).toMatch(/contains "jsPDF"/)
  })

  it('D9-F08: a preloaded chunk that crosses the eager budget fails even when it is named well', () => {
    const report = analyzeBundle(
      dist({ ...ROUTES, 'index-AAA.js': 'a', 'big-HHH.js': 'x'.repeat(500_000) }, ['big-HHH.js']),
    )
    expect(report.problems.join('\n')).toMatch(/eager set is/)
  })

  it('D9-F08: routes that stop being separate chunks are caught', () => {
    const report = analyzeBundle(dist({ 'index-AAA.js': 'a' }))
    expect(report.problems.join('\n')).toMatch(/no Hub chunk/)
    expect(report.problems.join('\n')).toMatch(/no Editor chunk/)
  })

  it('D9-F08: a route chunk that is eagerly preloaded is caught', () => {
    const report = analyzeBundle(
      dist({ ...ROUTES, 'index-AAA.js': 'a', 'Editor-EEE.js': 'y' }, ['Editor-EEE.js']),
    )
    expect(report.problems.join('\n')).toMatch(/the Editor route chunk is eagerly preloaded/)
  })

  it('D9-F08: a build with no index.html fails rather than passing quietly', () => {
    const report = analyzeBundle(join(tmpdir(), 'ie-bundle-does-not-exist'))
    expect(report.problems).toEqual(['no dist/index.html'])
  })

  it('D9-F08: the budgets are the numbers they claim to be', () => {
    // 286 kB was the entry before `React.lazy`; these caps have to sit above
    // today's ~21 kB and below that, or they are not budgets at all.
    expect(ENTRY_MAX_BYTES).toBeGreaterThan(21 * 1024)
    expect(ENTRY_MAX_BYTES).toBeLessThan(286 * 1024)
    expect(EAGER_MAX_BYTES).toBeGreaterThan(225 * 1024)
    expect(EAGER_MAX_BYTES).toBeLessThan(1089 * 1024)
  })

  it('D9-F08: the marker list covers the libraries that must stay off the Hub', () => {
    expect(HEAVY_MARKERS).toEqual(['onnxruntime', 'background-removal', 'jsPDF'])
    expect(HEAVY_CHUNK.test('matting-FFF.js')).toBe(true)
    expect(HEAVY_CHUNK.test('jspdf.es.min-ZZZ.js')).toBe(true)
    expect(HEAVY_CHUNK.test('ort.bundle.min-YYY.js')).toBe(true)
    expect(HEAVY_CHUNK.test('index-AAA.js')).toBe(false)
  })
})
