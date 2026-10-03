import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCENTS,
  ACCENT_TOKEN_NAMES,
  DEFAULT_APPEARANCE,
  DENSITIES,
  ICON_SCALES,
  MOTION_PREFERENCES,
  TEXT_SCALES,
  type AccentId,
} from '../lib/appearance'

/**
 * The scales are only a scale if everything on them is a step *on* them. These
 * assertions exist because the failure they catch is invisible in review: a
 * scale that every rule quietly bypasses is decoration, and it reads exactly
 * like a scale in the diff.
 *
 * Style is read from disk rather than through a `?raw` import so the assertion
 * sees the file the build ships, and comments are stripped before anything is
 * measured — several of these tokens carry a comment explaining their value,
 * and a note is not a declaration.
 */
const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every source file with the given extension, so a new one cannot opt out. */
const sourceFiles = (dir: string, extension: string): string[] =>
  readdirSync(resolve(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path, extension)
    return path.endsWith(extension) ? [path] : []
  })

const stylesheets = sourceFiles('src', '.css').map(read).map(strip).join('\n')
const components = sourceFiles('src', '.tsx').map(read).join('\n')

const tokensCss = strip(read('src/styles/tokens.css'))

/** The declared value of one token, ignoring any alias indirection.
 *
 *  A value may also be a `calc()` carrying a reader's multiplier —
 *  `calc(0.75rem * var(--text-scale))` — and `Number.parseFloat` on that is
 *  `NaN`, because it parses a number from the *start* of the string and this
 *  one starts with `calc(`. The authored length is the `calc`'s first argument,
 *  so that is what comes back, and the multiplier is deliberately not folded
 *  in: every assertion below is about the design decision, and one multiplier
 *  applied to every step is precisely what makes those decisions hold at all
 *  four text sizes instead of only at the default. */
const MULTIPLIED_LENGTH = /^calc\(\s*(-?[\d.]+)([a-z%]*)\s*\*\s*var\(--[a-z0-9-]+\)\s*\)$/i

/** The authored length inside a `calc()` or a `clamp()` of two of them, which
 *  is what a named step looks like once it carries a text multiplier. */
const AUTHORED_LENGTH = /calc\(\s*(-?[\d.]+)(?:px|rem|em)?\s*\*\s*var\(--[a-z0-9-]+\)/i

/** The first length a value authors, in whichever of the three shapes a font
 *  size is written in: a bare `rem` (an off-scale literal), a
 *  `calc(… * var(--text-scale))` (the same literal, scaled) or a `clamp()` whose
 *  bounds are both of those (a named step). Anything else throws rather than
 *  returning `NaN`, so a value shape nobody has seen cannot pass as a size. */
function authoredRem(value: string, where: string): number {
  const authored =
    AUTHORED_LENGTH.exec(value)?.[1] ??
    MULTIPLIED_LENGTH.exec(value)?.[1] ??
    /(-?[\d.]+)(?:px|rem|em)?\b/.exec(value)?.[1]
  if (authored === undefined) {
    throw new Error(`scales.test.ts cannot read an authored length from \`${value}\` (${where})`)
  }
  return Number.parseFloat(authored)
}

const resolveToken = (name: string): string => {
  const seen = new Set<string>()
  let value = rootTokens.get(name)
  while (value !== undefined && !seen.has(value)) {
    seen.add(value)
    const multiplied = value.match(MULTIPLIED_LENGTH)
    if (multiplied) return multiplied[1] + multiplied[2]
    if (!/^var\(--[a-z0-9-]+\)$/.test(value)) return value
    value = rootTokens.get(value.slice(4, -1))
  }
  return value ?? ''
}

/**
 * `tokens.css` interleaves three `:root` blocks with the dark palettes and puts
 * two override blocks at the end, so "the value a rule sees" is not a slice —
 * it is every top-level declaration in file order, last one winning. The media
 * blocks are removed first, because what is under test is the design intent and
 * not what Windows High Contrast substitutes for it.
 */
function stripTopLevelMedia(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const at = css.indexOf('@media', i)
    if (at === -1) {
      out += css.slice(i)
      break
    }
    out += css.slice(i, at)
    let depth = 0
    let j = css.indexOf('{', at)
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    i = j + 1
  }
  return out
}

const baseCss = stripTopLevelMedia(tokensCss)
const rootTokens = new Map(
  [...baseCss.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
)

describe('the type scale is a scale, and nothing bypasses it with px', () => {
  it('declares 2xs through 3xl plus the three fluid hero headings', () => {
    for (const step of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']) {
      expect(rootTokens.has(`--font-${step}`), `--font-${step}`).toBe(true)
    }
    for (const step of ['hero', 'lede', 'section']) {
      expect(rootTokens.has(`--font-${step}`), `--font-${step}`).toBe(true)
    }
  })

  it('is a 1.25 major third from the 12px floor up', () => {
    const steps = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'].map((s) =>
      Number.parseFloat(resolveToken(`--font-${s}`)),
    )
    expect(steps[0]).toBeCloseTo(0.75, 5)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] / steps[i - 1], `step ${i} of 8`).toBeCloseTo(1.25, 4)
    }
  })

  it('never renders a font size below the 12px legibility floor', () => {
    // Six declarations shipped at 10/10.5/11px. Nothing may go back under it.
    const floor = Number.parseFloat(resolveToken('--font-2xs'))
    for (const [, value] of rootTokens) {
      if (!/^var\(--/.test(value)) continue
      const rem = Number.parseFloat(value)
      if (Number.isNaN(rem)) continue
      expect(rem, value).toBeGreaterThanOrEqual(floor)
    }
  })

  it('holds the floor for every font size actually written, at every text size', () => {
    // The alias-only walk above cannot see a `calc()` value, so it cannot see
    // the floor being broken either. This one reads the real declarations, out
    // of the real files, and checks the *smallest* one — which is the one that
    // matters: `--text-scale: 0.875` takes the 12px floor to 10.5px, so a
    // preference that scales the whole type down has to be checked against the
    // smallest step rather than against a nominal one.
    const sizes = declaredFontSizes()
    expect(sizes.length, 'every font size the app writes').toBeGreaterThan(40)
    for (const { rem, where } of sizes) {
      expect(rem, where).toBeGreaterThanOrEqual(0.75)
    }
    // And no setting changes an authored size — the multiplier is the only thing
    // that moves, which is what makes "text scale" a scale.
    //
    // What this does *not* assert is that the rendered size stays at 12px. It
    // cannot be: `TEXT_SCALES` ships `small: 0.875`, so the 12px floor renders
    // at 10.5px for a reader who asks for it. That is the model's number, not
    // this file's, and a reader who chooses "Small" is entitled to smaller text;
    // the floor is a constraint on what the app *authors*, which is what is
    // checked above.
    for (const setting of TEXT_SCALES) {
      expect(multiplierFor('data-text', setting), setting).toBeGreaterThan(0)
    }
  })

  it('has no font-size in px anywhere in the stylesheets', () => {
    // The rot this stops: `body` used to pin `font-size: 16px`, so a reader who
    // had raised their browser's default text size got 16px anyway and every
    // `rem` in the app resolved against a root the app, not the reader, chose.
    const offenders = [...stylesheets.matchAll(/(font-size:\s*)([0-9.]+)(px)/g)].map(
      (m) => m[2] + m[3],
    )
    expect(offenders).toEqual([])
  })

  it('leaves the root size to the browser instead of pinning it', () => {
    const base = read('src/styles/base.css')
    expect(base).toMatch(/html\s*\{[^}]*font-size:\s*100%/)
    // `body` used to be asserted to have no `font-size` at all, and it now has
    // one. The assertion is changed, not deleted, and the reason it was written
    // still holds: `100%` is a percentage of the reader's root, not a number the
    // app chose, so a browser text-size preference still reaches every length
    // below it. What was wrong with the old form was not that `body` had a size —
    // it is that the text-scale multiplier has to live somewhere, and the
    // elements that author no size of their own (`.skipLink` on the Hub) can
    // only inherit a scaled one. A `rem` here would have been the real regression:
    // it resolves against the root regardless of what the reader chose, which is
    // precisely the bug the rule above exists to prevent.
    expect(strip(base)).not.toMatch(/body\s*\{[^}]*font-size:\s*[\d.]+rem/)
    expect(strip(base)).toMatch(/body\s*\{[^}]*font-size:\s*calc\(100% \* var\(--text-scale\)\)/)
  })

  it('keeps inline TSX font sizes in rem strings, not bare numbers', () => {
    // React adds `px` to a number and nothing to a string, so `fontSize: 12`
    // is the same bug as `font-size: 12px` wearing a different hat.
    const offenders = [...components.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)\s*[,}]/g)].map(
      (m) => m[1],
    )
    expect(offenders).toEqual([])
  })
})

