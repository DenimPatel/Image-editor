import { useState } from 'react'
import { writeAppearance } from '../../lib/appearance'
import { useTheme } from '../../hooks/useTheme'
import { MoonGlyph, SunGlyph } from './icons'
import styles from './appearanceMenu.module.css'

/**
 * The button mounts the appearance hook itself rather than relying on whatever
 * else is on the page. `Nav` renders it, and `Nav` is only rendered by the Hub,
 * so a theme control anywhere else in the editor would be a dead control with
 * no state behind it — the attribute would stay whatever the `<head>` script
 * set and the click would do nothing visible.
 *
 * The toggle writes through `writeAppearance` rather than through
 * `useTheme().toggle` for one reason: only `writeAppearance` reports whether the
 * write landed, and a control that cannot say so is the same silent loss as a
 * preference that was never offered at all. When the browser refuses — Safari
 * private mode throws a `SecurityError` on any storage access — the icon still
 * changes for the session, and this says that the change is not something that
 * will still be there after a reload. The full settings panel says the same
 * thing for the other five settings; this is the one-line version, because the
 * nav has room for a line and not for a panel.
 */
export function ThemeToggle() {
  const { isDark } = useTheme()
  const [persisted, setPersisted] = useState(true)

  return (
    <span className={styles.anchor}>
      <button
        type="button"
        className="theme-toggle"
        onClick={() => {
          setPersisted(writeAppearance({ theme: isDark ? 'light' : 'dark' }).persisted)
        }}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? (
          <SunGlyph className="theme-toggle__icon" />
        ) : (
          <MoonGlyph className="theme-toggle__icon" />
        )}
      </button>
      {!persisted && (
        <span className={`${styles.warning} ${styles.navNotice}`} role="status">
          Not saved — this browser blocked local storage, so the choice lasts for this session only.
        </span>
      )}
    </span>
  )
}
