import { describe, expect, it } from 'vitest'
import { createDoc, DEFAULT_MULTI_WIDTHS, DOC_SCHEMA } from './defaults'
import { migrateDoc } from './migrate'
import { resolveOutputSize } from '../lib/sizing'
import { areCurvesIdentity } from '../gl/passes'
import { buildCurveLut } from '../lib/curves'
import { activeAssetIds } from './selectors'
import type { Doc, TextLayer } from './types'

function validTextLayer(): TextLayer {
  return {
    id: 'l-ok',
    kind: 'text',
    name: 'Caption',
    visible: true,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
    text: 'hello',
    style: {
      fontId: 'inter',
      size: 40,
      color: '#ffffff',
      align: 'center',
      lineHeight: 1.2,
      tracking: 0,
      bold: false,
      italic: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadow: false,
      pillBackground: null,
      arc: 0,
    },
  }
}

/**
 * A genuine schema-1 document: flat, no `geometry`, a 0..1000 integer crop, a
 * 100-neutral `adjust` under two key names that no longer exist, a bare
 * asset-id `source`, an `"16:9"` aspect string and a flat `output.width`.
 * Nothing here is shaped like a v3 document, which is the whole point — the old
 * test fed `{...createDoc(), schema: 2}`, so the branch was verified only
 * against itself.
 */
const LEGACY_V1 = {
  schema: 1,
  source: 'asset_original',
  rotation: 450,
  flipH: true,
  flipV: false,
  crop: { x: 100, y: 200, width: 500, height: 600 },
  aspect: '16:9',
  adjust: {
    brightness: 150,
    contrast: 50,
    saturation: 100,
    temperature: 25,
    clarity: 40,
    exposure: 0.5,
  },
  output: { format: 'png', quality: 0.8, width: 640 },
  background: '#102030',
}

/** A genuine schema-2 document: nested geometry, 0-neutral adjust, flat size. */
const LEGACY_V2 = {
  schema: 2,
  source: { assetId: 'asset_two', width: 800, height: 600, name: 'two.jpg', mime: 'image/jpeg' },
  geometry: {
    rotation: 90,
    flipH: false,
    flipV: true,
    crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    aspectLock: 1.5,
  },
  adjust: { exposure: -0.5, warmth: 20, saturation: -30 },
  output: { width: 1200 },
  curve: [
    { x: 0, y: 0 },
    { x: 128, y: 140 },
    { x: 255, y: 255 },
  ],
}

describe('migrateDoc', () => {
  it('returns null for non-documents', () => {
    expect(migrateDoc(null)).toBeNull()
    expect(migrateDoc(42)).toBeNull()
    expect(migrateDoc('nope')).toBeNull()
    expect(migrateDoc([])).toBeNull()
    expect(migrateDoc({ hello: 'world' })).toBeNull()
  })

  it('is total: it never throws on adversarial input', () => {
    const junk = [
      { schema: 3 },
      { schema: 1 },
      { schema: 2 },
      { schema: 3, geometry: 'x', adjust: 7, curves: [], hsl: null },
      { schema: 3, layers: {}, output: 5, masks: 3, localAdjusts: 'no' },
      { schema: 3, output: { resize: { mode: 'nonsense' }, quality: 'x', dpi: null } },
      { schema: 3, curves: { rgb: [null, { x: 1 }], r: 4 } },
      { schema: 3, background: { gradient: 'no' } },
      { schema: 3, retouch: { healSpots: [{ at: null }], redEye: [1] } },
      { schema: 3, identity: { createdAt: 'yesterday', writer: '   ' } },
    ]
    for (const input of junk) {
      expect(() => migrateDoc(input)).not.toThrow()
      expect(migrateDoc(input)).not.toBeNull()
    }
  })

  it('is idempotent: migrating a migrated document changes nothing', () => {
    for (const input of [LEGACY_V1, LEGACY_V2, createDoc()]) {
      const once = migrateDoc(input)
      expect(once).not.toBeNull()
      expect(migrateDoc(once)).toEqual(once)
    }
  })

  it('round-trips a current-schema doc', () => {
    const doc = createDoc()
    doc.adjust.exposure = 0.5
    doc.geometry.crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }
    const migrated = migrateDoc(doc)
    expect(migrated).not.toBeNull()
    expect(migrated?.schema).toBe(DOC_SCHEMA)
    expect(migrated?.adjust.exposure).toBe(0.5)
    expect(migrated?.geometry.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 })
  })
})

