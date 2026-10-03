/**
 * D7-F06: `ModelLoader` was 193 lines of untethered infrastructure.
 *
 * `ensureModel`, `isModelCached` and `resetModelCache` had no production
 * callers, and could not have had any: both matting entries carry `url: ''`, so
 * the only thing `ensureModel` could do for either of them was `fetch('')` — a
 * request for the current page. The passport auto-framer that `face-landmarker`
 * existed for turned out to need no model, and its owner confirmed on the board
 * (2026-09-29) that nothing is being wired to it.
 *
 * What is left is the part the user is actually shown, and these tests are the
 * reason it is safe to have deleted the rest: nothing advertises a download the
 * app cannot perform, and the error type that reaches a toast still works.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { MODELS, modelKindFor, ModelUnavailableError, scheduleOldCacheCleanup } from './ModelLoader'
const lock = JSON.parse(
  readFileSync(join(process.cwd(), 'models.lock.json'), 'utf8') as string,
) as {
  models: { kind: string }[]
}

describe('the model catalogue', () => {
  it('lists exactly the two tiers the Background panel offers', () => {
    expect(Object.keys(MODELS).sort()).toEqual(['matting-fp16', 'matting-quint8'])
    expect(modelKindFor('fast')).toBe('matting-quint8')
    expect(modelKindFor('best')).toBe('matting-fp16')
  })

  it('discloses a size for both, because the panel shows one before downloading', () => {
    for (const kind of ['matting-quint8', 'matting-fp16'] as const) {
      expect(MODELS[kind].bytes).toBeGreaterThan(0)
      expect(MODELS[kind].label.length).toBeGreaterThan(0)
    }
    expect(MODELS['matting-fp16'].bytes).toBeGreaterThan(MODELS['matting-quint8'].bytes)
  })

  it('says the weights come from a CDN, not from public/models', () => {
    // The old entries had `url: ''` while still being shown to the user as
    // "42 MB downloaded on first use", which reads as a local file the app owns.
    for (const kind of ['matting-quint8', 'matting-fp16'] as const) {
      expect(MODELS[kind].host).toBe('cdn')
      expect(MODELS[kind]).not.toHaveProperty('url')
    }
  })

  it('carries no self-hosted weight that nothing can load', () => {
    // `@imgly/background-removal` resolves its own asset base and offers no hook
    // to inject local weights, so a self-hosted entry here could never be used.
    expect(lock.models).toEqual([])
  })
})

describe('ModelUnavailableError', () => {
  it('names the tier and keeps the cause for the caller', () => {
    const cause = new TypeError('Failed to fetch')
    const error = new ModelUnavailableError('matting-fp16', cause)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ModelUnavailableError')
    expect(error.kind).toBe('matting-fp16')
    expect(error.message).toContain(MODELS['matting-fp16'].label)
    expect(error.reason).toBe(cause)
  })
})

describe('scheduleOldCacheCleanup', () => {
  it('deletes superseded model caches and leaves the current one alone', async () => {
    const deleted: string[] = []
    vi.stubGlobal('caches', {
      keys: async () => ['ie-models-v1', 'ie-models-v0', 'workbox-precache', 'unrelated'],
      delete: async (name: string) => {
        deleted.push(name)
        return true
      },
    })
    vi.useFakeTimers()
    try {
      scheduleOldCacheCleanup()
      await vi.advanceTimersByTimeAsync(5000)
      expect(deleted).toEqual(['ie-models-v0'])
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
