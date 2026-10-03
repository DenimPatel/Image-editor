import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_WORKS,
  FONT_LICENCES,
  OBLIGATIONS,
  PACKAGE_LICENCES,
  danglingTransitiveEntries,
  directDependencies,
  fontLicenceProblems,
  incompleteEntries,
  licenceIds,
  licencesSummary,
  missingDependencyEntries,
  orphanDirectEntries,
  undeclaredFontEntries,
  worksUnder,
} from '../../lib/licenses'

/**
 * The obligation, made permanent.
 *
 * Before this file existed, `grep -ri "OFL\|attribution\|credits\|THIRD_PARTY\|
 * NOTICE"` across the repo found exactly one hit, and it was a Pexels photo
 * credit. Thirteen SIL OFL 1.1 fonts were being redistributed with no licence
 * text, no Reserved Font Name notice, and nothing in the build that would notice
 * either. A table of licences is a chore; a table with a gate behind it is an
 * invariant, and these are the tests that make it one.
 *
 * The three that matter:
 *
 *   - `missingDependencyEntries` is a *function*, not an assertion, so
 *     "adding a dependency without an entry fails" is demonstrated by calling
 *     it with a dependency that has no entry and asserting it reports one. The
 *     same function is what `scripts/verify-assets.mjs` calls, so the test and
 *     the build gate cannot disagree about the rule.
 *   - `fontLicenceProblems` reads the licences out of `models.lock.json` rather
 *     than from a second hand-typed list, so a font licence cannot drift from
 *     the manifest that already pins the file.
 *   - the `licenses.html` checks make the user-facing page a projection of the
 *     table, so the page cannot lag behind the declaration.
 */

