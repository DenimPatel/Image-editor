/**
 * 3D LUT looks. The hald PNGs are fetched lazily from `public/luts/` on first
 * use so the initial bundle stays small; the in-memory cache makes re-selecting
 * a look instant.
 */

export type LutPreset = {
  id: string;
  label: string;
  family: 'Film' | 'Cinematic' | 'Mono' | 'Creative';
};

export const LUT_PRESETS: LutPreset[] = [
  { id: 'kodak-portra', label: 'Portra', family: 'Film' },
  { id: 'kodak-gold', label: 'Gold', family: 'Film' },
  { id: 'kodak-ektar', label: 'Ektar', family: 'Film' },
  { id: 'fuji-velvia', label: 'Velvia', family: 'Film' },
  { id: 'fuji-superia', label: 'Superia', family: 'Film' },
  { id: 'fuji-provia', label: 'Provia', family: 'Film' },
  { id: 'cinestill-800t', label: 'CineStill 800T', family: 'Film' },
  { id: 'agfa-vista', label: 'Vista', family: 'Film' },
  { id: 'polaroid-600', label: 'Polaroid', family: 'Film' },
  { id: 'lomo', label: 'Lomo', family: 'Creative' },
  { id: 'cross-process', label: 'Cross Process', family: 'Creative' },
  { id: 'bleach-bypass', label: 'Bleach Bypass', family: 'Creative' },
  { id: 'vintage-fade', label: 'Vintage Fade', family: 'Creative' },
  { id: 'faded-matte', label: 'Faded Matte', family: 'Creative' },
  { id: 'warm-cinema', label: 'Warm Cinema', family: 'Cinematic' },
  { id: 'cool-cinema', label: 'Cool Cinema', family: 'Cinematic' },
  { id: 'teal-orange', label: 'Teal & Orange', family: 'Cinematic' },
  { id: 'moody', label: 'Moody', family: 'Cinematic' },
  { id: 'cyberpunk', label: 'Cyberpunk', family: 'Cinematic' },
  { id: 'infrared', label: 'Infrared', family: 'Creative' },
  { id: 'noir', label: 'Noir', family: 'Mono' },
  { id: 'sepia', label: 'Sepia', family: 'Mono' },
  { id: 'pastel', label: 'Pastel', family: 'Creative' },
  { id: 'vivid', label: 'Vivid', family: 'Creative' },
];

export const LUT_SIZE = 33;

const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap | null>>();

export function lutUrl(id: string): string {
  return `${import.meta.env.BASE_URL}luts/${id}.png`;
}

export function getLut(id: string): ImageBitmap | undefined {
  return cache.get(id);
}

export async function loadLut(id: string): Promise<ImageBitmap | null> {
  const existing = cache.get(id);
  if (existing) return existing;
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const response = await fetch(lutUrl(id));
      if (!response.ok) return null;
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      cache.set(id, bitmap);
      return bitmap;
    } catch {
      return null;
    } finally {
      pending.delete(id);
    }
  })();

  pending.set(id, promise);
  return promise;
}

export function clearLutCache(): void {
  for (const bitmap of cache.values()) bitmap.close();
  cache.clear();
}