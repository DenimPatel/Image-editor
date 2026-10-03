import type { Doc, Layer, LayerTransform, NormRect, Size } from '../model/types'
import { fontFamily } from '../features/layers/fonts'
import { BRUSH_STYLES } from '../features/layers/factory'
import { stickerById } from '../features/layers/stickers'

export type CompositorAssets = {
  get(id: string): (CanvasImageSource & { width: number; height: number }) | undefined
}

export type ComposeOptions = {
  size: Size
  assets: CompositorAssets
}

function blendOp(blend: Layer['transform']['blend']): GlobalCompositeOperation {
  switch (blend) {
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'soft-light':
    case 'hard-light':
      return blend
    default:
      return 'source-over'
  }
}

function rectToPixels(rect: NormRect, size: Size) {
  return {
    x: rect.x * size.width,
    y: rect.y * size.height,
    width: rect.width * size.width,
    height: rect.height * size.height,
  }
}

function applyTransform(
  ctx: CanvasRenderingContext2D,
  transform: LayerTransform,
  size: Size,
): void {
  ctx.translate(transform.x * size.width, transform.y * size.height)
  ctx.rotate((transform.rotation * Math.PI) / 180)
  ctx.scale(transform.scale, transform.scale)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/* ------------------------------------------------------------------ *
 * Reusable scratch surfaces
 *
 * `drawLayers` runs inside the rAF loop, so anything allocated per frame
 * is a per-frame cost. The redaction readback and the eraser isolation
 * buffer both need canvases, so they are cached by a content key and
 * reused; `willReadFrequently` / `OffscreenCanvas` are used where the
 * platform offers them (D6-F07).
 * ------------------------------------------------------------------ */

type Surface = {
  canvas: OffscreenCanvas | HTMLCanvasElement
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
}

type SurfaceEntry = {
  surface: Surface
  /** Content key already rasterised into this surface, if any. */
  prepared: string | null
  pixels: number
}

const MAX_CACHED_SURFACES = 12
/**
 * Total pixel budget for cached surfaces. An export-size redaction patch can
 * be a full-resolution photo, so the count alone is not a memory bound.
 */
const MAX_CACHED_PIXELS = 24_000_000
let cachedPixels = 0
const surfaceCache = new Map<string, SurfaceEntry>()

function createSurface(width: number, height: number, willReadFrequently: boolean): Surface | null {
  const w = Math.max(1, Math.ceil(width))
  const h = Math.max(1, Math.ceil(height))
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently })
    if (ctx) return { canvas, ctx }
  }
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently })
  return ctx ? { canvas, ctx } : null
}

/** Evict least-recently-used surfaces until a new one fits. */
function evictFor(incomingPixels: number): void {
  while (surfaceCache.size > 0) {
    const overCount = surfaceCache.size >= MAX_CACHED_SURFACES
    const overBudget = cachedPixels + incomingPixels > MAX_CACHED_PIXELS
    if (!overCount && !overBudget) return
    const oldest = surfaceCache.keys().next().value
    if (oldest === undefined) return
    const evicted = surfaceCache.get(oldest)
    surfaceCache.delete(oldest)
    cachedPixels -= evicted?.pixels ?? 0
  }
}

function acquireSurface(
  key: string,
  width: number,
  height: number,
  willReadFrequently: boolean,
): SurfaceEntry | null {
  const hit = surfaceCache.get(key)
  if (hit) {
    // Touch for LRU: the entry is the most recently used one now.
    surfaceCache.delete(key)
    surfaceCache.set(key, hit)
    return hit
  }
  const surface = createSurface(width, height, willReadFrequently)
  if (!surface) return null
  const entry: SurfaceEntry = { surface, prepared: null, pixels: width * height }
  evictFor(entry.pixels)
  cachedPixels += entry.pixels
  surfaceCache.set(key, entry)
  return entry
}

/** Drop every cached surface (context loss, doc load, tests). */
export function clearLayerSurfaceCache(): void {
  surfaceCache.clear()
  cachedPixels = 0
}

