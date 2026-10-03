/**
 * The product's vocabulary, as data.
 *
 * Twenty-odd people wrote the strings in this app one panel at a time and
 * nobody read the product as a whole, so it shipped three spellings of one
 * millimetre figure, two of "colour", and the word "matte" in two panels where
 * it means nothing to anybody who has not done a VFX shot. A convention somebody
 * forgets is not a convention; this file is the convention, and `copy.test.ts`
 * is what makes it stick.
 *
 * Two tables, deliberately:
 *
 * - **`COPY_RULES`** is enforced. Every entry is a rule the test can decide from
 *   the text alone, and each one is green on the branch that added it. A rule
 *   this file cannot decide mechanically belongs in `VOCABULARY` instead.
 * - **`VOCABULARY`** is the judgement, recorded so the next panel does not
 *   re-open it. Nothing in it is machine-checked, and the file says which of its
 *   entries are enforced above, because a reader who cannot tell the difference
 *   will assume all of it is.
 *
 * ## What counts as user-facing copy
 *
 * The hard part of a gate like this is not finding banned words, it is finding
 * only the ones a person reads. The answer here is a syntax tree rather than a
 * grep: only a JSX text node, a copy-bearing attribute, or a string in a
 * copy-bearing property is scanned. A comment is a `Comment` node and an
 * identifier is an `Identifier`, so neither can be mistaken for a word on
 * screen — which is the whole reason this is narrow enough to keep. Test
 * fixtures are out by construction (`*.test.ts(x)` is not in the file list).
 *
 * The one thing this cannot see is a string built somewhere else and rendered
 * by a component: `src/features/passport/specs.ts` holds the document
 * requirements, so it is listed in `COPY_MODULES` rather than being missed.
 * Anything that renders a raw string from outside that list is a hole, and the
 * honest statement of this gate is "every panel's own words", not "every word
 * the user ever sees".
 */

/**
 * Where a rule applies.
 *
 * - `anywhere`: any user-facing string, prose or name.
 * - `name`: only the string that *is* a control's or a chip's name. This is what
 *   makes the `Original` and `Auto` rules defensible: "the unedited photo" is
 *   legitimate prose, and "Hold to compare with the original" is a legitimate
 *   name. What is illegitimate is a control called simply `Original`, because
 *   that is the word the product has spent on the unedited photo.
 */
export type CopyScope = 'anywhere' | 'name'

export type CopyRule = {
  /** Stable id, so a failure names the decision rather than the regex. */
  id: string
  /** The one form this rule allows, in the app's own voice. */
  decision: string
  /** Why. This is the half a later agent needs in order to agree. */
  reason: string
  /** Whole words forbidden in user-facing copy, matched case-insensitively. */
  bannedWords?: readonly string[]
  /**
   * For the rules a word list cannot express. Handed one user-facing string,
   * returns the fault or `null`. Every `check` is exercised by `copy.test.ts`
   * with a string that must pass and a string that must not, so a `check` that
   * returns `null` unconditionally fails here rather than passing quietly.
   */
  check?: (text: string) => string | null
  scope?: CopyScope
}

