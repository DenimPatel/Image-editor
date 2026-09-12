import type { Doc, Layer, LayerTransform, NormRect, Size } from '../model/types';
import { fontFamily } from '../features/layers/fonts';
import { stickerById } from '../features/layers/stickers';

export type CompositorAssets = {
  get(id: string): (CanvasImageSource & { width: number; height: number }) | undefined;
};

export type ComposeOptions = {
  size: Size;
  assets: CompositorAssets;
};

function blendOp(blend: Layer['transform']['blend']): GlobalCompositeOperation {
  switch (blend) {
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'soft-light':
    case 'hard-light':
      return blend;
    default:
      return 'source-over';
  }
}

function rectToPixels(rect: NormRect, size: Size) {
  return {
    x: rect.x * size.width,
    y: rect.y * size.height,
    width: rect.width * size.width,
    height: rect.height * size.height,
  };
}

function applyTransform(ctx: CanvasRenderingContext2D, transform: LayerTransform, size: Size): void {
  ctx.translate(transform.x * size.width, transform.y * size.height);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scale, transform.scale);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawTextLayer(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { kind: 'text' }>, size: Size): void {
  const style = layer.style;
  const fontSize = (style.size / 100) * Math.min(size.width, size.height);
  const family = fontFamily(style.fontId);
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${fontSize}px "${family}", system-ui, sans-serif`;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.strokeColor;
  ctx.lineWidth = (style.strokeWidth / 100) * fontSize;
  const lines = layer.text.split('\n');
  const lineHeight = fontSize * style.lineHeight;
  const startY = -((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    if (style.pillBackground) {
      const metrics = ctx.measureText(line);
      const padding = fontSize * 0.3;
      const width = metrics.width + padding * 2;
      const x = style.align === 'center' ? -width / 2 : style.align === 'right' ? -metrics.width - padding : -padding;
      ctx.save();
      ctx.fillStyle = style.pillBackground;
      roundRect(ctx, x, y - lineHeight / 2, width, lineHeight, lineHeight / 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = style.color;
    }
    if (style.shadow) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = fontSize * 0.25;
      ctx.shadowOffsetY = fontSize * 0.08;
      ctx.fillText(line, 0, y);
      ctx.restore();
    }
    if (style.strokeWidth > 0) ctx.strokeText(line, 0, y);
    ctx.fillText(line, 0, y);
  });
}

function drawShapeLayer(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { kind: 'shape' }>, size: Size): void {
  const width = layer.width * size.width;
  const height = layer.height * size.height;
  ctx.fillStyle = layer.fill;
  ctx.strokeStyle = layer.stroke;
  ctx.lineWidth = (layer.strokeWidth / 100) * Math.min(size.width, size.height);
  if (layer.shape === 'rect') {
    ctx.fillRect(-width / 2, -height / 2, width, height);
  } else if (layer.shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const direction = layer.shape === 'arrow' ? 1 : 0;
    ctx.beginPath();
    ctx.moveTo(-width / 2, height / 2);
    ctx.lineTo(width / 2, -height / 2);
    ctx.stroke();
    if (direction) {
      ctx.beginPath();
      ctx.moveTo(width / 2, -height / 2);
      ctx.lineTo(width / 2 - width * 0.18, -height / 2 + height * 0.05);
      ctx.moveTo(width / 2, -height / 2);
      ctx.lineTo(width / 2 - width * 0.05, -height / 2 + height * 0.2);
      ctx.stroke();
    }
  }
}

function drawDrawLayer(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { kind: 'draw' }>, size: Size): void {
  const radius = (layer.size / 100) * Math.min(size.width, size.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = radius;
  ctx.strokeStyle = layer.color;
  ctx.globalCompositeOperation = layer.brush === 'eraser' ? 'destination-out' : 'source-over';
  if (layer.brush === 'neon') {
    ctx.shadowColor = layer.color;
    ctx.shadowBlur = radius * 1.6;
  }
  for (const stroke of layer.strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      const x = point.x * size.width;
      const y = point.y * size.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function drawRedactLayer(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { kind: 'redact' }>, size: Size): void {
  const region = rectToPixels(layer.region, size);
  ctx.save();
  if (layer.shape === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      region.x + region.width / 2,
      region.y + region.height / 2,
      region.width / 2,
      region.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(region.x, region.y, region.width, region.height);
    ctx.clip();
  }

  if (layer.mode === 'solid') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(region.x, region.y, region.width, region.height);
  } else if (layer.mode === 'emoji') {
    const step = Math.max(12, region.width / 6);
    ctx.font = `${step}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = region.y + step / 2; y < region.y + region.height; y += step) {
      for (let x = region.x + step / 2; x < region.x + region.width; x += step) {
        ctx.fillText(layer.emoji, x, y);
      }
    }
  } else {
    const block = Math.max(2, Math.round((layer.strength / 100) * 24) + 2);
    const image = ctx.getImageData(
      Math.max(0, Math.floor(region.x)),
      Math.max(0, Math.floor(region.y)),
      Math.max(1, Math.floor(region.width)),
      Math.max(1, Math.floor(region.height)),
    );
    if (layer.mode === 'blur') {
      const offscreen = document.createElement('canvas');
      offscreen.width = image.width;
      offscreen.height = image.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.putImageData(image, 0, 0);
        ctx.filter = `blur(${Math.max(2, block)}px)`;
        ctx.drawImage(offscreen, image.width, image.height, image.width, image.height, region.x, region.y, image.width, image.height);
        ctx.filter = 'none';
      }
    } else {
      const blocks = document.createElement('canvas');
      blocks.width = Math.max(1, Math.ceil(image.width / block));
      blocks.height = Math.max(1, Math.ceil(image.height / block));
      const blockCtx = blocks.getContext('2d');
      if (blockCtx) {
        const full = document.createElement('canvas');
        full.width = image.width;
        full.height = image.height;
        full.getContext('2d')?.putImageData(image, 0, 0);
        blockCtx.imageSmoothingEnabled = false;
        blockCtx.drawImage(full, 0, 0, blocks.width, blocks.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(blocks, 0, 0, blocks.width, blocks.height, region.x, region.y, image.width, image.height);
        ctx.imageSmoothingEnabled = true;
      }
    }
  }
  ctx.restore();
}

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
};

