import { describe, expect, it } from 'vitest'
import { clampRectToCanvas } from './layers'

const SIZE = { width: 200, height: 100 }

describe('clampRectToCanvas', () => {
  it('converts a normalized rect to whole pixels', () => {
    expect(clampRectToCanvas({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, SIZE)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 25,
    })
  })

  it('never reads outside the canvas', () => {
    const cases = [
      { x: 0.95, y: 0.95, width: 0.4, height: 0.4 },
      { x: -0.3, y: -0.3, width: 0.5, height: 0.5 },
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 1, y: 1, width: 0.1, height: 0.1 },
      { x: -5, y: 0.5, width: 10, height: 0.5 },
    ]
    for (const rect of cases) {
      const clamped = clampRectToCanvas(rect, SIZE)
      expect(clamped.x).toBeGreaterThanOrEqual(0)
      expect(clamped.y).toBeGreaterThanOrEqual(0)
      expect(clamped.width).toBeGreaterThanOrEqual(0)
      expect(clamped.height).toBeGreaterThanOrEqual(0)
      expect(clamped.x + clamped.width).toBeLessThanOrEqual(SIZE.width)
      expect(clamped.y + clamped.height).toBeLessThanOrEqual(SIZE.height)
    }
  })

  it('keeps the origin so the patch is drawn back where it was sampled', () => {
    // A region that starts off-canvas is the case the old code got wrong: it
    // clamped the read to 0 but drew the patch at the unclamped x.
    const clamped = clampRectToCanvas({ x: -0.2, y: 0, width: 0.5, height: 1 }, SIZE)
    expect(clamped.x).toBe(0)
    // Only the on-canvas 0..0.3 of the region is sampled.
    expect(clamped.width).toBe(60)
  })

  it('reports an empty rect for a region entirely off-canvas', () => {
    expect(clampRectToCanvas({ x: 1.4, y: 1.4, width: 0.2, height: 0.2 }, SIZE)).toEqual({
      x: 200,
      y: 100,
      width: 0,
      height: 0,
    })
  })

  it('rounds outwards so no pixel inside the region is dropped', () => {
    const clamped = clampRectToCanvas({ x: 0.101, y: 0.101, width: 0.101, height: 0.101 }, SIZE)
    expect(clamped.x).toBe(20)
    expect(clamped.x + clamped.width).toBe(41)
  })
})
