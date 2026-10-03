import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ADJUST_KEYS, ADJUST_SPECS } from '../../../model/defaults'
import { BLEND_LABELS, BRUSHES, REDACT_MODES, blendModes } from '../../../features/layers/factory'
import { STICKERS } from '../../../features/layers/stickers'
import type { BlendMode, FrameStyle, ShapeLayer } from '../../../model/types'
import * as icons from './index'
import type { IconComponent } from './base'
import { hashSignature } from './signature'

const DRAWABLE = /<(path|line|circle|rect|polyline|polygon|ellipse)\b/g

/**
 * Everything the module exports that is a glyph, plus every member of every
 * lookup — discovered rather than listed. A hand-maintained list of the icons
 * under test is a list that quietly stops testing the icon added last week,
 * and "the system is one family" is not a claim that can be made about the
 * icons somebody remembered. Deduplicated by identity, because a lookup that
 * points at a named glyph is one shape under two names, not two shapes.
 */
function allGlyphs(): [string, IconComponent][] {
  const named = Object.entries(icons).filter(
    (entry): entry is [string, IconComponent] =>
      typeof entry[1] === 'function' && 'signature' in (entry[1] as object),
  )
  const looked = LOOKUPS.flatMap(([set, lookup]) =>
    Object.entries(lookup as Record<string, IconComponent>).map(
      ([key, Glyph]) => [`${set}.${key}`, Glyph] as [string, IconComponent],
    ),
  )
  const seen = new Set<IconComponent>()
  return [...named, ...looked].filter(([, Glyph]) => {
    if (seen.has(Glyph)) return false
    seen.add(Glyph)
    return true
  })
}

function render(Glyph: IconComponent, props: icons.IconProps = {}): string {
  return renderToStaticMarkup(<Glyph {...props} />)
}

const LOOKUPS: [string, Record<string, unknown>, string[]][] = [
  ['ADJUST_GLYPHS', icons.ADJUST_GLYPHS, ADJUST_KEYS],
  ['SHAPE_GLYPHS', icons.SHAPE_GLYPHS, ['rect', 'ellipse', 'line', 'arrow']],
  [
    'FRAME_GLYPHS',
    icons.FRAME_GLYPHS,
    ['solid', 'inset', 'polaroid', 'film', 'rounded', 'shadow-card'],
  ],
  ['BRUSH_GLYPHS', icons.BRUSH_GLYPHS, BRUSHES],
  ['BLEND_GLYPHS', icons.BLEND_GLYPHS, blendModes()],
  ['REDACT_MODE_GLYPHS', icons.REDACT_MODE_GLYPHS, REDACT_MODES],
  ['STICKER_GLYPHS', icons.STICKER_GLYPHS, STICKERS.map((sticker) => sticker.id)],
]

