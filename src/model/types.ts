/**
 * The non-destructive document model.
 *
 * `Doc` is intentionally a plain, JSON-serializable object: it never holds an
 * `ImageBitmap`, `Blob`, canvas or any other live resource. Pixels live in an
 * out-of-band `AssetStore` keyed by `AssetId`. That single rule is what makes
 * undo/redo, IndexedDB persistence, WebGL context-loss recovery and
 * copy/paste-edits all cheap, because a `Doc` can always be structurally
 * cloned and re-rendered from scratch.
 */

export type AssetId = string

/**
 * The document schema number. This is the only copy of the value in the
 * repository: `DocSchema` is *derived* from it below, and every other module
 * imports the constant rather than writing `3`. Bumping the schema anywhere
 * else used to be a silent bug — `migrateDoc` returns `null` for a payload it
 * does not recognise, so a stray literal turns every saved recipe into
 * "Nothing to paste".
 */
export const DOC_SCHEMA = 3

/** The type of `Doc.schema` — always exactly `typeof DOC_SCHEMA`. */
export type DocSchema = typeof DOC_SCHEMA

/** A normalized rectangle (0..1) in some well-defined image space. */
export type NormRect = {
  x: number
  y: number
  width: number
  height: number
}

export type Point = { x: number; y: number }

/** Corner offsets for a 4-corner perspective warp, normalized to the image. */
export type Perspective = {
  topLeft: Point
  topRight: Point
  bottomLeft: Point
  bottomRight: Point
}

export type Orientation = {
  /** Number of 90° clockwise turns, 0..3. */
  quarterTurns: number
  flipH: boolean
  flipV: boolean
}

export type Geometry = {
  orientation: Orientation
  /** Fine straighten angle in degrees, -45..45. */
  straighten: number
  perspective: Perspective
  /**
   * Crop, normalized 0..1 in *straightened-image space* (orientation +
   * straighten already applied). Because it is normalized it survives
   * flip/rotate losslessly — the rect is transformed, never thrown away.
   */
  crop: NormRect
  /** Locked aspect ratio (w/h) or null for freeform. */
  aspectLock: number | null
}

export type Adjust = {
  exposure: number
  brilliance: number
  highlights: number
  shadows: number
  contrast: number
  brightness: number
  blackPoint: number
  saturation: number
  vibrance: number
  warmth: number
  tint: number
  sharpness: number
  definition: number
  noiseReduction: number
  vignette: number
}

export type AdjustKey = keyof Adjust

/** A single control point, 0..255 on each axis. */
export type CurvePoint = { x: number; y: number }

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b'

export type Curves = Record<CurveChannel, CurvePoint[]>

export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta'

export type HslMix = Record<HslBand, { hue: number; sat: number; lum: number }>

export type Look = {
  /** LUT id from `public/luts/`, or null for none. */
  id: string | null
  /** Blend amount, 0..1. */
  amount: number
}

export type Effects = {
  grain: number
  bloom: number
  /** Field/portrait blur amount, 0..1. */
  fieldBlur: number
}

export type BrushStroke = {
  /** Normalized points in cropped-output space. */
  points: Point[]
  radius: number
  hardness: number
  /** true erases from the mask. */
  erase?: boolean
}

export type Mask =
  | { id: string; kind: 'subject'; enabled: boolean; feather: number }
  | { id: string; kind: 'brush'; enabled: boolean; feather: number; strokes: BrushStroke[] }
  | {
      id: string
      kind: 'linear'
      enabled: boolean
      feather: number
      from: Point
      to: Point
    }
  | {
      id: string
      kind: 'radial'
      enabled: boolean
      feather: number
      center: Point
      radiusX: number
      radiusY: number
      rotation: number
      invert: boolean
    }
  | {
      id: string
      kind: 'luminance'
      enabled: boolean
      feather: number
      low: number
      high: number
      invert: boolean
    }

export type MaskKind = Mask['kind']

export type LocalAdjust = {
  id: string
  maskId: string
  values: Partial<Adjust>
  enabled: boolean
}

export type HealSpot = {
  id: string
  /** Normalized cropped-output space. */
  at: Point
  radius: number
}

export type Retouch = {
  smooth: number
  healSpots: HealSpot[]
  redEye: { at: Point; radius: number }[]
}

export type Background = {
  mode: 'none' | 'color' | 'gradient' | 'image'
  color: string
  gradient: { from: string; to: string; angle: number }
  imageAssetId: AssetId | null
  fit: 'cover' | 'contain'
  blur: number
  /** True once a subject matte has been produced for this doc. */
  removed: boolean
}

export type BlendMode =
  'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'soft-light' | 'hard-light'

export type LayerTransform = {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  blend: BlendMode
}

export type TextStyle = {
  fontId: string
  size: number
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number
  tracking: number
  bold: boolean
  italic: boolean
  strokeColor: string
  strokeWidth: number
  shadow: boolean
  pillBackground: string | null
  arc: number
}

