import { useSyncExternalStore } from 'react'

/** The breakpoint where the bottom sheet becomes the desktop side inspector. */
export const INSPECTOR_MEDIA = '(min-width: 900px)'

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(query)
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
  // Safari < 14 and the jsdom shim only expose the deprecated API.
  list.addListener(onChange)
  return () => list.removeListener(onChange)
}

/**
 * Live `matchMedia` as a boolean. `useSyncExternalStore` is the right primitive
 * here: matchMedia is an external store, and the snapshot has to be read during
 * render so a viewport change that lands mid-commit cannot tear.
 *
 * Presentation logic that CSS already branches on (the sheet's detents, the
 * canvas gutter) is allowed to branch on this in JS too, because an inline
 * `height` outranks any stylesheet rule and only the component can stop writing
 * one.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false,
    () => false,
  )
}

/** True when the sheet is presented as the full-height desktop inspector. */
export function useIsInspector(): boolean {
  return useMediaQuery(INSPECTOR_MEDIA)
}

/**
 * True on touch-first devices. `capture` on a file input is only honoured where
 * there is a camera to honour it with: desktop browsers ignore the attribute and
 * open the ordinary picker, so a "Take a photo" button there would be a second
 * button that does exactly what "browse" already does.
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(pointer: coarse)')
}
