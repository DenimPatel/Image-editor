import { describe, expect, it } from 'vitest'
import type { NormRect, Orientation, Perspective, Point, Size } from '../../model/types'
import {
  MIN_CROP,
  MIN_CROP_PX,
  clampInsideImage,
  constrainToAspect,
  cropFrameSize,
  cropToPixels,
  fillFrameCrop,
  getTransformedSize,
  largestInscribedRect,
  minCropFraction,
  mmToPx,
  orientationAffine,
  orientedSize,
  rectForHandleDrag,
  remapPerspective,
  straightenNormAffine,
  transformCropUnderOrientation,
  type AspectAnchor,
  type CropHandle,
} from './geometry'

const EPS = 1e-9

/** Deterministic PRNG so a failing property case can be reproduced verbatim. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Row-vector affine helpers, written independently of the implementation. */
type Affine = [number, number, number, number, number, number]

function affMul(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}
function affInv(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}
function affApply(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

function orientations(): Orientation[] {
  const list: Orientation[] = []
  for (let q = 0; q < 4; q += 1) {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        list.push({ quarterTurns: q, flipH, flipV })
      }
    }
  }
  return list
}

const ANCHORS: Record<Exclude<CropHandle, 'move'>, AspectAnchor> = {
  nw: { x: 'right', y: 'bottom' },
  n: { y: 'bottom' },
  ne: { x: 'left', y: 'bottom' },
  e: { x: 'left' },
  se: { x: 'left', y: 'top' },
  s: { y: 'top' },
  sw: { x: 'right', y: 'top' },
  w: { x: 'right' },
}

