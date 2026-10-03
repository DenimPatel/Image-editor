import { describe, expect, it } from 'vitest'
import { mmToPx } from '../../lib/crop/geometry'
import { parseHexColor } from '../../lib/hex-color'
import { checkCompliance, type ComplianceInput } from './compliance'
import {
  EYE_HEIGHT_IN_HEAD,
  FRAME_MARGIN_MM,
  PASSPORT_SPECS,
  getSpec,
  specBackgroundColor,
  specGeometry,
  type PassportSpec,
} from './specs'

const REQUIRED_IDS = [
  'us-2x2',
  'us-visa-2x2',
  'india-2x2',
  'uk-35x45',
  'schengen-35x45',
  'canada-50x70',
  'australia-35x45',
  'china-33x48',
  'japan-35x45',
  'oci-51x51',
  'generic-35x45',
]

function midOf(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2
}

describe('PASSPORT_SPECS', () => {
  it('exposes every required id exactly once', () => {
    const ids = PASSPORT_SPECS.map((spec) => spec.id)
    expect([...ids].sort()).toEqual([...REQUIRED_IDS].sort())
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has sane dimensions, ranges and notes for every spec', () => {
    for (const spec of PASSPORT_SPECS) {
      expect(spec.widthMm).toBeGreaterThan(0)
      expect(spec.heightMm).toBeGreaterThan(0)
      expect(spec.dpi).toBeGreaterThanOrEqual(300)
      expect(spec.headHeightMm.min).toBeGreaterThan(0)
      expect(spec.headHeightMm.max).toBeGreaterThan(spec.headHeightMm.min)
      expect(spec.eyeLineMmFromBottom.min).toBeGreaterThan(0)
      expect(spec.eyeLineMmFromBottom.max).toBeGreaterThan(spec.eyeLineMmFromBottom.min)
      expect(spec.notes.length).toBeGreaterThan(0)
      for (const note of spec.notes) {
        expect(typeof note).toBe('string')
        expect(note.length).toBeGreaterThan(0)
      }
    }
  })

  it('matches the canonical real-world sizes', () => {
    expect(getSpec('us-2x2')?.widthMm).toBeCloseTo(50.8, 6)
    expect(getSpec('us-2x2')?.heightMm).toBeCloseTo(50.8, 6)
    expect(getSpec('oci-51x51')?.widthMm).toBeCloseTo(51, 6)
    expect(getSpec('uk-35x45')).toMatchObject({ widthMm: 35, heightMm: 45 })
    expect(getSpec('schengen-35x45')).toMatchObject({ widthMm: 35, heightMm: 45 })
    expect(getSpec('canada-50x70')).toMatchObject({ widthMm: 50, heightMm: 70 })
    expect(getSpec('china-33x48')).toMatchObject({ widthMm: 33, heightMm: 48 })
    expect(getSpec('japan-35x45')).toMatchObject({ widthMm: 35, heightMm: 45 })
  })

  it('uses the US head height range of 1–1.375 in', () => {
    const us = getSpec('us-2x2')
    expect(us?.headHeightMm.min).toBeCloseTo(25.4, 6)
    expect(us?.headHeightMm.max).toBeCloseTo(34.925, 6)
    expect(us?.eyeLineMmFromBottom.min).toBeCloseTo(28.575, 6)
    expect(us?.eyeLineMmFromBottom.max).toBeCloseTo(34.925, 6)
  })
})

describe('getSpec', () => {
  it('returns undefined for an unknown id', () => {
    expect(getSpec('does-not-exist')).toBeUndefined()
  })
})

