/**
 * Runtime escape hatches for a static host.
 *
 * The app is deployed to GitHub Pages: there is no backend, so there is no
 * remote config, and pretending otherwise would be a worse system than no flag
 * system at all. There are exactly two sources here and both are local and
 * inspectable by the user:
 *
 *   1. the URL — `?features=matting,export` / `?off=matting`. Shareable,
 *      survives a deploy, and survives being pasted into a bug report.
 *   2. `ie-flags-v1` in `localStorage` — survives navigation, so a user who
 *      turned something off does not get it back by reloading the page.
 *
 * The URL wins over storage, because a URL is the more deliberate of the two:
 * somebody typed it. Storage is the residue of an earlier decision the user may
 * not remember making, so it has to be weaker *and* visible — every flag that
 * is not `default` names its source in `flagReport()`, and the Help overlay
 * offers a one-click clear.
 *
 * **Why tri-state and not a boolean.** `on` / `off` / `default` are three
 * different claims. `off` is "the user turned this off"; `on` is "somebody asked
 * for this explicitly"; `default` is "the product has nothing to say about it,
 * so behave as shipped". Collapsing `default` into `on` is what makes a panel
 * lie: it would tell a user who never touched anything that a feature had been
 * switched on for them. `default` is also what stops a flag becoming a
 * build-time constant — `flagOff()` is false for `default`, so a gate that
 * nobody ever reads and a gate that is switched on behave identically, and the
 * difference only ever shows up in the diagnostics surface.
 *
 * **Why a registry and not free-form strings.** `?features=foo` cannot enable
 * something that does not exist, because `FlagId` is a union of the ids below
 * and `flagState` takes one. The other half is enforced by a test rather than
 * by types: `flags.test.ts` scans `src/` for every literal id handed to a flag
 * reader and fails if one is not declared here, so a typo in a gate is a red
 * test rather than a switch that reads `default` forever.
 *
 * **Why so few flags.** A registry of twenty entries where four matter is worse
 * than a registry of four: every dead flag is a promise to maintain a gate for
 * a feature that cannot fail, and a user reading the Help overlay has no way to
 * tell the two apart. Each entry below earns its place by pointing at something
 * whose failure costs the user something they cannot get back another way. The
 * ones that were considered and rejected are listed at the bottom of the
 * registry.
 */

import { useSyncExternalStore } from 'react'

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export type FlagState = 'on' | 'off' | 'default'

export type FlagDef = {
  /** The id used in `?features=` / `?off=` / `ie-flags-v1`. */
  readonly id: string
  /** The user-facing name of the thing this gates. */
  readonly label: string
  /** Where the gate actually lives — a file, so a reader can go and check. */
  readonly gates: string
  /** One line: why a switch for this is worth having at all. */
  readonly description: string
  /** What the feature does when the state is `default`. Prose, because for
   *  `engine` the answer is "ask the device", which is neither on nor off. */
  readonly today: string
}

/*
 * Considered and rejected, recorded so the next person does not re-add them:
 *
 * - `looks`. Genuinely the riskiest thing in the app after matting: all 24
 *   presets are hald PNGs fetched from `public/luts/` at runtime, `LUT3D_FRAG`
 *   feeds them to *every pixel*, and a wrong-size or corrupt strip ruins the
 *   whole picture rather than one control. Left out only because the gate is in
 *   `FiltersPanel.tsx`, and a declared flag with no gate is the exact silence
 *   this module exists to remove.
 * - `fonts`. A failed `FontFace` load already falls back to the system stack
 *   *and* is reported per-entry (`FontUnavailableError` reaches the panel). A
 *   switch would add a way to be wrong, not a fix.
 * - `pdf`, `zip`, `webp`, `avif`. All bundled, so none of them can 404; the
 *   deploy is their failure surface and `import.meta`'s build failure already
 *   covers it.
 * - `stickers`, `passport`, `sample-images`, `telemetry`. Either bundled or
 *   already surfaced on failure — there is nothing to gate.
 */
