import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHarness } from '../store/testHarness'
import {
  APPEARANCE_ATTRIBUTE_NAMES,
  APPEARANCE_EVENT,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_THEME_STORAGE_KEY,
  type AppearanceSettings,
} from '../lib/appearance'
import { useAppearance, type AppearanceApi } from './useAppearance'
import { useTheme } from './useTheme'

const harness = createHarness()
const root = document.documentElement

let osDark = false
let mediaListeners: (() => void)[] = []

/**
 * jsdom's `matchMedia` always reports `false` and never fires, so
 * `prefers-color-scheme` has to be stubbed for `system` to resolve either way
 * and for the live-change path to exist at all.
 */
function stubMatchMedia(): void {
  const list = {
    get matches() {
      return osDark
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      mediaListeners.push(listener)
    },
    removeEventListener: (_type: string, listener: () => void) => {
      mediaListeners = mediaListeners.filter((l) => l !== listener)
    },
    addListener: (listener: () => void) => {
      mediaListeners.push(listener)
    },
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList
  window.matchMedia = ((query: string) =>
    query === '(prefers-color-scheme: dark)'
      ? list
      : ({ ...list, matches: false } as MediaQueryList)) as typeof window.matchMedia
}

/** Flip the OS preference the way a real `prefers-color-scheme` change does. */
function setOsDark(next: boolean): void {
  osDark = next
  act(() => {
    for (const listener of [...mediaListeners]) listener()
  })
}

/** Mount a control that renders the hook's state and exposes its actions. */
type Probe = {
  api: AppearanceApi | null
  set: (patch: Partial<AppearanceSettings>) => void
  reset: () => void
  last: AppearanceApi | null
}

const probes: Probe[] = []

function AppearanceControl({ onReady }: { onReady: (probe: Probe) => void }) {
  const api = useAppearance()
  const probe: Probe = {
    api,
    set: api.set,
    reset: api.reset,
    last: api,
  }
  probes.push(probe)
  onReady(probe)
  return <div data-testid="appearance-probe">{api.resolvedTheme}</div>
}

function ThemeControl() {
  const { isDark, toggle, preference } = useTheme()
  return (
    <button type="button" data-testid="theme" onClick={toggle}>
      {isDark ? 'dark' : 'light'}:{preference}
    </button>
  )
}

const themeButton = () =>
  harness.container.querySelector('[data-testid="theme"]') as HTMLButtonElement | null

function readStored(): AppearanceSettings {
  return JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}') as AppearanceSettings
}

beforeEach(() => {
  osDark = false
  mediaListeners = []
  localStorage.clear()
  probes.length = 0
  stubMatchMedia()
  for (const name of APPEARANCE_ATTRIBUTE_NAMES) root.removeAttribute(name)
})

afterEach(() => {
  harness.unmount()
  probes.length = 0
  vi.restoreAllMocks()
  localStorage.clear()
  for (const name of APPEARANCE_ATTRIBUTE_NAMES) root.removeAttribute(name)
})

