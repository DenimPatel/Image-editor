import type {
  Adjust,
  AdjustKey,
  Background,
  Curves,
  Doc,
  Effects,
  Geometry,
  HslBand,
  HslMix,
  Look,
  OutputSpec,
  Retouch,
} from './types';

export const DOC_SCHEMA = 3 as const;

export const NEUTRAL_ADJUST: Adjust = {
  exposure: 0,
  brilliance: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  brightness: 0,
  blackPoint: 0,
  saturation: 0,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  sharpness: 0,
  definition: 0,
  noiseReduction: 0,
  vignette: 0,
};

export const ADJUST_KEYS: AdjustKey[] = [
  'exposure',
  'brilliance',
  'highlights',
  'shadows',
  'contrast',
  'brightness',
  'blackPoint',
  'saturation',
  'vibrance',
  'warmth',
  'tint',
  'sharpness',
  'definition',
  'noiseReduction',
  'vignette',
];

export type AdjustSpec = {
  key: AdjustKey;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: number;
  /** Shown to the right of the value, e.g. "EV" or "". */
  unit?: string;
};

export const ADJUST_SPECS: AdjustSpec[] = [
  { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.01, neutral: 0, unit: 'EV' },
  { key: 'brilliance', label: 'Brilliance', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'blackPoint', label: 'Black Point', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, neutral: 0 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100, step: 1, neutral: 0 },
  { key: 'definition', label: 'Definition', min: 0, max: 100, step: 1, neutral: 0 },
  { key: 'noiseReduction', label: 'Noise Reduction', min: 0, max: 100, step: 1, neutral: 0 },
  { key: 'vignette', label: 'Vignette', min: -100, max: 100, step: 1, neutral: 0 },
];

export const ADJUST_SPEC_BY_KEY: Record<AdjustKey, AdjustSpec> = Object.fromEntries(
  ADJUST_SPECS.map((spec) => [spec.key, spec]),
) as Record<AdjustKey, AdjustSpec>;

export const IDENTITY_CURVE = [
  { x: 0, y: 0 },
  { x: 255, y: 255 },
];

export const IDENTITY_CURVES: Curves = {
  rgb: IDENTITY_CURVE.map((p) => ({ ...p })),
  r: IDENTITY_CURVE.map((p) => ({ ...p })),
  g: IDENTITY_CURVE.map((p) => ({ ...p })),
  b: IDENTITY_CURVE.map((p) => ({ ...p })),
};

export const HSL_BANDS: HslBand[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
];

export const NEUTRAL_HSL: HslMix = Object.fromEntries(
  HSL_BANDS.map((band) => [band, { hue: 0, sat: 0, lum: 0 }]),
) as HslMix;

export const NEUTRAL_LOOK: Look = { id: null, amount: 1 };
export const NEUTRAL_EFFECTS: Effects = { grain: 0, bloom: 0, fieldBlur: 0 };

export const NEUTRAL_RETOUCH: Retouch = { smooth: 0, healSpots: [], redEye: [] };

export const DEFAULT_BACKGROUND: Background = {
  mode: 'none',
  color: '#ffffff',
  gradient: { from: '#ffffff', to: '#dfe6ea', angle: 135 },
  imageAssetId: null,
  fit: 'cover',
  blur: 0,
  removed: false,
};

export const DEFAULT_GEOMETRY: Geometry = {
  orientation: { quarterTurns: 0, flipH: false, flipV: false },
  straighten: 0,
  perspective: {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 0, y: 0 },
    bottomLeft: { x: 0, y: 0 },
    bottomRight: { x: 0, y: 0 },
  },
  crop: { x: 0, y: 0, width: 1, height: 1 },
  aspectLock: null,
};

export const DEFAULT_OUTPUT: OutputSpec = {
  format: 'jpeg',
  quality: 0.92,
  resize: { mode: 'none' },
  dpi: 300,
  matte: '#ffffff',
  metadata: 'strip',
  targetBytes: null,
  sheet: 'none',
};

export function createDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    schema: DOC_SCHEMA,
    source: null,
    geometry: cloneGeometry(DEFAULT_GEOMETRY),
    adjust: { ...NEUTRAL_ADJUST },
    curves: cloneCurves(IDENTITY_CURVES),
    hsl: cloneHsl(NEUTRAL_HSL),
    look: { ...NEUTRAL_LOOK },
    effects: { ...NEUTRAL_EFFECTS },
    masks: [],
    localAdjusts: [],
    retouch: { ...NEUTRAL_RETOUCH, healSpots: [], redEye: [] },
    background: cloneBackground(DEFAULT_BACKGROUND),
    layers: [],
    output: { ...DEFAULT_OUTPUT },
    passport: null,
    ...overrides,
  };
}

export function cloneGeometry(geometry: Geometry): Geometry {
  return {
    orientation: { ...geometry.orientation },
    straighten: geometry.straighten,
    perspective: {
      topLeft: { ...geometry.perspective.topLeft },
      topRight: { ...geometry.perspective.topRight },
      bottomLeft: { ...geometry.perspective.bottomLeft },
      bottomRight: { ...geometry.perspective.bottomRight },
    },
    crop: { ...geometry.crop },
    aspectLock: geometry.aspectLock,
  };
}

export function cloneCurves(curves: Curves): Curves {
  return {
    rgb: curves.rgb.map((p) => ({ ...p })),
    r: curves.r.map((p) => ({ ...p })),
    g: curves.g.map((p) => ({ ...p })),
    b: curves.b.map((p) => ({ ...p })),
  };
}

export function cloneHsl(hsl: HslMix): HslMix {
  return Object.fromEntries(
    HSL_BANDS.map((band) => [band, { ...hsl[band] }]),
  ) as HslMix;
}

export function cloneBackground(background: Background): Background {
  return {
    ...background,
    gradient: { ...background.gradient },
  };
}
