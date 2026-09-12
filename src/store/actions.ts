import { createId } from '../model/ids';
import type { AdjustKey, CurveChannel, CurvePoint, Doc, HslBand, NormRect, Orientation } from '../model/types';
import { transformCropUnderOrientation } from '../lib/crop/geometry';
import { useDocStore } from './docStore';

function orientationFor(doc: Doc): Orientation {
  return doc.geometry.orientation;
}

function withOrientation(doc: Doc, orientation: Orientation): Doc {
  const crop = transformCropUnderOrientation(doc.geometry.crop, doc.geometry.orientation, orientation);
  const turned = ((orientation.quarterTurns - doc.geometry.orientation.quarterTurns) % 4 + 4) % 4;
  const aspectLock = turned % 2 === 1 && doc.geometry.aspectLock ? 1 / doc.geometry.aspectLock : doc.geometry.aspectLock;
  return {
    ...doc,
    geometry: {
      ...doc.geometry,
      orientation,
      crop,
      aspectLock,
    },
  };
}

export function rotateBy(degrees: number): void {
  useDocStore.getState().update(
    (doc) => {
      const current = orientationFor(doc);
      const turns = Math.round(degrees / 90);
      const orientation: Orientation = { ...current, quarterTurns: ((current.quarterTurns + turns) % 4 + 4) % 4 };
      return withOrientation(doc, orientation);
    },
    { key: 'rotate' },
  );
}

export function toggleFlipH(): void {
  useDocStore.getState().update(
    (doc) => withOrientation(doc, { ...orientationFor(doc), flipH: !doc.geometry.orientation.flipH }),
    { key: 'flip' },
  );
}

export function toggleFlipV(): void {
  useDocStore.getState().update(
    (doc) => withOrientation(doc, { ...orientationFor(doc), flipV: !doc.geometry.orientation.flipV }),
    { key: 'flip' },
  );
}

export function setStraighten(value: number): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    geometry: { ...doc.geometry, straighten: Math.max(-45, Math.min(45, value)) },
  }));
}

export function setCrop(crop: NormRect): void {
  useDocStore.getState().update((doc) => ({ ...doc, geometry: { ...doc.geometry, crop } }));
}

export function setAspectLock(aspect: number | null): void {
  useDocStore.getState().update((doc) => ({ ...doc, geometry: { ...doc.geometry, aspectLock: aspect } }));
}

export function setAdjust(key: AdjustKey, value: number): void {
  useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, [key]: value } }));
}

export function resetAdjust(key: AdjustKey): void {
  useDocStore.getState().update((doc) => ({ ...doc, adjust: { ...doc.adjust, [key]: 0 } }));
}

export function setOutput(patch: Partial<Doc['output']>): void {
  useDocStore.getState().update((doc) => ({ ...doc, output: { ...doc.output, ...patch } }));
}

export function setLook(id: string | null, amount = 1): void {
  useDocStore.getState().update((doc) => ({ ...doc, look: { id, amount } }));
}

export function setCurveChannel(channel: CurveChannel, points: CurvePoint[]): void {
  useDocStore.getState().update((doc) => ({ ...doc, curves: { ...doc.curves, [channel]: points } }));
}

export function setHslBand(band: HslBand, patch: Partial<{ hue: number; sat: number; lum: number }>): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    hsl: { ...doc.hsl, [band]: { ...doc.hsl[band], ...patch } },
  }));
}

export function setBackground(patch: Partial<Doc['background']>): void {
  useDocStore.getState().update((doc) => ({ ...doc, background: { ...doc.background, ...patch } }));
}

export function setSource(assetId: string, width: number, height: number, name: string, mime: string): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    source: { assetId, width, height, name, mime },
  }));
}

/** Add a text layer at the centre of the cropped output. */
export function addTextLayer(text = 'Text'): string {
  const id = createId('layer');
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
  }));
  return id;
}

export function removeLayer(id: string): void {
  useDocStore.getState().update((doc) => ({ ...doc, layers: doc.layers.filter((layer) => layer.id !== id) }));
}

export function addLayerToDoc(layer: Doc['layers'][number]): void {
  useDocStore.getState().update((doc) => ({ ...doc, layers: [...doc.layers, layer] }), { key: 'layer:add' });
}

export function updateLayerById(id: string, patch: Partial<Doc['layers'][number]>): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    layers: doc.layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as Doc['layers'][number]) : layer)),
  }));
}

export function updateLayerPatch(id: string, patch: Record<string, unknown>): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    layers: doc.layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as Doc['layers'][number]) : layer)),
  }));
}

export function nudgeLayer(id: string, delta: number): void {
  useDocStore.getState().update((doc) => {
    const index = doc.layers.findIndex((layer) => layer.id === id);
    if (index === -1) return doc;
    const target = Math.max(0, Math.min(doc.layers.length - 1, index + delta));
    if (target === index) return doc;
    const layers = [...doc.layers];
    const [layer] = layers.splice(index, 1);
    layers.splice(target, 0, layer);
    return { ...doc, layers };
  });
}

export function clearDrawStrokes(id: string): void {
  useDocStore.getState().update((doc) => ({
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.id === id && layer.kind === 'draw' ? { ...layer, strokes: [] } : layer,
    ),
  }));
}