const REGISTRY = [
  {
    id: 'matting',
    label: 'Background removal',
    gates: 'src/components/tools/BackgroundPanel.tsx — the "Remove background" action',
    description:
      'The model is ~42 MB of ONNX weights fetched from the imgly CDN at runtime. If it 404s, is corrupt, changes shape, or the network blocks it, this is the only way to turn the feature off and keep editing.',
    today: 'Available. The model downloads from the CDN on first use.',
  },
  {
    id: 'export',
    label: 'Full export',
    gates: 'src/components/tools/ExportSheet.tsx — the whole export sheet',
    description:
      'Export is the only path that gets the work off the device, so a failure here loses it. With this off the sheet is replaced by a single plain save rather than disappearing.',
    today: 'Available. Format, quality, resize, metadata, target size, zip and PDF are all on.',
  },
  {
    id: 'engine',
    label: 'Render engine',
    gates: 'src/hooks/useRenderLoop.ts — the backend the preview uses',
    description:
      'A GPU driver can produce a blank or wrong preview while the file on disk is fine. This is the pin, and it is what ?engine=gl / ?engine=canvas2d now sets.',
    today: 'Automatic: WebGL2 when the device reports it, Canvas2D when it does not.',
  },
  {
    id: 'webgl',
    label: 'WebGL2',
    gates: 'src/render/selectBackend.ts — the veto on creating a WebGL2 context',
    description:
      'A hard "no WebGL2 in this browser", not a preference for one loop. `engine` off steers the preview; this answers a device whose driver is the problem.',
    today: 'Allowed. WebGL2 contexts are created wherever the probe succeeds.',
  },
] as const satisfies readonly FlagDef[]

export const FLAG_REGISTRY: readonly FlagDef[] = REGISTRY

export type FlagId = (typeof REGISTRY)[number]['id']

/** Every declared id, in registry order. */
export const FLAG_IDS: readonly FlagId[] = REGISTRY.map((entry) => entry.id)

const BY_ID = new Map<string, FlagDef>(FLAG_REGISTRY.map((entry) => [entry.id, entry]))

export function flagDef(id: FlagId): FlagDef {
  const entry = BY_ID.get(id)
  if (!entry) throw new Error(`undeclared flag "${id}"`)
  return entry
}

export function isFlagId(value: string): value is FlagId {
  return BY_ID.has(value)
}

/* -------------------------------------------------------------------------- */
/* Parsing — pure, so precedence is testable without a browser                  */
/* -------------------------------------------------------------------------- */

/** What one source asked for. A flag absent from the record said nothing. */
export type FlagOverrides = Partial<Record<FlagId, 'on' | 'off'>>

export type ParsedFlags = {
  values: FlagOverrides
  /** Ids that are not in the registry. Never applied; always reported. */
  unknown: string[]
}

const EMPTY_PARSED: ParsedFlags = { values: {}, unknown: [] }

/**
 * Split a comma-separated list into trimmed, non-empty ids.
 *
 * An empty segment (`?features=` or `?features=matting,,export`) is dropped
 * rather than treated as an unknown id: the parameter is documented as a list,
 * and a list with a trailing comma is a typo in *punctuation*, not a request
 * for a feature named "". Only a segment with a non-empty id can reach the
 * unknown-id path, which is the one that is loud.
 */