describe('specGeometry', () => {
  // The two published ranges are independent, so nothing in the data itself
  // guarantees they can be honoured at once. These assertions are the ones the
  // naive "eye midpoint + head midpoint" framing violated for 9 of 11 specs.
  it('places a head inside the frame for every spec, with real headroom', () => {
    for (const spec of PASSPORT_SPECS) {
      const geometry = specGeometry(spec)

      expect(geometry.degenerate, `${spec.id} has no placeable head`).toBe(false)
      expect(geometry.crownClearanceMm, `${spec.id} crown is clipped`).toBeGreaterThanOrEqual(
        FRAME_MARGIN_MM,
      )
      expect(geometry.chinClearanceMm, `${spec.id} chin is clipped`).toBeGreaterThanOrEqual(
        FRAME_MARGIN_MM,
      )
    }
  })

  it('keeps both solved values inside the spec ranges it came from', () => {
    for (const spec of PASSPORT_SPECS) {
      const geometry = specGeometry(spec)

      expect(geometry.headMm).toBeGreaterThanOrEqual(spec.headHeightMm.min)
      expect(geometry.headMm).toBeLessThanOrEqual(spec.headHeightMm.max)
      expect(geometry.eyeMm).toBeGreaterThanOrEqual(spec.eyeLineMmFromBottom.min)
      expect(geometry.eyeMm).toBeLessThanOrEqual(spec.eyeLineMmFromBottom.max)
    }
  })

  it('reconstructs chin, crown and eye from the same anthropometry', () => {
    for (const spec of PASSPORT_SPECS) {
      const geometry = specGeometry(spec)
      const eyeToChin = EYE_HEIGHT_IN_HEAD * geometry.headMm

      expect(geometry.chinMm).toBeCloseTo(geometry.eyeMm - eyeToChin, 6)
      expect(geometry.crownMm).toBeCloseTo(geometry.chinMm + geometry.headMm, 6)
      expect(geometry.eyeMm).toBeGreaterThan(geometry.chinMm)
      expect(geometry.eyeMm).toBeLessThan(geometry.crownMm)
      expect(geometry.crownMm + geometry.crownClearanceMm).toBeCloseTo(spec.heightMm, 6)
    }
  })

  it('leaves the head height large enough that the crown clears the top edge', () => {
    // The defect this replaces: averaging the ranges put the crown a whole
    // head-height above the eye line, which is 61.9 mm of face in a 50.8 mm
    // photo for us-2x2, so the framer had nowhere legal to put the crown.
    const us = getSpec('us-2x2')
    if (!us) throw new Error('missing us-2x2')
    const geometry = specGeometry(us)
    const naive = midOf(us.eyeLineMmFromBottom) + midOf(us.headHeightMm)

    expect(naive).toBeGreaterThan(us.heightMm)
    expect(geometry.crownMm).toBeLessThanOrEqual(us.heightMm)
    expect(geometry.headMm).toBeGreaterThan(EYE_HEIGHT_IN_HEAD * geometry.headMm)
  })
})

describe('specBackgroundColor', () => {
  // The app used to pick `#f2f2f2` for a light-grey spec and its own
  // background rule scored it 0.8 and failed it. The colour and the rule have
  // to agree, so the agreement is asserted rather than left to a comment.
  it('picks a background its own compliance rule passes', () => {
    for (const spec of PASSPORT_SPECS) {
      const hex = specBackgroundColor(spec)
      if (hex === null) {
        expect(spec.background).toBe('any')
        continue
      }
      const report = checkCompliance({
        ...advisoryInput(spec),
        backgroundColor: rgbOf(hex),
        backgroundUniformity: 1,
        backgroundPresent: true,
      })

      expect(report.rules.find((rule) => rule.id === 'background-colour')?.status, spec.id).toBe(
        'pass',
      )
    }
  })

  it('leaves an any-background spec alone', () => {
    expect(specBackgroundColor(getSpec('generic-35x45') as PassportSpec)).toBeNull()
    expect(specBackgroundColor(getSpec('uk-35x45') as PassportSpec)).toBe('#f2f2f2')
  })
})

function rgbOf(hex: string) {
  const parsed = parseHexColor(hex)
  return parsed ? { r: parsed[0] * 255, g: parsed[1] * 255, b: parsed[2] * 255 } : null
}

function advisoryInput(spec: PassportSpec): ComplianceInput {
  const geometry = specGeometry(spec)
  return {
    spec,
    headHeightMm: geometry.headMm,
    eyeLineMmFromBottom: geometry.eyeMm,
    outputWidthPx: Math.ceil(mmToPx(spec.widthMm, spec.dpi)),
    outputHeightPx: Math.ceil(mmToPx(spec.heightMm, spec.dpi)),
    backgroundUniformity: 1,
    backgroundColor: null,
    backgroundPresent: true,
    centeredOffsetMm: 0,
  }
}
