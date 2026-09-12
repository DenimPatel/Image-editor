/**
 * Decode a File into an ImageBitmap, honoring EXIF orientation so phone
 * photos come out upright instead of sideways (app.py had no EXIF handling
 * at all, since Pillow's default Image.open ignores orientation too).
 */
export async function decodeImageFile(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * Decode an image served from a static URL (e.g. a bundled sample image)
 * into the same ImageBitmap shape as decodeImageFile.
 */
export async function decodeImageUrl(url: string): Promise<ImageBitmap> {
  const blob = await fetch(url).then((response) => response.blob());
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

/**
 * Re-encode an ImageBitmap as a Blob, for APIs that only accept encoded
 * image data. Prefers OffscreenCanvas; falls back to a detached <canvas>
 * for browsers without it (Safari < 17).
 */
export async function bitmapToBlob(bitmap: ImageBitmap, type = 'image/png'): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type });
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob failed'));
    }, type);
  });
}
