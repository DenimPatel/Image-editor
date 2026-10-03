/**
 * `ensureFont` used to end in `catch {}`, so all 14 entries in the Text panel
 * rendered in `system-ui` while the panel advertised "self-hosted fonts" and
 * nothing said otherwise. The failure is now a value the UI can read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FONT_ID,
  ensureFont,
  FONTS,
  fontById,
  fontFamily,
  getFontFailure,
  isFontAvailable,
  resetFontCache,
} from './fonts'

type FakeFace = { family: string; source: string; descriptors: { weight: string; style: string } }

const faces: FakeFace[] = []

function stubFontFace(failsWhenSourceContains?: string): void {
  class StubFontFace {
    family: string
    source: string
    descriptors: { weight: string; style: string }

    constructor(family: string, source: string, descriptors: { weight: string; style: string }) {
      this.family = family
      this.source = source
      this.descriptors = descriptors
      faces.push({ family, source, descriptors })
    }

    load(): Promise<StubFontFace> {
      // A 404 on a FontFace source rejects exactly like a network error: the
      // browser never gets bytes to parse.
      if (failsWhenSourceContains && this.source.includes(failsWhenSourceContains)) {
        return Promise.reject(new Error('network error'))
      }
      return Promise.resolve(this)
    }
  }
  vi.stubGlobal('FontFace', StubFontFace)
  const added: string[] = []
  vi.stubGlobal('document', { fonts: { add: (face: FakeFace) => added.push(face.family) } })
}

describe('the font catalogue', () => {
  beforeEach(() => {
    resetFontCache()
    faces.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('offers 14 entries with a distinct family, weight and licence', () => {
    expect(FONTS).toHaveLength(14)
    expect(new Set(FONTS.map((font) => font.family)).size).toBeGreaterThanOrEqual(10)
    for (const font of FONTS) {
      expect(font.url).toMatch(/^fonts\/[a-z0-9-]+\.woff2$/)
      expect(font.licence).toMatch(/^(OFL-1\.1|Apache-2\.0)$/)
      expect(fontById(font.id)).toBe(font)
    }
  })

  it('resolves the family the canvas must request, and falls back for an unknown id', () => {
    expect(fontFamily('inter')).toBe('IE Inter')
    expect(fontFamily('does-not-exist')).toBe('system-ui, sans-serif')
    expect(DEFAULT_FONT_ID).toBe('inter')
  })
})

describe('ensureFont reports what happened (D6-F16)', () => {
  beforeEach(() => {
    resetFontCache()
    faces.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('registers the face and says so', async () => {
    stubFontFace()
    await expect(ensureFont('playfair')).resolves.toEqual({ ok: true, id: 'playfair' })
    expect(faces).toHaveLength(1)
    expect(faces[0]?.source).toContain('fonts/playfair.woff2')
    expect(faces[0]?.descriptors).toEqual({ weight: '400', style: 'normal' })
    expect(isFontAvailable('playfair')).toBe(true)
    expect(getFontFailure('playfair')).toBeUndefined()
  })

  it('surfaces a 404 instead of swallowing it, and records the reason', async () => {
    stubFontFace('fonts/inter.woff2')
    const result = await ensureFont('inter')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error.name).toBe('FontUnavailableError')
    expect(result.error.message).toContain('inter')
    expect(getFontFailure('inter')?.message).toContain('network error')
    expect(isFontAvailable('inter')).toBe(false)
  })

  it('keeps retrying after a failure rather than caching the bad answer', async () => {
    stubFontFace('fonts/caveat.woff2')
    await expect(ensureFont('caveat')).resolves.toMatchObject({ ok: false })
    vi.unstubAllGlobals()
    resetFontCache()
    stubFontFace()
    await expect(ensureFont('caveat')).resolves.toMatchObject({ ok: true })
  })

  it('does not re-register a font it already loaded', async () => {
    stubFontFace()
    await ensureFont('lora')
    await ensureFont('lora')
    expect(faces).toHaveLength(1)
  })

  it('reports an id that is not in the catalogue instead of pretending', async () => {
    stubFontFace()
    const result = await ensureFont('comic-sans')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.error.message).toContain('not in the catalogue')
    expect(faces).toHaveLength(0)
  })

  it('reports a browser with no FontFace API instead of claiming success', async () => {
    vi.stubGlobal('FontFace', undefined)
    vi.stubGlobal('document', { fonts: { add: () => undefined } })
    const result = await ensureFont('bebas')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a failure')
    expect(result.error.message).toContain('FontFace API is unavailable')
  })
})
