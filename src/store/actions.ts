import { createId } from '../model/ids'
import type {
  Adjust,
  AdjustKey,
  BlendMode,
  CurveChannel,
  CurvePoint,
  Doc,
  HslBand,
  LayerTransform,
  Mask,
  NormRect,
  Orientation,
  Perspective,
  Point,
} from '../model/types'
import {
  addLayer,
  bringToFront,
  dropLayerOn,
  duplicateLayer,
  moveLayerBy,
  removeLayerDoc,
  renameLayer,
  sendToBack,
  setLayerBlend,
  updateLayer,
} from '../features/layers/layerOps'
import { remapPerspective, transformCropUnderOrientation } from '../lib/crop/geometry'
import { useDocStore } from './docStore'
import type { EditOptions } from './history'

function orientationFor(doc: Doc): Orientation {
  return doc.geometry.orientation
}

function withOrientation(doc: Doc, orientation: Orientation): Doc {
  // The crop is documented to live in the *straightened* frame, so the dihedral
  // swap is conjugated by the straighten rotation and carries the source size
  // with it (D5-F06). Without this a quarter turn shears the selection away
  // from the content it was drawn around.
  const remap = { straighten: doc.geometry.straighten, source: doc.source ?? undefined }
  const crop = transformCropUnderOrientation(
    doc.geometry.crop,
    doc.geometry.orientation,
    orientation,
    remap,
  )
  const perspective = remapPerspective(
    doc.geometry.perspective,
    doc.geometry.orientation,
    orientation,
    remap,
  )
  const turned = (((orientation.quarterTurns - doc.geometry.orientation.quarterTurns) % 4) + 4) % 4
  const aspectLock =
    turned % 2 === 1 && doc.geometry.aspectLock
      ? 1 / doc.geometry.aspectLock
      : doc.geometry.aspectLock
  return {
    ...doc,
    geometry: {
      ...doc.geometry,
      orientation,
      crop,
      aspectLock,
      perspective,
    },
  }
}

export function rotateBy(degrees: number): void {
  useDocStore.getState().update(
    (doc) => {
      const current = orientationFor(doc)
      const turns = Math.round(degrees / 90)
      const orientation: Orientation = {
        ...current,
        quarterTurns: (((current.quarterTurns + turns) % 4) + 4) % 4,
      }
      return withOrientation(doc, orientation)
    },
    { key: 'rotate' },
  )
}

export function toggleFlipH(): void {
  useDocStore
    .getState()
    .update(
      (doc) =>
        withOrientation(doc, { ...orientationFor(doc), flipH: !doc.geometry.orientation.flipH }),
      { key: 'flip' },
    )
}

export function toggleFlipV(): void {
  useDocStore
    .getState()
    .update(
      (doc) =>
        withOrientation(doc, { ...orientationFor(doc), flipV: !doc.geometry.orientation.flipV }),
      { key: 'flip' },
    )
}

export function setStraighten(value: number): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      geometry: { ...doc.geometry, straighten: Math.max(-45, Math.min(45, value)) },
    }),
    { key: 'straighten' },
  )
}

export function setCrop(crop: NormRect): void {
  useDocStore
    .getState()
    .update((doc) => ({ ...doc, geometry: { ...doc.geometry, crop } }), { key: 'crop' })
}

export function setAspectLock(aspect: number | null): void {
  useDocStore
    .getState()
    .update((doc) => ({ ...doc, geometry: { ...doc.geometry, aspectLock: aspect } }), {
      key: 'aspect',
    })
}

export function setAdjust(key: AdjustKey, value: number): void {
  useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, [key]: value } }), {
    key: `adjust:${key}`,
  })
}

export function resetAdjust(key: AdjustKey): void {
  setAdjust(key, 0)
}

/**
 * Export settings — quality, dpi, resize, format, metadata — are session
 * state, not image edits, so they are `transient` by default: they apply and
 * autosave but never occupy one of the 50 undo slots. Callers that fold an
 * output change into a real edit (the print-size crop chip) pass
 * `{ transient: false }` and bracket it in an interaction instead.
 */
export function setOutput(patch: Partial<Doc['output']>, options: EditOptions = {}): void {
  useDocStore.getState().update((doc) => ({ ...doc, output: { ...doc.output, ...patch } }), {
    transient: true,
    ...options,
  })
}

export function setLook(id: string | null, amount = 1): void {
  useDocStore.getState().update((doc) => ({ ...doc, look: { id, amount } }))
}

