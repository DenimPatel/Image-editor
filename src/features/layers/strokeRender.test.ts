import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDoc } from '../../model/defaults'
import type {
  Doc,
  DrawLayer,
  FrameStyle,
  Layer,
  NormRect,
  RedactLayer,
  ShapeLayer,
  StickerLayer,
  TextLayer,
  WatermarkLayer,
} from '../../model/types'
import { clearLayerSurfaceCache, drawLayers } from '../../render/layers'
import { uploadedStickerLayer } from './stickers'
import {
  createDrawLayer,
  createFrameLayer,
  createRedactLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  createWatermarkLayer,
} from './factory'

/* ------------------------------------------------------------------ *
 * A recording 2D context with real pixels.
 *
 * Every drawing call is recorded, `globalAlpha`/`globalCompositeOperation`/
 * `filter`/`letterSpacing` assignments are tracked, `measureText` scales with
 * the string, and `fillRect`/`drawImage` really write pixels so a redaction
 * can be measured rather than merely counted.
 * ------------------------------------------------------------------ */

type Call = { method: string; args: unknown[] }
type Assignment = { prop: string; value: unknown }

type FakeImageData = { data: Uint8ClampedArray; width: number; height: number }

type FakeCanvas = {
  width: number
  height: number
  /** Live view of the context's pixel buffer, as a real canvas would expose. */
  pixels: Uint8ClampedArray
  getContext: (type: string) => FakeCtx | null
}

const SIZE = { width: 200, height: 100 }

function parseColour(value: string): [number, number, number, number] {
  const hex = value.trim().replace('#', '')
  if (/^[0-9a-f]{3,8}$/i.test(hex)) {
    const part = (index: number, size: number) => {
      const slice = hex.slice(index * size, index * size + size)
      return parseInt(size === 1 ? slice + slice : slice, 16)
    }
    if (hex.length === 3 || hex.length === 4) {
      return [part(0, 1), part(1, 1), part(2, 1), hex.length === 4 ? part(3, 1) : 255]
    }
    return [part(0, 2), part(1, 2), part(2, 2), hex.length >= 8 ? part(3, 2) : 255]
  }
  const numbers = (value.match(/[\d.]+/g) ?? []).map(Number)
  if (numbers.length >= 3)
    return [numbers[0], numbers[1], numbers[2], numbers.length > 3 ? numbers[3] * 255 : 255]
  return [0, 0, 0, 255]
}

function compositePixel(
  pixels: Uint8ClampedArray,
  index: number,
  colour: [number, number, number, number],
  alpha: number,
  op: GlobalCompositeOperation,
): void {
  if (op === 'destination-out') {
    pixels[index + 3] = pixels[index + 3] * (1 - alpha * (colour[3] / 255))
    return
  }
  const sourceAlpha = (alpha * colour[3]) / 255
  const destAlpha = pixels[index + 3] / 255
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha)
  if (outAlpha <= 0) {
    pixels[index] = 0
    pixels[index + 1] = 0
    pixels[index + 2] = 0
    pixels[index + 3] = 0
    return
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const s = colour[channel] / 255
    const d = pixels[index + channel] / 255
    let out = s
    if (op === 'multiply') out = s * d
    else if (op === 'screen') out = 1 - (1 - s) * (1 - d)
    else if (op === 'lighten') out = Math.max(s, d)
    else if (op === 'darken') out = Math.min(s, d)
    else if (op === 'overlay') out = d < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)
    else if (op === 'soft-light' || op === 'hard-light') {
      const blended =
        op === 'hard-light'
          ? s < 0.5
            ? 2 * s * d
            : 1 - 2 * (1 - s) * (1 - d)
          : d + (2 * s - 1) * (d * (1 - d))
      out = d + (blended - d) * 0.5
    }
    pixels[index + channel] =
      (255 * (out * sourceAlpha + d * destAlpha * (1 - sourceAlpha))) / outAlpha
  }
  pixels[index + 3] = 255 * outAlpha
}

/** Separable box blur, an honest stand-in for the browser's blur filter. */
function boxBlur(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const temp = new Uint8ClampedArray(source.length)
  const out = new Uint8ClampedArray(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0
        let count = 0
        for (let k = -radius; k <= radius; k += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + k))
          sum += source[(y * width + sx) * 4 + c]
          count += 1
        }
        temp[(y * width + x) * 4 + c] = sum / count
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < 4; c += 1) {
        let sum = 0
        let count = 0
        for (let k = -radius; k <= radius; k += 1) {
          const sy = Math.max(0, Math.min(height - 1, y + k))
          sum += temp[(sy * width + x) * 4 + c]
          count += 1
        }
        out[(y * width + x) * 4 + c] = sum / count
      }
    }
  }
  return out
}

