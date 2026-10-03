import { describe, expect, it } from 'vitest'
import { guideLayout } from './guides'
import { PASSPORT_SPECS, specGeometry } from './specs'

const UK = { crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } }

describe('guideLayout', () => {
  it('puts the advisory eye line and both bounds on the crop, not the frame', () => {
    const spec = PASSPORT_SPECS.find((candidate) => candidate.id === 'uk-35x45')
    if (!spec) throw new Error('missing uk-35x45')
    const geometry = specGeometry(spec)
    const frame = guideLayout(spec)
    const cropped = guideLayout(spec, UK.crop)

    // 0.5 of the frame is 0.5 of the crop: the same physical line, but the
    // fraction the overlay draws is now relative to the crop box.
    for (let i = 0; i < frame.lines.length; i += 1) {
      const expected = (frame.lines[i].fromTop - UK.crop.y) / UK.crop.height
      expect(cropped.lines[i].fromTop).toBeCloseTo(expected, 12)
    }
    expect(cropped.band.fromTop).toBeCloseTo((frame.band.fromTop - UK.crop.y) / UK.crop.height, 12)
    expect(cropped.band.height).toBeCloseTo(frame.band.height / UK.crop.height, 12)
    expect(geometry.headMm).toBeGreaterThan(0)
  })

  it('gives the advisory line a different kind from the two bounds', () => {
    const spec = PASSPORT_SPECS[0]
    const layout = guideLayout(spec)

    expect(layout.lines).toHaveLength(3)
    expect(layout.lines.filter((line) => line.kind === 'advisory')).toHaveLength(1)
    expect(layout.lines.filter((line) => line.kind === 'bound')).toHaveLength(2)
    expect(new Set(layout.lines.map((line) => line.label)).size).toBe(3)
  })

  it('labels the bounds in millimetres from the bottom, in the right order', () => {
    const spec = PASSPORT_SPECS.find((candidate) => candidate.id === 'us-2x2')
    if (!spec) throw new Error('missing us-2x2')
    const layout = guideLayout(spec)
    const byId = new Map(layout.lines.map((line) => [line.id, line]))

    // From the bottom: max sits *above* min on screen.
    expect(byId.get('eye-min')?.fromTop).toBeLessThan(byId.get('eye-max')?.fromTop ?? 0)
    expect(byId.get('eye-min')?.labelMm).toBeCloseTo(spec.eyeLineMmFromBottom.max, 6)
    expect(byId.get('eye-max')?.labelMm).toBeCloseTo(spec.eyeLineMmFromBottom.min, 6)
    expect(byId.get('eye-advisory')?.label).toContain('eye')
    expect(byId.get('eye-min')?.label).toContain('max')
  })

  it('keeps the head band inside the frame for every spec', () => {
    for (const spec of PASSPORT_SPECS) {
      const layout = guideLayout(spec)

      expect(layout.band.fromTop, `${spec.id} band top`).toBeGreaterThanOrEqual(0)
      expect(
        layout.band.fromTop + layout.band.height,
        `${spec.id} band bottom`,
      ).toBeLessThanOrEqual(1 + 1e-9)
      expect(layout.band.height, `${spec.id} band height`).toBeGreaterThan(0)
      for (const line of layout.lines) {
        expect(line.fromTop, `${spec.id} ${line.id}`).toBeGreaterThanOrEqual(0)
        expect(line.fromTop, `${spec.id} ${line.id}`).toBeLessThanOrEqual(1)
      }
      expect(layout.warning, `${spec.id} warning`).toBeNull()
    }
  })

  it('reports a warning when the spec geometry is degenerate', () => {
    const impossible = {
      ...PASSPORT_SPECS[0],
      heightMm: 30,
      headHeightMm: { min: 28, max: 34 },
      eyeLineMmFromBottom: { min: 26, max: 30 },
    }

    const layout = guideLayout(impossible)

    expect(layout.warning).toContain('cannot clear a 30 mm frame')
  })
})