export function setCurveChannel(channel: CurveChannel, points: CurvePoint[]): void {
  useDocStore
    .getState()
    .update((doc) => ({ ...doc, curves: { ...doc.curves, [channel]: points } }), {
      key: `curves:${channel}`,
    })
}

export function setHslBand(
  band: HslBand,
  patch: Partial<{ hue: number; sat: number; lum: number }>,
): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      hsl: { ...doc.hsl, [band]: { ...doc.hsl[band], ...patch } },
    }),
    { key: `hsl:${band}` },
  )
}

export function setBackground(patch: Partial<Doc['background']>): void {
  useDocStore.getState().update((doc) => ({ ...doc, background: { ...doc.background, ...patch } }))
}

export function setSource(
  assetId: string,
  width: number,
  height: number,
  name: string,
  mime: string,
): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    source: { assetId, width, height, name, mime },
  }))
}

/** Add a text layer at the centre of the cropped output. */
export function addTextLayer(text = 'Text'): string {
  const id = createId('layer')
  useDocStore.getState().update((doc) => ({
    ...doc,
    layers: [
      ...doc.layers,
      {
        id,
        kind: 'text' as const,
        name: text.slice(0, 16),
        visible: true,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'normal' as const },
        text,
        style: {
          fontId: 'inter',
          size: 8,
          color: '#ffffff',
          align: 'center' as const,
          lineHeight: 1.2,
          tracking: 0,
          bold: false,
          italic: false,
          strokeColor: '#000000',
          strokeWidth: 0,
          shadow: false,
          pillBackground: null,
          arc: 0,
        },
      },
    ],
  }))
  return id
}

/**
 * Layer-list surgery is delegated to `features/layers/layerOps.ts`, which is
 * the single, fully-tested implementation of the list invariants (D6-F03).
 * Every action here passes a history key, so a reorder coalesces instead of
 * burning an undo slot per click, and a rename is one step rather than a
 * transient blob.
 */
export function removeLayer(id: string): void {
  useDocStore.getState().update((doc) => removeLayerDoc(doc, id), { key: 'layer:remove' })
}

export function addLayerToDoc(layer: Doc['layers'][number]): void {
  useDocStore.getState().update((doc) => addLayer(doc, layer), { key: 'layer:add' })
}

export function updateLayerById(id: string, patch: Partial<Doc['layers'][number]>): void {
  useDocStore.getState().update((doc) => updateLayer(doc, id, patch), { key: `layer:${id}` })
}

export function updateLayerPatch(id: string, patch: Record<string, unknown>): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      layers: doc.layers.map((layer) =>
        layer.id === id ? ({ ...layer, ...patch } as Doc['layers'][number]) : layer,
      ),
    }),
    { key: `layer:${id}` },
  )
}

export function nudgeLayer(id: string, delta: number): void {
  useDocStore.getState().update((doc) => moveLayerBy(doc, id, delta), { key: 'layer:reorder' })
}

/**
 * Write a layer's whole transform (D6-F14).
 *
 * Deliberately **no history key**. `updateLayerPatch` carries `layer:${id}`, which
 * coalesces the inspector's sliders on a timer, and that is right for a control
 * that is only ever nudged — but a transform grip is a *gesture*, and its undo
 * granularity has to come from the gesture rather than from a 600 ms window. A
 * handle drag brackets itself in one `beginInteraction`, so the whole drag is one
 * entry however many `pointermove`s it took; a keyboard nudge opens and closes its
 * own span, so each press is one entry. With a key set, a user who nudges a grip
 * twice inside `COALESCE_MS` would lose the first one, and a drag that outlived
 * the window would split into several.
 */
export function setLayerTransformInDoc(id: string, transform: LayerTransform): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    layers: doc.layers.map((layer) => (layer.id === id ? { ...layer, transform } : layer)),
  }))
}

/** Duplicate a layer one slot above the original. Returns the copy's new id. */
export function duplicateLayerToDoc(id: string): string | null {
  const index = useDocStore.getState().present.layers.findIndex((layer) => layer.id === id)
  if (index === -1) return null
  useDocStore.getState().update((doc) => duplicateLayer(doc, id).doc, { key: 'layer:duplicate' })
  const copy = useDocStore.getState().present.layers[index + 1]
  return copy && copy.id !== id ? copy.id : null
}

export function renameLayerInDoc(id: string, name: string): void {
  useDocStore.getState().update((doc) => renameLayer(doc, id, name), { key: 'layer:rename' })
}

export function bringLayerToFront(id: string): void {
  useDocStore.getState().update((doc) => bringToFront(doc, id), { key: 'layer:front' })
}

