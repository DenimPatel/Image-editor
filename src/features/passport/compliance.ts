import type { PassportSpec } from './specs'

export type ComplianceStatus = 'pass' | 'warn' | 'fail'

/** Where a rule's input came from. The panel discloses this rather than passing
 * a midpoint of the spec range and calling it a measurement (D5-F12). */
export type ComplianceSource = 'measured' | 'assumed'

export type ComplianceRuleId =
  | 'head-height'
  | 'eye-line'
  | 'centring'
  | 'aspect'
  | 'background'
  | 'background-colour'
  | 'background-present'
  | 'dpi'

export type Rgb = { r: number; g: number; b: number }

export type ComplianceRule = {
  id: ComplianceRuleId
  label: string
  status: ComplianceStatus
  detail: string
  source: ComplianceSource
}

export type ComplianceInput = {
  spec: PassportSpec
  /**
   * The frame the photo is *supposed* to fill, after a portrait/landscape swap.
   * Defaults to the spec's own millimetres. A landscape 45×35 mm print of a
   * 35×45 mm spec is the right photo at the wrong stated ratio, so the shape
   * and DPI rules have to compare against what the document actually asks for
   * (D5-F15).
   */
  frameMm?: { widthMm: number; heightMm: number }
  headHeightMm: number
  eyeLineMmFromBottom: number
  outputWidthPx: number
  outputHeightPx: number
  backgroundUniformity: number
  /** Mean colour of the border of the rendered photo, or null when unknown. */
  backgroundColor: Rgb | null
  /** Whether the output has a background behind the subject at all. */
  backgroundPresent: boolean | null
  centeredOffsetMm: number
  /** Per-rule provenance. Anything not declared is reported as `assumed`. */
  provenance?: Partial<Record<ComplianceRuleId, ComplianceSource>>
}

export type ComplianceReport = {
  rules: ComplianceRule[]
  overall: ComplianceStatus
  effectiveDpi: number
}

/** Aspect tolerance before a photo of the wrong shape is rejected outright. */
const ASPECT_PASS = 0.02
const ASPECT_WARN = 0.05

function rangeStatus(value: number, min: number, max: number): ComplianceStatus {
  if (value < min || value > max) return 'fail'
  const margin = (max - min) * 0.05
  if (value <= min + margin || value >= max - margin) return 'warn'
  return 'pass'
}

function headHeightRule(input: ComplianceInput): ComplianceRule {
  const { min, max } = input.spec.headHeightMm
  const status = rangeStatus(input.headHeightMm, min, max)
  let detail: string
  if (status === 'fail') {
    detail = `Head height is ${input.headHeightMm.toFixed(1)} mm — the required range is ${min}–${max} mm.`
  } else if (status === 'warn') {
    const edge = input.headHeightMm <= min + (max - min) * 0.05 ? 'minimum' : 'maximum'
    detail = `Head height is just above the ${edge} of the ${min}–${max} mm range.`
  } else {
    detail = `Head height is ${input.headHeightMm.toFixed(1)} mm, within ${min}–${max} mm.`
  }
  return { id: 'head-height', label: 'Head height', status, detail, source: 'measured' }
}

function eyeLineRule(input: ComplianceInput): ComplianceRule {
  const { min, max } = input.spec.eyeLineMmFromBottom
  const status = rangeStatus(input.eyeLineMmFromBottom, min, max)
  let detail: string
  if (status === 'fail') {
    detail = `Eye line is ${input.eyeLineMmFromBottom.toFixed(1)} mm from the bottom — the required range is ${min}–${max} mm.`
  } else if (status === 'warn') {
    const edge = input.eyeLineMmFromBottom <= min + (max - min) * 0.05 ? 'minimum' : 'maximum'
    detail = `Eye line is just above the ${edge} of the ${min}–${max} mm range.`
  } else {
    detail = `Eye line is ${input.eyeLineMmFromBottom.toFixed(1)} mm from the bottom, within ${min}–${max} mm.`
  }
  return { id: 'eye-line', label: 'Eye line', status, detail, source: 'measured' }
}

