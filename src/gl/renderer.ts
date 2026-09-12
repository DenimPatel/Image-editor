import { buildChannelLuts } from '../lib/curves';
import type { Doc, Size } from '../model/types';
import type { RenderBackend, RenderRequest } from '../render/backend';
import { attachContextLossHandlers, getWebgl2 } from './context';
import { FboPool, type Fbo } from './framebuffer';
import { computeOutputToSource } from './geometry';
import { getLut, loadLut, LUT_SIZE } from './luts';
import { planHash, planPasses, type Pass } from './passes';
import { ProgramCache } from './program';
import { createQuad, drawQuad } from './quad';
import * as S from './shaders/index';
import { createLutTexture, createTexture, disposeTexture } from './texture';

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [1, 0.5, 0];
  const int = parseInt(match[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export class GlRenderer implements RenderBackend {
  readonly kind = 'gl' as const;
  readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;
  private readonly programs: ProgramCache;
  private readonly pool: FboPool;
  private readonly vao: WebGLVertexArrayObject;
  private readonly detachLoss: () => void;

  private sourceTexture: WebGLTexture | null = null;
  private sourceKey = '';
  private curveTextures = new Map<string, { rgb: WebGLTexture; r: WebGLTexture; g: WebGLTexture; b: WebGLTexture }>();
  private lutTextures = new Map<string, WebGLTexture>();
  private lost = false;

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    const gl = getWebgl2(canvas);
    if (!gl) throw new Error('WebGL2 unavailable');
    this.canvas = canvas;
    this.gl = gl;
    this.programs = new ProgramCache(gl);
    this.pool = new FboPool(gl);
    this.vao = createQuad(gl);
    this.detachLoss = attachContextLossHandlers(canvas, {
      onLost: () => {
        this.lost = true;
        this.disposeGpuState();
      },
      onRestored: () => {
        this.lost = false;
      },
    });
  }

  private get glContext(): WebGL2RenderingContext {
    return this.gl;
  }

  private disposeGpuState(): void {
    const gl = this.glContext;
    if (this.sourceTexture) disposeTexture(gl, this.sourceTexture);
    this.sourceTexture = null;
    this.sourceKey = '';
    for (const set of this.curveTextures.values()) {
      disposeTexture(gl, set.rgb);
      disposeTexture(gl, set.r);
      disposeTexture(gl, set.g);
      disposeTexture(gl, set.b);
    }
    this.curveTextures.clear();
    for (const texture of this.lutTextures.values()) disposeTexture(gl, texture);
    this.lutTextures.clear();
    this.pool.clear();
  }

  dispose(): void {
    this.detachLoss();
    this.programs.dispose();
    this.disposeGpuState();
    this.glContext.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Warm the LUT texture for the current look without blocking a frame. */
  async prepare(doc: Doc): Promise<void> {
    if (doc.look.id && !this.lutTextures.has(doc.look.id)) {
      const bitmap = getLut(doc.look.id) ?? (await loadLut(doc.look.id));
      if (bitmap) {
        this.lutTextures.set(doc.look.id, createTexture(this.glContext, bitmap, { linear: true, clamp: true }));
      }
    }
  }

  render(request: RenderRequest): void {
    if (this.lost) return;
    const gl = this.glContext;
    const { doc, size, source, sourceSize } = request;

    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }

    this.ensureSourceTexture(source, sourceSize);
    const matrix = computeOutputToSource(doc, sourceSize, size);
    const passes = planPasses(doc, size, matrix);

    const ping = this.pool.acquire(size.width, size.height);
    const pong = this.pool.acquire(size.width, size.height);

    let currentTexture = this.sourceTexture;
    let currentSize: Size = sourceSize;
    let usePing = true;

    gl.bindVertexArray(this.vao);
    for (const pass of passes) {
      if (pass.kind === 'output') {
        this.drawPass(pass, currentTexture, null, size, currentSize, doc);
        continue;
      }
      if (pass.kind === 'layers' || pass.kind === 'local') {
        // Layer compositing happens in 2D on top; local masks are Phase 3.
        continue;
      }
      if (pass.kind === 'lut3d' && !this.lutTextures.has(pass.id)) continue;

      const target: Fbo = usePing ? ping : pong;
      usePing = !usePing;
      this.drawPass(pass, currentTexture, target, size, currentSize, doc);
      currentTexture = target.texture;
      currentSize = size;
    }
    gl.bindVertexArray(null);

    this.pool.release(ping);
    this.pool.release(pong);
  }

  private ensureSourceTexture(source: TexImageSource, sourceSize: Size): void {
    const gl = this.glContext;
    const key = `${sourceSize.width}x${sourceSize.height}`;
    if (this.sourceTexture && this.sourceKey === key) {
      // Same dimensions can still be a new bitmap after undo/replacement.
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      return;
    }
    if (this.sourceTexture) disposeTexture(gl, this.sourceTexture);
    this.sourceTexture = createTexture(gl, source, { flipY: true, linear: true, clamp: true });
    this.sourceKey = key;
  }

  private drawPass(
    pass: Pass,
    input: WebGLTexture | null,
    target: Fbo | null,
    size: Size,
    inputSize: Size,
    doc: Doc,
  ): void {
    const gl = this.glContext;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, size.width, size.height);

    const program = this.programFor(pass);
    if (!program) return;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    setInt(gl, program, 'u_tex', 0);
    setVec2(gl, program, 'u_texel', 1 / Math.max(1, inputSize.width), 1 / Math.max(1, inputSize.height));

    switch (pass.kind) {
      case 'geometry':
        setMat3(gl, program, 'u_matrix', pass.matrix);
        setVec2(gl, program, 'u_sourceSize', inputSize.width, inputSize.height);
        setVec2(gl, program, 'u_outputSize', size.width, size.height);
        break;
      case 'tone':
        setFloat(gl, program, 'u_exposure', pass.exposure);
        setFloat(gl, program, 'u_brightness', pass.brightness);
        setFloat(gl, program, 'u_contrast', pass.contrast);
        setFloat(gl, program, 'u_highlights', pass.highlights);
        setFloat(gl, program, 'u_shadows', pass.shadows);
        setFloat(gl, program, 'u_blackPoint', pass.blackPoint);
        setFloat(gl, program, 'u_brilliance', pass.brilliance);
        break;
      case 'color':
        setFloat(gl, program, 'u_saturation', pass.saturation);
        setFloat(gl, program, 'u_vibrance', pass.vibrance);
        setFloat(gl, program, 'u_warmth', pass.warmth);
        setFloat(gl, program, 'u_tint', pass.tint);
        break;
      case 'curves': {
        const textures = this.curvesFor(pass.curves);
        bindTexture(gl, program, 'u_lutRgb', textures.rgb, 1);
        bindTexture(gl, program, 'u_lutR', textures.r, 2);
        bindTexture(gl, program, 'u_lutG', textures.g, 3);
        bindTexture(gl, program, 'u_lutB', textures.b, 4);
        break;
      }
      case 'hsl': {
        const bands = new Float32Array(24);
        const order = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
        order.forEach((band, index) => {
          bands[index * 3] = pass.mix[band].hue;
          bands[index * 3 + 1] = pass.mix[band].sat;
          bands[index * 3 + 2] = pass.mix[band].lum;
        });
        const location = gl.getUniformLocation(program, 'u_bands');
        if (location) gl.uniform3fv(location, bands);
        break;
      }
      case 'lut3d': {
        const texture = this.lutTextures.get(pass.id);
        if (texture) bindTexture(gl, program, 'u_lut', texture, 1);
        setFloat(gl, program, 'u_amount', pass.amount);
        setFloat(gl, program, 'u_size', LUT_SIZE);
        break;
      }
      case 'denoise':
        setFloat(gl, program, 'u_radius', 1 + pass.amount * 2);
        break;
      case 'definition':
      case 'sharpen':
        setFloat(gl, program, 'u_amount', 0);
        setFloat(gl, program, 'u_definition', pass.amount);
        break;
      case 'effects':
        setFloat(gl, program, 'u_grain', pass.grain);
        setFloat(gl, program, 'u_bloom', pass.bloom);
        setFloat(gl, program, 'u_fieldBlur', pass.fieldBlur);
        break;
      case 'vignette':
        setFloat(gl, program, 'u_amount', pass.amount);
        break;
      case 'background': {
        const [r, g, b] = hexToRgb(pass.background.color);
        setVec3(gl, program, 'u_color', r, g, b);
        const from = hexToRgb(pass.background.gradient.from);
        const to = hexToRgb(pass.background.gradient.to);
        setVec3(gl, program, 'u_gradientFrom', from[0], from[1], from[2]);
        setVec3(gl, program, 'u_gradientTo', to[0], to[1], to[2]);
        setFloat(gl, program, 'u_angle', pass.background.gradient.angle);
        setInt(
          gl,
          program,
          'u_mode',
          pass.background.mode === 'gradient' ? 2 : pass.background.mode === 'color' ? 1 : 0,
        );
        break;
      }
      case 'output': {
        const [r, g, b] = hexToRgb(pass.matte);
        setVec3(gl, program, 'u_matte', r, g, b);
        setInt(gl, program, 'u_flatten', pass.flatten ? 1 : 0);
        break;
      }
      default:
        break;
    }

    drawQuad(gl, this.vao);
    void doc;
  }

  private programFor(pass: Pass): WebGLProgram | null {
    switch (pass.kind) {
      case 'geometry':
        return this.programs.get('geometry', S.QUAD_VERT, S.GEOMETRY_FRAG);
      case 'tone':
        return this.programs.get('tone', S.QUAD_VERT, S.TONE_FRAG);
      case 'color':
        return this.programs.get('color', S.QUAD_VERT, S.COLOR_FRAG);
      case 'curves':
        return this.programs.get('curves', S.QUAD_VERT, S.CURVES_FRAG);
      case 'hsl':
        return this.programs.get('hsl', S.QUAD_VERT, S.HSL_FRAG);
      case 'lut3d':
        return this.programs.get('lut3d', S.QUAD_VERT, S.LUT3D_FRAG);
      case 'denoise':
        return this.programs.get('blur', S.QUAD_VERT, S.BLUR_FRAG);
      case 'definition':
      case 'sharpen':
        return this.programs.get('sharpen', S.QUAD_VERT, S.SHARPEN_FRAG);
      case 'effects':
        return this.programs.get('effects', S.QUAD_VERT, S.EFFECTS_FRAG);
      case 'vignette':
        return this.programs.get('vignette', S.QUAD_VERT, S.VIGNETTE_FRAG);
      case 'background':
        return this.programs.get('background', S.QUAD_VERT, S.BACKGROUND_FRAG);
      case 'output':
        return this.programs.get('output', S.QUAD_VERT, S.OUTPUT_FRAG);
      default:
        return null;
    }
  }

  private curvesFor(curves: Doc['curves']) {
    const key = planHash([{ kind: 'curves', curves }]);
    const existing = this.curveTextures.get(key);
    if (existing) return existing;
    const gl = this.glContext;
    const luts = buildChannelLuts(curves);
    const set = {
      rgb: createLutTexture(gl, luts.rgb),
      r: createLutTexture(gl, luts.r),
      g: createLutTexture(gl, luts.g),
      b: createLutTexture(gl, luts.b),
    };
    // Bound the cache so a long editing session cannot grow it without limit.
    if (this.curveTextures.size > 32) {
      const oldest = this.curveTextures.keys().next().value;
      if (oldest) {
        const old = this.curveTextures.get(oldest);
        if (old) {
          disposeTexture(gl, old.rgb);
          disposeTexture(gl, old.r);
          disposeTexture(gl, old.g);
          disposeTexture(gl, old.b);
        }
        this.curveTextures.delete(oldest);
      }
    }
    this.curveTextures.set(key, set);
    return set;
  }
}

function bindTexture(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  texture: WebGLTexture,
  unit: number,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform1i(location, unit);
}

function setFloat(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform1f(location, value);
}

function setInt(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, value: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform1i(location, value);
}

function setVec2(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, x: number, y: number): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform2f(location, x, y);
}

function setVec3(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
  z: number,
): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniform3f(location, x, y, z);
}

function setMat3(gl: WebGL2RenderingContext, program: WebGLProgram, name: string, matrix: number[]): void {
  const location = gl.getUniformLocation(program, name);
  if (location) gl.uniformMatrix3fv(location, false, matrix);
}