/**
 * Content token for an immutable doc section. Sections are replaced (never
 * mutated) on every edit, so object identity is an exact content key and
 * costs one WeakMap lookup instead of a JSON hash per frame.
 */
const sectionTokens = new WeakMap<object, number>()
let sectionTokenCounter = 0
const NO_SOURCE: object = {}

function sectionToken(section: object): number {
  const hit = sectionTokens.get(section)
  if (hit !== undefined) return hit
  sectionTokenCounter += 1
  sectionTokens.set(section, sectionTokenCounter)
  return sectionTokenCounter
}

/** Everything that can change the pixels a redaction samples. */
function photoToken(doc: Doc): string {
  return [
    doc.source ?? NO_SOURCE,
    doc.geometry,
    doc.adjust,
    doc.curves,
    doc.hsl,
    doc.look,
    doc.effects,
    doc.background,
    doc.masks,
    doc.localAdjusts,
    doc.retouch,
  ]
    .map((section) => sectionToken(section))
    .join('.')
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

/**
 * `ctx.letterSpacing` is Chromium/Safari only; elsewhere the property is
 * absent and tracking degrades to a no-op rather than throwing.
 */
function supportsLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
  return typeof (ctx as { letterSpacing?: unknown }).letterSpacing === 'string'
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, pixels: number): void {
  if (!supportsLetterSpacing(ctx)) return
  ;(ctx as { letterSpacing: string }).letterSpacing = `${pixels}px`
}

/** `ctx.filter` is not universal either; without it a blur cannot redact. */
function supportsFilter(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): boolean {
  return typeof (ctx as { filter?: unknown }).filter === 'string'
}

function setFilter(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  value: string,
): void {
  if (!supportsFilter(ctx)) return
  ;(ctx as { filter: string }).filter = value
}

function glyphAdvance(ctx: CanvasRenderingContext2D, glyph: string): number {
  return ctx.measureText(glyph).width
}

/**
 * Lay one line of glyphs along a circular arc. `style.arc` is the bow in
 * degrees of a half-circle sweep: 0 is a flat line, +100 arches the ends
 * downward (a rainbow) and -100 bows the middle up (a smile).
 */
function drawArcedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  y: number,
  style: Extract<Layer, { kind: 'text' }>['style'],
  paint: (text: string, x: number, y: number) => void,
): void {
  const glyphs = [...line]
  const advances = glyphs.map((glyph) => glyphAdvance(ctx, glyph))
  const total = advances.reduce((sum, width) => sum + width, 0)
  const bend = (Math.max(-100, Math.min(100, style.arc)) / 100) * (Math.PI / 2)
  const radius = Math.abs(bend) < 1e-4 ? Number.POSITIVE_INFINITY : total / (2 * Math.sin(bend / 2))
  const start = style.align === 'center' ? -total / 2 : style.align === 'right' ? -total : 0
  const mid = start + total / 2
  ctx.save()
  // Glyphs are placed on the curve by hand, so each one is drawn centred.
  ctx.textAlign = 'center'
  let cursor = start
  glyphs.forEach((glyph, index) => {
    const width = advances[index]
    const centre = cursor + width / 2
    cursor += width
    if (!Number.isFinite(radius) || width <= 0) {
      paint(glyph, centre, y)
      return
    }
    const phi = (centre - mid) / radius
    const x = mid + radius * Math.sin(phi)
    const lift = Math.sign(bend) * radius * (1 - Math.cos(phi))
    ctx.save()
    ctx.translate(x, y + lift)
    ctx.rotate(-phi)
    paint(glyph, 0, 0)
    ctx.restore()
  })
  ctx.restore()
}

