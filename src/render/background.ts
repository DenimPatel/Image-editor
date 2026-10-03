/**
 * Geometry for `background.mode === 'image'`.
 *
 * `Background.fit` (`'cover' | 'contain'`) and `Background.blur` were declared
 * in the model, migrated, defaulted and counted by `hasEdits` — and read by
 * nothing. `src/gl/renderer.ts` uploaded only `color`, the gradient and a
 * `u_mode` computed as `gradient ? 2 : color ? 1 : 0`, so `'image'` was
 * indistinguishable from `'none'` and fell through to `u_color`.
 *
 * This module is the reference both engines use to place the image. The GL
 * backend computes the same numbers in `BACKGROUND_FRAG`; keeping the formula
 * here (rather than only in the shader) is what lets a test say "cover and
 * contain put the image somewhere different" without a GPU.
 */
import type { Background, Size } from '../model/types'

/** `u_fit` in `BACKGROUND_FRAG`. The order is the contract. */
export const BACKGROUND_FITS = ['cover', 'contain'] as const

export type BackgroundFit = (typeof BACKGROUND_FITS)[number]

/** `u_mode` for the image background. */
export const BACKGROUND_MODE_IMAGE = 3

export function fitIndex(fit: BackgroundFit | string): number {
  return fit === 'contain' ? 1 : 0
}

/**
 * How far the image is scaled relative to 1:1, given the frame it is being
 * laid into. `cover` grows until the smaller axis is full; `contain` shrinks
 * until the larger axis fits.
 */
export function backgroundScale(fit: BackgroundFit | string, frame: Size, image: Size): number {
  const fw = Math.max(1, frame.width)
  const fh = Math.max(1, frame.height)
  const iw = Math.max(1, image.width)
  const ih = Math.max(1, image.height)
  const frameAspect = fw / fh
  const imageAspect = iw / ih
  const base = fh / ih
  const ratio = frameAspect / imageAspect
  return base * (fitIndex(fit) === 1 ? Math.min(ratio, 1) : Math.max(ratio, 1))
}

/**
 * Where a frame pixel lands in the image, in image uv (x right, y down, the
 * same orientation the image texture is uploaded with). Returns uv outside
 * 0..1 wherever the image does not reach, which is the `contain` letterbox.
 */
export function backgroundImageUv(
  fit: BackgroundFit | string,
  frame: Size,
  image: Size,
  px: number,
  py: number,
): { u: number; v: number } {
  const scale = backgroundScale(fit, frame, image)
  const iw = Math.max(1, image.width)
  const ih = Math.max(1, image.height)
  return { u: px / (scale * iw) + 0.5, v: py / (scale * ih) + 0.5 }
}

/** True when the frame pixel falls outside the image and the matte shows. */
export function backgroundOutsideImage(uv: { u: number; v: number }): boolean {
  return !(uv.u >= 0 && uv.u <= 1 && uv.v >= 0 && uv.v <= 1)
}

/**
 * Blur radius in output pixels for a 0..1 amount. Authored against the proxy
 * preview, so it is scaled the same way every other kernel radius is.
 */
export function backgroundBlurRadiusPx(blur: number, pixelScale: number): number {
  const amount = Number.isFinite(blur) ? Math.min(1, Math.max(0, blur)) : 0
  return amount * 12 * Math.max(1, pixelScale)
}

/** The eight directions the background blur samples along. */
export const BACKGROUND_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.70710678, 0.70710678],
  [0, 1],
  [-0.70710678, 0.70710678],
  [-1, 0],
  [-0.70710678, -0.70710678],
  [0, -1],
  [0.70710678, -0.70710678],
]

/** The rings the background blur samples at, as multiples of the radius. */
export const BACKGROUND_RINGS: readonly number[] = [0.3, 0.7, 1.2, 1.8]

/**
 * Whether a subject matte exists for this document.
 *
 * The matte is destructive: it replaces `doc.source`, and only
 * `BackgroundPanel`'s "Remove background" ever produces one. Without it the
 * source is opaque everywhere, so `mix(bg, texel.rgb, texel.a)` in
 * `BACKGROUND_FRAG` returns the source unchanged and *every* background choice
 * is a silent no-op. This is the predicate the panel needs to say so out loud
 * instead of shipping a control that does nothing.
 */
export function backgroundHasMatte(background: Background): boolean {
  return background.removed
}

/**
 * True when a background is actually composited behind the subject. False for
 * the cut-out and no-matte cases, which is exactly when the pass is a no-op.
 */
export function backgroundComposites(background: Background): boolean {
  if (background.mode === 'none') return false
  return backgroundHasMatte(background)
}

/**
 * Why a chosen background is not showing, for the panel's copy and a toast.
 *
 * Names the button that fixes it rather than the compositing term behind it: the
 * reason the replacement is inert is that nothing has been lifted off the
 * background yet, and "Remove background" is the control that does that. `matte`
 * is the word a VFX shot would use and the word `src/lib/copy.ts` bans from
 * anything a user reads.
 */
export function backgroundBlockedReason(background: Background): string | null {
  if (background.mode === 'none') return null
  if (!backgroundHasMatte(background)) {
    return 'Nothing has been removed from the background yet — use Remove background first, or the replacement has nothing to show through.'
  }
  return null
}
