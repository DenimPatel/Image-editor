/**
 * Local diagnostics: a bounded, in-memory ring buffer of what went wrong, and a
 * plain-text report the user can copy into a bug report.
 *
 * ## Why this is not telemetry
 *
 * The product's central claim is "nothing leaves this tab". That claim is only
 * worth something if it survives contact with the code that reports bugs, and
 * the usual way to add bug reporting is a network call — which would make the
 * claim false in the one module whose whole job is to be believed. So there is
 * no transport here at all. Nothing in this file opens a socket, reads a beacon
 * or mints an identifier, and `diagnostics.test.ts` asserts the absence of any
 * user data so the boundary is checkable rather than aspirational.
 *
 * ## The privacy boundary, stated exactly
 *
 * An entry is a **fixed shape of strings**: `{ at, level, tag, message, error?:
 * { name, message, stack }, frames? }`. Values reach it in exactly two ways:
 *
 *  1. a caller passes a **string** as `message` / `frames` (its own words), or
 *  2. a caller passes an **`Error`**, and only its `name`, `message` and `stack`
 *     are read — three string properties that `Error` itself defines.
 *
 * Anything else — a `File`, a `Blob`, an `ImageData`, an `ImageBitmap`, a
 * `Doc`, a canvas, a `Proxy` — is reduced by `describeUnknown` to a **type
 * name in brackets** (`[File]`, `[Blob]`, `[Object]`) and nothing more. There
 * is no `JSON.stringify`, no `Object.entries`, no `for…in` and no property read
 * anywhere on an unknown value, so there is no path by which a document, a
 * pixel or a file name can reach the buffer. That is the whole mechanism, and
 * it is deliberately not configurable.
 *
 * A second, coarser net catches the one realistic leak: a `console.error` whose
 * *string* argument happens to be a `data:` URL, which is how pixels get logged
 * by accident. `redact` strips the payload out of any captured string.
 *
 * ## Bounds
 *
 * The buffer is capped **twice** — `MAX_ENTRIES` entries and `MAX_BYTES` bytes —
 * because a render loop that throws on every frame would otherwise append ~60
 * entries a second forever. Count alone is not enough: one entry can be a
 * 4 kB stack, so 100 of them is 400 kB of live strings. Whichever cap binds
 * first evicts from the oldest end. `diagnosticCounters` keeps a per-tag tally
 * *outside* the ring, so "this threw 4,000 times" is still reportable after the
 * first 4,000 entries have been evicted.
 */

import { buildLabel } from './buildInfo'
import { flagReport } from './flags'

/** How a reader triages the buffer. `warn` is a degradation, not a failure. */
export type DiagnosticLevel = 'error' | 'warn' | 'info'

/** The label column width, shared by every section so the report reads as one table. */
const LABEL_WIDTH = 15
const STATE_WIDTH = 17

/**
 * Where an event came from. A closed union on purpose: the set of sources is
 * finite, the counter map is keyed by it, and a free-form string would let a
 * caller invent unbounded keys in a module whose job is to be bounded.
 */
export const DIAGNOSTIC_TAGS = [
  'window.onerror',
  'unhandledrejection',
  'console.error',
  'react.boundary',
  'render.fallback',
  'clipboard',
  'storage',
  'manual',
] as const

export type DiagnosticTag = (typeof DIAGNOSTIC_TAGS)[number]

/** Entries kept. 100 events is roughly a session's worth of distinct problems. */
export const MAX_ENTRIES = 100
/** Bytes of captured text kept, across every entry. */
export const MAX_BYTES = 64 * 1024
/** Per-field caps. A stack is the only field worth much room. */
export const MESSAGE_CAP = 500
export const STACK_CAP = 4000
export const FIELD_CAP = 200

export type DiagnosticEntry = {
  /** `Date.now()` at capture. */
  at: number
  level: DiagnosticLevel
  tag: DiagnosticTag
  message: string
  /** Present only for a real `Error`; see the privacy note above. */
  error?: { name: string; message: string; stack: string }
  /** A React component stack, or any other caller-supplied frame list. */
  frames?: string
  /** True when any field was cut. The cut is marked in the text as well. */
  truncated: boolean
  /** What this entry costs against `MAX_BYTES`. */
  bytes: number
}

export type DiagnosticInput = {
  level: DiagnosticLevel
  tag: DiagnosticTag
  /** The caller's own words. Never an interpolated object. */
  message: string
  /** A real `Error`. Anything else is recorded as a type name only. */
  error?: unknown
  /** Extra text, truncated and redacted like every other field. */
  frames?: string
}