type PackageJson = {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

type LockFile = {
  fonts: { id: string; licence: string; target: string }[]
}

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8')

const pkg = JSON.parse(read('package.json')) as PackageJson
const lock = JSON.parse(read('models.lock.json')) as LockFile
const dependencyNames = Object.keys(pkg.dependencies)
const licencesHtml = read('public/licenses.html')
const notice = read('NOTICE')

describe('every runtime dependency is attributed', () => {
  it('has an entry for every name in package.json dependencies', () => {
    expect(missingDependencyEntries(dependencyNames)).toEqual([])
  })

  it('reports a dependency added without an entry, so adding one fails the gate', () => {
    // The point of the rule being a function: this is the same call
    // `verify-assets.mjs` makes, with one extra name.
    expect(missingDependencyEntries([...dependencyNames, 'left-pad'])).toEqual(['left-pad'])
  })

  it('does not list a direct dependency that package.json has dropped', () => {
    expect(orphanDirectEntries(dependencyNames)).toEqual([])
    expect(orphanDirectEntries(dependencyNames.filter((name) => name !== 'idb'))).toEqual(['idb'])
  })

  it('attributes one direct entry per declared dependency, and no more', () => {
    expect(
      directDependencies()
        .map((work) => work.id)
        .sort(),
    ).toEqual([...dependencyNames].sort())
  })

  it('gives every transitive entry a parent that is still a declared dependency', () => {
    expect(danglingTransitiveEntries(dependencyNames)).toEqual([])
    expect(danglingTransitiveEntries(dependencyNames.filter((name) => name !== 'jspdf'))).toContain(
      'html2canvas',
    )
  })

  it('has no devDependency in the table, because none of them ships', () => {
    // The converse of the rule above, and the one that keeps the list honest in
    // the other direction: a table padded with vitest and playwright would be a
    // page nobody can read.
    for (const name of Object.keys(pkg.devDependencies)) {
      expect(BUNDLED_WORKS.map((work) => work.id)).not.toContain(name)
    }
  })
})

describe('every font licence comes from the lock, not from a second list', () => {
  it('has an entry for every font models.lock.json pins', () => {
    expect(fontLicenceProblems(lock.fonts)).toEqual([])
    expect(FONT_LICENCES.map((font) => font.id).sort()).toEqual(
      lock.fonts.map((font) => font.id).sort(),
    )
  })

  it('reports a licence that disagrees with the lock', () => {
    const tampered = lock.fonts.map((font) =>
      font.id === 'inter' ? { ...font, licence: 'MIT' } : font,
    )
    expect(fontLicenceProblems(tampered)).toEqual([
      'font "inter" is MIT in models.lock.json but OFL-1.1 in src/lib/licenses.ts',
    ])
  })

  it('reports a pinned font with no entry at all', () => {
    const extra = [...lock.fonts, { id: 'comic-sans', licence: 'OFL-1.1', target: 'x.woff2' }]
    expect(fontLicenceProblems(extra)).toEqual([
      'font "comic-sans" is pinned in models.lock.json but has no entry in src/lib/licenses.ts',
    ])
  })

  it('reports a listed font the lock does not pin, which would ship with no sha256', () => {
    const trimmed = lock.fonts.filter((font) => font.id !== 'inter')
    expect(undeclaredFontEntries(trimmed)).toContain('inter')
  })

  it('states thirteen OFL fonts and one Apache font, which is what the lock says', () => {
    const byLicence = (licence: string) => FONT_LICENCES.filter((font) => font.licence === licence)
    expect(byLicence('OFL-1.1')).toHaveLength(13)
    expect(byLicence('Apache-2.0').map((font) => font.id)).toEqual(['roboto-mono'])
    // `worksUnder` spans the whole table, and Apache-2.0 is also the licence of
    // `comlink` — which is the point of the helper, not a defect in it.
    expect(
      worksUnder('Apache-2.0')
        .map((work) => work.id)
        .sort(),
    ).toEqual(['comlink', 'roboto-mono'])
  })
})

describe('every entry is something a reader can act on', () => {
  it('has a licence and an https upstream', () => {
    expect(incompleteEntries()).toEqual([])
  })

  it('reports an entry with no upstream', () => {
    // A row with a name and a version and no URL is a claim nobody can check.
    const broken = [
      { id: 'ghost', kind: 'package' as const, licence: 'MIT', url: '', direct: true },
    ]
    expect(
      broken.filter((row) => row.licence.trim() === '' || !/^https:\/\//.test(row.url)),
    ).toEqual(broken)
  })

  it('answers "why is it bundled" in a sentence for every entry', () => {
    for (const work of BUNDLED_WORKS) {
      // A `why` of "Bundled" is not an answer, and neither is an empty string:
      // this is the field an auditor reads, and it is the one thing a licence
      // identifier cannot supply.
      expect(work.why.length, work.id).toBeGreaterThan(12)
      expect(work.why.endsWith('.'), work.id).toBe(true)
      expect(work.version.length, work.id).toBeGreaterThan(0)
      expect(work.kind, work.id).toMatch(/^(package|font)$/)
    }
  })

  it('carries a redistribution notice on every font, because every font has one', () => {
    for (const font of FONT_LICENCES) {
      expect(font.notice, font.id).toBeTruthy()
    }
  })

  it('says plainly that the matting library is AGPL-3.0, which is the entry that matters', () => {
    const imgly = PACKAGE_LICENCES.find((work) => work.id === '@imgly/background-removal')
    expect(imgly?.licence).toBe('AGPL-3.0')
    // The failure this table exists to prevent: an entry that reads "MIT"
    // because that is what every other row says.
    expect(imgly?.licence).not.toBe('MIT')
    expect(imgly?.why).toMatch(/Affero/)
  })

  it('has no duplicate id, which would silently drop one of two claims', () => {
    const ids = BUNDLED_WORKS.map((work) => work.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists the licences present, deduplicated and sorted', () => {
    expect(licenceIds()).toEqual([
      'AGPL-3.0',
      'Apache-2.0',
      'ISC',
      'MIT',
      'MPL-2.0 OR Apache-2.0',
      'OFL-1.1',
    ])
    expect(licencesSummary()).toBe('14 fonts and 19 software packages')
  })
})

describe('the user-reachable page is a projection of the table', () => {
  it('names every bundled work', () => {
    for (const work of BUNDLED_WORKS) {
      expect(licencesHtml, work.id).toContain(work.name)
    }
  })

  it('links every upstream it claims', () => {
    for (const work of BUNDLED_WORKS) {
      expect(licencesHtml, work.id).toContain(work.url)
    }
  })

  it('links the licence texts that have to travel with the fonts', () => {
    expect(licencesHtml).toContain('./fonts/OFL-1.1.txt')
    expect(licencesHtml).toContain('./fonts/Apache-2.0.txt')
  })

  it('carries the two obligations, and names the AGPL one as AGPL', () => {
    expect(OBLIGATIONS.map((entry) => entry.id)).toEqual(['@imgly/background-removal', 'ofl'])
    for (const obligation of OBLIGATIONS) {
      expect(licencesHtml, obligation.id).toContain(obligation.headline)
    }
    expect(licencesHtml).toContain('AGPL-3.0')
  })

  it('is reachable by a plain anchor from the app, not only by a route', () => {
    // The crash screen links here, and the crash screen is exactly the moment a
    // router-based page would be unavailable.
    expect(read('src/pages/Hub.tsx')).toContain('licenses.html')
    expect(read('src/components/ui/ErrorBoundary.tsx')).toContain('licenses.html')
  })
})

describe('the licence texts ship, because a link is not a copy', () => {
  it('carries the SIL OFL 1.1 text beside the fonts', () => {
    const ofl = read('public/fonts/OFL-1.1.txt')
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(ofl).toContain('Reserved Font Name')
    // OFL §2: the copy has to travel with the Font Software. This is the copy.
    expect(ofl).toContain('this license')
  })

  it('carries the Apache 2.0 text for the one non-OFL font', () => {
    expect(read('public/fonts/Apache-2.0.txt')).toContain('Apache License')
  })
})

describe('NOTICE records the same claim in the repository', () => {
  it('names the AGPL entry rather than leaving it to the reader', () => {
    expect(notice).toContain('@imgly/background-removal')
    expect(notice).toContain('AGPL')
  })

  it('states the OFL Modified Version position', () => {
    expect(notice).toContain('OFL')
    expect(notice).toMatch(/Reserved Font Name/)
    expect(notice).toMatch(/IE /)
  })

  it('points at the gate that keeps the list complete', () => {
    expect(notice).toContain('assets:check')
    expect(notice).toContain('licenses.html')
  })
})
