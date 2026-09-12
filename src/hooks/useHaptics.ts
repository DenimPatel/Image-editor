import { useCallback } from 'react';

/**
 * Wraps `navigator.vibrate` and silently no-ops where it is unavailable
 * (notably iOS Safari, which never implemented it).
 */
export function useHaptics() {
  return useCallback((pattern: number | number[] = 8) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch {
      // Haptics are best-effort only.
    }
  }, []);
}
