import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_BACKGROUND,
  DEFAULT_GEOMETRY,
  IDENTITY_CURVES,
  NEUTRAL_ADJUST,
  NEUTRAL_EFFECTS,
  NEUTRAL_HSL,
  NEUTRAL_LOOK,
  NEUTRAL_RETOUCH,
  createDoc,
} from '../../model/defaults'
import type { Adjust, Curves, Geometry, HslMix, Look } from '../../model/types'
import {
  DEFAULT_RETENTION,
  DEFAULT_RETENTION_DAYS,
  retentionMs,
  writeRetention,
} from '../../lib/persist/retention'
import {
  RETENTION_DAYS,
  countedDocKeys,
  countEdits,
  formatAge,
  formatRemaining,
  msUntilExpired,
  resumeDimensions,
  resumeFacts,
  retentionLine,
  uncountedDocKeys,
} from './resumeSummary'

/**
 * `createDoc` takes a whole `Doc`, so each helper below is a complete document
 * with one block changed. Building them this way rather than hand-writing the
 * partials is what keeps the count assertions honest: a neutral document is the
 * baseline, and anything the helpers leave alone must contribute nothing.
 */
const withAdjust = (adjust: Partial<Adjust>) =>
  createDoc({ adjust: { ...NEUTRAL_ADJUST, ...adjust } })
const withCurves = (curves: Partial<Curves>) =>
  createDoc({ curves: { ...IDENTITY_CURVES, ...curves } })
const withHsl = (hsl: Partial<HslMix>) => createDoc({ hsl: { ...NEUTRAL_HSL, ...hsl } })
const withLook = (look: Partial<Look>) => createDoc({ look: { ...NEUTRAL_LOOK, ...look } })
const withGeometry = (geometry: Partial<Geometry>) =>
  createDoc({ geometry: { ...DEFAULT_GEOMETRY, ...geometry } })
const spot = (id: string) => ({ id, at: { x: 0.5, y: 0.5 }, radius: 8 })

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8')

const DAY = 24 * 60 * 60 * 1000
const HOUR = (n: number) => n * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0)

/**
 * The card reads the *stored* retention choice, so a test that writes one has to
 * put it back. Without this, whichever test wrote `forever` last would silently
 * decide the answer for the rest of the file.
 */
afterEach(() => {
  localStorage.clear()
})

describe('the retention copy is the store’s retention, not a memory of it', () => {
  it('reads the horizon rather than restating it, so there is only one number', () => {
    // This module used to declare `MAX_AGE_MS = 7 * DAY_MS` and have this test
    // scrape both files and compare the literals — which is one edit away from
    // the card promising a horizon the store was not applying. It imports now,
    // so the assertion is an identity: the card's days *are* the store's days.
    // If this ever needs a file read again, the import has been undone.
    expect(retentionMs(DEFAULT_RETENTION)).toBe(RETENTION_DAYS * DAY)
    expect(RETENTION_DAYS).toBe(DEFAULT_RETENTION_DAYS)
    // `retention.ts` owns the policy, and it is the default a browser with no
    // stored choice gets: the same value `loadSession` and the mirror's age cap
    // ask for.
    expect(RETENTION_DAYS).toBe(180)
  })

  it('says what actually happens, which is that nothing is deleted on a read', () => {
    // The claim on the card is that a horizon exists and that only Discard
    // deletes, so the store has to match: `loadSession` must contain no delete
    // at all, and the one deletion path has to take the row *and* the bytes.
    // Asserted against the source because the behaviour lives in a store this
    // test does not own, and the alternative — trusting the copy — is the exact
    // failure this line is here to catch.
    const source = read('src/lib/persist/session.ts')
    const load = source.slice(
      source.indexOf('export async function loadSession'),
      source.indexOf('/**', source.indexOf('export async function loadSession')),
    )
    expect(load).not.toContain('delete(')
    expect(load).not.toContain('MAX_AGE_MS')
    const forget = source.slice(source.indexOf('export async function forgetSession'))
    expect(forget).toContain('clearSession')
    // Both object stores, in the one function that deletes either of them.
    const clear = source.slice(source.indexOf('export async function clearSession'))
    expect(clear).toContain("delete('sessions'")
    expect(clear).toContain("delete('assets'")
  })

  it('counts down in the user’s units, and never below zero', () => {
    expect(msUntilExpired(NOW, NOW)).toBe(RETENTION_DAYS * DAY)
    expect(msUntilExpired(NOW - 6 * DAY, NOW)).toBe((RETENTION_DAYS - 6) * DAY)
    expect(msUntilExpired(NOW - (RETENTION_DAYS + 1) * DAY, NOW)).toBe(0)
    expect(msUntilExpired(Number.NaN, NOW)).toBe(0)
  })

  it('has no countdown at all for a session the user said to keep', () => {
    // `null`, not a very large number. A caller that renders a duration has to
    // say what it shows when there is none, and that is only possible if the
    // absence is distinguishable from a horizon of zero.
    writeRetention('forever')
    expect(msUntilExpired(NOW, NOW)).toBeNull()
    expect(msUntilExpired(NOW - 900 * DAY, NOW)).toBeNull()
  })
})

