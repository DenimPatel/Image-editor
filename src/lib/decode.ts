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
