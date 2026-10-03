/**
 * D9-F09: the import screen says "Everything runs in your browser — nothing is
 * uploaded", and the bundled samples are fetched by URL, so "works offline"
 * was a claim the app could not keep. These tests pin what the banner is allowed
 * to say: the truth is partial, and a message that hid the partial part would be
 * as dishonest as no message at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CACHED_SHELL_IMPACT,
  describeOffline,
  isOnline,
  networkState,
  observeNetwork,
} from './network'

describe('describeOffline', () => {
  it('says what keeps working before it says what does not', () => {
    const message = describeOffline()
    expect(message).toContain("You're offline")
    expect(message.indexOf('Your photo and every edit')).toBeLessThan(
      message.indexOf('need a connection'),
    )
  })

  it('names the two things that genuinely need a connection', () => {
    const message = describeOffline()
    expect(message).toContain('The bundled sample photos will need a connection.')
    expect(message).toContain('Background removal will need a connection.')
    // Honest about the third case rather than claiming everything is cached.
    expect(message).toContain('Looks and fonts will work if you have opened them before.')
  })

  it('reports the cached-shell impact it is written for', () => {
    expect(CACHED_SHELL_IMPACT.editing).toBe('works')
    expect(CACHED_SHELL_IMPACT.samples).toBe('needs-network')
    expect(CACHED_SHELL_IMPACT.backgroundRemoval).toBe('needs-network')
    expect(CACHED_SHELL_IMPACT.assets).toBe('works-if-cached')
  })

  it('changes its wording when nothing is cached', () => {
    const message = describeOffline({
      editing: 'works',
      samples: 'needs-network',
      backgroundRemoval: 'needs-network',
      assets: 'needs-network',
    })
    expect(message).toContain('Looks and fonts will need a connection.')
  })
})

describe('networkState', () => {
  it('is a two-way mapping, not a truthiness check', () => {
    expect(networkState(true)).toBe('online')
    expect(networkState(false)).toBe('offline')
  })
})

describe('isOnline', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is false without a navigator, never optimistically true', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isOnline()).toBe(false)
  })

  it('treats an unknown onLine as online, which is what browsers mean', () => {
    vi.stubGlobal('navigator', { onLine: true })
    expect(isOnline()).toBe(true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOnline()).toBe(false)
  })
})

describe('observeNetwork', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports the current state immediately, so a caller never seeds it', () => {
    vi.stubGlobal('navigator', { onLine: false })
    const seen: boolean[] = []
    const stop = observeNetwork((online) => seen.push(online))
    expect(seen).toEqual([false])
    stop()
  })

  it('unsubscribes cleanly', () => {
    vi.stubGlobal('navigator', { onLine: true })
    const seen: boolean[] = []
    const stop = observeNetwork((online) => seen.push(online))
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    stop()
    window.dispatchEvent(new Event('offline'))
    expect(seen).toEqual([true, false, true])
  })
})
