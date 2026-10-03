import { beforeEach, describe, expect, it } from 'vitest'
import { computeOutputToSource } from '../gl/geometry'
import { planPasses } from '../gl/passes'
import { createDoc } from '../model/defaults'
import type { Mask, Point, Size } from '../model/types'
import {
  MAX_PERSPECTIVE_OFFSET,
  addHealSpot,
  addLocalAdjust,
  addMask,
  addRedEye,
  clearLocalAdjusts,
  clearRedEye,
  clearRetouch,
  clampPerspective,
  nudgePerspectiveCorner,
  removeHealSpot,
  removeLocalAdjust,
  removeMask,
  resetPerspective,
  setLocalAdjustEnabled,
  setLocalAdjustValues,
  setMaskEnabled,
  setMaskPatch,
  setPerspective,
  setRetouchSmooth,
} from './actions'
import { useDocStore } from './docStore'

const SIZE: Size = { width: 800, height: 600 }

function doc() {
  return useDocStore.getState().present
}

beforeEach(() => {
  useDocStore.getState().load(createDoc())
})

const SOURCE = { width: 1600, height: 1200 }

function plan() {
  return planPasses(doc(), SIZE, computeOutputToSource(doc(), SOURCE, SIZE))
}

function kinds() {
  return plan().map((pass) => pass.kind)
}

// --- D1-F14: masks and local adjustments --------------------------------------

