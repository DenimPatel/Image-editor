import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RETENTION,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_DAY_MS,
  RETENTION_KEY,
  clearRetention,
  describeRetention,
  msUntilExpiry,
  readRetention,
  retentionMs,
  shouldWarn,
  writeRetention,
  type RetentionStorage,
} from './retention'

/**
 * A storage that answers exactly like a browser's, and can be told to stop.
 *
 * Every one of these refusals is a real browser: Safari private mode throws on
 * `setItem`, and a Firefox profile with cookies blocked throws on `getItem`
 * before it throws on `localStorage` itself.
 */
function memoryStorage(): RetentionStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>()
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value)
    },
    removeItem: (key) => {
      raw.delete(key)
    },
  }
}

const blocked = (method: 'getItem' | 'setItem' | 'removeItem'): RetentionStorage => ({
  getItem: method === 'getItem' ? () => null : (key) => memoryStorage().getItem(key),
  setItem: (key) => {
    if (method === 'setItem') throw new DOMException('denied', 'SecurityError')
    memoryStorage().getItem(key)
  },
  removeItem: () => {
    if (method === 'removeItem') throw new DOMException('denied', 'SecurityError')
  },
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('the choice, and the absence of one', () => {
  it('defaults to six months, not to a week', () => {
    // A week is a wall clock that fires on the user who took a week off. Six
    // months is a sentence about this device.
    expect(DEFAULT_RETENTION_DAYS).toBe(180)
    expect(DEFAULT_RETENTION).toBe('180d')
    expect(retentionMs(DEFAULT_RETENTION)).toBe(180 * RETENTION_DAY_MS)
  })

  it('is six months on a browser with no stored choice', () => {
    expect(readRetention({ storage: memoryStorage() })).toBe(DEFAULT_RETENTION)
    expect(readRetention({ storage: null })).toBe(DEFAULT_RETENTION)
  })

  it('round-trips every choice a user can pick', () => {
    const storage = memoryStorage()
    for (const choice of ['7d', '30d', '180d', '3650d', 'forever'] as const) {
      expect(writeRetention(choice, { storage })).toBe(choice)
      expect(readRetention({ storage })).toBe(choice)
    }
  })

  it('a choice stored as a bare string still reads, from a build that wrote one', () => {
    // The first version of this key was the value itself. Reading both shapes is
    // a migration, and it is cheaper than the alternative: a user who chose to
    // keep their work cannot be asked to choose again.
    const storage = memoryStorage()
    storage.setItem(RETENTION_KEY, 'forever')
    expect(readRetention({ storage })).toBe('forever')
    storage.setItem(RETENTION_KEY, JSON.stringify('30d'))
    expect(readRetention({ storage })).toBe('30d')
  })

  it('refuses a value it did not write, rather than acting on it', () => {
    for (const raw of [
      '0d',
      '6d',
      '-1d',
      '1.5d',
      '7',
      '7 days',
      'seven days',
      `${MAX_RETENTION_DAYS + 1}d`,
      'null',
      '42',
      '',
      '"forever "',
      '{',
      '[]',
    ]) {
      const storage = memoryStorage()
      storage.setItem(RETENTION_KEY, raw)
      expect(readRetention({ storage }), raw).toBe(DEFAULT_RETENTION)
    }
  })

  it('will not store a value it refused to read', () => {
    // Otherwise a bad value could be written into the key and then read back as
    // a choice it is not, which is how a policy ends up meaning two things.
    const storage = memoryStorage()
    expect(writeRetention('0d' as never, { storage })).toBe(DEFAULT_RETENTION)
    expect(storage.raw.size).toBe(0)
  })

  it('a refused read or write never throws, and a refused write keeps the old choice', () => {
    expect(() => readRetention({ storage: blocked('getItem') })).not.toThrow()
    expect(readRetention({ storage: blocked('getItem') })).toBe(DEFAULT_RETENTION)

    const storage = blocked('setItem')
    expect(writeRetention('forever', { storage })).toBe('forever')
    expect(() => clearRetention({ storage })).not.toThrow()
    expect(() => readRetention({ storage: blocked('removeItem') })).not.toThrow()
  })

  it('clearing a choice returns the default, and costs nothing that matters', () => {
    const storage = memoryStorage()
    writeRetention('7d', { storage })
    clearRetention({ storage })
    expect(readRetention({ storage })).toBe(DEFAULT_RETENTION)
  })

  it('blocks a horizon shorter than a week and a longer one than a decade', () => {
    expect(MIN_RETENTION_DAYS).toBe(7)
    expect(writeRetention(`${MIN_RETENTION_DAYS}d`, { storage: memoryStorage() })).toBe('7d')
    expect(writeRetention(`${MAX_RETENTION_DAYS}d`, { storage: memoryStorage() })).toBe(
      `${MAX_RETENTION_DAYS}d`,
    )
  })
})

describe('the countdown the card shows', () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0)
  vi.setSystemTime(now)

  it('is the whole horizon a moment after a save', () => {
    expect(msUntilExpiry(now, '180d')).toBe(180 * RETENTION_DAY_MS)
  })

  it('hits zero exactly at the horizon and never goes below it', () => {
    expect(msUntilExpiry(now - 180 * RETENTION_DAY_MS, '180d')).toBe(0)
    expect(msUntilExpiry(now - 180 * RETENTION_DAY_MS - 1, '180d')).toBe(0)
    expect(msUntilExpiry(now - 400 * RETENTION_DAY_MS, '180d')).toBe(0)
  })

  it('is just under a millisecond before the horizon', () => {
    expect(msUntilExpiry(now - 180 * RETENTION_DAY_MS + 1, '180d')).toBe(1)
  })

  it('is no horizon at all for a session the user said to keep', () => {
    // `null` rather than `Infinity`: a card that has to print a duration gets
    // "no deadline" instead of a number it will have to special-case.
    expect(msUntilExpiry(now - 10_000 * RETENTION_DAY_MS, 'forever')).toBeNull()
    expect(retentionMs('forever')).toBeNull()
  })

  it('reports zero for a stamp that cannot exist, rather than guessing', () => {
    for (const stamp of [Number.NaN, Number.POSITIVE_INFINITY, 0 / 0]) {
      expect(msUntilExpiry(stamp, '7d')).toBe(0)
    }
    // A clock that moved backwards mid-save writes a stamp in the future; the
    // session is younger than the horizon, so it is given the whole horizon.
    expect(msUntilExpiry(now + RETENTION_DAY_MS, '7d')).toBe(8 * RETENTION_DAY_MS)
  })

  it('describes the choice in the user’s own terms', () => {
    expect(describeRetention('forever')).toBe('Kept until you discard it')
    expect(describeRetention('7d')).toBe('Kept for 7 days after the last save')
    expect(describeRetention('180d')).toBe('Kept for 180 days after the last save')
  })
})