class FakeCtx {
  canvas!: FakeCanvas
  calls: Call[] = []
  assignments: Assignment[] = []
  pixels: Uint8ClampedArray
  textDrawn: { text: string; x: number; y: number; letterSpacing: string; width: number }[] = []
  strokeLineWidths: number[] = []
  strokeShadows: number[] = []
  /** The fill colour in force at each paint call, in order. */
  fillColours: string[] = []
  throwsOnRead = false
  filterSupported: boolean
  letterSpacingSupported: boolean
  private stack: Record<string, unknown>[] = []
  private tracked = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    filter: 'none',
    letterSpacing: '0px',
  }
  fillStyle = '#000000'
  strokeStyle = '#000000'
  lineWidth = 1
  font = '10px sans-serif'
  textAlign: CanvasTextAlign = 'start'
  textBaseline: CanvasTextBaseline = 'alphabetic'
  lineCap: CanvasLineCap = 'butt'
  lineJoin: CanvasLineJoin = 'miter'
  imageSmoothingEnabled = true
  shadowColor = 'rgba(0, 0, 0, 0)'
  shadowBlur = 0
  shadowOffsetX = 0
  shadowOffsetY = 0

  constructor(
    width: number,
    height: number,
    options: { filter?: boolean; letterSpacing?: boolean } = {},
  ) {
    this.pixels = new Uint8ClampedArray(Math.max(1, width * height * 4))
    this.filterSupported = options.filter !== false
    this.letterSpacingSupported = options.letterSpacing !== false
  }

  get globalAlpha(): number {
    return this.tracked.globalAlpha
  }
  set globalAlpha(value: number) {
    this.tracked.globalAlpha = value
    this.assignments.push({ prop: 'globalAlpha', value })
  }
  get globalCompositeOperation(): GlobalCompositeOperation {
    return this.tracked.globalCompositeOperation
  }
  set globalCompositeOperation(value: GlobalCompositeOperation) {
    this.tracked.globalCompositeOperation = value
    this.assignments.push({ prop: 'globalCompositeOperation', value })
  }
  /** `undefined` when the "browser" does not support it, exactly like a real one. */
  get filter(): string | undefined {
    return this.filterSupported ? this.tracked.filter : undefined
  }
  set filter(value: string) {
    if (!this.filterSupported) return
    this.tracked.filter = value
    this.assignments.push({ prop: 'filter', value })
  }
  get letterSpacing(): string | undefined {
    return this.letterSpacingSupported ? this.tracked.letterSpacing : undefined
  }
  set letterSpacing(value: string) {
    if (!this.letterSpacingSupported) return
    this.tracked.letterSpacing = value
    this.assignments.push({ prop: 'letterSpacing', value })
  }

  attach(canvas: FakeCanvas): void {
    this.canvas = canvas
  }

  /** A real 2D context follows its canvas size; so does this one. */
  resize(width: number, height: number): void {
    const next = new Uint8ClampedArray(Math.max(1, Math.round(width) * Math.round(height) * 4))
    next.set(this.pixels.subarray(0, Math.min(next.length, this.pixels.length)))
    this.pixels = next
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args })
  }

  snapshot(): Record<string, unknown> {
    return {
      tracked: { ...this.tracked },
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      imageSmoothingEnabled: this.imageSmoothingEnabled,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
    }
  }

  save(): void {
    this.record('save')
    this.stack.push(this.snapshot())
  }

  restore(): void {
    this.record('restore')
    const state = this.stack.pop()
    if (!state) return
    this.tracked = { ...(state.tracked as typeof this.tracked) }
    this.fillStyle = state.fillStyle as string
    this.strokeStyle = state.strokeStyle as string
    this.lineWidth = state.lineWidth as number
    this.font = state.font as string
    this.textAlign = state.textAlign as CanvasTextAlign
    this.textBaseline = state.textBaseline as CanvasTextBaseline
    this.lineCap = state.lineCap as CanvasLineCap
    this.lineJoin = state.lineJoin as CanvasLineJoin
    this.imageSmoothingEnabled = state.imageSmoothingEnabled as boolean
    this.shadowColor = state.shadowColor as string
    this.shadowBlur = state.shadowBlur as number
  }

  translate(x: number, y: number): void {
    this.record('translate', x, y)
  }
  rotate(angle: number): void {
    this.record('rotate', angle)
  }
  scale(x: number, y: number): void {
    this.record('scale', x, y)
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.record('setTransform', a, b, c, d, e, f)
  }
  beginPath(): void {
    this.record('beginPath')
  }
  closePath(): void {
    this.record('closePath')
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', x, y)
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', x, y)
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this.record('arcTo', x1, y1, x2, y2, r)
  }
  ellipse(...args: number[]): void {
    this.record('ellipse', ...args)
  }
  rect(...args: number[]): void {
    this.record('rect', ...args)
  }
  clip(): void {
    this.record('clip')
  }
  fill(path?: unknown): void {
    this.record('fill', ...(path === undefined ? [] : [path]))
    this.fillColours.push(this.fillStyle)
  }
  stroke(): void {
    this.record('stroke', this.lineWidth)
    this.strokeLineWidths.push(this.lineWidth)
    this.strokeShadows.push(this.shadowBlur)
  }
  strokeRect(...args: number[]): void {
    this.record('strokeRect', ...args)
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.record('fillRect', x, y, width, height)
    this.fillColours.push(this.fillStyle)
    const colour = parseColour(this.fillStyle)
    for (let py = Math.floor(y); py < y + height; py += 1) {
      for (let px = Math.floor(x); px < x + width; px += 1) {
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue
        compositePixel(
          this.pixels,
          (py * this.canvas.width + px) * 4,
          colour,
          this.tracked.globalAlpha,
          this.tracked.globalCompositeOperation,
        )
      }
    }
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.record('clearRect', x, y, width, height)
    for (let py = Math.floor(y); py < y + height; py += 1) {
      for (let px = Math.floor(x); px < x + width; px += 1) {
        if (px < 0 || py < 0 || px >= this.canvas.width || py >= this.canvas.height) continue
        const index = (py * this.canvas.width + px) * 4
        this.pixels[index] = 0
        this.pixels[index + 1] = 0
        this.pixels[index + 2] = 0
        this.pixels[index + 3] = 0
      }
    }
  }
  fillText(text: string, x: number, y: number): void {
    this.record('fillText', text, x, y)
    this.textDrawn.push({
      text,
      x,
      y,
      letterSpacing: this.tracked.letterSpacing,
      // Measured while tracking is still in effect, which is the only moment
      // the value is observable.
      width: this.measureText(text).width,
    })
  }
  strokeText(text: string, x: number, y: number): void {
    this.record('strokeText', text, x, y)
  }
  measureText(text: string): { width: number } {
    const match = /(\d+(?:\.\d+)?)px/.exec(this.font)
    const em = match ? Number(match[1]) : 10
    const spacing = Number.parseFloat(this.tracked.letterSpacing) || 0
    // Deliberately string-dependent: a constant width made the pill, the arc
    // layout and the tracking test untestable.
    return { width: text.length * (em * 0.5 + spacing) }
  }
  createImageBitmap(image: unknown): { source: unknown } {
    this.record('createImageBitmap', image)
    return { source: image }
  }

  getImageData(x: number, y: number, width: number, height: number): FakeImageData {
    this.record('getImageData', x, y, width, height)
    if (this.throwsOnRead) throw new Error('SecurityError: tainted canvas')
    const data = new Uint8ClampedArray(Math.max(0, width * height * 4))
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sourceX = x + px
        const sourceY = y + py
        if (
          sourceX < 0 ||
          sourceY < 0 ||
          sourceX >= this.canvas.width ||
          sourceY >= this.canvas.height
        )
          continue
        for (let c = 0; c < 4; c += 1) {
          data[(py * width + px) * 4 + c] =
            this.pixels[(sourceY * this.canvas.width + sourceX) * 4 + c]
        }
      }
    }
    return { data, width, height }
  }

  putImageData(image: FakeImageData, dx: number, dy: number): void {
    this.record('putImageData', image, dx, dy)
    for (let py = 0; py < image.height; py += 1) {
      for (let px = 0; px < image.width; px += 1) {
        const targetX = dx + px
        const targetY = dy + py
        if (
          targetX < 0 ||
          targetY < 0 ||
          targetX >= this.canvas.width ||
          targetY >= this.canvas.height
        )
          continue
        for (let c = 0; c < 4; c += 1) {
          this.pixels[(targetY * this.canvas.width + targetX) * 4 + c] =
            image.data[(py * image.width + px) * 4 + c]
        }
      }
    }
  }

  drawImage(image: unknown, ...args: number[]): void {
    this.record('drawImage', image, ...args)
    const source = (image as { pixels?: Uint8ClampedArray })?.pixels
    if (!source) return
    const sourceWidth = (image as { width: number }).width
    const sourceHeight = (image as { height: number }).height
    let [sx, sy, sw, sh, dx, dy, dw, dh] = [
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight,
    ]
    if (args.length === 2) [dx, dy] = args
    else if (args.length === 4) [dx, dy, dw, dh] = args
    else if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args
    const width = Math.max(1, Math.round(dw))
    const height = Math.max(1, Math.round(dh))
    // Per the HTML spec the source rect is clipped to the source image, and a
    // rect entirely outside it draws nothing. The old blur path sourced from
    // (image.width, image.height) on an image.width x image.height canvas,
    // which is exactly that case.
    const fromX = Math.max(sx, 0)
    const fromY = Math.max(sy, 0)
    const toX = Math.min(sx + sw, sourceWidth)
    const toY = Math.min(sy + sh, sourceHeight)
    if (toX <= fromX || toY <= fromY) return
    const sampled = new Uint8ClampedArray(width * height * 4)
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const ux = sx + Math.min(sw - 1, Math.floor((px / width) * sw))
        const uy = sy + Math.min(sh - 1, Math.floor((py / height) * sh))
        if (ux < fromX || uy < fromY || ux >= toX || uy >= toY) continue
        for (let c = 0; c < 4; c += 1) {
          sampled[(py * width + px) * 4 + c] = source[(uy * sourceWidth + ux) * 4 + c] ?? 0
        }
      }
    }
    const blurMatch = /^blur\(([\d.]+)px\)$/.exec(this.tracked.filter)
    const patch = blurMatch
      ? boxBlur(sampled, width, height, Math.max(1, Math.ceil(Number(blurMatch[1]) / 2)))
      : sampled
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const targetX = Math.round(dx) + px
        const targetY = Math.round(dy) + py
        if (
          targetX < 0 ||
          targetY < 0 ||
          targetX >= this.canvas.width ||
          targetY >= this.canvas.height
        )
          continue
        compositePixel(
          this.pixels,
          (targetY * this.canvas.width + targetX) * 4,
          [
            patch[(py * width + px) * 4],
            patch[(py * width + px) * 4 + 1],
            patch[(py * width + px) * 4 + 2],
            patch[(py * width + px) * 4 + 3],
          ],
          this.tracked.globalAlpha,
          this.tracked.globalCompositeOperation,
        )
      }
    }
  }
}

