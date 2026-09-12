import { describe, expect, it } from 'vitest';
import { createDoc, IDENTITY_CURVES, NEUTRAL_HSL } from '../model/defaults';
import type { Doc } from '../model/types';
import { IDENTITY_MAT3 } from './geometry';
import { planHash, planPasses, withLeadingGeometry, type Pass } from './passes';

const size = { width: 100, height: 100 };

function kinds(passes: Pass[]): string[] {
  return passes.map((pass) => pass.kind);
}

function doc(overrides: Partial<Doc> = {}): Doc {
  return createDoc(overrides);
}

describe('planPasses', () => {
  it('emits only the output pass for a pristine doc', () => {
    expect(kinds(planPasses(doc(), size))).toEqual(['output']);
  });

  it('emits a tone pass when a tone adjustment is non-zero', () => {
    const d = doc();
    d.adjust.contrast = 20;
    expect(kinds(planPasses(d, size))).toEqual(['tone', 'output']);
  });

  it('skips identity passes when values are neutral', () => {
    const d = doc();
    d.adjust.contrast = 0;
    d.adjust.saturation = 0;
    d.look.id = null;
    d.curves = IDENTITY_CURVES;
    d.hsl = NEUTRAL_HSL;
    expect(kinds(planPasses(d, size))).toEqual(['output']);
  });

  it('emits color, curves, hsl and lut passes independently', () => {
    const d = doc();
    d.adjust.saturation = 10;
    d.curves.rgb = [
      { x: 0, y: 0 },
      { x: 128, y: 100 },
      { x: 255, y: 255 },
    ];
    d.hsl.red.sat = 15;
    d.look.id = 'noir';
    d.look.amount = 0.8;
    expect(kinds(planPasses(d, size))).toEqual(['color', 'curves', 'hsl', 'lut3d', 'output']);
  });

  it('emits a geometry pass only when a matrix is supplied and geometry changed', () => {
    const d = doc();
    d.geometry.crop = { x: 0.1, y: 0, width: 0.5, height: 1 };
    expect(kinds(planPasses(d, size))).not.toContain('geometry');
    expect(kinds(planPasses(d, size, IDENTITY_MAT3))).toEqual(['geometry', 'output']);
  });

  it('emits denoise, definition and sharpen in order', () => {
    const d = doc();
    d.adjust.noiseReduction = 30;
    d.adjust.definition = 20;
    d.adjust.sharpness = 40;
    expect(kinds(planPasses(d, size))).toEqual(['denoise', 'definition', 'sharpen', 'output']);
  });

  it('emits effects and vignette for grain and vignette', () => {
    const d = doc();
    d.effects.grain = 20;
    d.adjust.vignette = -30;
    expect(kinds(planPasses(d, size))).toEqual(['effects', 'vignette', 'output']);
  });

  it('includes a layers pass when visible layers exist', () => {
    const d = doc();
    d.layers.push({
      id: 'l1',
      kind: 'text',
      name: 't',
      visible: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      text: 'hi',
      style: {
        fontId: 'inter',
        size: 24,
        color: '#fff',
        align: 'center',
        lineHeight: 1.2,
        tracking: 0,
        bold: false,
        italic: false,
        strokeColor: '#000',
        strokeWidth: 0,
        shadow: false,
        pillBackground: null,
        arc: 0,
      },
    });
    expect(kinds(planPasses(d, size))).toContain('layers');
  });

  it('marks the output pass with flatten and alpha flags', () => {
    const d = doc();
    d.output.format = 'jpeg';
    const jpeg = planPasses(d, size).slice(-1)[0];
    expect(jpeg).toMatchObject({ kind: 'output', flatten: true, alpha: false });

    d.output.format = 'png';
    const png = planPasses(d, size).slice(-1)[0];
    expect(png).toMatchObject({ kind: 'output', flatten: false, alpha: true });
  });
});

describe('withLeadingGeometry', () => {
  it('prepends a clamping geometry pass when none exists', () => {
    const passes = planPasses(doc(), size);
    const result = withLeadingGeometry(passes, IDENTITY_MAT3);
    expect(result[0]).toMatchObject({ kind: 'geometry', clamp: true });
    expect(result).toHaveLength(passes.length + 1);
  });

  it('does not duplicate an existing geometry pass', () => {
    const d = doc();
    d.geometry.crop = { x: 0.1, y: 0, width: 0.5, height: 1 };
    const passes = planPasses(d, size, IDENTITY_MAT3);
    expect(passes[0]?.kind).toBe('geometry');
    expect(withLeadingGeometry(passes, IDENTITY_MAT3)).toBe(passes);
  });
});

describe('planHash', () => {  it('is stable for identical plans', () => {
    const a = planPasses(doc(), size);
    const b = planPasses(doc(), size);
    expect(planHash(a)).toBe(planHash(b));
  });

  it('changes when a parameter changes', () => {
    const d1 = doc();
    d1.adjust.contrast = 10;
    const d2 = doc();
    d2.adjust.contrast = 20;
    expect(planHash(planPasses(d1, size))).not.toBe(planHash(planPasses(d2, size)));
  });

  it('does not collide across pass kinds', () => {
    const a = doc();
    a.adjust.contrast = 10;
    const b = doc();
    b.look.id = 'noir';
    expect(planHash(planPasses(a, size))).not.toBe(planHash(planPasses(b, size)));
  });
});