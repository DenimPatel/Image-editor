import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCENTS,
  ACCENT_IDS,
  ACCENT_TOKEN_NAMES,
  APPEARANCE_ATTRIBUTE_NAMES,
  APPEARANCE_ATTRIBUTES,
  APPEARANCE_EVENT,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  DENSITIES,
  ICON_SCALES,
  LEGACY_THEME_STORAGE_KEY,
  MOTION_PREFERENCES,
  TEXT_SCALES,
  THEME_PREFERENCES,
  ACCENT_SURFACES,
  appearanceAttributes,
  appearanceBootstrapScript,
  applyAppearance,
  coerceAppearance,
  migrateLegacyTheme,
  readAppearance,
  resolveTheme,
  writeAppearance,
  type AccentTokens,
  type AppearanceSettings,
} from './appearance'

const root = document.documentElement

function setStored(value: string | null): void {
  if (value === null) localStorage.removeItem(APPEARANCE_STORAGE_KEY)
  else localStorage.setItem(APPEARANCE_STORAGE_KEY, value)
}

beforeEach(() => {
  localStorage.clear()
  for (const name of APPEARANCE_ATTRIBUTE_NAMES) root.removeAttribute(name)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the settings table', () => {
  it('defaults every setting, and the defaults are the documented ones', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      theme: 'system',
      density: 'default',
      textScale: 'default',
      motion: 'full',
      iconScale: 'default',
      accent: 'green',
    })
  })

  it('uses the exact attribute names and value spellings the CSS half reads', () => {
    // This is the contract. The names are not invented here: `data-theme` is
    // the one `tokens.css` already branches on, and the other five are new.
    // A rename on either side without the other is a silently dead setting.
    expect(APPEARANCE_ATTRIBUTES).toEqual({
      theme: 'data-theme',
      density: 'data-density',
      textScale: 'data-text',
      motion: 'data-motion',
      iconScale: 'data-icons',
      accent: 'data-accent',
    })
    expect([...APPEARANCE_ATTRIBUTE_NAMES]).toEqual([
      'data-theme',
      'data-density',
      'data-text',
      'data-motion',
      'data-icons',
      'data-accent',
    ])
  })

  it('offers exactly the values the CSS half switches on', () => {
    expect([...THEME_PREFERENCES]).toEqual(['light', 'dark', 'system'])
    expect([...DENSITIES]).toEqual(['compact', 'default', 'roomy'])
    expect([...TEXT_SCALES]).toEqual(['small', 'default', 'large', 'xlarge'])
    expect([...MOTION_PREFERENCES]).toEqual(['full', 'reduced'])
    expect([...ICON_SCALES]).toEqual(['small', 'default', 'large'])
    expect([...ACCENT_IDS]).toEqual(['green', 'blue', 'violet', 'amber'])
  })

  it('uses one localStorage key, not six', () => {
    expect(APPEARANCE_STORAGE_KEY).toBe('image-editor-appearance')
  })
})

