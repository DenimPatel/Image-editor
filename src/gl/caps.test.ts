import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAPS_TTL_MS,
  FALLBACK_CAPS,
  PENDING_CAP_READERS,
  loadCaps,
  probeCaps,
  type Caps,
} from './caps'

function makeFakeCanvas(size = 8192) {
  return {
    width: 0,
    height: 0,
    getContext(kind: string) {
      if (kind === 'webgl2') {
        return {
          MAX_TEXTURE_SIZE: 0x0d33,
          MAX_RENDERBUFFER_SIZE: 0x8d41,
          getExtension: (name: string) => (name === 'EXT_color_buffer_half_float' ? {} : null),
          getParameter: (param: number) => (param === 0x0d33 ? size : 4096),
        }
      }
      if (kind === '2d') {
        return {
          fillStyle: '',
          fillRect: () => undefined,
          getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
        }
      }
      return null
    },
    toDataURL: (mime: string) => (mime === 'image/webp' ? 'data:image/webp;base64,' : 'data:,'),
  }
}

describe('probeCaps', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports WebGL2 capabilities from a stubbed context', () => {
    vi.spyOn(document, 'createElement').mockImplementation(
      () => makeFakeCanvas() as unknown as HTMLElement,
    )
    const caps: Caps = probeCaps()
    expect(caps.webgl2).toBe(true)
    expect(caps.maxTextureSize).toBe(8192)
    expect(caps.maxRenderbufferSize).toBe(4096)
    expect(caps.maxCanvasArea).toBe(4096 * 4096)
    expect(caps.formats.webp).toBe(true)
  })

  it('a cached probe expires, and an expired one is probed again', () => {
    // The probe result moves between reads, so "was it re-probed?" is answered by
    // the answer itself rather than by counting canvas allocations.
    let size = 8192
    vi.spyOn(document, 'createElement').mockImplementation(
      () => makeFakeCanvas(size) as unknown as HTMLElement,
    )
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    localStorage.clear()
    expect(loadCaps().maxTextureSize).toBe(8192)

    // The browser reports something else now, as it would after an update. Inside
    // the window the cache is the answer, and the difference is not noticed.
    size = 4096
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 60 * 60 * 1000)
    expect(loadCaps().maxTextureSize).toBe(8192)

    // One millisecond inside the window, still cached.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + CAPS_TTL_MS)
    expect(loadCaps().maxTextureSize).toBe(8192)

    // One past it, re-probed, and the new answer is believed.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + CAPS_TTL_MS + 1)
    expect(loadCaps().maxTextureSize).toBe(4096)
  })

  it('a cache written by a build with a different shape is not trusted', () => {
    vi.spyOn(document, 'createElement').mockImplementation(
      () => makeFakeCanvas() as unknown as HTMLElement,
    )
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    // The bare `Caps` the previous key stored: the same fields, no envelope, and
    // no way to tell how old it is — which is the whole defect.
    localStorage.setItem('ie-caps-v4', JSON.stringify({ webgl2: true, maxTextureSize: 999 }))
    expect(loadCaps().maxTextureSize).toBe(8192)
  })

  it('a value already handed out is not re-decided under the caller', () => {
    // The render loop calls this on a schedule and the export sheet calls it once
    // and holds the result across an encode. Expiry is a property of a *read*, not
    // of an object, so a probe landing later cannot change an answer somebody
    // already has — and a document cannot find its own limits moving under it.
    let size = 8192
    vi.spyOn(document, 'createElement').mockImplementation(
      () => makeFakeCanvas(size) as unknown as HTMLElement,
    )
    const now = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    localStorage.clear()
    const held = loadCaps()
    size = 4096
    vi.spyOn(Date, 'now').mockReturnValue(now + CAPS_TTL_MS + 1)
    expect(loadCaps().maxTextureSize).toBe(4096)
    expect(held.maxTextureSize).toBe(8192)
  })

  it('a clock that moved backwards re-probes instead of trusting a future stamp', () => {
    vi.spyOn(document, 'createElement').mockImplementation(
      () => makeFakeCanvas() as unknown as HTMLElement,
    )
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    localStorage.clear()
    loadCaps()
    vi.spyOn(Date, 'now').mockReturnValue(999_999)
    expect(loadCaps().maxTextureSize).toBe(8192)
  })

  it('falls back cleanly when webgl2 is unavailable', () => {
    vi.spyOn(document, 'createElement').mockImplementation(
      () =>
        ({
          width: 0,
          height: 0,
          getContext: (kind: string) =>
            kind === '2d'
              ? {
                  fillStyle: '',
                  fillRect: () => undefined,
                  getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
                }
              : null,
          toDataURL: () => 'data:,',
        }) as unknown as HTMLElement,
    )
    const caps = probeCaps()
    expect(caps.webgl2).toBe(false)
    expect(caps.maxCanvasArea).toBe(4096 * 4096)
    expect(caps.formats.webp).toBe(false)
  })
})

