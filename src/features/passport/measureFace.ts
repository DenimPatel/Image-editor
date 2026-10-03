/**
 * Cheap, on-device measurement for the ID Photobooth.
 *
 * There is no landmark model in the app: `public/models/` ships no weights and
 * the panel used to promise one anyway (D5-F13). What a passport photo always
 * has is a *plain background*, and that is enough to measure the three things
 * the compliance checklist cares about — where the crown is, where the eyes
 * are, whether anything sits behind the subject — with nothing but the pixels
 * that are already on the export canvas.
 *
 * Everything here is pure: it takes an RGBA buffer and returns numbers, so it
 * is unit-tested against synthetic images with a known head box.
 */

import { EYE_HEIGHT_IN_HEAD } from './specs'
import type { FaceLandmarks } from './autoFrame'
import type { Rgb } from './compliance'

export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number }

/** Head box in normalized photo coordinates (0..1). */
export type FaceBox = { x: number; y: number; width: number; height: number }

export type FaceMeasurement = {
  landmarks: FaceLandmarks
  box: FaceBox
  /** 0..1. Below `MIN_CONFIDENCE` the reading is not trusted. */
  confidence: number
}

export type BackgroundMeasurement = {
  /** Median colour of the photo's border, where the backdrop shows. */
  color: Rgb
  /** Fraction of border pixels within `BORDER_TOLERANCE` of that median. */
  uniformity: number
  /** True when the border reads as a flat fill rather than photo content. */
  present: boolean
}

export type PhotoMeasurement = {
  face: FaceMeasurement | null
  background: BackgroundMeasurement | null
}

/** Per-channel distance at which a pixel stops being "the backdrop". */
const SUBJECT_TOLERANCE = 42
/** Per-channel distance still counted as the same backdrop colour. */
const BORDER_TOLERANCE = 12
/** Fraction of border pixels within tolerance that counts as a plain fill. */
const PRESENT_UNIFORMITY = 0.9
const MIN_CONFIDENCE = 0.35

