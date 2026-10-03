import { describe, expect, it } from 'vitest'
import { createDoc } from '../model/defaults'
import type { Background } from '../model/types'
import {
  BACKGROUND_DIRS,
  BACKGROUND_FITS,
  BACKGROUND_RINGS,
  backgroundBlockedReason,
  backgroundBlurRadiusPx,
  backgroundComposites,
  backgroundHasMatte,
  backgroundImageUv,
  backgroundOutsideImage,
  backgroundScale,
  fitIndex,
} from './background'

const FRAME = { width: 200, height: 100 }
const IMAGE = { width: 100, height: 100 }

function bg(patch: Partial<Background> = {}): Background {
  const doc = createDoc()
  return { ...doc.background, ...patch }
}

// --- fit ----------------------------------------------------------------------

describe('fitIndex', () => {
  it('is the u_fit the shader switches on', () => {
    expect(fitIndex('cover')).toBe(0)
    expect(fitIndex('contain')).toBe(1)
    expect([...BACKGROUND_FITS]).toEqual(['cover', 'contain'])
  })
})

describe('backgroundScale', () => {
  it('grows the image until the smaller axis is full for cover', () => {
    // A 1:1 image in a 2:1 frame has to double to cover.
    expect(backgroundScale('cover', FRAME, IMAGE)).toBeCloseTo(2, 12)
  })

  it('shrinks the image until the larger axis fits for contain', () => {
    expect(backgroundScale('contain', FRAME, IMAGE)).toBeCloseTo(1, 12)
  })

  it('is the same for both fits on a matching aspect', () => {
    const square = { width: 100, height: 100 }
    expect(backgroundScale('cover', square, square)).toBeCloseTo(
      backgroundScale('contain', square, square),
      12,
    )
  })

  it('swaps which axis drives, for a portrait frame', () => {
    const frame = { width: 100, height: 200 }
    const image = { width: 400, height: 200 }
    expect(backgroundScale('cover', frame, image)).toBeCloseTo(1, 12)
    expect(backgroundScale('contain', frame, image)).toBeCloseTo(0.25, 12)
  })

  it('never returns zero for a degenerate size', () => {
    expect(
      backgroundScale('cover', { width: 0, height: 0 }, { width: 0, height: 0 }),
    ).toBeGreaterThan(0)
  })
})

describe('backgroundImageUv', () => {
  it('centres the image on the frame', () => {
    for (const fit of BACKGROUND_FITS) {
      const uv = backgroundImageUv(fit, FRAME, IMAGE, 0, 0)
      expect(uv.u).toBeCloseTo(0.5, 12)
      expect(uv.v).toBeCloseTo(0.5, 12)
    }
  })

  it('puts the same frame pixel in a different place for cover than contain', () => {
    const cover = backgroundImageUv('cover', FRAME, IMAGE, 60, 0)
    const contain = backgroundImageUv('contain', FRAME, IMAGE, 60, 0)
    expect(cover.u).not.toBeCloseTo(contain.u, 6)
    expect(cover.v).toBeCloseTo(contain.v, 12)
  })

  it('fills the frame exactly for cover and crops the overflow', () => {
    // A 1:1 image at scale 2 is 200x200 in a 200x100 frame, so the width is
    // exactly full (u hits 0 and 1 at the frame edges) and the height is
    // cropped to the middle half of the image.
    expect(backgroundImageUv('cover', FRAME, IMAGE, -100, 0).u).toBeCloseTo(0, 12)
    expect(backgroundImageUv('cover', FRAME, IMAGE, 100, 0).u).toBeCloseTo(1, 12)
    expect(backgroundImageUv('cover', FRAME, IMAGE, 0, -50).v).toBeCloseTo(0.25, 12)
    expect(backgroundImageUv('cover', FRAME, IMAGE, 0, 50).v).toBeCloseTo(0.75, 12)
  })

  it('letterboxes a 2:1 frame with a 1:1 image for contain', () => {
    const inside = backgroundImageUv('contain', FRAME, IMAGE, 0, 0)
    expect(backgroundOutsideImage(inside)).toBe(false)
    expect(backgroundOutsideImage(backgroundImageUv('contain', FRAME, IMAGE, 95, 0))).toBe(true)
    expect(backgroundOutsideImage(backgroundImageUv('cover', FRAME, IMAGE, 95, 0))).toBe(false)
  })

  it('is y-down, so the top of the frame is the top of the image', () => {
    const top = backgroundImageUv('contain', FRAME, IMAGE, 0, -40)
    const bottom = backgroundImageUv('contain', FRAME, IMAGE, 0, 40)
    expect(top.v).toBeLessThan(bottom.v)
  })
})

// --- blur ---------------------------------------------------------------------

describe('backgroundBlurRadiusPx', () => {
  it('is zero without a blur', () => {
    expect(backgroundBlurRadiusPx(0, 1)).toBe(0)
  })

  it('grows with the amount and with the render size', () => {
    expect(backgroundBlurRadiusPx(1, 1)).toBeCloseTo(12, 12)
    expect(backgroundBlurRadiusPx(1, 3)).toBeCloseTo(36, 12)
    expect(backgroundBlurRadiusPx(0.5, 1)).toBeCloseTo(6, 12)
  })

  it('clamps junk rather than sampling with a negative radius', () => {
    expect(backgroundBlurRadiusPx(Number.NaN, 1)).toBe(0)
    expect(backgroundBlurRadiusPx(-3, 1)).toBe(0)
    expect(backgroundBlurRadiusPx(4, 1)).toBeCloseTo(12, 12)
  })

  it('samples eight directions at four rings', () => {
    expect(BACKGROUND_DIRS).toHaveLength(8)
    expect(BACKGROUND_RINGS).toEqual([0.3, 0.7, 1.2, 1.8])
    for (const [dx, dy] of BACKGROUND_DIRS) expect(Math.hypot(dx, dy)).toBeCloseTo(1, 6)
  })
})

// --- the no-matte lie ---------------------------------------------------------

describe('backgroundHasMatte', () => {
  it('is false until a matte has actually been produced', () => {
    expect(backgroundHasMatte(bg({ mode: 'color' }))).toBe(false)
    expect(backgroundHasMatte(bg({ mode: 'color', removed: true }))).toBe(true)
  })

  it('reports a replacement as inert with no matte, so the panel can say so', () => {
    const noMatte = bg({ mode: 'color', color: '#ff0000' })
    expect(backgroundComposites(noMatte)).toBe(false)
    // The reason is a sentence a user reads, so it names the button that fixes
    // it and not the compositing term `src/lib/copy.ts` bans.
    expect(backgroundBlockedReason(noMatte)).toContain('Remove background')
    expect(backgroundBlockedReason(noMatte)).not.toMatch(/matte/i)
  })

  it('reports a replacement as live once a matte exists', () => {
    const matted = bg({ mode: 'color', color: '#ff0000', removed: true })
    expect(backgroundComposites(matted)).toBe(true)
    expect(backgroundBlockedReason(matted)).toBeNull()
  })

  it('never blocks the cut-out or the no-background case', () => {
    expect(backgroundBlockedReason(bg({ mode: 'none' }))).toBeNull()
    expect(backgroundComposites(bg({ mode: 'none' }))).toBe(false)
  })

  it('blocks an image background with no matte just the same', () => {
    const image = bg({ mode: 'image', removed: false })
    expect(backgroundHasMatte(image)).toBe(false)
    expect(backgroundBlockedReason(image)).toContain('Remove background')
    expect(backgroundBlockedReason(image)).not.toMatch(/matte/i)
  })
})
