/**
 * The appearance model: six chrome settings that live in exactly one
 * `localStorage` key and reach the document as exactly six `data-*`
 * attributes on `<html>`.
 *
 * Two rules shape everything here.
 *
 * **Appearance is chrome, not content.** None of these six settings is in
 * `Doc`, in history, or in IndexedDB. They are device-local preferences, so
 * two people exporting the same recipe must get the same image, and an undo
 * must never re-colour the canvas.
 *
 * **One function is the only source of the attribute names.** The
 * pre-paint script in `index.html` and `useAppearance` both call
 * `appearanceAttributes`, and `index.html` is generated from it by
 * `appearanceBootstrapScript()`, so the two writers cannot drift: there is one
 * spelling of `data-density`, not two. The `index.html` guard test in
 * `appearance.test.ts` fails if the checked-in script is ever hand-edited away
 * from the generated one.
 *
 * Every reader is total. `readAppearance` coerces each field independently and
 * cannot throw, because the only caller that cannot recover from a crash is
 * the synchronous script in `<head>`, before the module graph exists.
 */

export const APPEARANCE_STORAGE_KEY = 'image-editor-appearance'
export const LEGACY_THEME_STORAGE_KEY = 'image-editor-theme'

/** Fired on `window` after a successful write, so two mounted hooks agree. */
export const APPEARANCE_EVENT = 'ie:appearance'

export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const
export const DENSITIES = ['compact', 'default', 'roomy'] as const
export const TEXT_SCALES = ['small', 'default', 'large', 'xlarge'] as const
export const MOTION_PREFERENCES = ['full', 'reduced'] as const
export const ICON_SCALES = ['small', 'default', 'large'] as const
export const ACCENT_IDS = ['green', 'blue', 'violet', 'amber'] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export type Density = (typeof DENSITIES)[number]
export type TextScale = (typeof TEXT_SCALES)[number]
export type MotionPreference = (typeof MOTION_PREFERENCES)[number]
export type IconScale = (typeof ICON_SCALES)[number]
export type AccentId = (typeof ACCENT_IDS)[number]

/** `system` is a preference, not a palette: it is what `prefers-color-scheme` resolves to. */
export type ResolvedTheme = 'light' | 'dark'

export type AppearanceSettings = {
  theme: ThemePreference
  density: Density
  textScale: TextScale
  motion: MotionPreference
  iconScale: IconScale
  accent: AccentId
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  density: 'default',
  textScale: 'default',
  motion: 'full',
  iconScale: 'default',
  accent: 'green',
}

/**
 * The attribute contract, in one place. The CSS half reads exactly these
 * names, and `appearance.test.ts` asserts that `index.html` and this table
 * agree, so a rename cannot land on one side only.
 *
 * A setting whose value equals its default is *absent* rather than written as
 * a literal. That is what keeps the pre-existing
 * `:root:not([data-theme])` OS-preference branch in `tokens.css` working: with
 * `theme: 'system'` there is no `data-theme` at all, so the media query is
 * free to win, and the DOM never accumulates a `data-density="default"` that
 * some later rule would have to out-specify.
 */
export const APPEARANCE_ATTRIBUTES = {
  theme: 'data-theme',
  density: 'data-density',
  textScale: 'data-text',
  motion: 'data-motion',
  iconScale: 'data-icons',
  accent: 'data-accent',
} as const satisfies Record<keyof AppearanceSettings, string>

export type AppearanceAttribute = (typeof APPEARANCE_ATTRIBUTES)[keyof AppearanceSettings]

/**
 * The six tokens an accent has to move together, and nothing else.
 *
 * These are literal 6-digit hex strings on purpose. `hsl(H S L)` with
 * space-separated components is Chromium 111+ / Safari 16.4+, and the e2e
 * matrix runs WebKit, so a colour function here is a colour that silently
 * falls back to the inherited value on an engine the suite still tests.
 */
export type AccentTokens = {
  /** Light-theme text/edge accent. `tokens.css:13`. */
  '--accent': string
  /** Text that sits on `--accent` or on `--accent-tint`. `tokens.css:14`. */
  '--accent-ink': string
  /** Tinted fill behind accent text. `tokens.css:15`. */
  '--accent-tint': string
  /** Editor fill that takes `#fff` label text. `tokens.css:73`. */
  '--ie-accent': string
  /** Editor text/edge accent on the near-black ground. `tokens.css:74`. */
  '--ie-accent-bright': string
  /** Focus outline on the light ground. `tokens.css:23`. */
  '--focus-ring': string
}