describe('useAppearance: reading and writing', () => {
  it('reads the stored settings on mount', () => {
    const stored: AppearanceSettings = {
      theme: 'dark',
      density: 'compact',
      textScale: 'large',
      motion: 'reduced',
      iconScale: 'small',
      accent: 'blue',
    }
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(stored))
    const seen: { current: AppearanceApi | null } = { current: null }
    harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />)
    expect(seen.current?.settings).toEqual(stored)
  })

  it('falls back to the defaults when storage is empty', () => {
    const seen: { current: AppearanceApi | null } = { current: null }
    harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />)
    expect(seen.current?.settings).toEqual(DEFAULT_APPEARANCE)
  })

  it('migrates the legacy theme key on mount', () => {
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    const seen: { current: AppearanceApi | null } = { current: null }
    harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />)
    expect(seen.current?.settings.theme).toBe('dark')
    // And it reaches the DOM, so the upgrade does not flash the OS preference.
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('survives a corrupt payload on mount', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, '{not json')
    const seen: { current: AppearanceApi | null } = { current: null }
    expect(() =>
      harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />),
    ).not.toThrow()
    expect(seen.current?.settings).toEqual(DEFAULT_APPEARANCE)
  })

  it('writes all six attributes in one effect', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({
        theme: 'dark',
        density: 'compact',
        textScale: 'xlarge',
        motion: 'reduced',
        iconScale: 'large',
        accent: 'amber',
      })
    })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-density')).toBe('compact')
    expect(root.getAttribute('data-text')).toBe('xlarge')
    expect(root.getAttribute('data-motion')).toBe('reduced')
    expect(root.getAttribute('data-icons')).toBe('large')
    expect(root.getAttribute('data-accent')).toBe('amber')
  })

  it('removes the attribute when a setting goes back to its default', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ density: 'roomy', accent: 'blue' })
    })
    expect(root.hasAttribute('data-density')).toBe(true)
    act(() => {
      probe!.reset()
    })
    for (const name of APPEARANCE_ATTRIBUTE_NAMES) {
      expect(root.hasAttribute(name), name).toBe(false)
    }
    expect(readStored()).toEqual(DEFAULT_APPEARANCE)
  })

  it('persists what it set', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ density: 'roomy' })
    })
    expect(readStored().density).toBe('roomy')
  })

  it('clamps an invalid value rather than applying it', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ density: 'tiny' as never })
    })
    expect(probe!.api?.settings.density).toBe('default')
    expect(root.hasAttribute('data-density')).toBe(false)
  })

  it('merges a partial change over the other five settings', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ accent: 'violet' })
    })
    act(() => {
      probe!.set({ textScale: 'large' })
    })
    expect(probe!.api?.settings).toEqual({
      ...DEFAULT_APPEARANCE,
      accent: 'violet',
      textScale: 'large',
    })
    expect(root.getAttribute('data-accent')).toBe('violet')
    expect(root.getAttribute('data-text')).toBe('large')
  })

  it('survives localStorage throwing on write, and still applies the settings', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    let probe: Probe | null = null
    expect(() => harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)).not.toThrow()
    expect(() =>
      act(() => {
        probe!.set({ density: 'roomy' })
      }),
    ).not.toThrow()
    // An appearance hook that threw here would be a white screen, so the
    // session keeps the setting even though nothing was persisted.
    expect(root.getAttribute('data-density')).toBe('roomy')
    expect(probe!.api?.settings.density).toBe('roomy')
  })

  it('does not throw when reading storage fails on mount', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    const seen: { current: AppearanceApi | null } = { current: null }
    expect(() =>
      harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />),
    ).not.toThrow()
    expect(seen.current?.settings).toEqual(DEFAULT_APPEARANCE)
  })

  it('does not thrash the DOM: a no-op set writes nothing', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ density: 'roomy' })
    })
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute')
    act(() => {
      probe!.set({ density: 'roomy' })
    })
    expect(setAttribute).not.toHaveBeenCalled()
  })

  it('writes only the attribute that changed', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ density: 'roomy', accent: 'blue' })
    })
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute')
    act(() => {
      probe!.set({ accent: 'amber' })
    })
    expect(setAttribute).toHaveBeenCalledTimes(1)
    expect(setAttribute).toHaveBeenCalledWith('data-accent', 'amber')
  })
})

