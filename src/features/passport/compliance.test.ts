import { describe, expect, it } from 'vitest';
import { mmToPx } from '../../lib/crop/geometry';
import { checkCompliance } from './compliance';
import type { ComplianceInput } from './compliance';
import { getSpec } from './specs';

const spec = getSpec('us-2x2');
if (!spec) throw new Error('missing us-2x2');

const US = spec;

function goodInput(): ComplianceInput {
  return {
    spec: US,
    headHeightMm: (US.headHeightMm.min + US.headHeightMm.max) / 2,
    eyeLineMmFromBottom: (US.eyeLineMmFromBottom.min + US.eyeLineMmFromBottom.max) / 2,
    outputWidthPx: Math.ceil(mmToPx(US.widthMm, US.dpi)),
    outputHeightPx: Math.ceil(mmToPx(US.heightMm, US.dpi)),
    backgroundUniformity: 1,
    centeredOffsetMm: 0,
  };
}

function statusOf(input: ComplianceInput, id: string) {
  const rule = checkCompliance(input).rules.find((r) => r.id === id);
  if (!rule) throw new Error(`missing rule ${id}`);
  return rule.status;
}

describe('checkCompliance', () => {
  it('passes every rule for a well-formed photo', () => {
    const report = checkCompliance(goodInput());

    expect(report.overall).toBe('pass');
    for (const rule of report.rules) {
      expect(rule.status).toBe('pass');
    }
    expect(report.effectiveDpi).toBeCloseTo(US.dpi, 6);
  });

  it('fails every rule on deliberately bad input', () => {
    const input: ComplianceInput = {
      ...goodInput(),
      headHeightMm: US.headHeightMm.max + 10,
      eyeLineMmFromBottom: US.eyeLineMmFromBottom.min - 10,
      centeredOffsetMm: 10,
      backgroundUniformity: 0.5,
      outputWidthPx: 100,
    };

    const report = checkCompliance(input);

    expect(statusOf(input, 'head-height')).toBe('fail');
    expect(statusOf(input, 'eye-line')).toBe('fail');
    expect(statusOf(input, 'centring')).toBe('fail');
    expect(statusOf(input, 'background')).toBe('fail');
    expect(statusOf(input, 'dpi')).toBe('fail');
    expect(report.overall).toBe('fail');
  });

  it('reports the actual effective DPI in the resolution detail', () => {
    const input: ComplianceInput = { ...goodInput(), outputWidthPx: 480 };
    const rule = checkCompliance(input).rules.find((r) => r.id === 'dpi');

    expect(rule?.detail).toContain('480 px wide');
    expect(rule?.detail).toContain(`${Math.round(480 / (US.widthMm / 25.4))} DPI`);
  });

  it('warns instead of failing for a slightly off-centre face', () => {
    expect(statusOf({ ...goodInput(), centeredOffsetMm: 2.5 }, 'centring')).toBe('pass');
    expect(statusOf({ ...goodInput(), centeredOffsetMm: 4 }, 'centring')).toBe('fail');
  });

  it('warns for marginal background uniformity and DPI', () => {
    expect(statusOf({ ...goodInput(), backgroundUniformity: 0.92 }, 'background')).toBe('warn');
    expect(
      statusOf({ ...goodInput(), outputWidthPx: Math.floor(0.85 * mmToPx(US.widthMm, US.dpi)) }, 'dpi'),
    ).toBe('warn');
  });

  it('warns overall when a rule warns and none fail', () => {
    const report = checkCompliance({ ...goodInput(), backgroundUniformity: 0.92 });
    expect(report.overall).toBe('warn');
  });
});