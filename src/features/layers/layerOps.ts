import type { Doc, Layer } from '../../model/types';

/** Layer list operations. Pure and immutable, so undo/redo stays trivial. */
export function addLayer(doc: Doc, layer: Layer): Doc {
  return { ...doc, layers: [...doc.layers, layer] };
}

export function removeLayerDoc(doc: Doc, id: string): Doc {
  return { ...doc, layers: doc.layers.filter((layer) => layer.id !== id) };
}

export function updateLayer(doc: Doc, id: string, patch: Partial<Layer>): Doc {
  return {
    ...doc,
    layers: doc.layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as Layer) : layer)),
  };
}

export function moveLayerTo(doc: Doc, id: string, index: number): Doc {
  const current = doc.layers.findIndex((layer) => layer.id === id);
  if (current === -1) return doc;
  const clamped = Math.max(0, Math.min(doc.layers.length - 1, index));
  if (clamped === current) return doc;
  const next = [...doc.layers];
  const [layer] = next.splice(current, 1);
  next.splice(clamped, 0, layer);
  return { ...doc, layers: next };
}

export function bringForward(doc: Doc, id: string): Doc {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  return index === -1 ? doc : moveLayerTo(doc, id, index + 1);
}

export function sendBackward(doc: Doc, id: string): Doc {
  const index = doc.layers.findIndex((layer) => layer.id === id);
  return index === -1 ? doc : moveLayerTo(doc, id, index - 1);
}

export function bringToFront(doc: Doc, id: string): Doc {
  return moveLayerTo(doc, id, doc.layers.length - 1);
}

export function sendToBack(doc: Doc, id: string): Doc {
  return moveLayerTo(doc, id, 0);
}

export function selectNextLayer(doc: Doc, id: string | null): string | null {
  if (doc.layers.length === 0) return null;
  if (id === null) return doc.layers[doc.layers.length - 1].id;
  const index = doc.layers.findIndex((layer) => layer.id === id);
  const next = (index + 1) % doc.layers.length;
  return doc.layers[next].id;
}