describe('readAppearance never throws', () => {
  const hostile: [string, string][] = [
    ['empty string', ''],
    ['lone whitespace', '   '],
    ['a bare number', '42'],
    ['a bare string', '"dark"'],
    ['null', 'null'],
    ['true', 'true'],
    ['an array', '[]'],
    ['a nested array', '[["dark"]]'],
    ['truncated JSON', '{"theme":"da'],
    ['a JS-looking payload', 'function(){throw 1}()'],
    ['undefined literal', 'undefined'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['an object with a null prototype', '{"__proto__":{"theme":"dark"}}'],
    ['a getter that throws', '{"theme":1e999}'],
    ['a huge nesting bomb', '[' + '['.repeat(200) + ']'.repeat(200) + ']'],
  ]

  for (const [label, raw] of hostile) {
    it(`survives ${label}`, () => {
      setStored(raw)
      expect(() => readAppearance()).not.toThrow()
      expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    })
  }

  it('survives a missing key', () => {
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('survives localStorage throwing on read (Safari private mode)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    expect(() => readAppearance()).not.toThrow()
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    expect(getItem).toHaveBeenCalled()
  })

  it('survives a payload whose fields are objects with a hostile toString', () => {
    // The coercion is an allow-list membership test, never a `String()` call,
    // so an attacker-supplied `toString` never gets to run.
    const bomb = { toString: () => 'dark', valueOf: () => 'dark' }
    setStored(JSON.stringify({ theme: bomb, density: bomb, accent: bomb }))
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('survives a getter that throws, by not reading the prototype', () => {
    const payload = JSON.parse('{}') as Record<string, unknown>
    Object.defineProperty(payload, 'theme', {
      get() {
        throw new Error('boom')
      },
      enumerable: true,
    })
    // `coerceAppearance` reads own values through the allow-list, so a throwing
    // getter is a thrown error only if the code calls it — it must not.
    expect(() => coerceAppearance(payload)).not.toThrow()
  })
})

describe('readAppearance coerces each field independently', () => {
  it('keeps the valid fields of a partially-valid payload', () => {
    setStored(
      JSON.stringify({
        theme: 'dark',
        density: 'roomy',
        textScale: 'nope',
        motion: 'reduced',
        iconScale: 3,
        accent: 'violet',
      }),
    )
    expect(readAppearance()).toEqual({
      theme: 'dark',
      density: 'roomy',
      textScale: 'default',
      motion: 'reduced',
      iconScale: 'default',
      accent: 'violet',
    })
  })

  it('keeps an empty object as all-defaults', () => {
    setStored('{}')
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('rejects a non-object even when it has the right fields as properties', () => {
    for (const raw of ['[]', '"dark"', '5', 'null', 'true']) {
      setStored(raw)
      expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    }
  })

  it('rejects a wrong-typed value for every field', () => {
    for (const wrong of [0, 1, -1, null, true, false, {}, [], () => 'dark', '']) {
      setStored(
        JSON.stringify({
          theme: wrong,
          density: wrong,
          textScale: wrong,
          motion: wrong,
          iconScale: wrong,
          accent: wrong,
        }),
      )
      expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    }
  })

  it('rejects values that are near-misses of a real one', () => {
    for (const near of ['Dark', 'DARK', ' dark', 'dark ', 'light2', 'systems', 'compact ']) {
      setStored(JSON.stringify({ theme: near }))
      expect(readAppearance().theme).toBe('system')
    }
  })

  it('ignores unknown keys from a future version instead of rejecting the payload', () => {
    // A newer build writing `{ theme, density, glassmorphism }` must still be
    // readable by this one: the known fields land and the unknown one is
    // dropped, rather than the whole payload being discarded.
    setStored(
      JSON.stringify({
        theme: 'light',
        density: 'compact',
        glassmorphism: true,
        futureSetting: { nested: 1 },
      }),
    )
    const read = readAppearance()
    expect(read.theme).toBe('light')
    expect(read.density).toBe('compact')
    expect(Object.keys(read).sort()).toEqual(Object.keys(DEFAULT_APPEARANCE).sort())
  })

  it('ignores an unknown key that shadows a prototype property', () => {
    setStored(JSON.stringify({ theme: 'dark', constructor: 'dark', toString: 'dark' }))
    expect(readAppearance().theme).toBe('dark')
  })
})

describe('migration from the legacy image-editor-theme key', () => {
  it('promotes a legacy light choice', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'light')
    expect(readAppearance().theme).toBe('light')
  })

  it('promotes a legacy dark choice, so an upgrade does not hand back the OS preference', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    expect(readAppearance().theme).toBe('dark')
  })

  it('ignores a legacy value that is not a valid theme', () => {
    for (const legacy of ['', 'DARK', 'system', 'blue', 'null']) {
      localStorage.clear()
      localStorage.setItem(LEGACY_THEME_STORAGE_KEY, legacy)
      expect(readAppearance().theme).toBe('system')
    }
  })

  it('lets the new key win when both exist', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'light' }))
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    expect(readAppearance().theme).toBe('light')
  })

  it('lets the new key win even when the two disagree about a non-theme field', () => {
    setStored(JSON.stringify({ theme: 'light', density: 'roomy' }))
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    const read = readAppearance()
    expect(read.theme).toBe('light')
    expect(read.density).toBe('roomy')
  })

  it('does not consult the legacy key when the new payload is corrupt', () => {
    // A corrupt new payload is a *present* new payload: falling back to the
    // legacy value would resurrect a preference the user has already moved on
    // from, and the corrupt payload is what gets overwritten on the next write.
    setStored('{not json')
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    expect(readAppearance().theme).toBe('system')
  })

  it('promotes the legacy theme without inventing the other five', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    expect(readAppearance()).toEqual({ ...DEFAULT_APPEARANCE, theme: 'dark' })
  })

  it('migrateLegacyTheme is a pure function of its two arguments', () => {
    const base = { ...DEFAULT_APPEARANCE }
    expect(migrateLegacyTheme(base, 'dark')).toEqual({ ...base, theme: 'dark' })
    expect(migrateLegacyTheme({ ...base, theme: 'light' }, 'dark')).toEqual({
      ...base,
      theme: 'light',
    })
    // A user who has explicitly chosen `system` is not overridden by a stale
    // legacy key: `system` is a choice, not "unset".
    expect(migrateLegacyTheme({ ...base, theme: 'system' }, 'dark').theme).toBe('dark')
    expect(base.theme).toBe('system')
  })
})

