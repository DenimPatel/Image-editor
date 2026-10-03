import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzePublic,
  lockPins,
  PUBLIC_DIR_MAX_BYTES,
  PUBLIC_FILE_MAX_BYTES,
  PUBLIC_JUNK_EXTENSIONS,
  PUBLIC_MAX_BYTES,
  PUBLIC_UNIFORM_FILE_MAX_BYTES,
  readLock,
} from './check-public-budget.mjs'

/**
 * The `public/` budget, asserted against hand-built fixtures and against the
 * real tree.
 *
 * Two halves, and the second is the half that usually goes missing:
 *
 *  1. A fixture with a runaway asset has to fail. A per-directory byte cap that
 *     is only ever exercised by the tree it was measured from has never been
 *     shown to fire, and `scripts/gen-luts.mjs --check` exists precisely because
 *     "it passed" and "it would have failed" are different claims.
 *  2. The **real** `public/` has to pass. A gate that cannot go green is not a
 *     gate, and this one has to go green on a tree that contains a deliberate,
 *     documented 232.7 kB of thumbnails — a budget that failed that would be
 *     telling somebody to undo a decision they had already made on purpose.
 */

/** @type {string[]} */
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A lock that pins the one big file in the fixture tree.
 *
 * The exemption is keyed on `models.lock.json` and on nothing else, so a fixture
 * that wants a legal 3.6 MB model has to say so the way the product would: by
 * writing the pin down. Cases that assert a clean report pass this; the rest read
 * the real lock, where the fixture's model is unpinned and therefore one more
 * problem — which is the truth about a 3.6 MB file nobody pinned, and is what
 * the exemption cases below assert on purpose.
 */
const FIXTURE_LOCK = { targets: ['models/face_landmarker.task'] }

/**
 * A `public/` fixture shaped like the real one, at the real sizes, so the
 * per-directory and per-file caps are exercised against the same numbers the
 * budget was measured from.
 *
 * @param {Record<string, number>} [layout] path -> bytes
 * @returns {string}
 */
function publicTree(layout) {
  const root = mkdtempSync(join(tmpdir(), 'ie-public-'))
  roots.push(root)
  const spec = layout ?? {
    'luts/kodak-portra.png': 13_203,
    'luts/vivid.png': 11_900,
    'look-thumbs/kodak-portra.png': 10_415,
    'look-thumbs/noir.png': 5_547,
    'fonts/OFL-1.1.txt': 4_200,
    'fonts/Inter.woff2': 22_000,
    'models/face_landmarker.task': 3_758_720,
    'sample-images/sample-1.jpg': 244_823,
    '404.html': 820,
    'sw.js': 2_900,
  }
  for (const [relative, bytes] of Object.entries(spec)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.alloc(bytes, 0x41))
  }
  return root
}

describe('a healthy public/', () => {
  it('passes a tree at the measured sizes', () => {
    const report = analyzePublic(publicTree(), FIXTURE_LOCK)
    expect(report.problems).toEqual([])
  })

  it('passes the real public/, which is the only fixture that cannot be argued with', () => {
    // 24 look strips, 24 graded thumbnails, 13 woff2 fonts and two licence
    // texts, 3 sample photos, and the loose root files. `verify-assets.mjs`
    // checks that these are the *right* files; this checks that there is not too
    // much of them.
    //
    // The floor was 5 MB while `public/models/face_landmarker.task` was on disk —
    // 3.59 MB of it, referenced by nothing and pinned by nothing, which the
    // exemption used to carry out of the budget while reporting it as a fixed
    // cost. The file is gone and the tree measures 2,039,802 B, so the floor is
    // 1.5 MB: enough that an emptied `public/` cannot pass as a healthy one.
    const report = analyzePublic(resolve('public'))
    expect(report.problems).toEqual([])
    expect(report.totalBytes).toBeGreaterThan(1.5 * 1024 * 1024)
    expect(report.totalBytes).toBeLessThan(PUBLIC_MAX_BYTES)
  })

  it('treats the 232.7 kB of graded thumbnails as a decision, not a violation', () => {
    // The thumbnail work was given a 150 kB guide and shipped 232.7 kB on
    // purpose: a chip that does not show what the look does is a caption. The
    // per-directory cap has to clear that with room for a fourth look and a
    // slightly larger render, or the gate is demanding somebody undo it.
    const report = analyzePublic(resolve('public'))
    const measured = report.directories['look-thumbs']
    expect(measured.bytes).toBeGreaterThan(150 * 1024)
    expect(measured.files).toBe(24)
    expect(measured.bytes).toBeLessThan(PUBLIC_DIR_MAX_BYTES['look-thumbs'])
    // And the per-file cap holds the *shape*: 24 files at ~10 kB, not 24 at 40.
    expect(measured.largestBytes).toBeLessThan(PUBLIC_UNIFORM_FILE_MAX_BYTES['look-thumbs'])
  })
})