export function sendLayerToBack(id: string): void {
  useDocStore.getState().update((doc) => sendToBack(doc, id), { key: 'layer:back' })
}

/** Reorder for a pointer drag: the dragged layer takes the target's slot. */
export function dropLayerOnRow(draggedId: string, targetId: string): void {
  useDocStore
    .getState()
    .update((doc) => dropLayerOn(doc, draggedId, targetId), { key: 'layer:reorder' })
}

export function setLayerBlendInDoc(id: string, blend: BlendMode): void {
  useDocStore.getState().update((doc) => setLayerBlend(doc, id, blend), { key: 'layer:blend' })
}

export function clearDrawStrokes(id: string): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.id === id && layer.kind === 'draw' ? { ...layer, strokes: [] } : layer,
    ),
  }))
}

// --- masks and local adjustments (D1-F14) -------------------------------------

/**
 * A mask as a caller describes it: the kind is required, everything else has
 * the default the renderer and `maskValueAt` assume. A distributive `Omit` so
 * `addMask({ kind: 'radial', center })` narrows to the radial shape instead of
 * the shared keys only.
 */
export type MaskDraft = {
  [K in Mask['kind']]: Partial<Omit<Extract<Mask, { kind: K }>, 'id' | 'kind'>> & {
    kind: K
  }
}[Mask['kind']]

function maskFromDraft(draft: MaskDraft): Mask {
  const id = createId('mask')
  const shared = { id, enabled: draft.enabled ?? true, feather: draft.feather ?? 0 }
  switch (draft.kind) {
    case 'subject':
      return { ...shared, kind: 'subject' }
    case 'brush':
      return { ...shared, kind: 'brush', strokes: draft.strokes ?? [] }
    case 'linear':
      return {
        ...shared,
        kind: 'linear',
        from: draft.from ?? { x: 0, y: 0.5 },
        to: draft.to ?? { x: 1, y: 0.5 },
      }
    case 'radial':
      return {
        ...shared,
        kind: 'radial',
        center: draft.center ?? { x: 0.5, y: 0.5 },
        radiusX: draft.radiusX ?? 0.3,
        radiusY: draft.radiusY ?? 0.3,
        rotation: draft.rotation ?? 0,
        invert: draft.invert ?? false,
      }
    case 'luminance':
      return {
        ...shared,
        kind: 'luminance',
        low: draft.low ?? 0.2,
        high: draft.high ?? 0.8,
        invert: draft.invert ?? false,
      }
  }
}

/** Add a mask. Returns its id, so a local adjust can be bound to it at once. */
export function addMask(draft: MaskDraft): string {
  const mask = maskFromDraft(draft)
  useDocStore.getState().update((doc) => ({ ...doc, masks: [...doc.masks, mask] }), {
    key: 'mask:add',
  })
  return mask.id
}

export function removeMask(id: string): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      masks: doc.masks.filter((mask) => mask.id !== id),
      // A local adjust bound to a mask that no longer exists would be dropped
      // silently by the planner, so it goes with it.
      localAdjusts: doc.localAdjusts.filter((local) => local.maskId !== id),
    }),
    { key: 'mask:remove' },
  )
}

export function setMaskEnabled(id: string, enabled: boolean): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      masks: doc.masks.map((mask) => (mask.id === id ? { ...mask, enabled } : mask)),
    }),
    { key: `mask:${id}` },
  )
}

export function setMaskPatch(id: string, patch: Partial<Omit<Mask, 'id' | 'kind'>>): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      masks: doc.masks.map((mask) => (mask.id === id ? ({ ...mask, ...patch } as Mask) : mask)),
    }),
    { key: `mask:${id}` },
  )
}

/** Bind a local adjust to a mask. Returns the new adjust's id. */
export function addLocalAdjust(maskId: string, values: Partial<Adjust> = {}): string {
  const id = createId('local')
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      localAdjusts: [...doc.localAdjusts, { id, maskId, enabled: true, values }],
    }),
    { key: 'local:add' },
  )
  return id
}

export function removeLocalAdjust(id: string): void {
  useDocStore
    .getState()
    .update(
      (doc) => ({ ...doc, localAdjusts: doc.localAdjusts.filter((local) => local.id !== id) }),
      { key: 'local:remove' },
    )
}

export function setLocalAdjustEnabled(id: string, enabled: boolean): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      localAdjusts: doc.localAdjusts.map((local) =>
        local.id === id ? { ...local, enabled } : local,
      ),
    }),
    { key: `local:${id}` },
  )
}