describe('writeAppearance', () => {
  it('persists a valid change and returns it', () => {
    const result = writeAppearance({ ...DEFAULT_APPEARANCE, density: 'compact' })
    expect(result.persisted).toBe(true)
    expect(result.settings.density).toBe('compact')
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}').density).toBe('compact')
  })

  it('clamps an invalid field rather than storing it', () => {
    const result = writeAppearance({ ...DEFAULT_APPEARANCE, density: 'tiny' as never })
    expect(result.settings.density).toBe('default')
    expect(result.persisted).toBe(true)
    expect(readAppearance().density).toBe('default')
  })

  it('never throws when localStorage throws on write (Safari private mode)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    })
    const result: { current: ReturnType<typeof writeAppearance> | null } = { current: null }
    expect(() => {
      result.current = writeAppearance({ ...DEFAULT_APPEARANCE, density: 'roomy' })
    }).not.toThrow()
    // The settings still apply for this session; only the persistence failed,
    // and the caller is told so rather than being left to believe it saved.
    expect(result.current?.settings.density).toBe('roomy')
    expect(result.current?.persisted).toBe(false)
    expect(setItem).toHaveBeenCalled()
  })

  it('reports persisted: false and still returns clamped settings on a failed write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('nope')
    })
    const result = writeAppearance({ density: 'roomy' as never, accent: 'chartreuse' as never })
    expect(result.persisted).toBe(false)
    expect(result.settings.density).toBe('roomy')
    expect(result.settings.accent).toBe('green')
  })

  it('fires the event the hook listens for', () => {
    const onChange = vi.fn()
    window.addEventListener(APPEARANCE_EVENT, onChange)
    try {
      writeAppearance({ ...DEFAULT_APPEARANCE, textScale: 'large' })
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(APPEARANCE_EVENT, onChange)
    }
  })

  it('fires the event even when the write failed, so mounted hooks still agree', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('nope')
    })
    const onChange = vi.fn()
    window.addEventListener(APPEARANCE_EVENT, onChange)
    try {
      writeAppearance({ ...DEFAULT_APPEARANCE, textScale: 'xlarge' })
      expect(onChange).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(APPEARANCE_EVENT, onChange)
    }
  })

  it('does not throw on a non-object argument', () => {
    for (const bad of [null, undefined, 42, 'dark', [], true]) {
      expect(() => writeAppearance(bad)).not.toThrow()
    }
  })

  it('does not throw when a field of the patch is a throwing getter', () => {
    const patch = { density: 'roomy' } as Record<string, unknown>
    Object.defineProperty(patch, 'accent', {
      get() {
        throw new Error('boom')
      },
      enumerable: true,
    })
    const result: { current: ReturnType<typeof writeAppearance> | null } = { current: null }
    expect(() => {
      result.current = writeAppearance(patch)
    }).not.toThrow()
    // The readable field still lands; the unreadable one falls back.
    expect(result.current?.settings.density).toBe('roomy')
    expect(result.current?.settings.accent).toBe('green')
  })

  it('keeps the stored values for fields the patch does not mention', () => {
    writeAppearance({ ...DEFAULT_APPEARANCE, accent: 'violet', iconScale: 'large' })
    const result = writeAppearance({ density: 'roomy' })
    expect(result.settings).toEqual({
      ...DEFAULT_APPEARANCE,
      accent: 'violet',
      iconScale: 'large',
      density: 'roomy',
    })
  })

  it('round-trips through readAppearance', () => {
    const next: AppearanceSettings = {
      theme: 'dark',
      density: 'compact',
      textScale: 'xlarge',
      motion: 'reduced',
      iconScale: 'large',
      accent: 'amber',
    }
    writeAppearance(next)
    expect(readAppearance()).toEqual(next)
  })
})

