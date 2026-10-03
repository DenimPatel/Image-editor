import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDoc } from './defaults'
import { areCurvesIdentity, planPasses } from '../gl/passes'
import { ADJUST_KEYS, ADJUST_SPEC_BY_KEY, ADJUST_SPECS, DOC_SCHEMA } from './defaults'
import { DOC_SCHEMA as SCHEMA_FROM_TYPES } from './types'
import type { Doc } from './types'

function source(): Doc['source'] {
  return { assetId: 'a', width: 1200, height: 800, name: 'a', mime: 'image/jpeg' }
}

describe('D1-F06: the schema number has one home', () => {
  it('DOC_SCHEMA is a single value re-exported by defaults and declared in types', () => {
    expect(SCHEMA_FROM_TYPES).toBe(DOC_SCHEMA)
    expect(DOC_SCHEMA).toBe(3)
  })

  it('createDoc stamps the same number, and every fresh document agrees', () => {
    expect(createDoc().schema).toBe(DOC_SCHEMA)
    expect(createDoc().schema).toBe(createDoc().schema)
  })

  it('no production module in src/ writes a second copy of the number', () => {
    // The failure this guards is silent: `migrateDoc` returns null for a
    // payload it does not recognise, so one hardcoded `schema: 3` in an
    // otherwise-current document turns every saved recipe into "Nothing to
    // paste" the day DOC_SCHEMA moves. The types cannot catch it — a literal in
    // a `Doc` literal is only checked against `DocSchema` where a type is
    // written down — so the sources are. Test files are exempt: a legacy
    // fixture is *supposed* to say `schema: 2`.
    const root = process.cwd()
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(path)
          continue
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
        if (path === resolve(root, 'src/model/types.ts')) continue
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (/^\s*(\/\/|\*)/.test(line)) continue
          if (/schema\s*[:=]\s*\d/.test(line)) {
            offenders.push(`${relative(root, path)}: ${line.trim()}`)
          }
        }
      }
    }
    walk(resolve(root, 'src'))
    expect(offenders).toEqual([])
  })
})

describe('D1-F02: createDoc deep-clones every nested section', () => {
  it('two documents are deeply equal', () => {
    expect(createDoc()).toEqual(createDoc())
  })

  it('shares no nested object by reference', () => {
    const a = createDoc()
    const b = createDoc()

    // The reported defect: `output` was the one section with no clone helper,
    // so `{ ...DEFAULT_OUTPUT }` handed every document the same `resize`.
    expect(a.output).not.toBe(b.output)
    expect(a.output.resize).not.toBe(b.output.resize)
    expect(a.output.multiWidths).not.toBe(b.output.multiWidths)

    expect(a.geometry).not.toBe(b.geometry)
    expect(a.geometry.crop).not.toBe(b.geometry.crop)
    expect(a.geometry.orientation).not.toBe(b.geometry.orientation)
    expect(a.geometry.perspective).not.toBe(b.geometry.perspective)
    expect(a.geometry.perspective.topLeft).not.toBe(b.geometry.perspective.topLeft)

    expect(a.adjust).not.toBe(b.adjust)
    expect(a.curves).not.toBe(b.curves)
    for (const channel of ['rgb', 'r', 'g', 'b'] as const) {
      expect(a.curves[channel]).not.toBe(b.curves[channel])
      expect(a.curves[channel][0]).not.toBe(b.curves[channel][0])
    }
    expect(a.hsl).not.toBe(b.hsl)
    expect(a.hsl.red).not.toBe(b.hsl.red)
    expect(a.look).not.toBe(b.look)
    expect(a.effects).not.toBe(b.effects)
    expect(a.background).not.toBe(b.background)
    expect(a.background.gradient).not.toBe(b.background.gradient)
    expect(a.retouch).not.toBe(b.retouch)
    expect(a.retouch.healSpots).not.toBe(b.retouch.healSpots)
    expect(a.retouch.redEye).not.toBe(b.retouch.redEye)
    expect(a.identity).not.toBe(b.identity)
  })

  it('no array is shared with the exported defaults', () => {
    const a = createDoc()
    const b = createDoc()
    a.output.multiWidths.push(4096)
    a.curves.rgb.push({ x: 10, y: 10 })
    a.hsl.red.hue = 12
    a.background.gradient.angle = 7
    a.geometry.crop.width = 0.5
    a.masks.push({ id: 'm', kind: 'subject', enabled: true, feather: 1 })

    expect(b.output.multiWidths).toEqual([720, 1080, 1920])
    expect(b.curves.rgb).toHaveLength(2)
    expect(b.hsl.red.hue).toBe(0)
    expect(b.background.gradient.angle).toBe(135)
    expect(b.geometry.crop.width).toBe(1)
    expect(b.masks).toHaveLength(0)
  })

  it('mutating one document output leaves every other document at the default', () => {
    const a = createDoc()
    const b = createDoc()
    a.output.resize = { mode: 'width', width: 800 }
    a.output.multiWidths = [640]
    expect(b.output.resize).toEqual({ mode: 'none' })
    expect(b.output.multiWidths).toEqual([720, 1080, 1920])
    expect(createDoc().output.resize.mode).toBe('none')
  })

  it('a document with a source still clones the rest', () => {
    const a = createDoc({ source: source() })
    const b = createDoc({ source: source() })
    expect(a.source).not.toBe(b.source)
    expect(a.output.resize).not.toBe(b.output.resize)
  })
})