export function setLocalAdjustValues(id: string, values: Partial<Adjust>): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      localAdjusts: doc.localAdjusts.map((local) =>
        local.id === id ? { ...local, values } : local,
      ),
    }),
    { key: `local:${id}` },
  )
}

export function clearLocalAdjusts(): void {
  useDocStore.getState().update((doc) => ({ ...doc, localAdjusts: [] }), { key: 'local:clear' })
}

// --- retouch (D1-F13) ---------------------------------------------------------

/**
 * Only the dial coalesces here.
 *
 * Every other action in this block used to carry a `key`, which is the right
 * default for a continuous control: forty `pointermove`s on a slider are one
 * undo. A spot is not continuous. Two placements a second apart merged into one
 * undo step, so pressing undo after placing two spots took back both — and the
 * user, who has just watched the panel say "Spot 1" and "Spot 2", has no way to
 * predict that. The same argument covers removing one and then another, and it
 * covers `clearRedEye` arriving inside `COALESCE_MS` of a single removal, where
 * one undo would have restored the removed eye and forgotten the other five.
 *
 * So: no key, one step each, and `setRetouchSmooth` keeps the one key that is
 * genuinely continuous — with the panel's slider also bracketing the span.
 */
export function setRetouchSmooth(amount: number): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      retouch: { ...doc.retouch, smooth: Math.max(0, Math.min(100, amount)) },
    }),
    { key: 'retouch:smooth' },
  )
}

export function addHealSpot(at: Point, radius: number): string {
  const id = createId('heal')
  useDocStore.getState().update((doc) => ({
    ...doc,
    retouch: {
      ...doc.retouch,
      healSpots: [...doc.retouch.healSpots, { id, at, radius: Math.max(0, radius) }],
    },
  }))
  return id
}

export function removeHealSpot(id: string): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    retouch: {
      ...doc.retouch,
      healSpots: doc.retouch.healSpots.filter((spot) => spot.id !== id),
    },
  }))
}

export function addRedEye(at: Point, radius: number): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    retouch: {
      ...doc.retouch,
      redEye: [...doc.retouch.redEye, { at, radius: Math.max(0, radius) }],
    },
  }))
}

export function removeRedEye(index: number): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    retouch: {
      ...doc.retouch,
      redEye: doc.retouch.redEye.filter((_, at) => at !== index),
    },
  }))
}

export function clearRedEye(): void {
  useDocStore.getState().update((doc) => ({ ...doc, retouch: { ...doc.retouch, redEye: [] } }))
}

export function clearRetouch(): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    retouch: { smooth: 0, healSpots: [], redEye: [] },
  }))
}

// --- perspective warp (D5-F08) -----------------------------------------------

/**
 * How far a corner may be pulled from the frame's own corner, as a fraction of
 * the frame. Past 0.5 the quad's corner crosses the opposite side, which folds
 * the transform and makes the whole image vanish; the clamp is what keeps a
 * drag from being able to do that.
 */
export const MAX_PERSPECTIVE_OFFSET = 0.5

function clampPerspectivePoint(at: Point): Point {
  const clamp = (value: number) =>
    Number.isFinite(value)
      ? Math.max(-MAX_PERSPECTIVE_OFFSET, Math.min(MAX_PERSPECTIVE_OFFSET, value))
      : 0
  return { x: clamp(at.x), y: clamp(at.y) }
}

export function clampPerspective(perspective: Perspective): Perspective {
  return {
    topLeft: clampPerspectivePoint(perspective.topLeft),
    topRight: clampPerspectivePoint(perspective.topRight),
    bottomRight: clampPerspectivePoint(perspective.bottomRight),
    bottomLeft: clampPerspectivePoint(perspective.bottomLeft),
  }
}

export function setPerspective(perspective: Perspective): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      geometry: { ...doc.geometry, perspective: clampPerspective(perspective) },
    }),
    { key: 'perspective' },
  )
}

/** Drag one corner; every other corner is left alone. */
export function nudgePerspectiveCorner(corner: keyof Perspective, at: Point): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      geometry: {
        ...doc.geometry,
        perspective: { ...doc.geometry.perspective, [corner]: clampPerspectivePoint(at) },
      },
    }),
    { key: 'perspective' },
  )
}

export function resetPerspective(): void {
  useDocStore.getState().update(
    (doc) => ({
      ...doc,
      geometry: {
        ...doc.geometry,
        perspective: {
          topLeft: { x: 0, y: 0 },
          topRight: { x: 0, y: 0 },
          bottomRight: { x: 0, y: 0 },
          bottomLeft: { x: 0, y: 0 },
        },
      },
    }),
    { key: 'perspective' },
  )
}
