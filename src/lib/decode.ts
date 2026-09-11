/**
 * Decode a File into an ImageBitmap, honoring EXIF orientation so phone
 * photos come out upright instead of sideways (app.py had no EXIF handling
 * at all, since Pillow's default Image.open ignores orientation too).
 */
export async function decodeImageFile(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}
