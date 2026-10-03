import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The four layout rules that let the chrome and a panel compete for the same
 * pixels, pinned at the level they are written.
 *
 * **These assertions are not measurements and must never be mistaken for one.**
 * jsdom lays nothing out: `scrollWidth` and `clientWidth` are `0` for every
 * element, so a jsdom test of "does this row overflow" passes on a row that
 * overflows by 780px. The measurements for all four of these live in
 * `e2e/journey.responsive.spec.ts`, in a real browser, because that is the only
 * place a claim about layout can be true.
 *
 * What is here instead is the part a browser test cannot give: a *declaration*.
 * Each of these rules was once correct-looking and wrong — `position: fixed` on a
 * sheet, a scrolling chip row, a toast anchored to the viewport bottom — and in
 * every case the diff read as a small, deliberate change. A declaration can be
 * pinned cheaply and fails loudly; the comment above it says why the value is
 * what it is. Read from disk rather than a `?raw` import, so this sees the file
 * the build ships, and comments are stripped first — several of these rules carry
 * a comment explaining the decision, and a note is not a declaration.
 */
const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const controls = strip(read('src/components/controls/controls.module.css'))
const editor = strip(read('src/components/editor/editor.module.css'))
const ratioChips = strip(read('src/components/tools/ratioChips.module.css'))
const passport = strip(read('src/components/tools/passportPanel.module.css'))
const glyphVisuals = strip(read('src/components/tools/layerVisuals.module.css'))
const canvasCss = strip(read('src/components/canvas/canvas.module.css'))
const gripCss = strip(read('src/components/canvas/transformHandles.module.css'))
const sheetHeights = read('src/components/controls/sheetHeights.ts')

/** The body of one rule, up to the brace that closes it. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|[,}\\s])${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`).exec(css)
  if (!match?.[1])
    throw new Error(`responsiveLayout.test.ts cannot find \`${selector}\` in the stylesheet`)
  return match[1]
}

/** A rule body with its runs of whitespace collapsed, for wrapped shorthands. */
function flat(body: string): string {
  return body.replace(/\s+/g, ' ')
}

/** The value of one declaration inside a rule body. */
function declaration(body: string, property: string): string {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body)
  if (!match?.[1])
    throw new Error(`responsiveLayout.test.ts cannot find \`${property}\` in \`${body.trim()}\``)
  return match[1].trim()
}

describe('a panel never covers the chrome', () => {
  it('the sheet and its scrim resolve against the canvas region, not the viewport', () => {
    // `position: fixed` is the defect. With it, `bottom: 0` means the bottom of
    // the *viewport* — which is where the tool tab bar is — so a panel opened on a
    // phone put all thirteen tool tabs, and `Done`, and `More options`, under
    // itself and under its scrim. `absolute` resolves against `.canvasRegion`,
    // which is `position: relative` and is itself the row between the two bars, so
    // `bottom: 0` stops the sheet at the tab bar's top edge with no height token
    // anywhere that could drift from the bar it has to clear.
    expect(declaration(rule(controls, '.sheet'), 'position')).toBe('absolute')
    expect(declaration(rule(controls, '.sheetBackdrop'), 'position')).toBe('absolute')
    expect(declaration(rule(controls, '.sheetBackdrop'), 'inset')).toBe('0')
  })

  it('the sheet is capped by the row it lives in, so a tall detent cannot scroll the canvas sideways', () => {
    expect(declaration(rule(controls, '.sheet'), 'max-height')).toBe('100%')
  })

  it('the desktop branch is still a column beside the canvas, not a sheet over the app', () => {
    const desktop = controls.slice(controls.indexOf('@media (min-width: 900px)'))
    const sheet = rule(desktop, '.sheet')
    expect(declaration(sheet, 'position')).toBe('absolute')
    expect(declaration(sheet, 'width')).toBe('var(--ie-inspector-width)')
    expect(declaration(sheet, 'max-height')).toBe('none')
    // The scrim is the modal's alone, and at desktop there is nothing modal.
    expect(declaration(rule(desktop, '.sheetBackdrop'), 'display')).toBe('none')
  })
})