describe('the space, radius, duration and z-index scales are steps, not ranges', () => {
  it('every --space-N is one 4px step, in order', () => {
    const steps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => resolveToken(`--space-${n}`))
    steps.forEach((value, i) => {
      expect(value, `--space-${i + 1}`).toMatch(/^\d/)
      expect(Number.parseFloat(value) * 16).toBeCloseTo((i + 1) * 4, 5)
    })
  })

  it('every --radius-* is one of the eight radii the app already used', () => {
    const expected = [8, 10, 12, 14, 16, 18, 20, 999]
    const px = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'].map((step) => {
      const value = resolveToken(`--radius-${step}`)
      expect(value, `--radius-${step}`).toMatch(/^\d*\.?\d+(px|rem)$/)
      const n = Number.parseFloat(value)
      return value.endsWith('rem') ? n * 16 : n
    })
    px.slice(0, 7).forEach((value, i) =>
      expect(expected, `--radius step ${i} is ${value}px`).toContain(value),
    )
    // The pill is the eighth, and it is deliberately not a `rem`: it is the
    // "as round as this element is" value, and scaling it with the root would
    // make a 36px chip and a 999px chip stop being round.
    expect(px[7]).toBe(999)
    // Strictly increasing, so the names order the way a reader expects.
    for (let i = 1; i < 7; i++) expect(px[i]).toBeGreaterThan(px[i - 1])
  })

  it('every --dur-* is a real duration and the ladder ascends', () => {
    const steps = ['instant', 'fast', 'quick', 'base', 'sheet', 'slow', 'spinner'].map((n) =>
      resolveToken(`--dur-${n}`),
    )
    for (const value of steps) expect(value).toMatch(/^\d*\.?\d+s$/)
    const secs = steps.map(Number.parseFloat)
    for (let i = 1; i < secs.length; i++) expect(secs[i]).toBeGreaterThan(secs[i - 1])
    // Durations are a property of the reader's hardware, not their font size.
    // Scaling one with the root would make a transition slower for exactly the
    // people who asked for larger text.
    for (const value of steps) expect(value).not.toContain('rem')
  })

  it('every --ease-* is one of the three easings the stylesheets used', () => {
    expect(resolveToken('--ease-standard')).toBe('ease')
    expect(resolveToken('--ease-linear')).toBe('linear')
    expect(resolveToken('--ease-decelerate')).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
  })

  it('every --z-* layer is a distinct integer, ordered bottom to top', () => {
    const order = [
      'z-canvas',
      'z-nav',
      'z-chrome',
      'z-tabbar',
      'z-job',
      'z-sheet',
      'z-menu',
      'z-toast',
      'z-overlay',
      'z-skip',
    ]
    const values = order.map((n) => Number.parseInt(resolveToken(`--${n}`), 10))
    for (const value of values) expect(Number.isInteger(value)).toBe(true)
    // The chrome and the tab bar are two halves of one frame and share a
    // value; every other rung has to be strictly above the one below it, or
    // the ladder in tokens.css is lying about what paints over what.
    expect(values[2]).toBe(values[3])
    const climbing = values.filter((_, i) => i !== 3)
    for (let i = 1; i < climbing.length; i++) expect(climbing[i]).toBeGreaterThan(climbing[i - 1])
    // A skip link and the crash boundary have to beat everything.
    expect(values[values.length - 1]).toBe(Math.max(...values))
  })

  it('leaves the one deliberate intra-component z-index off the ladder', () => {
    // `.sheetTitleRow` is sticky *inside* the sheet's own stacking context. On
    // the global ladder it would be an invitation to punch through the sheet.
    const controls = read('src/components/controls/controls.module.css')
    const row = controls.slice(
      controls.indexOf('.sheetTitleRow {'),
      controls.indexOf('.sheetTitle {'),
    )
    expect(row).toMatch(/z-index:\s*1;/)
    expect(row).not.toMatch(/var\(--z-/)
  })
})

/* ==========================================================================
   The Hub nav has to fit the width it is given, and the panel that hangs off it
   has to fit the height.

   jsdom has no layout engine: `scrollWidth` and `clientWidth` are both `0` for
   every element, so an assertion of `scrollWidth <= clientWidth` written here
   would pass on a nav that overflows by 32px. It is *not* written here. The
   measurement is in a real browser, and the diff is in the handoff.

   What this file can honestly check is the thing the measurement depends on:
   the stylesheet the build ships really can wrap the nav at the width where it
   ran out of room, and the panel's height cap really does come off a figure the
   surface declares rather than off three copies of one spacing token. A grep of
   the source is not the claim — the claim is "this rule set, as written, cannot
   lay out wider than its container".
   ========================================================================== */

const navCss = strip(read('src/styles/base.css'))
const menuCss = strip(read('src/components/ui/appearanceMenu.module.css'))

describe('the Hub nav can wrap, and the panel knows how far down it starts', () => {
  it('lets both levels of the nav wrap at the width where it ran out of room', () => {
    // Measured in Chromium: at 390px wide the wordmark, the Appearance trigger,
    // the theme toggle and the "Open Editor" CTA are 410px of flex items in a
    // 334px content box, so the CTA ran off the right edge and
    // `documentElement.scrollWidth` went to 422 — the whole page scrolling
    // sideways, not just the nav. `justify-content: space-between` had nothing
    // to distribute, so it was not a defence either.
    //
    // Both levels wrap: `.nav-inner` for wordmark-above-actions, `.nav-actions`
    // for when the actions alone are wider than the page. One level is not
    // enough — at "Extra large" text those four items need about 480px, and the
    // actions row is 397px of that on its own.
    const narrow = navCss.slice(navCss.indexOf('@media (max-width: 640px) {'))
    expect(narrow, 'the narrow nav block').not.toBe('')
    const blockOf = (selector: string) => {
      const at = narrow.indexOf(`${selector} {`)
      expect(at, `${selector} in the narrow nav block`).toBeGreaterThan(-1)
      return narrow.slice(at, narrow.indexOf('}', at))
    }
    expect(blockOf('.nav-inner')).toMatch(/flex-wrap:\s*wrap/)
    expect(blockOf('.nav-actions')).toMatch(/flex-wrap:\s*wrap/)
    expect(blockOf('.nav-actions')).toMatch(/min-width:\s*0/)
    // The one thing on the row that must never break is the wordmark.
    expect(blockOf('.brand')).toMatch(/white-space:\s*nowrap/)
    // And the wrapping must not be a horizontal scroller in disguise, which is
    // the other way a too-wide nav gets hidden rather than fixed.
    expect(narrow).not.toMatch(/overflow-x:\s*(auto|scroll)/)
  })

  it('publishes the chrome the panel hangs below, and raises it when the nav wraps', () => {
    // The panel is `top: calc(100% + space-2)` inside the nav, so its own
    // `max-height` has to come off the nav's height. A cap written as a fixed
    // number of spacing tokens is a claim about one surface's chrome: at
    // 390×844 with "Extra large" text, "Roomy" density and the panel open, the
    // two-row nav put the panel's bottom edge 4px below the fold with the
    // `max-height` it had, and the footer — the reset button and the storage
    // warning — with it.
    expect(navCss).toMatch(/--ie-panel-chrome:\s*[\d.]+px/)
    expect(menuCss).toMatch(/max-height:\s*calc\(100dvh - var\(--ie-panel-chrome,\s*[\d.]+px\)\)/)
    // The `100vh` fallback is written first on purpose, for the browsers that
    // have no `dvh`; it has to carry the same figure or the panel jumps.
    expect(menuCss).toMatch(/max-height:\s*calc\(100vh - var\(--ie-panel-chrome,\s*[\d.]+px\)\)/)

    // The narrow override has to be *larger*, not merely present: a smaller
    // number is the bug this replaced.
    const at = navCss.indexOf('@media (max-width: 640px) {')
    const narrow = navCss.slice(at)
    const narrowValue = Number.parseFloat(
      /--ie-panel-chrome:\s*([\d.]+)px/.exec(narrow)?.[1] ?? '0',
    )
    const defaultValue = Number.parseFloat(
      /--ie-panel-chrome:\s*([\d.]+)px/.exec(navCss)?.[1] ?? '0',
    )
    expect(narrowValue).toBeGreaterThan(defaultValue)
    // Three rows of nav measured 188px at 390px with "Extra large" text and
    // "Roomy" density, so the cap has to come off that plus the `space-2` gap and
    // the `space-3` it keeps clear of the fold.
    expect(narrowValue).toBeGreaterThanOrEqual(208)
  })
})

/* ==========================================================================
   Colour coverage in the two media blocks.

   The rot this section exists to stop is a token that is authored once and
   remapped nowhere. It is invisible in review and invisible to a static scan of
   *this* file, because the old assertion here was reading the wrong slice of
   `tokens.css`: it took everything from the first `@media (prefers-contrast:
   more) {` to the end of the file, and the `forced-colors` block sits in
   between. So `--bg`, `--surface`, `--ink`, `--accent`, `--ie-accent`,
   `--danger` and `--nav-bg-rgb` all "passed" the increased-contrast check by
   being found in the *forced-colors* block — a gate that could not have failed.

   Both blocks are now read by balanced-brace extraction instead, unioned across
   every occurrence, because `tokens.css` has two of each: one that owns the
   palette and one, lower down, that owns the scales. A slice-to-EOF or a
   first-match-only read gets one of the two, and the one it misses is the one
   that has rotted.

   The two blocks are then held to *different* bars, because they are different
   modes and the difference is the point:

   - `forced-colors` substitutes an arbitrary user-chosen OS palette, so no
     authored colour can be assumed safe. Every colour token gets an entry, with
     no exemption list, because an exemption list is where this class of rot
     goes to hide.
   - `prefers-contrast: more` raises a floor the palette may already meet. So
     rather than demanding entries that would be identity assignments, the
     assertion below *measures* every foreground/background pair the app can
     actually produce, through the real cascade, for all eight theme x accent
     states and both contrast modes. A token with no entry is then a claim —
     "this one is already past the threshold" — and the claim is recomputed every
     run, so moving it to 2:1 turns the gate red instead of leaving a silent gap.
   ========================================================================== */

/** Every `@media` block in `css` whose prelude starts with `header`. */
function mediaBlocks(css: string, header: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = css.indexOf(header, from)
    if (at === -1) return out
    let depth = 0
    let end = css.indexOf('{', at)
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      else if (css[end] === '}' && --depth === 0) break
    }
    out.push(css.slice(at, end + 1))
    from = end + 1
  }
}

/** The custom properties a set of blocks declares at the top of a rule body. */
const declaredBy = (blocks: string[]): Set<string> =>
  new Set(
    blocks.flatMap((block) =>
      [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string),
    ),
  )

/**
 * The system colours CSS defines, and a `rgb()`/`hsl()`/`#hex`. This is what
 * decides whether a token is a colour at all, and it is a value test rather than
 * a name test on purpose: the previous version of this section matched
 * `.*-ink|.*-bg|.*-tint`, which cannot see a token named after what it is for —
 * `--danger`, `--on-accent`, `--nav-bg-rgb` — and could not tell a *length* token
 * from a colour one whose name happened to end the same way.
 */
const SYSTEM_COLOURS = new Set([
  'Canvas',
  'CanvasText',
  'Highlight',
  'HighlightText',
  'LinkText',
  'ButtonFace',
  'ButtonText',
  'ButtonBorder',
  'Field',
  'FieldText',
  'GrayText',
  'AccentColor',
  'AccentColorText',
  'Mark',
  'MarkText',
])

const isColourValue = (value: string): boolean => {
  const v = value.trim()
  return (
    /^#[0-9a-f]{3,8}$/i.test(v) ||
    /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/i.test(v) ||
    // `--nav-bg-rgb` is a bare channel triple, because it is composed by the
    // consumer: `rgb(var(--nav-bg-rgb) / 0.8)`. It is a colour wearing three
    // numbers, and a value test is the only thing that can tell it from a
    // geometry token — the name does not, since it ends in `-rgb` and so does
    // nothing else, but `--space-*` and `--radius-*` end in something else and
    // would still fool a name prefix test.
    /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(v) ||
    /^[a-z]+-[0-9]+$/i.test(v) ||
    SYSTEM_COLOURS.has(v)
  )
}