const entries: DiagnosticEntry[] = []
const counters = new Map<DiagnosticTag, number>()
let totalBytes = 0

const encoder = new TextEncoder()

function byteLength(value: string): number {
  return encoder.encode(value).length
}

/**
 * A `data:` URL with a real payload is a picture in a log line. It arrives only
 * as a *string* (a `File` or `Blob` never gets this far), so this catches the
 * one path that could carry image bytes through an otherwise safe channel.
 */
const DATA_URL = /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{40,}/gi

export function redact(value: string): string {
  return value.replace(DATA_URL, 'data:image/*;base64,<payload omitted>')
}

/**
 * Cut a string to `cap` characters, **and say so in the text**.
 *
 * A silent truncation is the failure mode worth avoiding: a reader who pastes a
 * half-stack into a bug report cannot tell that the other half existed, so the
 * report looks complete and is not. The marker carries the original length, so
 * the reader can see that something was dropped and roughly how much. It is a
 * module-level constant because an entry's `truncated` flag is derived from
 * looking for it in the stored text, and a second copy of the literal in two
 * places is two things that can drift.
 */
const TRUNCATION_MARK = '[truncated:'

export function truncate(value: string, cap: number): { text: string; truncated: boolean } {
  // Coerced rather than trusted. `navigator.userAgent` is the field that
  // bit: a test that stubs `navigator` wholesale hands back an object with
  // `clipboard` on it and nothing else, and a report that throws while
  // describing an environment is a report that is never produced.
  const source = typeof value === 'string' ? value : String(value)
  if (source.length <= cap) return { text: source, truncated: false }
  const kept = source.slice(0, cap)
  return {
    text: `${kept}\n[truncated: ${kept.length} of ${source.length} characters kept]`,
    truncated: true,
  }
}

/** Errors, and only errors. A `Doc` is not an `Error` and never becomes one. */
function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error || (typeof DOMException !== 'undefined' && value instanceof DOMException)
  )
}

/**
 * A type name, from the `Object.prototype.toString` tag only.
 *
 * `Symbol.toStringTag` is a getter, and a getter on an unknown value can throw
 * or run code, so the whole thing is wrapped. The result is filtered to a short
 * identifier shape: anything else is reported as `object`, because a `toString`
 * tag is attacker-influencable and this string lands in a report.
 */
function typeTag(value: object): string {
  try {
    const tag = Object.prototype.toString.call(value).slice(8, -1)
    return /^[A-Za-z][A-Za-z0-9 _-]{0,31}$/.test(tag) ? tag : 'object'
  } catch {
    return 'object'
  }
}

/**
 * Reduce an arbitrary value to a short, content-free line.
 *
 * This is the privacy boundary. It reads three string properties off a real
 * `Error` and nothing at all off anything else — no serialisation, no
 * enumeration, no length or size probe. `describeUnknown(file)` is `[File]`,
 * full stop, and that is a property of the code above rather than a promise
 * about what callers will pass.
 */
export function describeUnknown(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (isErrorLike(value)) return `${value.name}: ${value.message}`
  if (typeof value === 'object' || typeof value === 'function') return `[${typeTag(value)}]`
  return `[${typeof value}]`
}

function errorFields(value: Error): { name: string; message: string; stack: string } {
  const name = truncate(redact(String(value.name ?? 'Error')), FIELD_CAP)
  const message = truncate(redact(String(value.message ?? '')), MESSAGE_CAP)
  const stack = truncate(redact(String(value.stack ?? '')), STACK_CAP)
  return { name: name.text, message: message.text, stack: stack.text }
}

function makeEntry(input: DiagnosticInput): DiagnosticEntry {
  const message = truncate(redact(String(input.message)), MESSAGE_CAP)
  const error = isErrorLike(input.error) ? errorFields(input.error) : undefined
  const frames =
    input.frames === undefined ? undefined : truncate(redact(String(input.frames)), STACK_CAP)
  const errorTruncated = error
    ? [error.name, error.message, error.stack].some((field) => field.includes(TRUNCATION_MARK))
    : false
  const bytes =
    byteLength(`${input.tag} ${input.level} ${message.text}`) +
    byteLength(error ? `${error.name}${error.message}${error.stack}` : '') +
    byteLength(frames?.text ?? '')
  return {
    at: Date.now(),
    level: input.level,
    tag: input.tag,
    message: message.text,
    ...(error ? { error } : {}),
    ...(frames ? { frames: frames.text } : {}),
    truncated: message.truncated || frames?.truncated === true || errorTruncated,
    bytes,
  }
}

