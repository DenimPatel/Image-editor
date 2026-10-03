/**
 * The first-run marker: one key, one ASCII digit, nothing else.
 *
 * The version is in *both* halves on purpose. The key is
 * `ie-onboarding-v${ONBOARDING_VERSION}` and the value is the same number as
 * text, so a build that rewrites the orientation bumps one constant and the
 * stale half can no longer be read by the new copy: a value left behind under a
 * key that has moved says nothing about a panel the user never saw, and a fresh
 * key holding an older value would claim they had. Anything else — absent,
 * empty, `true`, a version this build does not recognise — reads as *not seen*,
 * which is the direction that shows the panel rather than silently hiding it.
 *
 * The bound is the other half of that. The obvious alternative is a JSON object
 * naming which panels have been read, and that is how a four-key layout becomes
 * forty within two releases: nothing removable, nothing writeable by a build
 * that cannot read it back, and a schema to migrate before anything else in the
 * product works. One key holding one character cannot rot in that direction.
 * `onboardingKeys.test.ts` pins the size, the key count and both halves of the
 * version.
 *
 * Storage can throw, and it throws at the *property* as often as at the call —
 * Safari private mode raises a `SecurityError` for `window.localStorage` itself
 * — so every access is guarded. The failure direction is chosen rather than
 * incidental: when the write cannot land the orientation comes back on the next
 * load, which is the wrong answer once. The alternative, treating a write that
 * failed as a write that happened, means a user who never saw the panel is
 * never shown it again by a marker that does not exist.
 */

export const ONBOARDING_VERSION = 1

/** The one key. The version is in the name so an old value cannot be read. */
export const ONBOARDING_KEY = `ie-onboarding-v${ONBOARDING_VERSION}`

/** The one value: the version, as text. One character, by construction. */
const MARKER = `${ONBOARDING_VERSION}`

/**
 * `localStorage`, or `null` when there is no window or the property access
 * itself throws. Returning the store rather than a value keeps the three
 * functions below reading as what they do instead of as three copies of the
 * same guard.
 */
function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Whether *this* version of the orientation has already been answered. */
export function hasSeenOnboarding(): boolean {
  try {
    return store()?.getItem(ONBOARDING_KEY) === MARKER
  } catch {
    return false
  }
}

/** Record that it has been answered. Silent when storage refuses. */
export function markOnboardingSeen(): void {
  try {
    store()?.setItem(ONBOARDING_KEY, MARKER)
  } catch {
    // Blocked storage is a legitimate state; see the header.
  }
}

/** Forget it, so the next load is a first run again. */
export function forgetOnboarding(): void {
  try {
    store()?.removeItem(ONBOARDING_KEY)
  } catch {
    // Blocked storage: there is nothing stored to remove.
  }
}
