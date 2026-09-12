import { createId } from '../../model/ids';
import type {
  BlendMode,
  DrawLayer,
  FrameLayer,
  FrameStyle,
  LayerTransform,
  RedactLayer,
  ShapeLayer,
  StickerLayer,
  TextLayer,
  WatermarkLayer,
} from '../../model/types';
import { DEFAULT_FONT_ID } from './fonts';

export function defaultTransform(): LayerTransform {
  return { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' };
}

export function createTextLayer(text = 'Tap to edit'): TextLayer {
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
  };
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
  };
}

export function createShapeLayer(shape: ShapeLayer['shape']): ShapeLayer {
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
    width: 0.3,
    height: 0.3,
  };
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
  };
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
  };
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
  };
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
  };
}

export function blendModes(): BlendMode[] {
  return ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'soft-light', 'hard-light'];
}