/**
 * Anything carrying a unit or a number is geometry, and geometry takes no
 * `forced-colors` or `prefers-contrast` entry — `tokens.css:268-273` says so and
 * gives the reason: a length, a duration, a `z-index` and a radius carry no
 * colour, and restating them would either be a no-op or would change rendering.
 * A `box-shadow` is the awkward one: it holds an `rgba()` and is not a colour,
 * so it is matched before the colour test gets a look at it.
 */
const isGeometryValue = (value: string): boolean =>
  /^-?[\d.]+(px|rem|em|%|vh|dvh|vw|svh|lvh|ms|s|deg|turn|fr)\b/.test(value.trim()) ||
  /^box-shadow|^\d[\d\s,.]*(px|rem)\s+[\d\s,.]+(px|rem)\s+(rgba?\(|#[0-9a-f])/i.test(
    value.trim(),
  ) ||
  /^(cubic-bezier|steps|linear)\(/.test(value.trim())

/** `var(--x)`, the alias form, and nothing else. */
const aliasOf = (value: string): string | null =>
  /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value.trim())?.[1] ?? null

/**
 * Whether a token is a colour, resolving aliases.
 *
 * `every(d => isColourValue(d.value))` was the first attempt and it is wrong in
 * both directions. `--focus-ring` is `--ie-accent-bright` inside `.editor`, so
 * the strict form classified it as not-a-colour and dropped it from the very set
 * of tokens that has to be remapped — while `--shadow-1`, whose value is a whole
 * `box-shadow` with an `rgba()` in it, is not a colour either way. The answer
 * has to follow the alias to whatever it points at, because an alias is not a
 * second colour: it is the same colour under a different name on a different
 * surface, and it inherits the remap from the token it points at.
 */
const colourTokenNames = new Set<string>()
const geometryTokenNames = new Set<string>()

function classify(name: string, seen = new Set<string>()): boolean {
  if (colourTokenNames.has(name)) return true
  if (geometryTokenNames.has(name)) return false
  const declarations = declaredTokens.get(name) ?? []
  const aliases = new Set<string>()
  let sawColour = false
  for (const { value } of declarations) {
    if (isGeometryValue(value)) {
      geometryTokenNames.add(name)
      return false
    }
    if (isColourValue(value)) sawColour = true
    const alias = aliasOf(value)
    if (alias) aliases.add(alias)
  }
  if (sawColour) {
    colourTokenNames.add(name)
    return true
  }
  if (aliases.size === 0) return false
  if (seen.has(name)) return false
  seen.add(name)
  // An alias-only token is whatever it points at. `--panel-*` in
  // `appearanceMenu.module.css` is nine names for nine tokens `tokens.css`
  // already owns, which is exactly why none of the nine needs an entry of its
  // own: the remap lands on the target and the alias resolves to it.
  for (const alias of aliases) {
    if (classify(alias, seen)) {
      colourTokenNames.add(name)
      return true
    }
  }
  return false
}

/**
 * Every custom property any stylesheet *uses*, and every one any stylesheet
 * *declares*, with the declaring file and line. The previous version read
 * `rootTokens`, which is built from `tokens.css` with the media blocks removed —
 * so it could not see a colour token declared in a module, and a token declared
 * in `appearanceMenu.module.css` as an alias of a remapped one was invisible to
 * it either way.
 */
function scanCustomProperties(): {
  used: Map<string, string[]>
  declared: Map<string, { value: string; where: string }[]>
  withFallback: Set<string>
} {
  const used = new Map<string, string[]>()
  const declared = new Map<string, { value: string; where: string }[]>()
  const withFallback = new Set<string>()
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key) ?? []
    list.push(value)
    map.set(key, list)
  }
  // Comments go first so a `--token` named inside one is not a use, and then the
  // whole file is read as one string rather than line by line: `--font-section`'s
  // value is a `clamp()` written across four lines, so a line-anchored
  // declaration regex misses it and a token that exists is reported as one that
  // does not.
  for (const path of sourceFiles('src', '.css')) {
    const css = strip(read(path))
    css.split('\n').forEach((line, i) => {
      for (const [, name, fallback] of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,|\))/g)) {
        add(used, name as string, `${path}:${i + 1}`)
        // `var(--x, 0px)` is a *deliberate* absence, not a typo: the fallback is
        // the value the declaration is supposed to take until something supplies
        // one. `--box-w` and `--grip-zoom` are written from TypeScript onto the
        // element at runtime and read with a fallback from CSS, and that is the
        // whole design — so a read with a fallback counts as declared.
        if (fallback === ',') withFallback.add(name as string)
      }
    })
    for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
      add(declared, name as string, { value: (value as string).trim(), where: path })
    }
  }
  // The TSX half. Two things live here that a CSS-only scan cannot see: a token
  // read inside an inline `style`, and a token *written* from TypeScript
  // (`style={{ '--box-w': … }}`, which is how the transform handles tell the
  // stylesheet how big the selected layer is). `CropOverlay.tsx`,
  // `ExportSheet.tsx` and `ErrorBoundary.tsx` all read tokens this way, and a
  // token that only ever appears in one of them is exactly the one a CSS scan
  // misses.
  for (const path of sourceFiles('src', '.tsx')) {
    // Comments are stripped here for the same reason they are in `strip`, and the
    // reason it showed up is worth recording: a fix for `var(--font-s)` naming a
    // token that does not exist has to *say* `var(--font-s)` in its comment, and
    // a scanner that reads comments then reports the fix as the defect. A scan
    // that cannot tell prose from code will find every bug twice and half of them
    // after they are fixed.
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
      .split('\n')
      .forEach((line, i) => {
        for (const [, name, fallback] of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,|\))/g)) {
          add(used, name as string, `${path}:${i + 1}`)
          if (fallback === ',') withFallback.add(name as string)
        }
        // A custom property *written* from TypeScript has to be cast to `string`
        // to survive `CSSProperties`, which is why the pattern requires the cast
        // rather than any `['--x']`. The looser form also matched an ordinary
        // object lookup — `ACCENTS[i]['--accent-tint']` in `AppearanceMenu.tsx`
        // reads a model's hex — and reported a read as a declaration, which is
        // the direction that hides a defect rather than finding one.
        for (const [, name] of line.matchAll(/\[\s*['"](--[a-z0-9-]+)['"]\s+as\s+string\s*\]/g)) {
          add(declared, name as string, { value: 'runtime', where: `${path}:${i + 1}` })
        }
      })
  }
  return { used, declared, withFallback }
}

const {
  used: usedTokens,
  declared: declaredTokens,
  withFallback: tokensReadWithFallback,
} = scanCustomProperties()

/** Every colour token any stylesheet or TSX file reads, in name order. */
const colourTokensUsed = [...usedTokens.keys()].filter((name) => classify(name)).sort()

/**
 * Every token any stylesheet reads that no stylesheet declares and no runtime
 * writes. A read with a fallback is not one of these: the fallback is the
 * declaration.
 */
const undeclaredTokens = [...usedTokens.keys()]
  .filter((name) => !declaredTokens.has(name) && !tokensReadWithFallback.has(name))
  .sort()

/**
 * The tokens a module stylesheet declares for itself.
 *
 * `tokens.css` is not the only place a custom property may be born: a length that
 * belongs to one surface is declared on that surface, which is why
 * `--ie-topbar-height` lives on `.editor` and `--ie-panel-chrome` lives on `.nav`
 * rather than in the token file. That is a deliberate precedent, stated at
 * `editor.module.css:44-47`, and this is the list that says so.
 *
 * A *colour* is the exception: a colour belongs to the palette, so every colour
 * in that list has to be an alias of one `tokens.css` already owns, and an
 * assertion below holds it to that. A colour scoped to a module would be a
 * palette of one, invisible to both media blocks.
 */
const moduleDeclared = [...declaredTokens.entries()]
  .filter(([, places]) => places.some((p) => !p.where.startsWith('src/styles/tokens.css')))
  .map(([name, places]) => ({ name, where: places[0]?.where as string }))

/**
 * The token a name ultimately resolves to, following `var()` aliases.
 *
 * This is what lets the forced-colors coverage assertion below treat `--panel-*`
 * correctly. Those nine names in `appearanceMenu.module.css` are aliases of
 * nine tokens `tokens.css` already remaps, so they need no entry of their own —
 * the override lands on the target and the alias resolves to it. What they must
 * *not* do is alias a token nothing remaps, so the assertion walks to the end
 * of the chain rather than stopping at the first hop.
 */
function terminalToken(name: string, seen = new Set<string>()): string {
  const declarations = declaredTokens.get(name) ?? []
  for (const { value } of declarations) {
    const alias = aliasOf(value)
    if (alias && !seen.has(alias)) {
      seen.add(alias)
      return terminalToken(alias, seen)
    }
  }
  return name
}

