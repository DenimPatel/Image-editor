/**
 * Every third-party work this application ships, and the licence it ships
 * under.
 *
 * This module is a legal obligation rendered as data, not a courtesy. The app's
 * own `LICENSE` is MIT, and MIT covers *this* code only; it says nothing about
 * the fourteen self-hosted fonts, the ONNX runtime, the matting model, or the
 * PDF writer that are compiled into the same bundle. Before this file existed,
 * `grep -ri "OFL\|attribution\|credits\|THIRD_PARTY\|NOTICE"` across the repo
 * found exactly one hit and it was a Pexels photo credit. Thirteen SIL OFL
 * 1.1 fonts were being redistributed with no licence text and no notice of the
 * Reserved Font Name restriction, which is the specific thing OFL §2 and §3
 * require and the reason the SIL can act on it.
 *
 * Three properties make the list an invariant rather than a chore.
 *
 * **The font licences are not retyped.** They are copied from
 * `models.lock.json`, which is the build manifest `verify-assets.mjs` already
 * cross-checks against the runtime catalogue in `src/features/layers/fonts.ts`.
 * A hand-copied licence string is a licence string that is wrong six months
 * later, so `licenses.test.ts` and `verify-assets.mjs` both compare these
 * against the lock and fail on any disagreement.
 *
 * **A new dependency cannot arrive unannounced.** Every name in
 * `package.json`'s `dependencies` must have an entry here. The test asserts it
 * and `scripts/verify-assets.mjs` asserts it, so `npm run assets:check` — which
 * `npm run build` runs first — fails the build rather than shipping an
 * unacknowledged dependency. A new *dev* dependency needs no entry: nothing in
 * `devDependencies` reaches a user's browser.
 *
 * **The `why` field is the part an auditor actually reads.** "Bundled" is not
 * an answer to "why is a copyleft ONNX matting model in a MIT project", and the
 * honest answers differ per entry: some are load-bearing, one is declared but
 * currently unreferenced, and some are pulled in by a dependency rather than
 * chosen.
 *
 * **One entry is an unresolved decision rather than a fact.** `AGPL_DECISION`
 * states what `@imgly/background-removal` obliges anyone who distributes this
 * build to do, and what the three ways out cost. It does not pick one, because
 * that is an owner's call about licensing and product scope; a page that listed
 * the dependency accurately and stopped there would be understating it.
 */

/** `package` is a bundled npm work; `font` is a redistributed font file. */
export type BundledKind = 'package' | 'font'

export type BundledWork = {
  /** Stable key. The font entries reuse the id in `models.lock.json`. */
  id: string
  /** Human name as the upstream writes it. */
  name: string
  /** The version actually installed, or the lock's pinned revision. */
  version: string
  /**
   * SPDX identifier. `@imgly/background-removal` ships no SPDX id — its
   * `package.json` says `SEE LICENSE IN LICENSE.md` and that file is the GNU
   * Affero General Public License v3 — so the identifier is resolved here and
   * the test asserts the declared value against the installed package.
   */
  licence: string
  /** Upstream project or release the code came from. */
  url: string
  kind: BundledKind
  /**
   * Why the application carries this. Written per entry because the honest
   * answer ranges from "every export is a PDF through this" to "nothing
   * imports it".
   */
  why: string
  /**
   * True when the entry is named in `package.json`'s `dependencies`. Entries
   * pulled in by one of those are transitive: they ship inside a dependency's
   * lazy chunk, and the app never names them itself.
   */
  direct: boolean
  /** For transitive entries, the direct work that drags it in. */
  via?: string
  /**
   * A redistribution condition that a reader has to know about. Used by the
   * OFL fonts, where §2's "a copy of the licence accompanies every copy" is
   * the clause that decides whether the build is compliant.
   */
  notice?: string
}