describe('D1-F03: ADJUST_SPECS', () => {
  it('covers every Adjust key exactly once, with min < max', () => {
    expect(ADJUST_SPECS.map((spec) => spec.key)).toEqual(ADJUST_KEYS)
    for (const spec of ADJUST_SPECS) {
      expect(spec.min).toBeLessThan(spec.max)
      expect(spec.step).toBeGreaterThan(0)
      expect(spec.neutral).toBeGreaterThanOrEqual(spec.min)
      expect(spec.neutral).toBeLessThanOrEqual(spec.max)
    }
  })

  it('plans no adjust pass for a document left at every neutral value', () => {
    for (const key of ADJUST_KEYS) {
      const doc = createDoc({ source: source() })
      doc.adjust[key] = ADJUST_SPEC_BY_KEY[key].neutral
      const kinds = planPasses(doc, { width: 100, height: 100 }).map((pass) => pass.kind)
      expect(kinds, key).not.toContain('adjust')
    }
  })

  it('a non-neutral value is outside the neutral plan', () => {
    const doc = createDoc({ source: source() })
    doc.adjust.exposure = 0.5
    const kinds = planPasses(doc, { width: 100, height: 100 }).map((pass) => pass.kind)
    expect(kinds).toContain('tone')
  })
})

describe('D1-F01: Doc is JSON-serializable only', () => {
  it('survives a JSON round-trip unchanged', () => {
    const doc = createDoc({ source: source() })
    doc.curves.rgb = [
      { x: 0, y: 0 },
      { x: 128, y: 140 },
      { x: 255, y: 255 },
    ]
    doc.adjust.exposure = 0.4
    doc.layers.push({
      id: 'l1',
      kind: 'frame',
      name: 'Frame',
      visible: true,
      locked: false,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      style: 'rounded',
      color: '#111111',
      width: 6,
      inside: true,
    })
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })

  it('holds no live resource anywhere in the tree', () => {
    const doc = createDoc({ source: source() })
    const seen = new Set<unknown>()
    // `globalThis` rather than the bare identifiers: jsdom has no ImageBitmap
    // and a bare reference to it throws a ReferenceError.
    const live: unknown[] = [
      globalThis.ImageBitmap,
      globalThis.Blob,
      globalThis.ArrayBuffer,
    ].filter((ctor) => typeof ctor === 'function')
    const walk = (value: unknown) => {
      if (value === null || typeof value !== 'object') return
      expect(seen.has(value), 'a Doc node is shared by reference').toBe(false)
      seen.add(value)
      for (const ctor of live) expect(value).not.toBeInstanceOf(ctor)
      if (Array.isArray(value)) value.forEach(walk)
      else Object.values(value).forEach(walk)
    }
    walk(doc)
  })
})

describe('D1-F15: document identity defaults', () => {
  it('is deterministic, unstamped and attributed to this build', () => {
    const a = createDoc()
    const b = createDoc()
    expect(a.identity).toEqual(b.identity)
    expect(a.identity.createdAt).toBeNull()
    expect(a.identity.updatedAt).toBeNull()
    expect(a.identity.writer).toBe('1.0.0')
  })
})

describe('defaults helpers', () => {
  it('identity curves are identity for the pass planner', () => {
    expect(areCurvesIdentity(createDoc().curves)).toBe(true)
  })
})
