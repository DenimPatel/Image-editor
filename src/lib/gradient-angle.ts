/**
 * CPU twin of the background gradient projection in `BACKGROUND_FRAG`.
 *
 * `v_uv` is bottom-up (the leading geometry pass writes the source bottom into
 * framebuffer row 0), so every screen-space direction here is expressed in
 * *top-down* coordinates: `y = 0` is the top of the image.
 */

export type GradientDirection = { x: number; y: number }

export type Uv = { x: number; y: number }

/**
 * Unit direction the gradient runs in, in top-down screen space.
 * `0` runs top -> bottom, `90` runs left -> right, matching the
 * left-to-right / clockwise convention the Angle slider is labelled with.
 */
export function gradientDirection(angleDeg: number): GradientDirection {
  const radians = (angleDeg * Math.PI) / 180
  return { x: Math.sin(radians), y: Math.cos(radians) }
}

/**
 * Where `uv` falls on the from -> to ramp for `angleDeg`, clamped to 0..1.
 *
 * The projection is centred on the image so a diagonal angle still spans the
 * whole ramp instead of saturating a third of the way in; at 0 and 90 degrees
 * the centring cancels out, so `t` is exactly `top-down y` and `x`.
 */
export function gradientStop(uv: Uv, angleDeg: number): number {
  const direction = gradientDirection(angleDeg)
  const topDownY = 1 - uv.y
  const projected = (uv.x - 0.5) * direction.x + (topDownY - 0.5) * direction.y
  return Math.min(1, Math.max(0, projected + 0.5))
}