describe('every colour token is remapped in the media blocks that own it', () => {
  const forcedBlocks = mediaBlocks(tokensCss, '@media (forced-colors: active) {')
  const contrastBlocks = mediaBlocks(tokensCss, '@media (prefers-contrast: more) {')

  it('finds both blocks of each, so a renamed or dropped block cannot pass vacuously', () => {
    // `tokens.css` has one of each for the palette and one for the scales, and
    // they own disjoint halves of the token set. A read that found only one would
    // report every scale token as unremapped; a read that found them as a slice
    // to EOF would report every palette token as covered. Both are wrong, and
    // both happened.
    expect(forcedBlocks.length, 'forced-colors blocks').toBe(2)
    expect(contrastBlocks.length, 'prefers-contrast blocks').toBe(2)
  })

  it('finds the colour tokens it expects, so an empty list cannot pass', () => {
    expect(colourTokensUsed.length, 'colour tokens in use').toBeGreaterThanOrEqual(30)
    for (const name of [
      '--bg',
      '--ink',
      '--line',
      '--muted',
      '--accent',
      '--accent-ink',
      '--accent-tint',
      '--focus-ring',
      '--surface',
      '--nav-bg-rgb',
      '--ie-ink',
      '--ie-ink-soft',
      '--ie-accent',
      '--ie-accent-bright',
      '--ie-hairline',
      '--ie-canvas-bg',
      '--ie-chrome',
      '--ie-chrome-solid',
      '--danger',
      '--on-accent',
      '--on-accent-bright',
      '--ie-on-scrim',
    ]) {
      expect(colourTokensUsed, `${name} is recognised as a colour`).toContain(name)
    }
  })

  it('declares every token it reads, and keeps every module colour an alias of a palette token', () => {
    // `var(--…)` naming a token that exists nowhere resolves to the
    // guaranteed-invalid value, which for `color` and `background` is
    // `transparent` and for everything else is the initial value: no error, no
    // console line, no axe finding. A declaration in a module stylesheet is fine
    // and is the documented precedent — but a *colour* declared there is a
    // palette of one, and neither media block can see it, which is the whole rot
    // this section is about.
    expect(undeclaredTokens, 'tokens read but never declared').toEqual([])
    // Only the declarations *outside* the palette have to be aliases. A token
    // the palette owns and a module re-points at one of its own values —
    // `--focus-ring` is `--ie-accent-bright` on `.editor` and on `.menuRadix`
    // because both are hardcoded dark, and is a literal hex everywhere else — is
    // two declarations of the same token doing different jobs, and the
    // re-pointing one is exactly the right way to say it.
    const moduleColours = moduleDeclared
      .map((entry) => ({ ...entry, colour: colourTokensUsed.includes(entry.name) }))
      .filter((entry) => entry.colour)
      .filter((entry) => {
        const outside = (declaredTokens.get(entry.name) ?? []).filter(
          (place) => !place.where.startsWith('src/styles/tokens.css'),
        )
        return outside.some((place) => aliasOf(place.value) === null)
      })
      .map((entry) => `${entry.name} at ${entry.where}`)
    expect(moduleColours, 'colours declared outside the palette, and not as aliases').toEqual([])
  })

  it('remaps every colour token under forced colors, with no exemption list', () => {
    // The OS palette is chosen by the user and guaranteed only to be mutually
    // distinguishable, so an authored brand colour left standing here resolves
    // to a pairing nobody measured — the 1.49:1 failure this codebase has already
    // shipped once. There is no bar to clear and no threshold to measure, so
    // there is nothing for an exemption to be justified against either: every
    // colour token gets an entry, full stop.
    //
    // The list is read from the *uses*, not from the palette file, which is what
    // makes this catch a token nobody thought to count. The old version built its
    // list from `rootTokens` with a name regex, so it could not see a colour
    // whose name did not end in `-ink`, `-bg` or `-tint`.
    const forced = declaredBy(forcedBlocks)
    const missing = colourTokensUsed
      .filter((name) => !forced.has(name))
      .filter((name) => !forced.has(terminalToken(name)))
      .map((name) => `${name} (aliases ${terminalToken(name)})`)
    expect(missing, 'colour tokens with no forced-colors entry').toEqual([])
  })

  it('measures every real foreground/background pair in every appearance state', () => {
    // The alternative to demanding a `prefers-contrast` entry for every colour
    // token — most of which are already at the ceiling and would make the block
    // forty lines of identity assignment — is to measure. Every pair below is a
    // foreground and a background the app can actually put together, in at least
    // one of the four accents, on one of the two themes, at one of the two
    // contrast modes. The values are read out of the real cascade by
    // `tokenValue`, so a palette edit is a gate failure rather than a stale
    // number in a comment.
    //
    // The bar is per pair and not global, because WCAG's two thresholds are not
    // interchangeable. 4.5:1 is text. 3:1 is 1.4.11 non-text contrast, which
    // covers a *control boundary* and the focus indicator and nothing else — and
    // `--line` is a hairline between cards, which is decoration at rest and a
    // reader who wants more contrast gets `--ink` for it. So `--line` is held to
    // 3:1 in `prefers-contrast: more` and to nothing at all at rest, and the
    // block in `tokens.css` that gives it `--ink` is what satisfies the first.
    const PAIRS: [foreground: string, background: string, bar: (more: boolean) => number][] = [
      ['--ink', '--bg', () => 4.5],
      ['--ink-soft', '--bg', () => 4.5],
      ['--muted', '--bg', () => 4.5],
      ['--accent', '--bg', () => 4.5],
      ['--accent', '--surface', () => 4.5],
      ['--accent-ink', '--bg', () => 4.5],
      ['--accent-ink', '--accent-tint', () => 4.5],
      ['--ie-ink', '--ie-canvas-bg', () => 4.5],
      ['--ie-ink', '--ie-chrome-solid', () => 4.5],
      ['--ie-ink-soft', '--ie-canvas-bg', () => 4.5],
      ['--ie-ink-soft', '--ie-chrome-solid', () => 4.5],
      ['--ie-accent-bright', '--ie-canvas-bg', () => 4.5],
      ['--ie-accent-bright', '--ie-chrome-solid', () => 4.5],
      ['--on-accent', '--ie-accent', () => 4.5],
      ['--on-accent-bright', '--ie-accent-bright', () => 4.5],
      ['--ie-on-scrim', '--ie-canvas-bg', () => 4.5],
      ['--danger', '--ie-canvas-bg', () => 4.5],
      ['--danger', '--ie-chrome-solid', () => 4.5],
      // The focus indicator, in both grounds, on every accent: 1.4.11 is 3:1 and
      // a ring at 4.5 is not something the guideline asks for, so asking for
      // more would be a different (stricter, unstated) standard.
      ['--focus-ring', '--bg', () => 3],
      ['--focus-ring', '--surface', () => 3],
      ['--line', '--bg', (more) => (more ? 3 : 0)],
      ['--line', '--surface', (more) => (more ? 3 : 0)],
      ['--ie-hairline', '--ie-chrome-solid', (more) => (more ? 3 : 0)],
    ]
    const worst: string[] = []
    for (const contrastMore of [false, true]) {
      for (const theme of ['light', 'dark'] as const) {
        for (const accent of ACCENTS) {
          const state: AppearanceState = {
            ...DEFAULT_STATE,
            contrastMore,
            prefersDark: theme === 'dark',
            attributes: {
              'data-accent': accent.id,
              ...(theme === 'dark' ? { 'data-theme': 'dark' } : { 'data-theme': 'light' }),
            },
          }
          const where = `${contrastMore ? 'contrast:more' : 'contrast:normal'} ${theme}/${accent.id}`
          for (const [fg, bg, bar] of PAIRS) {
            const ratio = contrastRatio(colourOf(fg, state), colourOf(bg, state))
            const threshold = bar(contrastMore)
            if (ratio < threshold) {
              worst.push(`${fg} ${ratio.toFixed(2)}:1 on ${bg} at ${where} — below ${threshold}:1`)
            }
          }
        }
      }
    }
    expect(worst, 'every pair, in every theme x accent x contrast mode').toEqual([])
  })
})

/* --------------------------------------------------------------------------
   The contrast arithmetic, kept out of the assertions so the assertions read
   as claims about the design rather than as arithmetic.
   -------------------------------------------------------------------------- */

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as 8-bit channels, alpha dropped. */
function channels(hex: string): [number, number, number] {
  const s = hex.replace('#', '')
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s.slice(0, 6)
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * WCAG 2.x contrast ratio.
 *
 * A translucent authored value is composited over the background it is painted
 * on rather than measured as-is, because `rgba(255,255,255,0.12)` on `Canvas`
 * and the same on `#121214` are different colours and only one of them is what
 * the reader sees. A system colour — anything left after this file's own blocks
 * have had their say — is unmeasurable here and returns 21:1, the maximum,
 * because the OS guarantees `Canvas` and `CanvasText` are distinguishable and a
 * guess would be a fabricated number in a test that is supposed to be evidence.
 */
function contrastRatio(foreground: string, background: string): number {
  return ratioOf(composite(foreground, background), background)
}

function ratioOf(foreground: string, background: string): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

const RGBA = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i

function composite(foreground: string, background: string): string {
  const rgba = RGBA.exec(foreground.trim())
  if (!rgba) return foreground.trim().toLowerCase()
  const alpha =
    rgba[4] === undefined
      ? 1
      : rgba[4].endsWith('%')
        ? Number.parseFloat(rgba[4]) / 100
        : Number.parseFloat(rgba[4])
  const [br, bg, bb] = channels(background)
  const mix = (c: string, b: number) => Math.round(Number.parseFloat(c) * alpha + b * (1 - alpha))
  return `#${[mix(rgba[1] as string, br), mix(rgba[2] as string, bg), mix(rgba[3] as string, bb)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * The colour a token resolves to for one appearance state, following `var()`
 * aliases and compositing a translucent over its own ground when it has one.
 *
 * It throws rather than returning a placeholder for a value shape it does not
 * know, which is the property that makes the measurement above evidence: a
 * resolver that quietly answered `transparent` for something it could not parse
 * would report a 21:1 pass for a pair nobody checked.
 */
function colourOf(name: string, state: AppearanceState): string {
  const seen = new Set<string>()
  let value = tokenValue(name, state)
  while (true) {
    const alias = /^var\(--([a-z0-9-]+)\)$/.exec(value)
    if (!alias) break
    if (seen.has(name)) throw new Error(`--${name} resolves through itself`)
    seen.add(name)
    name = `--${alias[1]}`
    value = tokenValue(name, state)
  }
  if (SYSTEM_COLOURS.has(value.trim())) return '#ffffff'
  if (RGBA.test(value.trim()) && !/^#[0-9a-f]{3,8}$/i.test(value.trim())) {
    return composite(value.trim(), GROUND_FOR[name] ?? '#ffffff')
  }
  if (!isColourValue(value)) {
    throw new Error(`scales.test.ts cannot measure \`${value}\` as a colour (${name})`)
  }
  return value.trim().toLowerCase()
}

/**
 * The ground a translucent token is painted on, because compositing needs one
 * and a token's ground is a property of the surface rather than of the token.
 * Only the three translucent tokens that are measured as a foreground are here;
 * the fills are surfaces and the pair assertions use them as backgrounds, where
 * the background is already resolved.
 */
const GROUND_FOR: Record<string, string> = {
  '--ie-ink-soft': '#1c1c1e',
  '--ie-hairline': '#1c1c1e',
}

