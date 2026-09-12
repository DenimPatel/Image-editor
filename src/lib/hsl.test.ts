import { describe, expect, it } from 'vitest';
import { NEUTRAL_HSL } from '../model/defaults';
import { applyHslMix, hslToRgb, hueToBand, rgbToHsl } from './hsl';

describe('rgbToHsl', () => {
  it('maps pure red to h=0, s=1, l=0.5', () => {
    const { h, s, l } = rgbToHsl(255, 0, 0);
    expect(h).toBeCloseTo(0, 6);
    expect(s).toBeCloseTo(1, 6);
    expect(l).toBeCloseTo(0.5, 6);
  });

  it('maps white to l=1 and black to l=0', () => {
    expect(rgbToHsl(255, 255, 255).l).toBeCloseTo(1, 6);
    expect(rgbToHsl(0, 0, 0).l).toBeCloseTo(0, 6);
  });

  it('places primaries at their expected hues', () => {
    expect(rgbToHsl(0, 255, 0).h).toBeCloseTo(120, 6);
    expect(rgbToHsl(0, 0, 255).h).toBeCloseTo(240, 6);
    expect(rgbToHsl(0, 255, 255).h).toBeCloseTo(180, 6);
  });
});

describe('hslToRgb round trip', () => {
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [123, 45, 200],
    [200, 180, 30],
    [17, 17, 17],
    [250, 250, 250],
  ];

  it('matches the original rgb within one step', () => {
    for (const [r, g, b] of colors) {
      const { h, s, l } = rgbToHsl(r, g, b);
      const out = hslToRgb(h, s, l);
      expect(Math.abs(out.r - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.g - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.b - b)).toBeLessThanOrEqual(1);
    }
  });
});

describe('hueToBand', () => {
  it('maps band boundaries correctly', () => {
    expect(hueToBand(0)).toBe('red');
    expect(hueToBand(14.99)).toBe('red');
    expect(hueToBand(15)).toBe('orange');
    expect(hueToBand(44.99)).toBe('orange');
    expect(hueToBand(45)).toBe('yellow');
    expect(hueToBand(74.99)).toBe('yellow');
    expect(hueToBand(75)).toBe('green');
    expect(hueToBand(164.99)).toBe('green');
    expect(hueToBand(165)).toBe('aqua');
    expect(hueToBand(194.99)).toBe('aqua');
    expect(hueToBand(195)).toBe('blue');
    expect(hueToBand(264.99)).toBe('blue');
    expect(hueToBand(265)).toBe('purple');
    expect(hueToBand(314.99)).toBe('purple');
    expect(hueToBand(315)).toBe('magenta');
    expect(hueToBand(344.99)).toBe('magenta');
    expect(hueToBand(345)).toBe('red');
    expect(hueToBand(359.99)).toBe('red');
  });

  it('normalizes out-of-range hues', () => {
    expect(hueToBand(360)).toBe('red');
    expect(hueToBand(-15)).toBe('red');
  });
});

describe('applyHslMix', () => {
  const colors: [number, number, number][] = [
    [255, 0, 0],
    [40, 160, 90],
    [123, 45, 200],
    [200, 180, 30],
  ];

  it('is approximately the identity for a neutral mix', () => {
    for (const [r, g, b] of colors) {
      const out = applyHslMix(r, g, b, NEUTRAL_HSL);
      expect(Math.abs(out.r - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.g - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(out.b - b)).toBeLessThanOrEqual(1);
    }
  });

  it('shifts the hue only within the matched band', () => {
    const mix = {
      ...NEUTRAL_HSL,
      red: { hue: 60, sat: 0, lum: 0 },
    };
    const shifted = applyHslMix(255, 0, 0, mix);
    expect(shifted.g).toBeGreaterThan(shifted.b);
    expect(shifted.g).toBeGreaterThan(200);
    const blue = applyHslMix(0, 0, 255, mix);
    expect(blue).toEqual({ r: 0, g: 0, b: 255 });
  });
});
