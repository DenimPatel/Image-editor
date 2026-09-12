import { describe, expect, it } from 'vitest';
import { createDoc } from './defaults';
import { activeAssetIds, croppedSize, effectiveOutputSize, hasAlphaOutput, hasEdits } from './selectors';

describe('activeAssetIds', () => {
  it('collects source, background image and layer assets', () => {
    const doc = createDoc({
      source: { assetId: 'src', width: 100, height: 100, name: 'a', mime: 'image/jpeg' },
    });
    doc.background.imageAssetId = 'bg';
    doc.layers.push({
      id: 'l1',
      kind: 'sticker',
      name: 's',
      visible: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      svg: null,
      assetId: 'sticker',
    });
    doc.layers.push({
      id: 'l2',
      kind: 'watermark',
      name: 'w',
      visible: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blend: 'normal' },
      text: 'x',
      fontId: 'inter',
      color: '#fff',
      assetId: 'logo',
      anchor: 'center',
      tiled: false,
    });
    expect([...activeAssetIds(doc)].sort()).toEqual(['bg', 'logo', 'src', 'sticker']);
  });

  it('is empty for a doc with no source', () => {
    expect(activeAssetIds(createDoc()).size).toBe(0);
  });
});

describe('size selectors', () => {
  it('reports cropped and effective output sizes', () => {
    const doc = createDoc({
      source: { assetId: 'a', width: 1600, height: 900, name: 'a', mime: 'image/jpeg' },
    });
    expect(croppedSize(doc)).toEqual({ width: 1600, height: 900 });
    expect(effectiveOutputSize(doc)).toEqual({ width: 1600, height: 900 });
  });
});

describe('hasAlphaOutput', () => {
  it('is true for png with no background', () => {
    const doc = createDoc();
    doc.output.format = 'png';
    expect(hasAlphaOutput(doc)).toBe(true);
  });

  it('is false for jpeg or when a background is set', () => {
    const doc = createDoc();
    doc.output.format = 'jpeg';
    expect(hasAlphaOutput(doc)).toBe(false);
    doc.output.format = 'png';
    doc.background.mode = 'color';
    expect(hasAlphaOutput(doc)).toBe(false);
  });
});

describe('hasEdits', () => {
  it('is false for a pristine doc', () => {
    expect(hasEdits(createDoc())).toBe(false);
  });

  it('detects adjustments, geometry, layers and looks', () => {
    const adjusted = createDoc();
    adjusted.adjust.contrast = 10;
    expect(hasEdits(adjusted)).toBe(true);

    const cropped = createDoc();
    cropped.geometry.crop = { x: 0.1, y: 0, width: 0.5, height: 1 };
    expect(hasEdits(cropped)).toBe(true);

    const flipped = createDoc();
    flipped.geometry.orientation.flipH = true;
    expect(hasEdits(flipped)).toBe(true);

    const looked = createDoc();
    looked.look.id = 'kodak';
    expect(hasEdits(looked)).toBe(true);
  });
});
