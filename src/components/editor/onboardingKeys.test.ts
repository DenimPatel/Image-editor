import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ONBOARDING_KEY,
  ONBOARDING_VERSION,
  forgetOnboarding,
  hasSeenOnboarding,
  markOnboardingSeen,
} from './onboardingKeys'

/**
 * The marker is one key and one character, and this is the file that holds both
 * claims. Both matter for different reasons: the version is what stops a
 * rewritten orientation from inheriting an answer given to the previous one, and
 * the bound is what stops this from becoming the JSON-blob storage layout every
 * first-run feature eventually drifts into.
 */

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the first-run marker is versioned', () => {
  it('carries the version in the key and in the value', () => {
    expect(ONBOARDING_KEY).toBe(`ie-onboarding-v${ONBOARDING_VERSION}`)
    markOnboardingSeen()
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe(`${ONBOARDING_VERSION}`)
  })

  it('does not answer for a different version of the copy', () => {
    // A value left behind by an older build, under this build's key.
    window.localStorage.setItem(ONBOARDING_KEY, '0')
    expect(hasSeenOnboarding()).toBe(false)
    markOnboardingSeen()
    expect(hasSeenOnboarding()).toBe(true)
  })

  it('reads anything it did not write as not seen', () => {
    for (const value of ['', 'true', 'yes', '2', '1 ', '{}']) {
      window.localStorage.setItem(ONBOARDING_KEY, value)
      expect(hasSeenOnboarding(), value).toBe(false)
    }
  })

  it('is gone after it is forgotten', () => {
    markOnboardingSeen()
    expect(hasSeenOnboarding()).toBe(true)
    forgetOnboarding()
    expect(hasSeenOnboarding()).toBe(false)
  })
})

describe('the first-run marker is bounded', () => {
  it('writes one key holding one character, and nothing else', () => {
    markOnboardingSeen()
    expect(Object.keys(window.localStorage)).toEqual([ONBOARDING_KEY])
    const written = window.localStorage.getItem(ONBOARDING_KEY) as string
    // Bounded in bytes as well as in shape: the payload cannot grow into a
    // document even by accident, because there is nothing in it to grow.
    expect(written.length).toBeLessThanOrEqual(8)
  })

  it('never grows on a second dismissal', () => {
    markOnboardingSeen()
    const first = window.localStorage.length
    markOnboardingSeen()
    markOnboardingSeen()
    expect(window.localStorage.length).toBe(first)
    expect(Object.keys(window.localStorage)).toHaveLength(1)
  })
})

describe('storage that refuses is a state, not a crash', () => {
  it('reports not seen when reading throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('does not throw when the write is refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => markOnboardingSeen()).not.toThrow()
    // And it refuses to remember: a marker that was never written must not be
    // reported as written, or the orientation would be gone for good.
    expect(hasSeenOnboarding()).toBe(false)
  })

  it('does not throw when the removal is refused', () => {
    markOnboardingSeen()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => forgetOnboarding()).not.toThrow()
    expect(hasSeenOnboarding()).toBe(true)
  })
})
