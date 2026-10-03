import {
  DEFAULT_BACKGROUND,
  IDENTITY_CURVE,
  NEUTRAL_ADJUST,
  NEUTRAL_EFFECTS,
  NEUTRAL_HSL,
} from '../../model/defaults'
import {
  DEFAULT_RETENTION_DAYS,
  msUntilExpiry,
  readRetention,
  retentionMs,
} from '../../lib/persist/retention'

/**
 * What the resume card needs in order to be decidable.
 *
 * The card used to offer to restore a session with no picture of what was being
 * restored: a thumbnail, one word and a timestamp. Accepting or discarding that
 * is a guess, and the guess is expensive — discarding throws the user's photo
 * away. So the card is given the three facts that turn it into a decision (how
 * big the photo is, how much has been done to it, how close it is to the
 * retention horizon), and this module is where those facts are derived, because
 * they are pure and `ResumeSessionCard` is presentation.
 *
 * Everything here reads a **stored** document. `resume.doc` is whatever an
 * IndexedDB row or a `localStorage` mirror happened to hold, written by any
 * build that ever shipped, so none of it can be trusted to have the shape a
 * `Doc` type claims. Every read is narrowed by hand and a shape that cannot be
 * read yields `null` rather than a throw — otherwise the card fails to render
 * for the one user who most needs it, because their session was written by a
 * build older than the one asking.
 */

export type ResumeDimensions = { width: number; height: number }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * The retention horizon the card should describe, in days, or `null` when the
 * user chose to keep everything.
 *
 * This used to be a module constant computed from `DEFAULT_RETENTION`, which
 * read the *default* rather than the policy: a card that quoted it was quoting
 * what a browser with no stored choice gets, so any choice actually made in
 * storage — a settings row, a hand-edit, a different build — left the sentence
 * describing a rule the store was not applying. Reading the store's own
 * `readRetention` is what makes the card a projection of the policy rather than
 * a second copy of its default.
 */
function chosenHorizonDays(): number | null {
  const horizon = retentionMs(readRetention())
  return horizon === null ? null : horizon / DAY_MS
}

/**
 * The *default* horizon in days, for the copy's fallback and for `formatAge`'s
 * ladder when there is no stored choice.
 *
 * Derived from the constant rather than typed next to it, so the sentence the
 * card prints cannot be a day away from the policy it is describing.
 */
export const RETENTION_DAYS = DEFAULT_RETENTION_DAYS

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** "Set to something other than the neutral value", which is what an edit is. */
const isSet = (value: unknown): boolean => {
  const number = asNumber(value)
  return number !== null && number !== 0
}

/** A point at the origin, which is what an unset perspective corner is. */
const isOrigin = (point: unknown): boolean => {
  const record = isRecord(point) ? point : null
  return !record || (asNumber(record.x) === 0 && asNumber(record.y) === 0)
}

function hasCrop(geometry: Record<string, unknown>): boolean {
  const crop = isRecord(geometry.crop) ? geometry.crop : null
  if (!crop) return false
  return (
    asNumber(crop.x) !== 0 ||
    asNumber(crop.y) !== 0 ||
    (asNumber(crop.width) ?? 1) !== 1 ||
    (asNumber(crop.height) ?? 1) !== 1
  )
}

function hasOrientation(geometry: Record<string, unknown>): boolean {
  const orientation = isRecord(geometry.orientation) ? geometry.orientation : null
  if (!orientation) return false
  return (
    (asNumber(orientation.quarterTurns) ?? 0) !== 0 ||
    orientation.flipH === true ||
    orientation.flipV === true
  )
}

function hasPerspective(geometry: Record<string, unknown>): boolean {
  const perspective = isRecord(geometry.perspective) ? geometry.perspective : null
  if (!perspective) return false
  return !(
    isOrigin(perspective.topLeft) &&
    isOrigin(perspective.topRight) &&
    isOrigin(perspective.bottomLeft) &&
    isOrigin(perspective.bottomRight)
  )
}

/** Sliders that have moved, counted against the neutral document's values. */
function movedSliders(value: unknown, neutral: Record<string, number>): number {
  const record = isRecord(value) ? value : null
  if (!record) return 0
  return Object.keys(neutral).filter((key) => isSet(record[key])).length
}

function movedHsl(value: unknown): number {
  const record = isRecord(value) ? value : null
  if (!record) return 0
  return Object.keys(NEUTRAL_HSL).filter((key) => {
    const band = isRecord(record[key]) ? record[key] : null
    if (!band) return false
    return isSet(band.hue) || isSet(band.sat) || isSet(band.lum)
  }).length
}

