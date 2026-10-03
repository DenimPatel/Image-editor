import { describe, expect, it } from 'vitest'
import { createDoc } from './defaults'
import { migrateDoc } from './migrate'
import {
  activeAssetIds,
  croppedSize,
  effectiveOutputSize,
  hasAlphaOutput,
  hasEdits,
  isNeutralAdjust,
  isNeutralHsl,
  needsFlatten,
} from './selectors'
import type { Doc } from './types'

describe('activeAssetIds', () => {
  it('collects source, background image and layer assets', () => {
    const doc = createDoc({
      source: { assetId: 'src', width: 100, height: 100, name: 'a', mime: 'image/jpeg' },
    })
    doc.background.imageAssetId = 'bg'
    doc.layers.push({
      id: 'l1',
      kind: 'sticker',
      name: 's',
      visible: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      svg: null,
      assetId: 'sticker',
    })
    doc.layers.push({
      id: 'l2',
      kind: 'watermark',
      name: 'w',
      visible: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      text: 'x',
      fontId: 'inter',
      color: '#fff',
      assetId: 'logo',
      anchor: 'center',
      tiled: false,
    })
    expect([...activeAssetIds(doc)].sort()).toEqual(['bg', 'logo', 'src', 'sticker'])
  })

  it('is empty for a doc with no source', () => {
    expect(activeAssetIds(createDoc()).size).toBe(0)
  })
})

describe('size selectors', () => {
  it('reports cropped and effective output sizes', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 1600, height: 900, name: 'a', mime: 'image/jpeg' },
    })
    expect(croppedSize(doc)).toEqual({ width: 1600, height: 900 })
    expect(effectiveOutputSize(doc)).toEqual({ width: 1600, height: 900 })
  })
})

describe('hasAlphaOutput', () => {
  it('is true for png with no background', () => {
    const doc = createDoc()
    doc.output.format = 'png'
    expect(hasAlphaOutput(doc)).toBe(true)
  })

  it('is false for jpeg or when a background is set', () => {
    const doc = createDoc()
    doc.output.format = 'jpeg'
    expect(hasAlphaOutput(doc)).toBe(false)
    doc.output.format = 'png'
    doc.background.mode = 'color'
    expect(hasAlphaOutput(doc)).toBe(false)
  })
})