function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'text' }>,
  size: Size,
): void {
  const style = layer.style
  const fontSize = (style.size / 100) * Math.min(size.width, size.height)
  const family = fontFamily(style.fontId)
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${fontSize}px "${family}", system-ui, sans-serif`
  ctx.textAlign = style.align
  ctx.textBaseline = 'middle'
  ctx.fillStyle = style.color
  ctx.strokeStyle = style.strokeColor
  ctx.lineWidth = (style.strokeWidth / 100) * fontSize
  setLetterSpacing(ctx, (style.tracking / 100) * fontSize)
  const lines = layer.text.split('\n')
  const lineHeight = fontSize * style.lineHeight
  const startY = -((lines.length - 1) * lineHeight) / 2

  const paint = (text: string, x: number, y: number) => {
    if (style.shadow) {
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = fontSize * 0.25
      ctx.shadowOffsetY = fontSize * 0.08
      ctx.fillText(text, x, y)
      ctx.restore()
    }
    if (style.strokeWidth > 0) ctx.strokeText(text, x, y)
    ctx.fillText(text, x, y)
  }

  lines.forEach((line, index) => {
    const y = startY + index * lineHeight
    if (style.pillBackground) {
      const metrics = ctx.measureText(line)
      const padding = fontSize * 0.3
      const width = metrics.width + padding * 2
      const x =
        style.align === 'center'
          ? -width / 2
          : style.align === 'right'
            ? -metrics.width - padding
            : -padding
      ctx.save()
      ctx.fillStyle = style.pillBackground
      roundRect(ctx, x, y - lineHeight / 2, width, lineHeight, lineHeight / 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = style.color
    }
    if (style.arc === 0) paint(line, 0, y)
    else drawArcedLine(ctx, line, y, style, paint)
  })
}

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

function drawShapeLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'shape' }>,
  size: Size,
): void {
  const width = layer.width * size.width
  const height = layer.height * size.height
  const thickness = Math.max(1, (layer.strokeWidth / 100) * Math.min(size.width, size.height))
  ctx.fillStyle = layer.fill
  ctx.strokeStyle = layer.stroke
  ctx.lineWidth = thickness
  if (layer.shape === 'rect') {
    ctx.fillRect(-width / 2, -height / 2, width, height)
  } else if (layer.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // A line and an arrow used to be stroked polylines, so the inspector's Fill
    // control did nothing for two of the four shapes it is offered for: a
    // control that is present, labelled and has no effect. Both are now closed,
    // filled paths — the fill is the body, the stroke is the outline.
    const direction = layer.shape === 'arrow' ? 1 : 0
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const tailX = -width / 2
    const tailY = height / 2
    const tipX = width / 2
    const tipY = -height / 2
    const axis = Math.atan2(tipY - tailY, tipX - tailX)
    const perpX = -Math.sin(axis)
    const perpY = Math.cos(axis)
    // Where the head begins; without one the shaft runs all the way to the tip.
    const head = direction
      ? Math.max(4, Math.min(width, height) * 0.45)
      : Math.hypot(tipX - tailX, tipY - tailY)
    const baseX = tipX - head * Math.cos(axis)
    const baseY = tipY - head * Math.sin(axis)

    const half = thickness / 2
    ctx.beginPath()
    ctx.moveTo(tailX + perpX * half, tailY + perpY * half)
    ctx.lineTo(baseX + perpX * half, baseY + perpY * half)
    ctx.lineTo(baseX - perpX * half, baseY - perpY * half)
    ctx.lineTo(tailX - perpX * half, tailY - perpY * half)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    if (direction) {
      const flare = head * 0.6
      ctx.beginPath()
      ctx.moveTo(tipX, tipY)
      ctx.lineTo(baseX + perpX * flare, baseY + perpY * flare)
      ctx.lineTo(baseX - perpX * flare, baseY - perpY * flare)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }
}

/* ------------------------------------------------------------------ *
 * Draw
 * ------------------------------------------------------------------ */

type StrokeContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function strokeRadius(
  layer: Extract<Layer, { kind: 'draw' }>,
  stroke: (typeof layer.strokes)[number],
  size: Size,
): number {
  const raw = Number.isFinite(stroke.radius) && stroke.radius > 0 ? stroke.radius : layer.size
  return (raw / 100) * Math.min(size.width, size.height)
}

function drawStrokes(
  ctx: StrokeContext,
  layer: Extract<Layer, { kind: 'draw' }>,
  size: Size,
): void {
  const style = BRUSH_STYLES[layer.brush]
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = layer.color
  if (style.glow > 0) {
    ctx.shadowColor = layer.color
    ctx.shadowBlur = (layer.size / 100) * Math.min(size.width, size.height) * style.glow
  }
  for (const stroke of layer.strokes) {
    if (stroke.points.length < 2) continue
    const radius = strokeRadius(layer, stroke, size)
    const hardness = Number.isFinite(stroke.hardness)
      ? Math.max(0, Math.min(1, stroke.hardness))
      : 1
    const erase = stroke.erase === true || layer.brush === 'eraser'
    ctx.globalCompositeOperation = erase ? 'destination-out' : style.composite
    ctx.globalAlpha = style.alpha * (0.35 + 0.65 * hardness)
    ctx.lineWidth = radius * style.widthScale
    const soft = style.soft + (1 - hardness) * 0.6
    if (soft > 0) setFilter(ctx, `blur(${(radius * soft).toFixed(2)}px)`)
    ctx.beginPath()
    stroke.points.forEach((point, index) => {
      const x = point.x * size.width
      const y = point.y * size.height
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
    if (soft > 0) setFilter(ctx, 'none')
  }
}

/**
 * A draw layer that erases must not punch a hole through the photo, so it is
 * rasterised into its own surface: `destination-out` then only removes that
 * layer's own ink. Without a stroke that erases, the layer draws straight onto
 * the target and costs nothing (D6: eraser leak).
 */
function drawLayerErases(layer: Extract<Layer, { kind: 'draw' }>): boolean {
  return layer.brush === 'eraser' || layer.strokes.some((stroke) => stroke.erase === true)
}

function drawDrawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'draw' }>,
  size: Size,
): void {
  if (!drawLayerErases(layer)) {
    drawStrokes(ctx, layer, size)
    return
  }
  const entry = acquireSurface(
    `draw:${layer.id}:${size.width}x${size.height}`,
    size.width,
    size.height,
    false,
  )
  if (!entry) {
    // No scratch surface available: fall back to the old behaviour rather
    // than silently dropping the strokes.
    drawStrokes(ctx, layer, size)
    return
  }
  const scratch = entry.surface
  scratch.ctx.setTransform(1, 0, 0, 1, 0, 0)
  scratch.ctx.clearRect(0, 0, size.width, size.height)
  drawStrokes(scratch.ctx, layer, size)
  ctx.drawImage(scratch.canvas, 0, 0)
}

/* ------------------------------------------------------------------ *
 * Redaction
 *
 * A redaction that samples off-canvas reads nothing, draws nothing and
 * therefore *exports the pixels it was supposed to hide*. Every readback is
 * clamped to the canvas, and the blur samples a padded ring so the kernel
 * has real neighbours to smear into instead of a hard-clipped fringe.
 * ------------------------------------------------------------------ */

type PixelRect = { x: number; y: number; width: number; height: number }

/** Clamp a normalized rect to whole pixels fully inside the canvas. */
export function clampRectToCanvas(rect: NormRect, size: Size): PixelRect {
  const x0 = Math.max(0, Math.min(size.width, Math.floor(rect.x * size.width)))
  const y0 = Math.max(0, Math.min(size.height, Math.floor(rect.y * size.height)))
  const x1 = Math.max(0, Math.min(size.width, Math.ceil((rect.x + rect.width) * size.width)))
  const y1 = Math.max(0, Math.min(size.height, Math.ceil((rect.y + rect.height) * size.height)))
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

/** Grow a pixel rect by `pad`, never past the canvas edge. */
function padRect(rect: PixelRect, pad: number, size: Size): PixelRect {
  const x0 = Math.max(0, rect.x - pad)
  const y0 = Math.max(0, rect.y - pad)
  const x1 = Math.min(size.width, rect.x + rect.width + pad)
  const y1 = Math.min(size.height, rect.y + rect.height + pad)
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

function redactKey(layer: Extract<Layer, { kind: 'redact' }>, context: string, size: Size): string {
  const region = `${layer.region.x},${layer.region.y},${layer.region.width},${layer.region.height}`
  return `${context}|${layer.id}|${layer.mode}|${layer.strength}|${region}|${layer.shape}|${size.width}x${size.height}`
}

function blockSize(strength: number): number {
  return Math.max(2, Math.round((strength / 100) * 24) + 2)
}

/** Read the region into a cached surface. Returns null if the read is impossible. */
function sampleRedact(ctx: CanvasRenderingContext2D, key: string, rect: PixelRect): Surface | null {
  const entry = acquireSurface(key, rect.width, rect.height, true)
  if (!entry) return null
  if (entry.prepared === key) return entry.surface
  try {
    const image = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
    entry.surface.ctx.putImageData(image, 0, 0)
  } catch {
    return null
  }
  entry.prepared = key
  return entry.surface
}

/**
 * Average-block downsample then nearest-neighbour back up, so a redaction
 * reads as blocks rather than as the original pixels. Both halves are cached,
 * so the two allocations happen once per (layer, mode, strength, region, size)
 * rather than once per frame.
 */
function blockifySample(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'redact' }>,
  key: string,
  rect: PixelRect,
): Surface | null {
  const block = blockSize(layer.strength)
  const source = sampleRedact(ctx, `${key}|src`, rect)
  if (!source) return null
  const small = {
    width: Math.max(1, Math.ceil(rect.width / block)),
    height: Math.max(1, Math.ceil(rect.height / block)),
  }
  const smallEntry = acquireSurface(
    `${key}|small:${small.width}x${small.height}`,
    small.width,
    small.height,
    false,
  )
  const outEntry = acquireSurface(key, rect.width, rect.height, false)
  if (!smallEntry || !outEntry) return null
  if (smallEntry.prepared !== `${key}|small:${small.width}x${small.height}`) {
    smallEntry.surface.ctx.setTransform(1, 0, 0, 1, 0, 0)
    smallEntry.surface.ctx.clearRect(0, 0, small.width, small.height)
    smallEntry.surface.ctx.imageSmoothingEnabled = true
    smallEntry.surface.ctx.drawImage(
      source.canvas,
      0,
      0,
      rect.width,
      rect.height,
      0,
      0,
      small.width,
      small.height,
    )
    smallEntry.prepared = `${key}|small:${small.width}x${small.height}`
  }
  const out = outEntry.surface
  out.ctx.setTransform(1, 0, 0, 1, 0, 0)
  out.ctx.clearRect(0, 0, rect.width, rect.height)
  out.ctx.imageSmoothingEnabled = false
  out.ctx.drawImage(
    smallEntry.surface.canvas,
    0,
    0,
    small.width,
    small.height,
    0,
    0,
    rect.width,
    rect.height,
  )
  out.ctx.imageSmoothingEnabled = true
  return out
}

function clipToRedactRegion(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'redact' }>,
  region: PixelRect,
): void {
  ctx.beginPath()
  if (layer.shape === 'ellipse') {
    ctx.ellipse(
      region.x + region.width / 2,
      region.y + region.height / 2,
      region.width / 2,
      region.height / 2,
      0,
      0,
      Math.PI * 2,
    )
    ctx.clip()
  } else {
    ctx.rect(region.x, region.y, region.width, region.height)
    ctx.clip()
  }
}

function drawRedactLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'redact' }>,
  size: Size,
  context: string,
): void {
  const region = rectToPixels(layer.region, size)
  ctx.save()
  clipToRedactRegion(ctx, layer, region)

  if (layer.mode === 'solid') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(region.x, region.y, region.width, region.height)
  } else if (layer.mode === 'emoji') {
    // The tiles are opaque, so an emoji redaction *looks* like it covers
    // anything — while the secret it was placed over is still sitting in the
    // file underneath, recoverable by anyone who lifts the tiles or simply
    // raises the contrast. Every other mode here is destructive; this one has
    // to be too, or the panel's "the original is not recoverable" is a lie.
    //
    // The cover is a flat black rather than a colour sampled from the band: a
    // sampled colour would make the cover — and so the exported bytes — a
    // function of what it is hiding, which is a much smaller leak but still a
    // leak. Flat black carries no information at all about the region.
    ctx.fillStyle = '#000000'
    ctx.fillRect(region.x, region.y, region.width, region.height)
    const step = Math.max(12, region.width / 6)
    ctx.font = `${step}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = region.y + step / 2; y < region.y + region.height; y += step) {
      for (let x = region.x + step / 2; x < region.x + region.width; x += step) {
        ctx.fillText(layer.emoji, x, y)
      }
    }
  } else {
    const sample = clampRectToCanvas(layer.region, size)
    if (sample.width < 1 || sample.height < 1) {
      // Entirely off-canvas: there are no pixels here to protect.
      ctx.restore()
      return
    }
    const key = redactKey(layer, context, size)
    if (layer.mode === 'blur') {
      // Sample a ring around the region so the blur kernel has real pixels to
      // smear; drawing the same pixels back at 1:1 also means a region that
      // runs off the canvas edge still lands in the right place.
      const radius = blockSize(layer.strength)
      const padded = padRect(sample, Math.ceil(radius), size)
      const canBlur = supportsFilter(ctx)
      const patch = canBlur ? sampleRedact(ctx, `${key}|blur`, padded) : null
      if (patch && canBlur) {
        setFilter(ctx, `blur(${radius}px)`)
        ctx.drawImage(patch.canvas, padded.x, padded.y, padded.width, padded.height)
        setFilter(ctx, 'none')
      } else {
        // Fail closed: an unreadable or unblurrable sample is a solid cover,
        // never the original pixels.
        ctx.fillStyle = '#000000'
        ctx.fillRect(region.x, region.y, region.width, region.height)
      }
    } else {
      const patch = blockifySample(ctx, layer, key, sample)
      if (patch) {
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(patch.canvas, sample.x, sample.y, sample.width, sample.height)
        ctx.imageSmoothingEnabled = true
      } else {
        ctx.fillStyle = '#000000'
        ctx.fillRect(region.x, region.y, region.width, region.height)
      }
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ *
 * Watermark
 * ------------------------------------------------------------------ */

const ANCHORS: Record<string, [number, number, CanvasTextAlign, CanvasTextBaseline]> = {
  'top-left': [0.05, 0.08, 'left', 'top'],
  'top-center': [0.5, 0.08, 'center', 'top'],
  'top-right': [0.95, 0.08, 'right', 'top'],
  'middle-left': [0.05, 0.5, 'left', 'middle'],
  center: [0.5, 0.5, 'center', 'middle'],
  'middle-right': [0.95, 0.5, 'right', 'middle'],
  'bottom-left': [0.05, 0.92, 'left', 'bottom'],
  'bottom-center': [0.5, 0.92, 'center', 'bottom'],
  'bottom-right': [0.95, 0.92, 'right', 'bottom'],
}

/**
 * The anchor is the resting place; `transform.x/y` are a normalized *offset*
 * from it, so the default transform (0.5, 0.5) is the identity and the nine
 * anchors keep working. Scale, rotation, opacity and blend all apply around
 * that resting point (D6-F04).
 */
function drawWatermarkLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'watermark' }>,
  size: Size,
  assets: CompositorAssets,
): void {
  const transform = layer.transform
  const fontSize = Math.max(12, size.height * 0.05)
  const [ax, ay, align, baseline] = ANCHORS[layer.anchor] ?? ANCHORS.center
  const restX = ax * size.width
  const restY = ay * size.height
  // Order matters, and it is the whole of D6-F04.
  //
  // The offset is canvas-space, so it goes on the outside. Scale and rotation
  // pivot on the mark's own resting point, which means translating *to* that
  // point, applying them, and translating back. The previous order —
  // translate, then scale — scaled the anchor's distance from the origin too,
  // so the default bottom-right watermark at 200% landed at x = 1.5 * width:
  // off the canvas, invisible, with the scale slider apparently doing nothing.
  ctx.translate((transform.x - 0.5) * size.width, (transform.y - 0.5) * size.height)
  ctx.translate(restX, restY)
  ctx.rotate((transform.rotation * Math.PI) / 180)
  ctx.scale(transform.scale, transform.scale)
  ctx.translate(-restX, -restY)
  // Deliberately no fudge factor on the alpha. A hard-coded 0.85 here made
  // every watermark 15% fainter than the opacity the document holds, so an
  // inspector offering that opacity would have been a control that lied about
  // its own value — worse than not offering one.

  const drawOne = (
    text: string,
    align: CanvasTextAlign,
    baseline: CanvasTextBaseline,
    cx: number,
    cy: number,
  ) => {
    if (layer.assetId) {
      const image = assets.get(layer.assetId)
      if (image) {
        const width = fontSize * 4
        const height = (image.height / image.width) * width
        ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height)
        return
      }
    }
    ctx.font = `${fontSize}px "${fontFamily(layer.fontId)}", system-ui, sans-serif`
    ctx.textAlign = align
    ctx.textBaseline = baseline
    ctx.fillStyle = layer.color
    ctx.fillText(text, cx, cy)
  }

  if (layer.tiled) {
    ctx.save()
    ctx.rotate((-30 * Math.PI) / 180)
    const stepX = size.width / 3
    const stepY = size.height / 5
    for (let y = -size.height; y < size.height * 2; y += stepY) {
      for (let x = -size.width; x < size.width * 2; x += stepX) {
        drawOne(layer.text, 'center', 'middle', x, y)
      }
    }
    ctx.restore()
  } else {
    drawOne(layer.text, align, baseline, restX, restY)
  }
}