function centringRule(input: ComplianceInput): ComplianceRule {
  const offset = Math.abs(input.centeredOffsetMm)
  const status: ComplianceStatus = offset <= 3 ? 'pass' : 'fail'
  const detail =
    status === 'pass'
      ? `Head is centred within ${offset.toFixed(1)} mm.`
      : `Head is off-centre by ${offset.toFixed(1)} mm — keep it within 3 mm.`
  return { id: 'centring', label: 'Horizontal centring', status, detail, source: 'measured' }
}

/** The millimetres the output is checked against, honouring a frame swap. */
export function inputFrameMm(input: ComplianceInput): { widthMm: number; heightMm: number } {
  return input.frameMm ?? { widthMm: input.spec.widthMm, heightMm: input.spec.heightMm }
}

/**
 * Shape check. The panel used to pass `outputHeightPx` to every rule and no
 * rule ever read it, so a photo of entirely the wrong shape satisfied every
 * check in the list.
 */
function aspectRule(input: ComplianceInput): ComplianceRule {
  const { outputWidthPx, outputHeightPx } = input
  const frame = inputFrameMm(input)
  if (!(outputWidthPx > 0) || !(outputHeightPx > 0)) {
    return {
      id: 'aspect',
      label: 'Photo shape',
      status: 'fail',
      detail: `This spec needs a ${frame.widthMm}×${frame.heightMm} mm photo, but the output is ${outputWidthPx}×${outputHeightPx} px.`,
      source: 'measured',
    }
  }
  const wanted = frame.widthMm / frame.heightMm
  const actual = outputWidthPx / outputHeightPx
  const deviation = Math.abs(actual - wanted) / wanted
  const status: ComplianceStatus =
    deviation <= ASPECT_PASS ? 'pass' : deviation <= ASPECT_WARN ? 'warn' : 'fail'
  const detail =
    status === 'pass'
      ? `The photo is ${outputWidthPx}×${outputHeightPx} px, the ${frame.widthMm}×${frame.heightMm} mm ratio.`
      : `The photo is ${outputWidthPx}×${outputHeightPx} px — ${Math.round(deviation * 100)}% off the ${frame.widthMm}×${frame.heightMm} mm ratio this spec requires.`
  return { id: 'aspect', label: 'Photo shape', status, detail, source: 'measured' }
}

function backgroundRule(input: ComplianceInput): ComplianceRule {
  if (input.spec.background === 'any') {
    return {
      id: 'background',
      label: 'Background',
      status: 'pass',
      detail: 'This spec accepts any plain background.',
      source: 'measured',
    }
  }
  const uniformity = input.backgroundUniformity
  const status: ComplianceStatus = uniformity >= 0.95 ? 'pass' : uniformity >= 0.9 ? 'warn' : 'fail'
  const percent = Math.round(uniformity * 100)
  let detail: string
  if (status === 'fail') {
    detail = `Background uniformity is ${percent}% — a plain ${
      input.spec.background === 'light-grey' ? 'light grey' : 'white'
    } background is required.`
  } else if (status === 'warn') {
    detail = `Background uniformity is ${percent}% — reduce shadows and texture.`
  } else {
    detail = `Background uniformity is ${percent}%.`
  }
  return { id: 'background', label: 'Background uniformity', status, detail, source: 'measured' }
}

/**
 * Hue check. Uniformity alone is not a background check: a perfectly uniform
 * red backdrop scored 1.0 and passed a `white` spec.
 */