export const ACCENT_TOKEN_NAMES = [
  '--accent',
  '--accent-ink',
  '--accent-tint',
  '--ie-accent',
  '--ie-accent-bright',
  '--focus-ring',
] as const satisfies readonly (keyof AccentTokens)[]

/**
 * The light-ground and dark-ground halves of one accent. An accent is two
 * sets of the same six tokens because the light Hub and the dark Hub are
 * different surfaces: a text accent that clears 4.5:1 on `#fafaf8` is
 * invisible on `#1f2222`, so one value per token cannot serve both.
 */
export type Accent = {
  id: AccentId
  label: string
  light: AccentTokens
  dark: AccentTokens
}

/**
 * The grounds an accent is measured against, transcribed from `tokens.css`.
 *
 * These are named `UNKNOWN_SURFACES` nowhere — the name is a reminder that
 * they are the *other* half's numbers: the CSS half owns `--bg`, `--surface`
 * and the editor's two grounds, and this model owns the accent. Exporting them
 * here is what lets the contrast test be a real gate rather than a claim,
 * because if the token agent changes a surface the numbers in that file stop
 * describing it and the assertions fail loudly instead of quietly measuring
 * the wrong thing.
 */
export const ACCENT_SURFACES = {
  /** `tokens.css:3`, the light Hub page. */
  lightBg: '#fafaf8',
  /** `tokens.css:5`, the light Hub card. */
  lightSurface: '#ffffff',
  /** `tokens.css:30`, the dark Hub page. */
  darkBg: '#17181a',
  /** `tokens.css:32`, the dark Hub card. */
  darkSurface: '#1f2222',
  /** `tokens.css:66`, the editor canvas. */
  ieCanvas: '#121214',
  /** `tokens.css:68`, the editor's opaque chrome. */
  ieChrome: '#1c1c1e',
} as const

/** The two label colours the editor pairs its accent against. */
export const ACCENT_LABEL_INK = {
  /** `color: #fff` on `--ie-accent` fills. */
  onIeAccent: '#ffffff',
  /** `color: #04140f` on `--ie-accent-bright` fills. */
  onIeBright: '#04140f',
} as const

export const ACCENTS: readonly Accent[] = [
  {
    id: 'green',
    label: 'Evergreen',
    // The current green, unchanged, so `green` is a real no-op rather than a
    // rebrand: every pair below is the number `tokens.css` already ships.
    light: {
      '--accent': '#1f6f5c',
      '--accent-ink': '#143f35',
      '--accent-tint': '#e7f1ee',
      '--ie-accent': '#257a68',
      '--ie-accent-bright': '#38b28c',
      '--focus-ring': '#0b5c48',
    },
    dark: {
      '--accent': '#4fa98c',
      '--accent-ink': '#a9e0cc',
      '--accent-tint': '#1b342c',
      '--ie-accent': '#257a68',
      '--ie-accent-bright': '#38b28c',
      '--focus-ring': '#7fe0bd',
    },
  },
  {
    id: 'blue',
    label: 'Cobalt',
    light: {
      '--accent': '#1b5e9c',
      '--accent-ink': '#123a63',
      '--accent-tint': '#e6eefa',
      '--ie-accent': '#2b73b8',
      '--ie-accent-bright': '#3f97e8',
      '--focus-ring': '#0d4a7d',
    },
    dark: {
      '--accent': '#74b6f0',
      '--accent-ink': '#c3e2ff',
      '--accent-tint': '#1c3252',
      '--ie-accent': '#2b73b8',
      '--ie-accent-bright': '#3f97e8',
      '--focus-ring': '#9ed0f7',
    },
  },
  {
    id: 'violet',
    label: 'Iris',
    light: {
      '--accent': '#5b3aa8',
      '--accent-ink': '#361f6b',
      '--accent-tint': '#efe9fb',
      '--ie-accent': '#7657c0',
      '--ie-accent-bright': '#9d7bf5',
      '--focus-ring': '#472c8c',
    },
    dark: {
      '--accent': '#b39af0',
      '--accent-ink': '#dcd0ff',
      '--accent-tint': '#302757',
      '--ie-accent': '#7657c0',
      '--ie-accent-bright': '#9d7bf5',
      '--focus-ring': '#c6b0ff',
    },
  },
  {
    id: 'amber',
    label: 'Ember',
    light: {
      '--accent': '#9a5208',
      '--accent-ink': '#5f2c05',
      '--accent-tint': '#fbeadb',
      '--ie-accent': '#a35708',
      '--ie-accent-bright': '#e59a3c',
      '--focus-ring': '#7d3c05',
    },
    dark: {
      '--accent': '#f0a05a',
      '--accent-ink': '#ffd7ae',
      '--accent-tint': '#422c16',
      '--ie-accent': '#a35708',
      '--ie-accent-bright': '#e59a3c',
      '--focus-ring': '#ffc98d',
    },
  },
]