/**
 * Append one event, then evict from the oldest end until both caps hold.
 *
 * `recordDiagnostic` is called from a `console.error` wrapper, so it must never
 * throw: a throw here would propagate into whatever the app was doing, and a
 * diagnostic that takes down the caller is worse than no diagnostic. Every
 * caller-facing entry point therefore wraps it, and this function keeps its own
 * body total.
 */
export function recordDiagnostic(input: DiagnosticInput): DiagnosticEntry {
  const entry = makeEntry(input)
  entries.push(entry)
  totalBytes += entry.bytes
  while (entries.length > MAX_ENTRIES || (totalBytes > MAX_BYTES && entries.length > 1)) {
    const dropped = entries.shift()
    if (dropped) totalBytes -= dropped.bytes
  }
  counters.set(input.tag, (counters.get(input.tag) ?? 0) + 1)
  return entry
}

/**
 * The retained entries, oldest first.
 *
 * A shallow copy: it stops a caller pushing onto or splicing the ring from
 * outside, which is the mistake that would break the byte accounting. The
 * entry objects themselves are shared and are treated as read-only.
 */
export function diagnosticEntries(): DiagnosticEntry[] {
  return [...entries]
}

export type DiagnosticStats = {
  count: number
  bytes: number
  maxEntries: number
  maxBytes: number
}

export function diagnosticStats(): DiagnosticStats {
  return { count: entries.length, bytes: totalBytes, maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES }
}

/** Per-tag totals, which survive eviction. */
export function diagnosticCounters(): { tag: DiagnosticTag; count: number }[] {
  return [...counters.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => (b.count === a.count ? a.tag.localeCompare(b.tag) : b.count - a.count))
}

export function clearDiagnostics(): void {
  entries.length = 0
  counters.clear()
  totalBytes = 0
}

/* ==========================================================================
   Environment facts
   ========================================================================== */

export type DiagnosticsFacts = {
  build: string
  page: string
  userAgent: string
  screen: string
  engine: string
  storage: string
  serviceWorker: string
  capabilities: string
}

/**
 * The `localStorage` key `loadCaps` writes its probe record under.
 *
 * `src/gl/caps.ts` is not this change's file, and `CACHE_KEY` is module-private
 * there, so the literal is repeated with a test that reads `caps.ts` and fails
 * if the two drift. A stale hash would be worse than none: it would look like a
 * capability fingerprint while describing the wrong record.
 */
const CAPS_STORAGE_KEY = 'ie-caps-v4'

/**
 * FNV-1a, 32-bit. Not a cryptographic hash and not trying to be: this exists so
 * two devices with different GPU limits can be told apart in a bug report
 * without printing the record itself. The record holds only capability numbers,
 * but it is hashed anyway so the rule "diagnostics prints what it needs and no
 * more" has nothing to except.
 */
export function hash32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * `location.href` with the fragment dropped and any credentials removed.
 *
 * The query string is kept on purpose: `?engine=canvas2d` and `?crash=1` are
 * real reproduction steps, and a support conversation needs them. The fragment
 * is dropped because this app never writes one, so nothing in it is diagnostic
 * — and a fragment is where a pasted token or a private URL would sit if a user
 * ever got the URL from somewhere else.
 */
export function safeHref(href: string): string {
  try {
    const url = new URL(href)
    url.hash = ''
    url.username = ''
    url.password = ''
    return truncate(url.toString(), FIELD_CAP * 3).text
  } catch {
    return '(unreadable page url)'
  }
}

let engineKind = 'not selected yet'
let storageLine = 'not read yet'

/** Called by `useRenderLoop` whenever the backend is chosen or swapped. */
export function setDiagnosticEngine(kind: 'gl' | 'canvas2d' | 'unknown'): void {
  engineKind = kind
}

