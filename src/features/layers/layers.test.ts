import { describe, expect, it } from 'vitest';
import { createDoc } from '../../model/defaults';
import { createTextLayer } from './factory';
import { addLayer, bringForward, bringToFront, moveLayerTo, removeLayerDoc, sendBackward, sendToBack, updateLayer } from './layerOps';

describe('layer z-order operations', () => {
  function withLayers() {
    let doc = createDoc();
    const a = createTextLayer('A');
    const b = createTextLayer('B');
    const c = createTextLayer('C');
    doc = addLayer(doc, a);
    doc = addLayer(doc, b);
    doc = addLayer(doc, c);
    return { doc, a, b, c };
  }

  it('adds layers in order', () => {
    const { doc } = withLayers();
    expect(doc.layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C']);
  });

  it('brings a layer forward and sends it backward', () => {
    const { doc, a } = withLayers();
    expect(bringForward(doc, a.id).layers.map((layer) => layer.name)).toEqual(['B', 'A', 'C']);
    expect(sendBackward(bringForward(doc, a.id), a.id).layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C']);
  });

  it('brings to front and sends to back', () => {
    const { doc, a, c } = withLayers();
    expect(bringToFront(doc, a.id).layers.map((layer) => layer.name)).toEqual(['B', 'C', 'A']);
    expect(sendToBack(doc, c.id).layers.map((layer) => layer.name)).toEqual(['C', 'A', 'B']);
  });

  it('clamps moves at the ends', () => {
    const { doc, a } = withLayers();
    expect(sendToBack(doc, a.id).layers[0].name).toBe('A');
    expect(sendBackward(doc, a.id).layers.map((layer) => layer.name)).toEqual(['A', 'B', 'C']);
  });

  it('moves to an explicit index', () => {
    const { doc, a } = withLayers();
    expect(moveLayerTo(doc, a.id, 2).layers.map((layer) => layer.name)).toEqual(['B', 'C', 'A']);
  });

  it('removes a layer immutably', () => {
    const { doc, b } = withLayers();
    const next = removeLayerDoc(doc, b.id);
    expect(next.layers.map((layer) => layer.name)).toEqual(['A', 'C']);
    expect(doc.layers).toHaveLength(3);
  });
});

describe('normalized layer transforms survive a re-crop', () => {
  it('keeps the transform unchanged when the crop changes', () => {
    let doc = createDoc();
    const layer = createTextLayer('Keep me');
    doc = addLayer(doc, layer);
    doc = updateLayer(doc, layer.id, { transform: { ...layer.transform, x: 0.25, y: 0.75, scale: 2 } });
    const before = doc.layers[0].transform;

    doc = { ...doc, geometry: { ...doc.geometry, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 } } };
    expect(doc.layers[0].transform).toEqual(before);
    expect(doc.layers[0].transform.x).toBe(0.25);
  });
});
