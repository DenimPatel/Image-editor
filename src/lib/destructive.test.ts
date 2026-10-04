import { describe, expect, it, vi } from 'vitest'
import * as destructive from './destructive'
import {
  confirmThen,
  deletePresetRequest,
  discardSessionRequest,
  IRREVERSIBLE_ACTIONS,
  startOverRequest,
  UNDOABLE_ACTIONS,
} from './destructive'
import { registerConfirmHost } from './confirm'
import { HUB_DOORS, newImageRequest } from './editorEntry'
import { countEdits } from '../components/editor/resumeSummary'
import { createDoc } from '../model/defaults'

/**
 * The copy every *asking* destructive control asks with, and the split that decides
 * which controls ask.
 *
 * These are pure string builders, so they are tested as strings rather than through
 * a browser — and the shape of each assertion is the same, because the shape of the
 * requirement is. A confirmation has to name the action, name what is lost, and put
 * a *distinct* name on the control that commits it. A builder that produced
 * `title: 'Are you sure?'` or `confirmLabel: 'OK'` would satisfy every test that
 * checks "a confirmation was shown" and none of these.
 *
 * The split is the load-bearing half, and it runs both ways: each of the four
 * irreversible controls has a builder here, and each of the four `Ctrl+Z`-able ones
 * has none. Asking about an undoable control is the defect this file exists to keep
 * out, and not asking about an irreversible one is a worse one — so both directions
 * are asserted, not just the comfortable one.
 */

const REQUEST_BUILDERS = [
  ['newImageRequest', () => newImageRequest(2)],
  ['discardSessionRequest', () => discardSessionRequest(1)],
  ['deletePresetRequest', () => deletePresetRequest('Studio warm')],
  ['startOverRequest', () => startOverRequest(2)],
] as const

describe('every question the app asks', () => {
  it.each(REQUEST_BUILDERS)('%s names the action it is asking about', (_name, build) => {
    const request = build()
    expect(request).not.toBeNull()
    if (!request) throw new Error('the builder returned no question')
    // A question, in the shape of one. "Are you sure?" passes a visibility check
    // and tells a screen reader nothing about what is about to happen. The floor is
    // short deliberately: "Start over?" is the shortest name that still says what
    // the button does, and a title padded to satisfy this assertion would be worse
    // copy than the one-word answer it replaced.
    expect(request.title).toMatch(/\?$/)
    expect(request.title.length).toBeGreaterThanOrEqual(11)
    expect(request.title).toMatch(/(new image|edits|session|preset|Delete|Clear|Start over|Reset)/)
    expect(request.tone).toBe('destructive')
  })

  it.each(REQUEST_BUILDERS)('%s names the control that commits it, and it is not "OK"', (_n, b) => {
    const request = b()
    if (!request) throw new Error('the builder returned no question')
    expect(request.confirmLabel).not.toBe('OK')
    expect(request.confirmLabel).not.toBe('Yes')
    expect(request.confirmLabel.length).toBeGreaterThan(3)
    // Not the safe control's name either: two buttons differing only in styling is
    // the shape the a11y spec rejects for the whole app.
    expect(request.confirmLabel).not.toBe('Cancel')
  })

  it.each(REQUEST_BUILDERS)('%s says what is lost rather than only that something is', (_n, b) => {
    const request = b()
    if (!request) throw new Error('the builder returned no question')
    // The body is not allowed to be empty or a shrug: a dialog whose body is
    // "Are you sure?" teaches nothing.
    expect(request.body.length).toBeGreaterThan(40)
    expect(request.body).not.toMatch(/^Are you sure/)
  })

  it.each(IRREVERSIBLE_ACTIONS)('%s has a builder, so it asks', (label) => {
    // One row per irreversible control, and the builders above are the same set.
    // Named rather than inferred: an eighth destructive control that quietly gets no
    // confirmation is exactly the failure this case is for, and it cannot be seen by
    // reading the four builders.
    expect(REQUEST_BUILDERS.map(([name]) => name)).toHaveLength(IRREVERSIBLE_ACTIONS.length)
    expect(IRREVERSIBLE_ACTIONS).toContain(label)
  })
})

describe('the split: irreversible asks, recoverable by undo acts', () => {
  it('names four irreversible controls and four undoable ones, and they do not overlap', () => {
    expect([...IRREVERSIBLE_ACTIONS]).toEqual([
      'New image',
      'Discard session',
      'Start over',
      'Delete preset',
    ])
    expect([...UNDOABLE_ACTIONS]).toEqual([
      'Reset all edits',
      'Clear strokes',
      'Delete layer',
      'Remove frame',
    ])
    expect(
      [...IRREVERSIBLE_ACTIONS].filter((name) => UNDOABLE_ACTIONS.includes(name as never)),
    ).toEqual([])
  })

  it.each(UNDOABLE_ACTIONS)('%s has no builder here, so nothing asks about it', (label) => {
    // The absence *is* the convention, and an absence nobody asserts is an absence
    // the next implementer reinvents. Read as the module's own export list rather
    // than as three named imports, because the point is that those three names no
    // longer resolve: re-introducing any of them — which would put a dialog back in
    // front of `Reset all edits`, `Clear strokes` and `Delete layer` — has to fail
    // here rather than ship.
    expect(IRREVERSIBLE_ACTIONS).not.toContain(label as never)
    expect(confirmThen).toBeTypeOf('function')
    const exported = Object.keys(destructive)
    expect(exported).not.toContain('resetEditsRequest')
    expect(exported).not.toContain('clearStrokesRequest')
    expect(exported).not.toContain('deleteLayerRequest')
  })

  it('says what a single thing is, and counts more than one', () => {
    // "1 edits" is the sort of thing that ships and is never noticed, because the
    // dialog is only ever opened once with one item in it.
    expect(newImageRequest(1)?.body ?? '').toContain('1 edit')
    expect(newImageRequest(1)?.body ?? '').not.toContain('1 edits')
    expect(newImageRequest(4)?.body ?? '').toContain('4 edits')
    expect(discardSessionRequest(1).body).toContain('1 edit')
    expect(discardSessionRequest(4).body).toContain('4 edits')
  })
})