describe('the icon system', () => {
  it('is one system of a hundred marks, not a handful and a lookup', () => {
    expect(allGlyphs().length).toBeGreaterThan(90)
  })

  it('gives every ADJUST_SPECS entry a glyph, and no orphan glyphs', () => {
    // The invariant that stops this class of rot returning. `Record<AdjustKey,
    // …>` already makes a missing key a compile error; this makes a *renamed*
    // key a test failure, which is the case the compiler cannot see.
    const specKeys = ADJUST_SPECS.map((spec) => spec.key)
    expect(specKeys).toEqual(ADJUST_KEYS)
    expect(Object.keys(icons.ADJUST_GLYPHS).sort()).toEqual([...specKeys].sort())
    expect(Object.keys(icons.ADJUST_GLYPHS)).toHaveLength(ADJUST_SPECS.length)
  })

  it('keys every lookup by its own domain list, with nothing missing or extra', () => {
    for (const [name, lookup, expected] of LOOKUPS) {
      expect(Object.keys(lookup).sort(), name).toEqual([...expected].sort())
    }
  })

  it('never reuses one shape for two meanings', () => {
    // The whole reason this directory exists. `AdjustIcon`/`AdjustGlyph` and
    // `ExportIcon`/`ExportGlyph` were byte-identical path data under two
    // names, and a hash over the rendered element tree makes that impossible
    // to reintroduce: two glyphs with different meanings cannot produce the
    // same signature.
    const seen = new Map<string, string>()
    for (const [name, Glyph] of allGlyphs()) {
      const hash = hashSignature(Glyph.signature)
      const owner = seen.get(hash)
      expect(owner, `${name} and ${owner ?? ''} draw the same artwork`).toBeUndefined()
      seen.set(hash, name)
    }
    expect(seen.size).toBe(allGlyphs().length)
  })

  it.each(allGlyphs())('%s renders an svg on the shared base', (name, Glyph) => {
    const html = render(Glyph)
    const root = html.slice(0, html.indexOf('>') + 1)
    expect(root.startsWith('<svg'), name).toBe(true)
    expect(root, name).toContain('viewBox="0 0 24 24"')
    expect(root, name).toContain('fill="none"')
    expect(root, name).toContain('stroke="currentColor"')
    expect(root, name).toContain('stroke-linecap="round"')
    expect(root, name).toContain('stroke-linejoin="round"')
    // No intrinsic size: an SVG that carries width/height ignores the CSS that
    // sizes it, which is how one icon ends up a different optical size in the
    // tab bar than in the Hub card.
    expect(root, name).not.toMatch(/\swidth=/)
    expect(root, name).not.toMatch(/\sheight=/)
  })

  it('keeps every stroke in the system in the themable palette', () => {
    for (const [name, Glyph] of allGlyphs()) {
      for (const [, value] of render(Glyph).matchAll(/stroke="([^"]*)"/g)) {
        expect(['currentColor', 'none'], `${name} hard-codes stroke ${value}`).toContain(value)
      }
    }
  })

  it('draws something in every glyph', () => {
    for (const [name, Glyph] of allGlyphs()) {
      expect(Glyph.signature.length, name).toBeGreaterThan(0)
      expect(render(Glyph).match(DRAWABLE)?.length ?? 0, name).toBeGreaterThan(0)
    }
  })

  it('declares the family stroke weight on every mark', () => {
    for (const [name, Glyph] of allGlyphs()) {
      const html = render(Glyph)
      const root = html.slice(0, html.indexOf('>') + 1)
      expect(root, name).toContain('stroke-width="2"')
    }
  })

  it('pins the stroke only on the one glyph whose proportion is a runtime value', () => {
    // `non-scaling-stroke` answers "must not thicken as the rect changes
    // proportion", and the parameterised viewfinder is the only mark here whose
    // proportion is a prop. Pinning the fixed-ratio marks too would leave them
    // lighter than every other icon at 24px, which is the opposite of the
    // point.
    for (const [name, Glyph] of allGlyphs()) {
      const html = render(Glyph)
      const pinned = html.includes('vector-effect="non-scaling-stroke"')
      expect(pinned, name).toBe(name === 'AspectRatioGlyph')
    }
  })
})

describe('accessibility', () => {
  it('is hidden from assistive technology by default', () => {
    expect(render(icons.CloseGlyph)).toContain('aria-hidden="true"')
    expect(render(icons.CloseGlyph)).not.toContain('role=')
  })

  it('becomes a labelled image when given an accessible label', () => {
    const html = render(icons.CloseGlyph, { 'aria-label': 'Close editor' })
    expect(html).toContain('aria-label="Close editor"')
    expect(html).toContain('role="img"')
    expect(html).not.toContain('aria-hidden')
  })

  it('lets a caller override aria-hidden in either direction', () => {
    expect(render(icons.CloseGlyph, { 'aria-hidden': false })).toContain('aria-hidden="false"')
    expect(render(icons.CloseGlyph, { 'aria-label': 'Close', 'aria-hidden': true })).toContain(
      'aria-hidden="true"',
    )
  })
})

