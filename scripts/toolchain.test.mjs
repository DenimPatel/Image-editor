import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Three claims about the toolchain that live in configuration files, where
 * nothing else in the repo can see them and nothing fails when they rot.
 *
 *   - D9-F04  the format gate is repo-wide, not a file list
 *   - D9-F08  the bundle check is wired into the build that CI runs
 *   - D9-F11  there is a way to run the app on a phone on this network
 *
 * A configuration file is a claim like any other, and the two ways it was
 * previously true of nothing — an explicit list of files to format, and a
 * `dev` script that binds loopback only — are exactly the shape of a gate that
 * cannot fail: a file added outside the list is never checked, and a real
 * device can never be pointed at the dev server.
 */

/**
 * Vitest runs with the project root as its cwd, which is the one directory
 * both `package.json` and `.github/` live in. `import.meta.url` is not usable
 * here: the module is transformed for the browser-shaped jsdom environment, so
 * it is an `http:` URL and `readFileSync` rejects it.
 */
const root = process.cwd()
/** @param {string} relative */
const read = (relative) => readFileSync(resolve(root, relative), 'utf8')

const pkg = JSON.parse(read('package.json'))
const ci = read(join('.github', 'workflows', 'ci.yml'))

describe('D9-F04: the format gate', () => {
  it('checks the whole repository, not a list of files this district owns', () => {
    const step = ci
      .split('\n')
      .find((line) => line.trimStart().startsWith('run:') && line.includes('npx prettier --check'))
    expect(step, 'the CI formatting step is missing').toBeDefined()
    expect(step?.trim()).toBe('run: npx prettier --check .')
  })

  it('lists no individual files, because a file added outside one is never checked', () => {
    const step = ci
      .split('\n')
      .find((line) => line.trimStart().startsWith('run:') && line.includes('npx prettier --check'))
    // `run: npx prettier --check .` is the whole command: five tokens and a
    // single `.` argument. Anything after it is a path list, and a path list
    // is a set of files that cannot grow.
    expect(step?.trim().split(/\s+/).slice(4)).toEqual(['.'])
  })

  it('has a formatter to widen the gate with', () => {
    expect(pkg.scripts.format).toBe('prettier --write .')
    expect(pkg.scripts['format:check']).toBe('prettier --check .')
  })
})

describe('D9-F08: the bundle check', () => {
  it('runs as part of `npm run build`, which is what CI runs', () => {
    expect(pkg.scripts.build).toContain('node scripts/check-bundle.mjs')
    // After the bundler, not before it: there is nothing to check until
    // `vite build` has written `dist/`.
    expect(pkg.scripts.build.indexOf('vite build')).toBeLessThan(
      pkg.scripts.build.indexOf('check-bundle.mjs'),
    )
    expect(pkg.scripts['bundle:check']).toBe('node scripts/check-bundle.mjs')
  })
})

describe('D9-F11: running the app on a real device', () => {
  it('exposes a dev-server script that binds a network interface', () => {
    // `--host` with no value is `--host 0.0.0.0`: every interface, so a phone
    // on the same Wi-Fi can reach it. Without it Vite binds 127.0.0.1 and the
    // URL it prints is one no other device can open.
    expect(pkg.scripts['dev:host']).toContain('--host')
    expect(pkg.scripts['dev:host']).toContain('0.0.0.0')
  })

  it('pins the port, so the URL printed for the phone is the URL that answers', () => {
    // Without `--strictPort`, a busy 5173 makes Vite fall through to 5174 and
    // print that instead — which is the URL the developer reads off the
    // terminal and the one the phone cannot open.
    expect(pkg.scripts['dev:host']).toContain('--strictPort')
    expect(pkg.scripts['dev:host']).toMatch(/--port\s+5173/)
  })

  it('keeps 5317, the port the e2e suite owns, out of it', () => {
    // `playwright.config.ts` starts and kills its own server on 5317. A LAN
    // dev server on the same port would be killed by the next e2e run.
    expect(pkg.scripts['dev:host']).not.toContain('5317')
    expect(pkg.scripts['dev:host']).not.toContain('--port 0')
  })

  it('leaves `npm run dev` on loopback, so the default is not a public server', () => {
    expect(pkg.scripts.dev).toBe('vite')
  })

  it('offers the same thing for a production build', () => {
    // The real-device pass that matters is against the built bundle: minified,
    // hashed, and running the service worker that `dev` deliberately skips.
    expect(pkg.scripts['preview:host']).toContain('--host')
    expect(pkg.scripts['preview:host']).toContain('--strictPort')
  })

  it('runs the checker from the repository root, where `dist/` and `vite.config.ts` are', () => {
    // The checker takes `dist` relative to the process cwd and `npm run build`
    // always runs from the package root, so the two have to agree.
    expect(read('vite.config.ts')).toContain('check-bundle')
  })
})
