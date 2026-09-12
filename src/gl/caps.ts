/**
 * Capability probing. Every probe is defensive: an iOS canvas that silently
 * becomes blank is worse than a slower fallback, so the canvas-area probe
 * actually allocates and reads back a pixel rather than trusting
 * MAX_TEXTURE_SIZE.
 */

export type ExportFormats = { webp: boolean; avif: boolean };

export type Caps = {
  webgl2: boolean;
  colorBufferHalfFloat: boolean;
  linearFloat: boolean;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  /** Usable canvas area in pixels, probed. */
  maxCanvasArea: number;
  formats: ExportFormats;
  saveData: boolean;
  offscreenCanvas: boolean;
  workerWebgl: boolean;
};

const CACHE_KEY = 'ie-caps-v1';

const DEFAULT_CAPS: Caps = {
  webgl2: false,
  colorBufferHalfFloat: false,
  linearFloat: false,
  maxTextureSize: 4096,
  maxRenderbufferSize: 4096,
  maxCanvasArea: 4096 * 4096,
  formats: { webp: false, avif: false },
  saveData: false,
  offscreenCanvas: false,
  workerWebgl: false,
};

export function probeFormats(): ExportFormats {
  const result: ExportFormats = { webp: false, avif: false };
  if (typeof document === 'undefined') return result;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    result.webp = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    result.avif = canvas.toDataURL('image/avif').startsWith('data:image/avif');
  } catch {
    // toDataURL can throw under memory pressure; treat as unsupported.
  }
  return result;
}

function probeCanvasArea(maxTextureSize: number): number {
  if (typeof document === 'undefined') return DEFAULT_CAPS.maxCanvasArea;
  const side = Math.min(maxTextureSize, 4096);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) return DEFAULT_CAPS.maxCanvasArea;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    // A silent iOS failure leaves the buffer zeroed/blank.
    return data[3] === 255 ? side * side : 2048 * 2048;
  } catch {
    return 2048 * 2048;
  }
}

export function probeCaps(): Caps {
  if (typeof document === 'undefined') return { ...DEFAULT_CAPS };

  const canvas = document.createElement('canvas');
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true });
  } catch {
    // gl stays null; treated as no WebGL2 support below.
  }

  if (!gl) {
    return {
      ...DEFAULT_CAPS,
      webgl2: false,
      formats: probeFormats(),
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      saveData: readSaveData(),
      maxCanvasArea: probeCanvasArea(DEFAULT_CAPS.maxTextureSize),
    };
  }

  const halfFloat = Boolean(gl.getExtension('EXT_color_buffer_half_float'));
  const linearFloat = Boolean(gl.getExtension('OES_texture_float_linear'));
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;

  return {
    webgl2: true,
    colorBufferHalfFloat: halfFloat,
    linearFloat,
    maxTextureSize,
    maxRenderbufferSize,
    maxCanvasArea: probeCanvasArea(maxTextureSize),
    formats: probeFormats(),
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    saveData: readSaveData(),
    workerWebgl: typeof OffscreenCanvas !== 'undefined',
  };
}

function readSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

export function loadCaps(force = false): Caps {
  if (typeof localStorage !== 'undefined' && !force) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) return JSON.parse(cached) as Caps;
    } catch {
      // ignore malformed/unavailable storage
    }
  }
  const caps = probeCaps();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(caps));
  } catch {
    // Safari private mode throws; probing is cheap enough to redo.
  }
  return caps;
}

export const FALLBACK_CAPS = DEFAULT_CAPS;
