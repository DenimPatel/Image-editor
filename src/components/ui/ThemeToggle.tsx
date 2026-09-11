import { useTheme } from '../../hooks/useTheme';
import { MoonIcon, SunIcon } from './icons';

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <SunIcon className="theme-toggle__icon" /> : <MoonIcon className="theme-toggle__icon" />}
    </button>
  );
}
