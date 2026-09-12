/**
 * Self-hosted fonts, lazily registered with the FontFace API. Nothing is
 * fetched from Google Fonts, so the "nothing leaves your device" claim holds
 * and the app works offline after first load.
 */

export type FontDef = {
  id: string;
  label: string;
  family: string;
  url: string;
  weight: number;
  style: 'normal' | 'italic';
};

export const FONTS: FontDef[] = [
  { id: 'inter', label: 'Inter', family: 'IE Inter', url: 'fonts/inter.woff2', weight: 400, style: 'normal' },
  { id: 'inter-bold', label: 'Inter Bold', family: 'IE Inter', url: 'fonts/inter-bold.woff2', weight: 700, style: 'normal' },
  { id: 'playfair', label: 'Playfair', family: 'IE Playfair', url: 'fonts/playfair.woff2', weight: 400, style: 'normal' },
  { id: 'oswald', label: 'Oswald', family: 'IE Oswald', url: 'fonts/oswald.woff2', weight: 400, style: 'normal' },
  { id: 'montserrat', label: 'Montserrat', family: 'IE Montserrat', url: 'fonts/montserrat.woff2', weight: 600, style: 'normal' },
  { id: 'lora', label: 'Lora', family: 'IE Lora', url: 'fonts/lora.woff2', weight: 400, style: 'normal' },
  { id: 'roboto-mono', label: 'Mono', family: 'IE Mono', url: 'fonts/roboto-mono.woff2', weight: 400, style: 'normal' },
  { id: 'caveat', label: 'Caveat', family: 'IE Caveat', url: 'fonts/caveat.woff2', weight: 400, style: 'normal' },
  { id: 'pacifico', label: 'Pacifico', family: 'IE Pacifico', url: 'fonts/pacifico.woff2', weight: 400, style: 'normal' },
  { id: 'bebas', label: 'Bebas', family: 'IE Bebas', url: 'fonts/bebas.woff2', weight: 400, style: 'normal' },
  { id: 'dm-serif', label: 'DM Serif', family: 'IE DMSerif', url: 'fonts/dm-serif.woff2', weight: 400, style: 'normal' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'IE SpaceGrotesk', url: 'fonts/space-grotesk.woff2', weight: 500, style: 'normal' },
  { id: 'archivo', label: 'Archivo', family: 'IE Archivo', url: 'fonts/archivo.woff2', weight: 600, style: 'normal' },
  { id: 'barlow', label: 'Barlow', family: 'IE Barlow', url: 'fonts/barlow.woff2', weight: 500, style: 'normal' },
];

export const DEFAULT_FONT_ID = 'inter';

export function fontFamily(fontId: string): string {
  return FONTS.find((font) => font.id === fontId)?.family ?? 'system-ui, sans-serif';
}

const loaded = new Set<string>();

export async function ensureFont(fontId: string): Promise<void> {
  const font = FONTS.find((candidate) => candidate.id === fontId);
  if (!font || loaded.has(font.id)) return;
  if (typeof FontFace === 'undefined') return;
  try {
    const face = new FontFace(font.family, `url(${import.meta.env.BASE_URL}${font.url})`, {
      weight: String(font.weight),
      style: font.style,
    });
    await face.load();
    document.fonts.add(face);
    loaded.add(font.id);
  } catch {
    // Font file missing: canvas falls back to the system stack.
  }
}