function splitList(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function apply(values: FlagOverrides, ids: readonly string[], state: 'on' | 'off'): string[] {
  const unknown: string[] = []
  for (const id of ids) {
    if (!isFlagId(id)) {
      if (!unknown.includes(id)) unknown.push(id)
      continue
    }
    values[id] = state
  }
  return unknown
}

/**
 * The URL tier: `?features=`, `?off=`, and the deprecated `?engine=`.
 *
 * `?engine=gl` / `?engine=canvas2d` predate this module and are still used by
 * `e2e/journey.context-loss.spec.ts` and `e2e/journey.perf-budget.spec.ts`, so
 * they are normalised into the `engine` flag here rather than left as a second
 * mechanism beside it. They are applied first, which puts them *below*
 * `?features=` / `?off=` within the URL tier: an explicit switch names a flag,
 * the legacy parameter names one engine value, and the explicit one should win
 * when both are present.
 *
 * `?features=` is applied before `?off=`, and that ordering is the answer to
 * `?features=matting&off=matting`. The two are contradictory and the only
 * defensible reading is the one that loses least: a feature the user cannot use
 * is recoverable by removing the parameter, while a feature forced on that was
 * meant to be off may be the thing that is broken. `off` wins, and the same rule
 * settles `webgl` against `engine`, where `webgl` is the veto.
 */
export function parseFlagQuery(search: string): ParsedFlags {
  const params = new URLSearchParams(search)
  const values: FlagOverrides = {}
  const unknown: string[] = []

  const engine = params.get('engine')
  if (engine === 'gl') values.engine = 'on'
  else if (engine === 'canvas2d') values.engine = 'off'
  else if (engine !== null && engine !== 'auto') unknown.push(`engine=${engine}`)

  unknown.push(...apply(values, splitList(params.get('features')), 'on'))
  unknown.push(...apply(values, splitList(params.get('off')), 'off'))

  // Deduped across the two lists as well as within one: `?features=x&off=x` is
  // one typo, and the Help overlay should say so once.
  return { values, unknown: [...new Set(unknown)] }
}

/**
 * The storage tier: `ie-flags-v1`, a JSON object of id to `on` / `off`.
 *
 * An id that is not in the registry is dropped and reported, for the same
 * reason the URL does the same: a flag removed from the registry must not stay
 * readable as a live override forever, and must not take the page down with a
 * `throw` in a `localStorage` read that happens at import time.
 *
 * A value that is not the string `on` or `off` is dropped rather than coerced:
 * `{"matting": false}` is a plausible thing for a hand-edited key or an older
 * build to contain, and reading it as `off` would disable a feature nobody
 * meant to switch off.
 */
export function parseStoredFlags(raw: string | null): ParsedFlags {
  if (!raw) return EMPTY_PARSED
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    // A truncated or hand-edited key reads as "nothing saved". The alternative —
    // throwing — would make a debug switch the one thing that can white-screen
    // the editor.
    return EMPTY_PARSED
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return EMPTY_PARSED

  const values: FlagOverrides = {}
  const unknown: string[] = []
  for (const [key, value] of Object.entries(decoded)) {
    if (!isFlagId(key)) {
      unknown.push(key)
      continue
    }
    if (value === 'on' || value === 'off') values[key] = value
  }
  return { values, unknown }
}

/** Where an effective state came from. Shown to the user; never inferred. */
export type FlagSource = 'url' | 'saved' | 'default'

export type Snapshot = {
  url: ParsedFlags
  saved: ParsedFlags
}

export function resolveFlagState(snapshot: Snapshot, id: FlagId): FlagState {
  return snapshot.url.values[id] ?? snapshot.saved.values[id] ?? 'default'
}

/**
 * The two tiers, side by side, without touching the environment.
 *
 * Exists for the readers that have to stay pure — `readEnginePreference` in
 * `selectBackend.ts` takes a search string so precedence can be checked without
 * a browser, and this is the one place the two parsers are joined so it cannot
 * resolve precedence a different way from the live store.
 */
export function snapshotFor(search: string, storedRaw: string | null): Snapshot {
  return { url: parseFlagQuery(search), saved: parseStoredFlags(storedRaw) }
}

export function resolveFlagSource(snapshot: Snapshot, id: FlagId): FlagSource {
  if (snapshot.url.values[id]) return 'url'
  if (snapshot.saved.values[id]) return 'saved'
  return 'default'
}

/* -------------------------------------------------------------------------- */
/* Live store                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One key, one JSON object. Versioned in the name for the reason
 * `onboardingKeys.ts` gives: a build that changes the shape moves the key, and
 * the old value can never be read by the new copy.
 */
export const FLAGS_STORAGE_KEY = 'ie-flags-v1'

/**
 * The raw saved record, or `null`. Reads through the same guards as everything
 * else here, because `localStorage` throws at the property as often as at the
 * call — Safari private mode raises a `SecurityError` for `window.localStorage`
 * itself.
 */
export function storedFlagsRaw(): string | null {
  try {
    return store()?.getItem(FLAGS_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function readSearch(): string {
  try {
    return typeof window === 'undefined' ? '' : window.location.search
  } catch {
    return ''
  }
}

function readStored(storage: Storage | null): ParsedFlags {
  try {
    return parseStoredFlags(storage?.getItem(FLAGS_STORAGE_KEY) ?? null)
  } catch {
    return EMPTY_PARSED
  }
}

let snapshot: Snapshot | null = null
let storageListenerAttached = false
const listeners = new Set<() => void>()

/**
 * Re-read on a `storage` event, so a flag changed in a second tab reaches this
 * one. The URL is not re-read because it cannot change without a navigation,
 * which is already a fresh read.
 *
 * Attached lazily rather than from `main.tsx` so the module is usable — and
 * correct — with no wiring at all: the first read is what picks the URL up, and
 * requiring a startup call would make "forgot to initialise the flags" a
 * possible state.
 */
function attachStorageListener(): void {
  if (storageListenerAttached || typeof window === 'undefined') return
  storageListenerAttached = true
  window.addEventListener('storage', onStorageEvent)
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== FLAGS_STORAGE_KEY) return
  snapshot = { url: parseFlagQuery(readSearch()), saved: readStored(store()) }
  notify()
}

function current(): Snapshot {
  if (!snapshot) {
    snapshot = { url: parseFlagQuery(readSearch()), saved: readStored(store()) }
    warnUnknown([...snapshot.url.unknown, ...snapshot.saved.unknown])
  }
  attachStorageListener()
  return snapshot
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * An unrecognised id is a typo, and a typo is a bug worth seeing.
 *
 * It is dropped either way — a URL is user input and must never be able to
 * change the app by naming something that does not exist — but in development
 * it is printed, because a typo in a gate would otherwise read as a switch that
 * does nothing and cost an afternoon. In production it is silent *in the
 * console* and loud in the Help overlay: the overlay lists every unknown id it
 * ignored, so a user who pasted a URL from a bug report can see that the part
 * they were pointing at was never a flag at all.
 */
function warnUnknown(unknown: readonly string[]): void {
  if (unknown.length === 0 || !import.meta.env.DEV) return
  console.warn(
    `[flags] ignoring unknown flag id(s): ${unknown.join(', ')}. Declared: ${FLAG_IDS.join(', ')}.`,
  )
}

/**
 * Re-read both sources from an explicit environment and publish.
 *
 * The app calls this once at startup with neither argument; tests call it with
 * a search string and a storage double. Returns the unknown ids so a caller
 * that wants to surface them in the UI — the Help overlay does — does not have
 * to re-derive them.
 */
export function initFlags(options: { search?: string; storage?: Storage | null } = {}): string[] {
  snapshot = {
    url: parseFlagQuery(options.search ?? readSearch()),
    saved: readStored(options.storage === undefined ? store() : options.storage),
  }
  const unknown = [...snapshot.url.unknown, ...snapshot.saved.unknown]
  warnUnknown(unknown)
  attachStorageListener()
  notify()
  return unknown
}

/** Drop the live snapshot so the next read comes from the environment again. Tests only. */
export function resetFlags(): void {
  snapshot = null
  cached = null
  notify()
}

export function flagState(id: FlagId): FlagState {
  return resolveFlagState(current(), id)
}

/**
 * The gate. `off` is the only state that changes anything; `on` and `default`
 * both mean "behave as this flag ships", which is what keeps `default` from
 * being a third way for a consumer to forget about.
 */
export function flagOff(id: FlagId): boolean {
  return flagState(id) === 'off'
}

/** True only for an explicit `on`. A consumer that needs "somebody asked for
 *  this" asks for this rather than reading `!flagOff()`. */
export function flagOn(id: FlagId): boolean {
  return flagState(id) === 'on'
}

export function flagSource(id: FlagId): FlagSource {
  return resolveFlagSource(current(), id)
}

export function subscribeFlags(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Write a flag to storage, or forget it when the state is `default`.
 *
 * Deliberately never touches the URL. A `?off=matting` in the address bar is
 * somebody's explicit instruction for this page load, and a write from the
 * panel must not silently outrank it — so with the URL saying `off`, writing
 * `on` here leaves the effective state at `off` and the Help overlay shows both
 * a URL row and a saved row disagreeing, which is the truth.
 *
 * Saving `default` removes the key entirely rather than storing `"default"`:
 * an empty record is indistinguishable from a clean browser, and a key left
 * behind under a name that will never be read again is one more thing to rot.
 */
export function setFlagState(id: FlagId, state: FlagState): void {
  const active = current()
  const saved: FlagOverrides = { ...active.saved.values }
  if (state === 'default') delete saved[id]
  else saved[id] = state
  snapshot = { url: active.url, saved: { values: saved, unknown: active.saved.unknown } }
  try {
    if (Object.keys(saved).length === 0) store()?.removeItem(FLAGS_STORAGE_KEY)
    else store()?.setItem(FLAGS_STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Blocked storage is a legitimate state. The in-memory state still changed,
    // which is what this session sees; the next load will not remember it, and
    // the Help overlay names the saved rows as the thing to clear rather than
    // claiming a durable change.
  }
  notify()
}

export function clearFlagState(id: FlagId): void {
  setFlagState(id, 'default')
}

export function clearAllFlags(): void {
  snapshot = { url: current().url, saved: EMPTY_PARSED }
  try {
    store()?.removeItem(FLAGS_STORAGE_KEY)
  } catch {
    // See setFlagState.
  }
  notify()
}

/* -------------------------------------------------------------------------- */
/* The diagnostics surface                                                     */
/* -------------------------------------------------------------------------- */

export type FlagReportRow = {
  id: FlagId
  label: string
  state: FlagState
  source: FlagSource
  /** The thing this flag gates, named as a file so a reader can go and check. */
  gates: string
  /** What `default` does, so the row says what changing it would change. */
  today: string
  /** Whether this flag is currently taking effect as a restriction. */
  blocking: boolean
}

export type FlagReport = {
  rows: FlagReportRow[]
  /** Ids present in the URL or storage that are not in the registry. */
  unknown: string[]
  /** Whether anything is saved, i.e. whether "clear all" has anything to do. */
  hasSaved: boolean
}

let cached: { snapshot: Snapshot; report: FlagReport } | null = null

/**
 * Everything the user needs to see why a feature is missing, and to undo it.
 *
 * One function rather than a per-flag description, because the failure this
 * exists to prevent is a panel that quietly drops a control: whatever renders
 * this must be able to say *which* flag, *from where*, and *how to clear it*.
 *
 * The result is cached against the snapshot because `useSyncExternalStore`
 * compares snapshots by identity — a fresh object on every call is an infinite
 * render loop, not a re-render.
 */
export function flagReport(): FlagReport {
  const active = current()
  if (cached?.snapshot === active) return cached.report
  const report: FlagReport = {
    rows: REGISTRY.map((entry) => {
      const id = entry.id
      const state = resolveFlagState(active, id)
      return {
        id,
        label: entry.label,
        state,
        source: resolveFlagSource(active, id),
        gates: entry.gates,
        today: entry.today,
        blocking: state === 'off',
      }
    }),
    unknown: [...active.url.unknown, ...active.saved.unknown],
    hasSaved: Object.keys(active.saved.values).length > 0,
  }
  cached = { snapshot: active, report }
  return report
}

/* -------------------------------------------------------------------------- */
/* React bindings                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Subscribe a component to one flag.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because the store
 * is the source of truth and must be re-read during render: a flag flipped from
 * another component, or from another tab, has to be visible in the same commit
 * or the panel shows the stale answer for a frame.
 */
export function useFlagState(id: FlagId): FlagState {
  const read = () => flagState(id)
  return useSyncExternalStore(subscribeFlags, read, read)
}

/** Subscribe to the whole report; the snapshot identity only changes on a write. */
export function useFlagReport(): FlagReport {
  return useSyncExternalStore(subscribeFlags, flagReport, flagReport)
}

/** Subscribe to a flag's boolean gate. */
export function useFlagOff(id: FlagId): boolean {
  const read = () => flagOff(id)
  return useSyncExternalStore(subscribeFlags, read, read)
}

/**
 * Subscribe to where a flag's value is coming from.
 *
 * A panel needs this to decide what it can honestly offer: a `?off=` cannot be
 * undone from inside the app, so the copy has to name the address bar instead of
 * shipping a clear button that would do nothing.
 */
export function useFlagSource(id: FlagId): FlagSource {
  const read = () => flagSource(id)
  return useSyncExternalStore(subscribeFlags, read, read)
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The sentence a panel shows when a feature is switched off.
 *
 * It has to answer two questions in one go, because a user looking at a missing
 * button cannot act on either one alone: *why is it gone* and *how do I get it
 * back*. "Off" without the second half is the silence this module was written
 * to remove.
 *
 * The two halves name the flag's own tier on purpose. A `?off=` in the address
 * bar cannot be cleared from a panel — the user has to edit the URL — so telling
 * them to open a menu they already used would be a worse answer than none.
 */
export function describeDisabledFlag(id: FlagId): string {
  const label = flagDef(id).label
  if (flagSource(id) === 'url') {
    return `${label} is turned off for this page by ?off=${id} in the address bar. Remove it from the address bar to turn it back on.`
  }
  return `${label} is turned off in this browser. Turn it back on in Help → Debug switches.`
}
