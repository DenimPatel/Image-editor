import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'image-editor-theme';

export function useTheme() {
  const [theme, setTheme] = useState<Theme | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'light' || stored === 'dark' ? stored : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === null) {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const current = prev ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // storage unavailable; theme still applies for this session
      }
      return next;
    });
  }, []);

  const isDark = theme === 'dark' || (theme === null && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return { theme, isDark, toggle };
}
