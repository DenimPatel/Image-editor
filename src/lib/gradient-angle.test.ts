import { describe, expect, it } from 'vitest'
import { gradientDirection, gradientStop } from './gradient-angle'

// uv is bottom-up, so y = 1 is the top of the image and y = 0 the bottom.
const TOP_LEFT = { x: 0, y: 1 }
const TOP_RIGHT = { x: 1, y: 1 }
const BOTTOM_LEFT = { x: 0, y: 0 }
const BOTTOM_RIGHT = { x: 1, y: 0 }

describe('gradientDirection', () => {
  it('maps 0 degrees to top -> bottom', () => {
    const direction = gradientDirection(0)
    expect(direction.x).toBeCloseTo(0, 12)
    expect(direction.y).toBeCloseTo(1, 12)
  })

  it('maps 90 degrees to left -> right', () => {
    const direction = gradientDirection(90)
    expect(direction.x).toBeCloseTo(1, 12)
    expect(direction.y).toBeCloseTo(0, 12)
  })

  it('maps 180 and 270 degrees to the reversed directions', () => {
    expect(gradientDirection(180).y).toBeCloseTo(-1, 12)
    expect(gradientDirection(270).x).toBeCloseTo(-1, 12)
  })

  it('is always a unit vector', () => {
    for (let angle = 0; angle < 360; angle += 15) {
      const { x, y } = gradientDirection(angle)
      expect(Math.hypot(x, y)).toBeCloseTo(1, 12)
    }
  })
})

describe('gradientStop', () => {
  it('runs from the top to the bottom at 0 degrees', () => {
    expect(gradientStop(TOP_LEFT, 0)).toBeCloseTo(0, 12)
    expect(gradientStop(TOP_RIGHT, 0)).toBeCloseTo(0, 12)
    expect(gradientStop(BOTTOM_LEFT, 0)).toBeCloseTo(1, 12)
    expect(gradientStop(BOTTOM_RIGHT, 0)).toBeCloseTo(1, 12)
  })

  it('runs from the left to the right at 90 degrees', () => {
    expect(gradientStop(TOP_LEFT, 90)).toBeCloseTo(0, 12)
    expect(gradientStop(BOTTOM_LEFT, 90)).toBeCloseTo(0, 12)
    expect(gradientStop(TOP_RIGHT, 90)).toBeCloseTo(1, 12)
    expect(gradientStop(BOTTOM_RIGHT, 90)).toBeCloseTo(1, 12)
  })

  it('is monotonically increasing downwards at 0 degrees', () => {
    let previous = -Infinity
    for (let y = 1; y >= 0; y -= 0.05) {
      const value = gradientStop({ x: 0.3, y }, 0)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('is monotonically increasing left to right at 90 degrees', () => {
    let previous = -Infinity
    for (let x = 0; x <= 1; x += 0.05) {
      const value = gradientStop({ x, y: 0.3 }, 90)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('starts at the bottom left and ends at the top right at 135 degrees', () => {
    // 135 degrees is 90 degrees of rightward tilt added to top -> bottom, so
    // the ramp runs from the bottom-left corner to the top-right one.
    expect(gradientStop(BOTTOM_LEFT, 135)).toBeCloseTo(0, 12)
    expect(gradientStop(TOP_RIGHT, 135)).toBeCloseTo(1, 12)
  })

  it('spans the whole ramp at every angle', () => {
    for (let angle = 0; angle < 360; angle += 15) {
      const stops = [TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT].map((uv) =>
        gradientStop(uv, angle),
      )
      expect(Math.min(...stops)).toBeLessThanOrEqual(0.001)
      expect(Math.max(...stops)).toBeGreaterThanOrEqual(0.999)
    }
  })

  it('clamps to the 0..1 ramp', () => {
    for (let angle = 0; angle < 360; angle += 5) {
      for (const uv of [TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT]) {
        const value = gradientStop(uv, angle)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })
})