describe('a chip row shows its whole labels', () => {
  /**
   * The failure these rows had was not overflow, it was *legibility*: each row
   * scrolled sideways inside a 360px column and `ChipRowShell`'s 34px fade sat
   * over the trailing chip, so a platform name read as a truncated word —
   * "LinkedI" for "LinkedIn 1:1", "YouTu" for "YouTube 16:9". A fade narrower
   * than the label it covers cannot honestly say "there is more this way".
   *
   * So the rows wrap. `overflow-x: auto` stays, and that is load-bearing rather
   * than legacy: wrapping cannot fix a single chip that is wider than the whole
   * column, and without a scroll box such a chip would be clipped somewhere
   * unreachable. Keeping the box also keeps `.rowMore` a real last resort rather
   * than a class no wrapped row can ever reach — a dead affordance is worse than
   * none, because it reads in the diff like the affordance is still there.
   */
  for (const [label, css, selector] of [
    ['the crop and passport shape chips', ratioChips, '.row'] as const,
    ['the adjustment rings', controls, '.parameterRow'] as const,
    ['the text chip rows', controls, '.chipRow'] as const,
    [
      // The Frame panel's style row and the Layers blend row. It was the last
      // row in the app still scrolling sideways: 634px of chips in a 327px
      // column at 1280 — 307px over — and 710px in the same column at `roomy` +
      // `xlarge`, 383px over. Every width, not a phone problem.
      'the layer panel style rows',
      glyphVisuals,
      '.glyphRow',
    ] as const,
  ]) {
    it(`${label} wrap rather than scroll`, () => {
      const body = rule(css, selector)
      expect(declaration(body, 'flex-wrap')).toBe('wrap')
      expect(declaration(body, 'overflow-x')).toBe('auto')
      // `align-content: flex-start` keeps the extra lines at their own height
      // rather than being stretched by spare height in the row.
      expect(declaration(body, 'align-content')).toBe('flex-start')
    })
  }
})

/**
 * Both canvas overlays answer over `--ie-tap`.
 *
 * The audit that started this measured `getBoundingClientRect()`, which reads the
 * *mark*, and reported the transform grips as 28px hit targets. Hit-testing them
 * says otherwise — the `nw` grip's press reaches 22px from its own centre and no
 * further, a 44x44 answer — while the crop handles reached 14px and no further,
 * which is only their own 28px. So the marks stay 28px in both files, because two
 * overlays over one photograph that disagree about grabber size read as one
 * overlay, and what had to change is that the crop overlay now carries the same
 * overhang. `e2e/journey.layout-measure.spec.ts` measures both in a real browser,
 * because jsdom measures neither.
 */