describe('D1-F04: mergeAdjust clamps to ADJUST_SPECS', () => {
  it('clamps an out-of-range value that used to survive to the shader uniform', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      adjust: { ...createDoc().adjust, exposure: 999 },
    })
    expect(migrated?.adjust.exposure).toBe(2)
    expect(migrateDoc({ ...createDoc(), adjust: { exposure: -999 } })?.adjust.exposure).toBe(-2)
  })

  it('clamps every key against its own spec, in both directions', () => {
    const specs: Record<string, { min: number; max: number }> = {
      exposure: { min: -2, max: 2 },
      brilliance: { min: -100, max: 100 },
      saturation: { min: -100, max: 100 },
      sharpness: { min: 0, max: 100 },
      noiseReduction: { min: 0, max: 100 },
      definition: { min: 0, max: 100 },
    }
    for (const [key, bounds] of Object.entries(specs)) {
      const high = migrateDoc({ ...createDoc(), adjust: { [key]: 1e9 } })
      const low = migrateDoc({ ...createDoc(), adjust: { [key]: -1e9 } })
      expect(high?.adjust[key as keyof Doc['adjust']], key).toBe(bounds.max)
      expect(low?.adjust[key as keyof Doc['adjust']], key).toBe(bounds.min)
    }
  })

  it('rejects a non-number, a string, NaN and Infinity', () => {
    for (const value of ['1', NaN, Infinity, -Infinity, null, {}]) {
      const migrated = migrateDoc({ ...createDoc(), adjust: { exposure: value } })
      expect(migrated?.adjust.exposure, String(value)).toBe(0)
    }
  })

  it('leaves an in-range value alone', () => {
    expect(migrateDoc({ ...createDoc(), adjust: { exposure: 1.25 } })?.adjust.exposure).toBe(1.25)
    expect(migrateDoc({ ...createDoc(), adjust: { sharpness: 37 } })?.adjust.sharpness).toBe(37)
  })
})

describe('D1-F04: geometry', () => {
  it('normalizes out-of-range current-schema values instead of throwing', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      adjust: { ...createDoc().adjust, exposure: 999 },
      geometry: {
        ...createDoc().geometry,
        straighten: 200,
        crop: { x: -1, y: 2, width: 5, height: 0 },
      },
    })
    expect(migrated?.geometry.straighten).toBe(45)
    expect(migrated?.geometry.crop.width).toBe(1)
    expect(migrated?.geometry.crop.x).toBe(0)
    // The assertion the old test was named for but never made.
    expect(migrated?.adjust.exposure).toBe(2)
  })

  it('rejects an aspectLock that is not a finite positive number', () => {
    for (const value of [Infinity, -Infinity, NaN, 0, -1, '16:9', null]) {
      const migrated = migrateDoc({
        ...createDoc(),
        geometry: { ...createDoc().geometry, aspectLock: value },
      })
      expect(migrated?.geometry.aspectLock, String(value)).toBeNull()
    }
    expect(migrateDoc({ ...createDoc(), geometry: { aspectLock: 1.5 } })?.geometry.aspectLock).toBe(
      1.5,
    )
  })

  it('clamps orientation and keeps a flipped crop inside the frame', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      geometry: {
        ...createDoc().geometry,
        orientation: { quarterTurns: -3, flipH: 'yes', flipV: true },
        crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
      },
    })
    expect(migrated?.geometry.orientation.quarterTurns).toBe(1)
    expect(migrated?.geometry.orientation.flipH).toBe(false)
    expect(migrated?.geometry.orientation.flipV).toBe(true)
    expect(migrated?.geometry.crop.x).toBeCloseTo(0.5, 12)
  })
})