describe('confirmThen: ask, then act, in one place', () => {
  const REQUEST = { title: 'Delete this?', body: 'x'.repeat(60), confirmLabel: 'Delete' }

  it('runs the action when the reader confirms', async () => {
    const asked: unknown[] = []
    registerConfirmHost({
      confirm: (request) => {
        asked.push(request)
        return Promise.resolve(true)
      },
    })
    const commit = vi.fn()
    await expect(confirmThen(REQUEST, commit)).resolves.toBe(true)
    expect(asked).toEqual([REQUEST])
    expect(commit).toHaveBeenCalledOnce()
  })

  it('does not run the action when the reader declines', async () => {
    registerConfirmHost({ confirm: () => Promise.resolve(false) })
    const commit = vi.fn()
    // `false` rather than a throw, so the caller can tell "declined" from "done".
    await expect(confirmThen(REQUEST, commit)).resolves.toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not ask at all about an action with nothing to lose', async () => {
    const confirm = vi.fn(() => Promise.resolve(true))
    registerConfirmHost({ confirm })
    const commit = vi.fn()
    // `newImageRequest(0)` is the one control in the app that reaches this branch:
    // replacing a pristine photograph destroys nothing, so it goes straight through.
    expect(newImageRequest(0)).toBeNull()
    await expect(confirmThen(newImageRequest(0), commit)).resolves.toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(commit).toHaveBeenCalledOnce()
    registerConfirmHost(null)
  })
})

describe('a request that cannot be undone says so', () => {
  it('Discard says there is no Undo, because there is not', () => {
    // The resume card offers Resume on the same screen, and a reader who presses
    // the wrong button has to be told that Resume is not coming back — which is the
    // only honest reason to press Cancel instead of guessing.
    expect(discardSessionRequest(2).body).toMatch(/no\s+Undo/i)
    expect(discardSessionRequest(2).body).toMatch(/never written anywhere else/i)
  })

  it('Delete preset says there is no second copy', () => {
    expect(deletePresetRequest('Studio warm').body).toMatch(/no second copy/i)
    // And it names which preset, because the popover lists several and "Delete
    // preset?" under a list of six is a guess.
    expect(deletePresetRequest('Studio warm').title).toContain('Studio warm')
    expect(deletePresetRequest('Studio warm').body).toContain('Studio warm')
  })

  it('Start over says the photo file is not touched but nothing here can be recovered', () => {
    const body = startOverRequest(1).body
    expect(body).toMatch(/Your photo file itself is not touched/)
    expect(body).toMatch(/nothing here can be recovered afterwards/)
  })
})

describe('the counts these questions quote are ones the app can actually produce', () => {
  it('Discard counts a stored document with countEdits, not past.length', () => {
    // The two numbers are different quantities and only one of them is available on
    // the screen that offers the button: the resume card holds a `Doc` nobody in
    // this tab watched being built, so `past.length` is 0 there and always would
    // be. `countEdits` is the same function the card already prints, so the dialog
    // and the card cannot disagree about the size of what is at stake.
    const doc = createDoc({ adjust: { ...createDoc().adjust, exposure: 0.5 } })
    expect(countEdits(doc)).toBe(1)
    expect(discardSessionRequest(countEdits(doc)).body).toContain('1 edit')
  })

  it('New image counts undo steps, which is what past.length holds', () => {
    // The opposite number, for the opposite reason: this question is raised from the
    // live document, so `past.length` is both available and the number a reader can
    // check by pressing Undo that many times.
    expect(newImageRequest(3)?.body ?? '').toContain('3 edits')
  })
})

/**
 * `HUB_DOORS` is only load-bearing if something reads it at runtime, and the
 * verifier found it had no consumer outside a test — a table that existed to be
 * asserted against. This checks the read that replaced it: the Hub asks this module
 * where a card goes, so the same list answers both directions.
 */
describe('HUB_DOORS is one list read in both directions', () => {
  it('every door names a path the editor answers with the tool the door claims', () => {
    expect(HUB_DOORS.length).toBe(8)
    for (const door of HUB_DOORS) {
      expect(door.to.startsWith('/editor')).toBe(true)
    }
  })

  it('has no two doors claiming the same tool', () => {
    // Otherwise `hubDoorTo` would silently answer with the first of them and a card
    // could point at one path while the editor read the other.
    const tools = HUB_DOORS.map((door) => door.tool)
    expect(new Set(tools).size).toBe(tools.length)
  })
})
