/**
 * What to keep in the exported file's metadata.
 *
 * - `strip` removes every metadata-bearing container: EXIF, the ICC colour
 *   profile, IPTC/Photoshop IRB, XMP and comments.
 * - `orientation` keeps only an Orientation tag and drops everything else.
 * - `all` copies the encoded bytes through untouched.
 */
export type MetadataPolicy = 'strip' | 'orientation' | 'all'