function makeCanvas(width: number, height: number, ctx: FakeCtx): FakeCanvas {
  let currentWidth = width
  let currentHeight = height
  const canvas: FakeCanvas = {
    get width() {
      return currentWidth
    },
    set width(value: number) {
      currentWidth = value
      ctx.resize(currentWidth, currentHeight)
    },
    get height() {
      return currentHeight
    },
    set height(value: number) {
      currentHeight = value
      ctx.resize(currentWidth, currentHeight)
    },
    getContext: (type: string) => (type === '2d' ? ctx : null),
    get pixels() {
      return ctx.pixels
    },
  }
  ctx.attach(canvas as FakeCanvas)
  return canvas
}

export type Harness = {
  ctx: FakeCtx
  canvas: FakeCanvas
  calls: Call[]
  /** Number of canvases the compositor allocated through `document.createElement`. */
  allocations: () => number
}

let allocations = 0
let createSpy: ReturnType<typeof vi.spyOn>

function harness(options: { filter?: boolean; letterSpacing?: boolean } = {}): Harness {
  const ctx = new FakeCtx(SIZE.width, SIZE.height, options)
  const canvas = makeCanvas(SIZE.width, SIZE.height, ctx)
  return {
    ctx,
    canvas,
    calls: ctx.calls,
    allocations: () => allocations,
  }
}

function docWith(...layers: Layer[]): Doc {
  const doc = createDoc()
  doc.layers.push(...layers)
  return doc
}

function compose(h: Harness, doc: Doc, size = SIZE): void {
  drawLayers(h.ctx as unknown as CanvasRenderingContext2D, doc, {
    size,
    assets: { get: () => undefined },
  })
}

function methods(ctx: FakeCtx, method: string): Call[] {
  return ctx.calls.filter((call) => call.method === method)
}

function lumaVariance(ctx: FakeCtx, rect: NormRect): number {
  const x0 = Math.round(rect.x * ctx.canvas.width)
  const y0 = Math.round(rect.y * ctx.canvas.height)
  const x1 = Math.round((rect.x + rect.width) * ctx.canvas.width)
  const y1 = Math.round((rect.y + rect.height) * ctx.canvas.height)
  const values: number[] = []
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * ctx.canvas.width + x) * 4
      values.push(
        0.299 * ctx.pixels[index] + 0.587 * ctx.pixels[index + 1] + 0.114 * ctx.pixels[index + 2],
      )
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
}

function pixelAt(ctx: FakeCtx, x: number, y: number): [number, number, number, number] {
  const index = (y * ctx.canvas.width + x) * 4
  return [ctx.pixels[index], ctx.pixels[index + 1], ctx.pixels[index + 2], ctx.pixels[index + 3]]
}

/** Paint a hard vertical edge: nothing about a blur may leave it untouched. */
function paintHardEdge(ctx: FakeCtx): void {
  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, ctx.canvas.width / 2, ctx.canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(ctx.canvas.width / 2, 0, ctx.canvas.width / 2, ctx.canvas.height)
  ctx.restore()
  ctx.calls.length = 0
}

/**
 * Paint the highest-frequency content a canvas can hold: a 2px checkerboard.
 * Any blur flattens it to its mean, so if the variance survives the redaction
 * then the original pixels are still on screen (and in the export).
 */
function paintCheckerboard(ctx: FakeCtx): void {
  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = '#ffffff'
  for (let y = 0; y < ctx.canvas.height; y += 2) {
    for (let x = 2; x < ctx.canvas.width; x += 4) ctx.fillRect(x, y, 2, 2)
  }
  ctx.restore()
  ctx.calls.length = 0
}

