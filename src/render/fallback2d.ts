import { computeSourceToOutput } from '../gl/geometry';
import type { Adjust } from '../model/types';
import type { RenderBackend, RenderRequest } from './backend';

function filterFor(adjust: Adjust): string {
  const exposure = Math.pow(2, adjust.exposure);
  const brightness = 100 * exposure * (1 + adjust.brightness / 100);
  const contrast = 100 * (1 + adjust.contrast / 100);
  const saturation = 100 * (1 + adjust.saturation / 100);
  if (
    Math.abs(brightness - 100) < 0.01 &&
    Math.abs(contrast - 100) < 0.01 &&
    Math.abs(saturation - 100) < 0.01
  ) {
    return 'none';
  }
  return `brightness(${brightness.toFixed(2)}%) contrast(${contrast.toFixed(2)}%) saturate(${saturation.toFixed(2)}%)`;
}

/**
 * Canvas2D backend. It uses the same source→output affine transform as the GL
 * renderer, but applies tone/colour through `ctx.filter` for preview. The
 * remaining passes (curves, HSL, LUT, sharpen, grain, vignette) run as
 * `ImageData` passes during export only; a perspective warp is approximated
 * affinely because Canvas2D cannot express a projective transform.
 */
export class Canvas2dRenderer implements RenderBackend {
  readonly kind = 'canvas2d' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  render(request: RenderRequest): void {
    const { doc, size, source, sourceSize } = request;
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    if (doc.output.format === 'jpeg' || doc.output.format === 'pdf') {
      ctx.fillStyle = doc.output.matte === 'transparent' ? '#ffffff' : doc.output.matte;
      ctx.fillRect(0, 0, size.width, size.height);
    }

    const matrix = computeSourceToOutput(doc, sourceSize, size);
    ctx.save();
    ctx.setTransform(matrix[0], matrix[3], matrix[1], matrix[4], matrix[2], matrix[5]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = filterFor(doc.adjust);
    try {
      ctx.drawImage(source as CanvasImageSource, 0, 0, sourceSize.width, sourceSize.height);
    } finally {
      ctx.filter = 'none';
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  dispose(): void {
    // No GPU resources to release.
  }
}

export function createCanvas2dBackend(): RenderBackend {
  return new Canvas2dRenderer();
}