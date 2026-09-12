import type { HslBand, HslMix } from '../model/types';

function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;

  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = normalizeHue(h);
  const sat = Math.max(0, Math.min(1, s));
  const lum = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lum - c / 2;

  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function hueToBand(h: number): HslBand {
  const hue = normalizeHue(h);
  if (hue >= 345 || hue < 15) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 75) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 195) return 'aqua';
  if (hue < 265) return 'blue';
  if (hue < 315) return 'purple';
  return 'magenta';
}

export function applyHslMix(
  r: number,
  g: number,
  b: number,
  mix: HslMix,
): { r: number; g: number; b: number } {
  const { h, s, l } = rgbToHsl(r, g, b);
  const band = hueToBand(h);
  const delta = mix[band];

  const nextH = h + delta.hue;
  const nextS = s * (1 + delta.sat / 100);
  const nextL = l * (1 + delta.lum / 100);

  return hslToRgb(nextH, nextS, nextL);
}
