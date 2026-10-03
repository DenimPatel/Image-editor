import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FLAGS_STORAGE_KEY, clearAllFlags, initFlags, resetFlags, setFlagState } from '../lib/flags'
import type { Caps } from '../gl/caps'
import { backendKind, enginePreferenceFromState, readEnginePreference } from './selectBackend'

/**
 * The engine decision, away from the browser.
 *
 * The preview itself needs a real WebGL2 context, a real rAF and a real
 * `ResizeObserver`, none of which jsdom has, so what is pinned here is the two
 * decisions that used to be made by two unrelated mechanisms: what the engine
 * pin resolves to, and the veto that has to beat it.
 */

const CAPS_WITH_WEBGL = {
  webgl2: true,
  maxTextureSize: 4096,
  maxRenderbufferSize: 4096,
  maxCanvasArea: 4096 * 4096,
  formats: { webp: false, avif: false },
  saveData: false,
} as unknown as Caps

beforeEach(() => {
  localStorage.removeItem(FLAGS_STORAGE_KEY)
  resetFlags()
})

afterEach(() => {
  localStorage.removeItem(FLAGS_STORAGE_KEY)
  resetFlags()
})

describe('enginePreferenceFromState', () => {
  it('maps the tri-state onto the three values the backend understands', () => {
    expect(enginePreferenceFromState('on')).toBe('gl')
    expect(enginePreferenceFromState('off')).toBe('canvas2d')
    // `default` is today's behaviour, not a fourth rendering mode: ask the
    // device.
    expect(enginePreferenceFromState('default')).toBe('auto')
  })
})

describe('readEnginePreference', () => {
  it('asks the device when nothing has been set', () => {
    expect(readEnginePreference('')).toBe('auto')
  })

  it('still honours the deprecated ?engine= parameter', () => {
    // `e2e/journey.context-loss.spec.ts` and `e2e/journey.perf-budget.spec.ts`
    // both use these. The parameter is a spelling of the flag, not a second
    // mechanism left beside it.
    expect(readEnginePreference('?engine=gl')).toBe('gl')
    expect(readEnginePreference('?engine=canvas2d')).toBe('canvas2d')
    expect(readEnginePreference('?engine=auto')).toBe('auto')
    expect(readEnginePreference('?engine=nonsense')).toBe('auto')
  })

  it('reads the same pin from the flag parameters', () => {
    expect(readEnginePreference('?features=engine')).toBe('gl')
    expect(readEnginePreference('?off=engine')).toBe('canvas2d')
    expect(readEnginePreference('?features=matting,engine')).toBe('gl')
  })

  it('reads a saved override, which is how a pin survives a navigation', () => {
    setFlagState('engine', 'off')
    expect(readEnginePreference('')).toBe('canvas2d')
    expect(readEnginePreference('?features=matting')).toBe('canvas2d')
  })

  it('puts the url above storage, as everywhere else', () => {
    setFlagState('engine', 'off')
    expect(readEnginePreference('?features=engine')).toBe('gl')
    setFlagState('engine', 'on')
    expect(readEnginePreference('?off=engine')).toBe('canvas2d')
  })
})

describe('backendKind', () => {
  it('asks for gl on a device that reports WebGL2 and nothing has been set', () => {
    expect(backendKind('auto', CAPS_WITH_WEBGL)).toBe('gl')
    expect(backendKind('gl', CAPS_WITH_WEBGL)).toBe('gl')
  })

  it('asks for Canvas2D on a device that reports none, whatever the pin says', () => {
    expect(backendKind('auto', { ...CAPS_WITH_WEBGL, webgl2: false } as Caps)).toBe('canvas2d')
    expect(backendKind('gl', { ...CAPS_WITH_WEBGL, webgl2: false } as Caps)).toBe('canvas2d')
  })

  it('never asks for gl when the flag vetoes it', () => {
    setFlagState('webgl', 'off')
    expect(backendKind('auto', CAPS_WITH_WEBGL)).toBe('canvas2d')
  })

  it('lets the veto beat an engine pin that asked for gl', () => {
    // The whole difference between "render the preview differently" and "this
    // browser's driver is the problem": the pin is a preference for one loop
    // and the veto is a ban, so the ban wins.
    initFlags({ search: '?features=engine&off=webgl' })
    expect(readEnginePreference('?features=engine&off=webgl')).toBe('gl')
    expect(backendKind('gl', CAPS_WITH_WEBGL)).toBe('canvas2d')
  })

  it('leaves the engine pin in charge when there is no veto', () => {
    clearAllFlags()
    expect(backendKind('canvas2d', CAPS_WITH_WEBGL)).toBe('canvas2d')
    expect(backendKind('gl', CAPS_WITH_WEBGL)).toBe('gl')
  })

  it('is not a one-way door: clearing the flag restores the pin', () => {
    setFlagState('webgl', 'off')
    expect(backendKind('gl', CAPS_WITH_WEBGL)).toBe('canvas2d')
    clearAllFlags()
    expect(backendKind('gl', CAPS_WITH_WEBGL)).toBe('gl')
  })

  it('is not latched by a read', () => {
    setFlagState('webgl', 'off')
    backendKind('auto', CAPS_WITH_WEBGL)
    clearAllFlags()
    expect(backendKind('auto', CAPS_WITH_WEBGL)).toBe('gl')
  })
})