describe('the adjustment rings', () => {
  it('renders the mark belonging to the spec it is handed', () => {
    for (const spec of ADJUST_SPECS) {
      const expected = render(icons.ADJUST_GLYPHS[spec.key])
      expect(renderToStaticMarkup(<icons.AdjustIcon spec={spec} />), spec.key).toBe(expected)
    }
  })

  it('passes icon props through to the underlying glyph', () => {
    const html = renderToStaticMarkup(
      <icons.AdjustIcon spec={ADJUST_SPECS[0]} className="ring" aria-hidden={false} />,
    )
    expect(html).toContain('class="ring"')
    expect(html).toContain('aria-hidden="false"')
  })

  it('keeps every ring mark inside the circle the progress arc is drawn on', () => {
    // The rings are 42px discs with a 3-unit stroke; anything in the corners of
    // the 24 grid runs underneath it. Each mark's own bounding box has to stay
    // within a radius the ring leaves clear, or the arc is drawn through the
    // glyph rather than around it.
    for (const [key, Glyph] of Object.entries(icons.ADJUST_GLYPHS)) {
      for (const [, cx, cy, r] of render(Glyph).matchAll(
        /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g,
      )) {
        expect(Math.hypot(Number(cx) - 12, Number(cy) - 12) + Number(r), key).toBeLessThanOrEqual(
          9.2,
        )
      }
      const xs = [...render(Glyph).matchAll(/\b(?:x1|x2|cx|x)="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      )
      const ys = [...render(Glyph).matchAll(/\b(?:y1|y2|cy|y)="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      )
      for (const x of xs) expect(Math.abs(x - 12), `${key} x=${x}`).toBeLessThanOrEqual(10.5)
      for (const y of ys) expect(Math.abs(y - 12), `${key} y=${y}`).toBeLessThanOrEqual(10.5)
    }
  })
})

describe('the aspect viewfinder', () => {
  it('puts the division bars at the true fractional positions of the ratio', () => {
    for (const ratio of [16 / 9, 9 / 16, 1, 4 / 5, 3 / 2, 2 / 3, 5 / 7, 4 / 3, 1.91]) {
      const box = icons.viewfinderBox(ratio)
      expect(box.width / box.height, String(ratio)).toBeCloseTo(ratio, 6)
      expect(box.verticals[0] - box.x).toBeCloseTo(box.width / 3, 6)
      expect(box.verticals[1] - box.x).toBeCloseTo((2 * box.width) / 3, 6)
      expect(box.horizontals[0] - box.y).toBeCloseTo(box.height / 3, 6)
      expect(box.horizontals[1] - box.y).toBeCloseTo((2 * box.height) / 3, 6)
      expect(box.x).toBeGreaterThanOrEqual(1.5)
      expect(box.y).toBeGreaterThanOrEqual(1.5)
    }
  })

  it('falls back to a square rather than a degenerate box', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const box = icons.viewfinderBox(bad)
      expect(box.width / box.height).toBe(1)
    }
  })

  it('holds the stroke at a constant width as the box changes proportion', () => {
    const at = (ratio: number) => renderToStaticMarkup(<icons.AspectRatioGlyph ratio={ratio} />)
    expect(at(1)).toContain('vector-effect="non-scaling-stroke"')
    expect(at(16 / 9)).toContain('vector-effect="non-scaling-stroke"')
    // The division bars have to move when the proportion does, or the glyph is
    // lying about the ratio.
    expect(at(16 / 9)).not.toBe(at(1))
    expect(at(16 / 9)).not.toBe(at(9 / 16))
  })

  it('is the shape a camera uses: the rectangle carries the ratio, not a caption', () => {
    const landscape = icons.viewfinderBox(16 / 9)
    const portrait = icons.viewfinderBox(9 / 16)
    // Same grid, same stroke, genuinely different proportions — the reason
    // there is no `16:9` character to reach for.
    expect(landscape.width).toBeGreaterThan(landscape.height)
    expect(portrait.height).toBeGreaterThan(portrait.width)
    expect(landscape.width).toBe(portrait.height)
  })
})

describe('the promoted sticker artwork', () => {
  it('is byte-identical to the paths the compositor draws', () => {
    // `stickers.ts` is not allowed to import from here — it would drag image
    // decoding into every toolbar — so the data is declared twice on purpose
    // and this test is what makes the duplication safe. Change one side and
    // this names the other.
    expect(Object.keys(icons.STICKER_ART).sort()).toEqual(STICKERS.map((s) => s.id).sort())
    for (const original of STICKERS) {
      const promoted = icons.STICKER_ART[original.id as keyof typeof icons.STICKER_ART]
      expect(promoted.path, original.id).toBe(original.path)
      expect(promoted.fill, original.id).toBe(original.fill)
      expect(promoted.viewBox, original.id).toBe(original.viewBox)
      expect(promoted.label, original.id).toBe(original.label)
    }
  })

  it('gives the white-filled stickers a visible outline', () => {
    for (const [id, Glyph] of Object.entries(icons.STICKER_GLYPHS)) {
      expect(render(Glyph), id).toContain('stroke="currentColor"')
    }
  })
})

describe('the broken second meanings', () => {
  it('does not use undo or redo for rotation', () => {
    expect(icons.RotateLeftGlyph.signature).not.toBe(icons.UndoGlyph.signature)
    expect(icons.RotateRightGlyph.signature).not.toBe(icons.RedoGlyph.signature)
    // A 90° step is a rotation, not history: neither mark is the other's mirror
    // of a history arrow, and the two rotations are mirrors of each other.
    expect(icons.RotateLeftGlyph.signature).not.toBe(icons.RotateRightGlyph.signature)
  })

  it('does not use a grid for "fill frame after straighten"', () => {
    const grid = 'M3 9h18M3 15h18M9 3v18M15 3v18'
    for (const [name, Glyph] of allGlyphs()) {
      expect(Glyph.signature, name).not.toContain(grid)
    }
    expect(icons.FillFrameGlyph.signature).toContain('M7 8L3 4.5')
  })

  it('gives play and pause their own marks, and no other mark either', () => {
    // The appearance panel's Motion row previews itself with this pair, so both
    // are now on a surface a reader lands on rather than being the only two marks
    // in the family with nothing to collide with. `allGlyphs()` dedupes by
    // identity, so the duplicate-signature gate above already covers them against
    // everything else; what is stated here is that they exist, that they are
    // *different marks* rather than one mark under two names, and that neither is
    // a rotation of anything the crop panel already uses.
    expect(icons.PlayGlyph.signature).not.toBe(icons.PauseGlyph.signature)
    // A triangle and two bars: the difference is in kind, which is why the panel
    // test can tell them apart without reading either one's class name.
    expect(render(icons.PlayGlyph).match(DRAWABLE)).toHaveLength(1)
    expect(render(icons.PauseGlyph).match(DRAWABLE)).toHaveLength(2)
    expect(render(icons.PlayGlyph)).toContain('<path')
    expect(render(icons.PauseGlyph)).not.toContain('<path')
  })

  it('gives brightness, warmth and tint three different filled regions', () => {
    // Measured, not guessed: rasterising all fifteen ring marks at 22px and
    // taking the RMS between every pair put `warmth`/`tint` closest at 78.9 and
    // `brightness`/`tint` third at 84.7 — *inside* the band the design already
    // accepts for a deliberate one-axis pair, since `highlights`/`shadows` is
    // 84.4 and `saturation`/`vibrance` is 90.6. All three of brightness, warmth
    // and tint are circles with a filled region, so the ring family is what tells
    // them apart, and it does so on one axis: *which* region is filled.
    //
    // The marks are legible as drawn at 22px and at 32px, so the artwork is not
    // being changed. What is worth holding is the property that keeps the three
    // separable at 16px: no two of the fifteen may fill the same region, because
    // "which end is filled" is the entire difference between several of them.
    const filledOf = (key: keyof typeof icons.ADJUST_GLYPHS) =>
      (
        render(icons.ADJUST_GLYPHS[key]).match(/<\w+ [^>]*fill="currentColor" stroke="none"/g) ?? []
      ).join('|')

    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const key of Object.keys(icons.ADJUST_GLYPHS) as (keyof typeof icons.ADJUST_GLYPHS)[]) {
      const mark = filledOf(key)
      if (mark === '') continue
      const owner = seen.get(mark)
      if (owner) collisions.push(`${owner} / ${key}`)
      else seen.set(mark, key)
    }
    expect(seen.size, 'distinct filled regions').toBeGreaterThanOrEqual(10)
    expect(collisions).toEqual([])

    // Stated directly, because those three are the pair the brief asks about and
    // because a collision *between* them would be lost in the count above.
    expect(filledOf('brightness')).not.toBe(filledOf('warmth'))
    expect(filledOf('brightness')).not.toBe(filledOf('tint'))
    expect(filledOf('warmth')).not.toBe(filledOf('tint'))
    // Brilliance is brightness's other neighbour — the whole image against the
    // midtones only — and it lifts no region at all, which is how the two marks
    // differ by more than a fill.
    expect(filledOf('brilliance')).toBe('')
    expect(filledOf('brightness')).not.toBe('')
  })
})

describe('the exported sets', () => {
  it('names one mark per domain value', () => {
    const shapeKinds: ShapeLayer['shape'][] = ['rect', 'ellipse', 'line', 'arrow']
    expect(Object.keys(icons.SHAPE_GLYPHS)).toEqual(shapeKinds)
    const frameStyles: FrameStyle[] = [
      'solid',
      'inset',
      'polaroid',
      'film',
      'rounded',
      'shadow-card',
    ]
    expect(Object.keys(icons.FRAME_GLYPHS)).toEqual(frameStyles)
    const modes: BlendMode[] = blendModes()
    expect(Object.keys(icons.BLEND_GLYPHS)).toEqual(modes)
    expect(Object.keys(BLEND_LABELS)).toEqual(modes)
  })

  it('draws the brushes at the widths the brushes actually use', () => {
    // The five brushes differ in width scale, so the glyphs differ in width.
    const width = (name: keyof typeof icons.BRUSH_GLYPHS) => {
      const widths = [...render(icons.BRUSH_GLYPHS[name]).matchAll(/stroke-width="([\d.]+)"/g)]
      return Math.max(...widths.map((match) => Number(match[1])))
    }
    expect(width('pen')).toBe(2)
    expect(width('marker')).toBeGreaterThan(width('pen'))
    expect(width('neon')).toBeGreaterThan(width('marker'))

    // The highlighter's band is a fill, not a stroke, so it is measured as the
    // geometry it is: five grid units across, laid at the 0.35 alpha the
    // compositor uses.
    const band = render(icons.BRUSH_GLYPHS.highlighter)
    expect(band).toMatch(/<path d="M2\.5 15 21\.5 8\.5v5L2\.5 20Z"/)
    expect(band).toContain('fill-opacity="0.35"')
    expect(5).toBeGreaterThan(width('marker'))
  })
})
