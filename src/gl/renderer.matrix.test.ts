import { describe, expect, it } from 'vitest'
import { createDoc } from '../model/defaults'
import type { Doc, Point, Size } from '../model/types'
import { decodeMat3, withFakeGl2, type Mat3Call } from './fakegl'
import { applyMat3, computeOutputToSource, type Mat3 } from './geometry'
import { GlRenderer } from './renderer'

const SOURCE: Size = { width: 200, height: 100 }

/**
 * `u_matrix * vec3(outPos, 1.0)` as `GEOMETRY_FRAG` writes it. GLSL indexes a
 * mat3 as `m[column][row]`, so element `[col][row]` of the matrix is the
 * row-major slot `row * 3 + col`.
 */
function shaderTransform(m: Mat3, p: Point): Point {
  const at = (col: number, row: number) => m[row * 3 + col]!
  const w = at(0, 2) * p.x + at(1, 2) * p.y + at(2, 2) || 1
  return {
    x: (at(0, 0) * p.x + at(1, 0) * p.y + at(2, 0)) / w,
    y: (at(0, 1) * p.x + at(1, 1) * p.y + at(2, 1)) / w,
  }
}

function renderMatrix(doc: Doc, size: Size): Mat3Call {
  return withFakeGl2(({ gl, source }) => {
    const renderer = new GlRenderer()
    renderer.render({ doc, size, source, sourceSize: SOURCE })
    renderer.dispose()
    const calls = gl.callsFor('u_matrix')
    expect(calls).toHaveLength(1)
    return calls[0] as Mat3Call
  })
}

function edited(mutate: (doc: Doc) => void = () => {}): Doc {
  const doc = createDoc({ source: { assetId: 'a', ...SOURCE, name: 'a', mime: 'image/jpeg' } })
  mutate(doc)
  return doc
}

const CASES: { name: string; doc: Doc; size: Size }[] = [
  {
    name: 'crop',
    doc: edited((doc) => {
      doc.geometry.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    }),
    size: { width: 100, height: 50 },
  },
  {
    name: 'quarter turn',
    doc: edited((doc) => {
      doc.geometry.orientation.quarterTurns = 1
    }),
    size: { width: 100, height: 200 },
  },
  {
    name: 'horizontal flip',
    doc: edited((doc) => {
      doc.geometry.orientation.flipH = true
    }),
    size: { width: 100, height: 50 },
  },
  {
    name: 'straighten',
    doc: edited((doc) => {
      doc.geometry.straighten = 7.5
    }),
    size: { width: 120, height: 60 },
  },
  {
    name: 'perspective',
    doc: edited((doc) => {
      doc.geometry.perspective.topLeft = { x: -0.04, y: 0.03 }
      doc.geometry.perspective.bottomRight = { x: 0.05, y: -0.02 }
    }),
    size: { width: 100, height: 50 },
  },
  {
    name: 'crop + straighten + perspective',
    doc: edited((doc) => {
      doc.geometry.crop = { x: 0.1, y: 0.15, width: 0.7, height: 0.6 }
      doc.geometry.straighten = -3
      doc.geometry.perspective.bottomLeft = { x: 0.02, y: 0.01 }
    }),
    size: { width: 140, height: 90 },
  },
]

describe('mat3 upload', () => {
  for (const { name, doc, size } of CASES) {
    it(`uploads the row-major matrix the CPU convention expects: ${name}`, () => {
      const expected = computeOutputToSource(doc, SOURCE, size)
      const call = renderMatrix(doc, size)
      // The whole point: read the array the way WebGL does and it must be the
      // matrix we meant, not its transpose.
      expect(decodeMat3(call)).toEqual(expected)
    })

    it(`resolves every probe point identically to applyMat3: ${name}`, () => {
      const expected = computeOutputToSource(doc, SOURCE, size)
      const gpu = decodeMat3(renderMatrix(doc, size))
      for (const point of [
        { x: 0, y: 0 },
        { x: size.width, y: size.height },
        { x: size.width / 2, y: size.height / 2 },
        { x: size.width / 3, y: (2 * size.height) / 5 },
      ]) {
        const cpu = applyMat3(expected, point)
        const fromGpu = shaderTransform(gpu, point)
        expect(fromGpu.x).toBeCloseTo(cpu.x, 6)
        expect(fromGpu.y).toBeCloseTo(cpu.y, 6)
      }
    })
  }

  it('sends transpose = true so the driver keeps the row-major layout', () => {
    const doc = edited((d) => {
      d.geometry.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    })
    expect(renderMatrix(doc, { width: 100, height: 50 }).transpose).toBe(true)
  })

  it('samples the crop corner, not the image origin, for the top-left of a centre-quarter crop', () => {
    const size = { width: 100, height: 50 }
    const centreQuarter = edited((d) => {
      d.geometry.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
    })
    // The uncropped matrix maps the output rect onto the whole source frame,
    // in whatever units the pipeline uses (source pixels or normalized), so
    // dividing one by the other gives a position inside the source.
    const frame = decodeMat3(renderMatrix(edited(), size))
    const cropped = decodeMat3(renderMatrix(centreQuarter, size))
    const origin = shaderTransform(frame, { x: 0, y: 0 })
    const far = shaderTransform(frame, { x: size.width, y: size.height })
    const corner = shaderTransform(cropped, { x: 0, y: 0 })
    expect((corner.x - origin.x) / (far.x - origin.x)).toBeCloseTo(0.25, 9)
    expect((corner.y - origin.y) / (far.y - origin.y)).toBeCloseTo(0.25, 9)
  })
})
