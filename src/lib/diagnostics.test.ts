import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createDoc } from '../model/defaults'
import {
  buildDiagnosticsReport,
  clearDiagnostics,
  collectFacts,
  copyOutcomeMessage,
  copyText,
  captureConsoleError,
  describeUnknown,
  diagnosticCounters,
  diagnosticEntries,
  diagnosticStats,
  hash32,
  installDiagnostics,
  MAX_BYTES,
  MAX_ENTRIES,
  MESSAGE_CAP,
  recordDiagnostic,
  recordManualReport,
  redact,
  refreshStorageEstimate,
  reportBoundaryError,
  safeHref,
  setDiagnosticEngine,
  STACK_CAP,
  truncate,
  type DiagnosticsHandle,
} from './diagnostics'
import { FLAGS_STORAGE_KEY, FLAG_IDS, initFlags, resetFlags, setFlagState } from './flags'

/** A `Storage` double holding one saved record, for the flag tier. */
function memoryStorage(record: Record<string, string>): Storage {
  const map = new Map<string, string>([[FLAGS_STORAGE_KEY, JSON.stringify(record)]])
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage
}

/**
 * The one module whose failures must never be the user's problem, so it is
 * cleared between tests and every assertion starts from an empty ring.
 */
beforeEach(() => clearDiagnostics())

afterEach(() => {
  resetFlags()
  vi.restoreAllMocks()
})

function lastEntry() {
  const entries = diagnosticEntries()
  const entry = entries[entries.length - 1]
  if (!entry) throw new Error('nothing was recorded')
  return entry
}

/** A stack long enough to have to be cut. */
function hugeStack(lines: number): Error {
  const error = new Error('deep')
  error.stack = Array.from(
    { length: lines },
    (_, index) => `    at frame${index} (app.js:1:1)`,
  ).join('\n')
  return error
}

/**
 * jsdom implements `File` and `Blob` but not `ImageData`, and the point of this
 * fixture is that a real `ImageData` is the kind of value whose pixels must
 * never be read. The stand-in carries the same `Symbol.toStringTag` a real one
 * does, which is the only thing `Object.prototype.toString` looks at — so it
 * exercises the same code path a browser would.
 */
if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataStandIn {
    readonly data: Uint8ClampedArray
    constructor(data: Uint8ClampedArray) {
      this.data = data
    }
    // On the prototype, because that is where the platform puts it and where
    // `Object.prototype.toString` reads it from.
    get [Symbol.toStringTag](): string {
      return 'ImageData'
    }
  }
  Object.defineProperty(globalThis, 'ImageData', { value: ImageDataStandIn })
}

describe('the ring buffer is bounded in both count and bytes', () => {
  it('keeps the last 100 entries and drops the oldest', () => {
    for (let index = 0; index < 500; index += 1) {
      recordDiagnostic({ level: 'error', tag: 'manual', message: `event ${index}` })
    }
    const entries = diagnosticEntries()
    expect(entries).toHaveLength(MAX_ENTRIES)
    expect(entries[0]?.message).toBe('event 400')
    expect(entries[MAX_ENTRIES - 1]?.message).toBe('event 499')
  })

  it('a tight throw loop cannot grow it past the byte cap', () => {
    // The failure this exists for: a render that throws on every frame appends
    // ~60 entries a second, and each one can carry a multi-kilobyte stack. A
    // count-only bound would let 100 of those sit in memory for the life of the
    // tab, which is exactly the tab that is already in trouble.
    const stack = hugeStack(200)
    for (let index = 0; index < 4000; index += 1)
      recordDiagnostic({
        level: 'warn',
        tag: 'render.fallback',
        message: `frame ${index} failed`,
        error: stack,
      })
    const stats = diagnosticStats()
    expect(stats.count).toBeLessThanOrEqual(MAX_ENTRIES)
    expect(stats.bytes).toBeLessThanOrEqual(MAX_BYTES)
    // And the count survives the eviction, which is the point of keeping a
    // tally outside the ring: the report says four thousand, not forty.
    expect(diagnosticCounters().find((entry) => entry.tag === 'render.fallback')?.count).toBe(4000)
  })

  it('reports the caps it is holding itself to', () => {
    expect(diagnosticStats()).toEqual({
      count: 0,
      bytes: 0,
      maxEntries: MAX_ENTRIES,
      maxBytes: MAX_BYTES,
    })
  })

  it('hands out copies of the list, so a caller cannot splice the ring', () => {
    recordDiagnostic({ level: 'error', tag: 'manual', message: 'first' })
    const handed = diagnosticEntries()
    handed.push(handed[0]!)
    handed.pop()
    // The array is a copy. Pushing onto it would corrupt the byte accounting,
    // which is the only thing keeping the buffer bounded.
    expect(diagnosticEntries()).toHaveLength(1)
  })
})

