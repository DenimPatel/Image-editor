import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NEUTRAL_ADJUST, NEUTRAL_LOOK, createDoc } from '../../model/defaults'
import { createHarness } from '../../store/testHarness'
import { ResumeSessionCard } from './ResumeSessionCard'

const harness = createHarness()

const noop = () => {}
const DAY = 24 * 60 * 60 * 1000
/** The horizon the card reads from `retention.ts`, so the countdown below is against the real one. */
const RETENTION_DAYS = 180
/**
 * The card reads the clock itself when it renders — that is the point of it, so
 * the age stops moving under the user's cursor — which means the test's "now"
 * has to be the real one. Offsets are hours wide, so the microseconds between
 * here and the render cannot cross a bucket.
 */
const NOW = Date.now()

const SOURCE = { assetId: 'asset_1', width: 4032, height: 6048, name: 'a.jpg', mime: 'image/jpeg' }

const doc = createDoc({
  source: SOURCE,
  adjust: { ...NEUTRAL_ADJUST, exposure: 1.2 },
  look: { ...NEUTRAL_LOOK, id: 'warm-01', amount: 0.6 },
})

const render = (props: Partial<React.ComponentProps<typeof ResumeSessionCard>> = {}) =>
  act(() => {
    harness.render(
      <ResumeSessionCard
        thumbnailUrl="data:image/png;base64,AA"
        updatedAt={NOW - 3 * 60 * 60 * 1000}
        doc={doc}
        onResume={noop}
        onDiscard={noop}
        {...props}
      />,
    )
  })

beforeEach(() => render())
afterEach(() => harness.unmount())

describe('the resume card is a decision rather than a prompt', () => {
  it('says how big the photo is, how much has been done to it and how old it is', () => {
    const text = harness.container.textContent ?? ''
    expect(text).toContain('4032 × 6048')
    expect(text).toContain('2 edits')
    expect(text).toContain('saved 3 hours ago')
  })

  it('says what will happen to it, before anyone chooses', () => {
    // The card used to offer a permanent decision with no horizon on it. It now
    // names the policy the store actually applies — read from `retention.ts`
    // rather than restated here — and says that nothing takes it away on its own:
    // Discard, which the user is looking at, is what removes the photo and the
    // edits. Neither half is inferable from the other, so both are asserted: a
    // card that named the horizon and implied a timer would be making the promise
    // this model was built to stop making.
    const text = harness.container.textContent ?? ''
    expect(text).toContain('180 days after the last save')
    expect(text).toContain('Nothing removes it on its own')
    expect(text).toContain('press Discard')
    expect(text).toContain('photo and the edits together')
    expect(text).not.toMatch(/are deleted/)
  })

  it('switches to a countdown in the last day', () => {
    render({ updatedAt: NOW - (RETENTION_DAYS * DAY - 6 * 60 * 60 * 1000) })
    const text = harness.container.textContent ?? ''
    expect(text).toContain('Less than a day left')
    expect(text).toContain('in about 6 hours')
    // The countdown branch has to keep saying who deletes, or it reads as a timer
    // running down whether the user acts or not.
    expect(text).toContain('Nothing removes it on its own')
  })

  it('keeps the exact time available without spending a line on it', () => {
    const facts = harness.container.querySelector('[title]')
    expect(facts?.getAttribute('title')).toBe(new Date(NOW - 3 * 60 * 60 * 1000).toLocaleString())
  })

  it('shows what a one-edit session says, rather than pluralising a lie', () => {
    render({ doc: createDoc({ adjust: { ...NEUTRAL_ADJUST, exposure: 1 } }) })
    expect(harness.container.textContent).toContain('1 edit ·')
  })

  it('degrades to what it can prove for a session an older build wrote', () => {
    render({ doc: { adjust: { contrast: -0.5 } } })
    const text = harness.container.textContent ?? ''
    expect(text).toContain('1 edit')
    // No size, because that session never stored one.
    expect(text).not.toContain('×')
  })

  it('renders without a thumbnail rather than a broken image', () => {
    render({ thumbnailUrl: null })
    expect(harness.container.querySelector('img')).toBeNull()
    expect(harness.container.textContent).toContain('Continue editing?')
  })

  it('offers the two actions by the names the e2e suite drives them by', () => {
    const names = Array.from(harness.container.querySelectorAll('button')).map((b) => b.textContent)
    expect(names).toEqual(['Resume', 'Discard'])
  })
})
