/**
 * Where a committed look preview lives, and how big it is drawn.
 *
 * Its own module because `LookThumb.tsx` exports a component and a file that
 * exports a component *and* a helper cannot be fast-refreshed — and because the
 * path and the box are a contract with two other files: `scripts/
 * look-thumb-scene.mjs` writes at 144 x 96, and `lookThumb.module.css` lays the
 * result out at 72 x 48.
 */

/**
 * The 144x96 a thumbnail is authored at, drawn in a 72x48 box.
 *
 * 72 CSS px is the retina budget spent once. The chip's content box is 79.5px on
 * a 430px phone and 100px on the desktop inspector, so 72 sits inside the tight
 * one and centres in the roomy one.
 */
export const LOOK_THUMB_DISPLAY = { width: 72, height: 48 } as const

/**
 * Base-aware, exactly as `lutUrl` in src/gl/luts.ts resolves `public/luts/`.
 *
 * The app is served from `/Image-editor/` (`vite.config.ts` sets the base and
 * `router.tsx` uses it as the basename), so a root-relative `/look-thumbs/…` is
 * a 404 in every deployed copy and works only on `vite dev`.
 */
export function lookThumbUrl(id: string): string {
  return `${import.meta.env.BASE_URL}look-thumbs/${id}.png`
}