describe('D1-F04: a curve channel must be able to produce a non-identity LUT', () => {
  it('drops a channel left with fewer than two usable points', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      curves: { ...createDoc().curves, rgb: [{ x: 1, y: 1 }, 'junk'] },
    })
    expect(migrated?.curves.rgb).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
    // The mismatch this fixes: the LUT builder returned identity while the pass
    // planner still reported the channel as edited.
    expect(areCurvesIdentity(migrated!.curves)).toBe(true)
  })

  it('keeps a real curve and normalizes it to a sorted, clamped, deduped set', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      curves: {
        ...createDoc().curves,
        r: [
          { x: 400, y: 900 },
          { x: 0, y: 0 },
          { x: 255, y: 255 },
          { x: 128, y: -50 },
        ],
      },
    })
    expect(migrated?.curves.r).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 0 },
      { x: 255, y: 255 },
    ])
    expect(areCurvesIdentity(migrated!.curves)).toBe(false)
    expect(buildCurveLut(migrated!.curves.r)).toHaveLength(256)
  })

  it('a channel of only duplicated x values collapses to the identity curve', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      curves: {
        ...createDoc().curves,
        g: [
          { x: 10, y: 0 },
          { x: 10, y: 200 },
        ],
      },
    })
    expect(migrated?.curves.g).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ])
  })
})

describe('D1-F04: resize is validated per mode instead of cast wholesale', () => {
  const withResize = (resize: unknown) =>
    migrateDoc({ ...createDoc(), output: { ...createDoc().output, resize } })

  it('downgrades a mode with no usable magnitude to the crop size', () => {
    for (const resize of [
      { mode: 'width' },
      { mode: 'width', width: 'x' },
      { mode: 'width', width: 0 },
      { mode: 'width', width: -40 },
      { mode: 'height' },
      { mode: 'longEdge', longEdge: NaN },
      { mode: 'percent', percent: 'x' },
      { mode: 'physical' },
      { mode: 'physical', widthMm: 10 },
      { mode: 'nonsense', width: 100 },
      { mode: 'width', width: Infinity },
    ]) {
      expect(withResize(resize)?.output.resize, JSON.stringify(resize)).toEqual({ mode: 'none' })
    }
  })

  it('clamps an out-of-range magnitude in place and keeps the mode', () => {
    expect(withResize({ mode: 'percent', percent: 0 })?.output.resize).toEqual({
      mode: 'percent',
      percent: 0.01,
    })
    expect(withResize({ mode: 'percent', percent: 1e6 })?.output.resize).toEqual({
      mode: 'percent',
      percent: 1000,
    })
    expect(
      withResize({ mode: 'physical', widthMm: -5, heightMm: 120, dpi: 0 })?.output.resize,
    ).toEqual({
      mode: 'physical',
      widthMm: 0.1,
      heightMm: 120,
      dpi: 300,
    })
    expect(withResize({ mode: 'width', width: 800.6 })?.output.resize).toEqual({
      mode: 'width',
      width: 801,
    })
  })

  it('never yields an output smaller than one pixel in either dimension', () => {
    for (const resize of [
      { mode: 'width' },
      { mode: 'width', width: 0 },
      { mode: 'height', height: -1 },
      { mode: 'longEdge', longEdge: 0 },
      { mode: 'percent', percent: 0 },
      { mode: 'physical', widthMm: -5, heightMm: -5, dpi: 300 },
      { mode: 'nonsense' },
    ]) {
      const migrated = withResize(resize)
      const size = resolveOutputSize(migrated!)
      expect(Number.isFinite(size.width), JSON.stringify(resize)).toBe(true)
      expect(Number.isFinite(size.height), JSON.stringify(resize)).toBe(true)
      expect(size.width, JSON.stringify(resize)).toBeGreaterThanOrEqual(1)
      expect(size.height, JSON.stringify(resize)).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps a valid spec untouched', () => {
    expect(withResize({ mode: 'longEdge', longEdge: 2048 })?.output.resize).toEqual({
      mode: 'longEdge',
      longEdge: 2048,
    })
  })
})

describe('D1-F04: colours are validated before they reach a shader uniform', () => {
  it('replaces a matte the renderer cannot read', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      output: { ...createDoc().output, matte: 'notacolor' },
    })
    expect(migrated?.output.matte).toBe('#ffffff')
    // And the replacement is itself a colour, so the round-trip is stable.
    expect(migrateDoc(migrated)?.output.matte).toBe('#ffffff')
  })

  it('replaces junk background and gradient colours, keeping the good ones', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      background: {
        mode: 'gradient',
        color: 'rebeccapurple',
        gradient: { from: '#ABC', to: 'nope', angle: 90 },
      },
    })
    expect(migrated?.background.color).toBe('#ffffff')
    // `#abc` is the same colour as `#aabbcc`, and only one spelling of it can
    // be compared against by a string equality check.
    expect(migrated?.background.gradient.from).toBe('#aabbcc')
    expect(migrated?.background.gradient.to).toBe('#dfe6ea')
    expect(migrated?.background.gradient.angle).toBe(90)
  })

  it('replaces junk layer colours rather than rendering orange', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [{ ...validTextLayer(), style: { ...validTextLayer().style, color: 'red' } }],
    })
    const layer = migrated?.layers[0] as TextLayer
    expect(layer.kind).toBe('text')
    expect(layer.style.color).toBe('#ffffff')
  })
})

