import { describe, expect, it } from 'vitest';
import { createDoc } from '../model/defaults';
import { applyMat3, computeOutputToSource, computeSourceToOutput, invertMat3, multiplyMat3 } from './geometry';

const source = { width: 200, height: 100 };

describe('affine helpers', () => {
  it('composes and inverts', () => {
    const original: [number, number, number, number, number, number, number, number, number] = [
      2, 0, 3, 0, 2, 4, 0, 0, 1,
    ];
    const identity = multiplyMat3(invertMat3(original), original);
    expect(identity[0]).toBeCloseTo(1, 9);
    expect(identity[1]).toBeCloseTo(0, 9);
    expect(identity[2]).toBeCloseTo(0, 9);
    expect(identity[3]).toBeCloseTo(0, 9);
    expect(identity[4]).toBeCloseTo(1, 9);
    expect(identity[5]).toBeCloseTo(0, 9);
  });

  it('applies a point with homogeneous divide', () => {
    const point = applyMat3([1, 0, 10, 0, 1, 20, 0, 0, 1], { x: 5, y: 5 });
    expect(point).toEqual({ x: 15, y: 25 });
  });
});

describe('computeOutputToSource', () => {
  it('is the identity for an unedited same-size image', () => {
    const doc = createDoc({ source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' } });
    const m = computeOutputToSource(doc, source, source);
    expect(applyMat3(m, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const bottomRight = applyMat3(m, { x: 200, y: 100 });
    expect(bottomRight.x).toBeCloseTo(200, 6);
    expect(bottomRight.y).toBeCloseTo(100, 6);
  });

  it('maps an output pixel into the crop box', () => {
    const doc = createDoc({ source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' } });
    doc.geometry.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    const output = { width: 100, height: 50 };
    const m = computeOutputToSource(doc, source, output);
    const topLeft = applyMat3(m, { x: 0, y: 0 });
    expect(topLeft.x).toBeCloseTo(50, 4);
    expect(topLeft.y).toBeCloseTo(25, 4);
    const bottomRight = applyMat3(m, { x: 100, y: 50 });
    expect(bottomRight.x).toBeCloseTo(150, 4);
    expect(bottomRight.y).toBeCloseTo(75, 4);
  });

  it('rotates a quarter turn clockwise', () => {
    const doc = createDoc({ source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' } });
    doc.geometry.orientation.quarterTurns = 1;
    const output = { width: 100, height: 200 };
    const m = computeOutputToSource(doc, source, output);
    const topLeft = applyMat3(m, { x: 0, y: 0 });
    expect(topLeft.x).toBeCloseTo(0, 4);
    expect(topLeft.y).toBeCloseTo(100, 4);
  });

  it('composes with its own inverse', () => {
    const doc = createDoc({ source: { assetId: 'a', width: 200, height: 100, name: 'a', mime: 'image/jpeg' } });
    doc.geometry.crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
    doc.geometry.straighten = 12;
    const output = { width: 120, height: 60 };
    const forward = computeSourceToOutput(doc, source, output);
    const back = computeOutputToSource(doc, source, output);
    const original = { x: 33, y: 44 };
    const roundTrip = applyMat3(back, applyMat3(forward, original));
    expect(roundTrip.x).toBeCloseTo(original.x, 3);
    expect(roundTrip.y).toBeCloseTo(original.y, 3);
  });
});