describe('appearanceAttributes is pure and omits defaults', () => {
  it('returns an empty object for the defaults, so the DOM stays clean', () => {
    expect(appearanceAttributes(DEFAULT_APPEARANCE)).toEqual({})
  })

  it('omits each default independently', () => {
    const cases: [keyof AppearanceSettings, AppearanceSettings][] = [
      ['theme', { ...DEFAULT_APPEARANCE, theme: 'system' }],
      ['density', { ...DEFAULT_APPEARANCE, density: 'default' }],
      ['textScale', { ...DEFAULT_APPEARANCE, textScale: 'default' }],
      ['motion', { ...DEFAULT_APPEARANCE, motion: 'full' }],
      ['iconScale', { ...DEFAULT_APPEARANCE, iconScale: 'default' }],
      ['accent', { ...DEFAULT_APPEARANCE, accent: 'green' }],
    ]
    for (const [, settings] of cases) {
      expect(appearanceAttributes(settings)).toEqual({})
    }
  })

  it('includes each non-default with its exact attribute name and spelling', () => {
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, theme: 'dark' })).toEqual({
      'data-theme': 'dark',
    })
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, density: 'roomy' })).toEqual({
      'data-density': 'roomy',
    })
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, textScale: 'small' })).toEqual({
      'data-text': 'small',
    })
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, motion: 'reduced' })).toEqual({
      'data-motion': 'reduced',
    })
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, iconScale: 'large' })).toEqual({
      'data-icons': 'large',
    })
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, accent: 'blue' })).toEqual({
      'data-accent': 'blue',
    })
  })

  it('has no `data-theme` for `system`, which is what keeps the OS path working', () => {
    // `tokens.css:29` is `:root:not([data-theme])` inside a
    // `prefers-color-scheme: dark` media query. Writing the literal
    // `data-theme="system"` would out-specify that rule and the OS preference
    // would stop working for every user who never touched the toggle.
    expect(appearanceAttributes({ ...DEFAULT_APPEARANCE, theme: 'system' })).not.toHaveProperty(
      'data-theme',
    )
  })

  it('is a pure function of its argument: equal inputs give equal outputs', () => {
    const settings: AppearanceSettings = {
      theme: 'light',
      density: 'roomy',
      textScale: 'large',
      motion: 'reduced',
      iconScale: 'small',
      accent: 'violet',
    }
    expect(appearanceAttributes(settings)).toEqual(appearanceAttributes({ ...settings }))
  })

  it('does not mutate its argument', () => {
    const settings: AppearanceSettings = { ...DEFAULT_APPEARANCE, theme: 'dark' }
    const snapshot = { ...settings }
    appearanceAttributes(settings)
    expect(settings).toEqual(snapshot)
  })

  it('touches neither storage nor the DOM', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute')
    appearanceAttributes({ ...DEFAULT_APPEARANCE, theme: 'dark', accent: 'blue' })
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(setAttribute).not.toHaveBeenCalled()
  })
})

