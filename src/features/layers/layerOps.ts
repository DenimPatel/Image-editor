import { createId } from '../../model/ids'
import type { BlendMode, Doc, Layer, NormRect } from '../../model/types'

/**
 * The single source of truth for layer-list mutation.
 *
 * Every function here is pure and immutable, so undo/redo is a structural
 * share and the whole surface is unit-testable without React, zustand or the
 * DOM. `src/store/actions.ts` must *delegate* to these functions rather than
 * re-implementing the same list surgery inline (D6-F03): two implementations
 * of one invariant is how `nudgeLayer` ended up with no history key.
 */

/** Layer list operations. Pure and immutable, so undo/redo stays trivial. */
export function addLayer(doc: Doc, layer: Layer): Doc {
  return { ...doc, layers: [...doc.layers, layer] }
}

export function removeLayerDoc(doc: Doc, id: string): Doc {
  return { ...doc, layers: doc.layers.filter((layer) => layer.id !== id) }
}

export function updateLayer(doc: Doc, id: string, patch: Partial<Layer>): Doc {
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.id === id ? ({ ...layer, ...patch } as Layer) : layer,
    ),
  }
}

export function findLayer(doc: Doc, id: string | null): Layer | undefined {
  if (id === null) return undefined
  return doc.layers.find((layer) => layer.id === id)
}

export function moveLayerTo(doc: Doc, id: string, index: number): Doc {
  const current = doc.layers.findIndex((layer) => layer.id === id)
  if (current === -1) return doc
  const clamped = Math.max(0, Math.min(doc.layers.length - 1, index))
  if (clamped === current) return doc
  const next = [...doc.layers]
  const [layer] = next.splice(current, 1)
  next.splice(clamped, 0, layer)
  return { ...doc, layers: next }
}

/** Relative reorder by `delta` slots, clamped at both ends. */
export function moveLayerBy(doc: Doc, id: string, delta: number): Doc {
  const index = doc.layers.findIndex((layer) => layer.id === id)
  return index === -1 ? doc : moveLayerTo(doc, id, index + delta)
}

export function bringForward(doc: Doc, id: string): Doc {
  return moveLayerBy(doc, id, 1)
}

export function sendBackward(doc: Doc, id: string): Doc {
  return moveLayerBy(doc, id, -1)
}

export function bringToFront(doc: Doc, id: string): Doc {
  return moveLayerTo(doc, id, doc.layers.length - 1)
}

export function sendToBack(doc: Doc, id: string): Doc {
  return moveLayerTo(doc, id, 0)
}

/**
 * Reorder for a pointer drag in the layer list: the dragged layer takes the
 * stack slot the target layer currently occupies. Returns the same doc when
 * the drop is a no-op, so the caller can skip the history entry.
 */
export function dropLayerOn(doc: Doc, draggedId: string, targetId: string): Doc {
  const target = doc.layers.findIndex((layer) => layer.id === targetId)
  if (target === -1 || draggedId === targetId) return doc
  return moveLayerTo(doc, draggedId, target)
}

export function selectNextLayer(doc: Doc, id: string | null): string | null {
  if (doc.layers.length === 0) return null
  if (id === null) return doc.layers[doc.layers.length - 1].id
  const index = doc.layers.findIndex((layer) => layer.id === id)
  const next = (index + 1) % doc.layers.length
  return doc.layers[next].id
}

/** Deep clone for a JSON-shaped value. `Doc` is paper-only, so this is total. */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneJson(entry)
    }
    return clone as T
  }
  return value
}

/**
 * Copy a layer: a deep clone with a fresh id and a `" copy"` name, dropped
 * directly above the original so the pair is obvious in the list. Every other
 * field — including `transform` — is preserved exactly, so the copy is a
 * starting point rather than a reset.
 */
export function duplicateLayer(doc: Doc, id: string): { doc: Doc; id: string | null } {
  const index = doc.layers.findIndex((layer) => layer.id === id)
  if (index === -1) return { doc, id: null }
  const source = doc.layers[index]
  const copy = cloneJson(source)
  copy.id = createId(source.kind)
  copy.name = `${source.name} copy`
  const layers = [...doc.layers]
  layers.splice(index + 1, 0, copy)
  return { doc: { ...doc, layers }, id: copy.id }
}

const MAX_NAME_LENGTH = 48

/** Rename a layer. A blank name falls back to the kind so the list stays legible. */
export function renameLayer(doc: Doc, id: string, name: string): Doc {
  const layer = findLayer(doc, id)
  if (!layer) return doc
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
  const next = trimmed.length > 0 ? trimmed : layer.kind
  if (next === layer.name) return doc
  return updateLayer(doc, id, { name: next } as Partial<Layer>)
}

export function setLayerBlend(doc: Doc, id: string, blend: BlendMode): Doc {
  const layer = findLayer(doc, id)
  if (!layer || layer.transform.blend === blend) return doc
  return updateLayer(doc, id, { transform: { ...layer.transform, blend } } as Partial<Layer>)
}

export function setLayerTransform(doc: Doc, id: string, patch: Partial<Layer['transform']>): Doc {
  const layer = findLayer(doc, id)
  if (!layer) return doc
  return updateLayer(doc, id, { transform: { ...layer.transform, ...patch } } as Partial<Layer>)
}

/** Smallest redaction/shape box, so a region can never be collapsed to nothing. */
export const MIN_NORM_SIZE = 0.02

/**
 * Clamp a normalized rect so `0 <= x`, `0 <= y`, `x + width <= 1` and
 * `y + height <= 1`, with a floor on the extents. Sliders that write `x` and
 * `width` independently can otherwise park a region off-canvas with no way
 * back, and an off-canvas region redacts nothing (D6-F06).
 */
export function normRect(rect: NormRect, minSize = MIN_NORM_SIZE): NormRect {
  const width = Math.max(minSize, Math.min(1, rect.width))
  const height = Math.max(minSize, Math.min(1, rect.height))
  const x = Math.max(0, Math.min(1 - width, rect.x))
  const y = Math.max(0, Math.min(1 - height, rect.y))
  return { x, y, width, height }
}

/** Apply a partial edit to a redaction region, clamped back onto the canvas. */
export function patchNormRect(
  rect: NormRect,
  patch: Partial<NormRect>,
  minSize?: number,
): NormRect {
  return normRect({ ...rect, ...patch }, minSize)
}
