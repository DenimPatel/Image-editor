import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION as DOC_APP_VERSION } from '../model/defaults'
import {
  APP_VERSION,
  COMMIT_SHA,
  UNKNOWN_COMMIT_SHA,
  buildLabel,
  normaliseCommitSha,
} from './buildInfo'

type PackageJson = { version?: unknown }

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
) as PackageJson

describe('APP_VERSION cannot drift from package.json', () => {
  it("is exactly package.json's version", () => {
    // The failure this closes: `APP_VERSION` was a hardcoded `'1.0.0'` in
    // `defaults.ts` and `package.json` said `1.0.0`, and nothing derived one
    // from the other. A release bump moved one and left the other, and the app
    // went on stamping every saved document with a version that no longer
    // described the build writing it. `vite.config.ts` now reads this file, so
    // the two cannot be written differently — and this asserts it anyway,
    // because "cannot" is a claim and a claim should be checked.
    expect(APP_VERSION).toBe(packageJson.version)
  })

  it('is what `defaults.ts` stamps a document with', () => {
    // The one consumer. If a second `APP_VERSION` ever appears in `src/`, this
    // is where it shows up.
    expect(DOC_APP_VERSION).toBe(APP_VERSION)
  })

  it('is a non-empty semver-shaped string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(APP_VERSION).not.toBe(UNKNOWN_COMMIT_SHA)
    expect(APP_VERSION).not.toBe('0.0.0-dev')
  })
})

describe('the build stamp is defined, not undefined', () => {
  it('has a version', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION.length).toBeGreaterThan(0)
  })

  it('has a commit SHA', () => {
    expect(typeof COMMIT_SHA).toBe('string')
    expect(COMMIT_SHA.length).toBeGreaterThan(0)
  })

  it('never prints the literal string "undefined"', () => {
    // The reported risk: a tarball has no `.git`, `git rev-parse` exits
    // non-zero, and if that were allowed to fall through the substitution the
    // UI would show `1.0.0 (undefined)` — which reads as a bug rather than as
    // "this build has no commit information".
    expect(COMMIT_SHA).not.toBe('undefined')
    expect(buildLabel()).not.toContain('undefined')
  })

  it('prints the version and the SHA together', () => {
    expect(buildLabel()).toBe(`${APP_VERSION} (${COMMIT_SHA})`)
  })

  it('is a short SHA, or the explicit unknown marker', () => {
    if (COMMIT_SHA === UNKNOWN_COMMIT_SHA) {
      expect(COMMIT_SHA).toBe('unknown')
      return
    }
    expect(COMMIT_SHA).toMatch(/^[0-9a-f]{7,40}$/i)
  })
})

describe('normaliseCommitSha', () => {
  it('passes a real SHA through', () => {
    expect(normaliseCommitSha('aea8523')).toBe('aea8523')
  })

  it('replaces anything that is not a non-empty string', () => {
    // Every way a substitution can fail to happen, and every way a tool can
    // hand over something that is not a SHA.
    for (const bad of [undefined, null, '', 0, 1, false, true, {}, [], () => 'x', NaN]) {
      expect(normaliseCommitSha(bad)).toBe(UNKNOWN_COMMIT_SHA)
    }
  })

  it('replaces the strings that would render as a broken stamp', () => {
    // A missing value that got stringified on the way here is a non-empty
    // string, so a bare `typeof` check would wave it through and the footer
    // would read `1.0.0 (undefined)`.
    for (const bad of ['undefined', 'null', 'NaN', '[object Object]', '  ']) {
      expect(normaliseCommitSha(bad)).toBe(UNKNOWN_COMMIT_SHA)
    }
  })

  it('keeps a real SHA that happens to be surrounded by whitespace', () => {
    expect(normaliseCommitSha('  aea8523\n')).toBe('aea8523')
  })
})
