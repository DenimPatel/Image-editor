import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FLAGS_STORAGE_KEY,
  FLAG_IDS,
  FLAG_REGISTRY,
  clearAllFlags,
  clearFlagState,
  describeDisabledFlag,
  flagDef,
  flagOff,
  flagOn,
  flagReport,
  flagSource,
  flagState,
  initFlags,
  isFlagId,
  parseFlagQuery,
  parseStoredFlags,
  resetFlags,
  resolveFlagState,
  setFlagState,
  snapshotFor,
  storedFlagsRaw,
  subscribeFlags,
  type FlagId,
} from './flags'

/* -------------------------------------------------------------------------- */
/* The registry is total                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every `src/` file except tests, which is where a gate could live.
 *
 * `.test.` files are excluded because this test reads *itself* — the id literals
 * in the assertions below are exactly what it is looking for, and including them
 * would make the invariant unfalsifiable.
 */
function sourceFiles(dir = resolve(process.cwd(), 'src')): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path))
      continue
    }
    if (/\.test\.tsx?$/.test(path) || /\.d\.ts$/.test(path)) continue
    found.push(path)
  }
  return found
}

/**
 * Every flag id handed to a reader as a *literal*.
 *
 * The reader name is matched on `[Ff]lag`, not `Flag`, because the module uses
 * both spellings on purpose: the plain functions are `flagState` / `flagOff` /
 * `flagSource` and the React bindings are `useFlagState` / `useFlagOff`. An
 * earlier version of this pattern only matched the second group, which made it
 * silently blind to `flagOff('webgl')` in `selectBackend.ts` — exactly the class
 * of gate that cannot fail and cannot be seen.
 */
function literalFlagReads(): { id: string; file: string }[] {
  const pattern = /\b\w*[Ff]lag\w*\(\s*'([^']*)'/g
  const reads: { id: string; file: string }[] = []
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      reads.push({ id: match[1], file: file.slice(process.cwd().length + 1) })
    }
  }
  return reads
}