describe('masks and local adjustments (D1-F14)', () => {
  it('adds each kind of mask with a generated id and the renderer defaults', () => {
    const subject = addMask({ kind: 'subject' })
    const brush = addMask({ kind: 'brush' })
    const linear = addMask({ kind: 'linear', from: { x: 0.1, y: 0.2 }, to: { x: 0.9, y: 0.8 } })
    const radial = addMask({
      kind: 'radial',
      center: { x: 0.4, y: 0.4 },
      radiusX: 0.2,
      radiusY: 0.3,
    })
    const luminance = addMask({ kind: 'luminance', low: 0.1, high: 0.9, invert: true })
    const ids = [subject, brush, linear, radial, luminance]
    expect(new Set(ids).size).toBe(5)
    expect(doc().masks.map((mask) => mask.kind)).toEqual([
      'subject',
      'brush',
      'linear',
      'radial',
      'luminance',
    ])
    const radialMask = doc().masks[3] as Extract<Mask, { kind: 'radial' }>
    expect(radialMask.radiusX).toBe(0.2)
    expect(radialMask.invert).toBe(false)
    expect(radialMask.enabled).toBe(true)
    expect(radialMask.feather).toBe(0)
    const brushMask = doc().masks[1] as Extract<Mask, { kind: 'brush' }>
    expect(brushMask.strokes).toEqual([])
  })

  it('produces a local pass once a mask and an adjust are bound together', () => {
    const maskId = addMask({ kind: 'radial', radiusX: 0.3, radiusY: 0.3 })
    expect(kinds()).not.toContain('local')
    const localId = addLocalAdjust(maskId, { exposure: 0.5, saturation: -20 })
    const local = plan().find((pass) => pass.kind === 'local')
    expect(local).toBeTruthy()
    expect(local && 'maskId' in local && local.maskId).toBe(maskId)
    expect(doc().localAdjusts).toHaveLength(1)
    expect(doc().localAdjusts[0]!.id).toBe(localId)
    expect(local && 'values' in local && local.values).toEqual({ exposure: 0.5, saturation: -0.2 })
  })

  it('drops a local adjust whose values are all zero', () => {
    const maskId = addMask({ kind: 'radial' })
    addLocalAdjust(maskId, { exposure: 0 })
    expect(kinds()).not.toContain('local')
  })

  it('drops a local adjust whose mask is missing or disabled', () => {
    const maskId = addMask({ kind: 'radial' })
    addLocalAdjust(maskId, { exposure: 0.4 })
    setMaskEnabled(maskId, false)
    expect(kinds()).not.toContain('local')
    setMaskEnabled(maskId, true)
    expect(kinds()).toContain('local')
    setLocalAdjustEnabled(doc().localAdjusts[0]!.id, false)
    expect(kinds()).not.toContain('local')
  })

  it('edits a mask without touching the rest of the doc, and moves the plan hash', () => {
    const maskId = addMask({ kind: 'radial', feather: 0 })
    addLocalAdjust(maskId, { exposure: 0.4 })
    const before = JSON.stringify(plan())
    setMaskPatch(maskId, { feather: 0.8 } as Partial<Omit<Mask, 'id' | 'kind'>>)
    expect(doc().masks[0]!.feather).toBe(0.8)
    expect(doc().adjust.exposure).toBe(0)
    expect(JSON.stringify(plan())).not.toBe(before)
  })

  it('removes a mask together with the local adjusts bound to it', () => {
    const keep = addMask({ kind: 'radial' })
    const drop = addMask({ kind: 'subject' })
    addLocalAdjust(keep, { exposure: 0.2 })
    addLocalAdjust(drop, { contrast: 20 })
    removeMask(drop)
    expect(doc().masks.map((mask) => mask.id)).toEqual([keep])
    expect(doc().localAdjusts.map((local) => local.maskId)).toEqual([keep])
  })

  it('removes a single local adjust and can clear them all', () => {
    const maskId = addMask({ kind: 'radial' })
    const a = addLocalAdjust(maskId, { exposure: 0.2 })
    addLocalAdjust(maskId, { contrast: 20 })
    removeLocalAdjust(a)
    expect(doc().localAdjusts).toHaveLength(1)
    clearLocalAdjusts()
    expect(doc().localAdjusts).toHaveLength(0)
    expect(kinds()).not.toContain('local')
  })

  it('merges values into an existing local adjust', () => {
    const maskId = addMask({ kind: 'radial' })
    const id = addLocalAdjust(maskId, { exposure: 0.5 })
    setLocalAdjustValues(id, { contrast: 30, warmth: -10 })
    const local = plan().find((pass) => pass.kind === 'local')
    expect(local && 'values' in local && local.values).toEqual({ contrast: 0.3, warmth: -0.1 })
  })

  it('gives every mask and local action its own undo step', () => {
    const maskId = addMask({ kind: 'radial' })
    const localId = addLocalAdjust(maskId, { exposure: 0.5 })
    setLocalAdjustValues(localId, { exposure: 0.7 })
    setMaskPatch(maskId, { feather: 0.5 } as Partial<Omit<Mask, 'id' | 'kind'>>)
    setMaskEnabled(maskId, false)
    clearLocalAdjusts()
    removeMask(maskId)
    // addMask, addLocalAdjust, setLocalAdjustValues, the mask drag
    // (setMaskPatch and setMaskEnabled share the mask's key, so they are one
    // step), clearLocalAdjusts, removeMask.
    expect(stateLength()).toBe(6)
    useDocStore.getState().undo()
    expect(doc().localAdjusts).toHaveLength(0)
    expect(doc().masks).toHaveLength(1)
  })

  it('coalesces a drag of one mask or one local adjust into a single step', () => {
    const maskId = addMask({ kind: 'radial' })
    const localId = addLocalAdjust(maskId, { exposure: 0.1 })
    const store = useDocStore.getState()
    store.beginInteraction(`mask:${maskId}`)
    for (let i = 0; i < 40; i += 1) {
      setMaskPatch(maskId, { feather: i / 100 } as Partial<Omit<Mask, 'id' | 'kind'>>)
    }
    store.endInteraction()
    store.beginInteraction(`local:${localId}`)
    for (let i = 0; i < 40; i += 1) setLocalAdjustValues(localId, { exposure: i / 100 })
    store.endInteraction()
    // addMask, addLocalAdjust, one mask drag, one local drag.
    expect(stateLength()).toBe(4)
    expect(doc().localAdjusts[0]!.values.exposure).toBeCloseTo(0.39, 12)
  })

  it('is immutable: the previous doc object is untouched', () => {
    const before = doc()
    const snapshot = JSON.stringify(before)
    const maskId = addMask({ kind: 'luminance' })
    addLocalAdjust(maskId, { warmth: 40 })
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(doc()).not.toBe(before)
  })
})

