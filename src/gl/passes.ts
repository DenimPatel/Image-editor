import type { Background, Curves, Doc, HslMix, Layer, Mask, Size } from '../model/types';
import type { Mat3 } from './geometry';

/**
 * The ordered render plan. `planPasses` is pure and deterministic so the plan
 * can be unit-tested and hashed without a GPU: identity passes are skipped,
 * and `planHash` gives the renderer a cheap "did anything change" key.
 */

export type TonePass = {
  kind: 'tone';
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  blackPoint: number;
  brilliance: number;
};

export type ColorPass = {
  kind: 'color';
  saturation: number;
  vibrance: number;
  warmth: number;
  tint: number;
};

export type GeometryPass = { kind: 'geometry'; matrix: Mat3 };

export type CurvesPass = { kind: 'curves'; curves: Curves };
export type HslPass = { kind: 'hsl'; mix: HslMix };
export type Lut3dPass = { kind: 'lut3d'; id: string; amount: number };
export type DenoisePass = { kind: 'denoise'; amount: number };
export type DefinitionPass = { kind: 'definition'; amount: number };
export type SharpenPass = { kind: 'sharpen'; amount: number };
export type VignettePass = { kind: 'vignette'; amount: number };
export type EffectsPass = { kind: 'effects'; grain: number; bloom: number; fieldBlur: number };
export type LocalPass = { kind: 'local'; mask: Mask; values: Record<string, number> };
export type BackgroundPass = { kind: 'background'; background: Background };
export type LayersPass = { kind: 'layers'; layers: Layer[] };
export type OutputPass = {
  kind: 'output';
  width: number;
  height: number;
  matte: string;
  flatten: boolean;
  alpha: boolean;
};

export type Pass =
  | GeometryPass
  | TonePass
  | ColorPass
  | CurvesPass
  | HslPass
  | Lut3dPass
  | DenoisePass
  | DefinitionPass
  | SharpenPass
  | LocalPass
  | BackgroundPass
  | EffectsPass
  | VignettePass
  | LayersPass
  | OutputPass;

const IDENTITY_CURVE_POINTS = [
  [0, 0],
  [255, 255],
];

export function areCurvesIdentity(curves: Curves): boolean {
  for (const channel of ['rgb', 'r', 'g', 'b'] as const) {
    const points = curves[channel];
    if (points.length !== 2) return false;
    if (points[0].x !== IDENTITY_CURVE_POINTS[0][0] || points[0].y !== IDENTITY_CURVE_POINTS[0][1]) {
      return false;
    }
    if (points[1].x !== IDENTITY_CURVE_POINTS[1][0] || points[1].y !== IDENTITY_CURVE_POINTS[1][1]) {
      return false;
    }
  }
  return true;
}

function isHslNeutral(mix: HslMix): boolean {
  return Object.values(mix).every((band) => band.hue === 0 && band.sat === 0 && band.lum === 0);
}

function isPerspectiveIdentity(background: Doc['geometry']['perspective']): boolean {
  return Object.values(background).every((point) => point.x === 0 && point.y === 0);
}

function isGeometryIdentity(doc: Doc): boolean {
  const { orientation, straighten, crop, perspective } = doc.geometry;
  return (
    orientation.quarterTurns === 0 &&
    !orientation.flipH &&
    !orientation.flipV &&
    straighten === 0 &&
    isPerspectiveIdentity(perspective) &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === 1 &&
    crop.height === 1
  );
}

/** Convert the -100..100 Adjust model into normalized shader values. */
function normalizedAdjust(doc: Doc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(doc.adjust)) out[key] = value / 100;
  // Exposure is authored in EV already.
  out.exposure = doc.adjust.exposure;
  return out;
}