describe('applyAppearance', () => {
  it('writes the six attributes onto the element', () => {
    applyAppearance({
      theme: 'dark',
      density: 'compact',
      textScale: 'large',
      motion: 'reduced',
      iconScale: 'small',
      accent: 'amber',
    })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-density')).toBe('compact')
    expect(root.getAttribute('data-text')).toBe('large')
    expect(root.getAttribute('data-motion')).toBe('reduced')
    expect(root.getAttribute('data-icons')).toBe('small')
    expect(root.getAttribute('data-accent')).toBe('amber')
  })

  it('removes an attribute when the setting returns to its default', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, density: 'roomy', accent: 'blue' })
    expect(root.hasAttribute('data-density')).toBe(true)
    applyAppearance(DEFAULT_APPEARANCE)
    expect(root.hasAttribute('data-density')).toBe(false)
    expect(root.hasAttribute('data-accent')).toBe(false)
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('skips an attribute that already holds the wanted value', () => {
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute')
    applyAppearance({ ...DEFAULT_APPEARANCE, density: 'roomy' })
    setAttribute.mockClear()
    applyAppearance({ ...DEFAULT_APPEARANCE, density: 'roomy' })
    expect(setAttribute).not.toHaveBeenCalled()
  })

  it('is idempotent, which is what makes mounting twice safe', () => {
    const settings: AppearanceSettings = {
      ...DEFAULT_APPEARANCE,
      theme: 'dark',
      accent: 'violet',
    }
    applyAppearance(settings)
    const after = [...APPEARANCE_ATTRIBUTE_NAMES].map((n) => root.getAttribute(n))
    applyAppearance(settings)
    applyAppearance(settings)
    expect([...APPEARANCE_ATTRIBUTE_NAMES].map((n) => root.getAttribute(n))).toEqual(after)
  })

  it('does not remove an attribute that is already absent', () => {
    const removeAttribute = vi.spyOn(Element.prototype, 'removeAttribute')
    applyAppearance(DEFAULT_APPEARANCE)
    expect(removeAttribute).not.toHaveBeenCalled()
  })

  it('does nothing when there is no root', () => {
    expect(() => applyAppearance(DEFAULT_APPEARANCE, null)).not.toThrow()
  })
})

describe('resolveTheme honours prefers-color-scheme for `system` only', () => {
  it('passes an explicit choice through untouched', () => {
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'light' }, true)).toBe('light')
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'light' }, false)).toBe('light')
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'dark' }, true)).toBe('dark')
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'dark' }, false)).toBe('dark')
  })

  it('follows the OS when the preference is `system`', () => {
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'system' }, true)).toBe('dark')
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, theme: 'system' }, false)).toBe('light')
  })
})

describe('the four accents', () => {
  it('are exactly the four ids the model advertises', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual([...ACCENT_IDS])
    expect(ACCENTS).toHaveLength(4)
  })

  it('sets all six tokens, in both grounds, for every accent', () => {
    for (const accent of ACCENTS) {
      for (const ground of [accent.light, accent.dark]) {
        expect(Object.keys(ground).sort()).toEqual([...ACCENT_TOKEN_NAMES].sort())
      }
    }
  })

  it('names exactly the six tokens that have to move together', () => {
    expect([...ACCENT_TOKEN_NAMES]).toEqual([
      '--accent',
      '--accent-ink',
      '--accent-tint',
      '--ie-accent',
      '--ie-accent-bright',
      '--focus-ring',
    ])
  })

  it('uses plain 6-digit hex, never an hsl() colour function', () => {
    // `hsl(H S L)` with space-separated components is Chromium 111+ /
    // Safari 16.4+, and the e2e matrix runs WebKit. A token that silently
    // falls back to the inherited value on an engine the suite tests is worse
    // than one that is deliberately unsupported.
    for (const accent of ACCENTS) {
      for (const [groundName, ground] of [
        ['light', accent.light],
        ['dark', accent.dark],
      ] as const) {
        for (const [token, value] of Object.entries(ground as AccentTokens)) {
          expect(value, `${accent.id}.${groundName} ${token}`).toMatch(/^#[0-9a-f]{6}$/i)
        }
      }
    }
  })

  it('leaves the default accent as the current green, not a rebrand', () => {
    // If this fails, the `green` default stops being a no-op and every user
    // who never chose an accent gets a different UI than the one they had.
    const green = ACCENTS[0]
    expect(green.id).toBe('green')
    expect(green.light['--accent']).toBe('#1f6f5c')
    expect(green.light['--accent-ink']).toBe('#143f35')
    expect(green.light['--accent-tint']).toBe('#e7f1ee')
    expect(green.light['--focus-ring']).toBe('#0b5c48')
    expect(green.dark['--accent']).toBe('#4fa98c')
    expect(green.dark['--accent-ink']).toBe('#a9e0cc')
    expect(green.dark['--accent-tint']).toBe('#1b342c')
    expect(green.dark['--focus-ring']).toBe('#7fe0bd')
  })

  it('gives the editor chrome the same pair in both grounds', () => {
    // The editor is a hardcoded-dark surface regardless of theme
    // (`tokens.css:63`), so its two tokens have no light variant to differ
    // between. A divergence here would mean the editor changes colour when
    // the Hub does not.
    for (const accent of ACCENTS) {
      expect(accent.light['--ie-accent']).toBe(accent.dark['--ie-accent'])
      expect(accent.light['--ie-accent-bright']).toBe(accent.dark['--ie-accent-bright'])
    }
  })

  it('has four distinct accents', () => {
    const signatures = ACCENTS.map((a) => a.light['--accent'])
    expect(new Set(signatures).size).toBe(4)
  })
})