describe('a runaway asset', () => {
  it('is caught when a generator re-runs at full resolution', () => {
    // 24 thumbnails at 9.7 kB is 232 kB. 24 at 260 kB is 6.2 MB and the shape
    // has changed even though a total cap alone would only just notice.
    /** @type {Record<string, number>} */
    const layout = {}
    for (const id of ['kodak-portra', 'vivid', 'noir', 'sepia']) {
      layout[`look-thumbs/${id}.png`] = 260 * 1024
    }
    const report = analyzePublic(publicTree({ ...emptySpec(), ...layout }))
    expect(report.problems.join('\n')).toMatch(/look-thumbs\/kodak-portra\.png is 260\.0 kB/)
    expect(report.problems.join('\n')).toMatch(/per-file budget for the generated set/)
  })

  it('is caught by the directory cap when 30 MB of thumbnails land', () => {
    /** @type {Record<string, number>} */
    const layout = {}
    for (let index = 0; index < 30; index += 1) {
      layout[`look-thumbs/look-${index}.png`] = 1000 * 1024
    }
    const report = analyzePublic(publicTree({ ...emptySpec(), ...layout }))
    expect(report.problems.join('\n')).toMatch(/public\/ is 32\.90 MB/)
    expect(report.problems.join('\n')).toMatch(/over the 8\.00 MB budget/)
  })

  it('is caught by the per-directory cap, and named, before the total moves', () => {
    /** @type {Record<string, number>} */
    const layout = {}
    for (let index = 0; index < 8; index += 1) {
      layout[`sample-images/shot-${index}.jpg`] = 400 * 1024
    }
    const report = analyzePublic(publicTree({ ...emptySpec(), ...layout }))
    expect(report.problems.join('\n')).toMatch(
      /public\/sample-images is .* over the 1536\.0 kB budget/,
    )
  })

  it('is caught when a full-resolution export is committed by accident', () => {
    // One 6 MB JPEG, the classic "I exported it here instead of downloading it".
    const report = analyzePublic(
      publicTree({ ...emptySpec(), 'sample-images/hero.jpg': 6 * 1024 * 1024 }),
    )
    expect(report.problems.join('\n')).toMatch(/sample-images\/hero\.jpg is 6144\.0 kB/)
    expect(report.problems.join('\n')).toMatch(/over the 1024\.0 kB per-file budget/)
  })

  it('is caught when a build artefact lands beside the assets', () => {
    const report = analyzePublic(publicTree({ ...emptySpec(), 'index.js.map': 900 * 1024 }))
    expect(report.problems.join('\n')).toMatch(/index\.js\.map is a "\.map" file/)
  })

  it('is caught for every junk extension, and the list has no filler in it', () => {
    for (const extension of PUBLIC_JUNK_EXTENSIONS) {
      const spec = emptySpec()
      spec['stray' + extension] = 10
      const report = analyzePublic(publicTree(spec))
      const escaped = extension.replace('.', '\\.')
      expect(report.problems.join('\n'), extension).toMatch(new RegExp('stray' + escaped + ' is a'))
    }
    // A junk file is a mistake even at 10 bytes, so this is not a size check.
    expect(PUBLIC_JUNK_EXTENSIONS).toContain('.map')
  })

  it('is caught when a new shipped directory appears with no cap for it', () => {
    const report = analyzePublic(publicTree({ ...emptySpec(), 'stickers/heart.png': 2048 }))
    expect(report.problems.join('\n')).toMatch(/public\/stickers\/ is not in the budget table/)
  })

  it('is caught when a directory the app needs has been emptied', () => {
    const spec = emptySpec()
    spec['luts/kodak-portra.png'] = 13_203
    delete spec['luts/kodak-portra.png']
    const root = publicTree(spec)
    rmSync(join(root, 'luts'), { recursive: true, force: true })
    expect(analyzePublic(root).problems.join('\n')).toMatch(/public\/luts is missing/)
  })
})