describe('the retention line changes shape before the horizon bites', () => {
  it('names the policy while there is time, without promising a deletion', () => {
    const line = retentionLine(NOW, NOW)
    expect(line).toContain('180 days after the last save')
    // The part that used to be missing: what *stops* the session being taken
    // away. A horizon with no owner is a countdown the user cannot answer, and
    // the old copy only named the horizon.
    expect(line).toContain('Nothing removes it on its own')
    expect(line).toContain('press Discard')
    expect(line).toContain('photo and the edits together')
    // The sentence the old copy used, and the one thing it must never say
    // again: nothing deletes this session on a read any more.
    expect(line).not.toMatch(/are deleted/)
  })

  it('counts down once there is less than a day', () => {
    const line = retentionLine(NOW - (RETENTION_DAYS * DAY - 6 * 60 * 60 * 1000), NOW)
    expect(line).toContain('Less than a day left')
    expect(line).toContain('in about 6 hours')
    // The countdown branch said nothing about what actually deletes a session,
    // so it read as a timer running down whether the user acted or not.
    expect(line).toContain('Nothing removes it on its own')
    expect(line).toContain('photo and the edits together')
  })

  it('says the session is past its horizon rather than counting down to nothing', () => {
    // The countdown branch used to swallow this case. `msUntilExpiry` clamps a
    // negative remainder to 0, so a row saved eight days past a seven-day
    // horizon read "Less than a day left — that is in under an hour", which is a
    // timer about to fire on something with no timer behind it. Confirmed in a
    // real browser by ageing the stored row.
    writeRetention('7d')
    const line = retentionLine(NOW - 8 * DAY, NOW)
    expect(line).toContain('Past its horizon')
    expect(line).not.toContain('Less than a day left')
    expect(line).not.toContain('in under an hour')
    // Still names the policy the reader is choosing under, and still names the
    // one control that actually removes anything.
    expect(line).toContain('Kept for 7 days after the last save.')
    expect(line).toContain('Discard is the only thing that will')
    expect(line).toContain('photo and the edits together')
  })

  it('applies it at the default horizon too, and never to a user with no horizon', () => {
    const line = retentionLine(NOW - (RETENTION_DAYS + 1) * DAY, NOW)
    expect(line).toContain('Past its horizon')
    expect(line).toContain('180 days after the last save.')
    // `forever` has no horizon to be past. The branch reads the same clock, so
    // this is the assertion that it cannot fire for a user who asked for no
    // horizon — which is the case the old countdown got exactly wrong.
    writeRetention('forever')
    expect(retentionLine(NOW - 900 * DAY, NOW)).not.toContain('Past its horizon')
  })

  it('does not count down for a stamp it cannot read', () => {
    // `msUntilExpiry` reports a non-finite stamp as 0, which read as "in under
    // an hour" on a session whose age the card does not know. No countdown is the
    // honest sentence; the policy line is still true.
    const line = retentionLine(Number.NaN, NOW)
    expect(line).not.toContain('in under an hour')
    expect(line).not.toContain('Past its horizon')
    expect(line).toContain('180 days after the last save.')
  })

  it('describes the horizon the user chose, not the default one', () => {
    // The card used to quote `DEFAULT_RETENTION` whatever was in storage, so a
    // choice that had been made — by a settings row, a hand-edit, another build —
    // left the sentence describing a rule the store was not applying. This is the
    // defect the import was supposed to remove, and reading the default does not.
    writeRetention('30d')
    const line = retentionLine(NOW, NOW)
    expect(line).toContain('Kept for 30 days after the last save.')
    expect(line).not.toContain('180 days')
  })

  it('says there is no horizon at all when the user asked for none', () => {
    writeRetention('forever')
    expect(retentionLine(NOW - 900 * DAY, NOW)).toBe(
      'Kept on this device until you discard it, photo and the edits together.',
    )
  })

  it('does not say "in about 0 hours" for a session inside its last hour', () => {
    expect(formatRemaining(30 * 60 * 1000)).toBe('in under an hour')
    expect(formatRemaining(HOUR(1))).toBe('in about 1 hour')
    expect(formatRemaining(HOUR(2))).toBe('in about 2 hours')
    expect(formatRemaining(HOUR(36))).toBe('in about 2 days')
  })
})

