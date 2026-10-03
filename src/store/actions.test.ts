import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc, IDENTITY_CURVE } from '../model/defaults'
import type { Doc, DrawLayer, Perspective, Size } from '../model/types'
import { applyMat3, computeOutputToSource } from '../gl/geometry'
import { transformCropUnderOrientation } from '../lib/crop/geometry'
import {
  addLayerToDoc,
  addTextLayer,
  bringLayerToFront,
  clearDrawStrokes,
  dropLayerOnRow,
  duplicateLayerToDoc,
  nudgeLayer,
  removeLayer,
  renameLayerInDoc,
  resetAdjust,
  rotateBy,
  sendLayerToBack,
  setLayerTransformInDoc,
  setAdjust,
  setAspectLock,
  setBackground,
  setCrop,
  setCurveChannel,
  setHslBand,
  setLayerBlendInDoc,
  setLook,
  setOutput,
  setStraighten,
  toggleFlipH,
  toggleFlipV,
  updateLayerById,
  updateLayerPatch,
} from './actions'
import { useDocStore } from './docStore'
import { MAX_HISTORY } from './history'

function state() {
  return useDocStore.getState()
}

const FULL = { x: 0, y: 0, width: 1, height: 1 }

beforeEach(() => {
  useDocStore.getState().load(createDoc())
})

describe('continuous edits are coalesced', () => {
  it('D2-F04: 100 setAdjust calls inside one interaction are one undo step', () => {
    state().beginInteraction('adjust:exposure')
    for (let i = 0; i < 100; i += 1) setAdjust('exposure', i / 100)
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    expect(state().present.adjust.exposure).toBeCloseTo(0.99, 6)
    state().undo()
    expect(state().present.adjust.exposure).toBe(0)
  })

  it('D2-F04: 100 setAdjust calls outside an interaction use the coalesce window', () => {
    const spy = vi.spyOn(Date, 'now')
    try {
      spy.mockReturnValue(0)
      for (let i = 0; i < 100; i += 1) {
        spy.mockReturnValue(i * 50)
        setAdjust('exposure', i / 100)
      }
    } finally {
      spy.mockRestore()
    }
    expect(state().past).toHaveLength(1)
    expect(state().present.adjust.exposure).toBeCloseTo(0.99, 6)
  })

  it('D2-F04: 100 setAdjust calls 700 ms apart still fit inside the 50-slot history', () => {
    const spy = vi.spyOn(Date, 'now')
    try {
      spy.mockReturnValue(0)
      for (let i = 0; i < 100; i += 1) {
        spy.mockReturnValue(i * 700)
        setAdjust('exposure', i / 1000)
      }
    } finally {
      spy.mockRestore()
    }
    expect(state().past).toHaveLength(MAX_HISTORY)
  })

  it('collapses a curve drag to one step', () => {
    state().beginInteraction('curves:point')
    for (let i = 0; i < 100; i += 1) {
      setCurveChannel('rgb', [
        { x: 0, y: 0 },
        { x: 128, y: i },
        { x: 255, y: 255 },
      ])
    }
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    expect(state().present.curves.rgb[1]).toEqual({ x: 128, y: 99 })
  })

  it('collapses an HSL drag to one step', () => {
    state().beginInteraction('hsl:red:hue')
    for (let i = 0; i < 100; i += 1) setHslBand('red', { hue: i / 10 })
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    expect(state().present.hsl.red.hue).toBeCloseTo(9.9, 6)
  })

  it('collapses a layer patch drag to one step', () => {
    const id = addTextLayer()
    state().beginInteraction('layer:move')
    for (let i = 0; i < 100; i += 1) {
      const layer = state().present.layers[0]
      updateLayerPatch(id, { transform: { ...layer.transform, x: i / 100 } })
    }
    state().endInteraction()
    expect(state().past).toHaveLength(2)
    expect(state().present.layers[0].transform.x).toBeCloseTo(0.99, 6)
  })

  it('keeps 100 gradient-angle frames inside one interaction to one step', () => {
    state().beginInteraction('background:angle')
    for (let i = 0; i < 100; i += 1) {
      setBackground({ gradient: { ...state().present.background.gradient, angle: i } })
    }
    state().endInteraction()
    expect(state().past).toHaveLength(1)
  })

  it('keeps 100 look-strength frames inside one interaction to one step', () => {
    state().beginInteraction('look:amount')
    for (let i = 0; i < 100; i += 1) setLook('teal', i / 100)
    state().endInteraction()
    expect(state().past).toHaveLength(1)
  })

  it('keeps 100 straighten frames inside one interaction to one step', () => {
    state().beginInteraction('straighten')
    for (let i = 0; i < 100; i += 1) setStraighten(i / 10)
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    expect(state().present.geometry.straighten).toBeCloseTo(9.9, 6)
  })
})