export function planPasses(doc: Doc, size: Size, geometryMatrix?: Mat3): Pass[] {
  const passes: Pass[] = [];
  const adjust = normalizedAdjust(doc);
  const has = (...keys: (keyof Doc['adjust'])[]) => keys.some((key) => doc.adjust[key] !== 0);

  if (!isGeometryIdentity(doc) && geometryMatrix) {
    passes.push({ kind: 'geometry', matrix: geometryMatrix });
  }

  if (
    has('exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'blackPoint', 'brilliance')
  ) {
    passes.push({
      kind: 'tone',
      exposure: adjust.exposure,
      brightness: adjust.brightness,
      contrast: adjust.contrast,
      highlights: adjust.highlights,
      shadows: adjust.shadows,
      blackPoint: adjust.blackPoint,
      brilliance: adjust.brilliance,
    });
  }

  if (has('saturation', 'vibrance', 'warmth', 'tint')) {
    passes.push({
      kind: 'color',
      saturation: adjust.saturation,
      vibrance: adjust.vibrance,
      warmth: adjust.warmth,
      tint: adjust.tint,
    });
  }

  if (!areCurvesIdentity(doc.curves)) {
    passes.push({ kind: 'curves', curves: doc.curves });
  }

  if (!isHslNeutral(doc.hsl)) {
    passes.push({ kind: 'hsl', mix: doc.hsl });
  }

  if (doc.look.id !== null) {
    passes.push({ kind: 'lut3d', id: doc.look.id, amount: doc.look.amount });
  }

  if (doc.adjust.noiseReduction > 0) {
    passes.push({ kind: 'denoise', amount: doc.adjust.noiseReduction / 100 });
  }
  if (doc.adjust.definition > 0) {
    passes.push({ kind: 'definition', amount: doc.adjust.definition / 100 });
  }
  if (doc.adjust.sharpness > 0) {
    passes.push({ kind: 'sharpen', amount: doc.adjust.sharpness / 100 });
  }

  for (const local of doc.localAdjusts) {
    if (!local.enabled) continue;
    const mask = doc.masks.find((candidate) => candidate.id === local.maskId);
    if (!mask || !mask.enabled) continue;
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(local.values)) {
      values[key] = key === 'exposure' ? (value as number) : (value as number) / 100;
    }
    passes.push({ kind: 'local', mask, values });
  }

  if (doc.background.mode !== 'none' || doc.background.removed) {
    passes.push({ kind: 'background', background: doc.background });
  }

  if (doc.effects.fieldBlur > 0) {
    passes.push({
      kind: 'effects',
      grain: 0,
      bloom: 0,
      fieldBlur: doc.effects.fieldBlur / 100,
    });
  }
  if (doc.effects.bloom > 0) {
    passes.push({ kind: 'effects', grain: 0, bloom: doc.effects.bloom / 100, fieldBlur: 0 });
  }
  if (doc.effects.grain > 0 || doc.adjust.vignette !== 0) {
    passes.push({
      kind: 'effects',
      grain: doc.effects.grain / 100,
      bloom: 0,
      fieldBlur: 0,
    });
    if (doc.adjust.vignette !== 0) {
      passes.push({ kind: 'vignette', amount: doc.adjust.vignette / 100 });
    }
  }

  const visibleLayers = doc.layers.filter((layer) => layer.visible);
  if (visibleLayers.length > 0) {
    passes.push({ kind: 'layers', layers: visibleLayers });
  }

  passes.push({
    kind: 'output',
    width: size.width,
    height: size.height,
    matte: doc.output.matte,
    flatten: doc.output.format === 'jpeg' || doc.output.format === 'pdf',
    alpha:
      (doc.output.format === 'png' || doc.output.format === 'webp' || doc.output.format === 'avif') &&
      doc.background.mode === 'none',
  });

  return passes;
}

/** Stable hash of a plan, used to skip redundant re-renders. */
export function planHash(passes: Pass[]): string {
  return passes
    .map((pass) => {
      switch (pass.kind) {
        case 'geometry':
          return `geo:${pass.matrix.map((n) => n.toFixed(5)).join(',')}`;
        case 'curves':
          return `curves:${(['rgb', 'r', 'g', 'b'] as const)
            .map((c) => pass.curves[c].map((p) => `${p.x}:${p.y}`).join('|'))
            .join(';')}`;
        case 'hsl':
          return `hsl:${Object.entries(pass.mix)
            .map(([band, value]) => `${band}${value.hue},${value.sat},${value.lum}`)
            .join(';')}`;
        case 'layers':
          return `layers:${pass.layers.map((layer) => `${layer.id}:${layer.kind}`).join(',')}`;
        case 'local':
          return `local:${pass.mask.id}:${JSON.stringify(pass.values)}`;
        case 'background':
          return `bg:${pass.background.mode}:${pass.background.color}:${pass.background.imageAssetId ?? ''}`;
        case 'output':
          return `out:${pass.width}x${pass.height}:${pass.flatten}:${pass.alpha}`;
        default:
          return `${pass.kind}:${JSON.stringify(pass)}`;
      }
    })
    .join('>');
}