function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes >= 100 ? Math.round(megabytes) : Math.round(megabytes * 10) / 10} MB`
}

/**
 * Read `navigator.storage.estimate()`.
 *
 * Separate from `collectFacts` because it is the one asynchronous fact, and a
 * report that has to await it can fail to arrive at all — a rejected clipboard
 * permission on a page whose storage API also hangs is exactly the situation
 * the report exists for. So the number is refreshed in the background and the
 * synchronous report always has *something* to print.
 */
export async function refreshStorageEstimate(): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      storageLine = 'not available in this browser'
      return
    }
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage ?? 0
    const quota = estimate.quota ?? 0
    storageLine =
      quota > 0 ? `${formatMegabytes(usage)} of ${formatMegabytes(quota)} used` : 'not reported'
  } catch {
    storageLine = 'could not be read'
  }
}

function readScreen(): string {
  if (typeof screen === 'undefined') return 'unknown'
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return `${screen.width}×${screen.height} at ${Math.round(dpr * 100) / 100}×`
}

function readServiceWorker(): string {
  try {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return 'not supported'
    return navigator.serviceWorker.controller ? 'yes, this page is controlled' : 'no'
  } catch {
    return 'unknown'
  }
}

function readCapabilities(): string {
  try {
    if (typeof localStorage === 'undefined') return 'no storage'
    const record = localStorage.getItem(CAPS_STORAGE_KEY)
    if (!record) return 'not probed yet'
    return `ie-caps ${hash32(capsFingerprint(record))}`
  } catch {
    return 'storage blocked'
  }
}

/**
 * The capability numbers out of a probe record, and nothing else.
 *
 * The record is an envelope — a version, the time it was taken, and the caps —
 * so hashing the raw string would fold a timestamp into the fingerprint and the
 * same device would report a different hash after every re-probe. That defeats
 * the only job the hash has, which is to let two devices be told apart by what
 * they can do rather than by when they happened to be asked. A record that is
 * not an envelope is hashed whole, so a reader still gets a fingerprint rather
 * than nothing.
 */
function capsFingerprint(record: string): string {
  const parsed = safeJsonParse(record)
  if (typeof parsed !== 'object' || parsed === null) return record
  const caps = (parsed as { caps?: unknown }).caps
  if (typeof caps !== 'object' || caps === null) return record
  return stableStringify(caps)
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * `JSON.stringify` with the keys of every object emitted in order.
 *
 * `JSON.stringify`'s replacer *array* form is a whitelist applied at every depth,
 * so it cannot be used for this: listing the top-level keys of `Caps` would
 * silently drop the two inside `formats`, and every device would hash the same
 * whether it could write AVIF or not.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')
    return `{${body}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function collectFacts(): DiagnosticsFacts {
  return {
    build: buildLabel(),
    page: typeof location === 'undefined' ? 'unknown' : safeHref(location.href),
    userAgent:
      typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string'
        ? 'unknown'
        : truncate(navigator.userAgent, FIELD_CAP).text,
    screen: readScreen(),
    engine: engineKind,
    storage: storageLine,
    serviceWorker: readServiceWorker(),
    capabilities: readCapabilities(),
  }
}

function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 23)
}

