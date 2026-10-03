import type { Size } from '../model/types'
import { computeTiles, type Tile } from './tiling'

/**
 * The hard limits a render has to fit inside. Every field is a probed cap
 * (`src/gl/caps.ts`); nothing here guesses, and nothing here allocates — the
 * renderer asks what fits and tiles the rest.
 */
export type RenderLimits = {
  /** Per-side texture edge (`MAX_TEXTURE_SIZE`). */
  maxTextureSize: number
  /** Per-side renderbuffer edge (`MAX_RENDERBUFFER_SIZE`). */
  maxRenderbufferSize: number
  /** Total canvas pixels this browser will actually back with memory. */
  maxCanvasArea: number
}

/** Conservative limits for a caller that has not probed anything. */
export const DEFAULT_RENDER_LIMITS: RenderLimits = {
  maxTextureSize: 4096,
  maxRenderbufferSize: 4096,
  maxCanvasArea: 4096 * 4096,
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function sanitizeLimits(limits: Partial<RenderLimits> | undefined): RenderLimits {
  return {
    maxTextureSize: positive(limits?.maxTextureSize ?? 0, DEFAULT_RENDER_LIMITS.maxTextureSize),
    maxRenderbufferSize: positive(
      limits?.maxRenderbufferSize ?? 0,
      DEFAULT_RENDER_LIMITS.maxRenderbufferSize,
    ),
    maxCanvasArea: positive(limits?.maxCanvasArea ?? 0, DEFAULT_RENDER_LIMITS.maxCanvasArea),
  }
}

/**
 * Largest aspect-preserving size no larger than `size` that still fits the
 * canvas limits. Returns `size` untouched when it already fits, so the common
 * case is not resampled by a rounding error.
 */
export function fitRenderSize(size: Size, limits: RenderLimits): Size {
  const safe = sanitizeLimits(limits)
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  const scale = Math.min(
    1,
    safe.maxTextureSize / width,
    safe.maxRenderbufferSize / height,
    Math.sqrt(safe.maxCanvasArea / (width * height)),
  )
  if (scale >= 1) return { width, height }
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

/** True when `size` has to be tiled (or clamped) to render at all. */
export function exceedsRenderLimits(size: Size, limits: RenderLimits): boolean {
  const fitted = fitRenderSize(size, limits)
  return fitted.width !== Math.round(size.width) || fitted.height !== Math.round(size.height)
}

/**
 * The per-side edge a single render target may use. Framebuffer textures are
 * bound by the smaller of the texture and renderbuffer ceilings, and by total
 * area only insofar as the per-side limit implies it — a canvas-area ceiling
 * says nothing about an offscreen texture, so it is applied to the canvas
 * instead (see `fitRenderSize`).
 */
export function renderTargetEdge(limits: RenderLimits): number {
  const safe = sanitizeLimits(limits)
  return Math.max(1, Math.min(safe.maxTextureSize, safe.maxRenderbufferSize))
}

export type RenderPlan = {
  /** Canvas backing store; may be smaller than the request if it cannot fit. */
  canvas: Size
  /** True when the canvas had to be shrunk to fit the probed limits. */
  clamped: boolean
  /** Non-overlapping cores covering `canvas` exactly; one entry means no tiling. */
  tiles: Tile[]
}

/**
 * Decide how a render of `size` pixels is going to be executed: the canvas
 * size it will use and the tiles the pass chain runs over.
 */
export function planRender(size: Size, limits: RenderLimits, halo: number): RenderPlan {
  const canvas = fitRenderSize(size, limits)
  const edge = renderTargetEdge(limits)
  const tiles = computeTiles(canvas.width, canvas.height, {
    maxArea: edge * edge,
    maxTextureSize: edge,
    halo: Math.max(0, Math.round(halo)),
  })
  return {
    canvas,
    clamped: canvas.width !== Math.round(size.width) || canvas.height !== Math.round(size.height),
    tiles,
  }
}