/**
 * The font subsetting rule, stated once because it is the answer to the only
 * question an OFL audit asks about a self-hosted subset.
 *
 * What ships is **Google Fonts' own published latin/latin-ext woff2 subset**,
 * fetched once from `fonts.gstatic.com` and sha256-pinned in
 * `models.lock.json` — this project subsets nothing, repacks nothing and
 * renames nothing on disk. So there is no Modified Version here and OFL §3's
 * Reserved Font Name restriction is not engaged: the names in the shipped files
 * are Google's to use because the files are Google's, byte for byte. The
 * `IE <Family>` the Text panel lists is a **CSS family alias** registered in
 * `src/features/layers/fonts.ts`, so a machine with Inter installed cannot win
 * the canvas; the file's own internal name table still carries the family Google
 * published. OFL §2's other half — a copy of the licence accompanying each copy
 * of the Font Software — *is* engaged, and is satisfied by
 * `public/fonts/OFL-1.1.txt`, which ships beside the woff2 files because a link
 * is not a copy.
 *
 * An earlier revision of this comment said the opposite — "a subset is a
 * Modified Version", "the rename is why §3 is satisfied" — which contradicted
 * `OFL_NOTICE` twenty lines below it and `NOTICE`. The position recorded here is
 * the one the bytes support.
 */
export const OFL_NOTICE =
  'Redistributed as the latin/latin-ext woff2 subset Google Fonts published, byte-for-byte ' +
  'and sha256-pinned. This project makes no subset of its own, so no Reserved Font Name is ' +
  'used by a version this project created (OFL 1.1 §3); the "IE <Family>" the Text panel ' +
  'lists is a CSS family alias registered in src/features/layers/fonts.ts, not a rename of ' +
  'the file. The licence text accompanies the font at /fonts/OFL-1.1.txt (OFL 1.1 §2).'