/**
 * The fields every layer kind shares. Each kind adds its own `kind` literal
 * plus its own payload, so a `Layer` is still a discriminated union that
 * narrows on `kind` and a switch is still exhaustive.
 */
export type LayerHeader = {
  id: string
  name: string
  visible: boolean
  /**
   * Blocks drag, reorder and delete in the layer list. Optional in the type so
   * a literal built by code that predates the flag still type-checks; reading it
   * as a plain truthiness test is correct either way, and `migrateDoc` always
   * fills it with a real boolean. Promote to `locked: boolean` once every
   * constructor (`src/features/layers/factory.ts`, `src/render/layers.ts`,
   * `src/store/actions.ts` and the three test files that build layer literals)
   * passes it explicitly.
   */
  locked?: boolean
  transform: LayerTransform
}

export type TextLayer = LayerHeader & {
  kind: 'text'
  text: string
  style: TextStyle
}

export type StickerLayer = LayerHeader & {
  kind: 'sticker'
  /** Inline SVG markup for built-in stickers. */
  svg: string | null
  assetId: AssetId | null
}

export type ShapeLayer = LayerHeader & {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line' | 'arrow'
  fill: string
  stroke: string
  strokeWidth: number
  width: number
  height: number
}

export type DrawLayer = LayerHeader & {
  kind: 'draw'
  brush: 'pen' | 'marker' | 'highlighter' | 'neon' | 'eraser'
  color: string
  size: number
  strokes: BrushStroke[]
}

export type RedactLayer = LayerHeader & {
  kind: 'redact'
  mode: 'pixelate' | 'blur' | 'solid' | 'emoji'
  strength: number
  emoji: string
  region: NormRect
  shape: 'rect' | 'ellipse'
}

export type WatermarkLayer = LayerHeader & {
  kind: 'watermark'
  text: string
  fontId: string
  color: string
  assetId: AssetId | null
  anchor:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'middle-left'
    | 'center'
    | 'middle-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right'
  tiled: boolean
}

export type FrameStyle = 'solid' | 'inset' | 'polaroid' | 'film' | 'rounded' | 'shadow-card'

export type FrameLayer = LayerHeader & {
  kind: 'frame'
  style: FrameStyle
  color: string
  width: number
  inside: boolean
}

export type Layer =
  TextLayer | StickerLayer | ShapeLayer | DrawLayer | RedactLayer | WatermarkLayer | FrameLayer

export type LayerKind = Layer['kind']

export type ResizeSpec =
  | { mode: 'none' }
  | { mode: 'width'; width: number }
  | { mode: 'height'; height: number }
  | { mode: 'longEdge'; longEdge: number }
  | { mode: 'percent'; percent: number }
  | { mode: 'physical'; widthMm: number; heightMm: number; dpi: number }

export type ExportFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'pdf'

export type MetadataPolicy = 'strip' | 'orientation' | 'all'

export type OutputSpec = {
  format: ExportFormat
  quality: number
  resize: ResizeSpec
  dpi: number
  matte: string
  metadata: MetadataPolicy
  /** Target maximum size in bytes, or null. */
  targetBytes: number | null
  /**
   * Widths the multi-size ZIP renders at, ascending and de-duplicated. Lives in
   * the document so the choice survives a reload instead of resetting to the
   * defaults every time the export sheet is opened.
   */
  multiWidths: number[]
  /** Printable sheet size. */
  sheet: 'none' | '4x6' | '5x7' | 'a4'
}

export type PassportDoc = {
  specId: string
  /** Whether the background has been forced to the spec value. */
  backgroundApplied: boolean
}

export type SourceRef = {
  assetId: AssetId
  width: number
  height: number
  name: string
  mime: string
}

/**
 * Identity and provenance. These are *not* editor state: they describe who
 * wrote the document and when, so a future migration can tell a row saved by
 * 1.0 from one saved by 1.1 instead of guessing from the field set.
 *
 * `createdAt`/`updatedAt` are epoch milliseconds and default to `null` rather
 * than `Date.now()`. A default that reads the clock would make `createDoc()`
 * non-deterministic and `migrateDoc` impure, so the *writer* stamps them; a
 * migrated document carries `null` ("written before we stamped this") and that
 * is information, not a gap.
 */
export type DocIdentity = {
  createdAt: number | null
  updatedAt: number | null
  /** `APP_VERSION` of the build that last wrote the document. */
  writer: string
}

export type Doc = {
  schema: DocSchema
  source: SourceRef | null
  geometry: Geometry
  adjust: Adjust
  curves: Curves
  hsl: HslMix
  look: Look
  effects: Effects
  masks: Mask[]
  localAdjusts: LocalAdjust[]
  retouch: Retouch
  background: Background
  layers: Layer[]
  output: OutputSpec
  passport: PassportDoc | null
  identity: DocIdentity
}

export type Size = { width: number; height: number }