describe('export settings stay off the undo stack', () => {
  it('D2-F04: the quality slider never occupies a history slot', () => {
    state().beginInteraction('slider:Quality')
    for (let i = 10; i <= 100; i += 1) setOutput({ quality: i / 100 })
    state().endInteraction()
    expect(state().past).toHaveLength(0)
    expect(state().present.output.quality).toBe(1)
  })

  it('D2-F04: 200 DPI stepper presses never occupy a history slot', () => {
    for (let i = 0; i < 200; i += 1) setOutput({ dpi: 36 + i })
    expect(state().past).toHaveLength(0)
    expect(state().present.output.dpi).toBe(235)
  })

  it('still applies, autosaves and can be opted back into history', () => {
    const revision = state().revision
    setOutput({ format: 'png' })
    expect(state().present.output.format).toBe('png')
    expect(state().revision).toBe(revision + 1)
    setOutput({ dpi: 150 }, { transient: false })
    expect(state().past).toHaveLength(1)
  })

  it('does not swallow the next real edit', () => {
    setOutput({ dpi: 150 })
    setAdjust('exposure', 1)
    expect(state().past).toHaveLength(1)
    state().undo()
    expect(state().present.adjust.exposure).toBe(0)
  })
})

describe('multi-field actions are one undo step', () => {
  it('D2-F05: one aspect-chip tap increments past by exactly 1', () => {
    state().beginInteraction('crop:preset')
    setAspectLock(1)
    setCrop({ x: 0, y: 0.25, width: 1, height: 0.5 })
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    expect(state().present.geometry.aspectLock).toBe(1)
    expect(state().present.geometry.crop).toEqual({ x: 0, y: 0.25, width: 1, height: 0.5 })
    state().undo()
    expect(state().present.geometry.aspectLock).toBeNull()
    expect(state().present.geometry.crop).toEqual(FULL)
  })

  it('D2-F05: the three-field print-size branch is one undo step', () => {
    state().beginInteraction('print:size')
    setOutput(
      { resize: { mode: 'physical', widthMm: 100, heightMm: 150, dpi: 300 } },
      { transient: false },
    )
    setAspectLock(100 / 150)
    setCrop({ x: 0, y: 0, width: 1, height: 2 / 3 })
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    state().undo()
    expect(state().present.output.resize).toEqual({ mode: 'none' })
    expect(state().present.geometry.aspectLock).toBeNull()
  })

  it('D2-F05: re-tapping the active chip is a no-op, not an undo step', () => {
    state().beginInteraction('crop:preset')
    setAspectLock(1)
    setCrop({ x: 0, y: 0, width: 1, height: 1 })
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    const revision = state().revision
    state().beginInteraction('crop:preset')
    setAspectLock(1)
    setCrop({ x: 0, y: 0, width: 1, height: 1 })
    state().endInteraction()
    expect(state().past).toHaveLength(1)
    expect(state().revision).toBe(revision)
  })
})