describe('D1-F04: other sections', () => {
  it('validates the output enum fields', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      output: {
        ...createDoc().output,
        format: 'tiff',
        metadata: 'everything',
        sheet: 'a3',
        quality: 9,
        dpi: -300,
        targetBytes: -1,
      },
    })
    expect(migrated?.output.format).toBe('jpeg')
    expect(migrated?.output.metadata).toBe('strip')
    expect(migrated?.output.sheet).toBe('none')
    expect(migrated?.output.quality).toBe(1)
    expect(migrated?.output.dpi).toBe(1)
    expect(migrated?.output.targetBytes).toBeNull()
  })

  it('clamps effects, hsl and look to the ranges the UI can produce', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      effects: { grain: 1e9, bloom: -5, fieldBlur: 400 },
      hsl: { red: { hue: 900, sat: -900, lum: 40 }, blue: { hue: 1, sat: 1, lum: 1 } },
      look: { id: 'kodak', amount: 7 },
    })
    expect(migrated?.effects).toEqual({ grain: 100, bloom: 0, fieldBlur: 100 })
    expect(migrated?.hsl.red).toEqual({ hue: 30, sat: -100, lum: 40 })
    expect(migrated?.hsl.blue).toEqual({ hue: 1, sat: 1, lum: 1 })
    expect(migrated?.look).toEqual({ id: 'kodak', amount: 1 })
  })

  it('validates the background enum, fit and blur', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      background: { mode: 'rainbow', fit: 'squish', blur: 42, imageAssetId: 7 },
    })
    expect(migrated?.background.mode).toBe('none')
    expect(migrated?.background.fit).toBe('cover')
    expect(migrated?.background.blur).toBe(1)
    expect(migrated?.background.imageAssetId).toBeNull()
  })

  it('drops retouch entries with no usable position instead of casting them', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      retouch: {
        smooth: 250,
        healSpots: [{ id: 'a', at: { x: 0.5, y: 0.5 }, radius: 3 }, { at: null }, 'x', 4],
        redEye: [{ at: { x: 1, y: 2 }, radius: -1 }, { at: { x: 'a', y: 2 } }],
      },
    })
    expect(migrated?.retouch.smooth).toBe(100)
    expect(migrated?.retouch.healSpots).toEqual([{ id: 'a', at: { x: 0.5, y: 0.5 }, radius: 3 }])
    expect(migrated?.retouch.redEye).toEqual([{ at: { x: 1, y: 2 }, radius: 0 }])
  })

  it('drops a malformed source but keeps the rest', () => {
    const migrated = migrateDoc({ ...createDoc(), source: { nope: true } })
    expect(migrated?.source).toBeNull()
  })

  it('filters non-object masks and localAdjusts', () => {
    const migrated = migrateDoc({ ...createDoc(), masks: ['x', 1], localAdjusts: [null, 2] })
    expect(migrated?.masks).toHaveLength(0)
    expect(migrated?.localAdjusts).toHaveLength(0)
  })
})