function backgroundColourRule(input: ComplianceInput): ComplianceRule {
  const required = input.spec.background
  if (required === 'any') {
    return {
      id: 'background-colour',
      label: 'Background colour',
      status: 'pass',
      detail: 'This spec accepts any plain background.',
      source: 'measured',
    }
  }
  const color = input.backgroundColor
  if (!color) {
    return {
      id: 'background-colour',
      label: 'Background colour',
      status: 'warn',
      detail: `Background colour was not measured, so the ${required.replace('-', ' ')} requirement is unchecked.`,
      source: 'assumed',
    }
  }
  const lightness = Math.max(color.r, color.g, color.b)
  const chroma = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
  const limits =
    required === 'white'
      ? { pass: 225, warn: 200, chroma: 22 }
      : { pass: 190, warn: 150, chroma: 26 }
  const hex = `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
  const name = required === 'white' ? 'white' : 'light grey'

  const status: ComplianceStatus =
    lightness >= limits.pass && chroma <= limits.chroma
      ? 'pass'
      : lightness >= limits.warn && chroma <= limits.chroma * 2
        ? 'warn'
        : 'fail'
  const detail =
    status === 'pass'
      ? `The background measures ${hex}, a plain ${name}.`
      : status === 'warn'
        ? `The background measures ${hex} — closer to ${name}, but not quite.`
        : `The background measures ${hex}, not the ${name} this spec requires.`
  return { id: 'background-colour', label: 'Background colour', status, detail, source: 'measured' }
}

/**
 * Presence check. Uniformity was `1` when `background.mode === 'none'`, so the
 * one rule that looked at it passed a photo with no background behind it.
 */
function backgroundPresenceRule(input: ComplianceInput): ComplianceRule {
  if (input.spec.background === 'any') {
    return {
      id: 'background-present',
      label: 'Background',
      status: 'pass',
      detail: 'This spec accepts any plain background.',
      source: 'measured',
    }
  }
  const present = input.backgroundPresent
  const status: ComplianceStatus = present === null ? 'warn' : present ? 'pass' : 'fail'
  const detail =
    status === 'pass'
      ? 'A plain background is composited behind the subject.'
      : status === 'warn'
        ? 'Could not tell whether the photo has a plain background behind the subject.'
        : 'There is no plain background behind the subject — add one before printing.'
  return {
    id: 'background-present',
    label: 'Background present',
    status,
    detail,
    source: 'measured',
  }
}

function dpiRule(spec: PassportSpec, outputWidthPx: number, effectiveDpi: number): ComplianceRule {
  const rounded = Math.round(effectiveDpi)
  // mmToPx rounds the print size, so a 300 DPI print can read 299.7. Judging
  // the unrounded number let the rule say "that's 300 DPI, below the
  // recommended 300 DPI" — the status has to be taken from the same number the
  // detail quotes.
  const status: ComplianceStatus =
    rounded >= spec.dpi ? 'pass' : rounded >= 0.8 * spec.dpi ? 'warn' : 'fail'
  let detail: string
  if (status === 'fail') {
    detail = `Your photo is ${outputWidthPx} px wide — that's ${rounded} DPI, below the ${spec.dpi} DPI minimum.`
  } else if (status === 'warn') {
    detail = `Your photo is ${outputWidthPx} px wide — that's ${rounded} DPI, below the recommended ${spec.dpi} DPI.`
  } else {
    detail = `Your photo is ${outputWidthPx} px wide — that's ${rounded} DPI.`
  }
  return { id: 'dpi', label: 'Resolution', status, detail, source: 'measured' }
}

export function checkCompliance(input: ComplianceInput): ComplianceReport {
  const frame = inputFrameMm(input)
  const effectiveDpi = input.outputWidthPx / (frame.widthMm / 25.4)

  const rules: ComplianceRule[] = [
    headHeightRule(input),
    eyeLineRule(input),
    centringRule(input),
    aspectRule(input),
    backgroundRule(input),
    backgroundColourRule(input),
    backgroundPresenceRule(input),
    dpiRule(input.spec, input.outputWidthPx, effectiveDpi),
  ].map((rule) => ({ ...rule, source: input.provenance?.[rule.id] ?? rule.source }))

  const overall: ComplianceStatus = rules.some((rule) => rule.status === 'fail')
    ? 'fail'
    : rules.some((rule) => rule.status === 'warn')
      ? 'warn'
      : 'pass'

  return { rules, overall, effectiveDpi }
}