describe('no-op actions', () => {
  it('D2-F07: resetAdjust on a neutral slider changes nothing', () => {
    const revision = state().revision
    resetAdjust('exposure')
    expect(state().past).toHaveLength(0)
    expect(state().revision).toBe(revision)
  })

  it('D2-F07: rotateBy(0) is a no-op', () => {
    const revision = state().revision
    rotateBy(0)
    expect(state().past).toHaveLength(0)
    expect(state().revision).toBe(revision)
  })

  it('D2-F07: setting a slider to its current value is a no-op', () => {
    setAdjust('contrast', 40)
    const revision = state().revision
    setAdjust('contrast', 40)
    expect(state().past).toHaveLength(1)
    expect(state().revision).toBe(revision)
  })

  it('D2-F07: re-selecting the active look is a no-op', () => {
    setLook('teal', 0.5)
    const revision = state().revision
    setLook('teal', 0.5)
    expect(state().past).toHaveLength(1)
    expect(state().revision).toBe(revision)
  })

  it('D2-F07: clearing a layer that is not there is a no-op', () => {
    const revision = state().revision
    removeLayer('nope')
    nudgeLayer('nope', 1)
    clearDrawStrokes('nope')
    expect(state().past).toHaveLength(0)
    expect(state().revision).toBe(revision)
  })

  it('rotateBy(90) four times collapses to one step while they share a window', () => {
    for (let i = 0; i < 4; i += 1) rotateBy(90)
    expect(state().past).toHaveLength(1)
    expect(state().present.geometry.orientation.quarterTurns).toBe(0)
  })

  it('rotations outside the coalesce window are four steps', () => {
    const spy = vi.spyOn(Date, 'now')
    try {
      for (let i = 0; i < 4; i += 1) {
        spy.mockReturnValue(i * 10_000)
        rotateBy(90)
      }
    } finally {
      spy.mockRestore()
    }
    expect(state().past).toHaveLength(4)
    expect(state().present.geometry.orientation.quarterTurns).toBe(0)
  })

  it('flips coalesce on the shared flip key', () => {
    toggleFlipH()
    toggleFlipV()
    expect(state().present.geometry.orientation).toEqual({
      quarterTurns: 0,
      flipH: true,
      flipV: true,
    })
    expect(state().past).toHaveLength(1)
  })

  it('flips outside the coalesce window are separate undo steps', () => {
    const spy = vi.spyOn(Date, 'now')
    try {
      spy.mockReturnValue(0)
      toggleFlipH()
      spy.mockReturnValue(10_000)
      toggleFlipV()
    } finally {
      spy.mockRestore()
    }
    expect(state().past).toHaveLength(2)
    state().undo()
    expect(state().present.geometry.orientation.flipV).toBe(false)
    expect(state().present.geometry.orientation.flipH).toBe(true)
  })
})

describe('crop maths', () => {
  it('rotateBy(90) maps the crop rect through the orientation', () => {
    setCrop({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 })
    rotateBy(90)
    const crop = state().present.geometry.crop
    expect(crop.x).toBeCloseTo(1 - 0.2 - 0.4, 6)
    expect(crop.y).toBeCloseTo(0.1, 6)
    expect(crop.width).toBeCloseTo(0.4, 6)
    expect(crop.height).toBeCloseTo(0.5, 6)
  })

  it('clamps straighten to +/-45', () => {
    setStraighten(90)
    expect(state().present.geometry.straighten).toBe(45)
    setStraighten(-90)
    expect(state().present.geometry.straighten).toBe(-45)
  })
})

describe('layer actions', () => {
  it('addTextLayer adds a centred text layer and returns its id', () => {
    const id = addTextLayer('Hello')
    const layer = state().present.layers[0]
    expect(layer.id).toBe(id)
    expect(layer).toMatchObject({ kind: 'text', text: 'Hello', name: 'Hello' })
    if (layer.kind === 'text') expect(layer.transform).toMatchObject({ x: 0.5, y: 0.5, scale: 1 })
  })

  it('updateLayerById replaces fields on one layer only', () => {
    const first = addTextLayer('a')
    addTextLayer('b')
    updateLayerById(first, { name: 'renamed' })
    expect(state().present.layers.map((layer) => layer.name)).toEqual(['renamed', 'b'])
  })

  it('nudgeLayer reorders and clamps at both ends', () => {
    const a = addTextLayer('a')
    const b = addTextLayer('b')
    nudgeLayer(b, -1)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([b, a])
    nudgeLayer(b, -1)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([b, a])
    nudgeLayer(b, 1)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([a, b])
    nudgeLayer(b, 1)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([a, b])
  })

  it('removeLayer drops only the target', () => {
    const a = addTextLayer('a')
    const b = addTextLayer('b')
    removeLayer(a)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([b])
  })

  it('addLayerToDoc appends and is one step', () => {
    addLayerToDoc({
      id: 'l1',
      kind: 'sticker',
      name: 's',
      visible: true,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      assetId: 'asset',
    } as Doc['layers'][number])
    expect(state().present.layers).toHaveLength(1)
    expect(state().past).toHaveLength(1)
  })

  it('clearDrawStrokes empties a draw layer and leaves others alone', () => {
    const draw: DrawLayer = {
      id: 'd1',
      kind: 'draw',
      name: 'draw',
      visible: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      color: '#ffffff',
      size: 8,
      brush: 'pen',
      strokes: [{ points: [{ x: 1, y: 1 }], radius: 8, hardness: 1 }],
    }
    const text = addTextLayer('t')
    addLayerToDoc(draw)
    clearDrawStrokes('d1')
    const layers = state().present.layers
    expect(layers.find((layer) => layer.id === 'd1')).toMatchObject({ strokes: [] })
    expect(layers.find((layer) => layer.id === text)?.kind).toBe('text')
  })
})