describe('D1-F04: a layer is kept only if the compositor could draw it', () => {
  it('drops a layer with an id and a kind but no transform or style', () => {
    const migrated = migrateDoc({ ...createDoc(), layers: [null, 1, { id: 'l1', kind: 'text' }] })
    expect(migrated?.layers).toHaveLength(0)
  })

  it('keeps the same layer once it carries the fields the renderer dereferences', () => {
    const migrated = migrateDoc({ ...createDoc(), layers: [validTextLayer()] })
    expect(migrated?.layers).toHaveLength(1)
    expect(migrated?.layers[0]).toEqual({ ...validTextLayer(), locked: false })
  })

  it('drops a layer whose transform is not an object', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [{ ...validTextLayer(), transform: 'center' }],
    })
    expect(migrated?.layers).toHaveLength(0)
  })

  it('drops an unknown kind, an empty id and a non-object', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [
        { ...validTextLayer(), id: 'k', kind: 'hologram' },
        { ...validTextLayer(), id: '' },
        'nope',
      ],
    })
    expect(migrated?.layers).toHaveLength(0)
  })

  it('defaults the scalars a kind can live without', () => {
    const { name, visible, ...withoutHeader } = validTextLayer()
    void name
    void visible
    const migrated = migrateDoc({ ...createDoc(), layers: [withoutHeader] })
    const layer = migrated?.layers[0] as TextLayer
    expect(layer.name).toBe('')
    expect(layer.visible).toBe(true)
    expect(layer.kind).toBe('text')
  })

  it('clamps a transform with out-of-range opacity and an unknown blend', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [
        {
          ...validTextLayer(),
          transform: { x: 0.25, y: 0.75, scale: -2, rotation: 10, opacity: 5, blend: 'burn' },
        },
      ],
    })
    expect(migrated?.layers[0].transform).toEqual({
      x: 0.25,
      y: 0.75,
      scale: 0,
      rotation: 10,
      opacity: 1,
      blend: 'normal',
    })
  })

  it('drops a shape or redact layer whose discriminator is not recognized', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [
        {
          id: 's',
          kind: 'shape',
          name: '',
          visible: true,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
          shape: 'trapezoid',
        },
        {
          id: 'r',
          kind: 'redact',
          name: '',
          visible: true,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
          mode: 'blur',
          region: { x: 0, y: 0, width: 2, height: -1 },
        },
      ],
    })
    expect(migrated?.layers).toHaveLength(1)
    expect(migrated?.layers[0].id).toBe('r')
    expect((migrated?.layers[0] as { region: unknown }).region).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 0.001,
    })
  })
})

describe('the two fields other agents are blocked on', () => {
  it('Layer.locked defaults to false for a document that predates it', () => {
    const { locked: _locked, ...withoutLock } = validTextLayer()
    void _locked
    const migrated = migrateDoc({ ...createDoc(), layers: [withoutLock] })
    expect((migrated?.layers[0] as TextLayer).locked).toBe(false)
  })

  it('Layer.locked is preserved as written', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [{ ...validTextLayer(), locked: true }],
    })
    expect(migrated?.layers[0].locked).toBe(true)
  })

  it('Layer.locked is coerced from a non-boolean', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      layers: [{ ...validTextLayer(), locked: 'yes' }],
    })
    expect(migrated?.layers[0].locked).toBe(false)
  })

  it('OutputSpec.multiWidths defaults for a document that predates it', () => {
    const { multiWidths: _widths, ...output } = createDoc().output
    void _widths
    const migrated = migrateDoc({ ...createDoc(), output })
    expect(migrated?.output.multiWidths).toEqual([720, 1080, 1920])
  })

  it('keeps finite widths >= 1, de-duplicated and ascending', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      output: { ...createDoc().output, multiWidths: [1920, 720, 1920, 1080] },
    })
    expect(migrated?.output.multiWidths).toEqual([720, 1080, 1920])
  })

  it('drops non-finite, sub-1 and non-numeric widths', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      output: {
        ...createDoc().output,
        multiWidths: [640, 0, -10, NaN, Infinity, '800', null, 640.6],
      },
    })
    expect(migrated?.output.multiWidths).toEqual([640, 641])
  })

  it('falls back to the defaults when nothing survives', () => {
    for (const widths of [[], 'nope', {}, [0, -1, NaN], null]) {
      const migrated = migrateDoc({
        ...createDoc(),
        output: { ...createDoc().output, multiWidths: widths },
      })
      expect(migrated?.output.multiWidths, JSON.stringify(widths)).toEqual(DEFAULT_MULTI_WIDTHS)
    }
  })

  it('caps an absurd list so the ZIP cannot be asked for 10,000 entries', () => {
    const many = Array.from({ length: 40 }, (_, index) => index + 1)
    const migrated = migrateDoc({ ...createDoc(), output: { multiWidths: many } })
    expect(migrated?.output.multiWidths).toHaveLength(8)
    expect(migrated?.output.multiWidths).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('D1-F15: document identity', () => {
  it('stamps a schema-2 row that carries no identity at all', () => {
    const migrated = migrateDoc(LEGACY_V2)
    expect(migrated?.identity).toEqual({
      createdAt: null,
      updatedAt: null,
      writer: '1.0.0',
    })
  })

  it('keeps the timestamps of a document that already has them', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      identity: { createdAt: 1_700_000_000_000, updatedAt: 1_700_000_500_000, writer: '1.0.0' },
    })
    expect(migrated?.identity.createdAt).toBe(1_700_000_000_000)
    expect(migrated?.identity.updatedAt).toBe(1_700_000_500_000)
  })

  it('distinguishes a document written by an older app version', () => {
    const older = migrateDoc({
      ...createDoc(),
      identity: { createdAt: 1, updatedAt: 2, writer: '0.9.0' },
    })
    const current = migrateDoc(createDoc())
    expect(older?.identity.writer).toBe('0.9.0')
    expect(current?.identity.writer).toBe('1.0.0')
    expect(older?.identity.writer).not.toBe(current?.identity.writer)
  })

  it('rejects a non-finite or negative timestamp rather than inventing one', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      identity: { createdAt: Infinity, updatedAt: -5, writer: '1.0.0' },
    })
    expect(migrated?.identity.createdAt).toBeNull()
    expect(migrated?.identity.updatedAt).toBeNull()
  })

  it('does not invent timestamps during migration — that is the writer’s job', () => {
    const before = Date.now()
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.identity.createdAt).toBeNull()
    expect(migrated?.identity.updatedAt).toBeNull()
    expect(Date.now()).toBeGreaterThanOrEqual(before)
  })
})