describe('hasEdits', () => {
  it('is false for a pristine doc', () => {
    expect(hasEdits(createDoc())).toBe(false)
  })

  it('is false for a pristine doc that only has a source', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 100, height: 100, name: 'a', mime: 'image/jpeg' },
    })
    expect(hasEdits(doc)).toBe(false)
  })

  it('is false for a pristine doc that has just been round-tripped through migrateDoc', () => {
    const migrated = migrateDoc(createDoc())
    expect(migrated).not.toBeNull()
    expect(hasEdits(migrated as Doc)).toBe(false)
  })

  it('detects adjustments, geometry, layers and looks', () => {
    const adjusted = createDoc()
    adjusted.adjust.contrast = 10
    expect(hasEdits(adjusted)).toBe(true)

    const cropped = createDoc()
    cropped.geometry.crop = { x: 0.1, y: 0, width: 0.5, height: 1 }
    expect(hasEdits(cropped)).toBe(true)

    const flipped = createDoc()
    flipped.geometry.orientation.flipH = true
    expect(hasEdits(flipped)).toBe(true)

    const looked = createDoc()
    looked.look.id = 'kodak'
    expect(hasEdits(looked)).toBe(true)
  })

  // D1-F07: these sections used to be invisible to hasEdits, so a document
  // whose *only* edit was a curve, an HSL band, a background, an aspect lock,
  // an export setting, a passport spec or a red-eye spot reported "no edits".
  it('D1-F07: detects a curve edit on any single channel', () => {
    for (const channel of ['rgb', 'r', 'g', 'b'] as const) {
      const doc = createDoc()
      doc.curves[channel] = [
        { x: 0, y: 0 },
        { x: 128, y: 150 },
        { x: 255, y: 255 },
      ]
      expect(hasEdits(doc), channel).toBe(true)
    }
  })

  it('D1-F07: detects an HSL edit on any single band', () => {
    for (const band of Object.keys(createDoc().hsl) as (keyof Doc['hsl'])[]) {
      for (const key of ['hue', 'sat', 'lum'] as const) {
        const doc = createDoc()
        doc.hsl[band] = { ...doc.hsl[band], [key]: 12 }
        expect(hasEdits(doc), `${band}.${key}`).toBe(true)
      }
    }
  })

  it('D1-F07: detects a background fill, a removed matte and a background image', () => {
    const filled = createDoc()
    filled.background.mode = 'color'
    expect(hasEdits(filled)).toBe(true)

    const gradient = createDoc()
    gradient.background.mode = 'gradient'
    expect(hasEdits(gradient)).toBe(true)

    const cutOut = createDoc()
    cutOut.background.removed = true
    expect(hasEdits(cutOut)).toBe(true)

    const withImage = createDoc()
    withImage.background.imageAssetId = 'bg'
    expect(hasEdits(withImage)).toBe(true)
  })

  it('D1-F07: detects an aspect lock', () => {
    const doc = createDoc()
    doc.geometry.aspectLock = 1.5
    expect(hasEdits(doc)).toBe(true)
  })

  it('D1-F07: detects every output setting', () => {
    const changes: ((doc: Doc) => void)[] = [
      (doc) => (doc.output.format = 'png'),
      (doc) => (doc.output.quality = 0.5),
      (doc) => (doc.output.dpi = 150),
      (doc) => (doc.output.matte = '#000000'),
      (doc) => (doc.output.metadata = 'all'),
      (doc) => (doc.output.targetBytes = 500_000),
      (doc) => (doc.output.sheet = '5x7'),
      (doc) => (doc.output.resize = { mode: 'width', width: 640 }),
      (doc) => (doc.output.multiWidths = [640]),
    ]
    for (const change of changes) {
      const doc = createDoc()
      change(doc)
      expect(hasEdits(doc), JSON.stringify(doc.output)).toBe(true)
    }
  })

  it('D1-F07: detects a passport spec', () => {
    const doc = createDoc()
    doc.passport = { specId: 'us-2x2', backgroundApplied: false }
    expect(hasEdits(doc)).toBe(true)
  })

  it('D1-F07: detects red-eye spots, which were counted nowhere at all', () => {
    const doc = createDoc()
    doc.retouch.redEye.push({ at: { x: 0.3, y: 0.3 }, radius: 0.02 })
    expect(hasEdits(doc)).toBe(true)
  })

  it('D1-F07: still detects smooth, heal spots, masks, local adjusts and effects', () => {
    const smooth = createDoc()
    smooth.retouch.smooth = 40
    expect(hasEdits(smooth)).toBe(true)

    const healed = createDoc()
    healed.retouch.healSpots.push({ id: 'h', at: { x: 0.5, y: 0.5 }, radius: 0.01 })
    expect(hasEdits(healed)).toBe(true)

    const masked = createDoc()
    masked.masks.push({ id: 'm', kind: 'subject', enabled: true, feather: 10 })
    expect(hasEdits(masked)).toBe(true)

    const locally = createDoc()
    locally.localAdjusts.push({ id: 'l', maskId: 'm', values: { exposure: 0.2 }, enabled: true })
    expect(hasEdits(locally)).toBe(true)

    for (const key of ['grain', 'bloom', 'fieldBlur'] as const) {
      const doc = createDoc()
      doc.effects[key] = 20
      expect(hasEdits(doc), key).toBe(true)
    }
  })

  it('D1-F07: detects a perspective warp', () => {
    const doc = createDoc()
    doc.geometry.perspective.topLeft = { x: 0.01, y: 0 }
    expect(hasEdits(doc)).toBe(true)
  })

  it('D1-F07: an identity curve with an extra point on the line is not an edit', () => {
    const doc = createDoc()
    doc.curves.rgb = [
      { x: 0, y: 0 },
      { x: 128, y: 128 },
      { x: 255, y: 255 },
    ]
    expect(hasEdits(doc)).toBe(false)
  })
})

describe('isNeutralAdjust / isNeutralHsl', () => {
  it('agrees with the defaults for a pristine doc', () => {
    const doc = createDoc()
    expect(isNeutralAdjust(doc.adjust)).toBe(true)
    expect(isNeutralHsl(doc.hsl)).toBe(true)
  })

  it('notices a single non-zero value', () => {
    const doc = createDoc()
    doc.adjust.vignette = -1
    expect(isNeutralAdjust(doc.adjust)).toBe(false)
    doc.adjust.vignette = 0
    doc.hsl.aqua.sat = 1
    expect(isNeutralHsl(doc.hsl)).toBe(false)
  })
})

describe('needsFlatten', () => {
  it('is true only for the formats that cannot carry alpha', () => {
    expect(needsFlatten(createDoc())).toBe(true)
    const doc = createDoc()
    doc.output.format = 'png'
    expect(needsFlatten(doc)).toBe(false)
  })
})
