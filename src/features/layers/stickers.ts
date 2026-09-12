/** Built-in stickers as SVG path data, drawable synchronously via Path2D. */
export type StickerDef = { id: string; label: string; viewBox: number; path: string; fill: string };

export const STICKERS: StickerDef[] = [
  { id: 'star', label: 'Star', viewBox: 100, path: 'M50 5l14 29 32 4-23 22 6 32-29-15-29 15 6-32L4 38l32-4z', fill: '#ffd166' },
  { id: 'heart', label: 'Heart', viewBox: 100, path: 'M50 88S12 62 12 36a20 20 0 0 1 38-9 20 20 0 0 1 38 9c0 26-38 52-38 52z', fill: '#ef476f' },
  { id: 'bolt', label: 'Bolt', viewBox: 100, path: 'M58 4L20 56h22l-6 40 40-54H52z', fill: '#ffd166' },
  { id: 'check', label: 'Check', viewBox: 100, path: 'M42 66L22 46l-8 8 28 28 48-56-9-8z', fill: '#06d6a0' },
  { id: 'arrow', label: 'Arrow', viewBox: 100, path: 'M10 44h52V24l30 28-30 28V60H10z', fill: '#118ab2' },
  { id: 'sparkle', label: 'Sparkle', viewBox: 100, path: 'M50 6l8 28 28 8-28 8-8 28-8-28-28-8 28-8z', fill: '#f78c6b' },
  { id: 'circle', label: 'Ring', viewBox: 100, path: 'M50 10a40 40 0 1 0 0 80 40 40 0 0 0 0-80zm0 12a28 28 0 1 1 0 56 28 28 0 0 1 0-56z', fill: '#ffffff' },
  { id: 'speech', label: 'Speech', viewBox: 100, path: 'M14 18h72v46H44L22 84V64H14z', fill: '#ffffff' },
];

export function stickerById(id: string): StickerDef | undefined {
  return STICKERS.find((sticker) => sticker.id === id);
}