describe('the age reads as a person would say it', () => {
  it('uses one bucket per answer, not a duration', () => {
    expect(formatAge(NOW, NOW)).toBe('just now')
    expect(formatAge(NOW - 20_000, NOW)).toBe('just now')
    expect(formatAge(NOW - 70_000, NOW)).toBe('a minute ago')
    expect(formatAge(NOW - 9 * 60_000, NOW)).toBe('9 minutes ago')
    expect(formatAge(NOW - HOUR(1.2), NOW)).toBe('an hour ago')
    expect(formatAge(NOW - HOUR(5), NOW)).toBe('5 hours ago')
    expect(formatAge(NOW - HOUR(30), NOW)).toBe('yesterday')
    expect(formatAge(NOW - DAY * 3, NOW)).toBe('3 days ago')
    expect(formatAge(NOW - DAY * 9, NOW)).toBe('9 days ago')
    // Past the horizon the ladder stops counting days and names the horizon
    // itself, so the number is the policy rather than a literal.
    expect(formatAge(NOW - (RETENTION_DAYS + 1) * DAY, NOW)).toBe(`over ${RETENTION_DAYS} days ago`)
  })

  it('keeps counting days for a user who asked to keep everything', () => {
    // "over 180 days ago" names a horizon this user does not have. There is
    // nothing to be past, so the ladder has to go on counting.
    writeRetention('forever')
    expect(formatAge(NOW - (RETENTION_DAYS + 1) * DAY, NOW)).toBe('181 days ago')
    expect(formatAge(NOW - DAY * 900, NOW)).toBe('900 days ago')
  })
})

describe('the fact line answers "what am I about to reopen"', () => {
  it('gives the size, the work and the age together', () => {
    const doc = createDoc({
      source: { assetId: 'asset_1', width: 4032, height: 6048, name: 'a.jpg', mime: 'image/jpeg' },
      adjust: { ...NEUTRAL_ADJUST, exposure: 1.4 },
    })
    expect(resumeFacts(doc, NOW - HOUR(3), NOW)).toBe('4032 × 6048 · 1 edit · saved 3 hours ago')
  })

  it('says "0 edits" rather than nothing, because that is the useful answer', () => {
    const doc = createDoc({
      source: { assetId: 'asset_1', width: 800, height: 600, name: 'a.jpg', mime: 'image/jpeg' },
    })
    expect(resumeFacts(doc, NOW, NOW)).toBe('800 × 600 · 0 edits · saved just now')
  })

  it('drops the size rather than inventing one it cannot read', () => {
    // A session written by a build that stored no source block. The card must
    // say what it knows, not what it assumes.
    expect(resumeFacts({ adjust: { exposure: 1 } }, NOW, NOW)).toBe('1 edit · saved just now')
    expect(resumeDimensions({})).toBeNull()
    expect(resumeDimensions({ source: { width: 0, height: 10 } })).toBeNull()
  })

  it('reads nothing rather than throwing on a shape it does not know', () => {
    for (const doc of [null, undefined, 'nope', 42, [], { source: 'nope' }]) {
      expect(resumeDimensions(doc)).toBeNull()
      expect(resumeFacts(doc, NOW, NOW)).toBe('0 edits · saved just now')
    }
  })

  it('survives a doc whose nested blocks are the wrong type', () => {
    // A hand-edited mirror, or a row written by a build that changed a shape.
    // Throwing here would take down the one screen the user needs.
    const hostile = {
      source: { width: '10', height: null },
      adjust: 'moved',
      curves: { r: 'nope' },
      hsl: { red: 4 },
      geometry: { crop: 3, orientation: null },
      masks: 'none',
      retouch: { healSpots: null },
      layers: 7,
    }
    expect(countEdits(hostile)).toBe(0)
    expect(resumeDimensions(hostile)).toBeNull()
    expect(resumeFacts(hostile, NOW, NOW)).toBe('0 edits · saved just now')
  })
})

