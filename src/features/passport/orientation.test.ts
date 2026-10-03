import { describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc } from '../../model/types'
import { orientedFrame, specFrameMm, transposedRect } from './orientation'
import { getSpec } from './specs'

const found = getSpec('uk-35x45')
if (!found) throw new Error('missing uk-35x45')
const UK = found
const US = getSpec('us-2x2')
if (!US) throw new Error('missing us-2x2')

function docWith(crop: Doc['geometry']['crop']): Doc {
  const base = createDoc()
  const aspect = UK.widthMm / UK.heightMm
  return {
    ...base,
    source: { assetId: 'a', width: 3000, height: 2000, name: 'p.jpg', mime: 'image/jpeg' },
    geometry: { ...base.geometry, crop, aspectLock: aspect },
  }
}

describe('specFrameMm', () => {
  it('keeps portrait as published and transposes for landscape', () => {
    expect(specFrameMm(UK, 'portrait')).toEqual({ widthMm: 35, heightMm: 45 })
    expect(specFrameMm(UK, 'landscape')).toEqual({ widthMm: 45, heightMm: 35 })
  })

  it('leaves a square spec square', () => {
    expect(specFrameMm(US, 'landscape')).toEqual({ widthMm: 50.8, heightMm: 50.8 })
  })
})

describe('transposedRect', () => {
  it('swaps the axes and keeps the same area', () => {
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.6 }
    const flipped = transposedRect(rect)

    expect(flipped).toEqual({ x: 0.2, y: 0.1, width: 0.6, height: 0.3 })
    expect(flipped.width * flipped.height).toBeCloseTo(rect.width * rect.height, 12)
    // Transposing twice is the identity.
    expect(transposedRect(flipped)).toEqual(rect)
  })
})

describe('orientedFrame', () => {
  it('writes the transposed physical size and inverts the aspect lock', () => {
    const framed = orientedFrame(docWith({ x: 0, y: 0, width: 1, height: 1 }), UK, 'landscape')

    expect(framed.output.resize).toEqual({
      mode: 'physical',
      widthMm: 45,
      heightMm: 35,
      dpi: UK.dpi,
    })
    expect(framed.geometry.aspectLock).toBeCloseTo(45 / 35, 6)
  })

  it('transposes the crop and keeps it inside the frame', () => {
    const framed = orientedFrame(
      docWith({ x: 0.1, y: 0.2, width: 0.5, height: 0.5 }),
      UK,
      'landscape',
    )
    const crop = framed.geometry.crop

    expect(crop.x).toBeGreaterThanOrEqual(0)
    expect(crop.y).toBeGreaterThanOrEqual(0)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1 + 1e-9)
    expect(crop.y + crop.height).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('gives the landscape crop the pixel aspect of a 45×35 mm print', () => {
    const source = { width: 3000, height: 2000 }
    const framed = orientedFrame(docWith({ x: 0, y: 0, width: 1, height: 1 }), UK, 'landscape')
    const crop = framed.geometry.crop
    const pixelAspect = (crop.width * source.width) / (crop.height * source.height)

    expect(pixelAspect).toBeCloseTo(45 / 35, 2)
  })

  it('round-trips back to the portrait frame', () => {
    const doc = docWith({ x: 0.2, y: 0.2, width: 0.6, height: 0.6 })
    const landscape = orientedFrame(doc, UK, 'landscape')
    const back = orientedFrame(
      { ...doc, geometry: landscape.geometry, output: landscape.output },
      UK,
      'portrait',
    )

    expect(back.output.resize).toEqual({
      mode: 'physical',
      widthMm: 35,
      heightMm: 45,
      dpi: UK.dpi,
    })
    expect(back.geometry.aspectLock).toBeCloseTo(35 / 45, 6)
  })
})
