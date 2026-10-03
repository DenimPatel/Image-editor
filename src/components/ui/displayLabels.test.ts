import { describe, expect, it } from 'vitest'
import { BRUSHES, REDACT_MODES, blendModes } from '../../features/layers/factory'
import { BLEND_GLYPHS, BRUSH_GLYPHS, FRAME_GLYPHS, REDACT_MODE_GLYPHS, SHAPE_GLYPHS } from './icons'
import { DISPLAY_LABEL_TABLES } from './displayLabels'

/**
 * The invariant that stops the rot returning.
 *
 * `displayLabels.ts` gets its compile-time half from being `Record<>` over each
 * union: a new enum member is a type error there until somebody names it. These
 * are the runtime halves, and each of them catches a different way that half can
 * be quietly given up:
 *
 *  - "every member has a label" checked against a list the *type* cannot police.
 *    `Record<K, V>` does catch a missing key, but only while the annotation
 *    stays `Record<K, V>`; a later `Partial<…>` or `Record<string, string>`
 *    would compile and pass every test that read the table.
 *  - "no orphan labels" catches the reverse: a key the union does not have,
 *    which no annotation permits but a hand-edited table can carry, and which
 *    shows up as a chip nothing can select.
 *  - "no label is its own id" catches the actual regression this module exists
 *    to fix. A table whose entry equals its key typechecks perfectly and prints
 *    `pen` at the user.
 *  - the four `Record<>` glyph tables in `./icons` are a second, independent
 *    witness to the same unions, written by a different hand in a different
 *    directory. Agreeing with them is what makes "the union grew" detectable
 *    rather than theoretical.
 */
describe('the display label table', () => {
  it('labels every member of every union it names', () => {
    for (const table of DISPLAY_LABEL_TABLES) {
      for (const member of table.members) {
        expect(table.labels[member], `${table.name}.${member}`).toBeTruthy()
      }
    }
  })

  it('carries no label the union does not have', () => {
    for (const table of DISPLAY_LABEL_TABLES) {
      expect(Object.keys(table.labels).sort(), table.name).toEqual([...table.members].sort())
    }
  })

  it('never falls back to printing the identifier it replaces', () => {
    for (const table of DISPLAY_LABEL_TABLES) {
      for (const [member, label] of Object.entries(table.labels)) {
        expect(label, `${table.name}.${member}`).not.toBe(member)
      }
    }
  })

  it('spells out a hyphenated identifier rather than capitalising it', () => {
    // `shadow-card` and `soft-light` are the two ids in the system where a
    // mechanical `k[0].toUpperCase()` produces something a person would never
    // have chosen — "Shadow-card" — and where a hyphen is also the only signal
    // that the label was written rather than derived. `BLEND_LABELS` is
    // deliberately exempt from the spacing rule: it abbreviates `soft-light` to
    // "Soft" on purpose and puts the full name in `BLEND_MODE_TITLES`, which is
    // the table this does hold to.
    for (const table of DISPLAY_LABEL_TABLES) {
      if (table.name === 'BlendMode') continue
      for (const [member, label] of Object.entries(table.labels)) {
        if (!member.includes('-')) continue
        expect(label, `${table.name}.${member}`).not.toContain('-')
        expect(label, `${table.name}.${member}`).toContain(' ')
      }
    }
  })

  it('never gives two options in one control the same name', () => {
    // Two chips in one `group` with one accessible name is a control a screen
    // reader cannot tell apart, and there is no way to pick the second one.
    for (const table of DISPLAY_LABEL_TABLES) {
      const labels = Object.values(table.labels)
      expect(new Set(labels).size, table.name).toBe(labels.length)
    }
  })

  it('agrees with the glyph tables, which are a Record over the same unions', () => {
    const glyphed: [string, Record<string, unknown>][] = [
      ['FrameStyle', FRAME_GLYPHS],
      ["DrawLayer['brush']", BRUSH_GLYPHS],
      ["ShapeLayer['shape']", SHAPE_GLYPHS],
      ["RedactLayer['mode']", REDACT_MODE_GLYPHS],
      ['BlendMode', BLEND_GLYPHS],
    ]
    const byName = new Map(DISPLAY_LABEL_TABLES.map((table) => [table.name, table]))
    for (const [name, glyphs] of glyphed) {
      const table = byName.get(name)
      if (!table) throw new Error(`no label table for ${name}`)
      expect(Object.keys(glyphs).sort(), name).toEqual([...table.members].sort())
      // And one label per drawing, so a chip can never lose its word while
      // keeping its artwork — the regression class this file was written for.
      expect(Object.keys(glyphs).length, name).toBe(Object.keys(table.labels).length)
    }
  })

  it('reads the three unions that have a list in the factory straight from it', () => {
    const byName = new Map(DISPLAY_LABEL_TABLES.map((table) => [table.name, table]))
    expect(byName.get('BlendMode')?.members).toEqual(blendModes())
    expect(byName.get("DrawLayer['brush']")?.members).toEqual(BRUSHES)
    expect(byName.get("RedactLayer['mode']")?.members).toEqual(REDACT_MODES)
  })

  it('names all seven layer kinds', () => {
    const kinds = DISPLAY_LABEL_TABLES.find((table) => table.name === 'LayerKind')
    expect(kinds?.members).toHaveLength(7)
    expect(kinds?.members).toEqual([
      'text',
      'sticker',
      'shape',
      'draw',
      'redact',
      'watermark',
      'frame',
    ])
  })
})
