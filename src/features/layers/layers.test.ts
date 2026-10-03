import { describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { BlendMode, NormRect } from '../../model/types'
import {
  BLEND_LABELS,
  LAYER_TRANSFORM_PARTS,
  blendModes,
  createDrawLayer,
  createFrameLayer,
  createRedactLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  createWatermarkLayer,
  defaultTransform,
  isDraggableLayer,
} from './factory'
import {
  MIN_NORM_SIZE,
  addLayer,
  bringForward,
  bringToFront,
  dropLayerOn,
  duplicateLayer,
  findLayer,
  moveLayerBy,
  moveLayerTo,
  patchNormRect,
  removeLayerDoc,
  renameLayer,
  selectNextLayer,
  sendBackward,
  sendToBack,
  setLayerBlend,
  setLayerTransform,
  updateLayer,
} from './layerOps'

describe('layer z-order operations', () => {
  function withLayers() {
    let doc = createDoc()
    const a = createTextLayer('A')
    const b = createTextLayer('B')
    const c = createTextLayer('C')
    doc = addLayer(doc, a)
    doc = addLayer(doc, b)
    doc = addLayer(doc, c)
    return { doc, a, b, c }
  }

  it('adds layers in order', () => {
    const { doc } = withLayers()
    expect(doc.layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C'])
  })

  it('brings a layer forward and sends it backward', () => {
    const { doc, a } = withLayers()
    expect(bringForward(doc, a.id).layers.map((layer) => layer.name)).toEqual(['B', 'A', 'C'])
    expect(sendBackward(bringForward(doc, a.id), a.id).layers.map((layer) => layer.name)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  it('brings to front and sends to back', () => {
    const { doc, a, c } = withLayers()
    expect(bringToFront(doc, a.id).layers.map((layer) => layer.name)).toEqual(['B', 'C', 'A'])
    expect(sendToBack(doc, c.id).layers.map((layer) => layer.name)).toEqual(['C', 'A', 'B'])
  })

  it('clamps moves at the ends', () => {
    const { doc, a } = withLayers()
    expect(sendToBack(doc, a.id).layers[0].name).toBe('A')
    expect(sendBackward(doc, a.id).layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C'])
  })

  it('moves to an explicit index', () => {
    const { doc, a } = withLayers()
    expect(moveLayerTo(doc, a.id, 2).layers.map((layer) => layer.name)).toEqual(['B', 'C', 'A'])
  })

  it('moves by a relative delta', () => {
    const { doc, a } = withLayers()
    expect(moveLayerBy(doc, a.id, 2).layers.map((layer) => layer.name)).toEqual(['B', 'C', 'A'])
    expect(moveLayerBy(doc, a.id, -5).layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C'])
  })

  it('removes a layer immutably', () => {
    const { doc, b } = withLayers()
    const next = removeLayerDoc(doc, b.id)
    expect(next.layers.map((layer) => layer.name)).toEqual(['A', 'C'])
    expect(doc.layers).toHaveLength(3)
  })

  it('is a no-op for an unknown id', () => {
    const { doc } = withLayers()
    expect(bringToFront(doc, 'nope')).toBe(doc)
    expect(moveLayerTo(doc, 'nope', 0)).toBe(doc)
    expect(dropLayerOn(doc, 'nope', 'other')).toBe(doc)
    expect(findLayer(doc, 'nope')).toBeUndefined()
  })
})

describe('selectNextLayer', () => {
  it('starts at the topmost layer and wraps around', () => {
    const doc = addLayer(addLayer(createDoc(), createTextLayer('A')), createTextLayer('B'))
    expect(selectNextLayer(doc, null)).toBe(doc.layers[1].id)
    expect(selectNextLayer(doc, doc.layers[0].id)).toBe(doc.layers[1].id)
    expect(selectNextLayer(doc, doc.layers[1].id)).toBe(doc.layers[0].id)
  })

  it('returns null for an empty document', () => {
    expect(selectNextLayer(createDoc(), null)).toBeNull()
  })
})

describe('duplicateLayer', () => {
  it('preserves every field with a new id one slot above the original', () => {
    const original = createShapeLayer('arrow')
    original.name = 'Arrow'
    original.transform = {
      ...original.transform,
      x: 0.2,
      y: 0.8,
      scale: 1.75,
      rotation: 15,
      opacity: 0.4,
      blend: 'screen',
    }
    original.width = 0.42
    const doc = addLayer(addLayer(createDoc(), createTextLayer('below')), original)
    const result = duplicateLayer(doc, original.id)
    expect(result.id).not.toBe(original.id)
    expect(result.doc.layers.map((layer) => layer.name)).toEqual(['below', 'Arrow', 'Arrow copy'])
    const copy = result.doc.layers[2]
    expect({ ...copy, id: '', name: '' }).toEqual({ ...original, id: '', name: '' })
    expect(copy.transform).toEqual(original.transform)
  })

  it('deep-clones nested objects so editing the copy cannot touch the original', () => {
    const original = createTextLayer('Deep')
    const doc = addLayer(createDoc(), original)
    const result = duplicateLayer(doc, original.id)
    const copy = result.doc.layers[1]
    if (copy.kind !== 'text') throw new Error('expected a text copy')
    copy.style.size = 40
    copy.transform.x = 0.9
    expect(original.style.size).toBe(8)
    expect(original.transform.x).toBe(0.5)
    expect(doc.layers[0]).toBe(original)
  })

  it('returns the same doc and a null id for a missing layer', () => {
    const doc = createDoc()
    expect(duplicateLayer(doc, 'nope')).toEqual({ doc, id: null })
  })
})

describe('layer field edits', () => {
  const source = addLayer(createDoc(), createTextLayer('Hello'))
  const id = source.layers[0].id

  it('renames a layer and falls back to the kind when the name is blank', () => {
    expect(renameLayer(source, id, '  Poster  ').layers[0].name).toBe('Poster')
    expect(renameLayer(source, id, '   ').layers[0].name).toBe('text')
    expect(renameLayer(source, id, 'Hello')).toBe(source)
  })

  it('caps a very long name', () => {
    const renamed = renameLayer(source, id, 'x'.repeat(200))
    expect(renamed.layers[0].name.length).toBe(48)
  })

  it('sets the blend mode and leaves the rest of the transform alone', () => {
    const next = setLayerBlend(source, id, 'multiply')
    expect(next.layers[0].transform.blend).toBe('multiply')
    expect(next.layers[0].transform).toEqual({ ...defaultTransform(), blend: 'multiply' })
    expect(setLayerBlend(next, id, 'multiply')).toBe(next)
  })

  it('patches the transform', () => {
    const next = setLayerTransform(source, id, { scale: 3 })
    expect(next.layers[0].transform).toEqual({ ...defaultTransform(), scale: 3 })
  })

  it('drops a dragged layer onto the target row (D6-F13)', () => {
    const doc = addLayer(
      addLayer(addLayer(createDoc(), createTextLayer('A')), createTextLayer('B')),
      createTextLayer('C'),
    )
    const [a, b, c] = doc.layers
    expect(dropLayerOn(doc, a.id, c.id).layers.map((layer) => layer.name)).toEqual(['B', 'C', 'A'])
    expect(dropLayerOn(doc, b.id, a.id).layers.map((layer) => layer.name)).toEqual(['B', 'A', 'C'])
    expect(dropLayerOn(doc, a.id, a.id)).toBe(doc)
    expect(findLayer(doc, a.id)).toBe(a)
  })
})

describe('normRect', () => {
  it('keeps a region on the canvas for every slider combination', () => {
    const steps = [0, 0.25, 0.5, 0.9, 1]
    for (const x of steps) {
      for (const y of steps) {
        for (const width of steps) {
          for (const height of steps) {
            const rect = { x, y, width, height }
            const clamped = patchNormRect({ x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, rect)
            expect(clamped.x).toBeGreaterThanOrEqual(0)
            expect(clamped.y).toBeGreaterThanOrEqual(0)
            expect(clamped.x + clamped.width).toBeLessThanOrEqual(1 + Number.EPSILON)
            expect(clamped.y + clamped.height).toBeLessThanOrEqual(1 + Number.EPSILON)
            expect(clamped.width).toBeGreaterThanOrEqual(MIN_NORM_SIZE)
            expect(clamped.height).toBeGreaterThanOrEqual(MIN_NORM_SIZE)
          }
        }
      }
    }
  })

  it('keeps an in-range region untouched', () => {
    const rect: NormRect = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 }
    expect(patchNormRect(rect, {})).toEqual(rect)
  })

  it('pulls an over-wide region back inside the canvas', () => {
    // The defect: x = 90% with width = 100% pushed the region off-canvas.
    const clamped = patchNormRect({ x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, { x: 0.9, width: 1 })
    expect(clamped.x + clamped.width).toBeCloseTo(1, 6)
    expect(clamped.x).toBeCloseTo(0, 6)
  })

  it('honours a custom minimum size', () => {
    expect(
      patchNormRect({ x: 0, y: 0, width: 0.5, height: 0.5 }, { width: 0 }, 0.1).width,
    ).toBeCloseTo(0.1, 6)
  })
})

describe('transform capabilities', () => {
  it('covers every layer kind', () => {
    const kinds = ['text', 'sticker', 'shape', 'draw', 'redact', 'watermark', 'frame'] as const
    expect(Object.keys(LAYER_TRANSFORM_PARTS).sort()).toEqual([...kinds].sort())
  })

  it('marks exactly the geometry-driven kinds as immovable', () => {
    const draggable = ['text', 'sticker', 'shape', 'watermark'] as const
    const fixed = ['draw', 'redact', 'frame'] as const
    expect(draggable.map((kind) => isDraggableLayer(kind))).toEqual([true, true, true, true])
    expect(fixed.map((kind) => isDraggableLayer(kind))).toEqual([false, false, false])
  })

  it('never advertises a blend or opacity the compositor cannot apply', () => {
    for (const [kind, parts] of Object.entries(LAYER_TRANSFORM_PARTS)) {
      if (kind === 'redact') continue
      expect(parts.blend).toBe(true)
      expect(parts.opacity).toBe(true)
    }
  })

  it('offers a redaction no way to become translucent', () => {
    // D6-F05: a redaction the user can fade out is a redaction that exports the
    // pixels it was hiding. Opacity and blend are therefore not capabilities a
    // redaction has, and `drawLayers` ignores them if a document carries them.
    const parts = LAYER_TRANSFORM_PARTS.redact
    expect(parts.opacity).toBe(false)
    expect(parts.blend).toBe(false)
  })
})

describe('blend modes', () => {
  it('offers eight modes, each with a label', () => {
    const modes = blendModes()
    expect(modes).toHaveLength(8)
    expect(new Set(modes).size).toBe(8)
    expect(Object.keys(BLEND_LABELS).sort()).toEqual([...modes].sort())
  })

  it('includes the modes the compositor maps to a composite operation', () => {
    const modes = blendModes() as BlendMode[]
    expect(modes).toContain('multiply')
    expect(modes).toContain('soft-light')
    expect(modes).toContain('normal')
  })
})

describe('layer factories', () => {
  it('builds a valid layer of every kind at the default transform', () => {
    const layers = [
      createTextLayer('T'),
      createStickerLayer('star'),
      createShapeLayer('rect'),
      createDrawLayer(),
      createRedactLayer(),
      createWatermarkLayer(),
      createFrameLayer('film'),
    ]
    expect(new Set(layers.map((layer) => layer.kind)).size).toBe(7)
    for (const layer of layers) {
      expect(layer.transform).toEqual(defaultTransform())
      expect(layer.visible).toBe(true)
      expect(layer.name.length).toBeGreaterThan(0)
    }
  })

  it('gives each sticker a unique id', () => {
    expect(createStickerLayer('star').id).not.toBe(createStickerLayer('star').id)
  })
})

describe('normalized layer transforms survive a re-crop', () => {
  it('keeps the transform unchanged when the crop changes', () => {
    let doc = createDoc()
    const layer = createTextLayer('Keep me')
    doc = addLayer(doc, layer)
    doc = updateLayer(doc, layer.id, {
      transform: { ...layer.transform, x: 0.25, y: 0.75, scale: 2 },
    })
    const before = doc.layers[0].transform

    doc = {
      ...doc,
      geometry: { ...doc.geometry, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 } },
    }
    expect(doc.layers[0].transform).toEqual(before)
    expect(doc.layers[0].transform.x).toBe(0.25)
  })
})