function channelDistance(
  data: Uint8ClampedArray,
  offset: number,
  r: number,
  g: number,
  b: number,
  tolerance: number,
): boolean {
  return (
    Math.abs(data[offset] - r) > tolerance ||
    Math.abs(data[offset + 1] - g) > tolerance ||
    Math.abs(data[offset + 2] - b) > tolerance
  )
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Measure the backdrop from a ring around the photo, where the subject's head
 * and shoulders cannot reach. Returns null for an image too small to sample.
 */
export function measureBackground(pixels: PixelBuffer): BackgroundMeasurement | null {
  const { data, width, height } = pixels
  if (width < 8 || height < 8) return null

  const margin = Math.max(1, Math.round(Math.min(width, height) * 0.06))
  const red: number[] = []
  const green: number[] = []
  const blue: number[] = []
  const samples: number[] = []

  for (let y = 0; y < height; y += 1) {
    const onRing = y < margin || y >= height - margin
    for (let x = 0; x < width; x += 1) {
      if (!onRing && x >= margin && x < width - margin) continue
      const offset = (y * width + x) * 4
      if (data[offset + 3] < 8) continue
      red.push(data[offset])
      green.push(data[offset + 1])
      blue.push(data[offset + 2])
      samples.push(offset)
    }
  }
  if (samples.length < 8) return null

  const color = { r: median(red), g: median(green), b: median(blue) }
  let uniform = 0
  for (const offset of samples) {
    if (!channelDistance(data, offset, color.r, color.g, color.b, BORDER_TOLERANCE)) uniform += 1
  }
  const uniformity = uniform / samples.length

  return { color, uniformity, present: uniformity >= PRESENT_UNIFORMITY }
}

/**
 * Find the largest contiguous region that is not the backdrop, then take the
 * part above its narrowest row as the head. That row is the neck, which is
 * what separates a head from the shoulders below it — a bbox alone reports a
 * head-and-shoulders portrait as one very tall head.
 */
export function detectFace(pixels: PixelBuffer): FaceMeasurement | null {
  const { data, width, height } = pixels
  const background = measureBackground(pixels)
  if (!background) return null

  const { r, g, b } = background.color
  const total = width * height
  const mask = new Uint8Array(total)
  const label = new Int32Array(total).fill(-1)
  let maskedPixels = 0

  for (let i = 0; i < total; i += 1) {
    const offset = i * 4
    if (data[offset + 3] < 8) continue
    if (channelDistance(data, offset, r, g, b, SUBJECT_TOLERANCE)) {
      mask[i] = 1
      maskedPixels += 1
    }
  }
  if (maskedPixels < total * 0.002) return null

  const stack = new Int32Array(total)
  let best = -1
  let bestSize = 0
  let next = 0
  for (let seed = 0; seed < total; seed += 1) {
    if (mask[seed] === 0 || label[seed] !== -1) continue
    let size = 0
    let pointer = 0
    stack[pointer++] = seed
    label[seed] = next
    while (pointer > 0) {
      const index = stack[--pointer]
      size += 1
      const x = index % width
      const y = (index - x) / width
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const neighbour = ny * width + nx
          if (mask[neighbour] === 0 || label[neighbour] !== -1) continue
          label[neighbour] = next
          stack[pointer++] = neighbour
        }
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = next
    }
    next += 1
  }
  if (best < 0) return null

  // Row widths of the winning component, used to find the neck.
  const rowWidth = new Int32Array(height)
  const rowMinX = new Int32Array(height).fill(width)
  const rowMaxX = new Int32Array(height).fill(-1)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (label[y * width + x] !== best) continue
      rowWidth[y] += 1
      if (x < rowMinX[y]) rowMinX[y] = x
      rowMaxX[y] = x
    }
  }

  let top = 0
  while (top < height && rowWidth[top] === 0) top += 1
  let bottom = height - 1
  while (bottom > top && rowWidth[bottom] === 0) bottom -= 1
  if (bottom <= top) return null

  let maxWidth = 0
  for (let y = top; y <= bottom; y += 1) maxWidth = Math.max(maxWidth, rowWidth[y])
  if (maxWidth < width * 0.05) return null

  // The neck: the narrowest row below the crown. Only rows clearly narrower
  // than the widest row count — a head with no shoulders below it is just as
  // wide at the bottom as at the cheeks, so nothing qualifies and the head runs
  // to the bottom of the blob.
  let chin = bottom
  let narrowest = Infinity
  const searchFrom = top + Math.floor((bottom - top) * 0.25)
  for (let y = searchFrom; y <= bottom; y += 1) {
    if (rowWidth[y] > 0 && rowWidth[y] < narrowest) {
      narrowest = rowWidth[y]
      chin = y
    }
  }
  if (narrowest > maxWidth * 0.85) chin = bottom

  const headHeight = chin - top
  if (headHeight < height * 0.08) return null

  let headLeft = width
  let headRight = -1
  for (let y = top; y <= chin; y += 1) {
    if (rowMinX[y] < headLeft) headLeft = rowMinX[y]
    if (rowMaxX[y] > headRight) headRight = rowMaxX[y]
  }
  if (headRight <= headLeft) return null
  const headWidth = headRight - headLeft + 1

  let headArea = 0
  for (let y = top; y <= chin; y += 1) headArea += rowWidth[y]
  const fill = Math.min(1, headArea / (headWidth * headHeight))
  const size = Math.min(1, headHeight / (height * 0.25))
  const confidence = fill * size
  if (confidence < MIN_CONFIDENCE) return null

  const centerX = (headLeft + headRight + 1) / 2 / width
  const eyeY = (chin - EYE_HEIGHT_IN_HEAD * headHeight) / height
  const landmarks: FaceLandmarks = {
    crown: { x: centerX, y: top / height },
    chin: { x: centerX, y: chin / height },
    leftEye: { x: (headLeft + headWidth * 0.275) / width, y: eyeY },
    rightEye: { x: (headLeft + headWidth * 0.725) / width, y: eyeY },
  }

  return {
    landmarks,
    box: {
      x: headLeft / width,
      y: top / height,
      width: headWidth / width,
      height: headHeight / height,
    },
    confidence,
  }
}

const SAMPLE_EDGE = 256

/**
 * Measure a rendered export canvas. The canvas is sampled through a scratch
 * canvas capped at `SAMPLE_EDGE` px on the long edge: a 600 DPI passport print
 * is 3600×3600 px, and reading that back in full would allocate ~50 MB of
 * ImageData to answer questions a 256 px thumbnail answers.
 */
export function measureCanvas(
  canvas: HTMLCanvasElement,
  scratch?: HTMLCanvasElement,
): PhotoMeasurement | null {
  const source = canvas
  if (source.width < 4 || source.height < 4) return null
  const scale = Math.min(1, SAMPLE_EDGE / Math.max(source.width, source.height))
  const target = scratch ?? document.createElement('canvas')
  target.width = Math.max(1, Math.round(source.width * scale))
  target.height = Math.max(1, Math.round(source.height * scale))
  const ctx = target.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, target.width, target.height)
  const pixels = ctx.getImageData(0, 0, target.width, target.height) as unknown as PixelBuffer
  return { face: detectFace(pixels), background: measureBackground(pixels) }
}
