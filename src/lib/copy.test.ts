import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  COPY_MODULES,
  COPY_RULES,
  DEFERRED_COPY,
  VOCABULARY,
  wordPattern,
  type CopyRule,
  type CopyScope,
} from './copy'

/**
 * The gate: no forbidden word may appear in a string a user can read.
 *
 * The hard part of a copy audit across twenty panels is not the word list, it is
 * deciding which strings are words on screen. A grep cannot: it fires on
 * `// the matte`, on `strokeColor`, on `currentColor`, on a test fixture and on a
 * CSS-module class, and a gate that fires on those gets switched off inside a
 * week — a disabled gate is worth less than no gate at all.
 *
 * So this reads the syntax tree instead of the bytes. A user-facing string is
 * exactly one of three things, and nothing else is scanned:
 *
 * 1. a JSX text node — the words between two tags;
 * 2. a string literal in one of the attributes a name or a hint lives in
 *    (`aria-label`, `title`, `alt`, `placeholder`, …);
 * 3. a string literal in one of the properties a copy table is built from
 *    (`label`, `copy`, `detail`, `term`, `notes[]`, …).
 *
 * A comment is a `ts.Comment`, not a string. An identifier is an
 * `ts.Identifier`. An SVG paint is an attribute named `fill`, which is not in
 * the list, so `currentColor` is invisible to this. Test fixtures are out by
 * file name. Each of those is a deliberate false-negative, and this file's own
 * last two cases are what keep them from becoming silent ones.
 *
 * ## What it would fail on
 *
 * `"Background Color"` in a label. `"matte"` in a hint. `4x6` or `35×45 mm` or
 * `2 x 2 inches` in a sentence. `"Strength"` on a slider. A control called
 * exactly `Original` or exactly `Auto`. Nothing else — in particular not a
 * comment, an identifier, a `title` on an icon, a licence name or a token in a
 * filename template.
 */

const ROOTS = ['src/components', 'src/pages'] as const

/**
 * `label` is here because this codebase passes control names as a prop rather
 * than as text: `<Slider label="Strength">` is a word on screen, and the first
 * run of this gate missed a live "Strength" for exactly that reason.
 */
const COPY_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'title',
  'alt',
  'placeholder',
  'label',
])

const NAME_ATTRIBUTES = new Set(['aria-label', 'aria-description', 'title', 'alt', 'label'])

const COPY_PROPERTIES = new Set([
  'label',
  'copy',
  'detail',
  'term',
  'caption',
  'hint',
  'summary',
  'text',
  'ariaLabel',
  'description',
  'lede',
  'heading',
])

const NAME_PROPERTIES = new Set(['label', 'ariaLabel', 'caption', 'heading', 'text', 'detail'])

type CopyString = {
  file: string
  line: number
  text: string
  scope: CopyScope
}

function isTestFile(name: string): boolean {
  return name.endsWith('.d.ts') || /\.test\.tsx?$/.test(name)
}

function sources(relative: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) found.push(path)
    }
  }
  walk(resolve(process.cwd(), relative))
  return found
}

const allSources = [
  ...ROOTS.flatMap(sources),
  ...COPY_MODULES.map((relative) => resolve(process.cwd(), relative)),
]

/** A namespaced attribute (`xlink:href`) is not one of ours, and is not copy. */
function attrName(name: ts.JsxAttributeName): string {
  return ts.isIdentifier(name) ? name.text : ''
}

