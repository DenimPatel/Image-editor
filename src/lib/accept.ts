export const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/tiff',
]);

export const ACCEPT_ATTR = [...ACCEPTED_IMAGE_TYPES].join(',');

export const SAMPLE_IMAGES = [
  { file: 'pexels-cesar-o-neill-26650613-34630144.jpg', label: 'Sample 1' },
  { file: 'pexels-h-ng-quang-official-647624701-39127354.jpg', label: 'Sample 2' },
  { file: 'pexels-lucasrvimieiro-16216147.jpg', label: 'Sample 3' },
];

export function isHeic(type: string, name: string): boolean {
  return /heic|heif/i.test(type) || /\.(heic|heif)$/i.test(name);
}

export function describeUnsupported(file: File): string | null {
  if (isHeic(file.type, file.name)) {
    return 'HEIC/HEIF isn’t supported by browsers yet. In Photos, export the image as JPEG and try again.';
  }
  if (file.type && !ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return `That file type (${file.type || 'unknown'}) isn’t supported. Try JPEG, PNG, WebP, AVIF, GIF, BMP or TIFF.`;
  }
  return null;
}