describe('useAppearance: prefers-color-scheme', () => {
  it('resolves `system` against the OS', () => {
    osDark = false
    const seen: { current: AppearanceApi | null } = { current: null }
    harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />)
    expect(seen.current?.resolvedTheme).toBe('light')

    harness.unmount()
    osDark = true
    harness.render(<AppearanceControl onReady={(p) => (seen.current = p.api)} />)
    expect(seen.current?.resolvedTheme).toBe('dark')
  })

  it('follows the OS live while the preference is `system`', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    expect(probe!.api?.resolvedTheme).toBe('light')
    setOsDark(true)
    expect(probe!.api?.resolvedTheme).toBe('dark')
    setOsDark(false)
    expect(probe!.api?.resolvedTheme).toBe('light')
  })

  it('leaves the other five settings untouched when the OS theme flips', () => {
    // The defect this guards: a listener that re-applied *all* attributes on a
    // `prefers-color-scheme` change would drop the user's density and accent
    // back to defaults, because the OS has no opinion about them.
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({
        density: 'compact',
        textScale: 'large',
        motion: 'reduced',
        iconScale: 'small',
        accent: 'amber',
      })
    })
    const before = { ...probe!.api!.settings }

    setOsDark(true)
    setOsDark(false)
    setOsDark(true)

    expect(probe!.api?.settings).toEqual(before)
    expect(root.getAttribute('data-density')).toBe('compact')
    expect(root.getAttribute('data-text')).toBe('large')
    expect(root.getAttribute('data-motion')).toBe('reduced')
    expect(root.getAttribute('data-icons')).toBe('small')
    expect(root.getAttribute('data-accent')).toBe('amber')
  })

  it('does not write a data-theme attribute for `system`', () => {
    // The OS decision belongs to the `:root:not([data-theme])` media query in
    // tokens.css. Writing the attribute here would out-specify it and the
    // live switch would stop working.
    harness.render(<AppearanceControl onReady={() => {}} />)
    expect(root.hasAttribute('data-theme')).toBe(false)
    setOsDark(true)
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('ignores the OS when the preference is explicit', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ theme: 'light' })
    })
    setOsDark(true)
    expect(probe!.api?.resolvedTheme).toBe('light')
    expect(root.getAttribute('data-theme')).toBe('light')
  })
})

describe('useAppearance: cross-tab sync', () => {
  it('picks up a write from another tab', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    expect(probe!.api?.settings.accent).toBe('green')

    // Another tab wrote the key: the value is in storage, and the `storage`
    // event is what this tab hears about it.
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APPEARANCE, accent: 'blue', density: 'roomy' }),
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEY }))
    })

    expect(probe!.api?.settings.accent).toBe('blue')
    expect(probe!.api?.settings.density).toBe('roomy')
    expect(root.getAttribute('data-accent')).toBe('blue')
    expect(root.getAttribute('data-density')).toBe('roomy')
  })

  it('ignores a storage event for a different key', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ accent: 'violet' })
    })
    const before = { ...probe!.api!.settings }
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'image-editor-something-else' }))
    })
    expect(probe!.api?.settings).toEqual(before)
  })

  it('re-reads on a clear() event, whose key is null', () => {
    let probe: Probe | null = null
    harness.render(<AppearanceControl onReady={(p) => (probe = p)} />)
    act(() => {
      probe!.set({ accent: 'amber' })
    })
    localStorage.removeItem(APPEARANCE_STORAGE_KEY)
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(probe!.api?.settings.accent).toBe('green')
    expect(root.hasAttribute('data-accent')).toBe(false)
  })

  it('re-syncs when the appearance event fires, which is how two mounted hooks agree', () => {
    // `set` dispatches this after writing, and a second mounted instance in
    // this tab — the Hub nav and the editor shell — is listening.
    let a: Probe | null = null
    let b: Probe | null = null
    function TwoControls() {
      return (
        <>
          <AppearanceControl onReady={(p) => (a = p)} />
          <AppearanceControl onReady={(p) => (b = p)} />
        </>
      )
    }
    harness.render(<TwoControls />)

    act(() => {
      a!.set({ accent: 'blue' })
    })
    expect(b!.api?.settings.accent).toBe('blue')
    expect(root.getAttribute('data-accent')).toBe('blue')
  })

  it('stops listening after unmount', () => {
    harness.render(<AppearanceControl onReady={() => {}} />)
    const remove = vi.spyOn(window, 'removeEventListener')
    harness.unmount()
    const events = remove.mock.calls.map((call) => call[0])
    expect(events).toContain('storage')
    expect(events).toContain(APPEARANCE_EVENT)
  })
})