/* ------------------------------------------------------------------ *
 * Frame
 * ------------------------------------------------------------------ */

/**
 * `inside: true` lays the whole frame band within the canvas; `false` centres
 * the band on the canvas edge so it is clipped to half its thickness. The
 * checkbox used to be a no-op, which made it a lie (D6: frame `inside`).
 */
function drawFrameLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'frame' }>,
  size: Size,
): void {
  const thickness = (layer.width / 100) * Math.min(size.width, size.height)
  const start = layer.inside ? 0 : -thickness / 2
  const span = (inset: number): PixelRect => ({
    x: start + inset,
    y: start + inset,
    width: size.width - (start + inset) * 2,
    height: size.height - (start + inset) * 2,
  })
  ctx.fillStyle = layer.color
  switch (layer.style) {
    case 'solid': {
      const box = span(thickness / 2)
      ctx.lineWidth = thickness
      ctx.strokeStyle = layer.color
      ctx.strokeRect(box.x, box.y, box.width, box.height)
      break
    }
    case 'inset': {
      const box = span(0)
      ctx.globalAlpha *= 0.85
      ctx.fillRect(box.x, box.y, box.width, thickness)
      ctx.fillRect(box.x, box.y + box.height - thickness, box.width, thickness)
      ctx.fillRect(box.x, box.y, thickness, box.height)
      ctx.fillRect(box.x + box.width - thickness, box.y, thickness, box.height)
      break
    }
    case 'polaroid': {
      const box = span(0)
      const side = thickness * 0.7
      ctx.fillRect(box.x, box.y, box.width, side)
      ctx.fillRect(box.x, box.y, side, box.height)
      ctx.fillRect(box.x + box.width - side, box.y, side, box.height)
      ctx.fillRect(box.x, box.y + box.height - thickness * 2.4, box.width, thickness * 2.4)
      break
    }
    case 'film': {
      const box = span(0)
      const bar = thickness * 1.2
      ctx.fillStyle = '#0b0b0c'
      ctx.fillRect(box.x, box.y, box.width, bar)
      ctx.fillRect(box.x, box.y + box.height - bar, box.width, bar)
      ctx.fillStyle = layer.color === '#0b0b0c' ? '#f2f2f7' : layer.color
      const hole = bar * 0.45
      for (let x = box.x + bar; x < box.x + box.width - bar; x += bar * 1.6) {
        roundRect(ctx, x, box.y + bar * 0.28, hole, hole * 0.7, 2)
        ctx.fill()
        roundRect(ctx, x, box.y + box.height - bar * 0.98, hole, hole * 0.7, 2)
        ctx.fill()
      }
      break
    }
    case 'rounded': {
      const box = span(thickness / 2)
      ctx.lineWidth = thickness
      ctx.strokeStyle = layer.color
      roundRect(ctx, box.x, box.y, box.width, box.height, thickness * 1.5)
      ctx.stroke()
      break
    }
    case 'shadow-card':
    default: {
      const box = span(thickness / 2)
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.6)'
      ctx.shadowBlur = thickness
      ctx.lineWidth = thickness * 0.5
      ctx.strokeStyle = layer.color
      ctx.strokeRect(box.x, box.y, box.width, box.height)
      ctx.restore()
      break
    }
  }
}

