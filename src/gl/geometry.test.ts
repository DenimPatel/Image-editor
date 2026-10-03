import { describe, expect, it } from 'vitest'
import { createDoc } from '../model/defaults'
import type { Doc, Size } from '../model/types'
import { croppedPixelSize } from '../lib/sizing'
import { getTransformedSize } from '../lib/crop/geometry'
import {
  applyMat3,
  computeOutputToSource,
  computeSourceToOutput,
  invertMat3,
  multiplyMat3,
} from './geometry'

const source = { width: 200, height: 100 }

function docFor(size: Size): Doc {
  return createDoc({
    source: { assetId: 'a', width: size.width, height: size.height, name: 'a', mime: 'image/jpeg' },
  })
}

describe('affine helpers', () => {
  it('composes and inverts', () => {
    const original: [number, number, number, number, number, number, number, number, number] = [
      2, 0, 3, 0, 2, 4, 0, 0, 1,
    ]
    const identity = multiplyMat3(invertMat3(original), original)
    expect(identity[0]).toBeCloseTo(1, 9)
    expect(identity[1]).toBeCloseTo(0, 9)
    expect(identity[2]).toBeCloseTo(0, 9)
    expect(identity[3]).toBeCloseTo(0, 9)
    expect(identity[4]).toBeCloseTo(1, 9)
    expect(identity[5]).toBeCloseTo(0, 9)
  })

  it('applies a point with homogeneous divide', () => {
    const point = applyMat3([1, 0, 10, 0, 1, 20, 0, 0, 1], { x: 5, y: 5 })
    expect(point).toEqual({ x: 15, y: 25 })
  })
})

describe('computeOutputToSource', () => {
  it('is the identity for an unedited same-size image', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' },
    })
    const m = computeOutputToSource(doc, source, source)
    expect(applyMat3(m, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    const bottomRight = applyMat3(m, { x: 200, y: 100 })
    expect(bottomRight.x).toBeCloseTo(200, 6)
    expect(bottomRight.y).toBeCloseTo(100, 6)
  })

  it('maps an output pixel into the crop box', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' },
    })
    doc.geometry.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const output = { width: 100, height: 50 }
    const m = computeOutputToSource(doc, source, output)
    const topLeft = applyMat3(m, { x: 0, y: 0 })
    expect(topLeft.x).toBeCloseTo(50, 4)
    expect(topLeft.y).toBeCloseTo(25, 4)
    const bottomRight = applyMat3(m, { x: 100, y: 50 })
    expect(bottomRight.x).toBeCloseTo(150, 4)
    expect(bottomRight.y).toBeCloseTo(75, 4)
  })

  it('rotates a quarter turn clockwise', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' },
    })
    doc.geometry.orientation.quarterTurns = 1
    const output = { width: 100, height: 200 }
    const m = computeOutputToSource(doc, source, output)
    const topLeft = applyMat3(m, { x: 0, y: 0 })
    expect(topLeft.x).toBeCloseTo(0, 4)
    expect(topLeft.y).toBeCloseTo(100, 4)
  })

  it('composes with its own inverse', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' },
    })
    doc.geometry.crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }
    doc.geometry.straighten = 12
    const output = { width: 120, height: 60 }
    const forward = computeSourceToOutput(doc, source, output)
    const back = computeOutputToSource(doc, source, output)
    const original = { x: 33, y: 44 }
    const roundTrip = applyMat3(back, applyMat3(forward, original))
    expect(roundTrip.x).toBeCloseTo(original.x, 3)
    expect(roundTrip.y).toBeCloseTo(original.y, 3)
  })
})