const SOURCE: Size = { width: 3000, height: 2000 }
/** Any output size will do: the crop is normalized, this only fixes the units. */
const OUTPUT: Size = { width: 1000, height: 1000 }

function withSource(patch: Partial<Doc> = {}): void {
  useDocStore.getState().load(
    createDoc({
      source: {
        assetId: 'a1',
        width: SOURCE.width,
        height: SOURCE.height,
        name: 'p',
        mime: 'image/png',
      },
      ...patch,
    }),
  )
}

/**
 * The source pixel the centre of the cropped output lands on — i.e. the middle
 * of the content the crop selects. The output canvas *is* the crop, so its
 * centre is the probe; `OUTPUT` only fixes the units the matrix works in.
 */
function cropCentre(doc: Doc): { x: number; y: number } {
  const m = computeOutputToSource(doc, SOURCE, OUTPUT)
  return applyMat3(m, { x: OUTPUT.width / 2, y: OUTPUT.height / 2 })
}

describe('D6-F03: layer surgery delegates to layerOps, with a history key', () => {
  it('nudgeLayer coalesces a run of reorders into one undo step', () => {
    const a = addTextLayer('a')
    const b = addTextLayer('b')
    const c = addTextLayer('c')
    const before = state().past.length
    nudgeLayer(c, -1)
    nudgeLayer(c, -1)
    nudgeLayer(c, -1)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([c, a, b])
    expect(state().past.length).toBe(before + 1)
    state().undo()
    expect(state().present.layers.map((layer) => layer.id)).toEqual([a, b, c])
  })

  it('removeLayer and addLayerToDoc each carry a key of their own', () => {
    const id = addTextLayer('a')
    const spy = vi.spyOn(Date, 'now')
    try {
      spy.mockReturnValue(0)
      removeLayer(id)
      spy.mockReturnValue(10_000)
      addLayerToDoc(createSticker('s'))
    } finally {
      spy.mockRestore()
    }
    // Same window, two different keys: two undo steps, not one merged blob.
    expect(state().past).toHaveLength(3)
  })

  it('updateLayerById coalesces on the layer id', () => {
    const id = addTextLayer('a')
    updateLayerById(id, { visible: false })
    updateLayerById(id, { visible: true })
    expect(state().past).toHaveLength(2)
  })

  it('duplicateLayerToDoc inserts a copy above the original and returns its id', () => {
    const layer = createSticker('star')
    addLayerToDoc(layer)
    const copyId = duplicateLayerToDoc(layer.id)
    const layers = state().present.layers
    expect(copyId).toBeTruthy()
    expect(layers.map((entry) => entry.name)).toEqual(['star', 'star copy'])
    expect(layers[1].id).toBe(copyId)
    expect(state().past).toHaveLength(2)
    state().undo()
    expect(state().present.layers).toHaveLength(1)
  })

  it('duplicateLayerToDoc on a layer that is not there changes nothing', () => {
    expect(duplicateLayerToDoc('nope')).toBeNull()
    expect(state().past).toHaveLength(0)
  })

  it('renameLayerInDoc writes the trimmed name and falls back to the kind', () => {
    const id = addTextLayer('Poster')
    renameLayerInDoc(id, '  Wedding caption  ')
    expect(state().present.layers[0].name).toBe('Wedding caption')
    renameLayerInDoc(id, '   ')
    expect(state().present.layers[0].name).toBe('text')
    // The add plus one coalesced rename span: a run of renames is one step.
    expect(state().past).toHaveLength(2)
    state().undo()
    expect(state().present.layers[0].name).toBe('Poster')
  })

  it('bringLayerToFront and sendLayerToBack are separate undo steps', () => {
    const a = addTextLayer('a')
    const b = addTextLayer('b')
    bringLayerToFront(a)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([b, a])
    sendLayerToBack(a)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([a, b])
    // Same coalesce window, different keys: both survive.
    expect(state().past).toHaveLength(4)
  })

  it('dropLayerOnRow moves the dragged layer onto the target slot', () => {
    const a = addTextLayer('a')
    const b = addTextLayer('b')
    const c = addTextLayer('c')
    dropLayerOnRow(c, a)
    expect(state().present.layers.map((layer) => layer.id)).toEqual([c, a, b])
    const revision = state().revision
    dropLayerOnRow(c, c)
    expect(state().revision).toBe(revision)
  })

  it('setLayerBlendInDoc writes a non-default blend and ignores the current one', () => {
    const id = addTextLayer('Poster')
    setLayerBlendInDoc(id, 'multiply')
    expect(state().present.layers[0].transform.blend).toBe('multiply')
    const revision = state().revision
    setLayerBlendInDoc(id, 'multiply')
    expect(state().revision).toBe(revision)
    expect(state().past).toHaveLength(2)
  })
})

