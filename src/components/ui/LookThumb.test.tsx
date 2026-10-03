import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createHarness, resetStores } from '../../store/testHarness'
import { LookThumb } from './LookThumb'
import { LOOK_THUMB_DISPLAY, lookThumbUrl } from './lookThumbUrl'

/**
 * The thumbnail half of the Looks grid.
 *
 * The failure path gets more attention than the happy one on purpose. A chip
 * whose preview 404s is a chip the user is still choosing a look with, and the
 * answer has to be the button they had before: a label, no broken-image box, no
 * alt-text-sized rectangle, and an accessible name that did not move.
 */

const harness = createHarness()

afterEach(() => {
  harness.unmount()
  resetStores()
})

const frame = (props: { id: string; label: string; selected?: boolean }) => {
  harness.render(<LookThumb {...props} selected={props.selected ?? false} />)
  return harness.container
}

describe('lookThumbUrl', () => {
  it('resolves against the app base, not the origin root', () => {
    // `vite.config.ts` sets `base: '/Image-editor/'` and the router runs with
    // that basename. A root-relative `/look-thumbs/…` works on `vite dev` and
    // 404s in every deployed copy — the failure mode `public/luts/` already has
    // a test for.
    expect(lookThumbUrl('kodak-portra')).toBe(
      `${import.meta.env.BASE_URL}look-thumbs/kodak-portra.png`,
    )
    expect(lookThumbUrl('kodak-portra').startsWith(import.meta.env.BASE_URL)).toBe(true)
    expect(lookThumbUrl('kodak-portra')).not.toContain('//look-thumbs')
  })

  it('renders at 2x the box it is displayed in', () => {
    // 144x96 committed, 72x48 in the chip: the retina budget is spent once, here.
    expect(LOOK_THUMB_DISPLAY).toEqual({ width: 72, height: 48 })
  })
})

describe('LookThumb', () => {
  it('renders the committed thumbnail, lazily, with an alt that names the look', () => {
    const img = frame({ id: 'teal-orange', label: 'Teal & Orange' }).querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe(lookThumbUrl('teal-orange'))
    expect(img?.getAttribute('alt')).toBe('Teal & Orange look preview')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('decoding')).toBe('async')
    // The natural size, so the browser reserves the box before the bytes land
    // and the grid does not reflow as the twenty-four previews stream in.
    expect({ width: img?.getAttribute('width'), height: img?.getAttribute('height') }).toEqual({
      width: '144',
      height: '96',
    })
    expect(img?.draggable).toBe(false)
  })

  it('degrades to nothing at all when the thumbnail fails to load', () => {
    // Not a hidden-but-present frame, not an alt-text box, not a zero-height
    // gap: the element is removed, so the chip is exactly the button it was
    // before this file existed. Anything else needs CSS in three themes to look
    // right and will not.
    const container = frame({ id: 'kodak-portra', label: 'Portra' })
    const img = container.querySelector('img') as HTMLImageElement
    act(() => {
      img.dispatchEvent(new Event('error'))
    })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[class*="frame"]')).toBeNull()
  })

  it('does not fire the error path twice, or re-render into a broken state', () => {
    const container = frame({ id: 'kodak-portra', label: 'Portra' })
    const img = container.querySelector('img') as HTMLImageElement
    act(() => {
      img.dispatchEvent(new Event('error'))
      img.dispatchEvent(new Event('error'))
    })
    expect(container.textContent).toBe('')
  })

  it('shows the selected tick only when selected', () => {
    const tick = (container: HTMLElement) => container.querySelectorAll('[class*="tick"]').length
    expect(tick(frame({ id: 'kodak-portra', label: 'Portra' }))).toBe(1)
    harness.unmount()
    const selected = frame({ id: 'kodak-portra', label: 'Portra', selected: true })
    // The tick is always mounted so it can transition, and it is `aria-hidden`
    // because the chip's own `aria-pressed` is the state a screen reader reads —
    // two announcements of one fact is one too many.
    const badges = Array.from(selected.querySelectorAll('[class*="tick"]'))
    expect(badges).toHaveLength(1)
    expect(badges[0]?.getAttribute('aria-hidden')).toBe('true')
    expect(selected.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(badges[0]?.className).toContain('tickOn')
  })

  it('keeps the tick out of the accessibility tree and the picture inside the frame', () => {
    const selected = frame({ id: 'cyberpunk', label: 'Cyberpunk', selected: true })
    const badge = selected.querySelector('[class*="tick"]')
    const img = selected.querySelector('img')
    // The tick is decoration *on top of* the preview, and the preview is
    // decoration *in addition to* the label. Neither replaces the other.
    expect(badge?.contains(img)).toBe(false)
    expect(img?.parentElement?.className).toContain('frame')
  })

  it('survives a look id the generator has never heard of', () => {
    // It renders a broken src, which is what `<img>` does for any 404 — and the
    // error path then removes it. The component does not need to know the
    // catalogue to fail gracefully.
    const container = frame({ id: 'not-a-look', label: 'Mystery' })
    expect(container.querySelector('img')?.getAttribute('src')).toContain('not-a-look.png')
  })
})