describe('truncation cuts, and says that it cut', () => {
  it('leaves a short string alone', () => {
    expect(truncate('short', 100)).toEqual({ text: 'short', truncated: false })
  })

  it('cuts a 10 kB stack to the cap and marks the cut in the text', () => {
    const original = hugeStack(400).stack as string
    expect(original.length).toBeGreaterThan(10_000)
    recordDiagnostic({ level: 'error', tag: 'manual', message: 'boom', error: hugeStack(400) })
    const stack = lastEntry().error?.stack as string
    expect(stack.startsWith(original.slice(0, STACK_CAP))).toBe(true)
    // Smaller than the original by a wide margin, and it says so — a silently
    // shortened stack reads as a complete one.
    expect(stack.length).toBeLessThan(original.length / 2)
    expect(stack).toContain(`[truncated: ${STACK_CAP} of ${original.length} characters kept]`)
    expect(lastEntry().truncated).toBe(true)
  })

  it('caps a message the same way', () => {
    recordDiagnostic({ level: 'error', tag: 'manual', message: 'x'.repeat(5000) })
    expect(lastEntry().message).toContain('[truncated:')
    expect(lastEntry().message.startsWith('x'.repeat(MESSAGE_CAP))).toBe(true)
  })
})

describe('the privacy boundary', () => {
  /**
   * Every one of these is something the app holds a user's work in. None of
   * them may contribute a single byte to the buffer, and the only mechanism
   * that guarantees that is that `recordDiagnostic` reads three string fields
   * off a real `Error` and nothing at all off anything else.
   */
  const carriers = () => {
    const file = new File(['SECRET-FILE-BODY'], 'SECRET-FILENAME.png', { type: 'image/png' })
    const blob = new Blob(['SECRET-BLOB-BODY'], { type: 'image/jpeg' })
    const imageData = new ImageData(new Uint8ClampedArray([7, 7, 7, 255]), 1, 1)
    const doc = createDoc({
      source: {
        assetId: 'SECRET-ASSET-ID',
        width: 8,
        height: 8,
        name: 'SECRET-FILE.png',
        mime: 'image/png',
      },
      look: { id: 'SECRET-LOOK-ID', amount: 0.5 },
    })
    return {
      file,
      blob,
      imageData,
      doc,
      secrets: [
        'SECRET-FILE-BODY',
        'SECRET-FILENAME',
        'SECRET-BLOB-BODY',
        'SECRET-ASSET-ID',
        'SECRET-LOOK-ID',
      ],
    }
  }

  it('records a File, a Blob, an ImageData and a Doc as type names and nothing else', () => {
    const { file, blob, imageData, doc, secrets } = carriers()
    recordDiagnostic({ level: 'error', tag: 'console.error', message: 'context', error: file })
    recordDiagnostic({ level: 'error', tag: 'console.error', message: 'context', error: blob })
    recordDiagnostic({ level: 'error', tag: 'console.error', message: 'context', error: imageData })
    recordDiagnostic({ level: 'error', tag: 'console.error', message: 'context', error: doc })
    captureConsoleError(['save failed', doc])
    captureConsoleError([new Error('inner'), file, blob, imageData])
    reportBoundaryError(new Error('render failed'), '\n    at SecretComponent')

    const report = buildDiagnosticsReport()
    for (const secret of secrets) {
      expect(report, `the report leaked ${secret}`).not.toContain(secret)
      for (const entry of diagnosticEntries()) {
        expect(JSON.stringify(entry), `an entry leaked ${secret}`).not.toContain(secret)
      }
    }
  })

  it('names the type, so a reader still learns that something was passed', () => {
    const { file, blob, imageData } = carriers()
    expect(describeUnknown(file)).toBe('[File]')
    expect(describeUnknown(blob)).toBe('[Blob]')
    expect(describeUnknown(imageData)).toBe('[ImageData]')
    expect(describeUnknown(createDoc())).toBe('[Object]')
    expect(describeUnknown(new Error('real'))).toBe('Error: real')
    expect(describeUnknown('a string')).toBe('a string')
    expect(describeUnknown(null)).toBe('null')
  })

  it('survives an object whose toStringTag getter throws', () => {
    const hostile = new Proxy(
      {},
      {
        get(target, property, receiver) {
          if (property === Symbol.toStringTag) throw new Error('no')
          return Reflect.get(target, property, receiver)
        },
      },
    )
    expect(describeUnknown(hostile)).toBe('[object]')
    expect(() =>
      recordDiagnostic({ level: 'error', tag: 'manual', message: 'x', error: hostile }),
    ).not.toThrow()
  })

  it('strips a data-URL payload out of a logged string', () => {
    // The one way pixels can reach a string: a caller interpolating a canvas
    // into a console message. Only strings get here, so the string is the only
    // place this has to be caught.
    const payload = 'A'.repeat(400)
    const logged = `preview failed data:image/png;base64,${payload}`
    expect(redact(logged)).not.toContain(payload)
    captureConsoleError([logged])
    const report = buildDiagnosticsReport()
    expect(report).toContain('payload omitted')
    expect(report).not.toContain(payload)
  })

  it('has no transport: nothing in this module can send anything', () => {
    // The product's claim is "nothing leaves this tab", and a claim is only
    // worth something if the reporting code is subject to it. Asserted against
    // the source, because a network call can arrive as any of a dozen APIs.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/diagnostics.ts'), 'utf8')
    for (const forbidden of [
      'fetch(',
      'XMLHttpRequest',
      'sendBeacon',
      'WebSocket',
      'EventSource',
      'navigator.sendBeacon',
      'new Image(',
      'import(',
    ]) {
      expect(source, `diagnostics.ts must not use ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe('every feed path reaches the buffer', () => {
  let handle: DiagnosticsHandle
  // Spied *before* installing, so the wrapper's "original" is the spy and the
  // assertion about the console call still happening is about the wrapper
  // really calling through. Reading `console.error` after installing would get
  // the wrapper back, which is the opposite of what is being checked.
  let consoleSpy: MockInstance<typeof console.error>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    handle = installDiagnostics()
  })

  afterEach(() => handle.uninstall())

  it('window.onerror', () => {
    window.onerror?.(
      'Uncaught TypeError: x is not a function',
      'app.js',
      12,
      34,
      new TypeError('x'),
    )
    const entry = lastEntry()
    expect(entry.tag).toBe('window.onerror')
    expect(entry.message).toContain('x is not a function')
    expect(entry.message).toContain('app.js:12:34')
  })

  it('leaves a handler that was already there working', () => {
    handle.uninstall()
    const seen: string[] = []
    const previous = ((message: Event | string) => {
      seen.push(String(message))
    }) as typeof window.onerror
    window.onerror = previous
    const second = installDiagnostics()
    window.onerror?.('both of these should see it', 'app.js', 1, 1)
    expect(seen).toEqual(['both of these should see it'])
    expect(lastEntry().tag).toBe('window.onerror')
    second.uninstall()
    window.onerror = null
  })

  it('unhandledrejection', () => {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new RangeError('nobody caught this')
    window.dispatchEvent(event)
    const entry = lastEntry()
    expect(entry.tag).toBe('unhandledrejection')
    expect(entry.message).toContain('RangeError: nobody caught this')
    expect(entry.error?.name).toBe('RangeError')
  })

  it('an unhandledrejection with a non-Error reason is still recorded', () => {
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = { status: 503, url: 'https://example.invalid/model.onnx' }
    window.dispatchEvent(event)
    expect(lastEntry().message).toContain('Unhandled promise rejection: [Object]')
  })

  it('a console error, and the original console call still happens', () => {
    // This is the one that must not be broken. Silencing a console error is
    // the fastest way to make every future diagnosis of this module impossible.
    const error = new Error('save failed')
    console.error('autosave:', error, { ignored: 'object' })
    expect(consoleSpy, 'the real console.error was not called').toHaveBeenCalledWith(
      'autosave:',
      error,
      { ignored: 'object' },
    )
    const entry = lastEntry()
    expect(entry.tag).toBe('console.error')
    expect(entry.message).toContain('autosave:')
    expect(entry.message).toContain('1 non-text argument not copied')
  })

  it("the boundary's onError, which main.tsx wires to the crash screen's report", () => {
    reportBoundaryError(
      new TypeError('shader failed to compile'),
      '\n    at ToolsPanel\n    at App',
    )
    const entry = lastEntry()
    expect(entry.tag).toBe('react.boundary')
    expect(entry.message).toContain('shader failed to compile')
    expect(entry.frames).toContain('ToolsPanel')
  })

  it('a manual report', () => {
    recordManualReport('the gradient wheel is stuck')
    expect(lastEntry().tag).toBe('manual')
    expect(lastEntry().message).toBe('the gradient wheel is stuck')
  })

  it('uninstall puts both globals back exactly as they were', () => {
    handle.uninstall()
    expect(console.error).toBe(consoleSpy)
    expect(window.onerror).toBeNull()
    handle = installDiagnostics()
  })

  it('installing twice does not double-record', () => {
    handle.uninstall()
    const second = installDiagnostics()
    const third = installDiagnostics()
    console.error('once')
    expect(diagnosticEntries().filter((entry) => entry.tag === 'console.error')).toHaveLength(1)
    second.uninstall()
    third.uninstall()
    handle = installDiagnostics()
  })
})

describe('the report says what a support conversation needs', () => {
  it('carries the build, the page, the browser, the screen and the engine', () => {
    setDiagnosticEngine('canvas2d')
    const facts = collectFacts()
    expect(facts.engine).toBe('canvas2d')
    expect(facts.build).toMatch(/\d+\.\d+\.\d+/)
    const report = buildDiagnosticsReport()
    for (const line of [
      'IMAGE EDITOR — DIAGNOSTICS',
      'Build',
      'Page',
      'Browser',
      'Screen',
      'Render engine  canvas2d',
      'Storage',
      'Service worker',
      'Capabilities',
      'EVENTS',
    ]) {
      expect(report, `the report is missing ${line}`).toContain(line)
    }
  })

  it('leads with what it is and what it is not, before the numbers', () => {
    const report = buildDiagnosticsReport()
    expect(report).toContain('Nothing was sent')
    expect(report).toContain('no image, no pixel, no')
    // The disclaimer is above the facts, so a reader who stops after the first
    // paragraph has still been told what they are about to paste.
    expect(report.indexOf('Nothing was sent')).toBeLessThan(report.indexOf('Build'))
  })

  it('says so when there is nothing recorded, rather than printing an empty section', () => {
    expect(buildDiagnosticsReport()).toContain('(nothing recorded yet)')
  })

  it('names every debug switch, what it is doing and where that came from', () => {
    // A missing control is the failure this section exists to explain: any kill
    // switch in the app can take a feature out, and a report that does not say
    // which are off makes "are any flags set" the first question of every
    // support conversation, asked of a user who cannot answer it.
    resetFlags()
    setFlagState('webgl', 'off')
    const report = buildDiagnosticsReport()
    const section = report.slice(report.indexOf('— DEBUG SWITCHES —'))
    expect(section).toContain('webgl')
    expect(section).toContain('off (saved)')
    // Every registered switch gets a row, not just the ones that are doing
    // something: "the flag you are looking for does not exist" and "it exists
    // and is on" are different answers.
    for (const id of FLAG_IDS) expect(section).toContain(id)
    // A switch nobody has touched says so plainly.
    expect(section).toMatch(/matting\s+default\s/)
  })

  it('lists an unrecognised switch id rather than dropping it', () => {
    // A hand-edited or stale key naming a switch this build does not have. That
    // is what a user who still expects a removed switch to work is running, so
    // it is the one thing here that must not be filtered out.
    initFlags({ search: '', storage: memoryStorage({ 'no-such-flag': 'off' }) })
    const section = buildDiagnosticsReport().slice(
      buildDiagnosticsReport().indexOf('— DEBUG SWITCHES —'),
    )
    expect(section).toContain('unknown')
    expect(section).toContain('no-such-flag')
  })

  it('carries a per-session total even after the ring has evicted the entries', () => {
    for (let index = 0; index < 150; index += 1) {
      recordDiagnostic({ level: 'warn', tag: 'render.fallback', message: `frame ${index}` })
    }
    const report = buildDiagnosticsReport()
    expect(report).toContain('TOTALS THIS SESSION')
    expect(report).toContain('render.fallback: 150')
  })

  it('keeps the query string in the page URL and drops the fragment', () => {
    // The query is a reproduction step — `?engine=canvas2d` is a real one — and
    // the fragment is where a pasted token would sit.
    expect(safeHref('https://example.test/Image-editor/editor?engine=canvas2d#secret')).toBe(
      'https://example.test/Image-editor/editor?engine=canvas2d',
    )
    expect(safeHref('https://user:pass@example.test/editor')).toBe('https://example.test/editor')
    expect(safeHref('not a url')).toBe('(unreadable page url)')
  })

  it('hashes the capability record rather than printing it', () => {
    localStorage.setItem(
      'ie-caps-v4',
      JSON.stringify({
        v: 4,
        at: Date.now(),
        caps: { webgl2: true, maxTextureSize: 16384 },
      }),
    )
    const report = buildDiagnosticsReport()
    expect(report).toMatch(/Capabilities\s+ie-caps [0-9a-f]{8}/)
    expect(report).not.toContain('16384')
  })

  it('fingerprints what the device can do, not when it was last asked', () => {
    // The record is an envelope, and the envelope carries the time of the probe.
    // Hashing the whole record would give the same machine a different
    // fingerprint after every re-probe, which is the one thing a fingerprint is
    // not allowed to do: the hash exists so two devices can be told apart by
    // their limits, so it has to be stable across a re-probe and different
    // across different limits.
    const caps = { webgl2: true, maxTextureSize: 16384, formats: { avif: true, webp: true } }
    const stamp = (at: number, payload: unknown = caps) =>
      localStorage.setItem('ie-caps-v4', JSON.stringify({ v: 4, at, caps: payload }))
    const fingerprint = () => buildDiagnosticsReport().match(/ie-caps ([0-9a-f]{8})/)?.[1]

    stamp(1_000_000)
    const first = fingerprint()
    stamp(1_000_000 + 86_400_000)
    expect(fingerprint()).toBe(first)

    // The same session, and the same numbers, written back in a different key
    // order — a re-probe serialises whatever order the probe happened to fill
    // the object in.
    stamp(1_000_000, {
      formats: { webp: true, avif: true },
      maxTextureSize: 16384,
      webgl2: true,
    })
    expect(fingerprint()).toBe(first)

    // And a genuinely different machine is a different fingerprint, including
    // for a difference that is two keys deep.
    stamp(1_000_000, { ...caps, maxTextureSize: 4096 })
    expect(fingerprint()).not.toBe(first)
    stamp(1_000_000, { ...caps, formats: { avif: false, webp: true } })
    expect(fingerprint()).not.toBe(first)
  })

  it('reads the capability key the renderer actually writes, not a second guess', () => {
    // `src/gl/caps.ts` is not this change's file and its key is module-private,
    // so the literal is repeated. A stale hash would be worse than none: it
    // would look like a capability fingerprint while describing another record.
    const caps = readFileSync(resolve(process.cwd(), 'src/gl/caps.ts'), 'utf8')
    expect(caps).toContain(`'ie-caps-v4'`)
  })

  it('hashes the same string to the same value and a different one to another', () => {
    expect(hash32('abc')).toBe(hash32('abc'))
    expect(hash32('abc')).not.toBe(hash32('abd'))
    expect(hash32('')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('degrades to a plain message when storage refuses to answer', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    expect(collectFacts().capabilities).toBe('storage blocked')
    expect(() => buildDiagnosticsReport()).not.toThrow()
  })

  it('reads the storage estimate, and says so when it cannot', async () => {
    const estimate = vi.fn().mockResolvedValue({ usage: 12_582_912, quota: 1_073_741_824 })
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate },
    })
    await refreshStorageEstimate()
    expect(collectFacts().storage).toBe('12 MB of 1024 MB used')

    estimate.mockRejectedValue(new Error('nope'))
    await refreshStorageEstimate()
    expect(collectFacts().storage).toBe('could not be read')
  })

  it('still builds when `navigator` is a stub with nothing on it', () => {
    // `Editor.test.tsx` stubs `navigator` wholesale to hand the clipboard mock to
    // a paste handler, which leaves `userAgent` undefined. A report that throws
    // while describing its environment is a report that is never produced, and
    // this module is mounted on the crash screen — where a throw is the one
    // thing that cannot be afforded.
    vi.stubGlobal('navigator', { clipboard: {} })
    expect(() => buildDiagnosticsReport()).not.toThrow()
    expect(collectFacts().userAgent).toBe('unknown')
    expect(buildDiagnosticsReport()).toContain('Browser        unknown')
    vi.unstubAllGlobals()
  })
})

describe('copying the report out', () => {
  it('uses the clipboard API when it is there and allowed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    expect(await copyText('report text')).toBe('clipboard')
    expect(writeText).toHaveBeenCalledWith('report text')
  })

  it('falls back to execCommand when the clipboard API refuses', async () => {
    // The case the whole design is built around: a permission error must not
    // become the reason a bug goes unreported.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
      },
    })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    expect(await copyText('report text')).toBe('fallback')
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when the clipboard API is absent entirely', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    expect(await copyText('report text')).toBe('fallback')
  })

  it('hands the user the text when every copy path is gone', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('not supported')
      },
    })
    expect(await copyText('report text')).toBe('manual')
    // Whatever the outcome, the reader is told what to do next rather than being
    // told it worked.
    expect(copyOutcomeMessage('manual')).toMatch(/Ctrl\+C/)
    expect(copyOutcomeMessage('fallback')).toMatch(/select the text/)
  })

  it('leaves no scratch element behind on any path', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => true })
    await copyText('report text')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