/** `\b`-anchored, case-insensitive, so `colour` cannot match `colored`. */
export function wordPattern(words: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${words.join('|')})\\b`, 'i')
}

/**
 * Any measured size written with a width, a separator and a unit.
 *
 * `x`, `×` and the three spellings of inch are all accepted *here* on purpose:
 * this pattern exists to hand each of them to `canonicalSize` below, which then
 * rejects every form except the one the product prints.
 */
const MEASURED_SIZE = /\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:mm|in\b|inches?\b)/gi

/** The one spelling of a size: `4 × 6 in`, `35 × 45 mm`. Thin spaces, one unit. */
const CANONICAL_SIZE = /^(\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) (mm|in)$/

function canonicalSize(text: string): string | null {
  const match = text.replace(/\s+/g, ' ').trim()
  return CANONICAL_SIZE.test(match) ? match : null
}

/**
 * `2 × 2 in`, and every way of not writing it.
 *
 * The failure was three spellings of one number: `4 × 6 in` on the crop chip,
 * `4×6 in` retyped in the sheet picker, and the bare id `4x6` in a lookup table.
 * A size with two spellings is a size whose label can be wrong without anything
 * failing, and the millimetres are what the printer is handed — so the spaced
 * `×` and the unit are the whole of the rule, not a typographic preference.
 */
function checkSize(text: string): string | null {
  if (/\binch(?:es)?\b/i.test(text)) return 'write the unit as "in", not "inch"'
  for (const match of text.matchAll(MEASURED_SIZE)) {
    if (canonicalSize(match[0]) === null) {
      return `"${match[0].trim()}" is not the canonical spelling; write "W × H mm" or "W × H in"`
    }
  }
  return null
}

/**
 * Every rule the gate enforces.
 *
 * Order is the order the decisions were taken, not alphabetical: spelling first
 * because it is the one that spreads, then units, then the three ambiguous words.
 */
export const COPY_RULES: readonly CopyRule[] = [
  {
    id: 'colour',
    decision: 'colour',
    reason:
      'The 160-against-11 measurement that started this counted code, not words: almost ' +
      'every `Color` in the tree is an identifier — `currentColor`, `backgroundColor`, ' +
      'hexColor, ColorField — a CSS or SVG attribute, or a `Doc` field. In the prose a ' +
      'person actually reads, the app is already British and has been all along: "grey" ' +
      'and never "gray", "millimetres", "rasterised", "sanitised", "normalised", and ' +
      '"colour" in the orientation panel, the import screen, the hub and the passport ' +
      'rule labels. Choosing American would mean rewriting the prose; choosing British ' +
      'means fixing five outliers. The passport domain settles it too — those labels ' +
      'name documents whose rules the app quotes, and one of the eleven is British.',
    bannedWords: ['color', 'colors', 'colored', 'coloring', 'colorful'],
  },
  {
    id: 'matte',
    decision: 'the colour a transparent export is flattened onto, named by what it does',
    reason:
      '"Matte" is a compositing term: it names the card a shot is punched into, and a ' +
      'first-time user has no reason to know it. The export control does not need it ' +
      'either — "Behind transparent areas" then "Fill with a colour" says exactly what ' +
      'the matte does, which is what the user is choosing. The `Doc` field stays ' +
      '`output.matte`: that is a persisted on-disk name and this is a copy decision. ' +
      'Nothing a user reads needs the word, so the ban is total.',
    bannedWords: ['matte', 'mattes'],
  },
  {
    id: 'size-spelling',
    decision: '`W × H in` and `W × H mm` — one space either side of ×, one space before the unit',
    reason:
      'Three vocabularies for one millimetre figure: `4 × 6 in` on the crop chip, `4×6 in` ' +
      'retyped in the sheet picker, and the bare id `4x6`. This rule keeps the spaced form ' +
      'and refuses "inch" and "inches" outright — a print size is never plural, and ' +
      '"4 × 6 ins" is not a thing anyone says.',
    check: checkSize,
  },
  {
    id: 'size-id',
    decision: 'a print size is named, never identified',
    reason:
      'The closed set is the ids in `PRINT_SIZES`. Printing one is how the crop panel ' +
      'came to offer "4x6" beside "4 × 6 in" for the same piece of paper: the id is a ' +
      'lookup key, and a key that reaches the screen is a key a user has to decode.',
    bannedWords: ['4x6', '5x7', '8x10'],
  },
  {
    id: 'strength',
    decision: 'amount',
    reason:
      'Two panels said "Strength" and meant two different things — filter opacity in ' +
      'Looks, how hard a redaction bites in Redact. The orientation panel already chose ' +
      'the word: "a named bundle of adjustments … with an amount you can dial in and ' +
      'out". One word for "how much of this", everywhere.',
    bannedWords: ['strength', 'strengths'],
  },
  {
    id: 'centre',
    decision: 'centre',
    reason:
      'Found by this audit, not in its brief: the watermark anchor row said "Top centre" ' +
      'and the text-alignment row next to it said "Center", in the same panel. Same ' +
      'decision as `colour` — the prose is British, so the two spellings cannot both ' +
      'stand. Windows and macOS both ship the American form for alignment; this product ' +
      'does not.',
    bannedWords: ['center', 'centers', 'centered', 'centering'],
  },
  {
    id: 'original',
    decision: 'the unedited photo, and nothing else',
    reason:
      '"Original" meant three things at once: the compare badge, Export\'s "No resize" ' +
      'and crop\'s "Free". Two of the three have already been renamed at the call site, ' +
      'which is the right fix — the word is not ambiguous in a label, it is *claimed* by ' +
      "three labels. So the rule bans it as the whole of a control's name and allows " +
      'the two senses that are correct: the badge itself, which is a `role="status"` ' +
      'announcing the photo on screen rather than a control, and prose about the file ' +
      'the user brought in.',
    check: (text) =>
      /^original(\.\.\.|…)?$/i.test(text.trim()) ? 'the bare name "Original"' : null,
    scope: 'name',
  },
  {
    id: 'auto',
    decision: 'Auto always names the thing it acts on',
    reason:
      'A bare "Auto" was the button that rewrites six sliders, which read as "auto for ' +
      'the parameter selected above it". It is now "Auto tone"; the passport tool\'s is ' +
      '"Auto-frame the head". Both say what is touched. This rule bans the bare word as ' +
      'a control name and nothing else — a sentence is allowed to say "Auto set Contrast".',
    check: (text) => (/^auto(\.\.\.|…)?$/i.test(text.trim()) ? 'the bare name "Auto"' : null),
    scope: 'name',
  },
]

/**
 * The ambiguous terms, and which sense each one is now spent on.
 *
 * This is the part a regex cannot decide: two of these rows ("Original", "Auto")
 * are enforced above only in their narrow form, and the third ("the photo", "the
 * frame") is not a word at all. Recorded so the next panel does not spend a
 * settled word on a new sense.
 */
export const VOCABULARY: readonly {
  term: string
  means: string
  at: readonly string[]
  note: string
}[] = [
  {
    term: 'Original',
    means: 'the photo as the file arrived, before any edit in this session',
    at: ['the compare badge', 'the orientation panel, about the user’s own file'],
    note:
      'Spent. Export\'s resize mode is "No resize" and crop\'s unlocked ratio is "Free" — ' +
      'both renamed at the call site, because a word three labels share has to be given ' +
      'up by two of them, not disambiguated by proximity.',
  },
  {
    term: 'Auto',
    means: 'a control that measures the photo and rewrites something else',
    at: ['"Auto tone" in Adjust (six sliders)', '"Auto-frame the head" in Passport'],
    note:
      'A prefix, never a word. It must name what it acts on, because the thing it acts on ' +
      'is never the thing it sits next to.',
  },
  {
    term: 'Strength',
    means: 'nothing — the word is spent',
    at: ['Looks says "Amount"', 'Redact says "Amount"'],
    note:
      'Disambiguated by renaming, not by context: two panels, two meanings, one word, and ' +
      'no amount of surrounding text makes a slider label unambiguous. Both call sites have ' +
      'been renamed, so the rule above can now ban the word outright.',
  },
  {
    term: 'the photo / the frame / the image',
    means: 'the user’s source photo — never the crop, the canvas or the export',
    at: ['CropPanel, PassportPanel, LayersPanel'],
    note:
      'An app has four rectangles that all look like "the photo" on screen. Every reference ' +
      'in copy is resolved by saying which one: "the photo", "the crop", "the canvas", ' +
      '"the sheet". This is the one rule with no mechanical test behind it, and the reason ' +
      'the audit is a read-through rather than a grep.',
  },
  {
    term: 'looks',
    means: 'named bundles of adjustments, reversible, with an amount',
    at: ['the Looks tab', 'the orientation panel'],
    note:
      'Not "filters", and not "presets": a look is not a destructive effect and a preset ' +
      'is saved. The orientation panel teaches this word, so every panel may assume it. ' +
      'The word is spent on the tab, the sheet title and the shortcut table: the panel ' +
      'itself read "Filters" over a "LOOKS" section heading, which is a panel that ' +
      'contradicts the sentence introducing the feature. Note that no rule above can ' +
      'decide this one — "Filters" is not a banned word anywhere in the app, so the ' +
      'only thing holding the rename is this row, and a future panel may still write ' +
      '"filters" in prose without turning the gate red.',
  },
]

/**
 * Files that hold user-facing copy outside the component tree.
 *
 * Named rather than globbed because each one earns its place: these are the
 * modules whose string fields a panel renders verbatim. A new one has to be added
 * here or the gate will not see it, which is the failure mode worth writing down.
 */
export const COPY_MODULES: readonly string[] = [
  'src/features/passport/specs.ts',
  'src/features/passport/compliance.ts',
  'src/lib/flags.ts',
  // The looks catalogue lives in the GL backend because that is where the LUTs
  // are, and its `label` is a name on a chip in the Looks panel. Scanning it
  // costs one deferred row and closes the only hole left in the panels, which
  // would otherwise be the one place a banned word could arrive unnoticed.
  'src/gl/luts.ts',
]

/**
 * Copy that is still wrong and is not ours to change.
 *
 * Each entry is a live finding the scan produces today, subtracted from the
 * result by `copy.test.ts`. Nothing else is exempt: a *new* violation in one of
 * these files is still a failure, because the subtraction is by file, rule and
 * text rather than by file.
 *
 * A row is matched on **file, rule and text, never on a line number**. An agent
 * editing the panel above one of these strings moves it, and a gate keyed on a
 * line goes red for something nobody did — which is how a gate gets switched off
 * instead of being made right. A stale row is harmless: the subtraction then
 * matches nothing and the suite stays green. Delete it when you see it.
 *
 * Each row says which file the words are in and why they are waiting, because
 * "someone else's file" is not a reason, it is a queue.
 *
 * One row is left, and it is not a queue: it is a decision, recorded so that
 * nobody re-opens it and so that the remaining row is not read as an oversight.
 */
export const DEFERRED_COPY: readonly {
  file: string
  text: string
  rule: string
  ownedBy: string
}[] = [
  {
    file: 'src/gl/luts.ts',
    text: 'Faded Matte',
    rule: 'matte',
    ownedBy:
      'settled, not queued — no one is waiting to rename it, and the owner if anyone ever ' +
      'is, is whoever next edits `src/gl/luts.ts`, which owns the looks catalogue. A look is ' +
      'a proper name, in the same class as "CineStill 800T" and "Polaroid" in the row above ' +
      'it, and the ban is on UI vocabulary rather than on product names. The alternative is ' +
      'renaming a look that ships with a generated LUT and a generated thumbnail, in the GL ' +
      'backend rather than in the components that render it, with both `npm run luts:gen` and ' +
      '`npm run thumbs:gen` re-run and every committed byte and hash re-pinned by ' +
      '`npm run assets:check`. The cost of the rename is a regenerated asset chain for one ' +
      'word; the cost of not renaming is that one proper noun in a twenty-four-entry ' +
      'catalogue carries a term the rest of the product does not use.',
  },
]
