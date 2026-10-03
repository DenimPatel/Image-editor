import { describe, expect, it } from 'vitest'
import { mmToPx } from '../../lib/crop/geometry'
import { createDoc } from '../../model/defaults'
import type { Doc } from '../../model/types'
import { checkCompliance } from './compliance'
import { complianceInputFor } from './measure'
import type { PhotoMeasurement } from './measureFace'
import { getSpec, specGeometry } from './specs'

const spec = getSpec('us-2x2')
if (!spec) throw new Error('missing us-2x2')

const US = spec

function printSizedDoc(overrides: Partial<Doc> = {}): Doc {
  const base = createDoc()
  return {
    ...base,
    source: {
      assetId: 'asset-1',
      width: 2000,
      height: 3000,
      name: 'photo.jpg',
      mime: 'image/jpeg',
    },
    ...overrides,
    output: {
      ...base.output,
      dpi: US.dpi,
      resize: { mode: 'physical', widthMm: US.widthMm, heightMm: US.heightMm, dpi: US.dpi },
      ...(overrides.output ?? {}),
    },
    background: { ...base.background, ...(overrides.background ?? {}) },
  }
}

function measured(
  face: { crown: number; chin: number; eye: number; centre?: number } | null,
  background: PhotoMeasurement['background'] = {
    color: { r: 255, g: 255, b: 255 },
    uniformity: 1,
    present: true,
  },
): PhotoMeasurement {
  return {
    face: face
      ? {
          landmarks: {
            crown: { x: face.centre ?? 0.5, y: face.crown },
            chin: { x: face.centre ?? 0.5, y: face.chin },
            leftEye: { x: (face.centre ?? 0.5) - 0.09, y: face.eye },
            rightEye: { x: (face.centre ?? 0.5) + 0.09, y: face.eye },
          },
          box: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0.9,
        }
      : null,
    background,
  }
}

