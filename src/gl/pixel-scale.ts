import type { Size } from '../model/types'

/**
 * Preview kernels are authored against a proxy preview, whose long edge is
 * capped at `PROXY_LONG_EDGE` (`computeProxySize` in `useRenderLoop`). An
 * export renders the same scene at `outputPx`, so a kernel radius expressed in
 * preview texels has to be multiplied by `outputPx / previewPx` or the slider
 * produces a visibly different image at the two sizes.
 *
 * Every resolution-dependent uniform in the GL backend is that factor, and
 * `src/render/cpu-passes.ts` applies the same one so the two backends agree.
 */
export const PROXY_LONG_EDGE = 2048

/** Budget browsers report when the user asks for less data. */
export const SAVE_DATA_LONG_EDGE = 1024

export function longEdge(size: Size): number {
  return Math.max(size.width, size.height)
}

/**
 * Kernel scale for a render of `size` pixels: 1 at the proxy cap, 3 for a
 * 6144 px export. Never below 1, because a preview larger than the cap still
 * has to look like the preview.
 */
export function pixelScale(size: Size): number {
  return Math.max(1, longEdge(size) / PROXY_LONG_EDGE)
}

/**
 * The preview proxy's long edge for a device, honouring `saveData`.
 * Kept here (not in the hook) so the cap is unit-testable.
 */
export function previewLongEdge(saveData: boolean): number {
  return saveData ? SAVE_DATA_LONG_EDGE : PROXY_LONG_EDGE
}
