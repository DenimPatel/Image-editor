import { describe, expect, it } from 'vitest'
import {
  NAME_TOKENS,
  buildArchiveName,
  buildExportName,
  describeTemplate,
  sanitizeStem,
} from './naming'

/**
 * D7-F17 — filename templating.
 *
 * The interesting cases are the unfillable ones. A template is user input, so a
 * token the file cannot supply has to disappear cleanly rather than print as
 * literal `{dpi}` or leave a pile of separators behind — and, above all, a name
 * must never contain a path separator once it is a ZIP entry.
 */

const CONTEXT = {
  fileName: 'Beach Sunset.jpg',
  width: 1920,
  height: 1280,
  format: 'jpeg',
  dpi: 300,
  now: new Date(2026, 8, 29, 10, 30),
} as const

/**
 * Assert a name carries nothing a filesystem or an unarchiver would reject.
 *
 * Checked by code point rather than by a regex character class, because the
 * characters that matter here are the invisible ones and a class that hides them
 * is a class nobody can review in a diff.
 */
function expectSafeName(name: string): void {
  for (const char of name) {
    const code = char.charCodeAt(0)
    const reserved = '/\\:*?<>"|'.includes(char)
    expect({ char, bad: reserved || code < 0x20 || code === 0x7f }).toEqual({ char, bad: false })
  }
}

describe('sanitizeStem', () => {
  it('drops directories, extensions and whitespace runs', () => {
    expect(sanitizeStem('Beach Sunset.jpg')).toBe('Beach Sunset')
    expect(sanitizeStem('holiday/2026/beach.png')).toBe('beach')
    expect(sanitizeStem('C:\\photos\\beach.jpeg')).toBe('beach')
    expect(sanitizeStem('  two   spaces.webp')).toBe('two spaces')
  })

  it('cannot produce a path separator or a control byte', () => {
    // The ZIP writer puts these straight into an archive, where a separator
    // becomes a directory and a control byte is rejected by some unarchivers.
    const control = String.fromCharCode(0x07, 0x1f)
    for (const hostile of [
      'a/b',
      'a\\b',
      'a:b',
      'a*b?c',
      'a b',
      `a${control[0]}b`,
      `a${control[1]}b`,
    ]) {
      // Checked by code point, not by a regex: the characters that matter
      // here are invisible, and a character class that hides them is a class
      // nobody can review.
      expectSafeName(sanitizeStem(hostile))
    }
  })

  it('falls back rather than returning an empty name', () => {
    expect(sanitizeStem('')).toBe('export')
    expect(sanitizeStem('...')).toBe('export')
    expect(sanitizeStem('.jpg')).toBe('export')
  })

  it('caps the length so a long name cannot hit a filesystem limit', () => {
    expect(sanitizeStem('x'.repeat(400))).toHaveLength(120)
  })
})

describe('buildExportName', () => {
  it('falls back to a self-describing default when there is no template', () => {
    expect(buildExportName('', CONTEXT)).toBe('Beach Sunset-1920x1280.jpg')
  })

  it('fills every token it can', () => {
    expect(buildExportName('{name}_{width}x{height}_{format}_{dpi}_{date}', CONTEXT)).toBe(
      'Beach Sunset_1920x1280_jpg_300_2026-09-29.jpg',
    )
  })

  it('fills {index} only when the export is part of a set', () => {
    expect(buildExportName('{name}-{index}', { ...CONTEXT, index: 2 })).toBe('Beach Sunset-2.jpg')
    // Without an index the token is dropped rather than printing a fake "1".
    expect(buildExportName('{name}-{index}', CONTEXT)).toBe('Beach Sunset.jpg')
  })

  it('drops {dpi} for a PDF, which has no density header', () => {
    // 72 pt per inch is the page box, not a stored DPI, so naming a file
    // "300dpi.pdf" would be a claim the file cannot support.
    const name = buildExportName('{name}-{dpi}', { ...CONTEXT, format: 'pdf' })
    expect(name).toBe('Beach Sunset.pdf')
  })

  it('collapses the separators a dropped token leaves behind', () => {
    expect(buildExportName('{name}--{dpi}--{date}', { ...CONTEXT, format: 'pdf' })).toBe(
      'Beach Sunset-2026-09-29.pdf',
    )
    expect(buildExportName('{name} {width}x{height}', CONTEXT)).toBe('Beach Sunset 1920x1280.jpg')
  })

  it('does not double the extension a template already spells out', () => {
    expect(buildExportName('{name}.png', CONTEXT)).toBe('Beach Sunset.png.jpg')
    expect(buildExportName('{name}.jpg', CONTEXT)).toBe('Beach Sunset.jpg')
  })

  it('keeps a path separator out of a name, whatever the template says', () => {
    expectSafeName(buildExportName('../../etc/{name}', CONTEXT))
  })

  it('falls back when a template collapses to nothing', () => {
    expect(buildExportName('   ', CONTEXT)).toBe('Beach Sunset-1920x1280.jpg')
    expect(buildExportName('{dpi}', { ...CONTEXT, format: 'pdf' })).toBe(
      'Beach Sunset-1920x1280.pdf',
    )
  })

  it('leaves an unknown token visible rather than silently eating it', () => {
    // `{colour}` is not a token. Printing it is a bug report; silently dropping
    // it would look like the feature worked.
    expect(buildExportName('{name}-{colour}', CONTEXT)).toBe('Beach Sunset-{colour}.jpg')
  })
})

describe('buildArchiveName', () => {
  it('names a multi-size set after the imported file and the count', () => {
    expect(buildArchiveName('', CONTEXT, 3)).toBe('Beach Sunset-3-sizes.zip')
    expect(buildArchiveName('', CONTEXT, 1)).toBe('Beach Sunset-1-size.zip')
  })

  it('drops the per-size tokens, which an archive has no single value for', () => {
    expect(buildArchiveName('{name}-{width}', CONTEXT, 3)).toBe('Beach Sunset.zip')
    expect(buildArchiveName('{name}-{dpi}', CONTEXT, 3)).toBe('Beach Sunset.zip')
    // A character the user typed is theirs, not a separator left behind by a
    // dropped token, so it survives.
    expect(buildArchiveName('{name}-{width}x{height}', CONTEXT, 3)).toBe('Beach Sunset-x.zip')
  })

  it('does not double the .zip', () => {
    expect(buildArchiveName('{name}.zip', CONTEXT, 3)).toBe('Beach Sunset.zip')
  })

  it('keeps a path separator out of the entry names it produces', () => {
    expectSafeName(buildArchiveName('a/b/{name}', CONTEXT, 3))
  })
})

describe('describeTemplate', () => {
  it('lists the tokens in play, or says the default is being used', () => {
    expect(describeTemplate('')).toBe('Using the default name.')
    expect(describeTemplate('{name}_{width}x{height}')).toBe('Using {name} {width} {height}.')
  })

  it('advertises every token it implements', () => {
    expect([...NAME_TOKENS]).toEqual([
      '{name}',
      '{width}',
      '{height}',
      '{format}',
      '{dpi}',
      '{date}',
      '{index}',
    ])
  })
})