describe('a grabber over a photograph is a 44px target', () => {
  it('the transform grips keep their 28px mark and reach over --ie-tap', () => {
    expect(declaration(rule(gripCss, '.grip'), 'width')).toBe('28px')
    expect(declaration(rule(gripCss, '.grip'), 'height')).toBe('28px')
    const before = rule(gripCss, '.grip::before')
    expect(declaration(before, 'width')).toBe('var(--ie-tap)')
    expect(declaration(before, 'height')).toBe('var(--ie-tap)')
    expect(declaration(before, 'top')).toBe('calc((var(--ie-tap) - 28px) / -2)')
    expect(declaration(before, 'left')).toBe('calc((var(--ie-tap) - 28px) / -2)')
  })

  it('the crop handles draw the same 28px mark and reach over --ie-tap too', () => {
    // The defect: `.handle` declared a 28x28 box and nothing else, so its press
    // area was its own painted size while the grips beside it answered over 44.
    expect(declaration(rule(canvasCss, '.handle'), 'width')).toBe('28px')
    expect(declaration(rule(canvasCss, '.handle'), 'height')).toBe('28px')
    const before = rule(canvasCss, '.handle::before')
    expect(declaration(before, 'width')).toBe('var(--ie-tap)')
    expect(declaration(before, 'height')).toBe('var(--ie-tap)')
    expect(declaration(before, 'top')).toBe('calc((var(--ie-tap) - 28px) / -2)')
    expect(declaration(before, 'left')).toBe('calc((var(--ie-tap) - 28px) / -2)')
    // And the mark is still drawn at `inset: 7px`, so both overlays put the same
    // 14px of grabber on the same corner.
    expect(declaration(rule(canvasCss, '.handle::after'), 'inset')).toBe('7px')
  })

  it('both overlays draw the same mark, so "drag a handle" is one thing', () => {
    // The audit's finding: the layer grips were a near-white square in a dark ring
    // and the crop handles were a dark square in a white ring, in the two overlays a
    // user is most likely to have open at the same time. Both are defensible on their
    // own; having both is not. The crop's version is the one both files now declare
    // — a 2px opaque white ring around a dark interior — because that is already
    // what the `forced-colors` block says in *both* stylesheets, so the default theme
    // was the only place the two disagreed, and because a handle sits on a light line
    // (the crop edge, the dashed layer outline) that a light fill would merge with.
    //
    // Asserted as declarations because that is what a declaration can prove. The
    // pixels are `e2e/journey.layout-measure.spec.ts`'s business, and the *shape* of
    // the difference — a screenshot at 1280x900 with both overlays on one photo.
    const handle = rule(canvasCss, '.handle::after')
    const grip = rule(gripCss, '.grip::after')
    for (const property of ['background', 'border', 'border-radius']) {
      expect(declaration(grip, property), property).toBe(declaration(handle, property))
    }
    expect(declaration(handle, 'border')).toBe('2px solid #fff')
    expect(declaration(handle, 'background')).toBe('rgba(0, 0, 0, 0.25)')
  })

  it('the rotate grip stays a circle in the accent colour, in both overlays', () => {
    // The one thing that must still differ: rotation is a different gesture, and it
    // is told apart by shape — a filled circle, not a square — which survives a
    // greyscale print and forced colours where a hue difference would not.
    expect(declaration(rule(gripCss, '.rotateGrip::after'), 'border-radius')).toBe('50%')
    expect(declaration(rule(gripCss, '.rotateGrip::after'), 'background')).toBe(
      'var(--ie-accent-bright)',
    )
  })
})

/**
 * A layer smaller than its own grips.
 *
 * A one-line text layer is 34px tall on a phone and 2px tall at `SCALE_MIN`. A
 * grip is a 28px mark inside a 44px grab area, so four of them on a 2px box land
 * on the same pixel: measured in a real browser at 5% scale every corner grip's
 * reach was 0px in all four directions and every corner of the outline answered
 * to the *rotate* grip. Nothing is hidden and nothing is merged — the layer is
 * smaller than the control, so the control moves outside the layer, and these
 * pin the two pads that do it.
 *
 * They are not the same formula, and the asymmetry is the design: the top and
 * bottom pairs only have to clear *each other*, while the left and right pairs
 * also share the centre line with the rotate grip and so have to clear half a
 * target from it.
 */