describe('D5-F06/D5-F07: an orientation change carries straighten and perspective', () => {
  it('a flip while straightened keeps the same content selected', () => {
    withSource()
    setStraighten(20)
    setCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.4 })
    const before = cropCentre(state().present)
    toggleFlipH()
    const after = cropCentre(state().present)
    expect(after.x).toBeCloseTo(before.x, 3)
    expect(after.y).toBeCloseTo(before.y, 3)
  })

  it('the un-conjugated dihedral map really would have moved the selection', () => {
    // The control for the test above: the crop is documented to live in the
    // straightened frame, so the dihedral swap has to be conjugated by the
    // straighten rotation. Un-conjugated it drags the selection hundreds of
    // pixels away from the content it was drawn around.
    withSource()
    setStraighten(20)
    setCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.4 })
    const from = state().present.geometry.orientation
    // No `remap`: this is the map `withOrientation` used before the straighten
    // conjugation was added.
    const stale = transformCropUnderOrientation(state().present.geometry.crop, from, {
      ...from,
      flipH: true,
    })
    const before = cropCentre(state().present)
    const staleDoc: Doc = {
      ...state().present,
      geometry: { ...state().present.geometry, orientation: { ...from, flipH: true }, crop: stale },
    }
    const moved = cropCentre(staleDoc)
    expect(Math.hypot(moved.x - before.x, moved.y - before.y)).toBeGreaterThan(100)
  })

  it('rotateBy(90) permutes the perspective quad instead of dropping it', () => {
    withSource()
    const perspective: Perspective = {
      topLeft: { x: 0.1, y: 0.05 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    }
    useDocStore.getState().update((doc) => ({ ...doc, geometry: { ...doc.geometry, perspective } }))
    rotateBy(90)
    const next = state().present.geometry.perspective
    // A quarter turn sends the top-left corner to the top-right one and turns
    // the offset vector with it: (0.1, 0.05) becomes (-0.05, 0.1).
    expect(next.topRight.x).toBeCloseTo(-0.05, 6)
    expect(next.topRight.y).toBeCloseTo(0.1, 6)
    expect(next.topLeft).toEqual({ x: 0, y: 0 })
  })

  it('a flip carries the perspective offset to the mirrored corner', () => {
    withSource()
    useDocStore.getState().update((doc) => ({
      ...doc,
      geometry: {
        ...doc.geometry,
        perspective: {
          topLeft: { x: 0.08, y: 0 },
          topRight: { x: 0, y: 0 },
          bottomRight: { x: 0, y: 0 },
          bottomLeft: { x: 0, y: 0 },
        },
      },
    }))
    toggleFlipH()
    const next = state().present.geometry.perspective
    expect(next.topRight.x).toBeCloseTo(-0.08, 6)
    expect(next.topRight.y).toBeCloseTo(0, 6)
    expect(next.topLeft).toEqual({ x: 0, y: 0 })
  })

  it('leaves an all-zero perspective alone', () => {
    withSource()
    rotateBy(90)
    expect(state().present.geometry.perspective).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    })
  })
})