describe('complianceInputFor', () => {
  it('marks every face rule assumed when nothing was measured', () => {
    const { input, provenance } = complianceInputFor(printSizedDoc(), US, null)

    expect(provenance['head-height']).toBe('assumed')
    expect(provenance['eye-line']).toBe('assumed')
    expect(provenance.centring).toBe('assumed')
    expect(provenance['background-colour']).toBe('assumed')
    // Without a face the advisory values are the spec's own, never a midpoint
    // of the head range presented as a measurement.
    expect(input.headHeightMm).toBeCloseTo(specGeometry(US).headMm, 6)
  })

  it('measures head height, eye line and centring off the rendered photo', () => {
    const print = mmToPx(US.heightMm, US.dpi)
    // A head 40 % of the frame tall with its eyes 55 % of the way down it.
    const doc = printSizedDoc()
    const { input, provenance } = complianceInputFor(
      doc,
      US,
      measured({ crown: 0.1, chin: 0.5, eye: 0.45, centre: 0.56 }),
    )

    expect(input.headHeightMm).toBeCloseTo(((0.4 * print) / print) * US.heightMm, 3)
    expect(input.eyeLineMmFromBottom).toBeCloseTo(0.55 * US.heightMm, 3)
    expect(input.centeredOffsetMm).toBeGreaterThan(0)
    expect(provenance['head-height']).toBe('measured')
    expect(provenance.centring).toBe('measured')
  })

  it('lets a badly framed photo fail instead of reporting the spec midpoint', () => {
    const doc = printSizedDoc()
    // Head at 8 % of the frame: far too small for any of these specs.
    const report = checkCompliance(
      complianceInputFor(doc, US, measured({ crown: 0.05, chin: 0.13, eye: 0.08 })).input,
    )

    expect(report.rules.find((rule) => rule.id === 'head-height')?.status).toBe('fail')
    expect(report.overall).toBe('fail')
  })

  it('reports the background rules as measured when the border was sampled', () => {
    const doc = printSizedDoc()
    const { input, provenance } = complianceInputFor(
      doc,
      US,
      measured(null, { color: { r: 220, g: 30, b: 30 }, uniformity: 1, present: true }),
    )

    expect(input.backgroundColor).toEqual({ r: 220, g: 30, b: 30 })
    expect(provenance['background-colour']).toBe('measured')
    expect(checkCompliance(input).rules.find((r) => r.id === 'background-colour')?.status).toBe(
      'fail',
    )
  })

  it('fails the presence rule when the photo has no backdrop at all', () => {
    const doc = printSizedDoc({ background: { ...createDoc().background, mode: 'none' } })
    const { input, provenance } = complianceInputFor(doc, US, null)

    expect(input.backgroundPresent).toBe(false)
    expect(input.backgroundUniformity).toBe(0)
    expect(checkCompliance(input).rules.find((r) => r.id === 'background-present')?.status).toBe(
      'fail',
    )
    expect(provenance['background-present']).toBe('assumed')
  })

  it('reads the document background colour when the canvas was not sampled', () => {
    const doc = printSizedDoc({
      background: { ...createDoc().background, mode: 'color', color: '#ffffff' },
    })
    const { input } = complianceInputFor(doc, US, null)

    expect(input.backgroundColor).toEqual({ r: 255, g: 255, b: 255 })
    expect(input.backgroundPresent).toBe(true)
    expect(checkCompliance(input).overall).toBe('pass')
  })

  it('fails a photo of entirely the wrong shape', () => {
    const base = createDoc()
    const doc: Doc = {
      ...printSizedDoc(),
      output: { ...base.output, dpi: 300, resize: { mode: 'width', width: 1200 } },
    }
    const report = checkCompliance(complianceInputFor(doc, US, null).input)

    expect(report.rules.find((rule) => rule.id === 'aspect')?.status).toBe('fail')
    expect(report.overall).not.toBe('pass')
  })

  it('passes a correctly transposed landscape frame of a portrait spec', () => {
    // UK 35×45 turned landscape prints 45×35 mm. Measured in a browser, the
    // shape rule used to compare that 531×413 export against the spec's own
    // 35/45 ratio and reported "65% off the 35×45 mm ratio" (D5-F15).
    const uk = getSpec('uk-35x45')
    if (!uk) throw new Error('missing uk-35x45')
    const base = createDoc()
    const doc: Doc = {
      ...printSizedDoc(),
      output: {
        ...base.output,
        dpi: uk.dpi,
        resize: { mode: 'physical', widthMm: 45, heightMm: 35, dpi: uk.dpi },
      },
    }
    const { input } = complianceInputFor(doc, uk, null)

    expect(input.frameMm).toEqual({ widthMm: 45, heightMm: 35 })
    expect(checkCompliance(input).rules.find((rule) => rule.id === 'aspect')?.status).toBe('pass')
  })

  it('scales effective DPI against the printed frame, not the spec', () => {
    const uk = getSpec('uk-35x45')
    if (!uk) throw new Error('missing uk-35x45')
    const base = createDoc()
    const doc: Doc = {
      ...printSizedDoc(),
      output: {
        ...base.output,
        dpi: uk.dpi,
        resize: { mode: 'physical', widthMm: 45, heightMm: 35, dpi: uk.dpi },
      },
    }
    // 45 mm at 300 DPI is 531 px, so the effective DPI is ~300. Read against
    // the spec's own 35 mm it would have reported 385.
    const { input } = complianceInputFor(doc, uk, null, { width: 531, height: 413 })
    const report = checkCompliance(input)
    const rule = report.rules.find((r) => r.id === 'dpi')

    expect(report.effectiveDpi).toBeCloseTo(300, 0)
    expect(report.effectiveDpi).toBeLessThan(320)
    // mmToPx rounds 45 mm at 300 DPI down to 531 px, i.e. 299.72 DPI. The
    // status and the quoted number have to agree.
    expect(rule?.detail).toBe("Your photo is 531 px wide — that's 300 DPI.")
    expect(rule?.status).toBe('pass')
  })

  it('refuses to re-read a measurement against a frame it was not taken on', () => {
    // The panel keeps the last measurement across every later edit. A 1:1
    // reading scaled by a 16:9 output reported a 30.6 mm head as 41.3 mm and
    // still called the rule `measured` (D5-F12).
    const base = createDoc()
    const doc: Doc = {
      ...printSizedDoc(),
      output: { ...base.output, dpi: 300, resize: { mode: 'none' } },
    }
    const { input, provenance } = complianceInputFor(
      doc,
      US,
      measured({ crown: 0.1, chin: 0.5, eye: 0.45 }),
      { width: 1271, height: 810 },
    )

    expect(provenance['head-height']).toBe('assumed')
    expect(input.headHeightMm).toBeCloseTo(specGeometry(US).headMm, 6)
  })
})