function indent(value: string): string {
  return value
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

function humanBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round((bytes / 1024) * 10) / 10} kB`
}

/**
 * The whole report, as one copy-pasteable block of plain text.
 *
 * Synchronous and total: it must work with the clipboard denied, with storage
 * blocked, on a page mid-crash. It leads with what it is and what it is not,
 * because a reader pasting it into a public issue is entitled to know that no
 * image and no document is in it.
 */
/**
 * The debug switches, one row each, in the shape a support conversation needs:
 * what it is called, what it is doing, and where it came from.
 *
 * A missing control is the failure this section exists to explain. Every kill
 * switch in the app can take a feature out, and a bug report that does not say
 * which ones are off is a report whose first question is always "are any flags
 * set" — asked of the user, who cannot answer it. The `source` column is why the
 * state matters: a flag off from a `?` parameter is a reproduction step, and one
 * off from storage is a setting somebody changed and forgot about.
 *
 * `default` is printed as `default` rather than as `default (default)` because a
 * row that reads "it is on by default, from nowhere" is noise. `unknown` ids are
 * the flip case — a hand-edited or stale key naming a switch this build does not
 * have — and they are listed rather than dropped, because a switch that no longer
 * exists is exactly what a user who still expects it to work is running.
 */
function debugSwitchLines(): string[] {
  const report = flagReport()
  const rows = report.rows.map((row) => {
    const state = row.state === 'default' ? 'default' : `${row.state} (${row.source})`
    return `${row.id.padEnd(LABEL_WIDTH)}${state.padEnd(STATE_WIDTH)}${row.gates}`
  })
  if (report.unknown.length > 0) {
    rows.push(`${'unknown'.padEnd(LABEL_WIDTH)}${report.unknown.join(', ')}`)
  }
  return rows
}

export function buildDiagnosticsReport(): string {
  const facts = collectFacts()
  const lines = [
    'IMAGE EDITOR — DIAGNOSTICS',
    'Generated on this device, in this tab, by pressing a button. Nothing was sent',
    'anywhere: this report contains the build, the page, the browser, the screen, the',
    'render engine, storage numbers and recent error messages — no image, no pixel, no',
    'file name, no filename and no document.',
    '',
    '— ENVIRONMENT —',
    `Build          ${facts.build}`,
    `Page           ${facts.page}`,
    `Browser        ${facts.userAgent}`,
    `Screen         ${facts.screen}`,
    `Render engine  ${facts.engine}`,
    `Storage        ${facts.storage}`,
    `Service worker ${facts.serviceWorker}`,
    `Capabilities   ${facts.capabilities}`,
    '',
    '— DEBUG SWITCHES —',
    ...debugSwitchLines(),
    '',
    `— EVENTS (${entries.length} of ${MAX_ENTRIES} kept, ${humanBytes(totalBytes)} of ${humanBytes(MAX_BYTES)}) —`,
  ]
  if (entries.length === 0) lines.push('(nothing recorded yet)')
  for (const entry of entries) {
    lines.push(`[${clock(entry.at)}Z] ${entry.level} ${entry.tag} — ${entry.message}`)
    if (entry.error) {
      if (entry.error.message && !entry.error.message.includes(entry.message)) {
        lines.push(indent(`${entry.error.name}: ${entry.error.message}`))
      }
      if (entry.error.stack) lines.push(indent(entry.error.stack))
    }
    if (entry.frames) lines.push(indent(entry.frames))
  }
  const tallies = diagnosticCounters()
  if (tallies.length > 0) {
    lines.push('', '— TOTALS THIS SESSION —')
    for (const { tag, count } of tallies) lines.push(`${tag}: ${count}`)
  }
  return lines.join('\n')
}

/* ==========================================================================
   The feed paths
   ========================================================================== */

/**
 * `ErrorBoundary`'s `onError` handler. Exported so the wiring in `main.tsx` is
 * a name rather than an inline closure, and so a test can call the same function
 * the app does.
 */
export function reportBoundaryError(error: Error, componentStack?: string | null): void {
  recordDiagnostic({
    level: 'error',
    tag: 'react.boundary',
    message: `${describeUnknown(error)}`,
    error,
    frames: componentStack ?? undefined,
  })
}

/** A report the user asked for by hand, e.g. "nothing is wrong but it is slow". */
export function recordManualReport(message: string, level: DiagnosticLevel = 'info'): void {
  recordDiagnostic({ level, tag: 'manual', message })
}

/**
 * What one `console.error` call contributes.
 *
 * Only strings and `Error`s are read. Every other argument is *counted* and
 * named as a type, so the reader learns that something was passed without the
 * buffer learning what it was: `console.error('save failed', doc)` records
 * `save failed (+1 non-text argument not copied)` and the word `Object`.
 */
export function captureConsoleError(args: readonly unknown[]): void {
  const words: string[] = []
  let omitted = 0
  for (const arg of args) {
    if (typeof arg === 'string') words.push(arg)
    else if (isErrorLike(arg)) words.push(`${arg.name}: ${arg.message}`)
    else if (arg === null || arg === undefined) words.push(String(arg))
    else if (typeof arg === 'number' || typeof arg === 'boolean') words.push(String(arg))
    else {
      omitted += 1
      words.push(describeUnknown(arg))
    }
  }
  const head = truncate(redact(words.join(' ').trim()) || 'console.error', MESSAGE_CAP)
  const tail =
    omitted > 0 ? ` (+${omitted} non-text argument${omitted === 1 ? '' : 's'} not copied)` : ''
  recordDiagnostic({
    level: 'error',
    tag: 'console.error',
    message: `${head.text}${tail}`,
    error: args.find(isErrorLike),
  })
}

function onWindowError(
  this: GlobalEventHandlers,
  message: Event | string,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error,
): undefined {
  try {
    const place =
      typeof source === 'string' && source.length > 0
        ? ` (${source}:${lineno ?? 0}:${colno ?? 0})`
        : ''
    recordDiagnostic({
      level: 'error',
      tag: 'window.onerror',
      message: `${truncate(redact(String(message)), MESSAGE_CAP).text}${place}`,
      error,
    })
  } catch {
    // A diagnostic that throws into an error handler is a second failure.
  }
  return undefined
}

function onRejection(event: PromiseRejectionEvent): void {
  try {
    const reason = event.reason
    recordDiagnostic({
      level: 'error',
      tag: 'unhandledrejection',
      message: `Unhandled promise rejection: ${truncate(redact(describeUnknown(reason)), MESSAGE_CAP).text}`,
      error: isErrorLike(reason) ? reason : undefined,
    })
  } catch {
    // As above: this handler runs inside the browser's own error reporting.
  }
}

export type DiagnosticsHandle = { uninstall: () => void }

let installed = false

/**
 * Attach the four feed paths. Returns a detach function.
 *
 * `console.error` is **wrapped, never replaced**: the original is called first
 * and its return value is passed through, because silencing a console error is
 * the one thing that would make every future diagnosis of *this* module harder.
 * The wrapper is also wrapped in its own `try`, so a bug in the capture cannot
 * stop the log line the developer is looking at.
 *
 * `window.onerror` is assigned rather than listened for, because the brief names
 * it — but any handler already there is called first, so installing this never
 * takes a capability away from whatever put it there.
 */
export function installDiagnostics(): DiagnosticsHandle {
  if (typeof window === 'undefined' || installed) return { uninstall: () => {} }
  installed = true

  const previousOnError = window.onerror
  const previousConsoleError = console.error

  const wrapped: typeof console.error = (...args: unknown[]) => {
    try {
      captureConsoleError(args)
    } catch {
      // Deliberately empty: fall through to the real console below.
    }
    previousConsoleError.apply(console, args)
  }

  const handler: OnErrorEventHandler = function reportToDiagnostics(
    this: GlobalEventHandlers,
    message: Event | string,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ) {
    onWindowError.call(this, message, source, lineno, colno, error)
    previousOnError?.call(this, message, source, lineno, colno, error)
    // `undefined`, not `false`: returning `false` would cancel the browser's
    // own console report, and silencing the error this module exists to record
    // is the one outcome that makes it useless.
    return undefined
  }
  window.onerror = handler
  console.error = wrapped
  window.addEventListener('unhandledrejection', onRejection)

  return {
    uninstall: () => {
      window.removeEventListener('unhandledrejection', onRejection)
      // Restore only what is still ours. A later `installDiagnostics` — a
      // second copy of the module under HMR, or a test that forgot to
      // uninstall — owns the current value, and unwinding over its head would
      // leave a wrapper whose "original" is another wrapper, recording twice.
      if (console.error === wrapped) console.error = previousConsoleError
      if (window.onerror === handler) window.onerror = previousOnError
      installed = false
    },
  }
}

/* ==========================================================================
   Getting the text out
   ========================================================================== */

/** How the copy went. All three still leave the user with the text. */
export type CopyOutcome = 'clipboard' | 'fallback' | 'manual'

const COPY_MESSAGES: Record<CopyOutcome, string> = {
  clipboard: 'Copied to the clipboard. Paste it into your bug report.',
  fallback: 'Copied without the clipboard API. If it does not paste, select the text and copy it.',
  manual: 'The clipboard is blocked. The text below is selected — press Ctrl+C, or Cmd+C on a Mac.',
}

/**
 * Copy `text`, degrading in two steps and never failing silently.
 *
 * The clipboard API is the right path and is tried first. It is also the path
 * most likely to be *refused* — a permission error, an insecure context, a
 * browser that only grants it inside a user gesture — and a bug report lost to
 * a `NotAllowedError` is the exact failure this feature exists to prevent. So a
 * refusal falls through to a hidden textarea plus `execCommand('copy')`, and if
 * *that* is unavailable the outcome is `manual` and the caller is told to put
 * the text in front of the user with it selected. There is no branch in which
 * the user is told "copied" and it is not.
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return 'clipboard'
    }
  } catch {
    // Fall through to the legacy path.
  }
  if (typeof document === 'undefined') return 'manual'
  let scratch: HTMLTextAreaElement | null = null
  try {
    scratch = document.createElement('textarea')
    scratch.value = text
    scratch.setAttribute('readonly', '')
    scratch.setAttribute('aria-hidden', 'true')
    scratch.style.position = 'fixed'
    scratch.style.top = '0'
    scratch.style.left = '-9999px'
    scratch.style.opacity = '0'
    document.body.appendChild(scratch)
    scratch.select()
    scratch.setSelectionRange(0, text.length)
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    return copied ? 'fallback' : 'manual'
  } catch {
    return 'manual'
  } finally {
    scratch?.remove()
  }
}

export function copyOutcomeMessage(outcome: CopyOutcome): string {
  return COPY_MESSAGES[outcome]
}