describe('D1-F05: schema 1 remaps its own field names', () => {
  it('maps a real v1 payload onto the current schema', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated).not.toBeNull()
    expect(migrated?.schema).toBe(DOC_SCHEMA)
  })

  it('carries the asset-id string source into a SourceRef', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.source?.assetId).toBe('asset_original')
    expect(migrated?.source?.name).toBe('image')
  })

  it('turns 450 degrees of rotation into one quarter turn plus 0 degrees of straighten', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.geometry.orientation.quarterTurns).toBe(1)
    expect(migrated?.geometry.straighten).toBe(0)
    expect(migrated?.geometry.orientation.flipH).toBe(true)
    expect(migrated?.geometry.orientation.flipV).toBe(false)
  })

  it('rescales a 0..1000 integer crop to a normalized rect', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.geometry.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 })
  })

  it('parses the "16:9" aspect string into a ratio', () => {
    expect(migrateDoc(LEGACY_V1)?.geometry.aspectLock).toBeCloseTo(16 / 9, 12)
  })

  it('renames temperature and clarity, and rebases the 100-neutral adjustments', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.adjust.warmth).toBe(25)
    expect(migrated?.adjust.definition).toBe(40)
    expect(migrated?.adjust.brightness).toBe(50)
    expect(migrated?.adjust.contrast).toBe(-50)
    expect(migrated?.adjust.saturation).toBe(0)
    expect(migrated?.adjust.exposure).toBe(0.5)
  })

  it('promotes a flat output.width into a resize spec', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.output.format).toBe('png')
    expect(migrated?.output.quality).toBe(0.8)
    expect(migrated?.output.resize).toEqual({ mode: 'width', width: 640 })
  })

  it('promotes a bare hex background into a colour background', () => {
    const migrated = migrateDoc(LEGACY_V1)
    expect(migrated?.background.mode).toBe('color')
    expect(migrated?.background.color).toBe('#102030')
  })
})

