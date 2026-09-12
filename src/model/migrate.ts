import { createDoc, DOC_SCHEMA } from './defaults';
import type {
  Adjust,
  Background,
  Curves,
  Doc,
  Effects,
  Geometry,
  HslMix,
  Layer,
  LocalAdjust,
  Look,
  Mask,
  OutputSpec,
  PassportDoc,
  Retouch,
  SourceRef,
} from './types';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function mergeAdjust(raw: unknown): Adjust {
  const base = createDoc().adjust;
  if (!isRecord(raw)) return base;
  for (const key of Object.keys(base) as (keyof Adjust)[]) {
    base[key] = num(raw[key], base[key]);
  }
  return base;
}

function mergeGeometry(raw: unknown): Geometry {
  const base = createDoc().geometry;
  if (!isRecord(raw)) return base;
  if (isRecord(raw.orientation)) {
    base.orientation.quarterTurns = ((Math.round(num(raw.orientation.quarterTurns, 0)) % 4) + 4) % 4;
    base.orientation.flipH = bool(raw.orientation.flipH, false);
    base.orientation.flipV = bool(raw.orientation.flipV, false);
  }
  base.straighten = Math.min(45, Math.max(-45, num(raw.straighten, 0)));
  base.aspectLock = typeof raw.aspectLock === 'number' && raw.aspectLock > 0 ? raw.aspectLock : null;
  if (isRecord(raw.perspective)) {
    for (const corner of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      const point = raw.perspective[corner];
      if (isRecord(point)) {
        base.perspective[corner] = { x: num(point.x, 0), y: num(point.y, 0) };
      }
    }
  }
  if (isRecord(raw.crop)) {
    const width = Math.min(1, Math.max(0.001, num(raw.crop.width, 1)));
    const height = Math.min(1, Math.max(0.001, num(raw.crop.height, 1)));
    base.crop = {
      x: Math.min(1 - width, Math.max(0, num(raw.crop.x, 0))),
      y: Math.min(1 - height, Math.max(0, num(raw.crop.y, 0))),
      width,
      height,
    };
  }
  return base;
}

function mergeCurves(raw: unknown): Curves {
  const base = createDoc().curves;
  if (!isRecord(raw)) return base;
  for (const channel of ['rgb', 'r', 'g', 'b'] as const) {
    const points = raw[channel];
    if (Array.isArray(points) && points.length >= 2) {
      base[channel] = points
        .filter(isRecord)
        .map((p) => ({ x: num(p.x, 0), y: num(p.y, 0) }))
        .sort((a, b) => a.x - b.x);
    }
  }
  return base;
}

function mergeHsl(raw: unknown): HslMix {
  const base = createDoc().hsl;
  if (!isRecord(raw)) return base;
  for (const band of Object.keys(base) as (keyof HslMix)[]) {
    const value = raw[band];
    if (isRecord(value)) {
      base[band] = {
        hue: num(value.hue, 0),
        sat: num(value.sat, 0),
        lum: num(value.lum, 0),
      };
    }
  }
  return base;
}

function mergeOutput(raw: unknown): OutputSpec {
  const base = createDoc().output;
  if (!isRecord(raw)) return base;
  const formats = new Set(['jpeg', 'png', 'webp', 'avif', 'pdf']);
  if (typeof raw.format === 'string' && formats.has(raw.format)) {
    base.format = raw.format as OutputSpec['format'];
  }
  base.quality = Math.min(1, Math.max(0.01, num(raw.quality, base.quality)));
  base.dpi = Math.max(1, Math.round(num(raw.dpi, base.dpi)));
  base.matte = str(raw.matte, base.matte);
  if (raw.metadata === 'strip' || raw.metadata === 'orientation' || raw.metadata === 'all') {
    base.metadata = raw.metadata;
  }
  base.targetBytes = typeof raw.targetBytes === 'number' && raw.targetBytes > 0 ? raw.targetBytes : null;
  if (raw.sheet === 'none' || raw.sheet === '4x6' || raw.sheet === '5x7' || raw.sheet === 'a4') {
    base.sheet = raw.sheet;
  }
  if (isRecord(raw.resize) && typeof raw.resize.mode === 'string') {
    base.resize = raw.resize as OutputSpec['resize'];
  }
  return base;
}

function mergeLayer(raw: unknown): Layer | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || typeof raw.id !== 'string') return null;
  return raw as unknown as Layer;
}

function mergeLegacy(raw: UnknownRecord): Doc {
  const doc = createDoc();
  // The old flat EditorState used 100 as neutral for brightness/contrast/
  // saturation; the new Adjust model is 0-neutral.
  doc.adjust.brightness = num(raw.brightness, 100) - 100;
  doc.adjust.contrast = num(raw.contrast, 100) - 100;
  doc.adjust.saturation = num(raw.saturation, 100) - 100;
  doc.geometry.orientation.flipH = bool(raw.flipH, false);
  doc.geometry.orientation.flipV = bool(raw.flipV, false);
  const rotation = ((Math.round(num(raw.rotation, 0)) % 360) + 360) % 360;
  doc.geometry.orientation.quarterTurns = Math.round(rotation / 90) % 4;
  doc.geometry.straighten = Math.min(45, Math.max(-45, rotation % 90));
  if (raw.format === 'jpeg' || raw.format === 'png' || raw.format === 'webp' || raw.format === 'pdf') {
    doc.output.format = raw.format;
  }
  doc.output.quality = Math.min(1, Math.max(0.01, num(raw.quality, doc.output.quality)));
  doc.output.matte = str(raw.matte, doc.output.matte);
  const outWidth = num(raw.outWidth, 0);
  if (outWidth > 0) doc.output.resize = { mode: 'width', width: Math.round(outWidth) };
  return doc;
}