describe('useAppearance: mounting twice', () => {
  function TwoControls() {
    return (
      <>
        <AppearanceControl onReady={() => {}} />
        <AppearanceControl onReady={() => {}} />
      </>
    )
  }

  it('does not double-apply the same settings', () => {
    const setAttribute = vi.spyOn(Element.prototype, 'setAttribute')
    harness.render(<TwoControls />)
    // Two mounts, one set of attributes. A shared module-level store would
    // have made this a single mount, but the cost of two is that they must
    // agree — and idempotence is what buys that.
    const writes = setAttribute.mock.calls.filter((call) =>
      APPEARANCE_ATTRIBUTE_NAMES.includes(call[0] as never),
    )
    expect(writes).toHaveLength(0)
  })

  it('leaves the two instances in agreement, not fighting', () => {
    let a: Probe | null = null
    let b: Probe | null = null
    function Pair() {
      return (
        <>
          <AppearanceControl onReady={(p) => (a = p)} />
          <AppearanceControl onReady={(p) => (b = p)} />
        </>
      )
    }
    harness.render(<Pair />)
    act(() => {
      a!.set({ density: 'compact', accent: 'violet' })
    })
    expect(a!.api?.settings).toEqual(b!.api?.settings)
    expect(b!.api?.settings.density).toBe('compact')
    expect(b!.api?.settings.accent).toBe('violet')
    expect(root.getAttribute('data-density')).toBe('compact')
    expect(root.getAttribute('data-accent')).toBe('violet')
  })

  it('converges on one value when both are mounted and one resets', () => {
    let a: Probe | null = null
    let b: Probe | null = null
    function Pair() {
      return (
        <>
          <AppearanceControl onReady={(p) => (a = p)} />
          <AppearanceControl onReady={(p) => (b = p)} />
        </>
      )
    }
    harness.render(<Pair />)
    act(() => {
      a!.set({ motion: 'reduced', iconScale: 'small' })
    })
    act(() => {
      b!.reset()
    })
    expect(a!.api?.settings).toEqual(DEFAULT_APPEARANCE)
    expect(b!.api?.settings).toEqual(DEFAULT_APPEARANCE)
    expect(root.hasAttribute('data-motion')).toBe(false)
    expect(root.hasAttribute('data-icons')).toBe(false)
  })
})

describe('useTheme', () => {
  it('reads the resolved theme, not the raw preference', () => {
    osDark = true
    harness.render(<ThemeControl />)
    expect(themeButton()?.textContent).toBe('dark:system')
  })

  it('toggles an explicit choice and persists it', () => {
    osDark = false
    harness.render(<ThemeControl />)
    expect(themeButton()?.textContent).toBe('light:system')
    act(() => {
      themeButton()?.click()
    })
    expect(themeButton()?.textContent).toBe('dark:dark')
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(readStored().theme).toBe('dark')
  })

  it('toggles out of `system` to the opposite of what is on screen', () => {
    // The user sees light because the OS says light; clicking must mean "make
    // it dark", not "make it the other stored value", which does not exist.
    osDark = true
    harness.render(<ThemeControl />)
    act(() => {
      themeButton()?.click()
    })
    expect(root.getAttribute('data-theme')).toBe('light')
    act(() => {
      themeButton()?.click()
    })
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('writes the same attribute the hook writes, never a second value', () => {
    // The old `useTheme` wrote `data-theme` from its own copy of the
    // `image-editor-theme` key while the `<head>` script wrote the same
    // attribute from the same key. Two writers is a race; there is one now.
    harness.render(<ThemeControl />)
    act(() => {
      themeButton()?.click()
    })
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull()
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}').theme).toBe('dark')
  })
})