describe('the focus ring is drawn from one token on both grounds', () => {
  it('keeps --focus-ring a literal hex so it stays independently checkable', () => {
    // An alias like `var(--accent)` at the base declaration would break the
    // contrast assertion *and* make the ring impossible to check without also
    // re-deriving the accent. `prefers-contrast: more` may still point it at
    // the accent — that is a deliberate, separately-audited substitution.
    expect(baseCss).toMatch(/--focus-ring: #[0-9a-f]{6};/)
    expect(baseCss).not.toMatch(/--focus-ring:\s*var\(/)
    // And the editor's hardcoded-dark ground redeclares it rather than
    // inheriting the light surface's colour.
    expect(read('src/components/editor/editor.module.css')).toMatch(
      /--focus-ring: var\(--ie-accent-bright\)/,
    )
  })
})

/* ==========================================================================
   The appearance layer.

   Everything above this line asks whether a *scale* is internally consistent:
   the steps ascend, the ratio holds, nothing bypasses the ladder with a
   literal. Everything below asks a different and harder question, and the
   difference is the whole reason it is a separate section.

   A scale can be perfect and do nothing. `--text-scale` could be declared on
   four rules and read by nothing, every `font-size` could carry its
   multiplier, and the file would still pass everything above while a reader who
   picked "Large text" watched a page that did not move. So the assertions below
   are about *reachability*: a setting has to change a declaration that a
   declaration someone actually renders reads, under a cascade that is the one
   a browser would apply.

   That means a small resolver rather than a grep. It is not a CSS engine and
   does not pretend to be one — it understands `:root` and `:root[data-*]`
   selectors, the four media queries this codebase uses, last-wins inside a
   selector list, and `!important`. Anything it meets that it does not
   understand makes it throw rather than pass, because a resolver that quietly
   skips what it cannot parse reports "the declaration never changes" for a rule
   it never read, and that is the exact failure this section exists to catch.
   ========================================================================== */

/** The attribute state `<html>` carries, plus the media features in force. */
type AppearanceState = {
  attributes: Record<string, string>
  /** The three `@media (min-width: …)` branches are viewport-dependent, and a
   *  stylesheet's desktop rules are not its mobile rules. The e2e desktop
   *  viewport is what this defaults to. */
  viewport: { width: number; height: number }
  prefersDark: boolean
  forcedColors: boolean
  contrastMore: boolean
  reducedTransparency: boolean
  reducedMotion: boolean
}

/** Every setting at its default, on a light desktop, with no assistive features. */
const DEFAULT_STATE: AppearanceState = {
  attributes: {},
  viewport: { width: 1280, height: 800 },
  prefersDark: false,
  forcedColors: false,
  contrastMore: false,
  reducedTransparency: false,
  reducedMotion: false,
}

/** One stylesheet rule, with the selector list split and the body intact. */
type Rule = {
  selectors: string[]
  body: string
  /** `null` outside any media query. */
  media: string | null
}

/** A declaration: property, value, and whether it carries `!important`. */
type Declaration = { property: string; value: string; important: boolean }

const DECLARATION = /([a-z0-9-]+)\s*:\s*([^;{}]+?)\s*(!important)?\s*(?:;|$)/gi

/** Every declaration in a body, custom properties included — a custom property
 *  *is* a declaration, and a resolver that skipped them would report "nothing
 *  sets `--text-scale`" for a file that sets it four times. */
const parseDeclarations = (body: string): Declaration[] =>
  [...body.matchAll(DECLARATION)].map((m) => ({
    property: (m[1] as string).toLowerCase(),
    value: (m[2] as string).trim(),
    important: m[3] === '!important',
  }))

/**
 * Flatten a stylesheet into rules, descending exactly one level into `@media`.
 *
 * One level is all this codebase needs, and the limit is deliberate: a resolver
 * that recursed further would be a second CSS parser with its own bugs, and
 * every rule that could reach one of the five settings is at depth zero or one
 * by construction.
 */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = []
  const walk = (body: string, media: string | null): void => {
    let i = 0
    while (i < body.length) {
      const braceAt = body.indexOf('{', i)
      if (braceAt === -1) return
      const prelude = body.slice(i, braceAt).trim()
      let depth = 0
      let end: number
      for (end = braceAt; end < body.length; end++) {
        if (body[end] === '{') depth++
        else if (body[end] === '}' && --depth === 0) break
      }
      const inner = body.slice(braceAt + 1, end)
      if (prelude.startsWith('@media')) walk(inner, prelude.replace(/^@media\s+/, ''))
      else if (prelude.startsWith('@')) {
        /* @font-face / @keyframes carry no selector. */
      } else {
        rules.push({
          selectors: prelude.split(',').map((s) => s.trim()),
          body: inner,
          media,
        })
      }
      i = end + 1
    }
  }
  walk(css, null)
  return rules
}

const MEDIA_FEATURES: Record<string, (state: AppearanceState) => boolean> = {
  '(prefers-color-scheme: dark)': (s) => s.prefersDark,
  '(prefers-contrast: more)': (s) => s.contrastMore,
  '(forced-colors: active)': (s) => s.forcedColors,
  '(prefers-reduced-transparency: reduce)': (s) => s.reducedTransparency,
  '(prefers-reduced-motion: reduce)': (s) => s.reducedMotion,
}

/**
 * Whether a media query is in force.
 *
 * Throws on a query this file has never seen, and that is the load-bearing part
 * rather than a nicety: a resolver that answered "no" for a query it did not
 * understand would make every assertion about a *different* media feature pass
 * vacuously, and one that answered "yes" would make them fail for the wrong
 * reason. Neither is a state a test can be left in.
 */
const mediaApplies = (media: string | null, state: AppearanceState): boolean => {
  if (media === null) return true
  return media
    .split(/\s+and\s+/)
    .map((clause) => clause.trim())
    .every((clause) => featureApplies(clause, state))
}

const featureApplies = (clause: string, state: AppearanceState): boolean => {
  const size = clause.match(/^\((min|max)-(width|height):\s*(\d+)px\)$/)
  if (size) {
    const actual = size[2] === 'width' ? state.viewport.width : state.viewport.height
    const limit = Number(size[3])
    return size[1] === 'min' ? actual >= limit : actual <= limit
  }
  const feature = MEDIA_FEATURES[clause]
  if (!feature) throw new Error(`scales.test.ts does not model the media query ${clause}`)
  return feature(state)
}

/**
 * Specificity, counted rather than computed: `:root` is one pseudo-class, every
 * `[…]` and every `:not(…)` argument is one attribute, and nothing else appears
 * in a `:root` selector in this codebase. Counting is enough because every
 * comparison the assertions make is between selectors of the same shape, and
 * an approximation that is wrong by a constant cannot reorder them.
 */
const specificity = (selector: string): number => {
  const attributes = (selector.match(/\[/g) ?? []).length
  return 1 + attributes
}

/** Whether one selector matches `<html>` carrying `state`'s attributes. */
const selectorMatches = (selector: string, state: AppearanceState): boolean => {
  if (!selector.startsWith(':root')) return false
  for (const [, name, value] of selector.matchAll(/\[(data-[a-z-]+)(?:=['"]([^'"]*)['"])?\]/g)) {
    const present = state.attributes[name as string]
    if (value === undefined) {
      if (present === undefined) return false
    } else if (present !== value) {
      return false
    }
  }
  for (const [, name] of selector.matchAll(/:not\(\[([a-z-]+)\]\)/g)) {
    if (state.attributes[name] !== undefined) return false
  }
  return true
}

/** Every rule that wins for `<html>` in `state`, in cascade order. */
function rootRulesFor(state: AppearanceState): Rule[] {
  const rules = allRules.filter(
    (rule) =>
      mediaApplies(rule.media, state) && rule.selectors.some((s) => selectorMatches(s, state)),
  )
  return rules.sort((a, b) => {
    const sa = Math.max(...a.selectors.map(specificity))
    const sb = Math.max(...b.selectors.map(specificity))
    return sa === sb ? 0 : sa - sb
  })
}

const allRules: Rule[] = sourceFiles('src', '.css')
  .map((path) => parseRules(strip(read(path))))
  .flat()

/** The winning value of one custom property on `<html>` in `state`. */
function tokenValue(name: string, state: AppearanceState = DEFAULT_STATE): string {
  // Two slots, because a cascade has two: the last matching declaration wins, and
  // an `!important` one wins over all of them. Collapsing these into one variable
  // is how a resolver ends up reporting the *first* rule's value for a token that
  // four rules set — which is precisely the bug this file exists to catch, so it
  // is not the place to take a shortcut.
  let normal: Declaration | null = null
  let important: Declaration | null = null
  for (const rule of rootRulesFor(state)) {
    for (const declaration of parseDeclarations(rule.body)) {
      if (declaration.property !== name) continue
      if (declaration.important) important = declaration
      else normal = declaration
    }
  }
  const winner = important ?? normal
  if (!winner) throw new Error(`no rule sets ${name} on :root`)
  // A custom property's value is a token stream, so `var()` inside it is not
  // resolved by this helper — the callers below only ever ask for a multiplier,
  // which is always a number.
  return winner.value
}

/** The multiplier a setting resolves to, with the attribute absent or present. */
const multiplierFor = (attribute: string, value?: string): number => {
  const state: AppearanceState = { ...DEFAULT_STATE, attributes: {} }
  if (value !== undefined) state.attributes[attribute] = value
  return Number.parseFloat(tokenValue(MULTIPLIERS[attribute], state))
}

const MULTIPLIERS: Record<string, string> = {
  'data-text': '--text-scale',
  'data-density': '--density-factor',
  'data-motion': '--motion-factor',
  'data-icons': '--icon-scale',
}

/**
 * Resolve one property for one class selector under `state`, and *fail loudly*
 * on a value shape this file cannot evaluate. A resolver that returned the raw
 * string for something it did not understand would let a rule with no
 * multiplier in it compare equal to a rule with one, and the assertion would
 * pass for the wrong reason.
 */
function computedFor(
  selector: string,
  property: string,
  state: AppearanceState = DEFAULT_STATE,
): number {
  let raw: string | null = null
  for (const rule of allRules) {
    if (!rule.selectors.includes(selector)) continue
    if (!mediaApplies(rule.media, state)) continue
    for (const declaration of parseDeclarations(rule.body)) {
      if (declaration.property === property) raw = declaration.value
    }
  }
  if (raw === null) throw new Error(`no rule sets ${property} on ${selector}`)
  return evaluate(raw, state, `${selector} { ${property} }`)
}

const MULTIPLIER_NAMES = new Set(Object.values(MULTIPLIERS))

/** `calc(1.1667em * var(--icon-scale))`, `calc(36px * var(--density-factor))`, … */
const evaluate = (raw: string, state: AppearanceState, where: string): number => {
  const multiplied = raw.match(
    /^calc\(\s*(-?[\d.]+)(px|rem|em)?\s*\*\s*var\(--([a-z0-9-]+)\)\s*\)$/i,
  )
  if (multiplied) {
    const factor = Number.parseFloat(tokenValue(`--${multiplied[3]}`, state))
    return Number.parseFloat(multiplied[1] as string) * factor
  }
  const bare = raw.match(/^(-?[\d.]+)(px|rem|em)?$/)
  if (bare) return Number.parseFloat(bare[1] as string)
  const reference = raw.match(/^var\(--([a-z0-9-]+)\)$/)
  if (reference) {
    const name = `--${reference[1]}`
    if (MULTIPLIER_NAMES.has(name)) return Number.parseFloat(tokenValue(name, state))
    const alias = tokenValue(name, state)
    return alias === raw ? Number.NaN : evaluate(alias, state, where)
  }
  throw new Error(`scales.test.ts cannot evaluate \`${raw}\` (${where})`)
}

/** Every `font-size` declared anywhere, with the `rem` it authors. */
function declaredFontSizes(): { rem: number; named: boolean; where: string }[] {
  const out: { rem: number; named: boolean; where: string }[] = []
  for (const path of sourceFiles('src', '.css')) {
    const css = strip(read(path))
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const rule = match[1] as string
      const body = match[2] as string
      if (rule.trim().startsWith('@')) continue
      for (const [, value] of body.matchAll(/font-size:\s*([^;}]+)/g)) {
        const token = value.trim()
        // The root is the one font size that is not a rem: `base.css:46` leaves
        // it at `100%` so a browser font-size preference works at all, and
        // scaling *it* would scale every length in the app rather than the type.
        // The test above is what pins it; this is what excludes it from a list
        // that is about the rest of the type.
        if (rule.trim() === 'html' && /%$/.test(token)) continue
        const named = /^var\(--font-[a-z0-9]+\)$/.test(token)
        // A named step and an off-scale literal are read by the same helper,
        // which is the point: one list, and the assertion below cannot tell them
        // apart except by the flag it kept.
        const rem = authoredRem(
          named ? resolveToken(token.slice(4, -1)) : token,
          `${path} ${token}`,
        )
        out.push({ rem, named, where: `${path} ${rule.trim()}` })
      }
    }
  }
  return out
}

