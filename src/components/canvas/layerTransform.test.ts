import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc, Layer, LayerKind, Point, Size } from '../../model/types'
import { addLayer } from '../../features/layers/layerOps'
import {
  createDrawLayer,
  createFrameLayer,
  createRedactLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  createWatermarkLayer,
  defaultTransform,
  LAYER_TRANSFORM_PARTS,
} from '../../features/layers/factory'
import { drawLayers } from '../../render/layers'
import {
  POSITION_MAX,
  POSITION_MIN,
  SCALE_MAX,
  SCALE_MIN,
  WATERMARK_ANCHOR_KEYS,
  anchorPoints,
  canTransformInPlace,
  canvasPointFromClient,
  clampScale,
  cornerPosition,
  cornerRay,
  estimateTextWidth,
  layerBox,
  normalizeDegrees,
  rotationFromDrag,
  scaleFromCornerDrag,
  transformBasis,
  type HandleDeps,
} from './layerTransform'

const SIZE: Size = { width: 1600, height: 900 }

/**
 * jsdom has no `Path2D`, and the compositor's built-in sticker branch builds one
 * from the mark's SVG path before filling it. The recording context below is only
 * interested in the transform calls that happen either side of it, so a stand-in
 * constructor is enough.
 */
beforeAll(() => {
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class {
      constructor(public readonly path?: string) {}
    } as unknown as typeof Path2D
  }
  // A redaction samples the photo, so the compositor builds itself an offscreen
  // surface before it draws anything. jsdom has no 2D context; what that sample
  // produces is beside the point, only the transform calls around it are read.
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy({} as Record<string, unknown>, {
      get: (target, prop) => {
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 })
        if (prop === 'getImageData' || prop === 'createImageData')
          return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
        if (prop in target) return target[prop as string]
        return () => undefined
      },
      set: (target, prop, value) => {
        target[prop as string] = value
        return true
      },
    })) as unknown as HTMLCanvasElement['getContext']
})

/** Text metrics with no canvas behind them: 0.5em per character, plus tracking. */
const DEPS: HandleDeps = {
  measure: (_font, fontSize, trackingPx, text) =>
    Math.max(0, [...text].length * fontSize * 0.5 + [...text].length * trackingPx),
  stickerAspect: () => 1,
}

function at(x: number, y: number): Point {
  return { x, y }
}

function withLayer(layer: Layer): Doc {
  return addLayer(createDoc(), layer)
}

/* ------------------------------------------------------------------ *
 * Which kinds get a handle, derived from the compositor
 * ------------------------------------------------------------------ */

type Recorded = { translate: number[][]; rotate: number[][]; scale: number[][] }

