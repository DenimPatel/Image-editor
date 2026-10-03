/**
 * Roving tabindex: a row of related controls is one tab stop, and the arrow
 * keys move the single tab stop inside it. The two tabbable roles this stands
 * in for (`toolbar` and a toggle/radio `group`) both specify exactly this, and
 * without it a keyboard user needs 15 Tab presses to walk the Adjust rings.
 */

export type RovingOrientation = 'horizontal' | 'both'

export const ROVING_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'Home', 'End'])

/**
 * The index a key press moves to, or `null` when the key is not part of the
 * pattern (so the caller can let the browser have it). Wraps at both ends,
 * which is what the APG toolbar and radio-group patterns do.
 */
export function nextRovingIndex(
  key: string,
  index: number,
  count: number,
  orientation: RovingOrientation = 'horizontal',
): number | null {
  if (count <= 0) return null
  if (orientation === 'horizontal' && (key === 'ArrowDown' || key === 'ArrowUp')) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
