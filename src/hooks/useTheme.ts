import { useCallback } from 'react'
import type { ThemePreference } from '../lib/appearance'
import { useAppearance } from './useAppearance'

export type UseThemeResult = {
  /** The theme actually in force, with `system` already resolved. */
  theme: 'light' | 'dark'
  isDark: boolean
  toggle: () => void
  /** What the user chose, including `system`. */
  preference: ThemePreference
}

/**
 * The theme slice of `useAppearance`, kept as its own export so `ThemeToggle`
 * reads `isDark`/`toggle` and does not have to learn the shape of the other
 * five settings.
 *
 * This hook used to write `data-theme` itself, from its own copy of the
 * `image-editor-theme` key, while the `<head>` bootstrap script wrote the same
 * attribute from the same key. Two writers to one attribute is a race whose
 * winner depends on mount order, and it is why the old model could not grow
 * past one setting: five more would have meant five more races. It writes
 * nothing now — `useAppearance` is the only writer of the attribute, and
 * `appearanceAttributes` is the only place the name is spelled.
 */
export function useTheme(): UseThemeResult {
  const { settings, set, resolvedTheme } = useAppearance()
  const toggle = useCallback(() => {
    set({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })
  }, [resolvedTheme, set])
  return {
    theme: resolvedTheme,
    isDark: resolvedTheme === 'dark',
    toggle,
    preference: settings.theme,
  }
}