describe('the sha256-pinned exemption', () => {
  it('lets a 3.6 MB model through the per-file cap when the lock pins it', () => {
    const report = analyzePublic(publicTree(), FIXTURE_LOCK)
    expect(report.problems).toEqual([])
    expect(report.pinnedBytes).toBe(3_758_720)
    expect(report.pinnedFiles).toContain('models/face_landmarker.task')
    expect(report.unpinnedBytes).toBe(report.totalBytes - 3_758_720)
  })

  it('does not exempt the same file when nothing pins it, which is the defect it hid', () => {
    // The tree is byte-identical to the case above and the only difference is the
    // lock. The old rule exempted anything under `models/` and printed "(pinned
    // models) … sha256-pinned in models.lock.json" about it, while `models` in
    // that lock is an empty array — so a 3.6 MB file nobody declared passed a gate
    // that reported it as accounted for. Here it is caught, by name.
    const report = analyzePublic(publicTree())
    expect(report.problems.join('\n')).toMatch(
      /models\/face_landmarker\.task is 3670\.6 kB.*over the 1024\.0 kB per-file budget/,
    )
    expect(report.pinnedFiles).not.toContain('models/face_landmarker.task')
    expect(report.pinnedBytes).toBe(0)
  })

  it('asks the lock, and the lock pins nothing under models/ at all', () => {
    // So the exemption has no candidate in this repository today, and the honest
    // report says "(unpinned) …" for every byte of `public/` rather than naming a
    // fixed cost that does not exist. The 14 fonts are pinned and are under the cap
    // anyway, which is what makes the split worth printing at all.
    const lock = readLock()
    expect(lock.targets.filter((target) => target.startsWith('models/'))).toEqual([])
    expect(lock.targets).toHaveLength(14)
    expect(lockPins('models/face_landmarker.task')).toBe(false)
    expect(lockPins('fonts/inter.woff2')).toBe(true)
    expect(lockPins('sample-images/sample-3.jpg')).toBe(false)
    // A lock that cannot be read pins nothing, so a missing file can never widen
    // the exemption: it removes it.
    expect(lockPins('models/anything.task', { targets: [] })).toBe(false)
  })

  it('cannot hide a runaway next to a pinned file', () => {
    // 4 MB of unpinned nothing, one level up from `models/`.
    const report = analyzePublic(
      publicTree({ ...emptySpec(), 'public-models/weights.bin': 4 * 1024 * 1024 }),
      FIXTURE_LOCK,
    )
    expect(report.problems.join('\n')).toMatch(/public-models\/weights\.bin is 4096\.0 kB/)
  })
})

describe('the budget table', () => {
  it('sits above the real tree and far below the 30 MB it exists to catch', () => {
    const measured = analyzePublic(resolve('public')).totalBytes
    expect(PUBLIC_MAX_BYTES).toBeGreaterThan(measured)
    expect(PUBLIC_MAX_BYTES).toBeLessThan(30 * 1024 * 1024)
  })

  it('has a per-directory cap for every directory the real tree ships', () => {
    const directories = analyzePublic(resolve('public')).directories
    for (const name of Object.keys(directories)) {
      const isLooseFile = !directories[name].largest.includes('/')
      if (isLooseFile) continue
      expect(PUBLIC_DIR_MAX_BYTES, name).toHaveProperty([name])
    }
  })

  it('has a per-file cap larger than every real unpinned file', () => {
    const report = analyzePublic(resolve('public'))
    const pinned = new Set(report.pinnedFiles)
    // The largest file in each directory that the lock does not pin, which is the
    // one the per-file cap has to clear. Keyed on the lock rather than on a
    // directory name, for the reason the exemption cases above give.
    for (const [name, entry] of Object.entries(report.directories)) {
      if (pinned.has(entry.largest)) continue
      expect(entry.largestBytes, name).toBeLessThan(PUBLIC_FILE_MAX_BYTES)
    }
    // And at least one file really is pinned, so the loop above is not skipping
    // every directory and passing vacuously.
    expect(report.pinnedFiles.length).toBeGreaterThan(0)
  })
})

/**
 * The directories the analysis needs to exist, with one small file each, so a
 * fixture that is *only* about one runaway still has a legal baseline around it.
 *
 * @returns {Record<string, number>}
 */
function emptySpec() {
  return {
    'luts/kodak-portra.png': 13_203,
    'fonts/OFL-1.1.txt': 4_200,
    'models/face_landmarker.task': 3_758_720,
    '404.html': 820,
  }
}
