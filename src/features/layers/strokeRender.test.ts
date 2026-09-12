import { describe, expect, it } from 'vitest';
import { createDoc } from '../../model/defaults';
import type { DrawLayer } from '../../model/types';
import { drawLayers } from '../../render/layers';

function fakeContext() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const context = {
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fill: record('fill'),
    fillRect: record('fillRect'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    measureText: () => ({ width: 100 }),
    drawImage: record('drawImage'),
    rect: record('rect'),
    ellipse: record('ellipse'),
    clip: record('clip'),
    arcTo: record('arcTo'),
    closePath: record('closePath'),
    setTransform: record('setTransform'),
    clearRect: record('clearRect'),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData: record('putImageData'),
    canvas: { width: 100, height: 100 },
  };
  return { context: context as unknown as CanvasRenderingContext2D, calls };
}

function drawLayer(): DrawLayer {
  return {
    id: 'd1',
    kind: 'draw',
    name: 'd',
    visible: true,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
    brush: 'pen',
    color: '#ff0000',
    size: 2,
    strokes: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], radius: 2, hardness: 1 }],
  };
}

describe('drawLayers', () => {
  it('does nothing without layers', () => {
    const { context, calls } = fakeContext();
    drawLayers(context, createDoc(), { size: { width: 200, height: 100 }, assets: { get: () => undefined } });
    expect(calls).toHaveLength(0);
  });

  it('renders a stroke with normalized coordinates scaled to the output', () => {
    const { context, calls } = fakeContext();
    const doc = createDoc();
    doc.layers.push(drawLayer());
    drawLayers(context, doc, { size: { width: 200, height: 100 }, assets: { get: () => undefined } });
    const move = calls.find((call) => call.method === 'moveTo');
    const line = calls.find((call) => call.method === 'lineTo');
    expect(move?.args).toEqual([0, 0]);
    expect(line?.args).toEqual([200, 100]);
    expect(calls.some((call) => call.method === 'stroke')).toBe(true);
  });

  it('skips hidden layers', () => {
    const { context, calls } = fakeContext();
    const doc = createDoc();
    const layer = drawLayer();
    layer.visible = false;
    doc.layers.push(layer);
    drawLayers(context, doc, { size: { width: 200, height: 100 }, assets: { get: () => undefined } });
    expect(calls).toHaveLength(0);
  });
});
