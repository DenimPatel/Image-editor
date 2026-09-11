import type { CropRect, EditorState } from '../state/editorReducer';

/** Bounding box of an srcW x srcH rectangle after rotating by rotationDeg. */
export function getTransformedSize(
  srcWidth: number,
  srcHeight: number,
  rotationDeg: number,
): { width: number; height: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = Math.round(srcWidth * cos + srcHeight * sin);
  const height = Math.round(srcWidth * sin + srcHeight * cos);
  return { width, height };
}

type TransformParams = Pick<
  EditorState,
  'flipH' | 'flipV' | 'rotation' | 'brightness' | 'contrast' | 'saturation' | 'matte'
>;

/**
 * Applies flip + rotation + brightness/contrast/saturation to the source
 * bitmap, expanding the canvas so nothing is clipped. Corners exposed by a
 * non-90-degree rotation are filled with `matte` (transparent if
 * matte === 'transparent') instead of being left black, as app.py did.
 */
export function renderTransformed(bitmap: ImageBitmap, state: TransformParams): HTMLCanvasElement {
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const { width, height } = getTransformedSize(srcW, srcH, state.rotation);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  if (state.matte !== 'transparent') {
    ctx.fillStyle = state.matte;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%)`;

  ctx.translate(width / 2, height / 2);
  ctx.rotate((state.rotation * Math.PI) / 180);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  ctx.drawImage(bitmap, -srcW / 2, -srcH / 2, srcW, srcH);

  return canvas;
}

/**
 * Output height is derived from the actual crop box's own aspect ratio,
 * never from the typed "W:H" ratio field — app.py (line 162) recomputed
 * height from the typed ratio, so a crop box that drifted from the typed
 * value silently distorted the image on export.
 */
export function computeOutputHeight(outWidth: number, crop: CropRect): number {
  return Math.round((outWidth * crop.height) / crop.width);
}

/**
 * Renders the final export canvas: crop region of the transformed image,
 * scaled to outWidth x computeOutputHeight(outWidth, crop). Only JPEG/PDF
 * flatten onto `matte`; PNG/WebP keep source alpha (app.py always forced
 * img.convert("RGB"), destroying PNG transparency even for PNG exports).
 */
export function renderFinal(bitmap: ImageBitmap, state: EditorState): HTMLCanvasElement {
  const transformed = renderTransformed(bitmap, state);
  const crop = state.crop ?? {
    x: 0,
    y: 0,
    width: transformed.width,
    height: transformed.height,
  };

  const outWidth = Math.max(1, Math.round(state.outWidth));
  const outHeight = Math.max(1, computeOutputHeight(outWidth, crop));

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const needsFlatten = state.format === 'jpeg' || state.format === 'pdf';
  if (needsFlatten) {
    ctx.fillStyle = state.matte === 'transparent' ? '#ffffff' : state.matte;
    ctx.fillRect(0, 0, outWidth, outHeight);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(transformed, crop.x, crop.y, crop.width, crop.height, 0, 0, outWidth, outHeight);

  return canvas;
}