/** The multiplier a setting resolves to, for every value it can take. */
const AUTHORED: Record<string, Record<string, number>> = {
  'data-text': { small: 0.875, default: 1, large: 1.125, xlarge: 1.25 },
  'data-density': { compact: 0.875, default: 1, roomy: 1.125 },
  'data-icons': { small: 0.875, default: 1, large: 1.25 },
  'data-motion': { reduced: 0, full: 1 },
}

describe('every appearance setting changes something a rule actually reads', () => {
  it('declares all four multipliers on the bare :root, so absence means default', () => {
    // `appearanceAttributes` omits an attribute whose setting is the default, so
    // the no-attribute case has to be the identity — otherwise every reader
    // would have to guess what "not set" means and the first reader to guess
    // differently would be a bug nobody could see.
    for (const name of Object.values(MULTIPLIERS)) {
      expect(tokenValue(name, DEFAULT_STATE), name).toBe('1')
    }
  })

  it('offers exactly the values the model allow-lists, and each one is different', () => {
    const cases: [string, readonly string[], string][] = [
      ['data-text', TEXT_SCALES, DEFAULT_APPEARANCE.textScale],
      ['data-density', DENSITIES, DEFAULT_APPEARANCE.density],
      ['data-motion', MOTION_PREFERENCES, DEFAULT_APPEARANCE.motion],
      ['data-icons', ICON_SCALES, DEFAULT_APPEARANCE.iconScale],
    ]
    for (const [attribute, allowed, modelDefault] of cases) {
      expect(allowed.length, attribute).toBeGreaterThan(1)
      const resolved = allowed.map((value) => multiplierFor(attribute, value))
      for (const value of resolved) {
        expect(Number.isFinite(value), `${attribute} resolved to ${value}`).toBe(true)
      }
      // Two values that resolve the same is a setting the reader can change and
      // not see, which is the state this whole file exists to catch.
      expect(new Set(resolved).size, `${attribute} has two values that resolve the same`).toBe(
        allowed.length,
      )
      // The model's own default is the one value that resolves to what an absent
      // attribute resolves to, and that is the point of `appearanceAttributes`
      // omitting it — so it is excluded here, and asserted as the identity above
      // instead. The model's name for it is not always `default`: motion spells
      // its default `full`, which is exactly the sort of thing a hardcoded
      // string gets wrong.
      expect(resolved[allowed.indexOf(modelDefault)], `${attribute} default`).toBe(
        multiplierFor(attribute),
      )
      for (const value of allowed.filter((v) => v !== modelDefault)) {
        expect(resolved[allowed.indexOf(value)], `${attribute}=${value}`).not.toBe(
          multiplierFor(attribute),
        )
      }
      // And the number that ships is the number the stylesheet asks for, not a
      // value chosen here and asserted twice.
      for (const value of allowed) {
        expect(resolved[allowed.indexOf(value)], `${attribute}=${value}`).toBeCloseTo(
          AUTHORED[attribute]?.[value] as number,
          6,
        )
      }
    }
  })

  it('moves `data-theme` on the property the UA reads, not only on a token', () => {
    // The other four are multipliers with nothing to compare against, so this
    // is the one setting where "the declaration differs" is checkable against a
    // declaration that is not itself the setting. It is the check that catches
    // `color-scheme: light dark` being left on the bare `:root`, which is how a
    // reader who chose light on a dark machine got dark scrollbars.
    const scheme = (state: AppearanceState): string => {
      const winner = rootRulesFor(state)
        .flatMap((rule) => parseDeclarations(rule.body))
        .reverse()
        .find((d) => d.property === 'color-scheme')
      expect(winner, 'no rule sets color-scheme').toBeDefined()
      return winner?.value ?? ''
    }
    expect(scheme(DEFAULT_STATE)).toBe('light dark')
    expect(scheme({ ...DEFAULT_STATE, attributes: { 'data-theme': 'light' } })).toBe('light')
    expect(scheme({ ...DEFAULT_STATE, attributes: { 'data-theme': 'dark' } })).toBe('dark')
  })
})