export const FONT_LICENCES: BundledWork[] = [
  {
    id: 'inter',
    name: 'Inter',
    version: 'v20 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Inter',
    kind: 'font',
    why: 'The default text layer face in the editor, and the app’s own UI face.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'inter-bold',
    name: 'Inter Bold',
    version: 'v20 subset, weight 700',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Inter',
    kind: 'font',
    why: 'The bold weight of the default text layer face.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'playfair',
    name: 'Playfair Display',
    version: 'v40 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Playfair+Display',
    kind: 'font',
    why: 'A serif option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'oswald',
    name: 'Oswald',
    version: 'v57 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Oswald',
    kind: 'font',
    why: 'A condensed option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'montserrat',
    name: 'Montserrat',
    version: 'v31 subset, weight 600',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Montserrat',
    kind: 'font',
    why: 'A geometric sans in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'lora',
    name: 'Lora',
    version: 'v37 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Lora',
    kind: 'font',
    why: 'A text serif in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'roboto-mono',
    name: 'Roboto Mono',
    version: 'v31 subset',
    licence: 'Apache-2.0',
    url: 'https://fonts.google.com/specimen/Roboto+Mono',
    kind: 'font',
    why: 'The monospace option in the Text tool’s font list.',
    direct: true,
    notice:
      'Apache-2.0 §4 requires the licence copy to accompany the redistribution; it is at ' +
      '/licenses.html. No Reserved Font Name clause applies to this family, and the subset ' +
      'keeps the family name in its own internal tables only.',
  },
  {
    id: 'caveat',
    name: 'Caveat',
    version: 'v23 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Caveat',
    kind: 'font',
    why: 'A handwriting option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'pacifico',
    name: 'Pacifico',
    version: 'v23 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Pacifico',
    kind: 'font',
    why: 'A script option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'bebas',
    name: 'Bebas Neue',
    version: 'v16 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Bebas+Neue',
    kind: 'font',
    why: 'A display-caps option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'dm-serif',
    name: 'DM Serif Display',
    version: 'v17 subset',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/DM+Serif+Display',
    kind: 'font',
    why: 'A display serif in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'space-grotesk',
    name: 'Space Grotesk',
    version: 'v22 subset, weight 500',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Space+Grotesk',
    kind: 'font',
    why: 'A grotesque option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'archivo',
    name: 'Archivo',
    version: 'v25 subset, weight 600',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Archivo',
    kind: 'font',
    why: 'A grotesque option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
  {
    id: 'barlow',
    name: 'Barlow',
    version: 'v13 subset, weight 500',
    licence: 'OFL-1.1',
    url: 'https://fonts.google.com/specimen/Barlow',
    kind: 'font',
    why: 'A sans option in the Text tool’s font list.',
    direct: true,
    notice: OFL_NOTICE,
  },
]

export const PACKAGE_LICENCES: BundledWork[] = [
  {
    id: '@imgly/background-removal',
    name: '@imgly/background-removal',
    version: '1.7.0',
    licence: 'AGPL-3.0',
    url: 'https://github.com/imgly/background-removal-js',
    kind: 'package',
    why:
      'The Background tool’s cut-out. It is not MIT: the published package carries the GNU ' +
      'Affero General Public License v3 in its LICENSE.md, which is an obligation rather than ' +
      'an attribution and is why the work is named here at all. It is imported dynamically, so ' +
      'it is fetched only when the tool is used. Whether the project may distribute the build at ' +
      'all is an open decision recorded in AGPL_DECISION, not something this entry settles.',
    direct: true,
  },
  {
    id: '@use-gesture/react',
    name: '@use-gesture/react',
    version: '10.3.1',
    licence: 'MIT',
    url: 'https://github.com/pmndrs/react-use-gesture',
    kind: 'package',
    why: 'Pointer, wheel and pinch handling on the canvas.',
    direct: true,
  },
  {
    id: 'comlink',
    name: 'comlink',
    version: '4.4.2',
    licence: 'Apache-2.0',
    url: 'https://github.com/GoogleChromeLabs/comlink',
    kind: 'package',
    why:
      'Declared as a runtime dependency but referenced by no module in src/ at the time of ' +
      'writing, so it contributes nothing to the bundle. It is listed because this table ' +
      'records what package.json claims, and the build gate checks that claim in both ' +
      'directions.',
    direct: true,
  },
  {
    id: 'fflate',
    name: 'fflate',
    version: '0.8.3',
    licence: 'MIT',
    url: 'https://github.com/101arrowz/fflate',
    kind: 'package',
    why: 'Zip compression for the multi-size export and for session bundles.',
    direct: true,
  },
  {
    id: 'idb',
    name: 'idb',
    version: '8.0.3',
    licence: 'ISC',
    url: 'https://github.com/jakearchibald/idb',
    kind: 'package',
    why: 'The promise wrapper around IndexedDB that the session store is built on.',
    direct: true,
  },
  {
    id: 'jspdf',
    name: 'jsPDF',
    version: '4.2.1',
    licence: 'MIT',
    url: 'https://github.com/parallax/jsPDF',
    kind: 'package',
    why: 'Writes the PDF exports: the passport print sheet and the “PDF” export format.',
    direct: true,
  },
  {
    id: 'onnxruntime-web',
    name: 'onnxruntime-web',
    version: '1.21.0',
    licence: 'MIT',
    url: 'https://github.com/microsoft/onnxruntime',
    kind: 'package',
    why: 'Runs the matting model in WebAssembly for the Background tool.',
    direct: true,
  },
  {
    id: 'react',
    name: 'React',
    version: '18.3.1',
    licence: 'MIT',
    url: 'https://react.dev',
    kind: 'package',
    why: 'The UI runtime.',
    direct: true,
  },
  {
    id: 'react-dom',
    name: 'React DOM',
    version: '18.3.1',
    licence: 'MIT',
    url: 'https://github.com/facebook/react',
    kind: 'package',
    why: 'The React renderer for the browser.',
    direct: true,
  },
  {
    id: 'react-router-dom',
    name: 'react-router-dom',
    version: '6.30.6',
    licence: 'MIT',
    url: 'https://github.com/remix-run/react-router',
    kind: 'package',
    why: 'The Hub and editor routes.',
    direct: true,
  },
  {
    id: 'zustand',
    name: 'Zustand',
    version: '5.0.15',
    licence: 'MIT',
    url: 'https://github.com/pmndrs/zustand',
    kind: 'package',
    why: 'The document and UI stores.',
    direct: true,
  },
  {
    id: '@babel/runtime',
    name: '@babel/runtime',
    version: '7.29.7',
    licence: 'MIT',
    url: 'https://github.com/babel/babel',
    kind: 'package',
    why: 'Emitted helper functions inside jsPDF’s build.',
    direct: false,
    via: 'jspdf',
  },
  {
    id: 'canvg',
    name: 'canvg',
    version: '3.0.11',
    licence: 'MIT',
    url: 'https://github.com/canvg/canvg',
    kind: 'package',
    why:
      'An optional dependency of jsPDF, lazily imported for its SVG path. The app never asks ' +
      'jsPDF to draw an SVG, so this chunk is never fetched at runtime — it is in the install ' +
      'and therefore in the record.',
    direct: false,
    via: 'jspdf',
  },
  {
    id: 'dompurify',
    name: 'DOMPurify',
    version: '3.4.15',
    licence: 'MPL-2.0 OR Apache-2.0',
    url: 'https://github.com/cure53/DOMPurify',
    kind: 'package',
    why:
      'An optional dependency of jsPDF, lazily imported for its .html() path. Dual-licensed: ' +
      'the MPL-2.0 file-level copyleft applies to DOMPurify’s own source and not to a work that ' +
      'merely links it, but the choice has to be stated rather than assumed.',
    direct: false,
    via: 'jspdf',
  },
  {
    id: 'fast-png',
    name: 'fast-png',
    version: '6.4.0',
    licence: 'MIT',
    url: 'https://github.com/emn178/pngjs',
    kind: 'package',
    why: 'PNG encode/decode inside jsPDF.',
    direct: false,
    via: 'jspdf',
  },
  {
    id: 'html2canvas',
    name: 'html2canvas',
    version: '1.4.1',
    licence: 'MIT',
    url: 'https://github.com/niklasvh/html2canvas',
    kind: 'package',
    why:
      'An optional dependency of jsPDF, lazily imported for its .html() path. The app renders ' +
      'PDFs from canvas data and text, never from a DOM tree, so this chunk is never fetched.',
    direct: false,
    via: 'jspdf',
  },
  {
    id: 'lodash-es',
    name: 'lodash-es',
    version: '4.18.1',
    licence: 'MIT',
    url: 'https://github.com/lodash/lodash',
    kind: 'package',
    why: 'A dependency of @imgly/background-removal, which is imported with the Background tool.',
    direct: false,
    via: '@imgly/background-removal',
  },
  {
    id: 'ndarray',
    name: 'ndarray',
    version: '1.0.19',
    licence: 'MIT',
    url: 'https://github.com/scijs/ndarray',
    kind: 'package',
    why: 'A dependency of @imgly/background-removal.',
    direct: false,
    via: '@imgly/background-removal',
  },
  {
    id: 'zod',
    name: 'zod',
    version: '3.25.76',
    licence: 'MIT',
    url: 'https://github.com/colinhacks/zod',
    kind: 'package',
    why: 'A dependency of @imgly/background-removal.',
    direct: false,
    via: '@imgly/background-removal',
  },
]

/** Everything the build ships, fonts first so the licence texts lead. */
export const BUNDLED_WORKS: BundledWork[] = [...FONT_LICENCES, ...PACKAGE_LICENCES]

/** The licences present, deduplicated and sorted, for the summary line. */
export function licenceIds(): string[] {
  return [...new Set(BUNDLED_WORKS.map((work) => work.licence))].sort()
}

/** Works under one licence. */
export function worksUnder(licence: string): BundledWork[] {
  return BUNDLED_WORKS.filter((work) => work.licence === licence)
}

/** `true` when the work is a direct `package.json` dependency. */
export function directDependencies(): BundledWork[] {
  return BUNDLED_WORKS.filter((work) => work.kind === 'package' && work.direct)
}

/**
 * The two works whose licence carries an obligation rather than a request, in
 * the order a reader needs them. `@imgly/background-removal` is first because
 * AGPL-3.0 is the one entry that changes what this project is allowed to do, and
 * it is **an open decision this repository has not made** — see `AGPL_DECISION`
 * below. The OFL note is second because it is the one obligation that is
 * currently *met*.
 */
export const OBLIGATIONS: { id: string; headline: string; detail: string }[] = [
  {
    id: '@imgly/background-removal',
    headline: '@imgly/background-removal is AGPL-3.0, not MIT',
    detail:
      'The published package carries the GNU Affero General Public License v3 in its LICENSE.md. ' +
      'It is imported dynamically, so it is fetched only when the Background tool runs, and its ' +
      'model weights are not bundled in this repository — but nothing in that reduces what a ' +
      'redistributor owes. This is an unresolved decision, not a resolved one; the three options ' +
      'and what each costs are set out in the AGPL decision panel on /licenses.html and in ' +
      'NOTICE.',
  },
  {
    id: 'ofl',
    headline: 'The fonts are OFL 1.1, redistributed unmodified',
    detail:
      'OFL 1.1 §2 requires a copy of the licence to accompany every copy of the Font Software, ' +
      'and it ships beside the woff2 files at /fonts/OFL-1.1.txt rather than behind a link. What ' +
      'ships is Google Fonts’ own published latin/latin-ext subset, byte-for-byte and sha256-pinned, ' +
      'so this project creates no Modified Version and OFL §3’s Reserved Font Name restriction is ' +
      'not engaged. The “IE <Family>” the Text panel lists is a CSS alias, not a rename of the ' +
      'file. Roboto Mono is the one bundled font under Apache-2.0 instead; its text is at ' +
      '/fonts/Apache-2.0.txt.',
  },
]

/**
 * The AGPL question, written out where a maintainer will actually meet it.
 *
 * It is here rather than only in `NOTICE` because a licence page that lists the
 * dependency accurately but omits the obligation is a worse problem than one that
 * says plainly "we are shipping AGPL and here is what that means".
 *
 * **The facts.** `@imgly/background-removal@1.7.0` is AGPL-3.0: the package's
 * `LICENSE.md` opens with the Affero text and there is no MIT anywhere in it. It
 * is a runtime `dependencies` entry, dynamically imported by the Background tool.
 *
 * **Who owes what.** An end user who merely runs the hosted app is a *user* of
 * the AGPL, not a conveyer — running it is not distribution, so the everyday
 * visitor owes nothing. Anyone who **distributes this build** is conveying a
 * combined work (this application plus the AGPL library linked into it) and owes
 * the corresponding source under AGPL §5(a), subject to §5(d)'s
 * `Corresponding Source` carve-out for the library's own notices. AGPL §13 adds
 * the network clause: a hosted *modified* deployment is also in scope, which is
 * why "we only run it on GitHub Pages" is a distribution question and not a way
 * out of one.
 *
 * **What is not decided here.** This repository does not choose between the three
 * options below, because the choice is an owner's decision about licensing,
 * hosting and product scope rather than a fact about the tree. Until somebody
 * makes it, the accurate statement is the one above: the obligation exists and
 * is unmet for anyone who conveys the build.
 */
export const AGPL_DECISION: {
  headline: string
  facts: string
  who: string
  options: { label: string; cost: string }[]
  closing: string
} = {
  headline: 'An open licence decision: shipping an AGPL library in an MIT app',
  facts:
    '@imgly/background-removal@1.7.0 is AGPL-3.0 — the package’s own LICENSE.md opens with the ' +
    'GNU Affero General Public License v3, and there is no MIT anywhere in it. It is a runtime ' +
    'dependency of this application, dynamically imported by the Background tool. This ' +
    'application’s own code is MIT; that licence does not extend to the AGPL work linked into ' +
    'the same bundle.',
  who:
    'An end user who merely runs the hosted app is a user of the AGPL, not a conveyer — nothing is ' +
    'owed for using it. Anyone who distributes this build is conveying a combined work (this ' +
    'application plus the AGPL library linked into it) and owes the corresponding source under ' +
    'AGPL §5(a). AGPL §13 additionally puts a hosted, modified deployment in scope, so “it only ' +
    'runs on GitHub Pages” is a distribution question, not an exemption.',
  options: [
    {
      label: 'Obtain permission',
      cost:
        'Ask imgly for a commercial licence, or for the cut-out to be relicensed, or for an ' +
        'explicit exemption. It may be granted and it may not, on their timetable rather than ' +
        'ours. Until it is in writing, the obligation stands. Nothing else in this repository has ' +
        'to change while the request is outstanding.',
    },
    {
      label: 'Replace the dependency',
      cost:
        'Implement or license background removal another way and drop @imgly/background-removal. ' +
        'This is the only option that ends the obligation by removing its cause. It costs a ' +
        'matting model and a runtime, and the manual background-replacement path that exists ' +
        'today is not a cut-out — it needs a matte to show through, and the matte is what this ' +
        'library produces. The Background tool cannot ship in its current form without it.',
    },
    {
      label: 'Publish the corresponding source',
      cost:
        'Oblige under §5(a) rather than asking for or avoiding anything: release this ' +
        'application’s complete corresponding source alongside every distribution, including the ' +
        'build scripts and the modifications a recipient makes. This project’s own code is MIT and ' +
        'stays MIT; the AGPL reaches only the combined work. The cost is the ongoing obligation ' +
        'and the loss of the ability to distribute the build as a closed product.',
    },
  ],
  closing:
    'This page does not choose. The accurate statement today is that the obligation exists and ' +
    'is unmet for anyone who conveys this build; “anyone redistributing this build should read the ' +
    'upstream licence before shipping it” is advice, and advice discharges an obligation under no ' +
    'licence at all.',
}

/** A one-line summary for the footer and the crash screen. */
export function licencesSummary(): string {
  const fonts = FONT_LICENCES.length
  const packages = PACKAGE_LICENCES.length
  return `${fonts} fonts and ${packages} software packages`
}

/* ==========================================================================
   The rules.

   Exported rather than kept private because `scripts/verify-assets.mjs` is
   their second caller, and a rule that only one caller can reach is a rule that
   only one caller can be wrong about. It imports this module directly: Node 24
   strips the types, so the build gate and the Vitest suite run the *same*
   functions against the *same* table rather than two implementations of one
   idea — which is how the font check ended up with a regex copy in the script
   and a typed one here in the first place.

   Every function returns a list of problems instead of throwing. A build gate
   that crashes reports "the script is broken", and only one of those gets fixed.
   ========================================================================== */

/** The `{ id, licence }` shape `models.lock.json` has for a pinned font. */
export type PinnedFont = { id: string; licence: string }

/** Every runtime dependency with no entry in the table, sorted. */
export function missingDependencyEntries(dependencies: readonly string[]): string[] {
  const known = new Set(BUNDLED_WORKS.map((work) => work.id))
  return [...dependencies].filter((name) => !known.has(name)).sort()
}

/**
 * Entries marked as direct dependencies that `package.json` no longer names.
 *
 * The other direction, and the one that catches a dependency that was removed
 * while its attribution stayed behind: an entry nobody ships is a claim about
 * software that is not in the build.
 */
export function orphanDirectEntries(dependencies: readonly string[]): string[] {
  const declared = new Set(dependencies)
  return PACKAGE_LICENCES.filter((work) => work.direct && !declared.has(work.id)).map(
    (work) => work.id,
  )
}

/**
 * Font licence disagreements between the table and `models.lock.json`.
 *
 * The lock is the build manifest the asset gate already trusts, so it is the
 * authority here. A licence string typed by hand into the table is a licence
 * string that is wrong the first time upstream changes it, and a wrong licence
 * string is worse than none: it is a false statement about a font.
 */
export function fontLicenceProblems(fonts: readonly PinnedFont[]): string[] {
  const entries = new Map(FONT_LICENCES.map((font) => [font.id, font]))
  const problems: string[] = []
  for (const font of fonts) {
    const entry = entries.get(font.id)
    if (!entry) {
      problems.push(
        `font "${font.id}" is pinned in models.lock.json but has no entry in src/lib/licenses.ts`,
      )
      continue
    }
    if (entry.licence !== font.licence) {
      problems.push(
        `font "${font.id}" is ${font.licence} in models.lock.json but ${entry.licence} in src/lib/licenses.ts`,
      )
    }
  }
  return problems
}

/**
 * Font entries for a font the lock does not pin.
 *
 * A subset that ships with no manifest entry has no sha256, which is the
 * D7-F07 defect `verify-assets.mjs` exists to catch on the other side.
 */
export function undeclaredFontEntries(fonts: readonly PinnedFont[]): string[] {
  const locked = new Set(fonts.map((font) => font.id))
  return FONT_LICENCES.filter((font) => !locked.has(font.id)).map((font) => font.id)
}

/**
 * Entries with nothing to attribute: no licence, or no upstream to attribute
 * to. A row with a name and a version and no URL is a row nobody can act on.
 */
export function incompleteEntries(): string[] {
  return BUNDLED_WORKS.filter(
    (work) => work.licence.trim() === '' || !/^https:\/\//.test(work.url),
  ).map((work) => work.id)
}

/** Transitive entries whose `via` is not itself a shipped direct dependency. */
export function danglingTransitiveEntries(dependencies: readonly string[]): string[] {
  const declared = new Set(dependencies)
  return PACKAGE_LICENCES.filter(
    (work) => !work.direct && (!work.via || !declared.has(work.via)),
  ).map((work) => work.id)
}
