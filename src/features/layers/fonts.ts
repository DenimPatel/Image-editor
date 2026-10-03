/**
 * Self-hosted fonts, lazily registered with the FontFace API. Nothing is
 * fetched from Google Fonts at runtime, so the "nothing leaves your device"
 * claim holds; the woff2 files themselves are committed to `public/fonts/` and
 * pinned by sha256 in `models.lock.json` (`npm run assets:verify` fails the
 * build if a catalogue entry has no file).
 *
 * A load that fails used to be swallowed by an empty `catch`, so all 14 entries
 * in the Text panel rendered in `system-ui` and nothing said so. `ensureFont`
 * now returns a result and records the failure, which is what lets the panel
 * badge an unavailable font instead of quietly lying about it.
 */

export type FontDef = {
  id: string
  label: string
  family: string
  url: string
  weight: number
  style: 'normal' | 'italic'
  /** SPDX id, mirrored from `models.lock.json`; `assets:verify` checks they agree. */
  licence: string
}

export const FONTS: FontDef[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: 'IE Inter',
    url: 'fonts/inter.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'inter-bold',
    label: 'Inter Bold',
    family: 'IE Inter',
    url: 'fonts/inter-bold.woff2',
    weight: 700,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'playfair',
    label: 'Playfair',
    family: 'IE Playfair',
    url: 'fonts/playfair.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'oswald',
    label: 'Oswald',
    family: 'IE Oswald',
    url: 'fonts/oswald.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    family: 'IE Montserrat',
    url: 'fonts/montserrat.woff2',
    weight: 600,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'lora',
    label: 'Lora',
    family: 'IE Lora',
    url: 'fonts/lora.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'roboto-mono',
    label: 'Mono',
    family: 'IE Mono',
    url: 'fonts/roboto-mono.woff2',
    weight: 400,
    style: 'normal',
    licence: 'Apache-2.0',
  },
  {
    id: 'caveat',
    label: 'Caveat',
    family: 'IE Caveat',
    url: 'fonts/caveat.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'pacifico',
    label: 'Pacifico',
    family: 'IE Pacifico',
    url: 'fonts/pacifico.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'bebas',
    label: 'Bebas',
    family: 'IE Bebas',
    url: 'fonts/bebas.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'dm-serif',
    label: 'DM Serif',
    family: 'IE DMSerif',
    url: 'fonts/dm-serif.woff2',
    weight: 400,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'IE SpaceGrotesk',
    url: 'fonts/space-grotesk.woff2',
    weight: 500,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'archivo',
    label: 'Archivo',
    family: 'IE Archivo',
    url: 'fonts/archivo.woff2',
    weight: 600,
    style: 'normal',
    licence: 'OFL-1.1',
  },
  {
    id: 'barlow',
    label: 'Barlow',
    family: 'IE Barlow',
    url: 'fonts/barlow.woff2',
    weight: 500,
    style: 'normal',
    licence: 'OFL-1.1',
  },
]

export const DEFAULT_FONT_ID = 'inter'

export function fontById(fontId: string): FontDef | undefined {
  return FONTS.find((font) => font.id === fontId)
}

export function fontFamily(fontId: string): string {
  return fontById(fontId)?.family ?? 'system-ui, sans-serif'
}

export class FontUnavailableError extends Error {
  readonly id: string
  readonly url: string

  constructor(id: string, url: string, reason: string) {
    super(`Font "${id}" could not be loaded from ${url}: ${reason}`)
    this.name = 'FontUnavailableError'
    this.id = id
    this.url = url
  }
}

export type FontLoadResult =
  { ok: true; id: string } | { ok: false; id: string; error: FontUnavailableError }

const loaded = new Set<string>()
const failures = new Map<string, FontUnavailableError>()

/** The last failure for `id`, if it ever failed. A UI reads this to badge the entry. */
export function getFontFailure(fontId: string): FontUnavailableError | undefined {
  return failures.get(fontId)
}

/** True once the face is in `document.fonts`; false for unknown or broken ids. */
export function isFontAvailable(fontId: string): boolean {
  return loaded.has(fontId)
}

/**
 * Load a font and report what happened. Callers that only care about the happy
 * path can keep ignoring the return value, but the ones that *should* badge an
 * unavailable font now have something to read.
 */
export async function ensureFont(fontId: string): Promise<FontLoadResult> {
  const font = fontById(fontId)
  if (!font) {
    const error = new FontUnavailableError(fontId, '', 'not in the catalogue')
    failures.set(fontId, error)
    return { ok: false, id: fontId, error }
  }
  if (loaded.has(font.id)) return { ok: true, id: font.id }
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    const error = new FontUnavailableError(font.id, font.url, 'the FontFace API is unavailable')
    failures.set(font.id, error)
    return { ok: false, id: font.id, error }
  }
  const url = `${import.meta.env.BASE_URL}${font.url}`
  try {
    const face = new FontFace(font.family, `url(${url})`, {
      weight: String(font.weight),
      style: font.style,
    })
    await face.load()
    document.fonts.add(face)
    loaded.add(font.id)
    failures.delete(font.id)
    return { ok: true, id: font.id }
  } catch (error) {
    // Recorded, not swallowed: the canvas still falls back to the system stack,
    // but the panel can now say which entry is the problem.
    const failure = new FontUnavailableError(
      font.id,
      url,
      error instanceof Error ? error.message : 'unknown error',
    )
    failures.set(font.id, failure)
    return { ok: false, id: font.id, error: failure }
  }
}

/** Test seam: forget everything `ensureFont` learned. */
export function resetFontCache(): void {
  loaded.clear()
  failures.clear()
}
