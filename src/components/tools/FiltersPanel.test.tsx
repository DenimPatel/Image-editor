import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LutLoadError, LUT_PRESETS } from '../../gl/luts'
import { createHarness, resetStores } from '../../store/testHarness'
import { useDocStore } from '../../store/docStore'
import { FiltersPanel } from './FiltersPanel'

/**
 * `loadLut` rejects on a missing strip, which is the honest outcome: the shader
 * skips the pass when no LUT is resident, so a "successful" load that applied
 * nothing is exactly the defect this panel has to report (D6-F16).
 */
const loadLut = vi.hoisted(() => vi.fn())

vi.mock('../../gl/luts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../gl/luts')>()
  return { ...actual, loadLut }
})

const harness = createHarness()

const chip = (label: string) =>
  Array.from(harness.container.querySelectorAll('button')).find(
    (button) => button.textContent === label,
  ) as HTMLButtonElement | undefined

const status = () => harness.container.querySelector('[role="status"]')

beforeEach(() => {
  resetStores()
  loadLut.mockReset()
  loadLut.mockResolvedValue({ id: 'kodak-portra' })
  harness.render(<FiltersPanel />)
})

afterEach(() => harness.unmount())

describe('FiltersPanel', () => {
  it('selects a look and loads its LUT', () => {
    act(() => {
      chip('Portra')?.click()
    })
    expect(useDocStore.getState().present.look.id).toBe('kodak-portra')
    expect(loadLut).toHaveBeenCalledWith('kodak-portra')
  })

  it('says so when the LUT cannot be loaded, instead of leaving a dead chip', async () => {
    loadLut.mockRejectedValue(new LutLoadError('kodak-portra', 404, 'not found'))
    await act(async () => {
      chip('Portra')?.click()
    })
    // The look is still selected — the document says what was asked for — but
    // the panel now admits that nothing is being applied.
    expect(useDocStore.getState().present.look.id).toBe('kodak-portra')
    expect(status()?.textContent).toContain('Look "kodak-portra" could not be loaded')
    expect(status()?.textContent).toContain('not applied')
  })

  it('reports a rejection that is not a LutLoadError without leaking the error object', async () => {
    loadLut.mockRejectedValue('nope')
    await act(async () => {
      chip('Ektar')?.click()
    })
    expect(status()?.textContent).toContain('The "Ektar" look could not be loaded')
  })

  it('clears a previous failure when another look is picked', async () => {
    loadLut.mockRejectedValueOnce(new LutLoadError('kodak-portra', 404, 'not found'))
    await act(async () => {
      chip('Portra')?.click()
    })
    expect(status()).not.toBeNull()
    await act(async () => {
      chip('Ektar')?.click()
    })
    expect(status()).toBeNull()
    expect(useDocStore.getState().present.look.id).toBe('kodak-ektar')
  })

  it('clears the failure when the look is turned off', async () => {
    loadLut.mockRejectedValue(new LutLoadError('kodak-portra', 404, 'not found'))
    await act(async () => {
      chip('Portra')?.click()
    })
    await act(async () => {
      chip('None')?.click()
    })
    expect(status()).toBeNull()
    expect(useDocStore.getState().present.look.id).toBeNull()
  })

  it('shows no error when every load succeeds', async () => {
    await act(async () => {
      chip('Portra')?.click()
    })
    expect(status()).toBeNull()
  })
})

/**
 * The look preview, and the selection state it sits inside.
 *
 * These are additions, not replacements: the six above are the panel's contract
 * and none of them moved. What is new here is the claim that adding a picture
 * to every chip did not move the *name* of any chip, and that a chip the panel
 * has just admitted is not applied does not go on claiming it is.
 */
describe('FiltersPanel, with a thumbnail on every chip', () => {
  const buttons = () => Array.from(harness.container.querySelectorAll('button'))
  const chipBy = (label: string) =>
    buttons().find((button) => button.textContent === label) as HTMLButtonElement | undefined

  it('keeps every chip named exactly as it was, thumbnail or not', () => {
    // The accessible name is pinned with `aria-label`, because the thumbnail's
    // `alt` names the look too and name-from-content would otherwise announce
    // "Portra Portra look preview" — a different name from the one the focus
    // order, the e2e suite and the user's own memory agree on.
    for (const preset of LUT_PRESETS) {
      expect(chipBy(preset.label)?.getAttribute('aria-label'), preset.id).toBe(preset.label)
    }
    expect(chipBy('None')?.getAttribute('aria-label')).toBe('None')
    // 24 chips plus the "None" chip, and each has exactly one preview.
    expect(buttons()).toHaveLength(LUT_PRESETS.length + 1)
    expect(harness.container.querySelectorAll('img')).toHaveLength(LUT_PRESETS.length)
  })

  it('gives every preview a base-aware src that the app will actually fetch', () => {
    const srcs = Array.from(harness.container.querySelectorAll('img')).map((img) =>
      img.getAttribute('src'),
    )
    for (const preset of LUT_PRESETS) {
      expect(srcs).toContain(`${import.meta.env.BASE_URL}look-thumbs/${preset.id}.png`)
    }
  })

  it('reports selection as a pressed state, not only as a border colour', () => {
    // The old weakness: a selected look was a green border and nothing else, so
    // a chip that reads as chosen only because of its colour is invisible to
    // anyone who cannot separate those two greens.
    expect(chipBy('Portra')?.getAttribute('aria-pressed')).toBe('false')
    act(() => {
      chipBy('Portra')?.click()
    })
    expect(chipBy('Portra')?.getAttribute('aria-pressed')).toBe('true')
    expect(chipBy('Ektar')?.getAttribute('aria-pressed')).toBe('false')
    expect(chipBy('None')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('stops claiming a look is applied once it has said it is not', async () => {
    // The inconsistency this panel shipped with: the error said "not applied"
    // and the chip stayed highlighted, so the two statements contradicted each
    // other in the same viewport.
    loadLut.mockRejectedValue(new LutLoadError('kodak-portra', 404, 'not found'))
    await act(async () => {
      chipBy('Portra')?.click()
    })
    expect(status()?.textContent).toContain('not applied')
    expect(chipBy('Portra')?.getAttribute('aria-pressed')).toBe('false')
    expect(chipBy('Portra')?.className).not.toContain('lookItemActive')
    // …while the document still says what was asked for, which is the part that
    // was already right and must stay right.
    expect(useDocStore.getState().present.look.id).toBe('kodak-portra')
  })

  it('re-highlights the chip when a look is retried and succeeds', async () => {
    loadLut.mockRejectedValueOnce(new LutLoadError('kodak-portra', 404, 'not found'))
    await act(async () => {
      chipBy('Portra')?.click()
    })
    expect(chipBy('Portra')?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => {
      chipBy('Portra')?.click()
    })
    expect(chipBy('Portra')?.getAttribute('aria-pressed')).toBe('true')
    expect(status()).toBeNull()
  })

  it('drops the selection when the failed look is turned off', async () => {
    loadLut.mockRejectedValue(new LutLoadError('kodak-portra', 404, 'not found'))
    await act(async () => {
      chipBy('Portra')?.click()
    })
    await act(async () => {
      chipBy('None')?.click()
    })
    expect(chipBy('None')?.getAttribute('aria-pressed')).toBe('true')
    expect(chipBy('Portra')?.getAttribute('aria-pressed')).toBe('false')
  })
})