describe('D1-F05: schema 2 remaps what it still stored the old way', () => {
  it('maps a real v2 payload onto the current schema', () => {
    const migrated = migrateDoc(LEGACY_V2)
    expect(migrated?.schema).toBe(DOC_SCHEMA)
    expect(migrated?.source?.assetId).toBe('asset_two')
    expect(migrated?.source?.name).toBe('two.jpg')
  })

  it('promotes a single composite curve into the rgb channel only', () => {
    const migrated = migrateDoc(LEGACY_V2)
    expect(migrated?.curves.rgb).toHaveLength(3)
    expect(migrated?.curves.r).toHaveLength(2)
    expect(areCurvesIdentity(migrated!.curves)).toBe(false)
  })

  it('keeps a normalized crop and aspect lock as they were', () => {
    const migrated = migrateDoc(LEGACY_V2)
    expect(migrated?.geometry.crop).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })
    expect(migrated?.geometry.aspectLock).toBe(1.5)
  })

  it('lifts rotation and flips out of the loose geometry fields', () => {
    const migrated = migrateDoc(LEGACY_V2)
    expect(migrated?.geometry.orientation.quarterTurns).toBe(1)
    expect(migrated?.geometry.orientation.flipV).toBe(true)
    expect(migrated?.geometry.straighten).toBe(0)
  })

  it('keeps an already-0-neutral adjust and promotes a flat output.width', () => {
    const migrated = migrateDoc(LEGACY_V2)
    expect(migrated?.adjust).toMatchObject({
      exposure: -0.5,
      warmth: 20,
      saturation: -30,
      brightness: 0,
    })
    expect(migrated?.output.resize).toEqual({ mode: 'width', width: 1200 })
  })
})

describe('D1-F05: a v3-shaped payload labelled 2 still migrates', () => {
  it('does not lose fields the v2 remap has no opinion about', () => {
    const current = createDoc()
    const migrated = migrateDoc({
      ...current,
      schema: 2,
      adjust: { ...current.adjust, warmth: 20 },
    })
    expect(migrated?.schema).toBe(DOC_SCHEMA)
    expect(migrated?.adjust.warmth).toBe(20)
    expect(migrated?.geometry.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(migrated?.output.resize).toEqual({ mode: 'none' })
  })
})

describe('D1-F12: the dead fields are kept, but no longer lenient', () => {
  // None of these six families has a reader yet. None of them was removed
  // either: every candidate consumer file (`PassportPanel.tsx`, `gl/renderer.ts`,
  // `store/actions.ts`, `render/layers.ts`) is owned by an agent that is
  // mid-flight, and deleting a field someone is actively building a consumer
  // for is the one outcome that cannot be undone. What *is* fixable inside the
  // model is the leniency: each of them now has a tested, normalized contract
  // for whoever wires the consumer.

  it('output.sheet survives migration, allow-listed', () => {
    expect(
      migrateDoc({ ...createDoc(), output: { ...createDoc().output, sheet: '5x7' } })?.output.sheet,
    ).toBe('5x7')
    expect(
      migrateDoc({ ...createDoc(), output: { ...createDoc().output, sheet: 'a3' } })?.output.sheet,
    ).toBe('none')
    expect(
      migrateDoc({ ...createDoc(), output: { ...createDoc().output, sheet: 7 } })?.output.sheet,
    ).toBe('none')
  })

  it('passport.backgroundApplied survives migration as a real boolean', () => {
    const applied = migrateDoc({
      ...createDoc(),
      passport: { specId: 'uk', backgroundApplied: true },
    })
    expect(applied?.passport).toEqual({ specId: 'uk', backgroundApplied: true })

    const coerced = migrateDoc({
      ...createDoc(),
      passport: { specId: 'uk', backgroundApplied: 'yes' },
    })
    expect(coerced?.passport).toEqual({ specId: 'uk', backgroundApplied: false })

    // A passport row with no specId is not a passport.
    expect(
      migrateDoc({ ...createDoc(), passport: { backgroundApplied: true } })?.passport,
    ).toBeNull()
  })

  it('background.imageAssetId, fit and blur are validated even though nothing draws them', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      background: { mode: 'image', imageAssetId: 'bg_1', fit: 'contain', blur: 0.4 },
    })
    expect(migrated?.background.mode).toBe('image')
    expect(migrated?.background.imageAssetId).toBe('bg_1')
    expect(migrated?.background.fit).toBe('contain')
    expect(migrated?.background.blur).toBe(0.4)

    const junk = migrateDoc({
      ...createDoc(),
      background: { mode: 'image', imageAssetId: { id: 'bg_1' }, fit: 'stretch', blur: 'soft' },
    })
    expect(junk?.background.imageAssetId).toBeNull()
    expect(junk?.background.fit).toBe('cover')
    expect(junk?.background.blur).toBe(0)
  })

  it('a background image asset stays pinned by activeAssetIds once it is referenced', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      background: { mode: 'image', imageAssetId: 'bg_1' },
    })
    expect([...activeAssetIds(migrated as Doc)]).toEqual(['bg_1'])
  })

  it('geometry.perspective survives migration as finite normalized offsets', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      geometry: {
        ...createDoc().geometry,
        perspective: {
          topLeft: { x: -0.05, y: 0.02 },
          topRight: { x: 'x', y: 0 },
          bottomLeft: {},
          bottomRight: { x: Infinity, y: 0 },
        },
      },
    })
    expect(migrated?.geometry.perspective.topLeft).toEqual({ x: -0.05, y: 0.02 })
    // A corner that is not a usable point falls back to the identity corner
    // rather than being half-written, which is what `squareToQuad` divides by.
    expect(migrated?.geometry.perspective.topRight).toEqual({ x: 0, y: 0 })
    expect(migrated?.geometry.perspective.bottomLeft).toEqual({ x: 0, y: 0 })
    expect(migrated?.geometry.perspective.bottomRight).toEqual({ x: 0, y: 0 })
  })

  it('retouch survives migration with a clamped amount and validated spot lists', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      retouch: {
        smooth: 40,
        healSpots: [{ id: 'h1', at: { x: 0.2, y: 0.3 }, radius: 0.02 }],
        redEye: [{ at: { x: 0.4, y: 0.5 }, radius: 0.01 }],
      },
    })
    expect(migrated?.retouch).toEqual({
      smooth: 40,
      healSpots: [{ id: 'h1', at: { x: 0.2, y: 0.3 }, radius: 0.02 }],
      redEye: [{ at: { x: 0.4, y: 0.5 }, radius: 0.01 }],
    })
  })
})

