import { describe, expect, it } from 'vitest'
import { mmToPx } from '../../lib/crop/geometry'
import { checkCompliance } from './compliance'
import type { ComplianceInput } from './compliance'
import { getSpec } from './specs'

const spec = getSpec('us-2x2')
if (!spec) throw new Error('missing us-2x2')

const US = spec

function goodInput(): ComplianceInput {
  return {
    spec: US,
    headHeightMm: (US.headHeightMm.min + US.headHeightMm.max) / 2,
    eyeLineMmFromBottom: (US.eyeLineMmFromBottom.min + US.eyeLineMmFromBottom.max) / 2,
    outputWidthPx: Math.ceil(mmToPx(US.widthMm, US.dpi)),
    outputHeightPx: Math.ceil(mmToPx(US.heightMm, US.dpi)),
    backgroundUniformity: 1,
    backgroundColor: { r: 255, g: 255, b: 255 },
    backgroundPresent: true,
    centeredOffsetMm: 0,
  }
}

function statusOf(input: ComplianceInput, id: string) {
  const rule = checkCompliance(input).rules.find((r) => r.id === id)
  if (!rule) throw new Error(`missing rule ${id}`)
  return rule.status
}

describe('checkCompliance', () => {
  it('passes every rule for a well-formed photo', () => {
    const report = checkCompliance(goodInput())

    expect(report.overall).toBe('pass')
    for (const rule of report.rules) {
      expect(rule.status).toBe('pass')
    }
    expect(report.effectiveDpi).toBeCloseTo(US.dpi, 6)
  })

  it('fails every rule on deliberately bad input', () => {
    const input: ComplianceInput = {
      ...goodInput(),
      headHeightMm: US.headHeightMm.max + 10,
      eyeLineMmFromBottom: US.eyeLineMmFromBottom.min - 10,
      centeredOffsetMm: 10,
      backgroundUniformity: 0.5,
      backgroundColor: { r: 214, g: 40, b: 40 },
      backgroundPresent: false,
      outputWidthPx: 100,
    }

    const report = checkCompliance(input)

    expect(statusOf(input, 'head-height')).toBe('fail')
    expect(statusOf(input, 'eye-line')).toBe('fail')
    expect(statusOf(input, 'centring')).toBe('fail')
    expect(statusOf(input, 'background')).toBe('fail')
    expect(statusOf(input, 'dpi')).toBe('fail')
    expect(statusOf(input, 'aspect')).toBe('fail')
    expect(statusOf(input, 'background-colour')).toBe('fail')
    expect(statusOf(input, 'background-present')).toBe('fail')
    expect(report.overall).toBe('fail')
  })

  it('reports the actual effective DPI in the resolution detail', () => {
    const input: ComplianceInput = { ...goodInput(), outputWidthPx: 480 }
    const rule = checkCompliance(input).rules.find((r) => r.id === 'dpi')

    expect(rule?.detail).toContain('480 px wide')
    expect(rule?.detail).toContain(`${Math.round(480 / (US.widthMm / 25.4))} DPI`)
  })

  it('warns instead of failing for a slightly off-centre face', () => {
    expect(statusOf({ ...goodInput(), centeredOffsetMm: 2.5 }, 'centring')).toBe('pass')
    expect(statusOf({ ...goodInput(), centeredOffsetMm: 4 }, 'centring')).toBe('fail')
  })

  it('warns for marginal background uniformity and DPI', () => {
    expect(statusOf({ ...goodInput(), backgroundUniformity: 0.92 }, 'background')).toBe('warn')
    expect(
      statusOf(
        { ...goodInput(), outputWidthPx: Math.floor(0.85 * mmToPx(US.widthMm, US.dpi)) },
        'dpi',
      ),
    ).toBe('warn')
  })

  it('warns overall when a rule warns and none fail', () => {
    const report = checkCompliance({ ...goodInput(), backgroundUniformity: 0.92 })
    expect(report.overall).toBe('warn')
  })

  // D5-F12: `outputHeightPx` was declared, supplied and never read, so a photo
  // of entirely the wrong shape satisfied every check in the list.
  describe('D5-F12: the checks that could never fail', () => {
    it('fails a photo of the wrong shape even when everything else measures well', () => {
      const input: ComplianceInput = { ...goodInput(), outputHeightPx: 300 }

      expect(statusOf(input, 'aspect')).toBe('fail')
      expect(checkCompliance(input).overall).toBe('fail')
    })

    it('warns on a slightly wrong shape and passes the exact ratio', () => {
      const tall = Math.round(goodInput().outputWidthPx / 0.97)
      expect(statusOf({ ...goodInput(), outputHeightPx: tall }, 'aspect')).toBe('warn')
      expect(statusOf(goodInput(), 'aspect')).toBe('pass')
    })

    it('names the spec dimensions in the shape detail', () => {
      const rule = checkCompliance({ ...goodInput(), outputHeightPx: 300 }).rules.find(
        (r) => r.id === 'aspect',
      )

      expect(rule?.detail).toContain('50.8×50.8 mm')
      expect(rule?.detail).toContain('600×300 px')
    })

    it('fails a perfectly uniform red background on a white spec', () => {
      // Uniformity alone scored this 1.0 and passed: uniformity measures how
      // even the backdrop is, not what colour it is.
      const input: ComplianceInput = {
        ...goodInput(),
        backgroundUniformity: 1,
        backgroundColor: { r: 220, g: 20, b: 20 },
      }

      expect(statusOf(input, 'background')).toBe('pass')
      expect(statusOf(input, 'background-colour')).toBe('fail')
    })

    it('accepts a light-grey background for a light-grey spec', () => {
      const uk = getSpec('uk-35x45')
      if (!uk) throw new Error('missing uk-35x45')
      const input: ComplianceInput = {
        ...goodInput(),
        spec: uk,
        headHeightMm: (uk.headHeightMm.min + uk.headHeightMm.max) / 2,
        eyeLineMmFromBottom: (uk.eyeLineMmFromBottom.min + uk.eyeLineMmFromBottom.max) / 2,
        outputWidthPx: Math.ceil(mmToPx(uk.widthMm, uk.dpi)),
        outputHeightPx: Math.ceil(mmToPx(uk.heightMm, uk.dpi)),
        backgroundColor: { r: 242, g: 242, b: 242 },
      }

      expect(statusOf(input, 'background-colour')).toBe('pass')
    })

    it('accepts any background colour when the spec says any', () => {
      const any = getSpec('generic-35x45')
      if (!any) throw new Error('missing generic-35x45')
      const input: ComplianceInput = {
        ...goodInput(),
        spec: any,
        backgroundColor: { r: 220, g: 20, b: 20 },
        backgroundPresent: false,
      }

      expect(statusOf(input, 'background-colour')).toBe('pass')
      expect(statusOf(input, 'background-present')).toBe('pass')
    })

    it('fails when there is no background behind the subject', () => {
      // `uniformity` was 1 whenever `background.mode === 'none'`, so a photo
      // with no backdrop at all passed the background rule.
      const input: ComplianceInput = { ...goodInput(), backgroundPresent: false }

      expect(statusOf(input, 'background-present')).toBe('fail')
      expect(statusOf(input, 'background')).toBe('pass')
    })

    it('warns instead of guessing when the background colour is unknown', () => {
      const input: ComplianceInput = {
        ...goodInput(),
        backgroundColor: null,
        backgroundPresent: null,
      }

      expect(statusOf(input, 'background-colour')).toBe('warn')
      expect(statusOf(input, 'background-present')).toBe('warn')
      const rule = checkCompliance({ ...goodInput(), backgroundColor: null }).rules.find(
        (r) => r.id === 'background-colour',
      )
      expect(rule?.source).toBe('assumed')
    })
  })

  describe('provenance', () => {
    it('marks every rule as assumed unless the caller declares otherwise', () => {
      for (const rule of checkCompliance(goodInput()).rules) {
        expect(rule.source, rule.id).toBe('measured')
      }
    })

    it('lets the caller relabel the rules it could not measure', () => {
      const report = checkCompliance({
        ...goodInput(),
        provenance: { 'head-height': 'assumed', 'eye-line': 'assumed', centring: 'assumed' },
      })

      const byId = new Map(report.rules.map((rule) => [rule.id, rule.source]))
      expect(byId.get('head-height')).toBe('assumed')
      expect(byId.get('eye-line')).toBe('assumed')
      expect(byId.get('centring')).toBe('assumed')
      expect(byId.get('dpi')).toBe('measured')
    })
  })
})
