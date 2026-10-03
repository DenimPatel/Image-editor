/**
 * 3D LUT looks. The hald PNGs are fetched lazily from `public/luts/` on first
 * use so the initial bundle stays small; the in-memory cache makes re-selecting
 * a look instant.
 *
 * A missing look is a *reported* failure, not a silent `null`: `LUT3D_FRAG` is
 * skipped when no texture is resident, so returning `null` made 24 presets look
 * like they worked while changing nothing. `loadLut` rejects instead, and the
 * renderer turns that into a surfaced message.
 */

import { decodeImageBlob } from '../lib/decode'

export type LutPreset = {
  id: string
  label: string
  family: 'Film' | 'Cinematic' | 'Mono' | 'Creative'
}

export const LUT_PRESETS: LutPreset[] = [
  { id: 'kodak-portra', label: 'Portra', family: 'Film' },
  { id: 'kodak-gold', label: 'Gold', family: 'Film' },
  { id: 'kodak-ektar', label: 'Ektar', family: 'Film' },
  { id: 'fuji-velvia', label: 'Velvia', family: 'Film' },
  { id: 'fuji-superia', label: 'Superia', family: 'Film' },
  { id: 'fuji-provia', label: 'Provia', family: 'Film' },
  { id: 'cinestill-800t', label: 'CineStill 800T', family: 'Film' },
  { id: 'agfa-vista', label: 'Vista', family: 'Film' },
  { id: 'polaroid-600', label: 'Polaroid', family: 'Film' },
  { id: 'lomo', label: 'Lomo', family: 'Creative' },
  { id: 'cross-process', label: 'Cross Process', family: 'Creative' },
  { id: 'bleach-bypass', label: 'Bleach Bypass', family: 'Creative' },
  { id: 'vintage-fade', label: 'Vintage Fade', family: 'Creative' },
  { id: 'faded-matte', label: 'Faded Matte', family: 'Creative' },
  { id: 'warm-cinema', label: 'Warm Cinema', family: 'Cinematic' },
  { id: 'cool-cinema', label: 'Cool Cinema', family: 'Cinematic' },
  { id: 'teal-orange', label: 'Teal & Orange', family: 'Cinematic' },
  { id: 'moody', label: 'Moody', family: 'Cinematic' },
  { id: 'cyberpunk', label: 'Cyberpunk', family: 'Cinematic' },
  { id: 'infrared', label: 'Infrared', family: 'Creative' },
  { id: 'noir', label: 'Noir', family: 'Mono' },
  { id: 'sepia', label: 'Sepia', family: 'Mono' },
  { id: 'pastel', label: 'Pastel', family: 'Creative' },
  { id: 'vivid', label: 'Vivid', family: 'Creative' },
]

export const LUT_SIZE = 33

/**
 * A LUT strip is `LUT_SIZE` blue slices of `LUT_SIZE x LUT_SIZE`, laid out
 * horizontally (`LUT3D_FRAG` addresses it as `size*size` texels wide). That
 * makes 1089 the smallest long edge a decode may keep without resampling the
 * strip out from under the shader's `u_size`.
 */
export const LUT_STRIP_LONG_EDGE = LUT_SIZE * LUT_SIZE

/** 33 slices x 33x33, with headroom for a padded or stacked variant. */
export const LUT_MAX_PIXELS = LUT_SIZE * LUT_SIZE * LUT_SIZE * 4

export class LutLoadError extends Error {
  readonly id: string
  readonly status: number | null

  constructor(id: string, status: number | null, reason: string) {
    super(`Look "${id}" could not be loaded: ${reason}`)
    this.name = 'LutLoadError'
    this.id = id
    this.status = status
  }
}

const cache = new Map<string, ImageBitmap>()
const failures = new Map<string, LutLoadError>()
const pending = new Map<string, Promise<ImageBitmap>>()

export function lutUrl(id: string): string {
  return `${import.meta.env.BASE_URL}luts/${id}.png`
}

export function getLut(id: string): ImageBitmap | undefined {
  return cache.get(id)
}

/** The last load failure for `id`, if it ever failed. */
export function getLutFailure(id: string): LutLoadError | undefined {
  return failures.get(id)
}

export async function loadLut(id: string): Promise<ImageBitmap> {
  const existing = cache.get(id)
  if (existing) return existing
  const inFlight = pending.get(id)
  if (inFlight) return inFlight

  const promise = (async () => {
    try {
      const response = await fetch(lutUrl(id))
      if (!response.ok) {
        throw new LutLoadError(id, response.status, `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      // decodeImageBlob applies the EXIF orientation a bare createImageBitmap
      // ignores and refuses an oversized body before the pixels are allocated.
      const bitmap = await decodeImageBlob(blob, {
        maxEdge: LUT_STRIP_LONG_EDGE,
        maxPixels: LUT_MAX_PIXELS,
      })
      cache.set(id, bitmap)
      failures.delete(id)
      return bitmap
    } catch (error) {
      const failure =
        error instanceof LutLoadError
          ? error
          : new LutLoadError(id, null, error instanceof Error ? error.message : 'unknown error')
      failures.set(id, failure)
      throw failure
    } finally {
      pending.delete(id)
    }
  })()

  pending.set(id, promise)
  return promise
}

export function clearLutCache(): void {
  for (const bitmap of cache.values()) bitmap.close()
  cache.clear()
  failures.clear()
}