describe('the curated accent values meet WCAG on both surfaces', () => {
  function channel(value: string): [number, number, number] {
    const hex = value.replace('#', '')
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  }
  function linear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  function luminance(value: string): number {
    const [r, g, b] = channel(value).map(linear)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  /** WCAG 2.x relative-contrast ratio. */
  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }

  const TEXT_MIN = 4.5
  const UI_MIN = 3
  const TINT_MIN = 1.12

  it('computes the ratio the way WCAG defines it', () => {
    // The reference pair: #767676 on white is the canonical 4.54:1 example.
    // A verifier that disagrees with the spec would make every number below
    // meaningless, so the spec is checked against itself first.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  for (const accent of ACCENTS) {
    it(`${accent.id}: every light-ground pair meets its threshold`, () => {
      const t = accent.light
      const checks: [string, number, number][] = [
        [`--accent on --bg`, contrast(t['--accent'], ACCENT_SURFACES.lightBg), TEXT_MIN],
        [`--accent on --surface`, contrast(t['--accent'], ACCENT_SURFACES.lightSurface), TEXT_MIN],
        [
          `--accent-ink on --surface`,
          contrast(t['--accent-ink'], ACCENT_SURFACES.lightSurface),
          TEXT_MIN,
        ],
        [
          `--accent-ink on --accent-tint`,
          contrast(t['--accent-ink'], t['--accent-tint']),
          TEXT_MIN,
        ],
        [`--focus-ring on --bg`, contrast(t['--focus-ring'], ACCENT_SURFACES.lightBg), UI_MIN],
        [
          `--focus-ring on --surface`,
          contrast(t['--focus-ring'], ACCENT_SURFACES.lightSurface),
          UI_MIN,
        ],
        // The tint is a fill, not text: it only has to be *visible* against
        // the card it sits on, which is why the bar is 1.12 and not 4.5. An
        // early violet tint measured 1.09 — a status pill that reads grey.
        [
          `--accent-tint on --surface`,
          contrast(t['--accent-tint'], ACCENT_SURFACES.lightSurface),
          TINT_MIN,
        ],
      ]
      for (const [label, actual, min] of checks) {
        expect(actual, `${accent.id} ${label}`).toBeGreaterThanOrEqual(min)
      }
    })

    it(`${accent.id}: every dark-ground pair meets its threshold`, () => {
      const t = accent.dark
      const checks: [string, number, number][] = [
        [`--accent on --bg`, contrast(t['--accent'], ACCENT_SURFACES.darkBg), TEXT_MIN],
        [`--accent on --surface`, contrast(t['--accent'], ACCENT_SURFACES.darkSurface), TEXT_MIN],
        [
          `--accent-ink on --surface`,
          contrast(t['--accent-ink'], ACCENT_SURFACES.darkSurface),
          TEXT_MIN,
        ],
        [
          `--accent-ink on --accent-tint`,
          contrast(t['--accent-ink'], t['--accent-tint']),
          TEXT_MIN,
        ],
        [`--focus-ring on --bg`, contrast(t['--focus-ring'], ACCENT_SURFACES.darkBg), UI_MIN],
        [
          `--focus-ring on --surface`,
          contrast(t['--focus-ring'], ACCENT_SURFACES.darkSurface),
          UI_MIN,
        ],
        [
          `--accent-tint on --surface`,
          contrast(t['--accent-tint'], ACCENT_SURFACES.darkSurface),
          TINT_MIN,
        ],
      ]
      for (const [label, actual, min] of checks) {
        expect(actual, `${accent.id} ${label}`).toBeGreaterThanOrEqual(min)
      }
    })

    it(`${accent.id}: the editor pairs meet their threshold on the dark editor ground`, () => {
      const t = accent.light
      const checks: [string, number, number][] = [
        // `--ie-accent` is a fill under `#fff` label text
        // (`textButtonPrimary`, `chipActive`, `menuItem:hover`).
        [`--ie-accent under #fff`, contrast(t['--ie-accent'], '#ffffff'), TEXT_MIN],
        // It is also a boundary and a checkbox tint on a near-black ground
        // (`toggle input { accent-color }`, `border-color` on the active tool),
        // which is a non-text contrast requirement.
        [
          `--ie-accent on --ie-canvas-bg`,
          contrast(t['--ie-accent'], ACCENT_SURFACES.ieCanvas),
          UI_MIN,
        ],
        [
          `--ie-accent on --ie-chrome-solid`,
          contrast(t['--ie-accent'], ACCENT_SURFACES.ieChrome),
          UI_MIN,
        ],
        // `--ie-accent-bright` is both text on the chrome and a fill under
        // `#04140f` (`skipLink`, `crashPrimary`, `compareToggle[pressed]`).
        [
          `--ie-accent-bright under #04140f`,
          contrast(t['--ie-accent-bright'], '#04140f'),
          TEXT_MIN,
        ],
        [
          `--ie-accent-bright on --ie-canvas-bg`,
          contrast(t['--ie-accent-bright'], ACCENT_SURFACES.ieCanvas),
          TEXT_MIN,
        ],
        [
          `--ie-accent-bright on --ie-chrome-solid`,
          contrast(t['--ie-accent-bright'], ACCENT_SURFACES.ieChrome),
          TEXT_MIN,
        ],
      ]
      for (const [label, actual, min] of checks) {
        expect(actual, `${accent.id} ${label}`).toBeGreaterThanOrEqual(min)
      }
    })
  }
})

describe('the bootstrap script in index.html cannot drift from the model', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

  function extractScript(): string {
    // The generated script is the one whose first line is its own generator
    // banner, so this does not depend on it being the first <script> in the
    // file — the redirect and service-worker scripts move around.
    const banner = '// GENERATED from src/lib/appearance.ts'
    const at = html.indexOf(banner)
    expect(at, 'the generated bootstrap script is missing from index.html').toBeGreaterThan(-1)
    // Slice from the start of the banner's *line*, so the block indent is part
    // of the extracted text and can be measured rather than guessed at.
    const start = html.lastIndexOf('\n', at) + 1
    const end = html.indexOf('})()', at)
    expect(end, 'the generated bootstrap script is truncated').toBeGreaterThan(at)
    const lines = html.slice(start, end + '})()'.length).split('\n')
    // Dedent by the *common* leading indent of the first line rather than a
    // hardcoded 4 spaces, so the block indent `index.html` gives an inline
    // script can change without this guard becoming a false failure. The
    // check is still exact: what is left has to be byte-identical to the
    // generated text, so a reformatted script still fails.
    const indent = lines[0].length - lines[0].trimStart().length
    expect(indent).toBeGreaterThan(0)
    return lines.map((line) => line.slice(indent)).join('\n')
  }

  it('is present and byte-identical to what the model generates', () => {
    // This is the whole anti-drift mechanism. The script is not a hand-written
    // copy that has to be kept in step with the tables above; it is a build
    // artefact of them. Editing `index.html` by hand fails here, and adding a
    // setting to the model without regenerating the script fails here too.
    expect(extractScript()).toBe(appearanceBootstrapScript())
  })

  it('runs before the module entry point, so it applies before first paint', () => {
    const scriptAt = html.indexOf('// GENERATED from src/lib/appearance.ts')
    const moduleAt = html.indexOf('<script type="module"')
    expect(scriptAt).toBeGreaterThan(-1)
    expect(moduleAt).toBeGreaterThan(-1)
    // `<script type="module">` is deferred by definition; the bootstrap is a
    // classic inline script in <head>, so it runs first. If the module ever
    // moved above it, the flash of wrong theme comes back.
    expect(scriptAt).toBeLessThan(moduleAt)
  })

  it('emits the same attribute names the model declares', () => {
    const script = appearanceBootstrapScript()
    for (const name of APPEARANCE_ATTRIBUTE_NAMES) {
      expect(script).toContain(name)
    }
  })

  it('emits the same allow-lists the model validates against', () => {
    // The script is serialised Prettier-style (single quotes, one entry per
    // line), so the assertion is membership rather than a `JSON.stringify`
    // substring — the *values* must match, not their formatting.
    const script = appearanceBootstrapScript()
    for (const value of THEME_PREFERENCES) expect(script).toContain(`'${value}'`)
    for (const value of DENSITIES) expect(script).toContain(`'${value}'`)
    for (const value of TEXT_SCALES) expect(script).toContain(`'${value}'`)
    for (const value of MOTION_PREFERENCES) expect(script).toContain(`'${value}'`)
    for (const value of ICON_SCALES) expect(script).toContain(`'${value}'`)
    for (const value of ACCENT_IDS) expect(script).toContain(`'${value}'`)
  })

  it('emits a key for every setting, in all three tables it appears in', () => {
    // `theme` is legitimately spelled four times in the script — once in the
    // allow-list, once in the attribute map, once in the defaults, and once in
    // the runtime loop. What must hold is that each table has an entry for
    // every setting: a setting added to the model and forgotten in one of them
    // would validate but never write, or write but never validate.
    const script = appearanceBootstrapScript()
    for (const table of ['lists', 'attrs', 'defaults']) {
      for (const key of Object.keys(DEFAULT_APPEARANCE)) {
        expect(script, `${table}.${key}`).toContain(`${key}:`)
      }
    }
  })

  it('emits the same storage keys', () => {
    const script = appearanceBootstrapScript()
    expect(script).toContain(APPEARANCE_STORAGE_KEY)
    expect(script).toContain(LEGACY_THEME_STORAGE_KEY)
  })

  it('is wrapped in try/catch, because Safari private mode throws on storage', () => {
    const script = appearanceBootstrapScript()
    expect(script).toContain('try {')
    // Three inner guards: the appearance read, the legacy read, and the outer
    // envelope. An uncaught SecurityError here would abort before the module
    // below ever runs, which is a blank page rather than a wrong theme.
    expect(script.match(/try \{/g)?.length).toBeGreaterThanOrEqual(3)
    expect(script).toContain('catch (e) {}')
  })

  it('validates against the allow-list instead of trusting the stored value', () => {
    expect(appearanceBootstrapScript()).toContain('allowed.indexOf(value) === -1')
  })

  it('omits a default rather than writing it, matching appearanceAttributes', () => {
    expect(appearanceBootstrapScript()).toContain('if (value === defaults[key]) continue')
  })

  it('folds the legacy theme key forward when there is no appearance payload', () => {
    const script = appearanceBootstrapScript()
    expect(script).toContain(LEGACY_THEME_STORAGE_KEY)
    expect(script).toContain('legacy === "light" || legacy === "dark"')
  })

  it('applies exactly what the hook would, for a stored payload', () => {
    // The behavioural half of "cannot drift": run the generated script against
    // a real `localStorage` and a real element, then compare with what
    // `applyAppearance` produces for the same settings. Equal output means the
    // pre-paint path and the post-mount path agree on all six attributes.
    const settings: AppearanceSettings = {
      theme: 'dark',
      density: 'compact',
      textScale: 'large',
      motion: 'reduced',
      iconScale: 'small',
      accent: 'amber',
    }
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings))

    const target = document.createElement('div')
    // `runScripts: 'dangerously'` is not enabled in this jsdom environment,
    // so the script is invoked as a function with `document`/`localStorage`
    // from the jsdom global it closes over.
    new Function(appearanceBootstrapScript())()
    const fromScript = [...APPEARANCE_ATTRIBUTE_NAMES].map((n) =>
      document.documentElement.getAttribute(n),
    )

    applyAppearance(settings, target)
    const fromHook = [...APPEARANCE_ATTRIBUTE_NAMES].map((n) => target.getAttribute(n))

    expect(fromScript).toEqual(fromHook)
    for (const name of APPEARANCE_ATTRIBUTE_NAMES) {
      expect(fromScript, name).not.toBeNull()
    }
  })
})