describe('the registry is total', () => {
  it('every flag id the code reads is declared in the registry', () => {
    // This is the invariant that matters. A gate on an undeclared id is a
    // switch that can never be thrown: the id is rejected on the way in, so
    // `?off=<that id>` silently does nothing and the panel it was meant to
    // protect stays broken.
    const reads = literalFlagReads()
    expect(reads.length).toBeGreaterThan(0)
    const undeclared = reads.filter((read) => !isFlagId(read.id))
    expect(
      undeclared,
      `code reads undeclared flag id(s). Declare them in FLAG_REGISTRY in src/lib/flags.ts, or ` +
        `fix the id:\n${undeclared.map((r) => `  ${r.id}  (${r.file})`).join('\n')}\n` +
        `Declared ids: ${FLAG_IDS.join(', ')}`,
    ).toEqual([])
  })

  it('every declared flag is read by real code, so none of them is decoration', () => {
    // The other direction. A flag nothing reads is a promise to maintain a gate
    // for a feature that cannot fail, and a row in the Help overlay the user
    // reads as a promise. Either wire it up or delete it.
    const read = new Set(literalFlagReads().map((entry) => entry.id))
    const orphans = FLAG_IDS.filter((id) => !read.has(id))
    expect(orphans, `declared but never read by any gate: ${orphans.join(', ')}`).toEqual([])
  })

  it('every declared flag names a real file, and that file gates the flag', () => {
    const reads = literalFlagReads()
    for (const entry of FLAG_REGISTRY) {
      // `gates` is written "path — what it does", and the file is the part
      // before the dash. A stale pointer is worse than none: it sends the next
      // reader to a file that has nothing to do with the flag.
      const file = entry.gates.split(' — ')[0]
      expect(existsSync(resolve(process.cwd(), file)), `${entry.id} gates a missing file`).toBe(
        true,
      )
      expect(
        reads.filter((read) => read.id === entry.id).map((read) => read.file),
        `${entry.id} names ${file} as its gate, but no read of it is there`,
      ).toContain(file)
    }
  })

  it('has unique, url-safe ids and no entry missing a word', () => {
    expect(new Set(FLAG_IDS).size).toBe(FLAG_IDS.length)
    for (const entry of FLAG_REGISTRY) {
      expect(entry.id, 'an id has to survive a comma-separated url').toMatch(/^[a-z][a-z0-9]*$/)
      for (const field of ['label', 'gates', 'description', 'today'] as const) {
        expect(entry[field].trim().length, `${entry.id}.${field} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('rejects an id that is not declared, by type and at runtime', () => {
    // The static half is the test above; this is the runtime half, for the
    // callers that build an id from a URL.
    expect(isFlagId('matting')).toBe(true)
    expect(isFlagId('nosuchthing')).toBe(false)
    expect(() => flagDef('matting')).not.toThrow()
  })
})

/* -------------------------------------------------------------------------- */
/* The query tier                                                              */
/* -------------------------------------------------------------------------- */

describe('?features= and ?off=', () => {
  it('turns a flag on', () => {
    expect(parseFlagQuery('?features=matting')).toEqual({ values: { matting: 'on' }, unknown: [] })
  })

  it('turns a flag off', () => {
    expect(parseFlagQuery('?off=matting')).toEqual({ values: { matting: 'off' }, unknown: [] })
  })

  it('reads a comma-separated list', () => {
    expect(parseFlagQuery('?features=matting,export').values).toEqual({
      matting: 'on',
      export: 'on',
    })
  })

  it('drops empty segments instead of calling them unknown flags', () => {
    // A trailing comma is a typo in punctuation, not a request for a feature
    // named "". Reporting it would make the unknown-id path fire on every URL a
    // browser help page produces.
    expect(parseFlagQuery('?features=')).toEqual({ values: {}, unknown: [] })
    expect(parseFlagQuery('?features=,matting,,')).toEqual({
      values: { matting: 'on' },
      unknown: [],
    })
    expect(parseFlagQuery('?off=')).toEqual({ values: {}, unknown: [] })
  })

  it('tolerates whitespace and duplicate ids', () => {
    expect(parseFlagQuery('?features=%20matting%20,matting').values).toEqual({ matting: 'on' })
    expect(parseFlagQuery('?off=matting,matting').values).toEqual({ matting: 'off' })
  })

  it('collects an unknown id and does not apply it', () => {
    const parsed = parseFlagQuery('?features=matting,nosuchthing')
    expect(parsed.values).toEqual({ matting: 'on' })
    expect(parsed.unknown).toEqual(['nosuchthing'])
  })

  it('lists an unknown id once even when it repeats', () => {
    expect(parseFlagQuery('?features=nosuchthing&off=nosuchthing').unknown).toEqual(['nosuchthing'])
  })

  it('lets off beat on for the same id, whichever order they appear in', () => {
    // The contradictory case. `off` wins because it is the reading that loses
    // least: a feature the user cannot reach is recoverable by deleting the
    // parameter, while a feature forced on that was meant to be off may be the
    // thing that is broken.
    expect(parseFlagQuery('?features=matting&off=matting').values).toEqual({ matting: 'off' })
    expect(parseFlagQuery('?off=matting&features=matting').values).toEqual({ matting: 'off' })
  })
})

describe('the deprecated ?engine= parameter', () => {
  it('is the same thing as the engine flag, not a second mechanism', () => {
    expect(parseFlagQuery('?engine=gl').values).toEqual({ engine: 'on' })
    expect(parseFlagQuery('?engine=canvas2d').values).toEqual({ engine: 'off' })
    expect(parseFlagQuery('?engine=auto')).toEqual({ values: {}, unknown: [] })
  })

  it('yields to an explicit switch in the same url', () => {
    expect(parseFlagQuery('?engine=gl&off=engine').values).toEqual({ engine: 'off' })
    expect(parseFlagQuery('?engine=canvas2d&features=engine').values).toEqual({ engine: 'on' })
  })

  it('reports a value that is neither of the three it knows', () => {
    const parsed = parseFlagQuery('?engine=vulkan')
    expect(parsed.values).toEqual({})
    expect(parsed.unknown).toEqual(['engine=vulkan'])
  })
})

/* -------------------------------------------------------------------------- */
/* The storage tier                                                            */
/* -------------------------------------------------------------------------- */

describe('ie-flags-v1', () => {
  it('reads a record of on and off', () => {
    expect(parseStoredFlags('{"matting":"off","export":"on"}').values).toEqual({
      matting: 'off',
      export: 'on',
    })
  })

  it('reads nothing from a key that is absent, empty or not json', () => {
    for (const raw of [null, '', '{not json', '"a string"', '[]', '42']) {
      expect(parseStoredFlags(raw), `raw=${String(raw)}`).toEqual({ values: {}, unknown: [] })
    }
  })

  it('drops a value that is not the string on or off', () => {
    // `{"matting": false}` is what a hand-edited key or an older build leaves
    // behind. Reading it as `off` would disable a feature nobody switched off.
    expect(parseStoredFlags('{"matting":false}').values).toEqual({})
    expect(parseStoredFlags('{"matting":true}').values).toEqual({})
    expect(parseStoredFlags('{"matting":null}').values).toEqual({})
  })

  it('reports an id that has left the registry', () => {
    const parsed = parseStoredFlags('{"matting":"off","retired":"on"}')
    expect(parsed.values).toEqual({ matting: 'off' })
    expect(parsed.unknown).toEqual(['retired'])
  })
})

/* -------------------------------------------------------------------------- */
/* Precedence                                                                  */
/* -------------------------------------------------------------------------- */

describe('precedence', () => {
  const merged = (search: string, stored: string | null) => snapshotFor(search, stored)

  it('puts the url above storage', () => {
    expect(resolveFlagState(merged('?off=matting', '{"matting":"on"}'), 'matting')).toBe('off')
    expect(resolveFlagState(merged('?features=matting', '{"matting":"off"}'), 'matting')).toBe('on')
  })

  it('falls through to storage when the url says nothing about the flag', () => {
    expect(resolveFlagState(merged('?off=export', '{"matting":"off"}'), 'matting')).toBe('off')
  })

  it('is default when neither tier mentions the flag', () => {
    expect(resolveFlagState(merged('', ''), 'matting')).toBe('default')
    expect(resolveFlagState(merged('?features=export', '{"matting":"off"}'), 'export')).toBe('on')
  })
})

/* -------------------------------------------------------------------------- */
/* The live store                                                              */
/* -------------------------------------------------------------------------- */

describe('the live store', () => {
  beforeEach(() => {
    localStorage.clear()
    resetFlags()
  })

  afterEach(() => {
    localStorage.clear()
    resetFlags()
    vi.restoreAllMocks()
  })

  it('reads the url and storage on first use', () => {
    localStorage.setItem(FLAGS_STORAGE_KEY, '{"matting":"off"}')
    // jsdom's location.search is empty here, so the storage tier is the only
    // one that can answer — which is exactly the case a reload has to survive.
    resetFlags()
    expect(flagState('matting')).toBe('off')
    expect(flagSource('matting')).toBe('saved')
    expect(flagState('export')).toBe('default')
    expect(flagSource('export')).toBe('default')
  })

  it('is tri-state, and only off is a restriction', () => {
    setFlagState('matting', 'default')
    expect(flagState('matting')).toBe('default')
    expect(flagOff('matting')).toBe(false)
    setFlagState('matting', 'on')
    expect(flagState('matting')).toBe('on')
    // `on` is an explicit request, not a restriction — the feature behaves as it
    // ships either way. Only `flagOn` can tell the two apart.
    expect(flagOff('matting')).toBe(false)
    expect(flagOn('matting')).toBe(true)
    setFlagState('matting', 'off')
    expect(flagOff('matting')).toBe(true)
    expect(flagOn('matting')).toBe(false)
  })

  it('persists a write across a navigation', () => {
    setFlagState('matting', 'off')
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBe('{"matting":"off"}')
    // A navigation is a fresh read of the same two sources.
    resetFlags()
    expect(flagState('matting')).toBe('off')
  })

  it('survives another tab changing the key', () => {
    setFlagState('export', 'off')
    window.dispatchEvent(new StorageEvent('storage', { key: FLAGS_STORAGE_KEY }))
    expect(flagState('export')).toBe('off')
  })

  it('ignores a storage event for a different key', () => {
    const before = flagReport()
    window.dispatchEvent(new StorageEvent('storage', { key: 'ie-caps-v4' }))
    expect(flagReport().rows).toEqual(before.rows)
  })

  it('notifies subscribers on a write and on a clear', () => {
    const seen: string[] = []
    const unsubscribe = subscribeFlags(() => seen.push(String(flagState('matting'))))
    setFlagState('matting', 'off')
    clearFlagState('matting')
    unsubscribe()
    setFlagState('matting', 'off')
    expect(seen).toEqual(['off', 'default'])
  })

  it('removes the key entirely when the last override goes back to default', () => {
    setFlagState('matting', 'off')
    setFlagState('export', 'off')
    clearFlagState('matting')
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBe('{"export":"off"}')
    clearAllFlags()
    // An empty record is indistinguishable from a clean browser, and a key left
    // under a name nobody will read again is one more thing to rot.
    expect(localStorage.getItem(FLAGS_STORAGE_KEY)).toBeNull()
  })

  it('still changes state for this session when storage refuses the write', () => {
    // Safari private mode throws at the property, not only at the call, so the
    // whole access is wrapped rather than only the write.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => setFlagState('matting', 'off')).not.toThrow()
    expect(flagState('matting')).toBe('off')
  })

  it('reads nothing when the property itself throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(storedFlagsRaw()).toBeNull()
    expect(flagState('matting')).toBe('default')
  })

  it('warns loudly about an unknown id in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initFlags({ search: '?features=nosuchthing' })
    expect(warn).toHaveBeenCalledOnce()
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('nosuchthing')
    // The message has to say what *is* declared, or a typo is still a dead end.
    expect(line).toContain('matting')
  })

  it('returns the unknown ids to whoever wants to surface them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(initFlags({ search: '?features=matting,nosuchthing' })).toEqual(['nosuchthing'])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('warns on the lazy read too, because that is the path the app takes', () => {
    // Nothing in the app calls `initFlags`: the first read is what picks the
    // URL up, so a warning that only lived in `initFlags` would never fire in
    // a browser. Caught by loading one with a bad id and reading it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    initFlags({ search: '?off=matting', storage: storage as unknown as Storage })
    warn.mockClear()
    resetFlags()
    window.history.replaceState({}, '', '/?features=nosuchthing')
    expect(flagState('matting')).toBe('default')
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).toContain('nosuchthing')
    window.history.replaceState({}, '', '/')
  })

  it('warns once for a lazy read, not on every read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.history.replaceState({}, '', '/?features=nosuchthing')
    resetFlags()
    flagState('matting')
    flagState('export')
    flagReport()
    expect(warn).toHaveBeenCalledOnce()
    window.history.replaceState({}, '', '/')
  })

  it('does not warn for an id it does know', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initFlags({ search: '?features=matting,export&off=webgl' })
    expect(warn).not.toHaveBeenCalled()
  })
})

/* -------------------------------------------------------------------------- */
/* A url flag the user may not remember setting                                 */
/* -------------------------------------------------------------------------- */

describe('a url flag is not clobbered by a later write', () => {
  beforeEach(() => {
    localStorage.clear()
    resetFlags()
  })
  afterEach(() => {
    localStorage.clear()
    resetFlags()
  })

  it('leaves the effective state at off when storage is written with on', () => {
    const unknown = initFlags({ search: '?off=matting' })
    expect(unknown).toEqual([])
    expect(flagState('matting')).toBe('off')
    expect(flagSource('matting')).toBe('url')

    setFlagState('matting', 'on')

    // The url is somebody's explicit instruction for this page load and a write
    // from a panel must not outrank it. Both records are kept, so the Help
    // overlay can show them disagreeing — which is the truth.
    expect(flagState('matting')).toBe('off')
    expect(flagSource('matting')).toBe('url')
    expect(JSON.parse(localStorage.getItem(FLAGS_STORAGE_KEY) ?? '{}')).toEqual({ matting: 'on' })
    expect(window.location.search).toBe('')
  })

  it('reports both tiers in the diagnostics surface', () => {
    initFlags({ search: '?off=matting' })
    setFlagState('matting', 'on')
    const row = flagReport().rows.find((entry) => entry.id === 'matting')
    expect(row?.state).toBe('off')
    expect(row?.source).toBe('url')
    expect(row?.blocking).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* The diagnostics surface                                                     */
/* -------------------------------------------------------------------------- */

describe('flagReport', () => {
  beforeEach(() => {
    localStorage.clear()
    resetFlags()
  })
  afterEach(() => {
    localStorage.clear()
    resetFlags()
  })

  it('has a row per declared flag, in registry order', () => {
    const rows = flagReport().rows
    expect(rows.map((row) => row.id)).toEqual([...FLAG_IDS])
    for (const row of rows) {
      expect(row.today.trim().length).toBeGreaterThan(0)
      expect(row.gates.trim().length).toBeGreaterThan(0)
    }
  })

  it('is a stable identity between reads, so a subscriber cannot loop', () => {
    // `useSyncExternalStore` compares by identity; a fresh object every call is
    // an infinite render loop rather than a re-render.
    const before = flagReport()
    expect(flagReport()).toBe(before)
    setFlagState('matting', 'off')
    expect(flagReport()).not.toBe(before)
  })

  it('names the tier a flag came from, and whether anything is saved', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(flagReport().hasSaved).toBe(false)
    initFlags({ search: '?off=matting,nosuchthing' })
    setFlagState('export', 'off')
    const report = flagReport()
    expect(report.rows.find((row) => row.id === 'matting')?.source).toBe('url')
    expect(report.rows.find((row) => row.id === 'export')?.source).toBe('saved')
    expect(report.rows.find((row) => row.id === 'webgl')?.source).toBe('default')
    expect(report.unknown).toEqual(['nosuchthing'])
    expect(report.hasSaved).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
  })
})

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

describe('describeDisabledFlag', () => {
  beforeEach(() => {
    localStorage.clear()
    resetFlags()
  })
  afterEach(() => {
    localStorage.clear()
    resetFlags()
  })

  it('says where a url flag is, because no panel can clear it', () => {
    initFlags({ search: '?off=matting' })
    expect(describeDisabledFlag('matting')).toBe(
      'Background removal is turned off for this page by ?off=matting in the address bar. ' +
        'Remove it from the address bar to turn it back on.',
    )
  })

  it('names the panel that can clear a saved flag', () => {
    setFlagState('export', 'off')
    expect(describeDisabledFlag('export')).toBe(
      'Full export is turned off in this browser. Turn it back on in Help → Debug switches.',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* Every flag still has the behaviour it is documented to have                 */
/* -------------------------------------------------------------------------- */

describe('tri-state behaviour is what each registry entry promises', () => {
  beforeEach(() => {
    localStorage.clear()
    resetFlags()
  })
  afterEach(() => {
    localStorage.clear()
    resetFlags()
  })

  it('default is available for every feature that ships on', () => {
    // `today` is prose, so this is the mechanical half of the same claim: the
    // flags whose default is "the feature is there" really do read as not
    // blocked, and `engine` is the one whose default is neither.
    const asShips = FLAG_IDS.filter((id) => id !== 'engine')
    expect(asShips.length).toBeGreaterThan(0)
    for (const id of asShips) {
      expect(flagState(id as FlagId)).toBe('default')
      expect(flagOff(id as FlagId)).toBe(false)
    }
  })

  it('off is the only state that blocks', () => {
    for (const id of FLAG_IDS) {
      setFlagState(id, 'off')
      expect(flagOff(id)).toBe(true)
      clearFlagState(id)
      expect(flagOff(id)).toBe(false)
    }
  })
})