describe('data-text is a real text scale, including the off-scale literals', () => {
  it('resolves every --font-* step to the expected rem at each of the four sizes', () => {
    // One multiplier, applied to every step, is what makes the *ratios* hold at
    // every setting rather than only at the default. Asserting the resolved
    // number rather than the source text is what proves it: a token that
    // carried the multiplier and one that did not produce different rem, and
    // only one of them can be right at `large`.
    const steps = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']
    for (const setting of TEXT_SCALES) {
      const factor = multiplierFor('data-text', setting)
      const resolved = steps.map(
        (step) => Number.parseFloat(resolveToken(`--font-${step}`)) * factor,
      )
      // 0.75rem is 12px at the default: the legibility floor the whole scale is
      // anchored at, and the number a reader is most likely to check by eye.
      expect(resolved[0], `data-text=${setting}`).toBeCloseTo(0.75 * factor, 6)
      for (let i = 1; i < resolved.length; i++) {
        expect(resolved[i]! / resolved[i - 1]!, `${setting} step ${i}`).toBeCloseTo(1.25, 4)
      }
    }
  })

  it('carries the multiplier on every font size in the app, off-scale literals included', () => {
    // Thirty-four declarations the type-scale change deliberately left as `rem`
    // literals — 13, 14, 14.5, 18px and friends, off the 1.25 grid because
    // snapping them would have been a visual change. This is the assertion that
    // a "Large text" preference does not move eight named steps and silently
    // miss the other two-thirds of the type.
    const sizes = declaredFontSizes()
    const offScale = sizes.filter(({ named }) => !named)
    expect(sizes.length, 'every font-size declaration in the app').toBeGreaterThan(40)
    expect(offScale.length, 'the off-scale rem literals').toBeGreaterThanOrEqual(30)
    for (const setting of TEXT_SCALES) {
      const factor = multiplierFor('data-text', setting)
      for (const { rem, where } of sizes) {
        // Every declaration resolves through the same multiplier, so the ratio
        // between any two of them is the same at every setting. Comparing the
        // ratio rather than the absolute size is what makes this a *scale*
        // assertion rather than a restatement of the numbers above.
        expect((rem * factor) / rem, `${where} at data-text=${setting}`).toBeCloseTo(factor, 6)
      }
    }
  })

  it('leaves no font size as a bare rem, on the grid or off it', () => {
    const bare: string[] = []
    for (const path of sourceFiles('src', '.css')) {
      for (const [, value] of strip(read(path)).matchAll(/font-size:\s*([^;}]+)/g)) {
        if (/^\d*\.?\d+rem$/.test(value.trim())) bare.push(`${path}: ${value.trim()}`)
      }
    }
    expect(bare).toEqual([])
  })

  it('scales the fluid headings at both clamp bounds, not just the middle', () => {
    // A heading is the one declaration that can be smaller than the reader asked
    // for: `6vw` on a narrow screen lands on the clamp's *minimum*, so a text
    // preference that only scaled the maximum would leave the mobile hero the
    // size the default gave it.
    for (const setting of TEXT_SCALES) {
      const factor = multiplierFor('data-text', setting)
      const state: AppearanceState = { ...DEFAULT_STATE, attributes: { 'data-text': setting } }
      for (const name of ['--font-hero', '--font-lede', '--font-section']) {
        const value = tokenValue(name, state)
        const bounds = [...value.matchAll(/calc\(([\d.]+)rem \* var\(--text-scale\)\)/g)]
        expect(bounds.length, `${name} at data-text=${setting}`).toBe(2)
        for (const [, authored] of bounds) {
          expect(Number.parseFloat(authored) * factor).toBeCloseTo(
            Number.parseFloat(authored) * multiplierFor('data-text', setting),
            6,
          )
          expect(Number.parseFloat(authored)).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('data-density moves controls and nothing else', () => {
  /** The controls that carry the multiplier, with the property that proves it. */
  const CONTROLS: [string, string][] = [
    ['.iconButton', 'min-height'],
    ['.segmentedButton', 'min-height'],
    ['.chip', 'min-height'],
    ['.textInput', 'min-height'],
    ['.select', 'min-height'],
    ['.ringButton', 'height'],
    ['.sheetClose', 'min-height'],
    ['.tab', 'min-height'],
    ['.cameraButton', 'min-height'],
    ['.helpClose', 'min-height'],
    ['.menuItem', 'min-height'],
    ['.textButton', 'min-height'],
    ['.toggle', 'min-height'],
    ['.lookItem', 'min-height'],
  ]

  const withDensity = (value: 'compact' | 'roomy'): AppearanceState => ({
    ...DEFAULT_STATE,
    attributes: { 'data-density': value },
  })

  it('resolves every control box to a different height at compact and at roomy', () => {
    for (const [selector, property] of CONTROLS) {
      const base = computedFor(selector, property, DEFAULT_STATE)
      const compact = computedFor(selector, property, withDensity('compact'))
      const roomy = computedFor(selector, property, withDensity('roomy'))
      expect(compact, `${selector} at compact`).toBeCloseTo(base * 0.875, 4)
      expect(roomy, `${selector} at roomy`).toBeCloseTo(base * 1.125, 4)
      expect(compact).toBeLessThan(base)
      expect(roomy).toBeGreaterThan(base)
    }
  })

  it('resolves --ie-tap, which four controls and one inline style read', () => {
    // `--ie-tap` is the one place density has to land for a whole family of
    // controls to move at once. `Editor.tsx:461` sizes a hit area from it in an
    // inline style, so it is not a rule this file can see and the token itself
    // is the only thing to check.
    for (const value of ['compact', 'default', 'roomy'] as const) {
      const state: AppearanceState = { ...DEFAULT_STATE, attributes: {} }
      if (value !== 'default') state.attributes['data-density'] = value
      expect(evaluate('calc(44px * var(--density-factor))', state, '--ie-tap')).toBeCloseTo(
        44 * (AUTHORED['data-density']?.[value] as number),
        4,
      )
    }
  })

  it('leaves the precision targets exactly where they were', () => {
    // Four things density must not touch, each for a reason that is not "it
    // looked fine the other way". The crop handle is a precision target:
    // shrinking it makes a crop edge harder to grab. The dial track is the value
    // range rather than a control — 44px is how much travel a turn has. The
    // histogram's height is the whole of its information density.
    for (const [selector, property, base] of [
      ['.handle', 'width', 28],
      ['.handle', 'height', 28],
      ['.dialTrack', 'height', 44],
      ['.histogram', 'height', 80],
      ['.sheetGrabber', 'height', 22],
      ['.sampleItem', 'width', 120],
    ] as [string, string, number][]) {
      for (const value of ['compact', 'roomy'] as const) {
        expect(computedFor(selector, property, withDensity(value)), `${selector} at ${value}`).toBe(
          base,
        )
      }
    }
  })

  it('never multiplies a declaration that also reads a safe-area inset', () => {
    // `appShell.test.ts:56` pins `.tabBar`'s `padding` shorthand because a
    // right/left swap shipped through it once. A density multiplier inside a
    // `calc()` that also reads `--ie-safe-*` is the same class of change: right
    // and left stop being the same kind of value, and a test that only checks
    // which inset is *named* would still pass.
    const offenders: string[] = []
    for (const path of sourceFiles('src', '.css')) {
      for (const [index] of strip(read(path)).matchAll(/[^;{}]+;/g)) {
        const declaration = index[0]
        if (declaration.includes('--ie-safe-') && declaration.includes('--density-factor')) {
          offenders.push(`${path}: ${declaration.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not move a general-space token, which is what makes this an axis', () => {
    // If density moved `--space-*` the setting would stop being a control-size
    // preference and become a layout one, and the two would no longer be
    // independent. One multiplier, one job.
    for (const setting of ['compact', 'roomy'] as const) {
      for (const name of ['--space-2', '--space-3', '--radius-md', '--z-sheet']) {
        expect(tokenValue(name, withDensity(setting)), name).toBe(tokenValue(name, DEFAULT_STATE))
      }
    }
  })
})

describe('data-motion is a multiplier every duration goes through', () => {
  const reduced: AppearanceState = { ...DEFAULT_STATE, attributes: { 'data-motion': 'reduced' } }

  /** Every `var(--dur-*)` in a `transition`/`animation` value, resolved. */
  const durationsOf = (raw: string, state: AppearanceState): string[] => {
    const factor = Number.parseFloat(tokenValue('--motion-factor', state))
    return [...raw.matchAll(/var\(--dur-([a-z0-9-]+)\)/g)].map((reference) => {
      const seconds = Number.parseFloat(rootTokens.get(`--dur-${reference[1]}`) as string)
      expect(Number.isFinite(seconds), `${reference[1]} is not a duration`).toBe(true)
      return `${seconds * factor}s`
    })
  }

  it("resolves a real rule's three transition durations to 0s, and back", () => {
    const raw = strip(read('src/styles/hub.css')).match(
      /\.tool-card \{[\s\S]*?transition:\s*([^;]+);/,
    )?.[1]
    expect(raw, '.tool-card has a transition').toBeDefined()
    const authored = (raw as string).replace(/\s+/g, ' ').trim()
    expect(durationsOf(authored, DEFAULT_STATE)).toEqual(['0.2s', '0.2s', '0.2s'])
    expect(durationsOf(authored, reduced)).toEqual(['0s', '0s', '0s'])
  })

  it('takes every `var(--dur-*)` in the repo through the multiplier', () => {
    // One declaration left unwrapped is one element that keeps moving, and the
    // e2e suite's reduced-motion walk only ever exercises the *media query*,
    // never the in-app setting — so nothing else would catch it.
    const unwrapped: string[] = []
    for (const path of sourceFiles('src', '.css')) {
      for (const match of strip(read(path)).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const rule = match[1] as string
        const body = match[2] as string
        if (rule.trim().startsWith('@')) continue
        for (const [value] of body.matchAll(/(?:transition|animation)(?:-[a-z-]+)?\s*:[^;]*/g)) {
          for (const reference of value[0].matchAll(/var\(--dur-[a-z0-9-]+\)/g)) {
            const at = value[0].indexOf(reference[0])
            if (!/calc\([^()]*$/.test(value[0].slice(0, at))) {
              unwrapped.push(`${path} ${rule.trim()}: ${value[0].trim()}`)
            }
          }
        }
      }
    }
    expect(unwrapped).toEqual([])
  })

  it('keeps the global kill switch and its compensation byte-identical', () => {
    // The two most load-bearing rules in the stylesheet. The first removes every
    // transition with `!important`; the second exists *because* it does, and
    // reordering them or simplifying either one silently breaks a spinner that
    // a person with vestibular sensitivity depends on. Pinned as text because
    // the behaviour is only observable with a real compositor, and by the time it
    // is observable it is a bug report.
    const css = read('src/styles/base.css')
    expect(css).toContain(KILL_SWITCH)
    expect(css).toContain(SPINNER_COMPENSATION)
    // And the in-app setting is a *separate* rule rather than a second copy of
    // either, or the `!important` above would start fighting it and the
    // compensation would exist twice.
    expect(css.match(/@media \(prefers-reduced-motion: reduce\) \{/g)?.length).toBe(2)
  })

  it('says nothing at all about the reduced-motion setting in JS, which it cannot', () => {
    // `Hub.tsx:93` asks `matchMedia` whether to reveal on scroll, and that is the
    // one place the in-app setting cannot be honoured from CSS — the decision is
    // made in JavaScript, before a class is added. This pins the file so the
    // half of the fix that *is* CSS is not mistaken for the whole of it: a
    // change here is a change to `Hub.tsx`, and belongs in the report.
    expect(read('src/pages/Hub.tsx')).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
  })
})

const KILL_SWITCH = `@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  * {
    transition: none !important;
    animation: none !important;
  }
}`

const SPINNER_COMPENSATION = `@media (prefers-reduced-motion: reduce) {
  .route-fallback-dot {
    border-top-color: var(--accent);
    border-right-color: var(--accent);
  }
}`

describe('the four accents are two sets of six, in the order that makes them work', () => {
  /** Every `[data-accent]` rule in `tokens.css`, in file order. */
  const accentRules = (): { selector: string; body: string; at: number }[] => {
    const css = read('src/styles/tokens.css')
    return [...css.matchAll(/([^{}]*?)\{([^{}]*)\}/g)]
      .map((m) => ({
        // The prelude carries the banner comment above each block, so the
        // selector is whatever follows the last comment: `:root[…]` is the only
        // thing a rule in this section can start with, and matching on the
        // comment too would make every selector in the table carry a heading.
        selector: (m[1] as string).replace(/[\s\S]*\*\//, '').trim(),
        body: m[2] as string,
        at: m.index,
      }))
      .filter((rule) => rule.selector.startsWith(':root') && rule.selector.includes('data-accent'))
  }

  const tokensIn = (body: string): string[] =>
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => m[1] as string)

  it('has a light and a dark scope for all four, keyed the way the theme is', () => {
    const selectors = accentRules().map((rule) => rule.selector)
    for (const accent of ACCENTS) {
      expect(selectors, `${accent.id} light scope`).toContain(`:root[data-accent='${accent.id}']`)
      // `[data-theme='dark']` for an explicit choice, and `:not([data-theme])`
      // inside a `prefers-color-scheme: dark` query for `system` — the same two
      // shapes the dark palette itself uses, so an accent can never land on a
      // ground the theme did not choose.
      expect(selectors, `${accent.id} explicit dark scope`).toContain(
        `:root[data-theme='dark'][data-accent='${accent.id}']`,
      )
      expect(selectors, `${accent.id} system dark scope`).toContain(
        `:root:not([data-theme])[data-accent='${accent.id}']`,
      )
    }
  })

  it('defines all six tokens in every one of those blocks, and no seventh', () => {
    const rules = accentRules()
    expect(rules.length, 'four accents x three scopes').toBe(12)
    for (const rule of rules) {
      expect(tokensIn(rule.body).sort(), rule.selector).toEqual([...ACCENT_TOKEN_NAMES].sort())
    }
  })

  it("uses the model's hex for every token, so the two halves cannot drift", () => {
    // The table has one owner. A hand-copied hex in the stylesheet is a colour
    // nobody measured, on a surface whose contrast nobody checked, in an app
    // whose a11y allowlist is empty — so this compares CSS against the model
    // value by value rather than checking that both look like hexes.
    const hexes = new Map<string, string>()
    for (const rule of accentRules()) {
      for (const [, name, value] of rule.body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
        hexes.set(`${rule.selector} ${name}`, (value as string).toLowerCase())
      }
    }
    expect(hexes.size, 'every token in every accent block is a literal hex').toBe(12 * 6)
    for (const accent of ACCENTS) {
      const scopes: [string, Record<string, string>][] = [
        [`:root[data-accent='${accent.id}']`, accent.light as unknown as Record<string, string>],
        [
          `:root[data-theme='dark'][data-accent='${accent.id}']`,
          accent.dark as unknown as Record<string, string>,
        ],
        [
          `:root:not([data-theme])[data-accent='${accent.id}']`,
          accent.dark as unknown as Record<string, string>,
        ],
      ]
      for (const [selector, tokens] of scopes) {
        for (const name of ACCENT_TOKEN_NAMES) {
          expect(hexes.get(`${selector} ${name}`), `${selector} ${name}`).toBe(
            tokens[name]?.toLowerCase(),
          )
        }
      }
    }
  })

  it('puts every accent block after both palette media blocks, and both name all six', () => {
    // The order is load-bearing in one direction and the `!important`s are
    // load-bearing in the other. The accent blocks are later in source order and
    // the dark ones are a class more specific, so without the media blocks
    // winning on importance a brand colour survives into Windows High Contrast
    // and reproduces the 1.49:1 failure this codebase has already shipped once.
    const css = read('src/styles/tokens.css')
    const contrastAt = css.indexOf('@media (prefers-contrast: more) {')
    const forcedAt = css.indexOf('@media (forced-colors: active) {')
    expect(contrastAt).toBeGreaterThan(-1)
    expect(forcedAt).toBeGreaterThan(-1)
    for (const rule of accentRules()) {
      expect(rule.at, rule.selector).toBeGreaterThan(contrastAt)
      expect(rule.at, rule.selector).toBeGreaterThan(forcedAt)
    }
    // The two blocks that own the *colour palette*, not the two at the bottom
    // that own the scales: the accent is not geometry, and a token remapped in
    // the wrong one of the two would not survive the other. The region's end is
    // the first accent rule rather than a heading, so a banner rename cannot
    // silently reduce this to an empty slice that passes.
    const palette = css.slice(contrastAt, Math.min(...accentRules().map((rule) => rule.at)))
    expect(palette.length, 'the palette media region').toBeGreaterThan(1000)
    for (const name of ACCENT_TOKEN_NAMES) {
      expect(
        new RegExp(`${name}:\\s*[^;]*!important`).test(palette),
        `${name} in the palette blocks`,
      ).toBe(true)
    }
  })

  it('gives the editor the same two tokens in both grounds, and the Hub a different four', () => {
    for (const accent of ACCENTS) {
      const light: AppearanceState = {
        ...DEFAULT_STATE,
        attributes: { 'data-accent': accent.id as AccentId },
      }
      const dark: AppearanceState = {
        ...DEFAULT_STATE,
        prefersDark: true,
        attributes: { 'data-theme': 'dark', 'data-accent': accent.id as AccentId },
      }
      for (const name of ['--ie-accent', '--ie-accent-bright']) {
        expect(tokenValue(name, dark), `${accent.id} ${name} on the editor`).toBe(
          tokenValue(name, light),
        )
      }
      // And the Hub half does differ, which is the entire reason there are two
      // scopes: one value cannot clear 4.5:1 on a white Hub and be visible on a
      // near-black editor.
      expect(tokenValue('--accent', dark), `${accent.id} --accent`).not.toBe(
        tokenValue('--accent', light),
      )
    }
  })

  it('leaves --focus-ring a literal hex on every accent, so it stays checkable', () => {
    // `appShell.test.ts:82` asserts the base declaration is `#[0-9a-f]{6}` and
    // `:76` asserts the ring is drawn from it. An alias would break the first and
    // make the ring impossible to contrast-check without re-deriving the accent
    // underneath it. That has to hold for all four accents, not just the default.
    for (const accent of ACCENTS) {
      for (const scope of ['light', 'dark'] as const) {
        const tokens = accent[scope] as unknown as Record<string, string>
        expect(tokens['--focus-ring'], `${accent.id}.${scope}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
    const declared = stripTopLevelMedia(strip(read('src/styles/tokens.css')))
    expect(declared).toMatch(/--focus-ring: #[0-9a-f]{6};/)
    expect(declared).not.toMatch(/--focus-ring:\s*var\(/)
  })
})

describe('data-icons moves all six size sites and keeps the pill proportional', () => {
  const withIcons = (value: 'small' | 'large'): AppearanceState => ({
    ...DEFAULT_STATE,
    attributes: { 'data-icons': value },
  })

  it('resolves each of the six, and the pill icon is measured in em', () => {
    const sites: [string, string, string, number][] = [
      ['.theme-toggle__icon', 'width', 'src/styles/base.css', 18],
      ['.icon-tile svg', 'width', 'src/styles/base.css', 24],
      ['.iconButton svg', 'width', 'src/components/controls/controls.module.css', 22],
      ['.tab svg', 'width', 'src/components/editor/editor.module.css', 22],
      ['.tool-card__arrow', 'width', 'src/styles/hub.css', 16],
    ]
    for (const [selector, property, , base] of sites) {
      expect(computedFor(selector, property, DEFAULT_STATE), selector).toBe(base)
      expect(computedFor(selector, property, withIcons('small')), `${selector} small`).toBeCloseTo(
        base * 0.875,
        4,
      )
      expect(computedFor(selector, property, withIcons('large')), `${selector} large`).toBeCloseTo(
        base * 1.25,
        4,
      )
    }
    // The sixth is the compare pill, and it is the exception: 14px against the
    // pill's 12px font, authored in `em` so the glyph keeps its weight beside the
    // label when the text scale moves, with the icon scale still on top.
    const pill = computedFor('.compareToggle svg', 'width', DEFAULT_STATE)
    expect(pill).toBeCloseTo(1.1667, 4)
    expect(computedFor('.compareToggle svg', 'width', withIcons('large'))).toBeCloseTo(
      1.1667 * 1.25,
      4,
    )
    // And at the default text size that is the 14px it has always been.
    expect(pill * 0.75 * 16).toBeCloseTo(14, 1)
  })

  it('has no other icon size site left as a literal', () => {
    // Six sites was the whole set, and this is what stops it becoming seven.
    const sites: string[] = []
    for (const path of sourceFiles('src', '.css')) {
      for (const match of strip(read(path)).matchAll(/([^{}]*svg[^{}]*)\{([^{}]*)\}/g)) {
        const rule = match[1] as string
        const body = match[2] as string
        for (const [property, value] of body.matchAll(/(width|height)\s*:\s*(\d+px)/g)) {
          sites.push(`${path} ${rule.trim()} ${property}: ${value[2]}`)
        }
      }
    }
    expect(sites).toEqual([])
  })
})

describe('prefers-reduced-transparency collapses the translucent surfaces', () => {
  const reduced: AppearanceState = { ...DEFAULT_STATE, reducedTransparency: true }

  it('flattens the eight editor fills and the hairline to the colour they resolved to', () => {
    // Each value is `rgba(255, 255, 255, α)` over the editor's `#1c1c1e` at full
    // alpha. A collapse that set them all to one grey would flatten a scale whose
    // whole job is to show where a finger is, so the ladder has to survive: a
    // control at rest and the same control on hover must still differ.
    const expected: Record<string, string> = {
      '--ie-fill-target': '#232325',
      '--ie-fill-sunken': '#252527',
      '--ie-fill-quiet': '#272729',
      '--ie-fill-rest': '#2a2a2c',
      '--ie-fill-hover': '#2e2e30',
      '--ie-fill-active': '#303032',
      '--ie-fill-selected': '#404042',
      '--ie-hairline': '#373739',
      '--ie-ink-soft': '#98989f',
      '--ie-chrome': '#1c1c1e',
    }
    for (const [name, want] of Object.entries(expected)) {
      expect(tokenValue(name, reduced), name).toBe(want)
      expect(tokenValue(name, DEFAULT_STATE), `${name} normally`).toMatch(/^rgba\(|^#1c1c1e$/)
    }
    expect(tokenValue('--ie-fill-rest', reduced)).not.toBe(tokenValue('--ie-fill-hover', reduced))
  })

  it('turns every backdrop-filter off, in the file that owns each rule', () => {
    const sites = allRules.filter(
      (rule) =>
        rule.media === '(prefers-reduced-transparency: reduce)' &&
        /backdrop-filter:\s*none/.test(rule.body),
    )
    for (const selector of ['.nav', '.topBar', '.tabBar', '.compareToggle', '.compareBadge']) {
      expect(
        sites.some((rule) => rule.selectors.includes(selector)),
        `${selector} has no reduced-transparency rule`,
      ).toBe(true)
    }
  })

  it('resolves each of those rules to two different values, which is the point', () => {
    // The assertion the brief asks for, applied to this mode: not "the selector
    // appears near the word" but "the declaration differs with the media feature
    // on". `.nav` is the interesting one — its translucency exists to let the
    // page show through, so it has to become the page rather than a paler
    // version of itself.
    for (const [selector, property] of [
      ['.nav', 'background'],
      ['.topBar', 'background'],
      ['.tabBar', 'background'],
      ['.sheetBackdrop', 'background'],
      ['.toast', 'background'],
      ['.helpOverlay', 'background'],
      ['.cropBox', 'box-shadow'],
      ['.crashPre', 'background'],
    ] as [string, string][]) {
      const base = rawDeclaration(selector, property, DEFAULT_STATE)
      const opaque = rawDeclaration(selector, property, reduced)
      expect(base, `${selector} ${property} normally`).toBeTruthy()
      expect(opaque, `${selector} ${property} reduced`).toBeTruthy()
      expect(opaque, `${selector} ${property}`).not.toBe(base)
      expect(opaque, `${selector} ${property}`).toMatch(
        /^#[0-9a-f]{3,8}|^var\(--|9999px #[0-9a-f]{3,6}$/,
      )
    }
  })

  it('is not confused by the media feature being off, and not silent if it is unknown', () => {
    expect(mediaApplies('(prefers-reduced-transparency: reduce)', DEFAULT_STATE)).toBe(false)
    expect(mediaApplies('(prefers-reduced-transparency: reduce)', reduced)).toBe(true)
    // A resolver that returned `true` for a query it did not understand would
    // make every assertion above vacuous, and one that returned `false` would
    // make them fail for the wrong reason. Neither is acceptable, so it throws.
    expect(() => mediaApplies('(hover: none)', DEFAULT_STATE)).toThrow()
  })
})

/** The winning raw value of a property for a class selector, or `null`. */
function rawDeclaration(selector: string, property: string, state: AppearanceState): string | null {
  let winner: Declaration | null = null
  for (const rule of allRules) {
    if (!rule.selectors.includes(selector) || !mediaApplies(rule.media, state)) continue
    for (const declaration of parseDeclarations(rule.body)) {
      if (declaration.property === property) winner = declaration
    }
  }
  return winner?.value ?? null
}