/**
 * Migrate any persisted/unknown document into the current `Doc` schema.
 * Returns null only when the input is not recognizably a document at all.
 *
 * This must stay pure and defensive: IndexedDB sessions outlive deploys, so a
 * doc written by an older build has to load without throwing.
 */
export function migrateDoc(input: unknown): Doc | null {
  if (!isRecord(input)) return null;

  const schema = num(input.schema, 0);
  if (schema === DOC_SCHEMA) {
    // Already current: still normalize nested values so hand-edited JSON is safe.
    return {
      schema: DOC_SCHEMA,
      source: migrateSource(input.source),
      geometry: mergeGeometry(input.geometry),
      adjust: mergeAdjust(input.adjust),
      curves: mergeCurves(input.curves),
      hsl: mergeHsl(input.hsl),
      look: migrateLook(input.look),
      effects: migrateEffects(input.effects),
      masks: Array.isArray(input.masks) ? (input.masks.filter(isRecord) as unknown as Mask[]) : [],
      localAdjusts: Array.isArray(input.localAdjusts)
        ? (input.localAdjusts.filter(isRecord) as unknown as LocalAdjust[])
        : [],
      retouch: migrateRetouch(input.retouch),
      background: migrateBackground(input.background),
      layers: Array.isArray(input.layers)
        ? (input.layers.map(mergeLayer).filter(Boolean) as Layer[])
        : [],
      output: mergeOutput(input.output),
      passport: migratePassport(input.passport),
    };
  }

  if (schema === 1 || schema === 2) {
    // Schema 1/2 shared the same flat-ish shape family; fold into the current
    // schema and re-validate.
    const merged = { ...input, schema: DOC_SCHEMA };
    return migrateDoc(merged);
  }

  // Legacy flat EditorState (no schema field) — recognizable by rotation/
  // brightness/outWidth.
  if ('rotation' in input || 'brightness' in input || 'outWidth' in input || 'flipH' in input) {
    return mergeLegacy(input);
  }

  return null;
}

function migrateSource(raw: unknown): SourceRef | null {
  if (!isRecord(raw) || typeof raw.assetId !== 'string') return null;
  return {
    assetId: raw.assetId,
    width: Math.max(1, Math.round(num(raw.width, 1))),
    height: Math.max(1, Math.round(num(raw.height, 1))),
    name: str(raw.name, 'image'),
    mime: str(raw.mime, 'image/jpeg'),
  };
}

function migrateLook(raw: unknown): Look {
  const base = createDoc().look;
  if (!isRecord(raw)) return base;
  base.id = typeof raw.id === 'string' ? raw.id : null;
  base.amount = Math.min(1, Math.max(0, num(raw.amount, 1)));
  return base;
}

function migrateEffects(raw: unknown): Effects {
  const base = createDoc().effects;
  if (!isRecord(raw)) return base;
  base.grain = num(raw.grain, 0);
  base.bloom = num(raw.bloom, 0);
  base.fieldBlur = num(raw.fieldBlur, 0);
  return base;
}

function migrateRetouch(raw: unknown): Retouch {
  const base = createDoc().retouch;
  if (!isRecord(raw)) return base;
  base.smooth = num(raw.smooth, 0);
  base.healSpots = Array.isArray(raw.healSpots) ? (raw.healSpots.filter(isRecord) as never) : [];
  base.redEye = Array.isArray(raw.redEye) ? (raw.redEye.filter(isRecord) as never) : [];
  return base;
}

function migrateBackground(raw: unknown): Background {
  const base = createDoc().background;
  if (!isRecord(raw)) return base;
  if (raw.mode === 'none' || raw.mode === 'color' || raw.mode === 'gradient' || raw.mode === 'image') {
    base.mode = raw.mode;
  }
  base.color = str(raw.color, base.color);
  base.fit = raw.fit === 'contain' ? 'contain' : 'cover';
  base.blur = num(raw.blur, 0);
  base.removed = bool(raw.removed, false);
  base.imageAssetId = typeof raw.imageAssetId === 'string' ? raw.imageAssetId : null;
  if (isRecord(raw.gradient)) {
    base.gradient = {
      from: str(raw.gradient.from, base.gradient.from),
      to: str(raw.gradient.to, base.gradient.to),
      angle: num(raw.gradient.angle, base.gradient.angle),
    };
  }
  return base;
}

function migratePassport(raw: unknown): PassportDoc | null {
  if (!isRecord(raw) || typeof raw.specId !== 'string') return null;
  return { specId: raw.specId, backgroundApplied: bool(raw.backgroundApplied, false) };
}