const EDGE_HANDLES: Exclude<CropHandle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The bounds of a rect before the aspect fit: only the frame clamps apply. */
function rawDrag(
  rect: NormRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  min: number,
): NormRect {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height
  if (handle === 'nw' || handle === 'w' || handle === 'sw') left = clamp(left + dx, 0, right - min)
  if (handle === 'ne' || handle === 'e' || handle === 'se') right = clamp(right + dx, left + min, 1)
  if (handle === 'nw' || handle === 'n' || handle === 'ne') top = clamp(top + dy, 0, bottom - min)
  if (handle === 'sw' || handle === 's' || handle === 'se')
    bottom = clamp(bottom + dy, top + min, 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * How much room an anchored box has, and therefore the widest box with ratio
 * `target` that can be placed at all. Every constraint is a constraint on the
 * width because the height is the width over the target.
 */
function roomFor(rect: NormRect, target: number, anchor: AspectAnchor) {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const anchorX = anchor.x === 'left' ? rect.x : anchor.x === 'right' ? rect.x + rect.width : null
  const anchorY = anchor.y === 'top' ? rect.y : anchor.y === 'bottom' ? rect.y + rect.height : null
  const spanW =
    anchorX === null
      ? 2 * Math.min(centerX, 1 - centerX)
      : anchor.x === 'left'
        ? 1 - anchorX
        : anchorX
  const spanH =
    anchorY === null
      ? 2 * Math.min(centerY, 1 - centerY)
      : anchor.y === 'top'
        ? 1 - anchorY
        : anchorY
  return { anchorX, anchorY, boundWidth: Math.max(0, Math.min(spanW, spanH * target)) }
}

function expectInsideUnit(rect: NormRect): void {
  expect(rect.x).toBeGreaterThanOrEqual(-EPS)
  expect(rect.y).toBeGreaterThanOrEqual(-EPS)
  expect(rect.width).toBeGreaterThan(0)
  expect(rect.height).toBeGreaterThan(0)
  expect(rect.x + rect.width).toBeLessThanOrEqual(1 + EPS)
  expect(rect.y + rect.height).toBeLessThanOrEqual(1 + EPS)
}

function randomFrame(random: () => number): Size {
  const width = 480 + Math.round(random() * 5520)
  const ratio = 0.5 + random() * 1.5
  return { width, height: Math.min(4000, Math.max(360, Math.round(width / ratio))) }
}

describe('getTransformedSize (moved, behaviour unchanged)', () => {
  it('keeps dimensions unchanged at 0 degrees', () => {
    expect(getTransformedSize(800, 600, 0)).toEqual({ width: 800, height: 600 })
  })

  it('swaps width and height at 90 degrees', () => {
    expect(getTransformedSize(800, 600, 90)).toEqual({ width: 600, height: 800 })
  })

  it('swaps width and height at 270 degrees', () => {
    expect(getTransformedSize(800, 600, 270)).toEqual({ width: 600, height: 800 })
  })

  it('keeps dimensions unchanged at 180 degrees', () => {
    expect(getTransformedSize(800, 600, 180)).toEqual({ width: 800, height: 600 })
  })

  it('expands the bounding box for an arbitrary angle', () => {
    const { width, height } = getTransformedSize(800, 600, 37)
    expect(width).toBeGreaterThan(800)
    expect(height).toBeGreaterThan(600)
  })

  it('is the bounding box of the rotation: it contains every rotated source corner', () => {
    const random = makeRandom(7)
    for (let i = 0; i < 200; i += 1) {
      const source = randomFrame(random)
      const deg = (random() * 2 - 1) * 45
      const box = getTransformedSize(source.width, source.height, deg)
      const rad = (deg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      for (const [x, y] of [
        [-source.width / 2, -source.height / 2],
        [source.width / 2, -source.height / 2],
        [-source.width / 2, source.height / 2],
        [source.width / 2, source.height / 2],
      ]) {
        const rx = x * cos - y * sin
        const ry = x * sin + y * cos
        expect(Math.abs(rx)).toBeLessThanOrEqual(box.width / 2 + 1)
        expect(Math.abs(ry)).toBeLessThanOrEqual(box.height / 2 + 1)
      }
    }
  })
})

describe('orientedSize', () => {
  it('swaps the dimensions on an odd number of quarter turns', () => {
    const source: Size = { width: 1600, height: 900 }
    for (let q = 0; q < 4; q += 1) {
      const orientation: Orientation = { quarterTurns: q, flipH: false, flipV: false }
      expect(orientedSize(source, orientation)).toEqual(
        q % 2 === 1 ? { width: 900, height: 1600 } : { width: 1600, height: 900 },
      )
    }
  })

  it('is unaffected by flips', () => {
    const source: Size = { width: 1600, height: 900 }
    expect(orientedSize(source, { quarterTurns: 0, flipH: true, flipV: true })).toEqual(source)
  })
})

describe('cropFrameSize', () => {
  it('is the unrotated source when nothing has been done yet', () => {
    const source: Size = { width: 1600, height: 900 }
    const straight: Orientation = { quarterTurns: 0, flipH: false, flipV: false }
    expect(cropFrameSize(source, straight, 0)).toEqual(source)
  })

  it('orients first and then straightens, so it is the frame the crop lives in', () => {
    const source: Size = { width: 1000, height: 800 }
    const turned: Orientation = { quarterTurns: 1, flipH: false, flipV: false }
    expect(cropFrameSize(source, turned, 0)).toEqual({ width: 800, height: 1000 })
    expect(cropFrameSize(source, turned, 20)).toEqual(getTransformedSize(800, 1000, 20))
  })
})

describe('mmToPx', () => {
  it('converts at 300 DPI', () => {
    // 25.4 mm = 1 inch = 300 px
    expect(mmToPx(25.4, 300)).toBeCloseTo(300, 6)
  })
})

describe('minCropFraction', () => {
  it('is meaningful at any resolution, not a fixed slice of the frame', () => {
    // 2% of a 2000x1000 frame is 20 px, too small to grab; 2% of a 640 px
    // proxy is 13 px. On a very large frame the normalized floor still wins,
    // so the minimum never becomes meaningless either.
    expect(minCropFraction(2000, 1000)).toBeCloseTo(MIN_CROP_PX / 1000, 9)
    expect(minCropFraction(640, 480)).toBeCloseTo(MIN_CROP_PX / 480, 9)
    expect(minCropFraction(30000, 20000)).toBeCloseTo(MIN_CROP, 9)
  })

  it('never falls below the normalized floor', () => {
    expect(minCropFraction(10_000, 10_000)).toBeCloseTo(MIN_CROP, 9)
  })

  it('never demands more than half the frame', () => {
    expect(minCropFraction(64, 64)).toBe(0.5)
    expect(minCropFraction(1, 1)).toBe(0.5)
  })
})

describe('clampInsideImage', () => {
  it('pulls an overflowing rect back inside the unit square', () => {
    expect(clampInsideImage({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 })).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    })
  })

  it('grows a sub-minimum rect back to the minimum and keeps it inside', () => {
    expect(clampInsideImage({ x: 0.99, y: 0.99, width: 0.001, height: 0.001 }, 0.05)).toEqual({
      x: 0.95,
      y: 0.95,
      width: 0.05,
      height: 0.05,
    })
  })

  it('leaves a rect that already meets the minimum alone', () => {
    const rect: NormRect = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }
    expect(clampInsideImage(rect, 0.05)).toEqual(rect)
  })
})