function stateLength() {
  return useDocStore.getState().past.length
}

// --- D1-F13: retouch ---------------------------------------------------------

describe('retouch (D1-F13)', () => {
  it('plans a retouch pass as soon as smoothing is non-zero', () => {
    setRetouchSmooth(40)
    expect(doc().retouch.smooth).toBe(40)
    const pass = plan().find((p) => p.kind === 'retouch')
    expect(pass).toBeTruthy()
    expect(pass && 'smooth' in pass && pass.smooth).toBeCloseTo(0.4, 12)
  })

  it('clamps smoothing to 0..100', () => {
    setRetouchSmooth(-10)
    expect(doc().retouch.smooth).toBe(0)
    setRetouchSmooth(400)
    expect(doc().retouch.smooth).toBe(100)
  })

  it('plans one heal pass per spot and one redeye pass per eye', () => {
    const first = addHealSpot({ x: 0.3, y: 0.4 }, 0.05)
    addHealSpot({ x: 0.6, y: 0.2 }, 0.04)
    addRedEye({ x: 0.2, y: 0.5 }, 0.03)
    addRedEye({ x: 0.8, y: 0.5 }, 0.03)
    const list = plan()
    expect(list.filter((pass) => pass.kind === 'heal')).toHaveLength(2)
    expect(list.filter((pass) => pass.kind === 'redeye')).toHaveLength(2)
    const heal = list.find((pass) => pass.kind === 'heal')
    expect(heal && 'at' in heal && heal.at).toEqual({ x: 0.3, y: 0.4 })
    expect(doc().retouch.healSpots[0]!.id).toBe(first)
    // Retouch runs before the detail stack.
    const order = list.map((pass) => pass.kind)
    expect(order.indexOf('heal')).toBeGreaterThan(-1)
    expect(order.indexOf('heal')).toBeLessThan(order.indexOf('output'))
  })

  it('removes a single heal spot and can clear red-eye and everything', () => {
    const first = addHealSpot({ x: 0.3, y: 0.4 }, 0.05)
    addHealSpot({ x: 0.6, y: 0.2 }, 0.04)
    addRedEye({ x: 0.2, y: 0.5 }, 0.03)
    addRedEye({ x: 0.8, y: 0.5 }, 0.03)
    removeHealSpot(first)
    expect(doc().retouch.healSpots).toHaveLength(1)
    expect(doc().retouch.redEye).toHaveLength(2)
    clearRedEye()
    expect(doc().retouch.redEye).toHaveLength(0)
    expect(doc().retouch.healSpots).toHaveLength(1)
    clearRetouch()
    expect(doc().retouch).toEqual({ smooth: 0, healSpots: [], redEye: [] })
    const planned = plan().map((pass) => pass.kind)
    expect(planned).not.toContain('retouch')
    expect(planned).not.toContain('heal')
    expect(planned).not.toContain('redeye')
  })

  it('clamps a negative spot radius rather than inverting the stamp', () => {
    addHealSpot({ x: 0.5, y: 0.5 }, -1)
    expect(doc().retouch.healSpots[0]!.radius).toBe(0)
    addRedEye({ x: 0.5, y: 0.5 }, -2)
    expect(doc().retouch.redEye[0]!.radius).toBe(0)
  })

  it('is immutable: the previous doc object is untouched', () => {
    const before = doc()
    const snapshot = JSON.stringify(before)
    setRetouchSmooth(30)
    addHealSpot({ x: 0.5, y: 0.5 }, 0.1)
    addRedEye({ x: 0.5, y: 0.5 }, 0.1)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

// --- D5-F08: perspective ------------------------------------------------------

describe('perspective warp (D5-F08)', () => {
  const SQUARE: Point = { x: 0.1, y: 0.05 }

  it('writes every corner', () => {
    setPerspective({
      topLeft: SQUARE,
      topRight: { x: -0.05, y: 0.02 },
      bottomRight: { x: 0, y: -0.02 },
      bottomLeft: { x: 0.04, y: 0.01 },
    })
    expect(doc().geometry.perspective).toEqual({
      topLeft: SQUARE,
      topRight: { x: -0.05, y: 0.02 },
      bottomRight: { x: 0, y: -0.02 },
      bottomLeft: { x: 0.04, y: 0.01 },
    })
    expect(kinds()).toContain('geometry')
  })

  it('nudges one corner and leaves the others alone', () => {
    setPerspective({
      topLeft: { x: 0.01, y: 0.01 },
      topRight: { x: 0.02, y: 0.02 },
      bottomRight: { x: 0.03, y: 0.03 },
      bottomLeft: { x: 0.04, y: 0.04 },
    })
    nudgePerspectiveCorner('topLeft', { x: 0.1, y: 0.1 })
    expect(doc().geometry.perspective.topLeft).toEqual({ x: 0.1, y: 0.1 })
    expect(doc().geometry.perspective.bottomLeft).toEqual({ x: 0.04, y: 0.04 })
  })

  it('clamps a corner inside the fold limit, so a drag cannot invert the quad', () => {
    nudgePerspectiveCorner('topLeft', { x: 4, y: -4 })
    expect(doc().geometry.perspective.topLeft).toEqual({
      x: MAX_PERSPECTIVE_OFFSET,
      y: -MAX_PERSPECTIVE_OFFSET,
    })
    nudgePerspectiveCorner('bottomRight', { x: Number.NaN, y: Number.POSITIVE_INFINITY })
    expect(doc().geometry.perspective.bottomRight).toEqual({ x: 0, y: 0 })
  })

  it('clampPerspective is a pure function over all four corners', () => {
    expect(
      clampPerspective({
        topLeft: { x: -9, y: 9 },
        topRight: { x: 0.1, y: 0 },
        bottomRight: { x: Number.NaN, y: 0 },
        bottomLeft: { x: 0, y: 0.25 },
      }),
    ).toEqual({
      topLeft: { x: -MAX_PERSPECTIVE_OFFSET, y: MAX_PERSPECTIVE_OFFSET },
      topRight: { x: 0.1, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0.25 },
    })
  })

  it('resets every corner to identity and drops the geometry pass', () => {
    setPerspective({
      topLeft: SQUARE,
      topRight: SQUARE,
      bottomRight: SQUARE,
      bottomLeft: SQUARE,
    })
    resetPerspective()
    expect(doc().geometry.perspective).toEqual({
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    })
    // No *edit* geometry pass: the leading identity one is a renderer detail.
    expect(plan().filter((pass) => pass.kind === 'geometry')).toHaveLength(0)
  })

  it('gives each perspective action its own undo step, and coalesces a drag', () => {
    setPerspective({
      topLeft: SQUARE,
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    })
    expect(stateLength()).toBe(1)
    const store = useDocStore.getState()
    store.beginInteraction('perspective')
    for (let i = 0; i < 30; i += 1) nudgePerspectiveCorner('topLeft', { x: i / 200, y: 0 })
    store.endInteraction()
    expect(stateLength()).toBe(2)
    expect(doc().geometry.perspective.topLeft.x).toBeCloseTo(29 / 200, 12)
    store.undo()
    expect(doc().geometry.perspective.topLeft).toEqual(SQUARE)
    store.undo()
    expect(doc().geometry.perspective.topLeft).toEqual({ x: 0, y: 0 })
  })
})