describe('the legacy flat EditorState (no schema field)', () => {
  it('migrates the 100-neutral adjustments', () => {
    const migrated = migrateDoc({
      flipH: true,
      flipV: false,
      rotation: 90,
      brightness: 150,
      contrast: 50,
      saturation: 100,
      format: 'png',
      quality: 0.8,
      outWidth: 640,
      matte: '#000000',
      crop: { x: 0, y: 0, width: 10, height: 10 },
    })
    expect(migrated).not.toBeNull()
    expect(migrated?.adjust.brightness).toBe(50)
    expect(migrated?.adjust.contrast).toBe(-50)
    expect(migrated?.adjust.saturation).toBe(0)
    expect(migrated?.geometry.orientation.quarterTurns).toBe(1)
    expect(migrated?.geometry.orientation.flipH).toBe(true)
    expect(migrated?.output.format).toBe('png')
    expect(migrated?.output.resize).toEqual({ mode: 'width', width: 640 })
  })

  it('preserves the legacy crop, which used to be dropped', () => {
    const full = migrateDoc({ brightness: 100, crop: { x: 0, y: 0, width: 10, height: 10 } })
    expect(full?.geometry.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })

    const partial = migrateDoc({ brightness: 100, crop: { x: 2, y: 1, width: 5, height: 5 } })
    expect(partial?.geometry.crop).toEqual({ x: 0.2, y: 0.1, width: 0.5, height: 0.5 })
  })

  it('canonicalizes a colour it accepts and rejects one it cannot read', () => {
    expect(migrateDoc({ brightness: 100, matte: '#000000' })?.output.matte).toBe('#000000')
    expect(migrateDoc({ brightness: 100, matte: '000000' })?.output.matte).toBe('#000000')
    expect(migrateDoc({ brightness: 100, matte: 'black' })?.output.matte).toBe('#ffffff')
  })
})

describe('D1-F04 a legacy session row keeps its source', () => {
  it('remaps the bare asset-id source a flat EditorState wrote', () => {
    const migrated = migrateDoc({ brightness: 100, rotation: 90, source: 'asset_legacy' })

    expect(migrated?.source?.assetId).toBe('asset_legacy')
  })

  it('still refuses a source that is not an id at all', () => {
    expect(migrateDoc({ brightness: 100, source: 7 })?.source).toBeNull()
    expect(migrateDoc({ brightness: 100, source: { name: 'x' } })?.source).toBeNull()
    expect(migrateDoc({ brightness: 100 })?.source).toBeNull()
  })
})