/** Every user-facing string in the app, with where it came from and what it is. */
function copyStrings(): CopyString[] {
  const found: CopyString[] = []
  for (const path of allSources) {
    const file = path.slice(process.cwd().length + 1)
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const at = (node: ts.Node) =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const push = (node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, scope: CopyScope) => {
      if (node.text.trim().length > 0) found.push({ file, line: at(node), text: node.text, scope })
    }
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, ' ').trim()
        if (text.length > 0 && /[A-Za-z]/.test(text)) {
          found.push({ file, line: at(node), text, scope: 'anywhere' })
        }
      } else if (
        ts.isJsxAttribute(node) &&
        COPY_ATTRIBUTES.has(attrName(node.name)) &&
        node.initializer !== undefined
      ) {
        const narrow = NAME_ATTRIBUTES.has(attrName(node.name)) ? 'name' : 'anywhere'
        const value = node.initializer
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
          push(value, narrow)
        } else if (ts.isJsxExpression(value) && value.expression !== undefined) {
          const inner = value.expression
          if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
            push(inner, narrow)
          }
        }
      } else if (ts.isPropertyAssignment(node)) {
        const key = node.name.getText(source)
        const init = node.initializer
        if (key === 'notes' && ts.isArrayLiteralExpression(init)) {
          for (const element of init.elements) {
            if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
              push(element, 'anywhere')
            }
          }
        } else if (
          COPY_PROPERTIES.has(key) &&
          (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
        ) {
          push(init, NAME_PROPERTIES.has(key) ? 'name' : 'anywhere')
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

function findingsFor(rule: CopyRule, entry: CopyString): string | null {
  if (rule.scope === 'name' && entry.scope !== 'name') return null
  if (rule.bannedWords) {
    const match = entry.text.match(wordPattern(rule.bannedWords))
    if (match) return `says "${match[0]}" where the product says "${rule.decision}"`
  }
  return rule.check ? rule.check(entry.text) : null
}

const deferredKey = (file: string, rule: string, text: string) => `${file}|${rule}|${text}`

const COPY = copyStrings()

describe('the vocabulary gate', () => {
  it('reads the panels rather than the repository', () => {
    // A scanner that finds nothing passes every rule below. This is the guard
    // against that being the reason the suite is green.
    expect(COPY.length).toBeGreaterThan(150)
    const importScreen = COPY.find((entry) => entry.text === 'Edit an image')
    expect(importScreen?.file).toBe('src/components/editor/ImportScreen.tsx')
    // …and that it is not reading the whole tree, which would fire on
    // identifiers and make every rule below unfalsifiable.
    expect(COPY.every((entry) => entry.file.startsWith('src/'))).toBe(true)
    expect(COPY.every((entry) => !entry.file.includes('.test.'))).toBe(true)
  })

  it('no user-facing string breaks a vocabulary rule', () => {
    const deferred = new Set(
      DEFERRED_COPY.map((entry) => deferredKey(entry.file, entry.rule, entry.text)),
    )
    const live: string[] = []
    for (const entry of COPY) {
      for (const rule of COPY_RULES) {
        const fault = findingsFor(rule, entry)
        if (fault === null) continue
        // Matched on file, rule and text — never on the line, so an agent
        // editing the panel above a deferred string does not turn this red for
        // something nobody did wrong.
        if (deferred.has(deferredKey(entry.file, rule.id, entry.text))) continue
        live.push(`${entry.file}:${entry.line} [${rule.id}] ${fault}\n    ${entry.text}`)
      }
    }
    expect(
      live,
      'Forbidden copy. The decision and its reasoning are in src/lib/copy.ts — either ' +
        'the rule or the string is wrong, and both belong in the same pull request.',
    ).toEqual([])
  })

  it('every deferred row is well-formed and points at a file that exists', () => {
    // Not liveness on purpose: a row stays true after the owner fixes the string,
    // so nobody else's branch goes red for a change they made. It does fail if a
    // row names a rule that is gone or a file that has been renamed, which is the
    // way such a table rots into fiction.
    expect(DEFERRED_COPY.length).toBeGreaterThan(0)
    for (const entry of DEFERRED_COPY) {
      expect(existsSync(resolve(process.cwd(), entry.file)), entry.file).toBe(true)
      expect(
        COPY_RULES.some((rule) => rule.id === entry.rule),
        entry.rule,
      ).toBe(true)
      expect(entry.text.length, entry.file).toBeGreaterThan(0)
      expect(entry.ownedBy.length, entry.file).toBeGreaterThan(0)
    }
  })
})

describe('the scanner is narrow enough to be believed', () => {
  const sample = (relative: string) => {
    const path = resolve(process.cwd(), relative)
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const out: string[] = []
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, ' ').trim()
        if (text.length > 0 && /[A-Za-z]/.test(text)) out.push(text)
      } else if (
        ts.isJsxAttribute(node) &&
        COPY_ATTRIBUTES.has(attrName(node.name)) &&
        node.initializer !== undefined &&
        ts.isStringLiteral(node.initializer)
      ) {
        out.push(node.initializer.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return out
  }

  it('does not read a comment as a word on screen', () => {
    // `ExportSheet` discusses the matte, its modes and an old "Original" in its
    // own comments, and every one of those words is the correct word to use when
    // talking about the code.
    const found = sample('src/components/tools/ExportSheet.tsx')
    expect(found.some((text) => /matte/i.test(text))).toBe(false)
    expect(found.some((text) => /\boriginal\b/i.test(text))).toBe(false)
  })

  it('does not read an SVG paint or a CSS-module class as a word on screen', () => {
    const found = COPY.filter((entry) => entry.file === 'src/components/ui/LookThumb.tsx')
    expect(found.map((entry) => entry.text)).not.toContain('currentColor')
    expect(found.some((entry) => /styles\./.test(entry.text))).toBe(false)
  })

  it('reads a string table the panel renders verbatim', () => {
    // `specs.ts` is not a component and has no JSX in it at all: its `label` and
    // `notes` are the passport panel's requirements, verbatim.
    const found = COPY.filter((entry) => entry.file === 'src/features/passport/specs.ts')
    expect(found.some((entry) => entry.text.startsWith('Face the camera directly'))).toBe(true)
    expect(
      found.some((entry) => entry.text.startsWith('Use a plain white or off-white background')),
    ).toBe(true)
  })
})

describe('every rule is exercised in both directions', () => {
  it.each(COPY_RULES.map((rule) => [rule.id, rule] as const))(
    '%s rejects its own fault and passes its own decision',
    (_id, rule) => {
      const fault = FAULTS[rule.id]
      const scope: CopyScope = rule.scope ?? 'anywhere'
      expect(fault, `${rule.id} has no fault string to prove it bites`).toBeDefined()
      expect(findingsFor(rule, { file: 't', line: 1, scope, text: fault! })).not.toBeNull()
      expect(findingsFor(rule, { file: 't', line: 1, scope, text: PASSES[rule.id]! })).toBe(null)
      if (rule.scope === 'name') {
        // The narrow rules are narrow on purpose: the same word inside a sentence
        // is the correct word, and a rule that could not tell the difference
        // would be a rule somebody would switch off.
        expect(
          findingsFor(rule, { file: 't', line: 1, scope: 'anywhere', text: fault! }),
          `${rule.id} fires on prose`,
        ).toBe(null)
      }
    },
  )
})

/** One string per rule that must be rejected, and one that must not be. */
const FAULTS: Record<string, string> = {
  colour: 'Background Color',
  matte: 'The matte shows through',
  'size-spelling': 'Prints 35×45 mm',
  'size-id': 'Pick 4x6',
  strength: 'Strength',
  centre: 'Center',
  original: 'Original',
  auto: 'Auto',
}

const PASSES: Record<string, string> = {
  colour: 'Background colour',
  matte: 'The colour behind transparent areas',
  'size-spelling': 'Prints 35 × 45 mm, or 2 × 2 in',
  'size-id': 'Print sizes',
  strength: 'Amount',
  centre: 'Centre',
  original: 'Hold to compare with the original',
  auto: 'Auto tone',
}

describe('the vocabulary is recorded, not just enforced', () => {
  it('spells out every ambiguous term the gate cannot decide on its own', () => {
    const terms = VOCABULARY.map((row) => row.term)
    // These four are the ones a regex cannot settle: two are enforced only in a
    // narrow form and two are not words at all. If a fifth is added here without
    // being in this list, this test is the thing that makes the omission visible.
    expect(terms).toContain('Original')
    expect(terms).toContain('Auto')
    expect(terms).toContain('Strength')
    expect(terms).toContain('the photo / the frame / the image')
    for (const row of VOCABULARY) {
      expect(row.means.length).toBeGreaterThan(0)
      expect(row.at.length).toBeGreaterThan(0)
      expect(row.note.length).toBeGreaterThan(0)
    }
  })

  it('names the modules that hold copy outside the component tree', () => {
    // A glob would be a lie: these are the three modules whose strings a panel
    // prints verbatim. A fourth has to be added here or the gate misses it.
    expect(COPY_MODULES).toContain('src/features/passport/specs.ts')
    for (const relative of COPY_MODULES) {
      expect(existsSync(resolve(process.cwd(), relative)), relative).toBe(true)
    }
  })
})

describe('wordPattern', () => {
  it('anchors on whole words and ignores case', () => {
    const pattern = wordPattern(['color'])
    expect('Background Color'.match(pattern)?.[0]).toBe('Color')
    expect(pattern.test('colour')).toBe(false)
    expect(pattern.test('colours')).toBe(false)
    expect(pattern.test('discoloration')).toBe(false)
  })
})
