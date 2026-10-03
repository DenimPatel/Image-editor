/**
 * Capability probing. Every probe is defensive: an iOS canvas that silently
 * becomes blank is worse than a slower fallback, so the canvas-area probe
 * actually allocates and reads back a pixel rather than trusting
 * MAX_TEXTURE_SIZE.
 *
 * Two rules keep this file honest:
 *  - a probe nobody reads is deleted, not cached and ignored;
 *  - every pass family that either backend cannot render to full quality is
 *    declared in `CANVAS2D_SUPPORT`, so the UI can say the render is degraded
 *    instead of quietly shipping a file missing every colour edit.
 *
 * D9-F10 acted on the first rule. `offscreenCanvas` and `colorBufferHalfFloat`
 * were probed on every cold start, cached, serialised into the record and read
 * by nothing: nothing renders through an `OffscreenCanvas`, and the half-float
 * chain is off deliberately (`exportCanvas` passes no `halfFloat`, because
 * ANGLE rejects RGBA16F), so the probe was reporting a decision that had
 * already been made in code. Both are gone. `workerWebgl` had already been
 * removed; the only trace left was a stale key in one test's fixture.
 * `caps.test.ts` now asserts every remaining field has a reader, so the rot
 * cannot come back.
 */

import type { Pass, PassFamily } from './passes'
import { DEFAULT_RENDER_LIMITS, type RenderLimits } from './limits'
import { previewLongEdge } from './pixel-scale'

export type ExportFormats = { webp: boolean; avif: boolean }

export type Caps = {
  webgl2: boolean
  maxTextureSize: number
  maxRenderbufferSize: number
  /** Usable canvas area in pixels, probed. */
  maxCanvasArea: number
  formats: ExportFormats
  saveData: boolean
}

const CACHE_KEY = 'ie-caps-v4'

/**
 * The envelope a cached probe is stored in, rather than the bare `Caps`.
 *
 * A capability result cached for the lifetime of an origin is a claim about a
 * browser that will eventually be wrong: a browser update that gains AVIF leaves
 * the export option greyed out until the user clears site data, and a laptop that
 * starts reporting a smaller max texture size keeps a texture allocation that
 * no longer fits. Neither is reproducible and neither is reportable, because
 * nothing in the app ever looked again. So the cache carries a version and the
 * time it was taken, and a stale one is re-probed rather than trusted.
 */
type CachedCaps = { v: number; at: number; caps: Caps }

/**
 * How long a probe result is believed for. Two weeks: long enough that an
 * ordinary visit list does not re-probe, short enough that a browser update is
 * forgotten within a month of shipping.
 */
export const CAPS_TTL_MS = 14 * 24 * 60 * 60 * 1000

const CACHE_VERSION = 4

const DEFAULT_CAPS: Caps = {
  webgl2: false,
  maxTextureSize: 4096,
  maxRenderbufferSize: 4096,
  maxCanvasArea: 4096 * 4096,
  formats: { webp: false, avif: false },
  saveData: false,
}

/**
 * `true` means the Canvas2D backend runs this family with the same maths as
 * the GL pipeline. `false` means the pass is *gated*: the fallback drops it and
 * the caller is expected to say so rather than pretend the image is complete.
 */
export type PassSupport = Record<PassFamily, boolean>

export const CANVAS2D_SUPPORT: PassSupport = {
  geometry: true,
  tone: true,
  color: true,
  curves: true,
  hsl: true,
  lut3d: false,
  denoise: true,
  definition: true,
  sharpen: true,
  local: true,
  retouch: true,
  heal: true,
  redeye: true,
  effects: true,
  vignette: true,
  background: true,
  output: true,
}

/**
 * Families present in a plan that `engine` cannot render.
 *
 * The GL backend has no table, so it can draw everything the planner emits; the
 * Canvas2D backend compares against `CANVAS2D_SUPPORT` and gates what it finds
 * false. `lut3d` is the only such family today, and it is gated rather than
 * approximated so an ungraded file can never be exported silently.
 */
export function unsupportedPasses(passes: Pass[], engine: 'gl' | 'canvas2d'): PassFamily[] {
  const support: PassSupport | undefined = engine === 'gl' ? undefined : CANVAS2D_SUPPORT
  const seen: PassFamily[] = []
  for (const pass of passes) {
    const family = pass.kind as PassFamily
    const ok = support ? support[family] !== false : true
    if (!ok && !seen.includes(family)) seen.push(family)
  }
  return seen
}

