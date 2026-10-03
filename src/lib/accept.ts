import { convertBytes } from './format'

export const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/bmp',
  'image/tiff',
])

export const ACCEPT_ATTR = [...ACCEPTED_IMAGE_TYPES].join(',')

/**
 * Encoded-size ceiling, checked before anything is decoded. Pixel count is
 * bounded separately, against the probed canvas area, in `lib/decode.ts` —
 * bytes and pixels fail differently (a huge PNG, a small but enormous TIFF).
 */
export const MAX_INPUT_BYTES = 256 * 1024 * 1024

export const SAMPLE_IMAGES = [
  { file: 'pexels-cesar-o-neill-26650613-34630144.jpg', label: 'Sample 1' },
  { file: 'pexels-h-ng-quang-official-647624701-39127354.jpg', label: 'Sample 2' },
  { file: 'pexels-lucasrvimieiro-16216147.jpg', label: 'Sample 3' },
]

export function isHeic(type: string, name: string): boolean {
  return /heic|heif/i.test(type) || /\.(heic|heif)$/i.test(name)
}

export function describeOversized(bytes: number, limit = MAX_INPUT_BYTES): string {
  return `That file is ${convertBytes(bytes)} — this editor works with files up to ${convertBytes(limit)}.`
}

export function describeUnsupported(file: File): string | null {
  if (isHeic(file.type, file.name)) {
    return 'HEIC/HEIF isn’t supported by browsers yet. In Photos, export the image as JPEG and try again.'
  }
  if (file.type && !ACCEPTED_IMAGE_TYPES.has(file.type)) {
    return `That file type (${file.type || 'unknown'}) isn’t supported. Try JPEG, PNG, WebP, AVIF, GIF, BMP or TIFF.`
  }
  if (file.size > MAX_INPUT_BYTES) {
    return describeOversized(file.size)
  }
  return null
}
