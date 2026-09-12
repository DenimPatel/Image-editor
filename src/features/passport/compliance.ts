import type { PassportSpec } from './specs';

export type ComplianceStatus = 'pass' | 'warn' | 'fail';

export type ComplianceRule = {
  id: string;
  label: string;
  status: ComplianceStatus;
  detail: string;
};

export type ComplianceInput = {
  spec: PassportSpec;
  headHeightMm: number;
  eyeLineMmFromBottom: number;
  outputWidthPx: number;
  outputHeightPx: number;
  backgroundUniformity: number;
  centeredOffsetMm: number;
};

export type ComplianceReport = {
  rules: ComplianceRule[];
  overall: ComplianceStatus;
  effectiveDpi: number;
};

function rangeStatus(value: number, min: number, max: number): ComplianceStatus {
  if (value < min || value > max) return 'fail';
  const margin = (max - min) * 0.05;
  if (value <= min + margin || value >= max - margin) return 'warn';
  return 'pass';
}

function headHeightRule(input: ComplianceInput): ComplianceRule {
  const { min, max } = input.spec.headHeightMm;
  const status = rangeStatus(input.headHeightMm, min, max);
  let detail: string;
  if (status === 'fail') {
    detail = `Head height is ${input.headHeightMm.toFixed(1)} mm — the required range is ${min}–${max} mm.`;
  } else if (status === 'warn') {
    const edge = input.headHeightMm <= min + (max - min) * 0.05 ? 'minimum' : 'maximum';
    detail = `Head height is just above the ${edge} of the ${min}–${max} mm range.`;
  } else {
    detail = `Head height is ${input.headHeightMm.toFixed(1)} mm, within ${min}–${max} mm.`;
  }
  return { id: 'head-height', label: 'Head height', status, detail };
}

function eyeLineRule(input: ComplianceInput): ComplianceRule {
  const { min, max } = input.spec.eyeLineMmFromBottom;
  const status = rangeStatus(input.eyeLineMmFromBottom, min, max);
  let detail: string;
  if (status === 'fail') {
    detail = `Eye line is ${input.eyeLineMmFromBottom.toFixed(1)} mm from the bottom — the required range is ${min}–${max} mm.`;
  } else if (status === 'warn') {
    const edge = input.eyeLineMmFromBottom <= min + (max - min) * 0.05 ? 'minimum' : 'maximum';
    detail = `Eye line is just above the ${edge} of the ${min}–${max} mm range.`;
  } else {
    detail = `Eye line is ${input.eyeLineMmFromBottom.toFixed(1)} mm from the bottom, within ${min}–${max} mm.`;
  }
  return { id: 'eye-line', label: 'Eye line', status, detail };
}

function centringRule(input: ComplianceInput): ComplianceRule {
  const offset = Math.abs(input.centeredOffsetMm);
  const status: ComplianceStatus = offset <= 3 ? 'pass' : 'fail';
  const detail =
    status === 'pass'
      ? `Head is centred within ${offset.toFixed(1)} mm.`
      : `Head is off-centre by ${offset.toFixed(1)} mm — keep it within 3 mm.`;
  return { id: 'centring', label: 'Horizontal centring', status, detail };
}

function backgroundRule(input: ComplianceInput): ComplianceRule {
  if (input.spec.background === 'any') {
    return {
      id: 'background',
      label: 'Background',
      status: 'pass',
      detail: 'This spec accepts any plain background.',
    };
  }
  const uniformity = input.backgroundUniformity;
  const status: ComplianceStatus = uniformity >= 0.95 ? 'pass' : uniformity >= 0.9 ? 'warn' : 'fail';
  const percent = Math.round(uniformity * 100);
  let detail: string;
  if (status === 'fail') {
    detail = `Background uniformity is ${percent}% — a plain ${
      input.spec.background === 'light-grey' ? 'light grey' : 'white'
    } background is required.`;
  } else if (status === 'warn') {
    detail = `Background uniformity is ${percent}% — reduce shadows and texture.`;
  } else {
    detail = `Background uniformity is ${percent}%.`;
  }
  return { id: 'background', label: 'Background', status, detail };
}

function dpiRule(spec: PassportSpec, outputWidthPx: number, effectiveDpi: number): ComplianceRule {
  const status: ComplianceStatus =
    effectiveDpi >= spec.dpi ? 'pass' : effectiveDpi >= 0.8 * spec.dpi ? 'warn' : 'fail';
  const rounded = Math.round(effectiveDpi);
  let detail: string;
  if (status === 'fail') {
    detail = `Your photo is ${outputWidthPx} px wide — that's ${rounded} DPI, below the ${spec.dpi} DPI minimum.`;
  } else if (status === 'warn') {
    detail = `Your photo is ${outputWidthPx} px wide — that's ${rounded} DPI, below the recommended ${spec.dpi} DPI.`;
  } else {
    detail = `Your photo is ${outputWidthPx} px wide — that's ${rounded} DPI.`;
  }
  return { id: 'dpi', label: 'Resolution', status, detail };
}

export function checkCompliance(input: ComplianceInput): ComplianceReport {
  const effectiveDpi = input.outputWidthPx / (input.spec.widthMm / 25.4);

  const rules: ComplianceRule[] = [
    headHeightRule(input),
    eyeLineRule(input),
    centringRule(input),
    backgroundRule(input),
    dpiRule(input.spec, input.outputWidthPx, effectiveDpi),
  ];

  const overall: ComplianceStatus = rules.some((rule) => rule.status === 'fail')
    ? 'fail'
    : rules.some((rule) => rule.status === 'warn')
      ? 'warn'
      : 'pass';

  return { rules, overall, effectiveDpi };
}