function createSticker(name: string): Doc['layers'][number] {
  return {
    id: `sticker_${name}`,
    kind: 'sticker',
    name,
    visible: true,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
    svg: name,
    assetId: null,
  }
}

describe('curves and hsl', () => {
  it('setCurveChannel writes one channel and leaves the others', () => {
    setCurveChannel('g', [...IDENTITY_CURVE, { x: 128, y: 128 }])
    expect(state().present.curves.g).toHaveLength(3)
    expect(state().present.curves.rgb).toEqual(IDENTITY_CURVE.map((point) => ({ ...point })))
  })

  it('setHslBand merges into the band without clearing its siblings', () => {
    setHslBand('red', { sat: 50 })
    setHslBand('red', { lum: -20 })
    expect(state().present.hsl.red).toEqual({ hue: 0, sat: 50, lum: -20 })
    expect(state().present.hsl.blue).toEqual({ hue: 0, sat: 0, lum: 0 })
  })
})

describe('D6-F14: a transform gesture owns its own undo granularity', () => {
  const TRANSFORM = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' } as const

  function withSticker() {
    addLayerToDoc(createSticker('star'))
    return 'sticker_star'
  }

  it('a hundred moves inside one interaction are one entry', () => {
    const id = withSticker()
    const before = state().past.length
    state().beginInteraction(`layer-transform:${id}`)
    for (let i = 0; i < 100; i += 1) {
      setLayerTransformInDoc(id, { ...TRANSFORM, scale: 1 + i / 100 })
    }
    state().endInteraction()
    expect(state().past.length - before).toBe(1)
    expect(state().present.layers[0]?.transform.scale).toBeCloseTo(1.99, 6)
    state().undo()
    expect(state().present.layers[0]?.transform).toEqual(TRANSFORM)
  })

  it('and two gestures are two entries, which is what a timer would have merged', () => {
    // `updateLayerPatch` coalesces `layer:${id}` for 600 ms, which is right for a
    // slider and wrong for a gesture: two separate drags of the same corner are
    // two things a user wants to undo separately. The action carries no key, so
    // the enclosing interaction is the only thing that decides.
    const spy = vi.spyOn(Date, 'now')
    try {
      spy.mockReturnValue(0)
      const id = withSticker()
      state().beginInteraction(`layer-transform:${id}`)
      setLayerTransformInDoc(id, { ...TRANSFORM, scale: 1.5 })
      state().endInteraction()
      spy.mockReturnValue(50)
      state().beginInteraction(`layer-transform:${id}:key`)
      setLayerTransformInDoc(id, { ...TRANSFORM, scale: 2 })
      state().endInteraction()
    } finally {
      spy.mockRestore()
    }
    expect(state().past.length).toBe(3)
    state().undo()
    expect(state().present.layers[0]?.transform.scale).toBe(1.5)
  })

  it('writing the transform back unchanged is not an undo step', () => {
    const id = withSticker()
    const revision = state().revision
    setLayerTransformInDoc(id, { ...TRANSFORM })
    expect(state().past).toHaveLength(1)
    expect(state().revision).toBe(revision)
    expect(state().present.layers[0]?.transform).toEqual(TRANSFORM)
  })

  it('leaves the rest of the layer alone', () => {
    const id = withSticker()
    setLayerTransformInDoc(id, { ...TRANSFORM, scale: 2, rotation: 30 })
    const layer = state().present.layers[0]
    expect(layer?.name).toBe('star')
    expect(layer?.visible).toBe(true)
    expect(layer?.kind).toBe('sticker')
    if (layer?.kind !== 'sticker') throw new Error('expected a sticker')
    expect(layer.svg).toBe('star')
  })
})