function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Recorded } {
  const calls: Recorded = { translate: [], rotate: [], scale: [] }
  const store: Record<string, unknown> = {}
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (prop === 'translate') return (...args: number[]) => calls.translate.push(args)
      if (prop === 'rotate') return (...args: number[]) => calls.rotate.push(args)
      if (prop === 'scale') return (...args: number[]) => calls.scale.push(args)
      if (prop === 'measureText') return (text: string) => ({ width: [...text].length * 8 })
      if (prop === 'getImageData')
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
      if (prop === 'createImageData')
        return () => ({
          data: new Uint8ClampedArray(4),
          width: 1,
          height: 1,
        })
      if (prop === 'putImageData' || prop === 'drawImage') return () => undefined
      return () => undefined
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

/** Every kind, in one place, so a new kind cannot be quietly left out. */
const EVERY_KIND: Layer[] = [
  createTextLayer(),
  createStickerLayer('star'),
  createShapeLayer('rect'),
  createWatermarkLayer(),
  createFrameLayer('solid'),
  createRedactLayer(),
  createDrawLayer(),
]

function recordedFor(layer: Layer): Recorded {
  const { ctx, calls } = recordingContext()
  drawLayers(ctx, withLayer(layer), { size: SIZE, assets: { get: () => undefined } })
  return calls
}

describe('D6-F14: handles go on exactly the kinds the compositor transforms in place', () => {
  it('agrees with the table that mirrors drawLayers, for every kind', () => {
    for (const layer of EVERY_KIND) {
      const parts = LAYER_TRANSFORM_PARTS[layer.kind]
      expect(canTransformInPlace(layer.kind), layer.kind).toBe(
        parts.position && parts.scale && parts.rotation,
      )
    }
  })

  it('is the same answer as running the compositor and watching what it does', () => {
    for (const layer of EVERY_KIND) {
      const calls = recordedFor(layer)
      const { transform } = layer
      // A kind the compositor positions *rotates* *scales* in this order, each
      // from the transform's own fields. Nothing else in the compositor writes
      // `transform.scale` into a `scale()` call for these three kinds.
      const honoursScale = calls.scale.some(
        ([sx, sy]) => sx === transform.scale && sy === transform.scale,
      )
      const honoursRotation = calls.rotate.some(
        ([theta]) => Math.abs(theta - (transform.rotation * Math.PI) / 180) < 1e-9,
      )
      const honoursPosition = calls.translate.some(([x, y]) =>
        layer.kind === 'watermark'
          ? Math.abs(x - (transform.x - 0.5) * SIZE.width) < 1e-6 &&
            Math.abs(y - (transform.y - 0.5) * SIZE.height) < 1e-6
          : Math.abs(x - transform.x * SIZE.width) < 1e-6 &&
            Math.abs(y - transform.y * SIZE.height) < 1e-6,
      )
      expect(
        { kind: layer.kind, inPlace: canTransformInPlace(layer.kind) },
        `${layer.kind}: scale=${honoursScale} rotate=${honoursRotation} position=${honoursPosition}`,
      ).toEqual({
        kind: layer.kind,
        inPlace: honoursScale && honoursRotation && honoursPosition,
      })
    }
  })

  it('gives no handles to the three kinds drawLayers draws from their own geometry', () => {
    // These are the `break`/`continue` cases in the compositor: a frame is a
    // band round the edge, a redaction is a region of the photo, a drawing is a
    // set of absolute stroke points. A grip on any of them would be a control
    // that visibly does nothing.
    const without: LayerKind[] = ['frame', 'redact', 'draw']
    const with_: LayerKind[] = ['text', 'sticker', 'shape', 'watermark']
    expect(without.filter(canTransformInPlace)).toEqual([])
    expect(with_.filter(canTransformInPlace).sort()).toEqual([
      'shape',
      'sticker',
      'text',
      'watermark',
    ])
  })
})

/* ------------------------------------------------------------------ *
 * The anchor table
 * ------------------------------------------------------------------ */

/**
 * `ANCHORS` in `src/render/layers.ts`, read out of the compositor's own source.
 * The overlay needs the same nine resting places and the same text alignment, the
 * compositor does not export either, and a fourth hand-maintained copy is how the
 * two would come to disagree — so the expectation is parsed from the original.
 */
function compositorAnchors(): {
  key: string
  rest: Point
  align: string
  baseline: string
}[] {
  const source = readFileSync(resolve(process.cwd(), 'src/render/layers.ts'), 'utf8')
  const block = source.slice(source.indexOf('const ANCHORS'), source.indexOf('drawWatermarkLayer'))
  const entries = [
    ...block.matchAll(/'?([a-z-]+)'?:\s*\[([\d.]+),\s*([\d.]+),\s*'([a-z]+)',\s*'([a-z]+)'\]/g),
  ]
  expect(entries).toHaveLength(9)
  return entries.map((match) => ({
    key: match[1] as string,
    rest: { x: Number(match[2]), y: Number(match[3]) },
    align: match[4] as string,
    baseline: match[5] as string,
  }))
}

describe('D6-F14: a watermark rests where the compositor says it rests', () => {
  it('knows the same nine anchors, in the same places', () => {
    expect([...WATERMARK_ANCHOR_KEYS].sort()).toEqual(
      compositorAnchors()
        .map((entry) => entry.key)
        .sort(),
    )
  })

  it('takes its origin from the anchor, and its pivot from the anchor plus the offset', () => {
    for (const entry of compositorAnchors()) {
      const layer = {
        ...createWatermarkLayer(),
        anchor: entry.key,
      } as Layer
      const { origin, pivot } = anchorPoints(layer, SIZE)
      expect(origin.x, entry.key).toBeCloseTo(entry.rest.x * SIZE.width, 6)
      expect(origin.y, entry.key).toBeCloseTo(entry.rest.y * SIZE.height, 6)
      // The default transform is (0.5, 0.5), which is the identity in the
      // compositor's own arithmetic — so the mark must not move.
      expect(pivot, entry.key).toEqual(origin)
      const offset = { ...layer, transform: { ...layer.transform, x: 0.8, y: 0.2 } }
      const moved = anchorPoints(offset, SIZE)
      expect(moved.origin).toEqual(origin)
      expect(moved.pivot.x).toBeCloseTo(origin.x + 0.3 * SIZE.width, 6)
      expect(moved.pivot.y).toBeCloseTo(origin.y - 0.3 * SIZE.height, 6)
    }
  })

  it('puts the mark box where the anchor alignment says it goes', () => {
    for (const entry of compositorAnchors()) {
      const layer = { ...createWatermarkLayer(), anchor: entry.key } as Layer
      const { pivot } = anchorPoints(layer, SIZE)
      const box = layerBox(layer, SIZE, DEPS)
      const dx = entry.align === 'left' ? 1 : entry.align === 'right' ? -1 : 0
      const dy = entry.baseline === 'top' ? 1 : entry.baseline === 'bottom' ? -1 : 0
      expect(box.center.x - pivot.x, entry.key).toBeCloseTo((dx * box.halfWidth) as number, 6)
      expect(box.center.y - pivot.y, entry.key).toBeCloseTo((dy * box.halfHeight) as number, 6)
    }
  })

  it('gives every other kind a pivot that is its own transform position', () => {
    for (const layer of [createTextLayer(), createStickerLayer('star'), createShapeLayer('rect')]) {
      const placed = {
        ...layer,
        transform: { ...layer.transform, x: 0.25, y: 0.75 },
      }
      const { origin, pivot } = anchorPoints(placed, SIZE)
      expect(origin).toEqual(pivot)
      expect(pivot.x).toBeCloseTo(0.25 * SIZE.width, 6)
      expect(pivot.y).toBeCloseTo(0.75 * SIZE.height, 6)
    }
  })
})

/* ------------------------------------------------------------------ *
 * Scaling
 * ------------------------------------------------------------------ */

describe('D6-F14: corner scaling preserves aspect, and the modifier frees it', () => {
  const shape = {
    ...createShapeLayer('rect'),
    transform: { ...defaultTransform(), scale: 1 },
  }

  it('is a pure function of the pointer, so the first move cannot jump', () => {
    // The pointer has not moved. Whatever the mode, the transform that comes out
    // has to be the one that went in — this is the whole "no jump" claim.
    for (const free of [false, true]) {
      for (const corner of ['nw', 'ne', 'se', 'sw'] as const) {
        const basis = transformBasis(shape, SIZE, DEPS)
        const grabbed = cornerPosition(basis, corner)
        expect(scaleFromCornerDrag(basis, corner, grabbed, free), `${corner} free=${free}`).toEqual(
          shape.transform,
        )
      }
    }
  })

  it('holds the pivot by default, so nothing writes a position', () => {
    const basis = transformBasis(shape, SIZE, DEPS)
    const grabbed = cornerPosition(basis, 'se')
    // Out along the ray to twice the radius: the corner has gone from one unit
    // from the centre to two, which is a scale of 2.
    const next = scaleFromCornerDrag(
      basis,
      'se',
      at(
        basis.center.x + 2 * (grabbed.x - basis.center.x),
        basis.center.y + 2 * (grabbed.y - basis.center.y),
      ),
      false,
    )
    expect(next.scale).toBeCloseTo(2, 6)
    expect(next.x).toBe(shape.transform.x)
    expect(next.y).toBe(shape.transform.y)
    expect(next.rotation).toBe(shape.transform.rotation)
  })

  it('puts the grabbed corner under the pointer when the pointer is on its ray', () => {
    const basis = transformBasis(shape, SIZE, DEPS)
    const grabbed = cornerPosition(basis, 'se')
    const target = at(grabbed.x * 2 - basis.center.x, grabbed.y * 2 - basis.center.y)
    const next = scaleFromCornerDrag(basis, 'se', target, false)
    expect(next.scale).toBeCloseTo(2, 6)
    const moved = transformBasis({ ...shape, transform: next }, SIZE, DEPS)
    expect(cornerPosition(moved, 'se').x).toBeCloseTo(target.x, 6)
    expect(cornerPosition(moved, 'se').y).toBeCloseTo(target.y, 6)
  })

  it('keeps the aspect ratio on every axis of a drag, in both modes', () => {
    const tall = {
      ...createShapeLayer('arrow'),
      transform: { ...defaultTransform(), scale: 1, rotation: 23 },
    }
    for (const free of [false, true]) {
      const basis = transformBasis(tall, SIZE, DEPS)
      const grabbed = cornerPosition(basis, 'nw')
      const before = basis.halfWidth / basis.halfHeight
      const next = scaleFromCornerDrag(basis, 'nw', at(grabbed.x - 120, grabbed.y - 44), free)
      const after = transformBasis({ ...tall, transform: next }, SIZE, DEPS)
      expect(after.halfWidth / after.halfHeight, `free=${free}`).toBeCloseTo(before, 6)
    }
  })

  it('the modifier slides the layer so the corner tracks the pointer in both axes', () => {
    const basis = transformBasis(shape, SIZE, DEPS)
    const grabbed = cornerPosition(basis, 'nw')
    // Square to the ray: locked, this move cannot change the scale at all, because
    // the ray projection of a perpendicular move is zero. "Up" is not
    // perpendicular — a corner's ray is diagonal — so the perpendicular is built
    // rather than guessed.
    const ray = cornerRay(basis, 'nw')
    const length = Math.hypot(ray.x, ray.y)
    const sideways = at(grabbed.x - (ray.y / length) * 300, grabbed.y + (ray.x / length) * 300)
    const locked = scaleFromCornerDrag(basis, 'nw', sideways, false)
    expect(locked.scale).toBeCloseTo(1, 6)
    expect(locked.x).toBe(shape.transform.x)

    const free = scaleFromCornerDrag(basis, 'nw', sideways, true)
    const moved = transformBasis({ ...shape, transform: free }, SIZE, DEPS)
    expect(cornerPosition(moved, 'nw').x).toBeCloseTo(sideways.x, 6)
    expect(cornerPosition(moved, 'nw').y).toBeCloseTo(sideways.y, 6)
    // And it wrote a position, which is the difference between the two modes.
    expect(free.y).not.toBe(shape.transform.y)
  })

  it('keeps the free mode inside the range the position sliders and drag clamp share', () => {
    const basis = transformBasis(shape, SIZE, DEPS)
    const next = scaleFromCornerDrag(basis, 'se', at(SIZE.width * 40, SIZE.height * 40), true)
    expect(next.x).toBeLessThanOrEqual(POSITION_MAX)
    expect(next.x).toBeGreaterThanOrEqual(POSITION_MIN)
    expect(next.y).toBeLessThanOrEqual(POSITION_MAX)
    expect(next.y).toBeGreaterThanOrEqual(POSITION_MIN)
  })

  it('holds the scale inside the Scale slider range however far it is pulled', () => {
    const basis = transformBasis(shape, SIZE, DEPS)
    const grabbed = cornerPosition(basis, 'se')
    expect(
      scaleFromCornerDrag(basis, 'se', at(SIZE.width * 100, SIZE.height * 100), false).scale,
    ).toBeCloseTo(SCALE_MAX, 6)
    // The other end: start almost at the floor and pull the corner in through the
    // centre, which asks for a negative factor the clamp refuses.
    const other = transformBasis(
      { ...shape, transform: { ...shape.transform, scale: 0.06 } },
      SIZE,
      DEPS,
    )
    const otherCorner = cornerPosition(other, 'se')
    expect(
      scaleFromCornerDrag(
        other,
        'se',
        at(
          other.center.x - (otherCorner.x - other.center.x),
          other.center.y - (otherCorner.y - other.center.y),
        ),
        false,
      ).scale,
    ).toBeCloseTo(SCALE_MIN, 6)
    expect(grabbed.x).toBeGreaterThan(0)
  })

  it('clamps and wraps rotation the way the sliders bound it', () => {
    expect(clampScale(99)).toBe(SCALE_MAX)
    expect(clampScale(0)).toBe(SCALE_MIN)
    expect(normalizeDegrees(190)).toBe(-170)
    expect(normalizeDegrees(-190)).toBe(170)
    expect(normalizeDegrees(540)).toBe(180)
    // +180 and −180 draw identically, and the slider can say either; the wrap
    // picks the one a clockwise drag arrives at.
    expect(normalizeDegrees(-180)).toBe(180)
    expect(normalizeDegrees(Number.NaN)).toBe(0)
  })

  it('measures a watermark from its own anchor, so a scale drag keeps it there', () => {
    const watermark = { ...createWatermarkLayer(), transform: { ...defaultTransform(), scale: 1 } }
    const basis = transformBasis(watermark, SIZE, DEPS)
    const { pivot } = anchorPoints(watermark, SIZE)
    const grabbed = cornerPosition(basis, 'se')
    // Out along the ray to twice the radius, as for any other kind.
    const next = scaleFromCornerDrag(
      basis,
      'se',
      at(
        basis.center.x + 2 * (grabbed.x - basis.center.x),
        basis.center.y + 2 * (grabbed.y - basis.center.y),
      ),
      false,
    )
    expect(next.scale).toBeCloseTo(2, 6)
    // The anchor is the mark's resting place and the transform is still (0.5, 0.5),
    // which is the identity offset in the compositor's own arithmetic.
    expect(next.x).toBe(0.5)
    expect(next.y).toBe(0.5)
    // So the corner has moved out twice as far *from the anchor*. A bottom-right
    // mark is drawn from its anchor rather than around it, so its box centre is
    // not its pivot — and this is the assertion that tells the two apart.
    const after = cornerPosition(
      transformBasis({ ...watermark, transform: next }, SIZE, DEPS),
      'se',
    )
    expect(after.x - pivot.x).toBeCloseTo(2 * (grabbed.x - pivot.x), 6)
    expect(after.y - pivot.y).toBeCloseTo(2 * (grabbed.y - pivot.y), 6)
  })
})

/* ------------------------------------------------------------------ *
 * Rotation
 * ------------------------------------------------------------------ */

describe('D6-F14: rotation is about the layer centre and matches the slider', () => {
  it('reads the same number the rotation slider writes for the same sweep', () => {
    const layer = { ...createShapeLayer('rect'), transform: { ...defaultTransform(), scale: 2 } }
    const basis = transformBasis(layer, SIZE, DEPS)
    const grabbed = at(basis.center.x + 400, basis.center.y)
    // 15° clockwise on screen about the layer's own centre. Screen y runs down and
    // `ctx.rotate` is clockwise for a positive angle, so clockwise on screen is
    // the positive sign here — the same sign the Rotation slider has.
    const swept = at(
      basis.center.x + 400 * Math.cos(Math.PI / 12),
      basis.center.y + 400 * Math.sin(Math.PI / 12),
    )
    const degrees = rotationFromDrag(basis, grabbed, swept)
    expect(degrees).toBeCloseTo(15, 6)
    // Which is exactly `setLayerTransformInDoc`'s `rotation` after a slider set to
    // 15: the field, the units and the range are the slider's.
    expect(degrees).toBeLessThanOrEqual(180)
    expect(degrees).toBeGreaterThanOrEqual(-180)
  })

  it('pivots about a layer that is not at the origin, not about the canvas centre', () => {
    const layer = {
      ...createTextLayer(),
      transform: { ...defaultTransform(), x: 0.2, y: 0.8, scale: 1.5 },
    }
    const basis = transformBasis(layer, SIZE, DEPS)
    const radius = 300
    const grabbed = at(basis.center.x + radius, basis.center.y)
    const swept = at(
      basis.center.x + radius * Math.cos(Math.PI / 6),
      basis.center.y + radius * Math.sin(Math.PI / 6),
    )
    const degrees = rotationFromDrag(basis, grabbed, swept)
    expect(degrees).toBeCloseTo(30, 6)
    // The same sweep about the canvas centre would have been something else
    // entirely, which is the difference this assertion is about.
    const canvasCentreSweep =
      (Math.atan2(swept.y - SIZE.height / 2, swept.x - SIZE.width / 2) -
        Math.atan2(grabbed.y - SIZE.height / 2, grabbed.x - SIZE.width / 2)) *
      (180 / Math.PI)
    expect(Math.abs(canvasCentreSweep - degrees)).toBeGreaterThan(1)
  })

  it('leaves rotation alone when the pointer has not moved', () => {
    const layer = {
      ...createShapeLayer('rect'),
      transform: { ...defaultTransform(), rotation: 40 },
    }
    const basis = transformBasis(layer, SIZE, DEPS)
    const grabbed = cornerPosition(basis, 'ne')
    expect(rotationFromDrag(basis, grabbed, grabbed)).toBe(40)
  })

  it('wraps past the end of the range instead of sticking at it', () => {
    const layer = createShapeLayer('rect')
    const basis = transformBasis(layer, SIZE, DEPS)
    const radius = 400
    const grabbed = at(basis.center.x + radius, basis.center.y)
    const swept = at(basis.center.x - radius, basis.center.y)
    expect(rotationFromDrag(basis, grabbed, swept)).toBeCloseTo(180, 6)
  })
})

/* ------------------------------------------------------------------ *
 * Boxes and pointer mapping
 * ------------------------------------------------------------------ */

describe('D6-F14: the outline is the layer the compositor draws', () => {
  it('a shape is its own width and height box, centred on its position', () => {
    const layer = { ...createShapeLayer('arrow'), width: 0.4, height: 0.18 }
    const box = layerBox(layer, SIZE, DEPS)
    expect(box.halfWidth).toBeCloseTo(0.2 * SIZE.width, 6)
    expect(box.halfHeight).toBeCloseTo(0.09 * SIZE.height, 6)
    expect(box.center).toEqual({ x: 0.5 * SIZE.width, y: 0.5 * SIZE.height })
  })

  it('a sticker is a quarter of the frame height, and an upload keeps its own aspect', () => {
    const built = layerBox(createStickerLayer('star'), SIZE, DEPS)
    expect(built.halfHeight * 2).toBeCloseTo(SIZE.height * 0.25, 6)
    expect(built.halfWidth).toBeCloseTo(built.halfHeight, 6)

    const uploaded = layerBox(
      { ...createStickerLayer('upload.png'), svg: '', assetId: 'asset_1' },
      SIZE,
      { ...DEPS, stickerAspect: () => 2 },
    )
    expect(uploaded.halfWidth / uploaded.halfHeight).toBeCloseTo(2, 6)
  })

  it('text is as wide as its widest line and as tall as its line count', () => {
    const layer = {
      ...createTextLayer('one\ntwo'),
      style: { ...createTextLayer().style, size: 10, lineHeight: 1.5 },
    }
    const box = layerBox(layer, SIZE, DEPS)
    const fontSize = 0.1 * Math.min(SIZE.width, SIZE.height)
    expect(box.halfHeight * 2).toBeCloseTo(2 * fontSize * 1.5, 6)
    expect(box.halfWidth * 2).toBeCloseTo(3 * fontSize * 0.5, 6)
  })

  it('a kind with no in-place transform has nothing to outline', () => {
    // The predicate is what gates the overlay, and these three are the kinds it
    // rejects; their box is deliberately empty rather than plausible.
    for (const layer of [createFrameLayer('solid'), createRedactLayer(), createDrawLayer()]) {
      expect(layerBox(layer, SIZE, DEPS)).toEqual({
        center: { x: 0.5 * SIZE.width, y: 0.5 * SIZE.height },
        halfWidth: 0,
        halfHeight: 0,
      })
    }
  })

  it('measures text without a canvas at all', () => {
    expect(estimateTextWidth('12px sans-serif', 12, 0, 'abcd')).toBeCloseTo(4 * 12 * 0.55, 6)
    expect(estimateTextWidth('12px sans-serif', 12, 2, 'ab')).toBeCloseTo(2 * 12 * 0.55 + 4, 6)
    expect(estimateTextWidth('12px sans-serif', 12, 0, '')).toBe(0)
  })
})

describe('D6-F14: a pointer is read in canvas pixels, not in zoomed screen pixels', () => {
  it('maps the frame box onto the compositor size', () => {
    const point = canvasPointFromClient(
      350,
      250,
      { left: 100, top: 50, width: 500, height: 500 },
      SIZE,
    )
    expect(point?.x).toBeCloseTo((250 / 500) * SIZE.width, 6)
    expect(point?.y).toBeCloseTo((200 / 500) * SIZE.height, 6)
  })

  it('is the same answer whatever the zoom, because the box is', () => {
    const at1x = canvasPointFromClient(
      350,
      250,
      { left: 100, top: 50, width: 500, height: 500 },
      SIZE,
    )
    const at4x = canvasPointFromClient(
      1100,
      850,
      { left: 100, top: 50, width: 2000, height: 2000 },
      SIZE,
    )
    expect(at1x?.x).toBeCloseTo(at4x?.x as number, 6)
    expect(at1x?.y).toBeCloseTo(at4x?.y as number, 6)
  })

  it('has no answer while the frame has no box', () => {
    expect(canvasPointFromClient(0, 0, { left: 0, top: 0, width: 0, height: 0 }, SIZE)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * The kind list itself
 * ------------------------------------------------------------------ */

describe('D6-F14: every kind in the model has an answer', () => {
  it('covers LayerKind, so a new kind is a compile error here rather than a silent gap', () => {
    const kinds: LayerKind[] = ['text', 'sticker', 'shape', 'draw', 'redact', 'watermark', 'frame']
    expect(kinds).toHaveLength(Object.keys(LAYER_TRANSFORM_PARTS).length)
    expect(kinds.filter(canTransformInPlace)).toHaveLength(4)
  })
})
