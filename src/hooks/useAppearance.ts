import { useCallback, useEffect, useState } from 'react'
import { useMediaQuery } from '../components/ui/useMediaQuery'
import {
  APPEARANCE_EVENT,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  readAppearance,
  resolveTheme,
  writeAppearance,
  type AppearanceSettings,
  type ResolvedTheme,
} from '../lib/appearance'

export type { AppearanceSettings, ResolvedTheme } from '../lib/appearance'

export type AppearanceApi = {
  settings: AppearanceSettings
  /** Merge a partial change; every field is validated and clamped before it lands. */
  set: (patch: Partial<AppearanceSettings>) => AppearanceSettings
  /** Back to `DEFAULT_APPEARANCE`, persisted like any other change. */
  reset: () => AppearanceSettings
  /** `theme` with `system` resolved against `prefers-color-scheme`. */
  resolvedTheme: ResolvedTheme
}

/**
 * The one hook that owns the appearance attributes.
 *
 * Three properties are load-bearing and each is a deliberate choice over the
 * obvious one.
 *
 * **It is safe to mount twice.** The Hub nav and the editor shell both want
 * the settings, and the editor is a separate route from the Hub, so a shared
 * store would be the tidy answer — but a module-level store would make the hook
 * untestable in isolation and would mean one unmount tearing down the other's
 * listener. Instead the state is local and the DOM write is idempotent:
 * `applyAppearance` skips attributes that already hold the wanted value, so
 * two mounted instances converge on the same DOM without fighting, and a
 * third-party `storage` write re-syncs both to the same value.
 *
 * **The `storage` event is what syncs tabs.** A `storage` event only fires in
 * *other* documents, so this tab is updated by `writeAppearance` dispatching
 * `APPEARANCE_EVENT` on `window` — the same channel `set` uses, which is why
 * a second mounted instance in this tab updates too. Both paths funnel into
 * `readAppearance`, so a tab cannot drift from what is actually stored.
 *
 * **`prefers-color-scheme` only feeds `resolvedTheme`.** With `theme:
 * 'system'` there is no `data-theme` attribute at all, so the OS decision is
 * made by the media query in `tokens.css`, and the other five settings are
 * untouched by it. The listener exists so `resolvedTheme` (the theme toggle's
 * icon) stays live, not so JavaScript can out-vote the stylesheet.
 */
export function useAppearance(): AppearanceApi {
  const [settings, setSettings] = useState<AppearanceSettings>(readAppearance)
  const osDark = useMediaQuery('(prefers-color-scheme: dark)')

  useEffect(() => {
    applyAppearance(settings)
  }, [settings])

  useEffect(() => {
    const sync = () => setSettings(readAppearance())
    // Another tab wrote the key. `key === null` is `localStorage.clear()`,
    // which is still a reason to re-read; a different key is not.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) return
      sync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(APPEARANCE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(APPEARANCE_EVENT, sync)
    }
  }, [])

  const set = useCallback((patch: Partial<AppearanceSettings>) => {
    const result = writeAppearance({ ...readAppearance(), ...patch })
    setSettings(result.settings)
    return result.settings
  }, [])

  const reset = useCallback(() => {
    const result = writeAppearance(DEFAULT_APPEARANCE)
    setSettings(result.settings)
    return result.settings
  }, [])

  const resolvedTheme = resolveTheme(settings, osDark)

  return { settings, set, reset, resolvedTheme }
}