describe('D5-F04: the straighten canvas and the straighten sampler agree', () => {
  const cases: { size: Size; deg: number }[] = [
    { size: { width: 1000, height: 800 }, deg: 20 },
    { size: { width: 1000, height: 1000 }, deg: 45 },
    { size: { width: 3000, height: 2000 }, deg: -13 },
  ]

  it.each(cases)(
    'shows the whole $size.width x $size.height source at $deg degrees',
    ({ size, deg }) => {
      const doc = docFor(size)
      doc.geometry.straighten = deg
      const output = getTransformedSize(size.width, size.height, deg)
      const m = computeSourceToOutput(doc, size, output)

      for (const [x, y] of [
        [0, 0],
        [size.width, 0],
        [0, size.height],
        [size.width, size.height],
        [size.width / 2, size.height / 2],
      ]) {
        const p = applyMat3(m, { x, y })
        expect(p.x).toBeGreaterThanOrEqual(-1)
        expect(p.y).toBeGreaterThanOrEqual(-1)
        expect(p.x).toBeLessThanOrEqual(output.width + 1)
        expect(p.y).toBeLessThanOrEqual(output.height + 1)
      }
    },
  )

  it.each(cases)(
    'scales isotropically at $deg degrees on $size.width x $size.height',
    ({ size, deg }) => {
      const doc = docFor(size)
      doc.geometry.straighten = deg
      // Unrounded, so the assertion measures the matrix and not the whole-pixel
      // rounding the output canvas does.
      const rad = (deg * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const output = {
        width: size.width * cos + size.height * sin,
        height: size.width * sin + size.height * cos,
      }
      const m = computeSourceToOutput(doc, size, output)
      const topLeft = applyMat3(m, { x: 0, y: 0 })
      const right = applyMat3(m, { x: output.width, y: 0 })
      const bottom = applyMat3(m, { x: 0, y: output.height })
      const scaleX = (right.x - topLeft.x) / output.width
      const scaleY = (bottom.y - topLeft.y) / output.height
      // The rotation foreshortens both axes by the same amount...
      expect(scaleX).toBeCloseTo(scaleY, 9)
      expect(Math.max(scaleX / scaleY, scaleY / scaleX)).toBeLessThan(1.001)
      // ...and that amount is the cosine of the angle, not a ratio of two
      // different scales.
      expect(scaleX).toBeCloseTo(cos, 9)
    },
  )

  it.each(cases)('stays isotropic to within a whole pixel at $deg degrees', ({ size, deg }) => {
    const doc = docFor(size)
    doc.geometry.straighten = deg
    const output = getTransformedSize(size.width, size.height, deg)
    const m = computeSourceToOutput(doc, size, output)
    const topLeft = applyMat3(m, { x: 0, y: 0 })
    const right = applyMat3(m, { x: output.width, y: 0 })
    const bottom = applyMat3(m, { x: 0, y: output.height })
    const scaleX = (right.x - topLeft.x) / output.width
    const scaleY = (bottom.y - topLeft.y) / output.height
    expect(Math.max(scaleX / scaleY, scaleY / scaleX)).toBeLessThan(1.001)
  })

  it('matches the size model, which measures the same rect', () => {
    for (const { size, deg } of cases) {
      const doc = docFor(size)
      doc.geometry.straighten = deg
      expect(croppedPixelSize(doc)).toEqual(getTransformedSize(size.width, size.height, deg))
      doc.geometry.crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
      const box = getTransformedSize(size.width, size.height, deg)
      expect(croppedPixelSize(doc)).toEqual({
        width: Math.round(box.width * 0.5),
        height: Math.round(box.height * 0.5),
      })
    }
  })

  it('still handles a quarter turn and a crop on top of the straighten', () => {
    const size: Size = { width: 1000, height: 800 }
    const doc = docFor(size)
    doc.geometry.straighten = 20
    doc.geometry.orientation.quarterTurns = 1
    const oriented = getTransformedSize(size.height, size.width, 20)
    doc.geometry.crop = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }
    const m = computeSourceToOutput(doc, size, {
      width: Math.round(oriented.width * 0.6),
      height: Math.round(oriented.height * 0.6),
    })
    for (const [x, y] of [
      [0, 0],
      [size.width, 0],
      [0, size.height],
      [size.width, size.height],
    ]) {
      const p = applyMat3(m, { x, y })
      // The whole oriented source is rotated, so it must still fit the canvas.
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(p.x).toBeGreaterThanOrEqual(-oriented.height)
      expect(p.x).toBeLessThanOrEqual(oriented.height * 2)
      expect(p.y).toBeGreaterThanOrEqual(-oriented.width)
      expect(p.y).toBeLessThanOrEqual(oriented.width * 2)
    }
  })
})
