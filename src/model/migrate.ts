import { parseHexColor } from '../lib/hex-color'
import {
  ADJUST_SPEC_BY_KEY,
  createDoc,
  DEFAULT_IDENTITY,
  DEFAULT_MULTI_WIDTHS,
  DOC_SCHEMA,
} from './defaults'
import type {
  Adjust,
  AdjustKey,
  Background,
  BlendMode,
  BrushStroke,
  CurveChannel,
  CurvePoint,
  Curves,
  Doc,
  DocIdentity,
  Effects,
  FrameStyle,
  Geometry,
  HealSpot,
  HslMix,
  Layer,
  LayerKind,
  LayerTransform,
  LocalAdjust,
  Look,
  Mask,
  NormRect,
  OutputSpec,
  PassportDoc,
  Point,
  ResizeSpec,
  Retouch,
  SourceRef,
  TextLayer,
} from './types'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function oneOf<T extends string>(allow: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allow as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * A colour is only accepted if the renderer can actually read it, and it is
 * stored back in one canonical form. `hexToRgb` used to answer "not a colour"
 * with orange, so an unvalidated `matte` or `background.color` from a
 * hand-edited recipe silently tinted the whole export instead of failing; and
 * `#FFF`, `#fff` and `fff` are the same colour, so a document that merely
 * changed spelling read as a different background to any exact string compare
 * (`PassportPanel`'s white check, `hasEdits`).
 */
function color(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const rgb = parseHexColor(value)
  if (!rgb) return fallback
  return `#${rgb
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Epoch milliseconds, or null. Rejects `Infinity`/`NaN`, which are not JSON. */
function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

function clampToSpec(key: AdjustKey, value: number): number {
  const spec = ADJUST_SPEC_BY_KEY[key]
  return clamp(value, spec.min, spec.max)
}

function mergeAdjust(raw: unknown): Adjust {
  const base = createDoc().adjust
  if (!isRecord(raw)) return base
  for (const key of Object.keys(base) as AdjustKey[]) {
    // Clamped, not merely coerced: a persisted `exposure: 999` used to survive
    // straight into `u_exposure`, and nothing between the loader and the shader
    // knows what to do with a value outside the dial's own range.
    base[key] = clampToSpec(key, num(raw[key], base[key]))
  }
  return base
}

function mergeNormRect(raw: unknown, fallback: NormRect): NormRect {
  if (!isRecord(raw)) return { ...fallback }
  const width = clamp(num(raw.width, 1), 0.001, 1)
  const height = clamp(num(raw.height, 1), 0.001, 1)
  return {
    x: clamp(num(raw.x, 0), 0, 1 - width),
    y: clamp(num(raw.y, 0), 0, 1 - height),
    width,
    height,
  }
}

function mergeGeometry(raw: unknown): Geometry {
  const base = createDoc().geometry
  if (!isRecord(raw)) return base
  if (isRecord(raw.orientation)) {
    base.orientation.quarterTurns = ((Math.round(num(raw.orientation.quarterTurns, 0)) % 4) + 4) % 4
    base.orientation.flipH = bool(raw.orientation.flipH, false)
    base.orientation.flipV = bool(raw.orientation.flipV, false)
  }
  base.straighten = clamp(num(raw.straighten, 0), -45, 45)
  // `Infinity` is a number and `> 0`, so the old check let it through — and it
  // does not survive a JSON round-trip, so a copied recipe came back with the
  // aspect lock silently released.
  base.aspectLock =
    typeof raw.aspectLock === 'number' && Number.isFinite(raw.aspectLock) && raw.aspectLock > 0
      ? raw.aspectLock
      : null
  if (isRecord(raw.perspective)) {
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      const point = raw.perspective[corner]
      if (isRecord(point)) {
        base.perspective[corner] = { x: num(point.x, 0), y: num(point.y, 0) }
      }
    }
  }
  base.crop = mergeNormRect(raw.crop, base.crop)
  return base
}

/**
 * A curve channel is only usable if it can produce a non-identity LUT. Fewer
 * than two surviving points make `buildCurveLut` return the identity table
 * while the pass planner still reports the channel as edited, so one corrupted
 * channel bought a permanently pointless draw. Junk is filtered *first* and the
 * surviving count checked *after* — the order the old length check got wrong.
 */
function mergeCurvePoints(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw)) return null
  const kept: CurvePoint[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    if (typeof entry.x !== 'number' || !Number.isFinite(entry.x)) continue
    if (typeof entry.y !== 'number' || !Number.isFinite(entry.y)) continue
    kept.push({ x: clamp(entry.x, 0, 255), y: clamp(entry.y, 0, 255) })
  }
  if (kept.length < 2) return null
  kept.sort((a, b) => a.x - b.x)
  // Two points sharing an x divide by zero in the segment slope.
  const deduped: CurvePoint[] = []
  for (const point of kept) {
    const last = deduped[deduped.length - 1]
    if (last && last.x === point.x) deduped[deduped.length - 1] = point
    else deduped.push(point)
  }
  return deduped.length >= 2 ? deduped : null
}

function mergeCurves(raw: unknown): Curves {
  const base = createDoc().curves
  if (!isRecord(raw)) return base
  for (const channel of ['rgb', 'r', 'g', 'b'] as CurveChannel[]) {
    const points = mergeCurvePoints(raw[channel])
    if (points) base[channel] = points
  }
  return base
}

const HUE_RANGE = 30
const HSL_RANGE = 100

function mergeHsl(raw: unknown): HslMix {
  const base = createDoc().hsl
  if (!isRecord(raw)) return base
  for (const band of Object.keys(base) as (keyof HslMix)[]) {
    const value = raw[band]
    if (isRecord(value)) {
      // Same ranges the HSL panel's own sliders use, so a hand-edited value
      // cannot reach `u_bands` outside what the UI can even produce.
      base[band] = {
        hue: clamp(num(value.hue, 0), -HUE_RANGE, HUE_RANGE),
        sat: clamp(num(value.sat, 0), -HSL_RANGE, HSL_RANGE),
        lum: clamp(num(value.lum, 0), -HSL_RANGE, HSL_RANGE),
      }
    }
  }
  return base
}

/** A resize magnitude is either a usable number or the spec is untrustworthy. */
function positiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null
  return Math.round(value)
}

/**
 * Per-mode resize merge, replacing a wholesale `as ResizeSpec` cast. A mode
 * whose magnitude is missing or non-numeric is downgraded to `'none'` — export
 * at the crop size — because the only alternative on offer was
 * `positive(undefined) === 1`, a one-pixel-tall export. A magnitude that is
 * merely out of range is clamped in place so the mode and its sibling
 * dimensions survive.
 */
function mergeResize(raw: unknown): ResizeSpec | null {
  if (!isRecord(raw)) return null
  switch (raw.mode) {
    case 'none':
      return { mode: 'none' }
    case 'width': {
      const width = positiveInt(raw.width)
      return width === null ? null : { mode: 'width', width }
    }
    case 'height': {
      const height = positiveInt(raw.height)
      return height === null ? null : { mode: 'height', height }
    }
    case 'longEdge': {
      const longEdge = positiveInt(raw.longEdge)
      return longEdge === null ? null : { mode: 'longEdge', longEdge }
    }
    case 'percent': {
      if (typeof raw.percent !== 'number' || !Number.isFinite(raw.percent)) return null
      return { mode: 'percent', percent: clamp(raw.percent, 0.01, 1000) }
    }
    case 'physical': {
      if (typeof raw.widthMm !== 'number' || !Number.isFinite(raw.widthMm)) return null
      if (typeof raw.heightMm !== 'number' || !Number.isFinite(raw.heightMm)) return null
      return {
        mode: 'physical',
        widthMm: clamp(raw.widthMm, 0.1, 10_000),
        heightMm: clamp(raw.heightMm, 0.1, 10_000),
        dpi: positiveInt(raw.dpi) ?? 300,
      }
    }
    default:
      return null
  }
}

const MAX_MULTI_WIDTHS = 8

/** Finite, `>= 1`, integral, ascending and de-duplicated — or the defaults. */
function mergeMultiWidths(raw: unknown, fallback: readonly number[]): number[] {
  if (!Array.isArray(raw)) return [...fallback]
  const unique = new Set<number>()
  for (const entry of raw) {
    const width = positiveInt(entry)
    if (width !== null && width <= 100_000) unique.add(width)
  }
  if (unique.size === 0) return [...fallback]
  return [...unique].sort((a, b) => a - b).slice(0, MAX_MULTI_WIDTHS)
}

const EXPORT_FORMATS = ['jpeg', 'png', 'webp', 'avif', 'pdf'] as const
const METADATA_POLICIES = ['strip', 'orientation', 'all'] as const
const SHEETS = ['none', '4x6', '5x7', 'a4'] as const

function mergeOutput(raw: unknown): OutputSpec {
  const base = createDoc().output
  if (!isRecord(raw)) return base
  base.format = oneOf<OutputSpec['format']>(EXPORT_FORMATS, raw.format, base.format)
  base.quality = clamp(num(raw.quality, base.quality), 0.01, 1)
  base.dpi = Math.max(1, Math.round(num(raw.dpi, base.dpi)))
  base.matte = color(raw.matte, base.matte)
  base.metadata = oneOf<OutputSpec['metadata']>(METADATA_POLICIES, raw.metadata, 'strip')
  base.targetBytes =
    typeof raw.targetBytes === 'number' && Number.isFinite(raw.targetBytes) && raw.targetBytes > 0
      ? Math.round(raw.targetBytes)
      : null
  base.multiWidths = mergeMultiWidths(raw.multiWidths, DEFAULT_MULTI_WIDTHS)
  base.sheet = oneOf<OutputSpec['sheet']>(SHEETS, raw.sheet, 'none')
  const resize = mergeResize(raw.resize)
  if (resize) base.resize = resize
  return base
}

/* -------------------------------------------------------------------------- */
/* Layers                                                                      */
/* -------------------------------------------------------------------------- */

const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'soft-light',
  'hard-light',
]

const LAYER_KINDS: LayerKind[] = [
  'text',
  'sticker',
  'shape',
  'draw',
  'redact',
  'watermark',
  'frame',
]

const SHAPE_KINDS = ['rect', 'ellipse', 'line', 'arrow'] as const
const BRUSHES = ['pen', 'marker', 'highlighter', 'neon', 'eraser'] as const
const REDACT_MODES = ['pixelate', 'blur', 'solid', 'emoji'] as const
const REDACT_SHAPES = ['rect', 'ellipse'] as const
const FRAME_STYLES: FrameStyle[] = ['solid', 'inset', 'polaroid', 'film', 'rounded', 'shadow-card']
const TEXT_ALIGNS: TextLayer['style']['align'][] = ['left', 'center', 'right']
const WATERMARK_ANCHORS: Extract<Doc['layers'][number], { kind: 'watermark' }>['anchor'][] = [
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

function mergeTransform(raw: unknown): LayerTransform | null {
  if (!isRecord(raw)) return null
  return {
    x: num(raw.x, 0.5),
    y: num(raw.y, 0.5),
    scale: Math.max(0, num(raw.scale, 1)),
    rotation: num(raw.rotation, 0),
    opacity: clamp(num(raw.opacity, 1), 0, 1),
    blend: oneOf<BlendMode>(BLEND_MODES, raw.blend, 'normal'),
  }
}

function mergePoint(raw: unknown): Point | null {
  if (!isRecord(raw)) return null
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x)) return null
  if (typeof raw.y !== 'number' || !Number.isFinite(raw.y)) return null
  return { x: raw.x, y: raw.y }
}

function mergeStrokes(raw: unknown): BrushStroke[] {
  if (!Array.isArray(raw)) return []
  const strokes: BrushStroke[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || !Array.isArray(entry.points)) continue
    const points: Point[] = []
    for (const point of entry.points) {
      const merged = mergePoint(point)
      if (merged) points.push(merged)
    }
    if (points.length === 0) continue
    const stroke: BrushStroke = {
      points,
      radius: Math.max(0.1, num(entry.radius, 2)),
      hardness: clamp(num(entry.hardness, 0.5), 0, 1),
    }
    if (typeof entry.erase === 'boolean') stroke.erase = entry.erase
    strokes.push(stroke)
  }
  return strokes
}

/**
 * A layer is kept only if the compositor could actually draw it. The old check
 * was `typeof kind === 'string' && typeof id === 'string'`, so `{id, kind:'text'}`
 * — with no `transform` and no `style` — survived migration and then threw in
 * `render/layers.ts` on the first frame. Malformed layers are dropped; the
 * scalars a kind can live without are defaulted.
 */
function mergeLayer(raw: unknown): Layer | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id, '')
  if (!id || !(LAYER_KINDS as string[]).includes(str(raw.kind, ''))) return null
  const kind = raw.kind as LayerKind
  const transform = mergeTransform(raw.transform)
  if (!transform) return null

  const header = {
    id,
    kind,
    name: str(raw.name, ''),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, false),
    transform,
  }

  switch (kind) {
    case 'text': {
      if (!isRecord(raw.style)) return null
      const style = raw.style
      return {
        ...header,
        kind: 'text',
        text: str(raw.text, ''),
        style: {
          fontId: str(style.fontId, 'inter'),
          size: Math.max(1, num(style.size, 24)),
          color: color(style.color, '#ffffff'),
          align: oneOf(TEXT_ALIGNS, style.align, 'center'),
          lineHeight: Math.max(0.1, num(style.lineHeight, 1.2)),
          tracking: num(style.tracking, 0),
          bold: bool(style.bold, false),
          italic: bool(style.italic, false),
          strokeColor: color(style.strokeColor, '#000000'),
          strokeWidth: Math.max(0, num(style.strokeWidth, 0)),
          shadow: bool(style.shadow, false),
          pillBackground: typeof style.pillBackground === 'string' ? style.pillBackground : null,
          arc: num(style.arc, 0),
        },
      }
    }
    case 'sticker':
      return {
        ...header,
        kind: 'sticker',
        svg: typeof raw.svg === 'string' ? raw.svg : null,
        assetId: typeof raw.assetId === 'string' ? raw.assetId : null,
      }
    case 'shape':
      if (!(SHAPE_KINDS as readonly string[]).includes(str(raw.shape, ''))) return null
      return {
        ...header,
        kind: 'shape',
        shape: oneOf(SHAPE_KINDS, raw.shape, 'rect'),
        fill: color(raw.fill, '#ffffff'),
        stroke: color(raw.stroke, '#000000'),
        strokeWidth: Math.max(0, num(raw.strokeWidth, 0)),
        width: Math.max(0, num(raw.width, 0.3)),
        height: Math.max(0, num(raw.height, 0.3)),
      }
    case 'draw':
      return {
        ...header,
        kind: 'draw',
        brush: oneOf(BRUSHES, raw.brush, 'pen'),
        color: color(raw.color, '#ffffff'),
        size: Math.max(0.1, num(raw.size, 2)),
        strokes: mergeStrokes(raw.strokes),
      }
    case 'redact':
      return {
        ...header,
        kind: 'redact',
        mode: oneOf(REDACT_MODES, raw.mode, 'pixelate'),
        strength: clamp(num(raw.strength, 50), 0, 100),
        emoji: str(raw.emoji, ''),
        region: mergeNormRect(raw.region, { x: 0, y: 0, width: 1, height: 1 }),
        shape: oneOf(REDACT_SHAPES, raw.shape, 'rect'),
      }
    case 'watermark':
      return {
        ...header,
        kind: 'watermark',
        text: str(raw.text, ''),
        fontId: str(raw.fontId, 'inter'),
        color: color(raw.color, '#ffffff'),
        assetId: typeof raw.assetId === 'string' ? raw.assetId : null,
        anchor: oneOf(WATERMARK_ANCHORS, raw.anchor, 'bottom-right'),
        tiled: bool(raw.tiled, false),
      }
    case 'frame':
      return {
        ...header,
        kind: 'frame',
        style: oneOf(FRAME_STYLES, raw.style, 'solid'),
        color: color(raw.color, '#ffffff'),
        width: Math.max(0, num(raw.width, 6)),
        inside: bool(raw.inside, true),
      }
  }
}

/* -------------------------------------------------------------------------- */
/* Legacy flat EditorState (no `schema` field at all)                          */
/* -------------------------------------------------------------------------- */

function mergeLegacy(raw: UnknownRecord): Doc {
  const doc = createDoc()
  // The flat EditorState also wrote `source` as a bare asset id. Without this
  // the document came back with no source at all, so a legacy session could
  // never be resumed no matter that its bytes were still in IndexedDB.
  const source = migrateSource(remapV1Source(raw.source))
  if (source) doc.source = source
  // The old flat EditorState used 100 as neutral for brightness/contrast/
  // saturation; the new Adjust model is 0-neutral.
  doc.adjust.brightness = num(raw.brightness, 100) - 100
  doc.adjust.contrast = num(raw.contrast, 100) - 100
  doc.adjust.saturation = num(raw.saturation, 100) - 100
  doc.geometry.orientation.flipH = bool(raw.flipH, false)
  doc.geometry.orientation.flipV = bool(raw.flipV, false)
  const rotation = ((Math.round(num(raw.rotation, 0)) % 360) + 360) % 360
  doc.geometry.orientation.quarterTurns = Math.round(rotation / 90) % 4
  doc.geometry.straighten = clamp(rotation % 90, -45, 45)
  if (
    raw.format === 'jpeg' ||
    raw.format === 'png' ||
    raw.format === 'webp' ||
    raw.format === 'pdf'
  ) {
    doc.output.format = raw.format
  }
  doc.output.quality = clamp(num(raw.quality, doc.output.quality), 0.01, 1)
  doc.output.matte = color(raw.matte, doc.output.matte)
  const outWidth = num(raw.outWidth, 0)
  if (outWidth > 0) doc.output.resize = { mode: 'width', width: Math.round(outWidth) }
  // The legacy crop was a rect on a 0..10 grid, not a 0..1 fraction.
  doc.geometry.crop = mergeLegacyCrop(raw.crop)
  doc.identity = migrateIdentity(raw.identity)
  return doc
}

function mergeLegacyCrop(raw: unknown): NormRect {
  if (!isRecord(raw)) return { x: 0, y: 0, width: 1, height: 1 }
  const width = clamp(num(raw.width, 10) / 10, 0.001, 1)
  const height = clamp(num(raw.height, 10) / 10, 0.001, 1)
  return {
    x: clamp(num(raw.x, 0) / 10, 0, 1 - width),
    y: clamp(num(raw.y, 0) / 10, 0, 1 - height),
    width,
    height,
  }
}

/* -------------------------------------------------------------------------- */
/* Schema 1 and 2                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Schema 1 was a flat document: no `geometry` object, a 0..1000 integer crop, a
 * 100-neutral `adjust` under two other key names, a bare asset-id `source`, a
 * `"16:9"` aspect string and a flat `output.width`.
 *
 * Schema 2 had already introduced the nested `geometry` and the 0-neutral
 * `adjust`, but still wrote the output size flat, stored rotation as loose
 * numbers beside the crop, and kept one composite `curve` instead of a
 * four-channel record.
 *
 * Both remaps are total — an unrecognised field is dropped, never rejected — and
 * both produce a *current-schema* record that `normalizeCurrent` then
 * validates. The old branch relabelled the payload and recursed, so every one
 * of these genuine v1/v2 fields was silently thrown away.
 */
function remapV1(input: UnknownRecord): UnknownRecord {
  const adjust = isRecord(input.adjust) ? input.adjust : {}
  const output = isRecord(input.output) ? input.output : {}
  const rotation = ((num(input.rotation, 0) % 360) + 360) % 360
  return {
    ...input,
    schema: DOC_SCHEMA,
    source: remapV1Source(input.source),
    geometry: {
      orientation: {
        quarterTurns: Math.round(rotation / 90) % 4,
        flipH: bool(input.flipH, false),
        flipV: bool(input.flipV, false),
      },
      straighten: clamp(rotation % 90, -45, 45),
      crop: remapThousandthRect(input.crop),
      aspectLock: remapAspect(input.aspect),
    },
    adjust: {
      ...adjust,
      brightness: num(adjust.brightness, 100) - 100,
      contrast: num(adjust.contrast, 100) - 100,
      saturation: num(adjust.saturation, 100) - 100,
      // v1 spelled two of today's controls something else entirely.
      warmth: num(adjust.temperature, num(adjust.warmth, 0)),
      definition: num(adjust.clarity, num(adjust.definition, 0)),
      blackPoint: num(adjust.blackpoint, num(adjust.blackPoint, 0)),
    },
    output: { ...output, resize: remapFlatSize(output) },
    background: remapV1Background(input.background),
  }
}

function remapV2(input: UnknownRecord): UnknownRecord {
  const output = isRecord(input.output) ? input.output : {}
  const geometry = isRecord(input.geometry) ? input.geometry : {}
  const remapped: UnknownRecord = {
    ...input,
    schema: DOC_SCHEMA,
    output: { ...output, resize: remapFlatSize(output) },
  }
  const rotation = num(geometry.rotation, num(input.rotation, 0))
  if (rotation !== 0) {
    remapped.geometry = {
      ...geometry,
      orientation: {
        quarterTurns: Math.round((((rotation % 360) + 360) % 360) / 90) % 4,
        flipH: bool(geometry.flipH, bool(input.flipH, false)),
        flipV: bool(geometry.flipV, bool(input.flipV, false)),
      },
      straighten: clamp((((rotation % 360) + 360) % 360) % 90, -45, 45),
    }
  }
  if (Array.isArray(input.curve) && !isRecord(input.curves)) {
    remapped.curves = { rgb: input.curve }
  }
  return remapped
}

/** v1 stored `source` as a bare asset-id string. */
function remapV1Source(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  return { assetId: raw, width: 0, height: 0, name: 'image', mime: 'image/jpeg' }
}

/** v1 wrote a crop as integers on a 0..1000 grid. */
function remapThousandthRect(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined
  return {
    x: num(raw.x, 0) / 1000,
    y: num(raw.y, 0) / 1000,
    width: num(raw.width, 1000) / 1000,
    height: num(raw.height, 1000) / 1000,
  }
}

/** v1 typed the aspect lock as a `"16:9"` string or a bare number. */
function remapAspect(raw: unknown): unknown {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const parts = raw.split(':')
  if (parts.length !== 2) return null
  const width = Number(parts[0])
  const height = Number(parts[1])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return width / height
}

/** v1/v2 wrote `output.width`/`output.height` instead of a `resize` spec. */
function remapFlatSize(output: UnknownRecord): unknown {
  if (isRecord(output.resize)) return undefined
  const width = num(output.width, 0)
  const height = num(output.height, 0)
  if (width >= 1) return { mode: 'width', width: Math.round(width) }
  if (height >= 1) return { mode: 'height', height: Math.round(height) }
  return undefined
}

/** v1 spelled the background as a bare hex string. */
function remapV1Background(raw: unknown): unknown {
  if (typeof raw !== 'string' || parseHexColor(raw) === null) return raw
  return { mode: 'color', color: raw }
}

/* -------------------------------------------------------------------------- */

/**
 * Migrate any persisted/unknown document into the current `Doc` schema.
 * Returns null only when the input is not recognizably a document at all.
 *
 * This must stay pure and defensive: IndexedDB sessions outlive deploys, so a
 * doc written by an older build has to load without throwing. Nothing here
 * reads the clock or a random source — a document must migrate to the same
 * value every time, or a recipe copied twice would stop matching itself.
 */
export function migrateDoc(input: unknown): Doc | null {
  if (!isRecord(input)) return null

  const schema = num(input.schema, 0)
  if (schema === DOC_SCHEMA) return normalizeCurrent(input)
  if (schema === 1) return normalizeCurrent(remapV1(input))
  if (schema === 2) return normalizeCurrent(remapV2(input))

  // Legacy flat EditorState (no schema field) — recognizable by rotation/
  // brightness/outWidth.
  if ('rotation' in input || 'brightness' in input || 'outWidth' in input || 'flipH' in input) {
    return mergeLegacy(input)
  }

  return null
}

function normalizeCurrent(input: UnknownRecord): Doc {
  return {
    schema: DOC_SCHEMA,
    source: migrateSource(input.source),
    geometry: mergeGeometry(input.geometry),
    adjust: mergeAdjust(input.adjust),
    curves: mergeCurves(input.curves),
    hsl: mergeHsl(input.hsl),
    look: migrateLook(input.look),
    effects: migrateEffects(input.effects),
    masks: Array.isArray(input.masks) ? (input.masks.filter(isRecord) as unknown as Mask[]) : [],
    localAdjusts: Array.isArray(input.localAdjusts)
      ? (input.localAdjusts.filter(isRecord) as unknown as LocalAdjust[])
      : [],
    retouch: migrateRetouch(input.retouch),
    background: migrateBackground(input.background),
    layers: Array.isArray(input.layers)
      ? (input.layers.map(mergeLayer).filter((layer) => layer !== null) as Layer[])
      : [],
    output: mergeOutput(input.output),
    passport: migratePassport(input.passport),
    identity: migrateIdentity(input.identity),
  }
}

function migrateSource(raw: unknown): SourceRef | null {
  if (!isRecord(raw) || typeof raw.assetId !== 'string') return null
  return {
    assetId: raw.assetId,
    width: Math.max(1, Math.round(num(raw.width, 1))),
    height: Math.max(1, Math.round(num(raw.height, 1))),
    name: str(raw.name, 'image'),
    mime: str(raw.mime, 'image/jpeg'),
  }
}

/**
 * `writer` is *preserved* when the incoming document carries one — that is the
 * whole point of the stamp, since "written by 0.9" has to stay distinguishable
 * from "written by 1.0" across a load. Only an absent stamp is filled in, and
 * the timestamps stay `null` rather than being invented here: stamping is the
 * writer's job, and a migration that called `Date.now()` would not be pure.
 */
function migrateIdentity(raw: unknown): DocIdentity {
  const base = { ...DEFAULT_IDENTITY }
  if (!isRecord(raw)) return base
  base.createdAt = epoch(raw.createdAt)
  base.updatedAt = epoch(raw.updatedAt)
  const writer = str(raw.writer, '').trim()
  if (writer) base.writer = writer
  return base
}

function migrateLook(raw: unknown): Look {
  const base = createDoc().look
  if (!isRecord(raw)) return base
  base.id = typeof raw.id === 'string' ? raw.id : null
  base.amount = clamp(num(raw.amount, 1), 0, 1)
  return base
}

function migrateEffects(raw: unknown): Effects {
  const base = createDoc().effects
  if (!isRecord(raw)) return base
  // The pass planner divides these by 100, so 0..100 is the real range.
  base.grain = clamp(num(raw.grain, 0), 0, 100)
  base.bloom = clamp(num(raw.bloom, 0), 0, 100)
  base.fieldBlur = clamp(num(raw.fieldBlur, 0), 0, 100)
  return base
}

function migrateRetouch(raw: unknown): Retouch {
  const base = createDoc().retouch
  if (!isRecord(raw)) return base
  base.smooth = clamp(num(raw.smooth, 0), 0, 100)
  base.healSpots = mergeHealSpots(raw.healSpots)
  base.redEye = mergeSpots(raw.redEye)
  return base
}

function mergeSpots(raw: unknown): { at: Point; radius: number }[] {
  if (!Array.isArray(raw)) return []
  const spots: { at: Point; radius: number }[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const at = mergePoint(entry.at)
    if (!at) continue
    spots.push({ at, radius: Math.max(0, num(entry.radius, 0)) })
  }
  return spots
}

/**
 * Entries without a usable `at` are dropped, not cast through with `as never`.
 * A missing `id` is *not* filled in: minting one here would make migration
 * impure and an id invented at load time could never be matched against a spot
 * the UI holds in its own state.
 */
function mergeHealSpots(raw: unknown): HealSpot[] {
  if (!Array.isArray(raw)) return []
  const spots: HealSpot[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const at = mergePoint(entry.at)
    if (!at) continue
    spots.push({ id: str(entry.id, ''), at, radius: Math.max(0, num(entry.radius, 0)) })
  }
  return spots
}

function migrateBackground(raw: unknown): Background {
  const base = createDoc().background
  if (!isRecord(raw)) return base
  base.mode = oneOf<Background['mode']>(['none', 'color', 'gradient', 'image'], raw.mode, 'none')
  base.color = color(raw.color, base.color)
  base.fit = oneOf<Background['fit']>(['cover', 'contain'], raw.fit, 'cover')
  base.blur = clamp(num(raw.blur, 0), 0, 1)
  base.removed = bool(raw.removed, false)
  base.imageAssetId = typeof raw.imageAssetId === 'string' ? raw.imageAssetId : null
  if (isRecord(raw.gradient)) {
    base.gradient = {
      from: color(raw.gradient.from, base.gradient.from),
      to: color(raw.gradient.to, base.gradient.to),
      angle: num(raw.gradient.angle, base.gradient.angle),
    }
  }
  return base
}

function migratePassport(raw: unknown): PassportDoc | null {
  if (!isRecord(raw) || typeof raw.specId !== 'string') return null
  return { specId: raw.specId, backgroundApplied: bool(raw.backgroundApplied, false) }
}