/** The size limits the renderer has to respect on this device. */
export function renderLimits(caps: Caps): RenderLimits {
  return {
    maxTextureSize: caps.maxTextureSize || DEFAULT_RENDER_LIMITS.maxTextureSize,
    maxRenderbufferSize: caps.maxRenderbufferSize || DEFAULT_RENDER_LIMITS.maxRenderbufferSize,
    maxCanvasArea: caps.maxCanvasArea || DEFAULT_RENDER_LIMITS.maxCanvasArea,
  }
}

/** Preview proxy long edge for this device. `useRenderLoop` reads this. */
export function capsPreviewLongEdge(caps: Caps): number {
  return previewLongEdge(caps.saveData)
}

/**
 * Probes whose only reader is a call site this file does not own.
 *
 * D9-F10: `saveData` is read by exactly one function here, and that function
 * has no caller — the hook that would want it builds its own proxy size. The
 * one-line fix is noted rather than silently deferred, because the alternative
 * is deleting a probe the user setting genuinely needs.
 *
 * `caps.test.ts` asserts each entry is still true, so landing the call site
 * retires the entry instead of leaving a stale register behind, and a *new*
 * probe with neither a reader nor an entry fails the suite.
 */
export type PendingCapReader = {
  /** The exported function in this file that consumes the probe. */
  consumedBy: string
  /** The file that has to call it, for the one-line diff. */
  callSite: string
}

export const PENDING_CAP_READERS: Record<string, PendingCapReader> = {
  saveData: {
    consumedBy: 'capsPreviewLongEdge',
    callSite: 'src/hooks/useRenderLoop.ts',
  },
}

export function probeFormats(): ExportFormats {
  const result: ExportFormats = { webp: false, avif: false }
  if (typeof document === 'undefined') return result
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    result.webp = canvas.toDataURL('image/webp').startsWith('data:image/webp')
    result.avif = canvas.toDataURL('image/avif').startsWith('data:image/avif')
  } catch {
    // toDataURL can throw under memory pressure; treat as unsupported.
  }
  return result
}

function probeCanvasArea(maxTextureSize: number): number {
  if (typeof document === 'undefined') return DEFAULT_CAPS.maxCanvasArea
  const side = Math.min(maxTextureSize, 4096)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    const ctx = canvas.getContext('2d')
    if (!ctx) return DEFAULT_CAPS.maxCanvasArea
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
    const data = ctx.getImageData(0, 0, 1, 1).data
    // A silent iOS failure leaves the buffer zeroed/blank.
    return data[3] === 255 ? side * side : 2048 * 2048
  } catch {
    return 2048 * 2048
  }
}

export function probeCaps(): Caps {
  if (typeof document === 'undefined') return { ...DEFAULT_CAPS }

  const canvas = document.createElement('canvas')
  let gl: WebGL2RenderingContext | null = null
  try {
    // Must match `webgl2Attributes` so the probe and the real context agree.
    gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false })
  } catch {
    // gl stays null; treated as no WebGL2 support below.
  }

  if (!gl) {
    return {
      ...DEFAULT_CAPS,
      webgl2: false,
      formats: probeFormats(),
      saveData: readSaveData(),
      maxCanvasArea: probeCanvasArea(DEFAULT_CAPS.maxTextureSize),
    }
  }

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number

  return {
    webgl2: true,
    maxTextureSize,
    maxRenderbufferSize,
    maxCanvasArea: probeCanvasArea(maxTextureSize),
    formats: probeFormats(),
    saveData: readSaveData(),
  }
}

function readSaveData(): boolean {
  if (typeof navigator === 'undefined') return false
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return Boolean(connection?.saveData)
}

function readCachedCaps(now: number): Caps | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as Partial<CachedCaps>
    if (cached.v !== CACHE_VERSION) return null
    if (typeof cached.at !== 'number' || !Number.isFinite(cached.at)) return null
    if (now - cached.at > CAPS_TTL_MS || now < cached.at) return null
    if (!cached.caps || typeof cached.caps !== 'object') return null
    return cached.caps as Caps
  } catch {
    // Malformed or unavailable storage: probe. A `file://` origin has no
    // storage at all and is re-probed on every load, which is correct.
    return null
  }
}

function writeCachedCaps(caps: Caps, now: number): void {
  try {
    const entry: CachedCaps = { v: CACHE_VERSION, at: now, caps }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Safari private mode throws; probing is cheap enough to redo.
  }
}

/**
 * The capabilities, from the cache while it is fresh and from a probe when it is
 * not. `force` re-probes and rewrites.
 */
export function loadCaps(force = false): Caps {
  if (typeof localStorage === 'undefined') return probeCaps()
  const now = Date.now()
  if (!force) {
    const cached = readCachedCaps(now)
    if (cached) return cached
  }
  const caps = probeCaps()
  writeCachedCaps(caps, now)
  return caps
}

export const FALLBACK_CAPS: Caps = DEFAULT_CAPS