describe('countEdits counts what was touched, not what was done', () => {
  it('is zero for a photo that has just been opened', () => {
    expect(countEdits(createDoc())).toBe(0)
    expect(countEdits(withAdjust({ exposure: 0 }))).toBe(0)
    expect(countEdits(withLook({ id: null }))).toBe(0)
    expect(countEdits(null)).toBe(0)
  })

  it('is one for a change, however many values were dragged past on the way', () => {
    // The slider was dragged through a hundred values on the way to 0.9; the
    // user would still say they made one change.
    expect(countEdits(withAdjust({ exposure: 0.9 }))).toBe(1)
  })

  it('counts each moved slider, each touched curve channel and each HSL band', () => {
    expect(countEdits(withAdjust({ exposure: 1, contrast: -1, saturation: 0 }))).toBe(2)
    expect(countEdits(withCurves({ r: [{ x: 0.5, y: 0.6 }] }))).toBe(1)
    expect(countEdits(withHsl({ red: { hue: 12, sat: 0, lum: 0 } }))).toBe(1)
  })

  it('counts geometry as one gesture, not one property', () => {
    expect(countEdits(withGeometry({ straighten: 4 }))).toBe(1)
    expect(
      countEdits(withGeometry({ orientation: { quarterTurns: 1, flipH: true, flipV: false } })),
    ).toBe(1)
    expect(
      countEdits(withGeometry({ orientation: { quarterTurns: 0, flipH: false, flipV: true } })),
    ).toBe(1)
    expect(
      countEdits(
        withGeometry({
          perspective: { ...DEFAULT_GEOMETRY.perspective, topRight: { x: 10, y: 0 } },
        }),
      ),
    ).toBe(1)
    // Straightened *and* cropped is two gestures, and reports as two.
    expect(
      countEdits(withGeometry({ straighten: 2, crop: { x: 0.1, y: 0, width: 0.8, height: 1 } })),
    ).toBe(2)
  })

  it('does not count a ratio lock as a second edit for the crop it was picked for', () => {
    expect(countEdits(withGeometry({ aspectLock: 1 }))).toBe(0)
    expect(
      countEdits(withGeometry({ aspectLock: 1, crop: { x: 0, y: 0, width: 0.5, height: 1 } })),
    ).toBe(1)
  })

  it('counts the look, healed spots, smoothing and grain once each', () => {
    const doc = createDoc({
      look: { ...NEUTRAL_LOOK, id: 'warm-01', amount: 0.6 },
      retouch: { ...NEUTRAL_RETOUCH, healSpots: [spot('a'), spot('b')], smooth: 0.5 },
      effects: { ...NEUTRAL_EFFECTS, grain: 12 },
    })
    expect(countEdits(doc)).toBe(5)
  })

  it('counts a removed background once, and its blur separately', () => {
    expect(countEdits(createDoc({ background: DEFAULT_BACKGROUND }))).toBe(0)
    expect(
      countEdits(createDoc({ background: { ...DEFAULT_BACKGROUND, removed: true, blur: 0 } })),
    ).toBe(1)
    expect(
      countEdits(createDoc({ background: { ...DEFAULT_BACKGROUND, removed: true, blur: 0.4 } })),
    ).toBe(2)
  })

  it('counts masks and layers by how many there are', () => {
    expect(
      countEdits(
        createDoc({
          masks: [
            {
              id: 'm1',
              kind: 'linear',
              enabled: true,
              feather: 0,
              from: { x: 0, y: 0 },
              to: { x: 1, y: 1 },
            },
            { id: 'm2', kind: 'subject', enabled: true, feather: 0 },
          ],
        }),
      ),
    ).toBe(2)
  })

  it('reads a session written by an older build without inventing edits', () => {
    // No `adjust` block at all, and a `geometry` that predates `straighten`.
    const legacy = {
      source: { width: 10, height: 20 },
      geometry: { crop: { x: 0, y: 0, width: 1, height: 1 } },
    }
    expect(countEdits(legacy)).toBe(0)
    expect(resumeDimensions(legacy)).toEqual({ width: 10, height: 20 })
  })
})

describe('every field of Doc is accounted for, counted or deliberately not', () => {
  it('has no field the card silently ignores', () => {
    // The rot this stops: a new `Doc` field that records work, added without
    // being counted, and the card under-reports the session for every user from
    // that build onwards. It cannot be noticed by reading the card.
    const source = read('src/model/types.ts')
    const start = source.indexOf('export type Doc = {')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n}', start))
    const keys = [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1] as string)
    expect(keys.length).toBeGreaterThan(10)

    const accounted = new Set([...countedDocKeys, ...uncountedDocKeys])
    expect(keys.filter((key) => !accounted.has(key))).toEqual([])
    // And the two lists do not overlap, so a field cannot be claimed both ways.
    expect(countedDocKeys.filter((key) => uncountedDocKeys.includes(key))).toEqual([])
  })
})