// --- D9-F10: nothing is probed that nothing reads ------------------------------

const SRC = resolve(process.cwd(), 'src')
const CAPS = join(SRC, 'gl', 'caps.ts')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)
const capsSource = readFileSync(CAPS, 'utf8')

/** Every non-test module in `src/` except this file, with its source. */
const MODULES = sourceFiles(SRC)
  .filter((path) => !isTest(path) && path !== CAPS)
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }))

/** An exported function in caps.ts, and the source of its body. */
function exportedFunctions(): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = []
  const pattern = /^export function (\w+)\(/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(capsSource)) !== null) {
    const next = capsSource.indexOf('\nexport ', match.index + 1)
    found.push({
      name: match[1]!,
      body: capsSource.slice(match.index, next < 0 ? undefined : next),
    })
  }
  return found
}

const FUNCTIONS = exportedFunctions()

/** A key counts as read by a module if it is used there, or via an accessor. */
function readersOf(key: string): string[] {
  const direct = MODULES.filter((mod) => new RegExp(`\\.\\s*${key}\\b`).test(mod.text))
  if (direct.length > 0) return direct.map((mod) => mod.path)
  const accessors = FUNCTIONS.filter(
    (fn) =>
      new RegExp(`\\.\\s*${key}\\b`).test(fn.body) &&
      MODULES.some((mod) => mod.text.includes(`${fn.name}(`)),
  )
  return accessors.map((fn) => `${CAPS}#${fn.name}`)
}

describe('D9-F10: every probed capability has a reader', () => {
  it('reads each field of Caps outside this file, or registers the call site it is waiting on', () => {
    const unread = Object.keys(FALLBACK_CAPS).filter(
      (key) => readersOf(key).length === 0 && !(key in PENDING_CAP_READERS),
    )
    // This is the invariant. `offscreenCanvas` and `colorBufferHalfFloat` both
    // sat here for the length of a release cycle: probed on every cold start,
    // cached, serialised into the record, read by nothing. A new field that
    // lands in `Caps` without a reader now fails this line.
    expect(unread).toEqual([])
  })

  it('keeps the pending-reader register honest', () => {
    for (const [key, entry] of Object.entries(PENDING_CAP_READERS)) {
      expect(Object.keys(FALLBACK_CAPS), `${key} is not a Caps field`).toContain(key)
      const fn = FUNCTIONS.find((candidate) => candidate.name === entry.consumedBy)
      expect(fn, `${key} names a function that does not exist`).toBeDefined()
      expect(fn!.body, `${key} is not read by ${entry.consumedBy}`).toMatch(
        new RegExp(`\\.\\s*${key}\\b`),
      )
      // Landing the call site retires the entry rather than leaving a stale
      // register behind, so the field has to still be unread for the entry to
      // be true.
      const callSite = resolve(process.cwd(), entry.callSite)
      expect(existsSync(callSite), `${entry.callSite} does not exist`).toBe(true)
      expect(
        readFileSync(callSite, 'utf8'),
        `${key} already has a reader at ${entry.callSite}: drop the entry`,
      ).not.toMatch(new RegExp(`capsPreviewLongEdge\\(`))
    }
  })

  it('does not carry a probe nothing can read', () => {
    // The deletions themselves, named so they cannot be quietly re-added.
    for (const gone of ['offscreenCanvas', 'colorBufferHalfFloat', 'workerWebgl']) {
      expect(Object.keys(FALLBACK_CAPS)).not.toContain(gone)
    }
  })
})
