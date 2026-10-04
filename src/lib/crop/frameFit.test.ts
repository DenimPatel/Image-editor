import { describe, expect, it } from 'vitest'
import { FRAME_PADDING, cropFrameFit } from './frameFit'

/**
 * The crop overlay and the render loop both fit the image with this, and
 * `e2e/journey.crop-preview.spec.ts` measures the two against each other in a
 * browser. What jsdom cannot measure is pinned here instead: the arithmetic the
 * overlay and the canvas share, so the two cannot drift apart in a way that only
 * shows up as a crop box a few pixels off the photograph.
 */
describe('cropFrameFit', () => {
  it('fits the image to whichever axis runs out first', () => {
    const area = { width: 920, height: 600 }
    // Portrait, and the 1271 x 1920 of the baseline screenshot: height-bound, so
    // the frame takes every pixel of the height the padding leaves.
    const portrait = cropFrameFit({ width: 1271, height: 1920 }, area)
    expect(portrait.height).toBe(600 - 2 * FRAME_PADDING)
    expect(portrait.width / portrait.height).toBeCloseTo(1271 / 1920, 9)

    const landscape = cropFrameFit({ width: 1920, height: 1080 }, area)
    expect(landscape.width).toBe(area.width - 2 * FRAME_PADDING)
    expect(landscape.height / landscape.width).toBeCloseTo(1080 / 1920, 9)
  })

  it('keeps the aspect of the frame it was given', () => {
    const fit = cropFrameFit({ width: 1271, height: 1920 }, { width: 920, height: 600 })
    expect(fit.width).toBeCloseTo(fit.scale * 1271, 9)
    expect(fit.height).toBeCloseTo(fit.scale * 1920, 9)
  })

  it('reserves the same padding on both axes, which is what keeps the two in step', () => {
    // A frame that lost height but not width would be a different aspect, and the
    // overlay's box would be a different shape from the canvas element's.
    const area = { width: 920, height: 600 }
    const fit = cropFrameFit({ width: 1000, height: 1000 }, area)
    expect(fit.width).toBe(fit.height)
  })

  it('never returns a zero or negative box, however little room there is', () => {
    const fit = cropFrameFit({ width: 1600, height: 900 }, { width: 0, height: 0 })
    expect(fit.width).toBe(1)
    expect(fit.height).toBe(1)
    expect(Number.isFinite(fit.scale)).toBe(true)
  })

  it('treats a degenerate frame as one pixel rather than dividing by zero', () => {
    const area = { width: 400, height: 400 }
    const degenerate = cropFrameFit({ width: 0, height: 0 }, area)
    expect(degenerate).toEqual(cropFrameFit({ width: 1, height: 1 }, area))
    expect(Number.isFinite(degenerate.scale)).toBe(true)
  })
})