/** The subset of `ACCEPTED` that a parsed value may be checked against. */
function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/**
 * Coerce one field. A hostile payload (`{ "density": {"toString": ...} }`, a
 * number, `null`, an array) fails the allow-list and yields the default; a
 * `String()` call on a crafted object could run an attacker-supplied
 * `toString`, so nothing here coerces by stringification.
 */
function coerce<K extends keyof AppearanceSettings>(
  key: K,
  value: unknown,
  lists: Record<K, readonly AppearanceSettings[K][]>,
): AppearanceSettings[K] {
  if (isOneOf(lists[key], value)) return value
  return DEFAULT_APPEARANCE[key]
}

const LISTS = {
  theme: THEME_PREFERENCES,
  density: DENSITIES,
  textScale: TEXT_SCALES,
  motion: MOTION_PREFERENCES,
  iconScale: ICON_SCALES,
  accent: ACCENT_IDS,
} as const satisfies Record<keyof AppearanceSettings, readonly string[]>

/**
 * Read one own field without letting a throwing getter escape.
 *
 * `JSON.parse` cannot produce a getter, so the stored path is safe by
 * construction — but `coerceAppearance` is exported and takes `unknown`, and a
 * payload handed to it directly (a test fixture, a future caller) can. A
 * function documented as total that throws on a crafted object is a total
 * function in name only.
 */
function readField(raw: Record<string, unknown>, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse an unknown payload into a total `AppearanceSettings`.
 *
 * Each field is validated independently, so a partially-valid object keeps the
 * fields that are valid and resets only the ones that are not. Unknown keys
 * from a future version are ignored rather than rejected, which is what makes
 * a forward-compatible payload survive a round trip.
 */
export function coerceAppearance(input: unknown): AppearanceSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ...DEFAULT_APPEARANCE }
  }
  const raw = input as Record<string, unknown>
  return {
    theme: coerce('theme', readField(raw, 'theme'), LISTS),
    density: coerce('density', readField(raw, 'density'), LISTS),
    textScale: coerce('textScale', readField(raw, 'textScale'), LISTS),
    motion: coerce('motion', readField(raw, 'motion'), LISTS),
    iconScale: coerce('iconScale', readField(raw, 'iconScale'), LISTS),
    accent: coerce('accent', readField(raw, 'accent'), LISTS),
  }
}

/**
 * Fold the pre-appearance `image-editor-theme` key forward.
 *
 * A user who chose `dark` under the old single-setting model must not get the
 * OS preference back on upgrade, so a valid legacy value is promoted to
 * `theme` in the returned settings. The caller persists the result; this
 * function does not write, because the bootstrap script and the hook both
 * read it and only one of them should be doing I/O.
 */
export function migrateLegacyTheme(
  settings: AppearanceSettings,
  legacy: string | null,
): AppearanceSettings {
  if (settings.theme !== 'system') return settings
  if (legacy === 'light' || legacy === 'dark') return { ...settings, theme: legacy }
  return settings
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // Safari private mode throws a SecurityError on any storage access, and
    // the pre-paint script has nothing above it to catch.
    return null
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/**
 * Read the six settings. Total by construction: any throw from
 * `localStorage` or `JSON.parse` collapses to the defaults rather than
 * propagating, because the one caller that must not fail is the synchronous
 * `<head>` script.
 */
export function readAppearance(): AppearanceSettings {
  const stored = safeGetItem(APPEARANCE_STORAGE_KEY)
  if (stored === null) {
    return migrateLegacyTheme({ ...DEFAULT_APPEARANCE }, safeGetItem(LEGACY_THEME_STORAGE_KEY))
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
  return coerceAppearance(parsed)
}

/**
 * Validate, clamp, persist, and announce `next`.
 *
 * Returns the settings that were actually stored, which is the clamped value
 * rather than the input: a caller that passes a bad field must not be able to
 * believe its own value took. A failed write is not an error — the settings
 * still apply for this session, and the event still fires so mounted hooks
 * agree — but the return value says `persisted: false` so a UI can say so.
 */
export function writeAppearance(next: Partial<AppearanceSettings> | unknown): {
  settings: AppearanceSettings
  persisted: boolean
} {
  const settings = coerceAppearance(mergeForWrite(readAppearance(), next))
  const persisted = safeSetItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings))
  try {
    window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: settings }))
  } catch {
    // No DOM (a worker, a test env) — the caller still gets its return value.
  }
  return { settings, persisted }
}

