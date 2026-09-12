import { describe, expect, it } from 'vitest';
import { createDoc } from './defaults';
import { migrateDoc } from './migrate';

describe('migrateDoc', () => {
  it('returns null for non-documents', () => {
    expect(migrateDoc(null)).toBeNull();
    expect(migrateDoc(42)).toBeNull();
    expect(migrateDoc('nope')).toBeNull();
    expect(migrateDoc([])).toBeNull();
    expect(migrateDoc({ hello: 'world' })).toBeNull();
  });

  it('round-trips a current-schema doc', () => {
    const doc = createDoc();
    doc.adjust.exposure = 0.5;
    doc.geometry.crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 };
    const migrated = migrateDoc(doc);
    expect(migrated).not.toBeNull();
    expect(migrated?.schema).toBe(3);
    expect(migrated?.adjust.exposure).toBe(0.5);
    expect(migrated?.geometry.crop).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
  });

  it('normalizes out-of-range current-schema values instead of throwing', () => {
    const migrated = migrateDoc({
      ...createDoc(),
      adjust: { ...createDoc().adjust, exposure: 999 },
      geometry: { ...createDoc().geometry, straighten: 200, crop: { x: -1, y: 2, width: 5, height: 0 } },
    });
    expect(migrated?.geometry.straighten).toBe(45);
    expect(migrated?.geometry.crop.width).toBe(1);
    expect(migrated?.geometry.crop.x).toBe(0);
  });

  it('migrates the legacy flat EditorState (100-neutral adjustments)', () => {
    const migrated = migrateDoc({
      flipH: true,
      flipV: false,
      rotation: 90,
      brightness: 150,
      contrast: 50,
      saturation: 100,
      format: 'png',
      quality: 0.8,
      outWidth: 640,
      matte: '#000000',
      crop: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(migrated).not.toBeNull();
    expect(migrated?.adjust.brightness).toBe(50);
    expect(migrated?.adjust.contrast).toBe(-50);
    expect(migrated?.adjust.saturation).toBe(0);
    expect(migrated?.geometry.orientation.quarterTurns).toBe(1);
    expect(migrated?.geometry.orientation.flipH).toBe(true);
    expect(migrated?.output.format).toBe('png');
    expect(migrated?.output.resize).toEqual({ mode: 'width', width: 640 });
  });

  it('migrates a schema-2 doc into schema 3', () => {
    const current = createDoc();
    const migrated = migrateDoc({ ...current, schema: 2, adjust: { ...current.adjust, warmth: 20 } });
    expect(migrated?.schema).toBe(3);
    expect(migrated?.adjust.warmth).toBe(20);
  });

  it('drops malformed source but keeps the rest', () => {
    const migrated = migrateDoc({ ...createDoc(), source: { nope: true } });
    expect(migrated?.source).toBeNull();
  });

  it('filters non-object layers and masks', () => {
    const migrated = migrateDoc({ ...createDoc(), layers: [null, 1, { id: 'l1', kind: 'text' }], masks: ['x'] });
    expect(migrated?.layers).toHaveLength(1);
    expect(migrated?.masks).toHaveLength(0);
  });
});