describe('constrainToAspect', () => {
  it('produces the requested aspect', () => {
    const rect = constrainToAspect({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }, 16 / 9)
    expect(rect.width / rect.height).toBeCloseTo(16 / 9, 6)
  })

  it('keeps the result inside the unit square', () => {
    const rect = constrainToAspect({ x: 0, y: 0, width: 0.9, height: 0.9 }, 0.1)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(1.0000001)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1.0000001)
  })

  it('D5-F01: locks a square in pixels, not in normalized units', () => {
    const frame: Size = { width: 3000, height: 2000 }
    const rect = constrainToAspect({ x: 0, y: 0, width: 1, height: 1 }, 1, { frame })
    // The "1:1" preset used to return the whole 3:2 frame.
    expect(rect.width * frame.width).toBeCloseTo(rect.height * frame.height, 6)
    expect(rect.width).toBeCloseTo(2 / 3, 9)
    expect(rect.height).toBeCloseTo(1, 9)
  })

  it('D5-F01: gives a passport spec a crop with the spec pixel aspect', () => {
    const frame: Size = { width: 3000, height: 2000 }
    const spec = 35 / 45
    const rect = constrainToAspect({ x: 0, y: 0, width: 1, height: 1 }, spec, { frame })
    const pixelAspect = (rect.width * frame.width) / (rect.height * frame.height)
    expect(pixelAspect).toBeCloseTo(spec, 9)
  })

  it('D5-F01: the frame is not needed when only the ratio is known', () => {
    const byRatio = constrainToAspect({ x: 0, y: 0, width: 1, height: 1 }, 1, {
      frameAspect: 3 / 2,
    })
    const byFrame = constrainToAspect({ x: 0, y: 0, width: 1, height: 1 }, 1, {
      frame: { width: 3000, height: 2000 },
    })
    expect(byRatio.width).toBeCloseTo(byFrame.width, 12)
    expect(byRatio.height).toBeCloseTo(byFrame.height, 12)
  })

  it('D5-F01: a square frame keeps the old normalized behaviour exactly', () => {
    const rect = constrainToAspect({ x: 0, y: 0, width: 1, height: 1 }, 1, {
      frame: { width: 1000, height: 1000 },
    })
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('D5-F02: a pinned edge survives the fit and the box grows around it', () => {
    const rect: NormRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const left = constrainToAspect(rect, 16 / 9, { anchor: { x: 'left' } })
    expect(left.x).toBeCloseTo(rect.x, 9)
    expect(left.width / left.height).toBeCloseTo(16 / 9, 9)

    const right = constrainToAspect(rect, 16 / 9, { anchor: { x: 'right' } })
    expect(right.x + right.width).toBeCloseTo(rect.x + rect.width, 9)

    const top = constrainToAspect(rect, 16 / 9, { anchor: { y: 'top' } })
    expect(top.y).toBeCloseTo(rect.y, 9)

    const bottom = constrainToAspect(rect, 16 / 9, { anchor: { y: 'bottom' } })
    expect(bottom.y + bottom.height).toBeCloseTo(rect.y + rect.height, 9)
  })

  it('D5-F02: no longer clamps the fit to the unit square from above (dead code)', () => {
    // The old `if (height > 1)` / `if (width > 1)` tail claimed the fit could
    // overflow; it is now bounded by the anchor's room instead.
    const rect: NormRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    const grown = constrainToAspect(rect, 0.25, { anchor: { y: 'bottom' } })
    expect(grown.y + grown.height).toBeCloseTo(0.9, 9)
    expect(grown.height).toBeCloseTo(0.8, 9)
    expect(grown.width).toBeCloseTo(0.2, 9)
  })

  it('still fits inside the given box when nothing is pinned', () => {
    const rect: NormRect = { x: 0.3, y: 0.3, width: 0.2, height: 0.2 }
    const fitted = constrainToAspect(rect, 1, { minFraction: 0 })
    expect(fitted.width).toBeLessThanOrEqual(rect.width + EPS)
    expect(fitted.height).toBeLessThanOrEqual(rect.height + EPS)
    expect(fitted.x + fitted.width / 2).toBeCloseTo(rect.x + rect.width / 2, 9)
  })

  it('clears the lock without touching a valid rect', () => {
    const rect: NormRect = { x: 0.2, y: 0.2, width: 0.3, height: 0.4 }
    expect(constrainToAspect(rect, null)).toEqual(rect)
    expect(constrainToAspect(rect, 0)).toEqual(rect)
    expect(constrainToAspect(rect, Number.NaN)).toEqual(rect)
  })

  it('property: 200 random anchored fits keep the pixel aspect, the bounds, the pin and the minimum', () => {
    const random = makeRandom(20260929)
    for (let i = 0; i < 200; i += 1) {
      const frame = randomFrame(random)
      const aspect = 0.5 + random() * 1.5
      const target = aspect / (frame.width / frame.height)
      const minFraction = minCropFraction(frame.width, frame.height)
      const rect: NormRect = {
        x: 0,
        y: 0,
        width: 0.15 + random() * 0.7,
        height: 0.15 + random() * 0.7,
      }
      rect.x = random() * (1 - rect.width)
      rect.y = random() * (1 - rect.height)
      const anchor: AspectAnchor = {
        x: random() < 0.34 ? undefined : random() < 0.5 ? 'left' : 'right',
        y: random() < 0.34 ? undefined : random() < 0.5 ? 'top' : 'bottom',
      }
      if (anchor.x === undefined && anchor.y === undefined) anchor.x = 'left'

      const out = constrainToAspect(rect, aspect, { frame, anchor })

      // 1. The requested *pixel* aspect, exactly.
      expect((out.width * frame.width) / (out.height * frame.height)).toBeCloseTo(aspect, 9)
      // 2. Inside the unit square.
      expectInsideUnit(out)
      // 3. The pinned edge never moved.
      const { anchorX, anchorY, boundWidth } = roomFor(rect, target, anchor)
      if (anchorX !== null) {
        expect(anchor.x === 'left' ? out.x : out.x + out.width).toBeCloseTo(anchorX, 9)
      }
      if (anchorY !== null) {
        expect(anchor.y === 'top' ? out.y : out.y + out.height).toBeCloseTo(anchorY, 9)
      }
      // 4. The minimum holds, unless the frame makes it impossible.
      const minWidth = minFraction * Math.max(1, target)
      expect(out.width).toBeGreaterThanOrEqual(Math.min(minWidth, boundWidth) - EPS)
      expect(out.height).toBeGreaterThanOrEqual(Math.min(minWidth, boundWidth) / target - EPS)
    }
  })
})

describe('largestInscribedRect', () => {
  it('returns the full image at 0 degrees', () => {
    const rect = largestInscribedRect(1000, 800, 0, 1000 / 800)
    expect(rect.width).toBeCloseTo(1000, 2)
    expect(rect.height).toBeCloseTo(800, 2)
  })

  it('shrinks monotonically as the straighten angle grows', () => {
    const at0 = largestInscribedRect(1000, 800, 0).width
    const at15 = largestInscribedRect(1000, 800, 15).width
    const at45 = largestInscribedRect(1000, 800, 45).width
    expect(at15).toBeLessThan(at0)
    expect(at45).toBeLessThan(at15)
  })

  it('keeps the requested aspect at 45 degrees', () => {
    const rect = largestInscribedRect(1000, 800, 45, 1)
    expect(rect.width / rect.height).toBeCloseTo(1, 6)
  })

  it('fits inside the rotated image (corner test)', () => {
    const rect = largestInscribedRect(1000, 800, 15)
    const halfW = 1000 / 2
    const halfH = 800 / 2
    const theta = (15 * Math.PI) / 180
    for (const [x, y] of [
      [-rect.width / 2, -rect.height / 2],
      [rect.width / 2, -rect.height / 2],
      [-rect.width / 2, rect.height / 2],
      [rect.width / 2, rect.height / 2],
    ]) {
      const rx = x * Math.cos(theta) + y * Math.sin(theta)
      const ry = -x * Math.sin(theta) + y * Math.cos(theta)
      expect(Math.abs(rx)).toBeLessThanOrEqual(halfW + 1)
      expect(Math.abs(ry)).toBeLessThanOrEqual(halfH + 1)
    }
  })
})

describe('fillFrameCrop (the correctly oriented wrapper)', () => {
  const source: Size = { width: 1000, height: 800 }
  const straight: Orientation = { quarterTurns: 0, flipH: false, flipV: false }

  it('is the full frame when nothing is straightened', () => {
    expect(fillFrameCrop(source, straight, 0)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('rotates about the *oriented* centre, not the source centre', () => {
    // Under a quarter turn the matrix rotates an 800x1000 frame, so the answer
    // must be the one for 800x1000, not for 1000x800.
    const turned: Orientation = { quarterTurns: 1, flipH: false, flipV: false }
    const expected = fillFrameCrop({ width: source.height, height: source.width }, straight, 20)
    expect(fillFrameCrop(source, turned, 20)).toEqual(expected)
  })

  it('shrinks the crop against the rotation bounding box, and keeps the aspect', () => {
    const crop = fillFrameCrop(source, straight, 20, 1)
    const box = getTransformedSize(source.width, source.height, 20)
    expect(crop.width).toBeLessThan(1)
    expect(crop.height).toBeLessThan(1)
    expect(crop.x + crop.width / 2).toBeCloseTo(0.5, 9)
    expect(crop.y + crop.height / 2).toBeCloseTo(0.5, 9)
    expect((crop.width * box.width) / (crop.height * box.height)).toBeCloseTo(1, 6)
    expectInsideUnit(crop)
  })

  it('property: 100 random frames never exceed the rotation bounding box', () => {
    const random = makeRandom(4242)
    for (let i = 0; i < 100; i += 1) {
      const frame = randomFrame(random)
      const orientation: Orientation = {
        quarterTurns: Math.floor(random() * 4),
        flipH: random() < 0.5,
        flipV: random() < 0.5,
      }
      const deg = (random() * 2 - 1) * 45
      const aspect = 0.5 + random() * 1.5
      const crop = fillFrameCrop(frame, orientation, deg, aspect)
      expectInsideUnit(crop)
      const oriented = orientedSize(frame, orientation)
      const box = getTransformedSize(oriented.width, oriented.height, deg)
      const pixelAspect = (crop.width * box.width) / (crop.height * box.height)
      expect(pixelAspect).toBeCloseTo(aspect, 6)
    }
  })
})

describe('rectForHandleDrag', () => {
  const rect: NormRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

  it('moves the whole rect without resizing', () => {
    const moved = rectForHandleDrag(rect, 'move', 0.1, -0.1)
    expect(moved.width).toBeCloseTo(0.5)
    expect(moved.height).toBeCloseTo(0.5)
    expect(moved.x).toBeCloseTo(0.35)
    expect(moved.y).toBeCloseTo(0.15)
  })

  it('drags a corner and respects the aspect lock', () => {
    const dragged = rectForHandleDrag(rect, 'se', 0.1, 0.1, 1)
    expect(dragged.width / dragged.height).toBeCloseTo(1, 6)
  })

  it('never inverts (keeps the minimum size)', () => {
    const dragged = rectForHandleDrag(rect, 'nw', 1, 1)
    expect(dragged.width).toBeGreaterThan(0)
    expect(dragged.height).toBeGreaterThan(0)
  })

  it('D5-F02: dragging the east handle outward grows the box and leaves x alone', () => {
    const dragged = rectForHandleDrag(rect, 'e', 0.2, 0, 1)
    expect(dragged.x).toBeCloseTo(rect.x, 9)
    expect(dragged.width).toBeGreaterThan(rect.width)
    expect(dragged.width / dragged.height).toBeCloseTo(1, 9)
  })

  it('D5-F02: dragging the north handle up makes the crop taller', () => {
    const start: NormRect = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }
    const dragged = rectForHandleDrag(start, 'n', 0, -0.1, 1)
    expect(dragged.y + dragged.height).toBeCloseTo(start.y + start.height, 9)
    expect(dragged.height).toBeGreaterThan(start.height)
    expect(dragged.width / dragged.height).toBeCloseTo(1, 9)
  })

  it('D5-F02: every handle pins the edges it did not move', () => {
    for (const handle of EDGE_HANDLES) {
      const dragged = rectForHandleDrag(rect, handle, 0.07, -0.05, 1)
      const anchor = ANCHORS[handle]
      expect(dragged.width / dragged.height).toBeCloseTo(1, 9)
      if (anchor.x === 'left') expect(dragged.x).toBeCloseTo(rect.x, 9)
      if (anchor.x === 'right')
        expect(dragged.x + dragged.width).toBeCloseTo(rect.x + rect.width, 9)
      if (anchor.y === 'top') expect(dragged.y).toBeCloseTo(rect.y, 9)
      if (anchor.y === 'bottom') {
        expect(dragged.y + dragged.height).toBeCloseTo(rect.y + rect.height, 9)
      }
    }
  })

  it('D5-F02: the minimum is enforced on the final rect, not on the pre-aspect edges', () => {
    const frame: Size = { width: 2000, height: 2000 }
    const minFraction = minCropFraction(frame.width, frame.height)
    const start: NormRect = { x: 0.1, y: 0.1, width: 0.05, height: 0.05 }
    const dragged = rectForHandleDrag(start, 'se', -0.02, -0.02, 4, { frame })
    expect(dragged.width).toBeGreaterThanOrEqual(minFraction - EPS)
    expect(dragged.height).toBeGreaterThanOrEqual(minFraction - EPS)
    // The pre-aspect box here is 0.03 x 0.03, so a 4:1 fit of it would be
    // 0.03 x 0.0075 — well under the minimum.
    const raw = rawDrag(start, 'se', -0.02, -0.02, minFraction)
    expect(raw.width * (1 / 4)).toBeLessThan(minFraction)
    expect(dragged.width / dragged.height).toBeCloseTo(4, 9)
  })

  it('honours a pixel-relative minimum rather than a fixed fraction', () => {
    const frame: Size = { width: 8000, height: 6000 }
    const minFraction = minCropFraction(frame.width, frame.height)
    const start: NormRect = { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }
    const dragged = rectForHandleDrag(start, 'se', -0.09, -0.09, 1, { frame })
    expect(dragged.width * frame.width).toBeGreaterThanOrEqual(MIN_CROP_PX - 1)
    expect(dragged.width).toBeGreaterThanOrEqual(minFraction - EPS)
  })

  it('property: 200 random drags keep the pixel aspect, the bounds, the pin and the requested size', () => {
    const random = makeRandom(1337)
    for (let i = 0; i < 200; i += 1) {
      const frame = randomFrame(random)
      const aspect = 0.5 + random() * 1.5
      const target = aspect / (frame.width / frame.height)
      const minFraction = minCropFraction(frame.width, frame.height)
      const handle = EDGE_HANDLES[Math.floor(random() * EDGE_HANDLES.length)]
      const start: NormRect = {
        x: 0,
        y: 0,
        width: 0.15 + random() * 0.7,
        height: 0.15 + random() * 0.7,
      }
      start.x = random() * (1 - start.width)
      start.y = random() * (1 - start.height)
      const dx = (random() * 2 - 1) * 0.3
      const dy = (random() * 2 - 1) * 0.3

      const out = rectForHandleDrag(start, handle, dx, dy, aspect, { frame })

      // 1. The requested *pixel* aspect, exactly.
      expect((out.width * frame.width) / (out.height * frame.height)).toBeCloseTo(aspect, 9)
      // 2. Inside the unit square.
      expectInsideUnit(out)
      // 3. The edges the handle did not move never moved.
      const anchor = ANCHORS[handle]
      const { anchorX, anchorY, boundWidth } = roomFor(start, target, anchor)
      if (anchorX !== null) {
        expect(anchor.x === 'left' ? out.x : out.x + out.width).toBeCloseTo(anchorX, 9)
      }
      if (anchorY !== null) {
        expect(anchor.y === 'top' ? out.y : out.y + out.height).toBeCloseTo(anchorY, 9)
      }
      // 4. It is never smaller than the pointer asked for, unless the frame
      //    or the minimum is the binding constraint.
      const raw = rawDrag(start, handle, dx, dy, minFraction)
      const wanted = Math.abs(dx) >= Math.abs(dy) ? raw.width : raw.height * target
      const minWidth = minFraction * Math.max(1, target)
      expect(out.width).toBeGreaterThanOrEqual(Math.min(wanted, boundWidth) - 1e-12)
      expect(out.width).toBeGreaterThanOrEqual(Math.min(minWidth, boundWidth) - EPS)
      // 5. And the gesture is not a no-op when the frame has room for it.
      if (wanted > 1e-6 && wanted < boundWidth - 1e-6) {
        expect(out.width).toBeGreaterThan(1e-6)
      }
    }
  })

  it('property: a locked drag is idempotent in the direction that was not driven', () => {
    // Dragging an edge outward then holding it still must keep the size the
    // first drag asked for; the old shrink-only fit lost it every time.
    const random = makeRandom(99)
    for (let i = 0; i < 100; i += 1) {
      const frame = randomFrame(random)
      const aspect = 0.6 + random()
      const start: NormRect = {
        x: 0.1 + random() * 0.3,
        y: 0.1 + random() * 0.3,
        width: 0.2 + random() * 0.2,
        height: 0.2 + random() * 0.2,
      }
      const once = rectForHandleDrag(start, 'e', 0.05, 0, aspect, { frame })
      const twice = rectForHandleDrag(once, 'e', 0, 0, aspect, { frame })
      expect(twice.width).toBeCloseTo(once.width, 9)
      expect(twice.height).toBeCloseTo(once.height, 9)
    }
  })
})

describe('transformCropUnderOrientation', () => {
  it('leaves the crop unchanged for an identity change', () => {
    const crop: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    const same = transformCropUnderOrientation(crop, orientations()[0], orientations()[0])
    expect(same.x).toBeCloseTo(crop.x, 9)
    expect(same.y).toBeCloseTo(crop.y, 9)
    expect(same.width).toBeCloseTo(crop.width, 9)
    expect(same.height).toBeCloseTo(crop.height, 9)
  })

  it('maps a crop to the rotated quadrant on one CW turn', () => {
    const crop: NormRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    const from: Orientation = { quarterTurns: 0, flipH: false, flipV: false }
    const to: Orientation = { quarterTurns: 1, flipH: false, flipV: false }
    const mapped = transformCropUnderOrientation(crop, from, to)
    expect(mapped.x).toBeCloseTo(1 - crop.y - crop.height, 9)
    expect(mapped.y).toBeCloseTo(crop.x, 9)
    expect(mapped.width).toBeCloseTo(crop.height, 9)
    expect(mapped.height).toBeCloseTo(crop.width, 9)
  })

  it('round-trips under every pair of the 8 orientations', () => {
    const crop: NormRect = { x: 0.12, y: 0.28, width: 0.34, height: 0.22 }
    for (const from of orientations()) {
      for (const to of orientations()) {
        const there = transformCropUnderOrientation(crop, from, to)
        const back = transformCropUnderOrientation(there, to, from)
        expect(back.x).toBeCloseTo(crop.x, 8)
        expect(back.y).toBeCloseTo(crop.y, 8)
        expect(back.width).toBeCloseTo(crop.width, 8)
        expect(back.height).toBeCloseTo(crop.height, 8)
      }
    }
  })

  describe('D5-F06: with a straighten', () => {
    const source: Size = { width: 1000, height: 1000 }
    const crop: NormRect = { x: 0.2, y: 0.3, width: 0.3, height: 0.2 }

    /** Rotate about the centre, then re-fit the rotation's bounding box. */
    function toStraightened(point: Point, size: Size, deg: number): Point {
      const rad = (deg * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const boxW = size.width * cos + size.height * sin
      const boxH = size.width * sin + size.height * cos
      const x = point.x * size.width - size.width / 2
      const y = point.y * size.height - size.height / 2
      const rx = (x * Math.cos(rad) - y * Math.sin(rad) + boxW / 2) / boxW
      const ry = (x * Math.sin(rad) + y * Math.cos(rad) + boxH / 2) / boxH
      return { x: rx, y: ry }
    }

    function fromStraightened(point: Point, size: Size, deg: number): Point {
      const rad = (deg * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const boxW = size.width * cos + size.height * sin
      const boxH = size.width * sin + size.height * cos
      const x = point.x * boxW - boxW / 2
      const y = point.y * boxH - boxH / 2
      return {
        x: (x * Math.cos(-rad) - y * Math.sin(-rad) + size.width / 2) / size.width,
        y: (x * Math.sin(-rad) + y * Math.cos(-rad) + size.height / 2) / size.height,
      }
    }

    it('keeps the same content selected: the crop centre lands where the chain says', () => {
      const center: Point = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }
      for (const deg of [0, 20, -35]) {
        for (const from of orientations()) {
          for (const to of orientations()) {
            const remap = { straighten: deg, source }
            const there = transformCropUnderOrientation(crop, from, to, remap)
            const delta = affMul(orientationAffine(to), affInv(orientationAffine(from)))
            const expected = toStraightened(
              affApply(delta, fromStraightened(center, orientedSize(source, from), deg)),
              orientedSize(source, to),
              deg,
            )
            expect(there.x + there.width / 2).toBeCloseTo(expected.x, 8)
            expect(there.y + there.height / 2).toBeCloseTo(expected.y, 8)
          }
        }
      }
    })

    it('round-trips exactly for a square frame, because a conjugated quarter turn is still a quarter turn', () => {
      // A flip conjugates to a *rotated* reflection, which no longer sends an
      // axis-aligned rect to an axis-aligned rect, so the round trip is only
      // exact for the quarter turns — which is what a rotate does.
      const turns: Orientation[] = [0, 1, 2, 3].map((quarterTurns) => ({
        quarterTurns,
        flipH: false,
        flipV: false,
      }))
      for (const deg of [12, 20, -45]) {
        for (const from of turns) {
          for (const to of turns) {
            const remap = { straighten: deg, source }
            const there = transformCropUnderOrientation(crop, from, to, remap)
            const back = transformCropUnderOrientation(there, to, from, remap)
            expect(back.x).toBeCloseTo(crop.x, 8)
            expect(back.y).toBeCloseTo(crop.y, 8)
            expect(back.width).toBeCloseTo(crop.width, 8)
            expect(back.height).toBeCloseTo(crop.height, 8)
          }
        }
      }
    })

    it('stays inside the unit square on a non-square frame', () => {
      const wide: Size = { width: 3000, height: 2000 }
      for (const deg of [20, -35]) {
        for (const from of orientations()) {
          for (const to of orientations()) {
            expectInsideUnit(
              transformCropUnderOrientation(crop, from, to, { straighten: deg, source: wide }),
            )
          }
        }
      }
    })

    it('would drift off the content without the straighten conjugation', () => {
      // Guards the regression: the pre-fix map applied the dihedral alone, so
      // the remapped centre no longer matched the content the crop described.
      // A quarter turn commutes with the straighten on a square frame, so the
      // drift is measured on a flip, which does not.
      const from: Orientation = { quarterTurns: 0, flipH: false, flipV: false }
      const to: Orientation = { quarterTurns: 0, flipH: true, flipV: false }
      const center: Point = { x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 }
      const deg = 20
      const delta = affMul(orientationAffine(to), affInv(orientationAffine(from)))
      const expected = toStraightened(
        affApply(delta, fromStraightened(center, orientedSize(source, from), deg)),
        orientedSize(source, to),
        deg,
      )
      const dihedralOnly = affApply(orientationAffine(to), center)
      const there = transformCropUnderOrientation(crop, from, to, { straighten: deg, source })
      const landed = there.x + there.width / 2
      expect(landed).toBeCloseTo(expected.x, 8)
      expect(dihedralOnly.x).not.toBeCloseTo(expected.x, 4)
    })
  })
})

describe('straightenNormAffine', () => {
  it('is the identity at zero degrees', () => {
    const m = straightenNormAffine({ width: 1000, height: 800 }, 0)
    expect(affApply(m, { x: 0.25, y: 0.6 })).toEqual({ x: 0.25, y: 0.6 })
  })

  it('fixes the centre of the frame', () => {
    for (const deg of [20, -45, 7]) {
      const m = straightenNormAffine({ width: 1000, height: 800 }, deg)
      const center = affApply(m, { x: 0.5, y: 0.5 })
      expect(center.x).toBeCloseTo(0.5, 12)
      expect(center.y).toBeCloseTo(0.5, 12)
    }
  })

  it('is a rotation composed with the bounding-box re-fit, so it is invertible', () => {
    const random = makeRandom(5150)
    for (let i = 0; i < 100; i += 1) {
      const size = randomFrame(random)
      const deg = (random() * 2 - 1) * 45
      const m = straightenNormAffine(size, deg)
      const point: Point = { x: random(), y: random() }
      const back = affApply(affInv(m), affApply(m, point))
      expect(back.x).toBeCloseTo(point.x, 9)
      expect(back.y).toBeCloseTo(point.y, 9)
    }
  })
})

describe('remapPerspective', () => {
  const perspective: Perspective = {
    topLeft: { x: 0.1, y: 0.2 },
    topRight: { x: -0.05, y: 0.1 },
    bottomRight: { x: 0.02, y: -0.03 },
    bottomLeft: { x: 0, y: 0.04 },
  }
  const from: Orientation = { quarterTurns: 0, flipH: false, flipV: false }

  it('permutes the corners and turns each offset on a quarter turn', () => {
    const mapped = remapPerspective(perspective, from, { ...from, quarterTurns: 1 })
    // A CW turn sends tl->tr->br->bl->tl and maps (x, y) to (-y, x).
    expect(mapped.topRight.x).toBeCloseTo(-perspective.topLeft.y, 9)
    expect(mapped.topRight.y).toBeCloseTo(perspective.topLeft.x, 9)
    expect(mapped.bottomRight.x).toBeCloseTo(-perspective.topRight.y, 9)
    expect(mapped.bottomRight.y).toBeCloseTo(perspective.topRight.x, 9)
    expect(mapped.bottomLeft.x).toBeCloseTo(-perspective.bottomRight.y, 9)
    expect(mapped.bottomLeft.y).toBeCloseTo(perspective.bottomRight.x, 9)
    expect(mapped.topLeft.x).toBeCloseTo(-perspective.bottomLeft.y, 9)
    expect(mapped.topLeft.y).toBeCloseTo(perspective.bottomLeft.x, 9)
  })

  it('round-trips under every pair of the 8 orientations', () => {
    for (const a of orientations()) {
      for (const b of orientations()) {
        const there = remapPerspective(perspective, a, b)
        const back = remapPerspective(there, b, a)
        for (const key of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const) {
          expect(back[key].x).toBeCloseTo(perspective[key].x, 9)
          expect(back[key].y).toBeCloseTo(perspective[key].y, 9)
        }
      }
    }
  })

  it('keeps the visual quad on the same pixels across a quarter turn', () => {
    const to: Orientation = { quarterTurns: 1, flipH: false, flipV: false }
    const mapped = remapPerspective(perspective, from, to)
    const bases: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const turn = (p: Point): Point => ({ x: 1 - p.y, y: p.x })
    const before = offsetsOf(perspective).map((o, i) =>
      turn({ x: bases[i].x + o.x, y: bases[i].y + o.y }),
    )
    const after = offsetsOf(mapped).map((o, i) => ({ x: bases[i].x + o.x, y: bases[i].y + o.y }))
    for (const point of before) {
      const found = after.some(
        (q) => Math.abs(q.x - point.x) < 1e-9 && Math.abs(q.y - point.y) < 1e-9,
      )
      expect(found).toBe(true)
    }
  })

  it('is a no-op for an identity change', () => {
    const same = remapPerspective(perspective, from, from)
    for (const key of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const) {
      expect(same[key].x).toBeCloseTo(perspective[key].x, 12)
      expect(same[key].y).toBeCloseTo(perspective[key].y, 12)
    }
  })
})

function offsetsOf(p: Perspective): [Point, Point, Point, Point] {
  return [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft]
}

describe('cropToPixels', () => {
  it('scales a normalized crop into image pixels', () => {
    expect(cropToPixels({ x: 0.5, y: 0.25, width: 0.5, height: 0.5 }, 1000, 800)).toEqual({
      x: 500,
      y: 200,
      width: 500,
      height: 400,
    })
  })
})
