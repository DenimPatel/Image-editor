import { describe, expect, it } from 'vitest'
import { mmToPx, pxToMm } from '../../lib/crop/geometry'
import { autoFrame } from './autoFrame'
import { detectFace, measureBackground, measureCanvas } from './measureFace'
import type { PixelBuffer } from './measureFace'
import { getSpec } from './specs'

const BG: [number, number, number] = [255, 255, 255]
const SKIN: [number, number, number] = [206, 168, 132]
const SHIRT: [number, number, number] = [60, 90, 160]

type Blob = { x: number; y: number; w: number; h: number; color: [number, number, number] }

function synth(width: number, height: number, blobs: Blob[]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = BG[0]
    data[i * 4 + 1] = BG[1]
    data[i * 4 + 2] = BG[2]
    data[i * 4 + 3] = 255
  }
  for (const blob of blobs) {
    const x0 = Math.max(0, Math.round(blob.x))
    const y0 = Math.max(0, Math.round(blob.y))
    for (let y = y0; y < Math.min(height, y0 + Math.round(blob.h)); y += 1) {
      for (let x = x0; x < Math.min(width, x0 + Math.round(blob.w)); x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = blob.color[0]
        data[offset + 1] = blob.color[1]
        data[offset + 2] = blob.color[2]
      }
    }
  }
  return { data, width, height }
}

/** A head box with a neck and shoulders, the shape a real portrait has. */
function portrait(width: number, height: number, head: Blob) {
  const headBottom = head.y + head.h
  return synth(width, height, [
    head,
    { x: head.x + head.w * 0.36, y: headBottom, w: head.w * 0.28, h: height * 0.06, color: SKIN },
    {
      x: head.x - head.w * 0.5,
      y: headBottom + height * 0.06,
      w: head.w * 2,
      h: height * 0.4,
      color: SHIRT,
    },
  ])
}

describe('measureBackground', () => {
  it('measures a flat white backdrop', () => {
    const pixels = synth(60, 80, [{ x: 20, y: 20, w: 20, h: 30, color: SKIN }])
    const measured = measureBackground(pixels)

    expect(measured).not.toBeNull()
    expect(measured?.uniformity).toBeGreaterThan(0.99)
    expect(measured?.present).toBe(true)
    expect(measured?.color).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('reports a busy border as no background at all', () => {
    const data = new Uint8ClampedArray(60 * 80 * 4)
    for (let i = 0; i < 60 * 80; i += 1) {
      data[i * 4] = (i * 37) % 256
      data[i * 4 + 1] = (i * 91) % 256
      data[i * 4 + 2] = (i * 13) % 256
      data[i * 4 + 3] = 255
    }
    const measured = measureBackground({ data, width: 60, height: 80 })

    expect(measured?.uniformity ?? 0).toBeLessThan(0.9)
    expect(measured?.present).toBe(false)
  })

  it('returns null for an image too small to sample', () => {
    expect(measureBackground(synth(4, 4, []))).toBeNull()
  })
})

describe('detectFace', () => {
  it('finds a known head box within a pixel of its true size', () => {
    const pixels = portrait(200, 300, { x: 70, y: 40, w: 60, h: 90, color: SKIN })
    const face = detectFace(pixels)
    if (!face) throw new Error('no face detected')

    expect(face.box.y * pixels.height).toBeCloseTo(40, 0)
    expect(face.box.x * pixels.width).toBeCloseTo(70, 0)
    expect(face.box.width * pixels.width).toBeCloseTo(60, 0)
    expect(face.box.height * pixels.height).toBeCloseTo(90, 0)
  })

  it('turns a known head box into the millimetre figure a spec is checked against', () => {
    // A us-2x2 print is 600×600 px at 300 DPI, and the head box is drawn at
    // exactly 200 px = 16.93 mm tall, the same canvas the export hands over.
    const spec = getSpec('us-2x2')
    if (!spec) throw new Error('missing us-2x2')
    const print = mmToPx(spec.heightMm, spec.dpi)
    const headPx = 200
    const pixels = portrait(print, print, { x: 210, y: 80, w: 180, h: headPx, color: SKIN })

    const face = detectFace(pixels)
    if (!face) throw new Error('no face detected')
    const headHeightMm = pxToMm(face.box.height * print, spec.dpi)

    expect(headHeightMm).toBeCloseTo(pxToMm(headPx, spec.dpi), 2)
    expect(Math.abs(headHeightMm - pxToMm(headPx, spec.dpi))).toBeLessThan(
      pxToMm(headPx, spec.dpi) * 0.01,
    )
  })

  it('places the eye line at the anthropometric fraction of the head', () => {
    const pixels = portrait(200, 300, { x: 70, y: 40, w: 60, h: 90, color: SKIN })
    const face = detectFace(pixels)
    if (!face) throw new Error('no face detected')

    const chin = face.landmarks.chin.y
    const crown = face.landmarks.crown.y
    const eye = face.landmarks.leftEye.y
    expect(face.landmarks.leftEye.x).toBeLessThan(face.landmarks.rightEye.x)
    expect((chin - eye) / (chin - crown)).toBeCloseTo(0.45, 2)
  })

  it('stops the head at the neck instead of the bottom of the shoulders', () => {
    // Without the neck the head-and-shoulders blob reads as a 300 px tall head.
    const pixels = portrait(200, 300, { x: 70, y: 40, w: 60, h: 90, color: SKIN })
    const face = detectFace(pixels)
    if (!face) throw new Error('no face detected')

    expect(face.box.height).toBeCloseTo(90 / 300, 2)
    expect(face.box.height).toBeLessThan(0.5)
  })

  it('returns null when there is nothing to measure', () => {
    expect(detectFace(synth(200, 300, []))).toBeNull()
  })

  it('returns null for a subject too small to be a head', () => {
    const pixels = synth(200, 300, [{ x: 95, y: 145, w: 10, h: 12, color: SKIN }])
    expect(detectFace(pixels)).toBeNull()
  })

  it('feeds autoFrame a head it can frame without clipping the crown', () => {
    const pixels = portrait(200, 300, { x: 70, y: 40, w: 60, h: 90, color: SKIN })
    const face = detectFace(pixels)
    if (!face) throw new Error('no face detected')
    const spec = getSpec('us-2x2')
    if (!spec) throw new Error('missing us-2x2')

    const result = autoFrame(face.landmarks, spec, { width: 200, height: 300 })

    expect(face.landmarks.crown.y * 300).toBeGreaterThanOrEqual(result.crop.y * 300 - 1e-9)
    expect(result.crownClearanceMm).toBeGreaterThanOrEqual(0)
  })
})

describe('measureCanvas', () => {
  it('samples a canvas through the scratch canvas and measures both', () => {
    const pixels = portrait(200, 300, { x: 70, y: 40, w: 60, h: 90, color: SKIN })
    const drawn: Array<[number, number, number, number]> = []
    const scratch = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (_source: unknown, x: number, y: number, w: number, h: number) =>
          drawn.push([x, y, w, h]),
        getImageData: () => pixels,
      }),
    }
    const canvas = { width: 600, height: 900 } as unknown as HTMLCanvasElement

    const measured = measureCanvas(canvas, scratch as unknown as HTMLCanvasElement)

    expect(drawn).toEqual([[0, 0, 171, 256]])
    expect(measured?.face).not.toBeNull()
    expect(measured?.background?.present).toBe(true)
  })

  it('returns null for a canvas with no pixels', () => {
    expect(measureCanvas({ width: 2, height: 2 } as unknown as HTMLCanvasElement)).toBeNull()
  })
})