/** Channels whose control points are no longer the two-point identity curve. */
function movedCurves(value: unknown): number {
  const record = isRecord(value) ? value : null
  if (!record) return 0
  return ['rgb', 'r', 'g', 'b'].filter((channel) => {
    const points = asArray(record[channel])
    if (points.length === 0) return false
    if (points.length !== IDENTITY_CURVE.length) return true
    return points.some((point, index) => {
      const reference = IDENTITY_CURVE[index]!
      if (!isRecord(point)) return true
      return asNumber(point.x) !== reference.x || asNumber(point.y) !== reference.y
    })
  }).length
}

/**
 * How many things in the document differ from a photo that was just opened.
 *
 * This counts *what has been touched*, not undo steps, because the card has to
 * describe a document nobody in this tab watched being built. A user who dragged
 * exposure through eleven values made one change, not eleven. The number is
 * therefore the one a person would give if asked how much work is in here,
 * which is the only reason it is worth showing at all.
 *
 * Two things are deliberately not counted. `output` is a decision about the
 * download, not a change to the photo, so counting it would make a freshly
 * imported image look worked-on. `aspectLock` is the ratio picked *during* a
 * crop, so counting it beside the crop would report two changes for one
 * gesture.
 */
export function countEdits(doc: unknown): number {
  if (!isRecord(doc)) return 0
  const geometry = isRecord(doc.geometry) ? doc.geometry : {}
  const retouch = isRecord(doc.retouch) ? doc.retouch : {}
  const background = isRecord(doc.background) ? doc.background : {}
  const look = isRecord(doc.look) ? doc.look : null
  const effects = isRecord(doc.effects) ? doc.effects : {}

  return (
    movedSliders(doc.adjust, NEUTRAL_ADJUST) +
    movedHsl(doc.hsl) +
    movedCurves(doc.curves) +
    (look && look.id !== null && look.id !== undefined ? 1 : 0) +
    movedSliders(effects, NEUTRAL_EFFECTS) +
    asArray(doc.masks).length +
    asArray(doc.localAdjusts).length +
    asArray(retouch.healSpots).length +
    asArray(retouch.redEye).length +
    (isSet(retouch.smooth) ? 1 : 0) +
    (background.removed === true ? 1 : 0) +
    (background.mode !== undefined && background.mode !== DEFAULT_BACKGROUND.mode ? 1 : 0) +
    (isSet(background.blur) ? 1 : 0) +
    asArray(doc.layers).length +
    (doc.passport !== null && doc.passport !== undefined ? 1 : 0) +
    (hasOrientation(geometry) || isSet(geometry.straighten) || hasPerspective(geometry) ? 1 : 0) +
    (hasCrop(geometry) ? 1 : 0)
  )
}

/**
 * The `Doc` fields `countEdits` reads.
 *
 * Exported so the test that keeps this honest reads the same list rather than
 * restating it. A field added to `Doc` and never counted here is a change the
 * card silently under-reports, and `resumeSummary.test.ts` scans `Doc` itself
 * to fail on exactly that.
 */
export const countedDocKeys: readonly string[] = [
  'adjust',
  'curves',
  'hsl',
  'look',
  'effects',
  'geometry',
  'masks',
  'localAdjusts',
  'retouch',
  'background',
  'layers',
  'passport',
]

/**
 * The `Doc` fields `countEdits` reads nothing from, and why: `source` is the
 * photo, `identity` and `schema` are provenance, and `output` is a decision
 * about the download. A session can hold all four and still hold no edits, which
 * is the case the card has to be able to say out loud.
 */
export const uncountedDocKeys: readonly string[] = ['source', 'identity', 'schema', 'output']

/** The decoded pixel size of the photo the session was opened on. */
export function resumeDimensions(doc: unknown): ResumeDimensions | null {
  if (!isRecord(doc) || !isRecord(doc.source)) return null
  const width = asNumber(doc.source.width)
  const height = asNumber(doc.source.height)
  if (width === null || height === null || width <= 0 || height <= 0) return null
  return { width: Math.round(width), height: Math.round(height) }
}

/**
 * How long the session is kept, in milliseconds, measured from its last save.
 *
 * Nothing deletes a session now — `loadSession` offers a row whatever its age —
 * so this is a horizon the card counts down to rather than a deadline something
 * is about to enforce. `null` is the answer for a session the user has said to
 * keep, and a caller that renders a duration has to say what it will show when
 * there is none; that is why this is not clamped-and-returned, and why the
 * arithmetic is the store's own, so the sentence and the behaviour cannot
 * disagree.
 */
export function msUntilExpired(updatedAt: number, now: number = Date.now()): number | null {
  return msUntilExpiry(updatedAt, readRetention(), now)
}

