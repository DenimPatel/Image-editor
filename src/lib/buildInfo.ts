/**
 * Build identity, injected at compile time by `define` in `vite.config.ts`.
 *
 * The point of this module is that **the value cannot drift from
 * `package.json`**. `APP_VERSION` used to be a hardcoded `'1.0.0'` literal in
 * `defaults.ts` and `package.json` said `1.0.0`, with nothing deriving one
 * from the other — so a release bump moved one and left the other, silently,
 * and the app kept stamping saved documents with the old version. Reading
 * `package.json` in the Vite config makes that state inexpressible rather
 * than merely tested against, and `buildInfo.test.ts` asserts the two agree.
 *
 * `__COMMIT_SHA__` is `git rev-parse --short HEAD`, and it has to survive a
 * checkout with no git: a release tarball, a `Dockerfile` that copies a
 * working tree, a vendored dependency. `resolveCommitSha` in `vite.config.ts`
 * returns `UNKNOWN_COMMIT_SHA` there rather than letting the substitution
 * fail, because a UI printing `undefined` reads as a bug and one printing
 * `unknown` reads as "not available". `normaliseCommitSha` below is the
 * belt-and-braces check that the substitution actually happened.
 */

export const UNKNOWN_COMMIT_SHA = 'unknown'

declare global {
  /**
   * `package.json`'s `version`. `define` is a *textual* substitution, so this
   * is a bare identifier rather than a `VITE_`-prefixed `import.meta.env`
   * member: a prefix reads as "overridable from a `.env` file at build time",
   * which would let a deployment stamp a version `package.json` does not
   * contain and re-open exactly the drift this module closes. `import.meta.env`
   * is inlined into the client bundle either way, so a prefix buys no secrecy.
   */
  const __APP_VERSION__: string
  /** Short commit SHA, or `UNKNOWN_COMMIT_SHA` outside a git checkout. */
  const __COMMIT_SHA__: string
}

/**
 * `typeof __APP_VERSION__` is `string` whether or not the substitution ran, so
 * a runtime check is the only way to catch a build that shipped the identifier
 * un-replaced.
 */
function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Coerce whatever the bundler handed us into a printable string.
 *
 * A tarball build or a misconfigured `define` must never put `undefined` in
 * front of a user, and `buildLabel()` is exactly the kind of call that ends up
 * in a footer. Anything that is not a non-empty string becomes
 * `UNKNOWN_COMMIT_SHA`.
 *
 * The literal *strings* `'undefined'` and `'null'` are rejected too, not just
 * the values. A build that stringifies a missing value — `String(undefined)`,
 * a template literal, a serialiser that writes `"null"` for an absent field —
 * produces a non-empty string that passes a naive `typeof` check and renders
 * as `1.0.0 (undefined)` in the footer, which reads as a bug rather than as
 * "this build has no commit information". Same for `'[object Object]'`, which
 * is what a `git rev-parse` result that came back as a parsed object renders
 * as.
 */
const NOT_A_SHA = new Set(['undefined', 'null', 'NaN', '[object Object]', 'unknown '])

export function normaliseCommitSha(value: unknown): string {
  if (typeof value !== 'string') return UNKNOWN_COMMIT_SHA
  const trimmed = value.trim()
  if (trimmed.length === 0) return UNKNOWN_COMMIT_SHA
  if (NOT_A_SHA.has(trimmed)) return UNKNOWN_COMMIT_SHA
  return trimmed
}

/**
 * Read the injected identifier through a `typeof` guard.
 *
 * `define` is a textual substitution, so under Vite both identifiers are string
 * literals by the time this runs. But this module is also imported by the
 * Playwright e2e specs, which execute in **Node**, where the bundler never ran
 * and the identifiers are genuinely undeclared. A bare reference throws a
 * `ReferenceError` at module evaluation, which takes down the whole spec file
 * before a single test is collected — so an `import` of this module anywhere in
 * `e2e/` made the entire e2e suite unrunnable.
 *
 * `typeof` on an undeclared identifier is the one form of reference that is
 * safe in JavaScript, and the value reference is guarded behind it, so it is
 * only evaluated when the first one already proved the binding exists.
 */
function injectedValue(name: '__APP_VERSION__' | '__COMMIT_SHA__'): unknown {
  if (name === '__APP_VERSION__') {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined
  }
  return typeof __COMMIT_SHA__ === 'string' ? __COMMIT_SHA__ : undefined
}

/** `package.json`'s `version`, stamped at build time. */
export const APP_VERSION: string = isString(injectedValue('__APP_VERSION__'))
  ? (injectedValue('__APP_VERSION__') as string)
  : '0.0.0-dev'

/** Short commit SHA, or `UNKNOWN_COMMIT_SHA` outside a git checkout. */
export const COMMIT_SHA: string = normaliseCommitSha(injectedValue('__COMMIT_SHA__'))

/** `1.0.0 (aea8523)`, or `1.0.0 (unknown)`. For a one-line stamp in the UI. */
export function buildLabel(): string {
  return `${APP_VERSION} (${COMMIT_SHA})`
}