/**
 * Layer a partial change over the stored settings.
 *
 * A plain spread reads every own property, so a throwing getter on `next` would
 * escape from a function that is documented as not throwing. Each field is
 * copied through `readField`, which cannot.
 */
function mergeForWrite(
  base: AppearanceSettings,
  patch: Partial<AppearanceSettings> | unknown,
): Record<string, unknown> {
  const overrides = asRecord(patch)
  if (!overrides) return { ...base }
  const merged: Record<string, unknown> = { ...base }
  for (const key of Object.keys(APPEARANCE_ATTRIBUTES)) {
    const value = readField(overrides, key)
    if (value !== undefined) merged[key] = value
  }
  return merged
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * The exact attribute map for `settings`, with defaults omitted.
 *
 * Pure: no storage, no DOM, no `matchMedia`. This is the one place a
 * `data-*` name and its value spelling is written down, and the bootstrap
 * script in `index.html` is generated from the same tables (see
 * `appearanceBootstrapScript`), so a rename cannot reach only one of the two
 * writers.
 */
export function appearanceAttributes(
  settings: AppearanceSettings,
): Partial<Record<AppearanceAttribute, string>> {
  const out: Partial<Record<AppearanceAttribute, string>> = {}
  if (settings.theme !== DEFAULT_APPEARANCE.theme) {
    out[APPEARANCE_ATTRIBUTES.theme] = settings.theme
  }
  if (settings.density !== DEFAULT_APPEARANCE.density) {
    out[APPEARANCE_ATTRIBUTES.density] = settings.density
  }
  if (settings.textScale !== DEFAULT_APPEARANCE.textScale) {
    out[APPEARANCE_ATTRIBUTES.textScale] = settings.textScale
  }
  if (settings.motion !== DEFAULT_APPEARANCE.motion) {
    out[APPEARANCE_ATTRIBUTES.motion] = settings.motion
  }
  if (settings.iconScale !== DEFAULT_APPEARANCE.iconScale) {
    out[APPEARANCE_ATTRIBUTES.iconScale] = settings.iconScale
  }
  if (settings.accent !== DEFAULT_APPEARANCE.accent) {
    out[APPEARANCE_ATTRIBUTES.accent] = settings.accent
  }
  return out
}

/** Every attribute name the model owns, in the order `applyAppearance` writes them. */
export const APPEARANCE_ATTRIBUTE_NAMES: readonly AppearanceAttribute[] = [
  APPEARANCE_ATTRIBUTES.theme,
  APPEARANCE_ATTRIBUTES.density,
  APPEARANCE_ATTRIBUTES.textScale,
  APPEARANCE_ATTRIBUTES.motion,
  APPEARANCE_ATTRIBUTES.iconScale,
  APPEARANCE_ATTRIBUTES.accent,
]

/**
 * Write the six attributes onto `root` in one pass.
 *
 * Batched and idempotent: attributes already holding the wanted value are
 * skipped, and defaults are removed rather than written as a literal. Mounting
 * this twice — the Hub nav and the editor shell both need it — therefore
 * converges on the same DOM without fighting, and an appearance change costs
 * at most six `setAttribute` calls rather than a re-render's worth of layout
 * invalidation.
 */
export function applyAppearance(
  settings: AppearanceSettings,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) return
  const wanted = appearanceAttributes(settings)
  for (const name of APPEARANCE_ATTRIBUTE_NAMES) {
    const value = wanted[name]
    if (value === undefined) {
      if (root.hasAttribute(name)) root.removeAttribute(name)
    } else if (root.getAttribute(name) !== value) {
      root.setAttribute(name, value)
    }
  }
}

/** `prefers-color-scheme` as a live boolean, with the deprecated-API fallback. */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * The theme actually in force. `system` resolves live against the OS, which is
 * what keeps `:root:not([data-theme])` honest — there is no attribute to
 * override, so the media query is the only thing deciding.
 */
export function resolveTheme(
  settings: AppearanceSettings,
  osDark: boolean = prefersDark(),
): ResolvedTheme {
  if (settings.theme !== 'system') return settings.theme
  return osDark ? 'dark' : 'light'
}

/**
 * The pre-paint script body, generated from the tables above.
 *
 * `index.html` embeds exactly this string, and `appearance.test.ts` fails if
 * the checked-in copy differs. That is what makes "the bootstrap script and
 * the hook cannot drift" a checked claim rather than a convention: the script
 * is a build artefact of the same constant, so there is no second spelling of
 * `data-text` or of the allow-lists to forget to update.
 *
 * It is emitted as an ES5-shaped IIFE because it runs before any module and
 * cannot use `const`, arrow functions, or optional chaining.
 *
 * The `index.html` copy sits behind `<!-- prettier-ignore -->` and the emitted
 * text is single-quoted and one-statement-per-line, which is what Prettier
 * produces for this file, so `npx prettier --write .` is a no-op on it. If it
 * were not, the formatter would re-indent the script, the byte-identical guard
 * in `appearance.test.ts` would fail, and the fix would be to regenerate —
 * never to relax the guard, because the guard is the whole mechanism.
 */