/* ------------------------------------------------------------------ *
 * Compositor
 * ------------------------------------------------------------------ */

/** Composite every visible layer onto an already-rendered photo canvas. */
export function drawLayers(ctx: CanvasRenderingContext2D, doc: Doc, options: ComposeOptions): void {
  const { size, assets } = options
  let cachedPhotoToken: string | null = null
  const photo = () => (cachedPhotoToken ??= photoToken(doc))
  // Layers below a redaction change its sampled pixels, so the cache key
  // carries the identity of everything drawn underneath it.
  let stack = ''
  for (const layer of doc.layers) {
    if (!layer.visible) continue
    ctx.save()
    // A redaction that can be made translucent, or blended back into whatever
    // is underneath it, is not a redaction: the hidden pixels would ship inside
    // the export. `LAYER_TRANSFORM_PARTS` keeps both controls off the panel and
    // this makes the compositor enforce it as well, so a document written by an
    // older build — or by a script — cannot leak either. (D6-F05)
    if (layer.kind === 'redact') {
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    } else {
      ctx.globalAlpha = layer.transform.opacity
      ctx.globalCompositeOperation = blendOp(layer.transform.blend)
    }
    if (layer.kind === 'frame') {
      // Frames are positioned by their own geometry, not the shared transform.
      drawFrameLayer(ctx, layer, size)
      ctx.restore()
      stack += `:${sectionToken(layer)}`
      continue
    }
    if (layer.kind === 'redact') {
      drawRedactLayer(ctx, layer, size, `${photo()}${stack}`)
      ctx.restore()
      stack += `:${sectionToken(layer)}`
      continue
    }
    if (layer.kind === 'draw') {
      // Stroke points are stored as absolute canvas-normalized coordinates
      // (not relative to the layer's transform origin), so draw layers skip
      // applyTransform entirely.
      drawDrawLayer(ctx, layer, size)
      ctx.restore()
      stack += `:${sectionToken(layer)}`
      continue
    }
    if (layer.kind === 'watermark') {
      // A watermark applies its own transform: the anchor is the resting
      // place and x/y are an offset from it, so the shared applyTransform
      // must not run first.
      drawWatermarkLayer(ctx, layer, size, assets)
      ctx.restore()
      stack += `:${sectionToken(layer)}`
      continue
    }
    applyTransform(ctx, layer.transform, size)
    switch (layer.kind) {
      case 'text':
        drawTextLayer(ctx, layer, size)
        break
      case 'shape':
        drawShapeLayer(ctx, layer, size)
        break
      case 'sticker': {
        if (layer.assetId) {
          // An uploaded sticker carries no SVG path, so the vector branch below
          // drew nothing at all. Same 25%-of-frame-height budget as the
          // built-in set, with the image's own aspect preserved.
          const image = assets.get(layer.assetId)
          if (image) {
            const height = size.height * 0.25
            const width = height * (image.width / Math.max(1, image.height))
            ctx.drawImage(image, -width / 2, -height / 2, width, height)
            break
          }
        }
        const svg = layer.svg
        const sticker = svg ? stickerById(svg) : undefined
        if (sticker) {
          const scale = (size.height * 0.25) / sticker.viewBox
          ctx.scale(scale, scale)
          ctx.translate(-sticker.viewBox / 2, -sticker.viewBox / 2)
          ctx.fillStyle = sticker.fill
          ctx.fill(new Path2D(sticker.path))
        }
        break
      }
      default:
        break
    }
    ctx.restore()
    stack += `:${sectionToken(layer)}`
  }
}