describe('a layer thinner than its grips pushes them out rather than stacking them', () => {
  it('the vertical pad is the shortfall against one grab target', () => {
    expect(declaration(rule(gripCss, '.handleGroup'), '--grip-pad-y')).toBe(
      'max(0px, (var(--ie-tap) - var(--box-h, 0px)) / 2)',
    )
  })

  it('the horizontal pad clears the centre line the rotate grip sits on', () => {
    expect(declaration(rule(gripCss, '.handleGroup'), '--grip-pad-x')).toBe(
      'max(0px, var(--ie-tap) - var(--box-w, 0px) / 2)',
    )
  })

  it('the right-hand pair and the bottom pair push the other way', () => {
    // Both pairs would otherwise sit `14px - pad` inside the corner they name.
    expect(declaration(rule(gripCss, '.gripNe'), 'margin-left')).toBe(
      'calc(-14px + var(--grip-pad-x))',
    )
    expect(declaration(rule(gripCss, '.gripSw'), 'margin-top')).toBe(
      'calc(-14px + var(--grip-pad-y))',
    )
  })

  it('the rotate grip keeps its gap above the row it belongs over', () => {
    expect(declaration(rule(gripCss, '.rotateGrip'), 'margin')).toBe(
      'calc(-14px - var(--grip-pad-y)) 0 0 -14px',
    )
    // The `margin` shorthand is restated in full on purpose. `.grip`'s own
    // shorthand carries the *horizontal* pad, and the rotate grip sits on the
    // centre line — the one place that pad exists to keep clear — so inheriting
    // it dragged the rotate grip over the top-left grip and undid the fix this
    // whole block is for.
    expect(rule(gripCss, '.rotateGrip')).not.toContain('margin-top')
  })
})

describe('a toast lands where nothing is', () => {
  it('is anchored under the top bar, and not to the bottom of the viewport', () => {
    const body = rule(controls, '.toastStack')
    expect(declaration(body, 'top')).toBe('calc(var(--ie-topbar-height) + var(--space-3))')
    // `bottom` may only appear as the `auto` that unsets a bottom anchor.
    const bottom = /(?:^|;)\s*bottom\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
    expect(bottom ?? 'auto').toBe('auto')
  })

  it('is pushed off the Compare toggle on a phone, where the panel owns the full width', () => {
    // Below the breakpoint the canvas region's top-left corner is the Compare
    // toggle, and a centred toast's left edge landed 27px inside it. Nothing
    // else claims the top-right corner, so the stack hugs that instead.
    const phone = controls.slice(controls.indexOf('@media (max-width: 899px)'))
    const body = rule(phone, '.toastStack')
    expect(declaration(body, 'right')).toBe('var(--space-3)')
    expect(declaration(body, 'align-items')).toBe('flex-end')
  })

  it('is centred on a desktop, where the canvas column is the only free surface', () => {
    // At ≥ 900px the inspector column owns the right 360px, so a centred toast
    // lands on the picture rather than on the panel's controls.
    const body = rule(controls, '.toastStack')
    expect(declaration(body, 'left')).toBe('50%')
    expect(declaration(body, 'align-items')).toBe('center')
  })

  it("reads the top bar's height from the bar itself, so the offset cannot drift", () => {
    // Two copies of "52px plus the notch" is how a toast ends up back under the
    // panel: the bar grows for a reason nobody connects to a `--space-3` offset
    // in another file. The bar takes its own `min-height` from the token, so
    // there is one number.
    const tokens = editor.match(/--ie-topbar-height:\s*([^;]+);/)
    expect(tokens?.[1]?.trim()).toBe('calc(52px + var(--ie-safe-top))')
    expect(editor.match(/--ie-topbar-height:/g)).toHaveLength(1)
    expect(declaration(rule(editor, '.topBar'), 'min-height')).toBe('var(--ie-topbar-height)')
  })
})

/**
 * A bottom sheet is a fraction of the room it is competing for, not of the
 * window.
 *
 * Written as `34vh / 58vh / 90vh` the three detents were fractions of the
 * *viewport*, which is only a fraction of the room by coincidence — and at a short
 * window the coincidence is what breaks. On a phone held in landscape, 844x390:
 * the top bar takes 52 and the tab bar 65, so the canvas region is 273px and
 * `58vh` — 226px — left **47px** of canvas, which fitted a 10x15 image and put
 * eight crop handles and five layer grips into a strip narrower than a phone
 * case. The panel was open and the canvas was not there.
 *
 * `--ie-tabbar-height` is the same move as `--ie-topbar-height` above: the bar's
 * own height written once, so a detent computed from "the space available" cannot
 * go stale the first time a bar grows. It carries `--density-factor` where the
 * top bar's does not, because the tabs *are* what grows — `.tab`'s own
 * `min-height` is `52px * --density-factor` and nothing in `.tabBar` else moves.
 *
 * `min(fraction, space above the canvas floor)` is the whole fix, and the floor
 * is the sentence a sheet that cannot leave a usable canvas should not be open.
 * On a 390x844 phone the cap never binds and every detent is byte-identical to
 * what it was; it exists for the sizes where the old number was nonsense.
 * Measured at 844x390 in `e2e/journey.layout-measure.spec.ts`, because jsdom
 * cannot measure a viewport.
 */