function drawWatermarkLayer(
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { kind: 'watermark' }>,
  size: Size,
  assets: CompositorAssets,
): void {
  const [ax, ay, align, baseline] = ANCHORS[layer.anchor] ?? ANCHORS.center;
  const fontSize = Math.max(12, size.height * 0.05);
  ctx.globalAlpha *= 0.85;

  const drawOne = (cx: number, cy: number) => {
    if (layer.assetId) {
      const image = assets.get(layer.assetId);
      if (image) {
        const width = fontSize * 4;
        const height = (image.height / image.width) * width;
        ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
        return;
      }
    }
    ctx.font = `${fontSize}px "${fontFamily(layer.fontId)}", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = layer.color;
    ctx.fillText(layer.text, cx, cy);
  };

  if (layer.tiled) {
    ctx.save();
    ctx.rotate((-30 * Math.PI) / 180);
    const stepX = size.width / 3;
    const stepY = size.height / 5;
    for (let y = -size.height; y < size.height * 2; y += stepY) {
      for (let x = -size.width; x < size.width * 2; x += stepX) {
        drawOne(x, y);
      }
    }
    ctx.restore();
  } else {
    drawOne(ax * size.width, ay * size.height);
  }
}

function drawFrameLayer(ctx: CanvasRenderingContext2D, layer: Extract<Layer, { kind: 'frame' }>, size: Size): void {
  const thickness = (layer.width / 100) * Math.min(size.width, size.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = layer.color;
  switch (layer.style) {
    case 'solid':
      ctx.lineWidth = thickness;
      ctx.strokeStyle = layer.color;
      ctx.strokeRect(thickness / 2, thickness / 2, size.width - thickness, size.height - thickness);
      break;
    case 'inset':
      ctx.globalAlpha *= 0.85;
      ctx.fillRect(0, 0, size.width, thickness);
      ctx.fillRect(0, size.height - thickness, size.width, thickness);
      ctx.fillRect(0, 0, thickness, size.height);
      ctx.fillRect(size.width - thickness, 0, thickness, size.height);
      break;
    case 'polaroid': {
      const side = thickness * 0.7;
      ctx.fillRect(0, 0, size.width, side);
      ctx.fillRect(0, 0, side, size.height);
      ctx.fillRect(size.width - side, 0, side, size.height);
      ctx.fillRect(0, size.height - thickness * 2.4, size.width, thickness * 2.4);
      break;
    }
    case 'film': {
      const bar = thickness * 1.2;
      ctx.fillStyle = '#0b0b0c';
      ctx.fillRect(0, 0, size.width, bar);
      ctx.fillRect(0, size.height - bar, size.width, bar);
      ctx.fillStyle = layer.color === '#0b0b0c' ? '#f2f2f7' : layer.color;
      const hole = bar * 0.45;
      for (let x = bar; x < size.width - bar; x += bar * 1.6) {
        roundRect(ctx, x, bar * 0.28, hole, hole * 0.7, 2);
        ctx.fill();
        roundRect(ctx, x, size.height - bar * 0.98, hole, hole * 0.7, 2);
        ctx.fill();
      }
      break;
    }
    case 'rounded':
      ctx.lineWidth = thickness;
      ctx.strokeStyle = layer.color;
      roundRect(ctx, thickness / 2, thickness / 2, size.width - thickness, size.height - thickness, thickness * 1.5);
      ctx.stroke();
      break;
    case 'shadow-card':
    default:
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = thickness;
      ctx.lineWidth = thickness * 0.5;
      ctx.strokeStyle = layer.color;
      ctx.strokeRect(thickness, thickness, size.width - thickness * 2, size.height - thickness * 2);
      ctx.restore();
      break;
  }
}

/** Composite every visible layer onto an already-rendered photo canvas. */
export function drawLayers(ctx: CanvasRenderingContext2D, doc: Doc, options: ComposeOptions): void {
  const { size, assets } = options;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.transform.opacity;
    ctx.globalCompositeOperation = blendOp(layer.transform.blend);
    if (layer.kind === 'frame') {
      // Frames are positioned by their own geometry, not the shared transform.
      drawFrameLayer(ctx, layer, size);
      ctx.restore();
      continue;
    }
    if (layer.kind === 'redact') {
      ctx.globalCompositeOperation = 'source-over';
      drawRedactLayer(ctx, layer, size);
      ctx.restore();
      continue;
    }
    if (layer.kind === 'draw') {
      // Stroke points are stored as absolute canvas-normalized coordinates
      // (not relative to the layer's transform origin), so draw layers skip
      // applyTransform entirely.
      drawDrawLayer(ctx, layer, size);
      ctx.restore();
      continue;
    }
    applyTransform(ctx, layer.transform, size);
    switch (layer.kind) {
      case 'text':
        drawTextLayer(ctx, layer, size);
        break;
      case 'shape':
        drawShapeLayer(ctx, layer, size);
        break;
      case 'sticker': {
        const svg = layer.svg;
        const sticker = svg ? stickerById(svg) : undefined;
        if (sticker) {
          const scale = (size.height * 0.25) / sticker.viewBox;
          ctx.scale(scale, scale);
          ctx.translate(-sticker.viewBox / 2, -sticker.viewBox / 2);
          ctx.fillStyle = sticker.fill;
          ctx.fill(new Path2D(sticker.path));
        }
        break;
      }
      case 'watermark':
        break;
      default:
        break;
    }
    ctx.restore();
    if (layer.kind === 'watermark') {
      ctx.save();
      drawWatermarkLayer(ctx, layer, size, assets);
      ctx.restore();
    }
  }
}
