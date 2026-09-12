import type { Size } from '../../model/types';
import { parseRatio } from '../format';
import { mmToPx } from './geometry';

export type AspectPreset = { id: string; label: string; aspect: number | null };
export type AspectGroup = { id: string; label: string; presets: AspectPreset[] };

export const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'original', label: 'Original', aspect: null },
  { id: 'free', label: 'Free', aspect: null },
  { id: '1:1', label: '1:1', aspect: 1 },
  { id: '4:5', label: '4:5', aspect: 4 / 5 },
  { id: '3:2', label: '3:2', aspect: 3 / 2 },
  { id: '16:9', label: '16:9', aspect: 16 / 9 },
  { id: '9:16', label: '9:16', aspect: 9 / 16 },
  { id: '2:3', label: '2:3', aspect: 2 / 3 },
  { id: '5:7', label: '5:7', aspect: 5 / 7 },
  { id: '4:3', label: '4:3', aspect: 4 / 3 },
];

export const PLATFORM_GROUPS: AspectGroup[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    presets: [
      { id: 'instagram-square', label: 'Square 1:1', aspect: 1 },
      { id: 'instagram-portrait', label: 'Portrait 4:5', aspect: 4 / 5 },
      { id: 'instagram-landscape', label: 'Landscape 1.91:1', aspect: 1.91 },
      { id: 'instagram-story', label: 'Story 9:16', aspect: 9 / 16 },
    ],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    presets: [
      { id: 'tiktok-video', label: 'Video 9:16', aspect: 9 / 16 },
      { id: 'tiktok-square', label: 'Square 1:1', aspect: 1 },
    ],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    presets: [
      { id: 'linkedin-square', label: 'Square 1:1', aspect: 1 },
      { id: 'linkedin-portrait', label: 'Portrait 4:5', aspect: 4 / 5 },
      { id: 'linkedin-landscape', label: 'Landscape 1.91:1', aspect: 1.91 },
    ],
  },
  {
    id: 'x',
    label: 'X',
    presets: [
      { id: 'x-landscape', label: 'Landscape 16:9', aspect: 16 / 9 },
      { id: 'x-square', label: 'Square 1:1', aspect: 1 },
      { id: 'x-portrait', label: 'Portrait 4:5', aspect: 4 / 5 },
    ],
  },
  {
    id: 'facebook',
    label: 'Facebook',
    presets: [
      { id: 'facebook-square', label: 'Square 1:1', aspect: 1 },
      { id: 'facebook-portrait', label: 'Portrait 4:5', aspect: 4 / 5 },
      { id: 'facebook-landscape', label: 'Landscape 16:9', aspect: 16 / 9 },
      { id: 'facebook-story', label: 'Story 9:16', aspect: 9 / 16 },
    ],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    presets: [
      { id: 'youtube-video', label: 'Video 16:9', aspect: 16 / 9 },
      { id: 'youtube-shorts', label: 'Shorts 9:16', aspect: 9 / 16 },
      { id: 'youtube-square', label: 'Square 1:1', aspect: 1 },
    ],
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    presets: [
      { id: 'pinterest-pin', label: 'Pin 2:3', aspect: 2 / 3 },
      { id: 'pinterest-square', label: 'Square 1:1', aspect: 1 },
      { id: 'pinterest-story', label: 'Story 9:16', aspect: 9 / 16 },
    ],
  },
];

export type PrintSize = { id: string; label: string; widthMm: number; heightMm: number };

export const PRINT_SIZES: PrintSize[] = [
  { id: '4x6', label: '4 × 6 in', widthMm: 101.6, heightMm: 152.4 },
  { id: '5x7', label: '5 × 7 in', widthMm: 127, heightMm: 177.8 },
  { id: '8x10', label: '8 × 10 in', widthMm: 203.2, heightMm: 254 },
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
];

export function printSizePx(size: PrintSize, dpi: number): Size {
  return {
    width: Math.round(mmToPx(size.widthMm, dpi)),
    height: Math.round(mmToPx(size.heightMm, dpi)),
  };
}

export function findPresetById(id: string): AspectPreset | undefined {
  for (const preset of ASPECT_PRESETS) {
    if (preset.id === id) return preset;
  }
  for (const group of PLATFORM_GROUPS) {
    for (const preset of group.presets) {
      if (preset.id === id) return preset;
    }
  }
  return undefined;
}

export function aspectForCustomRatio(text: string): number | null {
  const parsed = parseRatio(text);
  if (!parsed) return null;
  return parsed.width / parsed.height;
}
