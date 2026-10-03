import { describe, expect, it } from 'vitest'
import { createDoc } from '../../model/defaults'
import type { Doc } from '../../model/types'
import { cropPixelReadout, straightenedFrameSize } from './readout'
import { ASPECT_PRESETS } from './presets'

function docWith(source: { width: number; height: number }): Doc {
  return createDoc({
    source: {
      assetId: 'a',
      width: source.width,
      height: source.height,
      name: 'x',
      mime: 'image/jpeg',
    },
  })
}

describe('cropPixelReadout', () => {
  it('D5-F09: reports the crop in source pixels, not the post-resize output', () => {
    const doc = docWith({ width: 1600, height: 900 })
    doc.output.resize = { mode: 'width', width: 640 }
    const readout = cropPixelReadout(doc)
    expect(readout.width).toBe(1600)
    expect(readout.height).toBe(900)
    expect(readout.pixels).toBe('1600 × 900 px')
    // The export is a different number, and it is reported separately.
    expect(readout.output).toBe('640 × 360 px')
  })

  it('D5-F09: a passport spec no longer reports half the export', () => {
    const doc = docWith({ width: 1600, height: 900 })
    doc.output.dpi = 300
    doc.output.resize = { mode: 'physical', widthMm: 50.8, heightMm: 50.8, dpi: 300 }
    doc.geometry.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    const readout = cropPixelReadout(doc)
    // 1600 * 0.5 x 900 * 0.5, not 0.5 of the 600 x 600 output.
    expect(readout.width).toBe(800)
    expect(readout.height).toBe(450)
    expect(readout.output).toBe('600 × 600 px')
  })

  it('is unaffected by every resize mode', () => {
    const sizes: Doc['output']['resize'][] = [
      { mode: 'none' },
      { mode: 'width', width: 640 },
      { mode: 'height', height: 200 },
      { mode: 'longEdge', longEdge: 100 },
      { mode: 'percent', percent: 12 },
      { mode: 'physical', widthMm: 25.4, heightMm: 12.7, dpi: 300 },
    ]
    for (const resize of sizes) {
      const doc = docWith({ width: 1600, height: 900 })
      doc.output.resize = resize
      expect(cropPixelReadout(doc).pixels).toBe('1600 × 900 px')
    }
  })

  it('tracks the crop box', () => {
    const doc = docWith({ width: 2000, height: 1000 })
    doc.geometry.crop = { x: 0.25, y: 0, width: 0.5, height: 0.5 }
    const readout = cropPixelReadout(doc)
    expect(readout.width).toBe(1000)
    expect(readout.height).toBe(500)
    expect(readout.pixelAspect).toBeCloseTo(2, 9)
    expect(readout.ratio).toBe('2:1')
  })

  it('names the common ratios and falls back to a decimal for the rest', () => {
    const doc = docWith({ width: 1600, height: 900 })
    expect(cropPixelReadout(doc).ratio).toBe('16:9')
    const odd = docWith({ width: 1000, height: 780 })
    expect(cropPixelReadout(odd).ratio).toBe('1.28:1')
  })

  it('names every ratio the crop panel offers, including 5:7', () => {
    // This file kept a private `SIMPLE_RATIOS` that was missing `5:7`, so a 5:7
    // crop lit the `5:7` chip in the panel and printed `0.71:1` on the canvas.
    // It is not enough for the two lists to agree where they overlap — the panel
    // offers nine generic ratios and every one of them has to be nameable, so
    // this walks the panel's own table rather than a hand-kept copy of it.
    for (const preset of ASPECT_PRESETS) {
      if (preset.aspect === null) continue
      // Measured in whole source pixels, which is how the panel measures it too:
      // a 16:9 lock on 3000x2000 comes back as 3000/1688, not as 16/9. The
      // source is square and the crop is a fraction of it, so the measured ratio
      // is the preset's and the rounding to whole pixels is the only error in it.
      const side = 7000
      const doc = docWith({ width: side, height: side })
      doc.geometry.aspectLock = preset.aspect
      doc.geometry.crop = { x: 0, y: 0, width: 1, height: 1 / preset.aspect }
      expect(cropPixelReadout(doc).ratio, preset.id).toBe(preset.label)
    }
  })

  it('reports the straighten angle only when there is one', () => {
    const doc = docWith({ width: 1600, height: 900 })
    expect(cropPixelReadout(doc).angle).toBeNull()
    doc.geometry.straighten = 12.34
    expect(cropPixelReadout(doc).angle).toBe('12.3°')
  })

  it('reports the print size at the document DPI', () => {
    const doc = docWith({ width: 300, height: 150 })
    doc.output.dpi = 300
    const readout = cropPixelReadout(doc)
    expect(readout.print).toBe(`${(300 / 300) * 25.4} × ${(150 / 300) * 25.4} mm`)
  })

  it('survives a document with no source', () => {
    const doc = createDoc({})
    const readout = cropPixelReadout(doc)
    expect(readout.width).toBe(1)
    expect(readout.height).toBe(1)
  })
})

describe('straightenedFrameSize', () => {
  it('is the rotation bounding box, and swaps on a quarter turn', () => {
    const doc = docWith({ width: 1000, height: 800 })
    doc.geometry.straighten = 20
    expect(straightenedFrameSize(doc)).toEqual({ width: 1213, height: 1094 })
    doc.geometry.orientation.quarterTurns = 1
    expect(straightenedFrameSize(doc)).toEqual({ width: 1094, height: 1213 })
  })
})