/**
 * How long ago the session was last saved, in words.
 *
 * The exact timestamp goes in the `title` attribute instead of the body, because
 * "saved 3 hours ago" is what answers the question and "18:42:07" is what a
 * sceptic needs — and the second one costs a line of a card that has three lines
 * to spend. Every step here is one a person would actually say, and the ladder
 * is short on purpose: the useful question is "is this from now or from last
 * week", and six buckets answer it without a user having to do arithmetic.
 */
export function formatAge(updatedAt: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 2) return 'a minute ago'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 2) return 'an hour ago'
  if (hours < 24) return `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days < 2) return 'yesterday'
  // The ladder stops counting days and names the horizon instead, so the number
  // in the sentence is the policy rather than a literal. A user who chose to keep
  // everything has no horizon, so there is nothing to name and it keeps counting.
  const horizon = chosenHorizonDays() ?? Number.POSITIVE_INFINITY
  if (days < horizon) return `${days} days ago`
  return `over ${horizon} days ago`
}

/**
 * The countdown half of the retention line, in the same ladder of words.
 *
 * Rounded rather than floored, because "in about 5 hours" on a session with five
 * hours and fifty-nine minutes left is the sentence that would make somebody put
 * the laptop away for the weekend, and the word "about" is what licenses the
 * rounding.
 */
export function formatRemaining(remainingMs: number): string {
  const hours = remainingMs / HOUR_MS
  if (hours < 1) return 'in under an hour'
  if (hours < 24) {
    const count = Math.round(hours)
    return `in about ${count} ${count === 1 ? 'hour' : 'hours'}`
  }
  const days = Math.round(hours / 24)
  return `in about ${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * The card's fact line: "4032 × 6048 · 6 edits · saved 3 hours ago".
 *
 * Each fragment is dropped rather than guessed when the session cannot answer
 * it, so a card built from a document an older build wrote reads "6 edits ·
 * saved 3 hours ago" instead of claiming a size it never stored. The edit count
 * is never dropped: zero edits is a fact, and "0 edits" is the sentence that
 * tells someone this card is safe to dismiss.
 */
export function resumeFacts(doc: unknown, updatedAt: number, now: number = Date.now()): string {
  const dimensions = resumeDimensions(doc)
  const edits = countEdits(doc)
  const parts: string[] = []
  if (dimensions) parts.push(`${dimensions.width} × ${dimensions.height}`)
  parts.push(`${edits} ${edits === 1 ? 'edit' : 'edits'}`)
  parts.push(`saved ${formatAge(updatedAt, now)}`)
  return parts.join(' · ')
}

/**
 * The card's second line: what the retention horizon will do, before the user
 * chooses.
 *
 * What it will *not* say is that the session is about to be deleted, because it
 * is not: nothing is deleted on a read any more. The horizon is a policy the
 * user can see, change and keep forever with, and the honest sentence names it
 * rather than warning about a destruction that does not happen. The only thing
 * that ever deletes this photo and its edits is the Discard button the card
 * offers right beside this line — which is why both halves are named here, so
 * that pressing it is a decision and not a surprise.
 */
export function retentionLine(updatedAt: number, now: number = Date.now()): string {
  const horizon = chosenHorizonDays()
  if (horizon === null) {
    return 'Kept on this device until you discard it, photo and the edits together.'
  }
  const owned =
    'Nothing removes it on its own — it goes when you press Discard, photo and the edits together.'
  const kept = `Kept for ${horizon} days after the last save.`
  // Past the horizon, which is a state of its own and used to be counted as
  // "less than a day left". `msUntilExpiry` clamps a negative remainder to 0, so
  // the countdown below rendered "that is in under an hour" for a session that
  // has no time left at all — a timer reading zero on something with no timer
  // behind it, promising a deletion nothing performs. Confirmed in a real
  // browser by ageing a stored row past the horizon.
  //
  // `expiresAt` is `retentionMs(readRetention())` added to the stamp, which is
  // what `chosenHorizonDays` divided in order to render days. It is compared
  // rather than read back off `msUntilExpired`, so a stamp that is not a number
  // fails the comparison instead of being called expired.
  const expiresAt = updatedAt + horizon * DAY_MS
  if (expiresAt <= now) {
    return `Past its horizon — nothing deletes it, so Discard is the only thing that will. ${kept} It goes when you press Discard, photo and the edits together.`
  }
  const remaining = msUntilExpired(updatedAt, now)
  // `> 0` because `msUntilExpiry` reports a stamp it cannot read as 0 as well,
  // and "in under an hour" is a claim about a session whose age is unknown.
  if (remaining !== null && remaining > 0 && remaining < DAY_MS) {
    return `Less than a day left — that is ${formatRemaining(remaining)}. ${kept} ${owned}`
  }
  return `${kept} ${owned}`
}