export function appearanceBootstrapScript(): string {
  const keys = {
    storage: APPEARANCE_STORAGE_KEY,
    legacy: LEGACY_THEME_STORAGE_KEY,
    event: APPEARANCE_EVENT,
  }
  const lists = {
    theme: THEME_PREFERENCES,
    density: DENSITIES,
    textScale: TEXT_SCALES,
    motion: MOTION_PREFERENCES,
    iconScale: ICON_SCALES,
    accent: ACCENT_IDS,
  }
  const attributes = {
    theme: APPEARANCE_ATTRIBUTES.theme,
    density: APPEARANCE_ATTRIBUTES.density,
    textScale: APPEARANCE_ATTRIBUTES.textScale,
    motion: APPEARANCE_ATTRIBUTES.motion,
    iconScale: APPEARANCE_ATTRIBUTES.iconScale,
    accent: APPEARANCE_ATTRIBUTES.accent,
  }
  const defaults = DEFAULT_APPEARANCE
  // Prettier's own serialisation of a literal: single-quoted strings, one key
  // per line, trailing comma, 2-space indent. Emitting `JSON.stringify` and
  // letting the formatter rewrite it would work too, but then the generator and
  // the checked-in file disagree until someone runs the formatter, and the
  // test would be reporting a formatting difference as a drift.
  //
  // `base` is the column the value starts at, in spaces, so the closing brace
  // lines up under it rather than under the start of the statement.
  const literal = (value: unknown): string => formatLiteral(value, BASE_INDENT)
  return [
    '// GENERATED from src/lib/appearance.ts by appearanceBootstrapScript().',
    '// Apply the stored appearance before first paint to avoid a flash of the',
    '// wrong theme/density/accent; every step is wrapped because Safari',
    '// private mode throws a SecurityError on any localStorage access and an',
    '// uncaught throw here would abort before the module below ever runs.',
    ';(function () {',
    '  try {',
    `    var store = ${literal(keys)}`,
    `    var lists = ${literal(lists)}`,
    `    var attrs = ${literal(attributes)}`,
    `    var defaults = ${literal(defaults)}`,
    '    var root = document.documentElement',
    '    var raw = null',
    '    try {',
    '      raw = localStorage.getItem(store.storage)',
    '    } catch (e) {}',
    '    var settings = null',
    '    if (raw !== null) {',
    '      try {',
    '        var parsed = JSON.parse(raw)',
    '        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed',
    '      } catch (e) {}',
    '    } else {',
    '      // No appearance payload yet: fold the pre-appearance theme key',
    '      // forward so a user who chose dark under the old model does not',
    '      // silently get the OS preference back on upgrade.',
    '      var legacy = null',
    '      try {',
    '        legacy = localStorage.getItem(store.legacy)',
    '      } catch (e) {}',
    '      if (legacy === "light" || legacy === "dark") settings = { theme: legacy }',
    '    }',
    '    if (!settings) settings = {}',
    '    for (var key in settings) {',
    '      if (!Object.prototype.hasOwnProperty.call(settings, key)) continue',
    '      var attr = attrs[key]',
    '      var allowed = lists[key]',
    '      if (!attr || !allowed) continue',
    '      var value = settings[key]',
    '      if (allowed.indexOf(value) === -1) continue',
    '      if (value === defaults[key]) continue',
    '      root.setAttribute(attr, value)',
    '    }',
    '  } catch (e) {}',
    '})()',
  ].join('\n')
}

/**
 * The column the `var x = {...}` statements start at, inside the IIFE. The
 * literals hang off those statements, so their closing brace has to line up
 * with the statement rather than with its own first key.
 */
const BASE_INDENT = 4

/** Prettier-shaped object/array/string serialisation, for the generated script. */
function formatLiteral(value: unknown, base: number): string {
  const indent = ' '.repeat(base)
  const inner = ' '.repeat(base + 2)
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((item) => inner + formatLiteral(item, base + 2))
    return `[\n${items.join(',\n')},\n${indent}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries.map(([key, item]) => `${inner}${key}: ${formatLiteral(item, base + 2)}`)
    return `{\n${items.join(',\n')},\n${indent}}`
  }
  return String(value)
}
