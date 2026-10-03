import { createId } from '../../model/ids'
import type {
  BlendMode,
  DrawLayer,
  FrameLayer,
  FrameStyle,
  LayerKind,
  LayerTransform,
  RedactLayer,
  ShapeLayer,
  StickerLayer,
  TextLayer,
  WatermarkLayer,
} from '../../model/types'
import { DEFAULT_FONT_ID } from './fonts'

export function defaultTransform(): LayerTransform {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' }
}

/**
 * Which parts of `LayerTransform` each kind actually honours in
 * `drawLayers` (src/render/layers.ts). `frame`, `redact` and `draw` are drawn
 * from their own absolute geometry, so their position/scale/rotation were
 * silently discarded — which is why the canvas used to offer a drag for a
 * frame and nothing moved. The UI reads this table to hide controls it cannot
 * honour, so a control and a rendered pixel can never disagree (D6-F08/F12).
 */
export type TransformParts = {
  position: boolean
  scale: boolean
  rotation: boolean
  opacity: boolean
  blend: boolean
}

export const LAYER_TRANSFORM_PARTS: Record<LayerKind, TransformParts> = {
  text: { position: true, scale: true, rotation: true, opacity: true, blend: true },
  sticker: { position: true, scale: true, rotation: true, opacity: true, blend: true },
  shape: { position: true, scale: true, rotation: true, opacity: true, blend: true },
  draw: { position: false, scale: false, rotation: false, opacity: true, blend: true },
  // A redaction with an opacity slider or a blend mode is a redaction that can
  // be made see-through, and a see-through redaction ships the pixels it was
  // supposed to hide. The controls are not offered, and `drawLayers` enforces
  // the same rule so a document written by an older build cannot leak either.
  redact: { position: false, scale: false, rotation: false, opacity: false, blend: false },
  watermark: { position: true, scale: true, rotation: true, opacity: true, blend: true },
  frame: { position: false, scale: false, rotation: false, opacity: true, blend: true },
}

/** True when dragging the canvas should move this kind, i.e. x/y mean something. */
export function isDraggableLayer(kind: LayerKind): boolean {
  return LAYER_TRANSFORM_PARTS[kind].position
}

/**
 * The text a new text layer starts with, and the name the layers list shows.
 *
 * "Edit this text" rather than "Tap to edit": it is the layer's *name*, which the
 * list prints as "Text · Edit this text" and which a screen reader reads on the
 * row, and no word in it is an instruction to a particular device — the panel
 * beside it is where the text is edited.
 */
export function createTextLayer(text = 'Edit this text'): TextLayer {
  return {
    id: createId('text'),
    kind: 'text',
    name: text.slice(0, 16),
    visible: true,
    transform: defaultTransform(),
    text,
    style: {
      fontId: DEFAULT_FONT_ID,
      size: 8,
      color: '#ffffff',
      align: 'center',
      lineHeight: 1.2,
      tracking: 0,
      bold: false,
      italic: false,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadow: false,
      pillBackground: null,
      arc: 0,
    },
  }
}

export function createStickerLayer(stickerId: string): StickerLayer {
  return {
    id: createId('sticker'),
    kind: 'sticker',
    name: stickerId,
    visible: true,
    transform: defaultTransform(),
    svg: stickerId,
    assetId: null,
  }
}

export function createShapeLayer(shape: ShapeLayer['shape']): ShapeLayer {
  // A line and an arrow are not 30% x 30% boxes; giving each shape a sane
  // starting box is what makes the width/height sliders worth having.
  const box: Record<ShapeLayer['shape'], { width: number; height: number }> = {
    rect: { width: 0.3, height: 0.3 },
    ellipse: { width: 0.3, height: 0.3 },
    line: { width: 0.5, height: 0.02 },
    arrow: { width: 0.4, height: 0.18 },
  }
  return {
    id: createId('shape'),
    kind: 'shape',
    name: shape,
    visible: true,
    transform: defaultTransform(),
    shape,
    fill: '#38b28c',
    stroke: '#ffffff',
    strokeWidth: 1,
    width: box[shape].width,
    height: box[shape].height,
  }
}

export function createDrawLayer(): DrawLayer {
  return {
    id: createId('draw'),
    kind: 'draw',
    name: 'Drawing',
    visible: true,
    transform: defaultTransform(),
    brush: 'pen',
    color: '#ff3b30',
    size: 2,
    strokes: [],
  }
}

export function createRedactLayer(): RedactLayer {
  return {
    id: createId('redact'),
    kind: 'redact',
    name: 'Redaction',
    visible: true,
    transform: defaultTransform(),
    mode: 'pixelate',
    strength: 50,
    emoji: '🙂',
    region: { x: 0.3, y: 0.35, width: 0.4, height: 0.3 },
    shape: 'rect',
  }
}

export function createWatermarkLayer(): WatermarkLayer {
  return {
    id: createId('watermark'),
    kind: 'watermark',
    name: 'Watermark',
    visible: true,
    transform: defaultTransform(),
    text: '© Your Name',
    fontId: DEFAULT_FONT_ID,
    color: '#ffffff',
    assetId: null,
    anchor: 'bottom-right',
    tiled: false,
  }
}

export function createFrameLayer(style: FrameStyle): FrameLayer {
  return {
    id: createId('frame'),
    kind: 'frame',
    name: 'Frame',
    visible: true,
    transform: defaultTransform(),
    style,
    color: style === 'solid' ? '#ffffff' : '#111114',
    width: 6,
    inside: true,
  }
}

export function blendModes(): BlendMode[] {
  return [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'soft-light',
    'hard-light',
  ]
}

/** Short labels for the blend `SegmentedControl`; the full name is the tooltip. */
export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'soft-light': 'Soft',
  'hard-light': 'Hard',
}

export const REDACT_MODES: RedactLayer['mode'][] = ['pixelate', 'blur', 'solid', 'emoji']

export const BRUSHES: DrawLayer['brush'][] = ['pen', 'marker', 'highlighter', 'neon', 'eraser']

/** Text brushes differ in width and alpha so the five options are not aliases. */
export type BrushStyle = {
  widthScale: number
  alpha: number
  composite: GlobalCompositeOperation
  soft: number
  glow: number
}

export const BRUSH_STYLES: Record<DrawLayer['brush'], BrushStyle> = {
  pen: { widthScale: 1, alpha: 1, composite: 'source-over', soft: 0, glow: 0 },
  marker: { widthScale: 1.7, alpha: 0.9, composite: 'source-over', soft: 0.15, glow: 0 },
  highlighter: { widthScale: 3.2, alpha: 0.35, composite: 'multiply', soft: 0.35, glow: 0 },
  neon: { widthScale: 1, alpha: 1, composite: 'source-over', soft: 0, glow: 1.6 },
  eraser: { widthScale: 1.4, alpha: 1, composite: 'destination-out', soft: 0, glow: 0 },
}