describe('a bottom sheet leaves the canvas something to be', () => {
  it('knows how tall the tool tab bar is, without restating it', () => {
    expect(editor.match(/--ie-tabbar-height:\s*([^;]+);/)?.[1]?.trim()).toBe(
      'calc(52px * var(--density-factor) + 13px + var(--ie-safe-bottom))',
    )
    expect(editor.match(/--ie-tabbar-height:/g)).toHaveLength(1)
  })

  it('the token is still the sum of the three things that make the bar tall', () => {
    // `--ie-tabbar-height` is a *claim* about a bar this file does not lay out,
    // so the claim is pinned against its parts rather than trusted. A `padding`
    // shorthand changed on its own would make the token wrong by however much it
    // moved, and a stale detent is a canvas fitted into a strip the sheet is not
    // in — which is the defect this token exists to prevent.
    // Prettier wraps this shorthand over two lines, and a value is compared with
    // its runs of whitespace collapsed so that a re-wrap is not a failure.
    expect(flat(rule(editor, '.tabBar'))).toContain(
      'padding: 6px calc(8px + var(--ie-safe-right)) calc(6px + var(--ie-safe-bottom)) calc(8px + var(--ie-safe-left));',
    )
    expect(declaration(rule(editor, '.tabBar'), 'border-top')).toBe('1px solid var(--ie-hairline)')
    expect(declaration(rule(editor, '.tab'), 'min-height')).toBe(
      'calc(52px * var(--density-factor))',
    )
  })

  it('takes the room between the two bars as its own', () => {
    expect(editor.match(/--ie-sheet-space:\s*([^;]+);/)?.[1]?.trim()).toBe(
      'calc(100dvh - var(--ie-topbar-height) - var(--ie-tabbar-height))',
    )
    expect(editor.match(/--ie-sheet-space:/g)).toHaveLength(1)
  })

  it('caps every detent so the canvas keeps a floor under it', () => {
    // The floor is a length, not a percentage: these values are used as a
    // `margin-bottom` on the canvas as well as a `height` on the sheet, and a
    // percentage margin resolves against the containing block's *width*.
    expect(editor.match(/--ie-canvas-floor:\s*([^;]+);/)?.[1]?.trim()).toMatch(/^\d+px$/)
    for (const [detent, fraction] of [
      ['peek', '34vh'],
      ['medium', '58vh'],
      ['large', '90vh'],
    ]) {
      expect(editor.match(new RegExp(`--ie-sheet-${detent}:\\s*([^;]+);`))?.[1]?.trim()).toBe(
        `min(${fraction}, calc(var(--ie-sheet-space) - var(--ie-canvas-floor)))`,
      )
    }
  })

  it('has both consumers read the same three tokens', () => {
    // `BottomSheet` writes the sheet's `height` and `EditorCanvas` writes the
    // canvas's `margin-bottom`, both from `SHEET_HEIGHTS`. That table is the one
    // place the two can be made to agree, so it has to carry the `var()`s rather
    // than a second copy of the literals: two numbers free to drift is how the
    // canvas ends up fitted into a strip the sheet is not in.
    expect(sheetHeights).toMatch(/peek:\s*'var\(--ie-sheet-peek\)'/)
    expect(sheetHeights).toMatch(/medium:\s*'var\(--ie-sheet-medium\)'/)
    expect(sheetHeights).toMatch(/large:\s*'var\(--ie-sheet-large\)'/)
    expect(sheetHeights).not.toMatch(/vh'/)
  })
})

describe('a tool tab is as wide as its own name', () => {
  it('the tab cannot be shrunk below its label', () => {
    // `.tab` is a flex item in an overflowing row, so with the default
    // `flex-shrink: 1` it was squeezed to its 62px floor while its label was
    // wider — "Background" is 68px of text in a 46px content box — and the tab's
    // own `overflow: hidden` cut it off at both ends. The longest tool name in the
    // bar was the only one you could not read, while every other tab was hittable,
    // so a hit test alone would never have caught it.
    expect(declaration(rule(editor, '.tab'), 'flex')).toBe('0 0 auto')
    expect(declaration(rule(editor, '.tab'), 'min-width')).toBe(
      'calc(62px * var(--density-factor))',
    )
  })
})

describe('the passport panel does not scroll sideways to reach its own fields', () => {
  it('lets the two millimetre fields shrink to the column', () => {
    // A grid item defaults to `min-width: auto`, and `auto` resolves to the item's
    // *min-content* size — and an `<input>`'s min-content size is its intrinsic
    // width from the `size` attribute, about 202px, whatever `min-width: 0` on
    // the input itself says. Two `1fr` tracks were each asked to be at least
    // that, the grid came out 77px wider than the column, and every control in the
    // passport panel was reachable only by scrolling the panel sideways.
    expect(declaration(rule(passport, '.sizeField'), 'min-width')).toBe('0')
    // And the input inside it, which is the other half of the same sentence.
    expect(declaration(rule(passport, '.sizeInput'), 'min-width')).toBe('0')
  })
})

/**
 * A range input's own box *is* its hit area.
 *
 * Measured in a real browser at every width, density and text scale, the Export
 * panel's `Quality` slider was 248x16: the UA's own 16px, because nothing
 * declared a height. Its `<label>` is `min-height: var(--ie-tap)` and is a flex
 * row, so the 28px above and below the input was decoration — a press anywhere in
 * that band did nothing. This is the one control in the editor whose value is set
 * by dragging a *track* rather than by pressing a thumb-sized button, which makes
 * it the one where a 16px target costs the most.
 */
describe('a slider is as tall as the target the app promises', () => {
  it('gives the input itself the tap target, not just its label', () => {
    expect(declaration(rule(controls, '.sliderInput'), 'min-height')).toBe('var(--ie-tap)')
    // `width: 100%` stays: a slider that does not span the row is a slider with a
    // 16px target and a lot of dead space beside it.
    expect(declaration(rule(controls, '.sliderInput'), 'width')).toBe('100%')
  })

  it('gives the colour swatch the same target whichever way it is reached', () => {
    // A native `<input type="color">` answers only inside its own box. `ColorField`
    // puts it in a `min-height: var(--ie-tap)` label, and a label forwards an
    // activation press to its control, so that use was already 44px. The Export
    // panel's colour input has no label — only an `aria-label` — and at
    // `calc(32px * var(--density-factor))` tall it was a 32px target.
    expect(declaration(rule(controls, '.colorInput'), 'height')).toBe('var(--ie-tap)')
    expect(declaration(rule(controls, '.colorInput'), 'width')).toBe('var(--ie-tap)')
  })

  it('leaves forced colours owning the input, and the height to one rule', () => {
    // `height: 28px` was shared between the range input and the checkbox in the
    // forced-colors block, where it was serving the checkbox's 13px UA default.
    // A `min-height` outranks a `height`, so sharing it would have made the
    // declaration inert for the slider and misleading to whoever read it next.
    // `lastIndexOf`, because this file has two forced-colors blocks and the
    // first one is `.chipRowMore`'s.
    const forced = controls.slice(controls.lastIndexOf('@media (forced-colors: active)'))
    expect(rule(forced, '.sliderInput')).not.toContain('height')
    expect(flat(forced)).toContain('.toggle input { height: 28px; }')
  })
})
