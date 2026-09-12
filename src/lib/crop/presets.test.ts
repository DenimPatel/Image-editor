import { describe, expect, it } from 'vitest';
import { parseRatio } from '../format';
import { mmToPx } from './geometry';
import {
  ASPECT_PRESETS,
  PLATFORM_GROUPS,
  PRINT_SIZES,
  aspectForCustomRatio,
  findPresetById,
  printSizePx,
} from './presets';

describe('ASPECT_PRESETS', () => {
  it('contains the core ratios with correct numeric values', () => {
    const aspects = new Map(ASPECT_PRESETS.map((preset) => [preset.id, preset.aspect]));
    expect(aspects.get('1:1')).toBeCloseTo(1, 9);
    expect(aspects.get('4:5')).toBeCloseTo(4 / 5, 9);
    expect(aspects.get('3:2')).toBeCloseTo(1.5, 9);
    expect(aspects.get('16:9')).toBeCloseTo(16 / 9, 9);
    expect(aspects.get('9:16')).toBeCloseTo(9 / 16, 9);
    expect(aspects.get('2:3')).toBeCloseTo(2 / 3, 9);
    expect(aspects.get('5:7')).toBeCloseTo(5 / 7, 9);
    expect(aspects.get('4:3')).toBeCloseTo(4 / 3, 9);
    expect(aspects.get('original')).toBeNull();
    expect(aspects.get('free')).toBeNull();
  });
});

describe('PLATFORM_GROUPS', () => {
  it('has non-empty groups with positive aspects', () => {
    expect(PLATFORM_GROUPS.length).toBeGreaterThan(0);
    for (const group of PLATFORM_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.presets.length).toBeGreaterThan(0);
      for (const preset of group.presets) {
        expect(preset.aspect).not.toBeNull();
        expect(preset.aspect as number).toBeGreaterThan(0);
      }
    }
  });
});

describe('printSizePx', () => {
  it('converts a 4x6 print at 300 DPI', () => {
    const six = PRINT_SIZES.find((size) => size.id === '4x6');
    expect(six).toBeDefined();
    expect(printSizePx(six!, 300)).toEqual({
      width: Math.round(mmToPx(101.6, 300)),
      height: Math.round(mmToPx(152.4, 300)),
    });
  });
});

describe('findPresetById', () => {
  it('finds standard and platform presets', () => {
    expect(findPresetById('3:2')?.aspect).toBeCloseTo(1.5, 9);
    expect(findPresetById('instagram-story')?.aspect).toBeCloseTo(9 / 16, 9);
    expect(findPresetById('does-not-exist')).toBeUndefined();
  });
});

describe('aspectForCustomRatio', () => {
  it('parses valid ratios and rejects invalid ones', () => {
    expect(aspectForCustomRatio('3:2')).toBe(1.5);
    expect(aspectForCustomRatio(' 16 : 9 ')).toBeCloseTo(16 / 9, 9);
    expect(aspectForCustomRatio('abc')).toBeNull();
    expect(aspectForCustomRatio('0:0')).toBeNull();
    expect(aspectForCustomRatio('')).toBeNull();
  });

  it('reuses parseRatio semantics', () => {
    const parsed = parseRatio('5:7');
    expect(aspectForCustomRatio('5:7')).toBeCloseTo((parsed?.width ?? 0) / (parsed?.height ?? 1), 9);
  });
});