beforeEach(() => {
  allocations = 0
  clearLayerSurfaceCache()
  // jsdom ships no Path2D; the browser always has one.
  vi.stubGlobal(
    'Path2D',
    class {
      constructor(public d: string) {}
    },
  )
  createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`)
    allocations += 1
    const ctx = new FakeCtx(1, 1)
    return makeCanvas(1, 1, ctx) as unknown as HTMLElement
  })
})

afterEach(() => {
  createSpy.mockRestore()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ *
 * Baseline (the three cases that used to be the entire suite)
 * ------------------------------------------------------------------ */

function drawLayer(): DrawLayer {
  return {
    id: 'd1',
    kind: 'draw',
    name: 'd',
    visible: true,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
    brush: 'pen',
    color: '#ff0000',
    size: 2,
    strokes: [
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        radius: 2,
        hardness: 1,
      },
    ],
  }
}

describe('drawLayers', () => {
  it('does nothing without layers', () => {
    const h = harness()
    compose(h, createDoc())
    expect(h.calls).toHaveLength(0)
  })

  it('renders a stroke with normalized coordinates scaled to the output', () => {
    const h = harness()
    compose(h, docWith(drawLayer()))
    const move = h.calls.find((call) => call.method === 'moveTo')
    const line = h.calls.find((call) => call.method === 'lineTo')
    expect(move?.args).toEqual([0, 0])
    expect(line?.args).toEqual([200, 100])
    expect(h.calls.some((call) => call.method === 'stroke')).toBe(true)
  })

  it('skips hidden layers', () => {
    const h = harness()
    const layer = drawLayer()
    layer.visible = false
    compose(h, docWith(layer))
    expect(h.calls).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

function textLayer(patch: Partial<TextLayer['style']> = {}): TextLayer {
  const layer = createTextLayer('Hello')
  layer.transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' }
  layer.style = { ...layer.style, ...patch }
  return layer
}

describe('drawLayers · text', () => {
  it('applies the shared transform, then draws each line', () => {
    const h = harness()
    const layer = textLayer()
    layer.transform = { x: 0.5, y: 0.5, scale: 2, rotation: 90, opacity: 0.5, blend: 'multiply' }
    layer.text = 'One\nTwo'
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'translate')[0].args).toEqual([100, 50])
    expect(methods(h.ctx, 'rotate')[0].args).toEqual([Math.PI / 2])
    expect(methods(h.ctx, 'scale')[0].args).toEqual([2, 2])
    expect(h.ctx.textDrawn.map((entry) => entry.text)).toEqual(['One', 'Two'])
  })

  it('measures text per string, so the pill tracks the line', () => {
    const h = harness()
    compose(h, docWith(textLayer({ pillBackground: '#123456' })))
    expect(methods(h.ctx, 'fill')).toHaveLength(1)
    expect(methods(h.ctx, 'fill')[0].args).toHaveLength(0)
    expect(h.ctx.measureText('WIDE').width).toBeGreaterThan(h.ctx.measureText('i').width)
  })

  it('writes tracking into ctx.letterSpacing and widens the measured line', () => {
    const loose = harness()
    const looseLayer = textLayer({ tracking: 10, size: 40 })
    compose(loose, docWith(looseLayer))
    // The value is restored by the layer's save/restore, so read it while the
    // glyphs were being painted.
    expect(loose.ctx.textDrawn[0].letterSpacing).toBe('4px')
    expect(
      loose.ctx.assignments.some(
        (entry) => entry.prop === 'letterSpacing' && entry.value === '4px',
      ),
    ).toBe(true)

    const tight = harness()
    compose(tight, docWith(textLayer({ tracking: 0, size: 40 })))
    expect(tight.ctx.textDrawn[0].letterSpacing).toBe('0px')
    expect(loose.ctx.textDrawn[0].width).toBeGreaterThan(tight.ctx.textDrawn[0].width)
  })

  it('lays glyphs along a curve when arc is set', () => {
    const curved = harness()
    const curvedLayer = textLayer({ arc: 50, size: 20 })
    curvedLayer.text = 'ABC'
    compose(curved, docWith(curvedLayer))
    const flat = harness()
    const flatLayer = textLayer({ arc: 0, size: 20 })
    flatLayer.text = 'ABC'
    compose(flat, docWith(flatLayer))

    // One fillText per glyph, each placed by its own translate.
    expect(curved.ctx.textDrawn.map((entry) => entry.text)).toEqual(['A', 'B', 'C'])
    expect(flat.ctx.textDrawn.map((entry) => entry.text)).toEqual(['ABC'])
    // The first translate is the layer transform; the rest place the glyphs.
    const placed = methods(curved.ctx, 'translate').slice(1)
    const flatPlaced = methods(flat.ctx, 'translate').slice(1)
    expect(placed).toHaveLength(3)
    expect(flatPlaced).toHaveLength(0)
    const xs = placed.map((call) => call.args[0] as number)
    expect(new Set(xs).size).toBe(3)
    // Positive arc bows the ends downward, so the middle sits highest.
    const ys = placed.map((call) => call.args[1] as number)
    expect(ys[1]).toBeLessThan(ys[0])
    expect(ys[1]).toBeLessThan(ys[2])
  })

  it('rotates each glyph to the curve tangent', () => {
    const h = harness()
    const layer = textLayer({ arc: 100, size: 20 })
    layer.text = 'ABC'
    compose(h, docWith(layer))
    const rotations = methods(h.ctx, 'rotate').map((call) => call.args[0] as number)
    expect(rotations.length).toBeGreaterThanOrEqual(3)
    expect(new Set(rotations.map((value) => value.toFixed(4))).size).toBe(3)
  })

  it('honours stroke and shadow', () => {
    const h = harness()
    compose(h, docWith(textLayer({ strokeWidth: 5, shadow: true })))
    expect(methods(h.ctx, 'strokeText')).toHaveLength(1)
    expect(h.ctx.assignments.some((entry) => entry.prop === 'globalAlpha')).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

describe('drawLayers · shapes', () => {
  it('fills a rect centred on the transform origin', () => {
    const h = harness()
    const layer = createShapeLayer('rect')
    layer.width = 0.5
    layer.height = 0.25
    layer.fill = '#ff8800'
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'fillRect')[0].args).toEqual([-50, -12.5, 100, 25])
  })

  it('sizes an ellipse from the layer width and height', () => {
    const h = harness()
    const layer = createShapeLayer('ellipse')
    layer.width = 0.5
    layer.height = 0.25
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'ellipse')[0].args).toEqual([0, 0, 50, 12.5, 0, 0, Math.PI * 2])
  })

  it('draws a line as a single segment and an arrow with a head', () => {
    const line = harness()
    compose(line, docWith(createShapeLayer('line')))
    const arrow = harness()
    compose(arrow, docWith(createShapeLayer('arrow')))
    expect(methods(arrow.ctx, 'stroke').length).toBeGreaterThan(methods(line.ctx, 'stroke').length)
    expect(methods(line.ctx, 'stroke')).toHaveLength(1)
  })

  it('paints the fill colour for every shape, line and arrow included (D6-F12)', () => {
    // The defect: `line` and `arrow` were stroked polylines with no `fill()`
    // call at all, so the shape inspector's Fill control did nothing for two of
    // the four shapes the panel offers.
    for (const shape of ['rect', 'ellipse', 'line', 'arrow'] as const) {
      const h = harness()
      const layer = createShapeLayer(shape)
      layer.fill = '#ff8800'
      compose(h, docWith(layer))
      const painted = methods(h.ctx, 'fill').length + methods(h.ctx, 'fillRect').length
      expect(painted, `${shape} was not filled`).toBeGreaterThan(0)
      // …and it is the layer's own fill, not a colour left over from whatever
      // was drawn before it.
      expect(h.ctx.fillColours).toContain('#ff8800')
    }
  })

  it('starts a line and an arrow at different aspect ratios', () => {
    expect(createShapeLayer('line').height).toBeLessThan(createShapeLayer('rect').height)
    expect(createShapeLayer('arrow').width).toBeGreaterThan(createShapeLayer('rect').width)
  })
})

/* ------------------------------------------------------------------ *
 * Stickers
 * ------------------------------------------------------------------ */

/** An uploaded sticker: an asset plus the built-in id it fell back from. */
function uploaded(assetId: string, svg: string, patch: Partial<StickerLayer> = {}): StickerLayer {
  return { ...uploadedStickerLayer(assetId, 'sticker.png'), svg, ...patch }
}

describe('drawLayers · stickers', () => {
  it('scales the path into the viewport and fills it', () => {
    const pathStub = class {
      constructor(public d: string) {}
    }
    vi.stubGlobal('Path2D', pathStub)
    const h = harness()
    compose(h, docWith(createStickerLayer('star')))
    const scales = methods(h.ctx, 'scale').map((call) => call.args)
    // First scale is the layer transform, second is the viewBox fit.
    expect(scales[0]).toEqual([1, 1])
    expect((scales[1] as number[])[0]).toBeCloseTo((100 * 0.25) / 100, 5)
    const fill = methods(h.ctx, 'fill')[0].args[0] as { d: string }
    expect(fill.d).toBe('M50 5l14 29 32 4-23 22 6 32-29-15-29 15 6-32L4 38l32-4z')
  })

  it('applies the layer transform so a sticker can be scaled', () => {
    vi.stubGlobal(
      'Path2D',
      class {
        constructor(public d: string) {}
      },
    )
    const h = harness()
    const layer = createStickerLayer('heart')
    layer.transform = {
      ...layer.transform,
      x: 0.25,
      y: 0.75,
      scale: 1.5,
      rotation: 45,
      opacity: 0.4,
    }
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'translate')[0].args).toEqual([50, 75])
    expect(methods(h.ctx, 'rotate')[0].args).toEqual([Math.PI / 4])
    expect(methods(h.ctx, 'scale')[0].args).toEqual([1.5, 1.5])
    expect(h.ctx.assignments.find((entry) => entry.prop === 'globalAlpha')?.value).toBe(0.4)
  })

  it('draws nothing for an unknown sticker id', () => {
    const h = harness()
    compose(h, docWith(createStickerLayer('does-not-exist')))
    expect(methods(h.ctx, 'fill')).toHaveLength(0)
  })

  it('draws an uploaded sticker from its asset, not from a Path2D (D6-F10)', () => {
    const asset = { width: 40, height: 20, pixels: new Uint8ClampedArray(40 * 20 * 4) }
    const h = harness()
    drawLayers(h.ctx as unknown as CanvasRenderingContext2D, docWith(uploaded('up', 'star')), {
      size: SIZE,
      assets: {
        get: (id) =>
          id === 'up'
            ? (asset as unknown as CanvasImageSource & { width: number; height: number })
            : undefined,
      },
    })
    // 25 % of the frame height, the same budget the vector set gets, with the
    // 2:1 image's own aspect kept.
    expect(methods(h.ctx, 'drawImage')[0].args.slice(1)).toEqual([-25, -12.5, 50, 25])
    expect(methods(h.ctx, 'fill')).toHaveLength(0)
  })

  it('positions an uploaded sticker on the layer transform like any other', () => {
    const asset = { width: 20, height: 20, pixels: new Uint8ClampedArray(20 * 20 * 4) }
    const h = harness()
    const layer = uploaded('up', 'star')
    layer.transform = { ...layer.transform, x: 0.25, y: 0.75, scale: 2, rotation: 45 }
    drawLayers(h.ctx as unknown as CanvasRenderingContext2D, docWith(layer), {
      size: SIZE,
      assets: {
        get: () => asset as unknown as CanvasImageSource & { width: number; height: number },
      },
    })
    expect(methods(h.ctx, 'translate')[0].args).toEqual([50, 75])
    expect(methods(h.ctx, 'rotate')[0].args).toEqual([Math.PI / 4])
    expect(methods(h.ctx, 'scale')[0].args).toEqual([2, 2])
  })

  it('falls back to the built-in path when the uploaded asset is missing', () => {
    const h = harness()
    compose(h, docWith(uploaded('gone', 'star')))
    const fill = methods(h.ctx, 'fill')[0].args[0] as { d: string }
    expect(fill.d).toBe('M50 5l14 29 32 4-23 22 6 32-29-15-29 15 6-32L4 38l32-4z')
  })

  it('draws nothing when an upload has neither an asset nor a path', () => {
    const h = harness()
    compose(h, docWith(uploaded('gone', 'star', { svg: '', assetId: null })))
    expect(methods(h.ctx, 'fill')).toHaveLength(0)
    expect(methods(h.ctx, 'drawImage')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * Draw brushes
 * ------------------------------------------------------------------ */

describe('drawLayers · brushes', () => {
  function strokeLayer(brush: DrawLayer['brush'], strokes: DrawLayer['strokes']): DrawLayer {
    const layer = createDrawLayer()
    layer.brush = brush
    layer.size = 4
    layer.strokes = strokes
    return layer
  }
  const stroke = (radius: number, hardness = 1): DrawLayer['strokes'][number] => ({
    points: [
      { x: 0.1, y: 0.2 },
      { x: 0.6, y: 0.7 },
    ],
    radius,
    hardness,
  })

  it('gives marker and highlighter a different appearance from pen', () => {
    const signatures = (['pen', 'marker', 'highlighter', 'neon'] as const).map((brush) => {
      const h = harness()
      compose(h, docWith(strokeLayer(brush, [stroke(4)])))
      return JSON.stringify({
        composite: h.ctx.assignments
          .filter((entry) => entry.prop === 'globalCompositeOperation')
          .map((entry) => entry.value),
        filter: h.ctx.assignments
          .filter((entry) => entry.prop === 'filter')
          .map((entry) => entry.value),
        alpha: h.ctx.assignments
          .filter((entry) => entry.prop === 'globalAlpha')
          .map((entry) => entry.value),
        width: h.ctx.strokeLineWidths,
        glow: h.ctx.strokeShadows,
      })
    })
    expect(new Set(signatures).size).toBe(4)
  })

  it('uses multiply and a lower alpha for the highlighter', () => {
    const h = harness()
    compose(h, docWith(strokeLayer('highlighter', [stroke(4)])))
    expect(
      h.ctx.assignments.some(
        (entry) => entry.prop === 'globalCompositeOperation' && entry.value === 'multiply',
      ),
    ).toBe(true)
    const pen = harness()
    compose(pen, docWith(strokeLayer('pen', [stroke(4)])))
    expect(
      pen.ctx.assignments.some(
        (entry) => entry.prop === 'globalCompositeOperation' && entry.value === 'multiply',
      ),
    ).toBe(false)
  })

  it('honours per-stroke radius instead of the layer-wide size', () => {
    const h = harness()
    const layer = strokeLayer('pen', [stroke(2), stroke(10)])
    layer.size = 20
    compose(h, docWith(layer))
    expect(h.ctx.strokeLineWidths).toEqual([2, 10])
  })

  it('softens a stroke with hardness below 1', () => {
    const hard = harness()
    compose(hard, docWith(strokeLayer('pen', [stroke(4, 1)])))
    const soft = harness()
    compose(soft, docWith(strokeLayer('pen', [stroke(4, 0)])))
    const filters = (h: Harness) => h.ctx.assignments.filter((entry) => entry.prop === 'filter')
    expect(filters(soft).length).toBeGreaterThan(0)
    expect(filters(hard)).toHaveLength(0)
    const lastAlpha = (h: Harness) => {
      const alphas = h.ctx.assignments.filter((entry) => entry.prop === 'globalAlpha')
      return alphas[alphas.length - 1]?.value as number
    }
    expect(lastAlpha(soft)).toBeLessThan(lastAlpha(hard))
  })

  it('erases into its own surface instead of punching a hole in the photo', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    compose(h, docWith(strokeLayer('eraser', [stroke(6)])))
    // destination-out must never reach the shared compositing context.
    expect(
      h.ctx.assignments.some(
        (entry) => entry.prop === 'globalCompositeOperation' && entry.value === 'destination-out',
      ),
    ).toBe(false)
    const blits = methods(h.ctx, 'drawImage')
    expect(blits).toHaveLength(1)
    // The photo survives: alpha stays opaque under the erased stroke.
    expect(pixelAt(h.ctx, 100, 50)[3]).toBe(255)
  })

  it('honours a per-stroke erase flag on a pen layer', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    compose(h, docWith(strokeLayer('pen', [{ ...stroke(6), erase: true }])))
    expect(methods(h.ctx, 'drawImage')).toHaveLength(1)
    expect(pixelAt(h.ctx, 100, 50)[3]).toBe(255)
  })

  it('does not allocate a surface for a layer that never erases', () => {
    const h = harness()
    compose(h, docWith(strokeLayer('pen', [stroke(4)])))
    expect(h.allocations()).toBe(0)
  })
})

/* ------------------------------------------------------------------ *
 * Redaction
 * ------------------------------------------------------------------ */

function redactLayer(mode: RedactLayer['mode'], patch: Partial<RedactLayer> = {}): RedactLayer {
  const layer = createRedactLayer()
  layer.mode = mode
  layer.region = { x: 0.25, y: 0.2, width: 0.5, height: 0.6 }
  return { ...layer, ...patch }
}

describe('drawLayers · redaction', () => {
  it('blurs the region instead of leaving the original pixels (D6-F05)', () => {
    const h = harness()
    paintCheckerboard(h.ctx)
    const layer = redactLayer('blur', { strength: 100 })
    const before = lumaVariance(h.ctx, layer.region)
    compose(h, docWith(layer))
    const after = lumaVariance(h.ctx, layer.region)
    expect(after).toBeLessThan(before * 0.05)
    // The specific proof that the unredacted pixels are gone: a pixel that was
    // pure black or pure white inside the region is now a blend of both.
    const centre = pixelAt(h.ctx, Math.round(0.5 * SIZE.width), Math.round(0.5 * SIZE.height))
    expect([0, 255]).not.toContain(centre[0])
    expect(centre[3]).toBe(255)
  })

  it('never sources a readback rect off the end of the canvas (D6-F05)', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    compose(h, docWith(redactLayer('blur', { strength: 60 })))
    for (const call of methods(h.ctx, 'getImageData')) {
      const [x, y, width, height] = call.args as number[]
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + width).toBeLessThanOrEqual(SIZE.width)
      expect(y + height).toBeLessThanOrEqual(SIZE.height)
      expect(width).toBeGreaterThan(0)
      expect(height).toBeGreaterThan(0)
    }
    // The old code drew the patch from (image.width, image.height), which is
    // outside the source canvas, so the intersection was empty.
    for (const call of methods(h.ctx, 'drawImage')) {
      const [, dx, dy, dw, dh] = call.args as unknown[]
      expect(dx as number).toBeGreaterThanOrEqual(0)
      expect(dy as number).toBeGreaterThanOrEqual(0)
      expect((dx as number) + (dw as number)).toBeLessThanOrEqual(SIZE.width)
      expect((dy as number) + (dh as number)).toBeLessThanOrEqual(SIZE.height)
    }
  })

  it('pads the blur sample so the region edge is not a hard-clipped fringe', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    const layer = redactLayer('blur', {
      strength: 100,
      region: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
    })
    compose(h, docWith(layer))
    const [read] = methods(h.ctx, 'getImageData')
    const [, , readWidth, readHeight] = read.args as number[]
    // The sample is larger than the region so the kernel has neighbours.
    expect(readWidth).toBeGreaterThan(layer.region.width * SIZE.width)
    expect(readHeight).toBeGreaterThan(layer.region.height * SIZE.height)
  })

  it('covers a region that runs off the canvas edge', () => {
    const before = harness()
    paintCheckerboard(before.ctx)
    const clipped = { x: 0.45, y: 0.1, width: 0.55, height: 0.6 }
    const original = lumaVariance(before.ctx, clipped)

    const h = harness()
    paintCheckerboard(h.ctx)
    compose(
      h,
      docWith(
        redactLayer('blur', {
          strength: 100,
          region: { x: 0.45, y: 0.1, width: 0.7, height: 0.6 },
        }),
      ),
    )
    expect(lumaVariance(h.ctx, clipped)).toBeLessThan(original * 0.05)
  })

  it('redacts the visible part of a region that starts off-canvas', () => {
    const before = harness()
    paintCheckerboard(before.ctx)
    const visible = { x: 0, y: 0.1, width: 0.3, height: 0.6 }
    const original = lumaVariance(before.ctx, visible)

    const h = harness()
    paintCheckerboard(h.ctx)
    // x is negative, so the old code clamped the read to 0 and then drew the
    // patch back at the unclamped -0.2 offset, leaving most of the band bare.
    compose(
      h,
      docWith(
        redactLayer('blur', {
          strength: 100,
          region: { x: -0.2, y: 0.1, width: 0.5, height: 0.6 },
        }),
      ),
    )
    expect(lumaVariance(h.ctx, visible)).toBeLessThan(original * 0.05)
  })

  it('fails closed with a solid cover when the readback is impossible', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    h.ctx.throwsOnRead = true
    const layer = redactLayer('blur')
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'drawImage')).toHaveLength(0)
    const fills = methods(h.ctx, 'fillRect')
    const cover = fills[fills.length - 1]
    expect(cover?.args).toEqual([
      layer.region.x * SIZE.width,
      layer.region.y * SIZE.height,
      layer.region.width * SIZE.width,
      layer.region.height * SIZE.height,
    ])
    expect(pixelAt(h.ctx, 100, 50)).toEqual([0, 0, 0, 255])
  })

  it('fails closed when the platform cannot blur at all', () => {
    const h = harness({ filter: false })
    paintHardEdge(h.ctx)
    compose(h, docWith(redactLayer('blur')))
    expect(methods(h.ctx, 'drawImage')).toHaveLength(0)
    expect(pixelAt(h.ctx, 100, 50)).toEqual([0, 0, 0, 255])
  })

  it('samples once and caches the result across frames (D6-F07)', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    const doc = docWith(redactLayer('pixelate'))
    compose(h, doc)
    const afterFirst = h.allocations()
    expect(methods(h.ctx, 'getImageData')).toHaveLength(1)
    h.calls.length = 0
    compose(h, doc)
    expect(methods(h.ctx, 'getImageData')).toHaveLength(0)
    expect(h.allocations()).toBe(afterFirst)
  })

  it('re-reads when the layer changes', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    const layer = redactLayer('pixelate')
    const doc = docWith(layer)
    compose(h, doc)
    h.calls.length = 0
    layer.strength = 90
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'getImageData').length).toBeGreaterThan(0)
  })

  it('evicts least-recently-used surfaces instead of growing forever', () => {
    const h = harness()
    paintCheckerboard(h.ctx)
    const layers = Array.from({ length: 20 }, (_, index) =>
      redactLayer('pixelate', { region: { x: 0.02 * index, y: 0.1, width: 0.2, height: 0.4 } }),
    )
    const docs = layers.map((layer) => docWith(layer))
    for (const doc of docs) compose(h, doc)
    const afterAll = h.allocations()

    // The most recent layer is still cached: no new canvases.
    compose(h, docs[docs.length - 1])
    expect(h.allocations()).toBe(afterAll)

    // The oldest was evicted to stay inside the budget, so it is re-read.
    compose(h, docs[0])
    expect(h.allocations()).toBeGreaterThan(afterAll)
  })

  it('prefers OffscreenCanvas when the platform has it', () => {
    let offscreenCount = 0
    class FakeOffscreenCanvas {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
        offscreenCount += 1
      }
      getContext() {
        return new FakeCtx(this.width, this.height)
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
    const h = harness()
    paintHardEdge(h.ctx)
    compose(h, docWith(redactLayer('pixelate')))
    expect(offscreenCount).toBeGreaterThan(0)
    expect(h.allocations()).toBe(0)
  })

  it('pixelates through a downsample then a nearest-neighbour upscale', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    compose(h, docWith(redactLayer('pixelate', { strength: 100 })))
    const blits = methods(h.ctx, 'drawImage')
    expect(blits.length).toBeGreaterThanOrEqual(1)
    expect(h.ctx.assignments.some((entry) => entry.prop === 'globalCompositeOperation')).toBe(true)
  })

  const modes = ['pixelate', 'blur', 'solid', 'emoji'] as const
  const shapes = ['rect', 'ellipse'] as const
  for (const mode of modes) {
    for (const shape of shapes) {
      it(`covers a ${shape} region in ${mode} mode`, () => {
        const h = harness()
        paintHardEdge(h.ctx)
        compose(h, docWith(redactLayer(mode, { shape })))
        expect(methods(h.ctx, 'clip')).toHaveLength(1)
        if (shape === 'ellipse') expect(methods(h.ctx, 'ellipse')).toHaveLength(1)
        else expect(methods(h.ctx, 'rect')).toHaveLength(1)
        const drawn =
          methods(h.ctx, 'fillText').length +
          methods(h.ctx, 'fillRect').length +
          methods(h.ctx, 'drawImage').length
        expect(drawn).toBeGreaterThan(0)
        expect(pixelAt(h.ctx, 100, 50)).not.toEqual([0, 0, 0, 0])
      })
    }
  }

  it('tiles the emoji across the region', () => {
    const h = harness()
    compose(h, docWith(redactLayer('emoji')))
    expect(methods(h.ctx, 'fillText').length).toBeGreaterThan(3)
  })

  it('ignores a region that is entirely off-canvas', () => {
    const h = harness()
    compose(
      h,
      docWith(redactLayer('blur', { region: { x: 1.4, y: 1.4, width: 0.2, height: 0.2 } })),
    )
    expect(methods(h.ctx, 'getImageData')).toHaveLength(0)
    expect(methods(h.ctx, 'drawImage')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * Watermark
 * ------------------------------------------------------------------ */

function watermarkLayer(patch: Partial<WatermarkLayer> = {}): WatermarkLayer {
  const layer = createWatermarkLayer()
  return { ...layer, ...patch }
}

describe('drawLayers · watermark', () => {
  it('honours the layer transform (D6-F04)', () => {
    const h = harness()
    const layer = watermarkLayer({
      transform: { x: 0.75, y: 0.25, scale: 2, rotation: 30, opacity: 0.25, blend: 'multiply' },
    })
    compose(h, docWith(layer))
    // The canvas-space offset, then a trip to the mark's resting point and back,
    // so scale and rotation pivot on the mark rather than on the origin.
    const rest = [0.95 * SIZE.width, 0.92 * SIZE.height]
    expect(methods(h.ctx, 'translate').map((call) => call.args)).toEqual([
      [(0.75 - 0.5) * SIZE.width, (0.25 - 0.5) * SIZE.height],
      rest,
      [-rest[0], -rest[1]],
    ])
    expect(methods(h.ctx, 'rotate')[0].args).toEqual([(30 * Math.PI) / 180])
    expect(methods(h.ctx, 'scale')[0].args).toEqual([2, 2])
    // The *last* alpha the compositor writes is the one that paints the
    // glyphs. An earlier assignment is `drawLayers` setting the layer opacity,
    // so asserting on the first would miss a fudge applied on top of it.
    const alphas = h.ctx.assignments.filter((entry) => entry.prop === 'globalAlpha')
    expect(alphas[alphas.length - 1].value).toBe(0.25)
    expect(
      h.ctx.assignments.some(
        (entry) => entry.prop === 'globalCompositeOperation' && entry.value === 'multiply',
      ),
    ).toBe(true)
  })

  it('keeps the default transform an identity offset, so anchors still land', () => {
    const h = harness()
    compose(h, docWith(watermarkLayer()))
    const [drawn] = h.ctx.textDrawn
    expect(drawn.x).toBeCloseTo(0.95 * SIZE.width, 5)
    expect(drawn.y).toBeCloseTo(0.92 * SIZE.height, 5)
    // Round trip through the pivot leaves the origin where it was.
    const offsets = methods(h.ctx, 'translate').map((call) => call.args as number[])
    expect(offsets[0][0]).toBeCloseTo(0, 5)
    expect(offsets[0][1]).toBeCloseTo(0, 5)
    expect(offsets[1][0] + offsets[2][0]).toBeCloseTo(0, 5)
    expect(offsets[1][1] + offsets[2][1]).toBeCloseTo(0, 5)
  })

  it('scales about the mark, so 200% does not push it off the canvas', () => {
    // The defect: `translate` then `scale` multiplied the anchor's distance from
    // the origin, so the default bottom-right watermark at 2x landed at
    // x = 1.5 * width — off the canvas, and the scale slider looked broken.
    const h = harness()
    compose(
      h,
      docWith(
        watermarkLayer({
          transform: { x: 0.5, y: 0.5, scale: 2, rotation: 0, opacity: 1, blend: 'normal' },
        }),
      ),
    )
    const rest = [0.95 * SIZE.width, 0.92 * SIZE.height]
    // Composing translate(rest) . scale(2) . translate(-rest) puts a point p at
    // rest + 2 * (p - rest), so the mark itself stays exactly where it was.
    const place = (p: number[], r: number[]): number[] => [
      r[0] + 2 * (p[0] - r[0]),
      r[1] + 2 * (p[1] - r[1]),
    ]
    expect(place(rest, rest)).toEqual(rest)
    // …and a point 10px to the left of the anchor ends up 20px to its left.
    expect(place([rest[0] - 10, rest[1]], rest)[0]).toBeCloseTo(rest[0] - 20, 5)
  })

  it('places all nine anchors', () => {
    const anchors: WatermarkLayer['anchor'][] = [
      'top-left',
      'top-center',
      'top-right',
      'middle-left',
      'center',
      'middle-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]
    const positions = anchors.map((anchor) => {
      const h = harness()
      compose(h, docWith(watermarkLayer({ anchor })))
      const [drawn] = h.ctx.textDrawn
      return `${anchor}:${Math.round(drawn.x)},${Math.round(drawn.y)}`
    })
    expect(new Set(positions).size).toBe(9)
  })

  it('tiles the mark across the canvas at -30 degrees', () => {
    const h = harness()
    compose(h, docWith(watermarkLayer({ tiled: true })))
    expect(h.ctx.textDrawn.length).toBeGreaterThan(6)
    expect(methods(h.ctx, 'rotate').map((call) => call.args[0])).toContain((-30 * Math.PI) / 180)
  })

  it('draws a logo asset instead of the text', () => {
    const asset = { width: 200, height: 100, pixels: new Uint8ClampedArray(4) }
    const h = harness()
    drawLayers(
      h.ctx as unknown as CanvasRenderingContext2D,
      docWith(watermarkLayer({ assetId: 'logo' })),
      {
        size: SIZE,
        assets: {
          get: () => asset as unknown as CanvasImageSource & { width: number; height: number },
        },
      },
    )
    expect(methods(h.ctx, 'drawImage')).toHaveLength(1)
    expect(h.ctx.textDrawn).toHaveLength(0)
  })

  it('falls back to text when the asset is missing', () => {
    const h = harness()
    compose(h, docWith(watermarkLayer({ assetId: 'missing' })))
    expect(h.ctx.textDrawn).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * Frame
 * ------------------------------------------------------------------ */

const FRAME_STYLES: FrameStyle[] = ['solid', 'inset', 'polaroid', 'film', 'rounded', 'shadow-card']

describe('drawLayers · frame', () => {
  for (const style of FRAME_STYLES) {
    it(`draws the ${style} style with distinguishing geometry`, () => {
      const h = harness()
      compose(h, docWith(createFrameLayer(style)))
      const drawn =
        methods(h.ctx, 'fillRect').length +
        methods(h.ctx, 'strokeRect').length +
        methods(h.ctx, 'fill').length +
        methods(h.ctx, 'stroke').length
      expect(drawn).toBeGreaterThan(0)
    })
  }

  it('places the film sprockets along both bars', () => {
    const h = harness()
    compose(h, docWith(createFrameLayer('film')))
    expect(methods(h.ctx, 'fill').length).toBeGreaterThan(4)
  })

  it('honours `inside` instead of ignoring the checkbox', () => {
    const inside = harness()
    const outside = harness()
    const insideLayer = createFrameLayer('solid')
    insideLayer.inside = true
    const outsideLayer = createFrameLayer('solid')
    outsideLayer.inside = false
    compose(inside, docWith(insideLayer))
    compose(outside, docWith(outsideLayer))
    const insideBox = methods(inside.ctx, 'strokeRect')[0].args as number[]
    const outsideBox = methods(outside.ctx, 'strokeRect')[0].args as number[]
    expect(insideBox).not.toEqual(outsideBox)
    // Inside the canvas means the whole band fits; on the edge it is clipped.
    expect(insideBox[0]).toBeCloseTo(3, 5)
    expect(outsideBox[0]).toBeCloseTo(0, 5)
  })

  it('honours opacity and blend, which used to be force-overridden', () => {
    const h = harness()
    const layer = createFrameLayer('inset')
    layer.transform = { ...layer.transform, opacity: 0.3, blend: 'multiply' }
    compose(h, docWith(layer))
    expect(h.ctx.assignments.find((entry) => entry.prop === 'globalAlpha')?.value).toBe(0.3)
    expect(
      h.ctx.assignments.some(
        (entry) => entry.prop === 'globalCompositeOperation' && entry.value === 'multiply',
      ),
    ).toBe(true)
  })

  it('skips the shared transform, which frames never used', () => {
    const h = harness()
    const layer = createFrameLayer('solid')
    layer.transform = { x: 0.1, y: 0.9, scale: 3, rotation: 45, opacity: 1, blend: 'normal' }
    compose(h, docWith(layer))
    expect(methods(h.ctx, 'translate')).toHaveLength(0)
    expect(methods(h.ctx, 'rotate')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * Compositing
 * ------------------------------------------------------------------ */

describe('drawLayers · compositing', () => {
  it('multiplies a shape layer with the photo underneath', () => {
    const h = harness()
    h.ctx.fillStyle = '#808080'
    h.ctx.fillRect(0, 0, SIZE.width, SIZE.height)
    const layer: ShapeLayer = createShapeLayer('rect')
    layer.width = 1
    layer.height = 1
    layer.fill = '#ffffff'
    layer.transform = { ...layer.transform, blend: 'multiply' }
    compose(h, docWith(layer))
    // 0xff * 0x80 / 0xff = 0x80: multiplied, not replaced.
    expect(pixelAt(h.ctx, 100, 50)[0]).toBe(128)
  })

  it('refuses to let a redaction be made translucent, whatever the doc says', () => {
    const h = harness()
    const layer = redactLayer('solid')
    // A doc written by an older build, a pasted one, or a script can still
    // carry a 50% redaction in Multiply. Honouring it would put the hidden
    // pixels straight back into the export, so the compositor overrides it.
    layer.transform = { ...layer.transform, blend: 'multiply', opacity: 0.5 }
    compose(h, docWith(layer))
    expect(
      h.ctx.assignments.some(
        (entry) => entry.prop === 'globalCompositeOperation' && entry.value === 'multiply',
      ),
    ).toBe(false)
    expect(h.ctx.assignments.filter((entry) => entry.prop === 'globalAlpha')).toEqual([
      { prop: 'globalAlpha', value: 1 },
    ])
  })

  it('covers an emoji redaction before tiling, so the ink underneath is gone', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    compose(h, docWith(redactLayer('emoji')))
    const fill = h.calls.findIndex(
      (call) =>
        (call.method === 'fillStyle' && typeof call.args[0] === 'string') ||
        call.method === 'fillRect',
    )
    const text = h.calls.findIndex((call) => call.method === 'fillText')
    expect(fill).toBeGreaterThanOrEqual(0)
    expect(text).toBeGreaterThan(fill)
  })

  it('does not let a redaction cache survive an unrelated photo edit', () => {
    const h = harness()
    paintHardEdge(h.ctx)
    const layer = redactLayer('pixelate')
    const doc = docWith(layer)
    compose(h, doc)
    h.calls.length = 0
    compose(h, { ...doc, adjust: { ...doc.adjust, exposure: 0.5 } })
    expect(methods(h.ctx, 'getImageData').length).toBeGreaterThan(0)
  })

  it('restores state after every layer', () => {
    const h = harness()
    const doc = docWith(
      textLayer(),
      createShapeLayer('rect'),
      createFrameLayer('solid'),
      watermarkLayer(),
    )
    compose(h, doc)
    const depth = h.calls.filter((call) => call.method === 'save').length
    const unwound = h.calls.filter((call) => call.method === 'restore').length
    expect(unwound).toBeGreaterThanOrEqual(depth)
    expect(h.ctx.globalAlpha).toBe(1)
  })

  it('renders in stack order', () => {
    const h = harness()
    const sticker = createStickerLayer('star')
    const shape = createShapeLayer('rect')
    compose(h, docWith(sticker, shape))
    const stickerScale = h.calls.findIndex((call) => call.method === 'scale')
    const shapeFill = h.calls.findIndex((call) => call.method === 'fillRect')
    expect(stickerScale).toBeLessThan(shapeFill)
  })
})