describe('the last warning, which has to come before the horizon', () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0)
  const day = RETENTION_DAY_MS
  const horizon = 180 * day
  vi.setSystemTime(now)

  it('is silent for a session that is not close to the end', () => {
    expect(shouldWarn(now, '180d', now)).toBe(false)
    expect(shouldWarn(now - (horizon - 4 * day), '180d', now)).toBe(false)
  })

  it('speaks in the last three days, on the day it crosses in', () => {
    expect(shouldWarn(now - (horizon - 3 * day), '180d', now, {})).toBe(true)
    expect(shouldWarn(now - (horizon - 3 * day - 1), '180d', now, {})).toBe(false)
  })

  it('is silent for a session the user said to keep', () => {
    expect(shouldWarn(now - horizon, 'forever', now, {})).toBe(false)
  })

  it('says it once, and again only after a day has passed', () => {
    const warnAt = now - (horizon - day)
    expect(shouldWarn(warnAt, '180d', now, { lastWarnedAt: null })).toBe(true)
    expect(shouldWarn(warnAt, '180d', now, { lastWarnedAt: now - 60_000 })).toBe(false)
    expect(shouldWarn(warnAt, '180d', now, { lastWarnedAt: now - day - 1 })).toBe(true)
  })

  it('repeats itself for a broken stamp rather than trusting it to have warned', () => {
    for (const lastWarnedAt of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(shouldWarn(now - horizon, '180d', now, { lastWarnedAt })).toBe(true)
    }
  })

  it('does not speak for a stamp that is not a number', () => {
    expect(shouldWarn(Number.NaN, '7d', now, {})).toBe(false)
  })
})
