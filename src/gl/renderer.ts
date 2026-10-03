import { buildChannelLuts } from '../lib/curves'
import { definitionRadius, sharpenRadius } from '../lib/detail-kernels'
import { parseHexColor, type Rgb } from '../lib/hex-color'
import { assetStore } from '../model/assetsSingleton'
import type { AssetId, Curves, Doc, Mask, Size } from '../model/types'
import { BACKGROUND_MODE_IMAGE, fitIndex } from '../render/background'
import { SMOOTH_RANGE, smoothRadius } from '../render/retouch'
import type { RenderBackend, RenderRequest } from '../render/backend'
import { attachContextLossHandlers, getWebgl2 } from './context'
import { FboPool, SingleChannelPool, type Fbo } from './framebuffer'
import { computeOutputToSource, type Mat3 } from './geometry'
import { planRender, type RenderLimits } from './limits'
import { getLut, loadLut, LUT_SIZE } from './luts'
import { LOCAL_ADJUST_KEYS, maskKindIndex, rasterizeMask } from './mask'
import { planHash, planPasses, withLeadingGeometry, type LocalPass, type Pass } from './passes'
import { pixelScale } from './pixel-scale'
import { ProgramCache } from './program'
import { createQuad, drawQuad } from './quad'
import * as S from './shaders/index'
import {
  createFieldTexture,
  createLutTexture,
  createSolidTexture,
  createTexture,
  disposeTexture,
} from './texture'
import { planHalo, tileRenderSize, type Tile } from './tiling'

/**
 * Parsed colour for a shader uniform. Anything that is not `#rgb`/`#rrggbb` —
 * a named colour, `transparent`, a value migrated in from an older document —
 * falls back to white rather than to a guessed hue, which is what the Canvas2D
 * backend paints for the same inputs.
 */
export const NEUTRAL_FILL: Rgb = [1, 1, 1]

export function hexToRgb(hex: string, fallback: Rgb = NEUTRAL_FILL): Rgb {
  return parseHexColor(hex) ?? fallback
}

export type GlRendererOptions = {
  /**
   * Probed device ceilings (`renderLimits(caps)` in `src/gl/caps.ts`). A caller
   * that has probed nothing gets ceilings no real GPU can reach, so an export is
   * never silently downscaled to a limit nobody measured.
   */
  limits?: RenderLimits
  /** 16-bit intermediate targets where `EXT_color_buffer_half_float` exists. */
  halfFloat?: boolean
  /**
   * Where a `background.imageAssetId` is resolved from. Defaults to the process
   * asset store; a test injects its own so a background image can be rendered
   * without a decoded `ImageBitmap` in jsdom.
   */
  assets?: (id: AssetId) => TexImageSource | undefined
}

type CurveTextures = { rgb: WebGLTexture; r: WebGLTexture; g: WebGLTexture; b: WebGLTexture }

/** Where one pass chain is drawing, in the frame of the whole output. */
type View = {
  /** Size of the buffer this chain writes. */
  size: Size
  /** Top-left of that buffer inside the whole output, in output pixels. */
  origin: { x: number; y: number }
  /** `pixelScale` of the whole render, not of the tile. */
  scale: number
  /**
   * Size of the *whole* output, which a tile's `size` is a window into. A mask
   * or a heal spot is authored in whole-output space, so it needs this to
   * address itself from inside a tile.
   */
  frame: Size
  /** True when the terminal output pass draws into a framebuffer, not the canvas. */
  offscreenOutput: boolean
}

/** Limits no probed GPU can exceed, for a caller that has not probed anything. */
const UNLIMITED: RenderLimits = {
  maxTextureSize: 32768,
  maxRenderbufferSize: 32768,
  maxCanvasArea: 1 << 30,
}

export class GlRenderer implements RenderBackend {
  readonly kind = 'gl' as const
  readonly canvas: HTMLCanvasElement

  private readonly gl: WebGL2RenderingContext
  private readonly limits: RenderLimits
  private readonly halfFloat: boolean
  private readonly detachLoss: () => void

  /**
   * Every GPU object below is dead the moment the context is lost, so all of
   * them are rebuilt in `onRestored`: a restored context has no VAO, no cached
   * programs and no framebuffers, and binding the dead ones is what made a
   * mid-export loss produce a blank image with no error.
   */
  private programs: ProgramCache
  private pool: FboPool
  private maskPool: SingleChannelPool
  private vao: WebGLVertexArrayObject

  private sourceTexture: WebGLTexture | null = null
  private sourceOwner: object | null = null
  private sourceSize: Size | null = null
  private sourceKey = ''
  /**
   * Bitmaps already uploaded, by identity. Keying on `${w}x${h}` re-decoded the
   * whole source on every slider frame, because a replaced bitmap at the same
   * dimensions looks identical to that key.
   */
  private uploadedSources = new WeakSet<object>()
  private curveTextures = new Map<string, CurveTextures>()
  private lutTextures = new Map<string, WebGLTexture>()

  /** In-flight LUT loads, so two look changes cannot race the same texture. */
  private lutLoads = new Map<string, Promise<void>>()
  /**
   * Rasterised brush masks, by mask id. Only the brush kind needs one: the
   * other four are closed-form in MASK_FRAG, and a polyline of arbitrary
   * length has no shader expression that would not be a lie about its size.
   */
  private brushFields = new Map<string, { texture: WebGLTexture; key: string; width: number }>()
  /** A 1x1 black R8 texture, bound wherever a mask has no brush field. */
  private emptyMask: WebGLTexture | null = null
  /** A 1x1 white RGBA texture, bound wherever a background has no image. */
  private emptyImage: WebGLTexture | null = null
  private backgroundTextures = new Map<string, { texture: WebGLTexture; key: string }>()
  private readonly assets: (id: AssetId) => TexImageSource | undefined
  private lost = false
  private lastHash = ''

  constructor(
    canvas: HTMLCanvasElement = document.createElement('canvas'),
    options: GlRendererOptions = {},
  ) {
    const gl = getWebgl2(canvas)
    if (!gl) throw new Error('WebGL2 unavailable')
    this.canvas = canvas
    this.gl = gl
    this.limits = options.limits ?? UNLIMITED
    this.halfFloat = options.halfFloat === true
    this.programs = new ProgramCache(gl)
    this.pool = new FboPool(gl, { halfFloat: this.halfFloat })
    this.maskPool = new SingleChannelPool(gl)
    this.vao = createQuad(gl)
    this.assets = options.assets ?? ((id) => assetStore.get(id) as TexImageSource | undefined)
    this.detachLoss = attachContextLossHandlers(canvas, {
      onLost: () => {
        this.lost = true
        this.lastHash = ''
        this.releaseGpuState()
      },
      onRestored: () => {
        this.lost = false
        this.rebuildGpuState()
      },
    })
  }

  private get glContext(): WebGL2RenderingContext {
    return this.gl
  }

  /** Drop every GPU object this renderer owns. Only legal while lost. */
  private releaseGpuState(): void {
    const gl = this.glContext
    if (this.sourceTexture) disposeTexture(gl, this.sourceTexture)
    this.sourceTexture = null
    this.sourceOwner = null
    this.sourceKey = ''
    this.uploadedSources = new WeakSet<object>()
    for (const set of this.curveTextures.values()) {
      disposeTexture(gl, set.rgb)
      disposeTexture(gl, set.r)
      disposeTexture(gl, set.g)
      disposeTexture(gl, set.b)
    }
    this.curveTextures.clear()
    for (const texture of this.lutTextures.values()) disposeTexture(gl, texture)
    this.lutTextures.clear()
    this.lutLoads.clear()
    for (const entry of this.brushFields.values()) disposeTexture(gl, entry.texture)
    this.brushFields.clear()
    for (const entry of this.backgroundTextures.values()) disposeTexture(gl, entry.texture)
    this.backgroundTextures.clear()
    disposeTexture(gl, this.emptyMask)
    this.emptyMask = null
    disposeTexture(gl, this.emptyImage)
    this.emptyImage = null
    this.maskPool.clear()
    this.pool.clear()
  }

  private rebuildGpuState(): void {
    const gl = this.glContext
    // `forget`, not `dispose`: the cached programs belong to the context that
    // was lost, and deleting them through the restored one is an
    // INVALID_OPERATION per pass. See ProgramCache.forget.
    this.programs.forget()
    this.programs = new ProgramCache(gl)
    this.pool = new FboPool(gl, { halfFloat: this.halfFloat })
    this.maskPool = new SingleChannelPool(gl)
    this.vao = createQuad(gl)
  }

  dispose(): void {
    this.detachLoss()
    this.programs.dispose()
    this.releaseGpuState()
    this.glContext.getExtension('WEBGL_lose_context')?.loseContext()
  }

  /** True while the context is unusable; a render in that state draws nothing. */
  get isLost(): boolean {
    return this.lost
  }

  /**
   * True when the current look has no resident texture, so `LUT3D_FRAG` would
   * be skipped and the frame would ship ungraded. The caller uses this to know
   * it has to await `prepare` and then ask for another frame.
   */
  needsPrepare(doc: Doc): boolean {
    const id = doc.look.id
    return id !== null && !this.lutTextures.has(id)
  }

  /**
   * Warm the LUT texture for the current look without blocking a frame.
   * `LUT3D_FRAG` is skipped while no texture is resident, so a look that was
   * never prepared is *not* rendered; the caller is expected to surface a
   * failure rather than ship an ungraded file.
   */
  async prepare(doc: Doc): Promise<void> {
    const id = doc.look.id
    if (!id) return
    if (this.lutTextures.has(id)) return
    // One in-flight load per id. Two look changes in quick succession each
    // fired their own `loadLut`, and the loser's rejection was unhandled.
    const existing = this.lutLoads.get(id)
    if (existing) return existing
    const load = (async () => {
      const bitmap = getLut(id) ?? (await loadLut(id))
      // A context loss while the PNG was in flight leaves `lutTextures` empty
      // and every texture dead, so the bitmap is re-uploaded rather than
      // recorded as resident.
      if (!this.lost && !this.lutTextures.has(id)) {
        this.lutTextures.set(
          id,
          createTexture(this.glContext, bitmap, { linear: true, clamp: true }),
        )
        this.lastHash = ''
      }
    })()
      .catch((error: unknown) => {
        this.lutLoads.delete(id)
        throw error
      })
      .finally(() => {
        this.lutLoads.delete(id)
      })
    this.lutLoads.set(id, load)
    return load
  }

  render(request: RenderRequest): void {
    if (this.lost) return
    const { doc, size, source, sourceSize, signal } = request
    // A container that has not been measured yet hands us a 0x0 target. A
    // framebuffer with a zero-sized attachment is incomplete, so every draw on
    // it is a GL error and produces nothing; and a zero-sized source is not a
    // legal `texImage2D` payload. Neither is worth a frame.
    if (size.width < 1 || size.height < 1 || sourceSize.width < 1 || sourceSize.height < 1) return

    // A look the user just picked has no texture yet. Start the load here rather
    // than waiting for somebody upstream to remember: the first frame ships
    // ungraded, and every frame after the load settles carries the look.
    if (this.needsPrepare(doc)) void this.prepare(doc).catch(() => {})

    const matrix = computeOutputToSource(doc, sourceSize, size)
    const passes = withLeadingGeometry(planPasses(doc, size, matrix), matrix)
    // D1-F11: `planHash` is a sound "did anything change" key now that it covers
    // every field every pass reads, so an unchanged frame costs nothing. The
    // source identity is part of the key too, or a replaced bitmap would keep
    // the previous frame.
    const hash = `${planHash(passes)}|${size.width}x${size.height}|${identityOf(source)}`
    if (hash === this.lastHash) return
    this.lastHash = hash

    const scale = pixelScale(size)
    const plan = planRender(size, this.limits, planHalo(passes, size))
    const canvas = plan.canvas
    if (this.canvas.width !== canvas.width || this.canvas.height !== canvas.height) {
      this.canvas.width = canvas.width
      this.canvas.height = canvas.height
    }
    this.ensureSourceTexture(source, sourceSize)

    const gl = this.glContext
    gl.bindVertexArray(this.vao)
    if (plan.tiles.length <= 1) {
      this.runChain(
        passes,
        { size: canvas, origin: { x: 0, y: 0 }, scale, frame: canvas, offscreenOutput: false },
        signal,
      )
    } else {
      // D3-F18: a target no single render target can hold is drawn tile by
      // tile, each with the halo its kernels need, then blitted into the canvas.
      for (const tile of plan.tiles) {
        if (signal?.aborted) return
        const region = tileRenderSize(tile, canvas.width, canvas.height)
        const size = { width: region.width, height: region.height }
        const origin = { x: region.x, y: region.y }
        const written = this.runChain(
          passes,
          { size, origin, scale, frame: canvas, offscreenOutput: true },
          signal,
        )
        this.blitTile(written, tile, origin, size)
      }
    }
    gl.bindVertexArray(null)
  }

  /** Run `passes` over one target and return the framebuffer holding the result. */
  private runChain(passes: Pass[], view: View, signal?: AbortSignal): Fbo {
    const ping = this.pool.acquire(view.size.width, view.size.height)
    const pong = this.pool.acquire(view.size.width, view.size.height)
    // A mask is rasterised into its own R8 target immediately before the local
    // pass that reads it, so one target serves every local pass in the chain.
    let maskTarget: Fbo | null = null

    let currentTexture = this.sourceTexture
    let currentSize: Size = this.sourceSize ?? { width: view.size.width, height: view.size.height }
    let usePing = true
    let written = ping

    for (const pass of passes) {
      // Cancellation lands here rather than after the whole chain: a 48 MP
      // export is a dozen passes and each one is a full-screen draw.
      if (signal?.aborted) break
      if (pass.kind === 'output') {
        written = usePing ? ping : pong
        usePing = !usePing
        this.drawPass(
          pass,
          currentTexture,
          view.offscreenOutput ? written : null,
          view,
          currentSize,
        )
        continue
      }
      // Layer compositing happens in 2D on the presentation canvas, outside the
      // pass chain entirely.
      if (pass.kind === 'layers') continue
      if (pass.kind === 'lut3d' && !this.lutTextures.has(pass.id)) continue

      if (pass.kind === 'local') {
        const destination: Fbo = usePing ? ping : pong
        usePing = !usePing
        if (!maskTarget) maskTarget = this.maskPool.acquire(view.size.width, view.size.height)
        this.drawLocalPass(pass, currentTexture, destination, maskTarget, view, currentSize)
        currentTexture = destination.texture
        currentSize = view.size
        written = destination
        continue
      }

      const destination: Fbo = usePing ? ping : pong
      usePing = !usePing
      this.drawPass(pass, currentTexture, destination, view, currentSize)
      currentTexture = destination.texture
      currentSize = view.size
      written = destination
    }

    if (maskTarget) this.maskPool.release(maskTarget)
    this.pool.release(ping)
    this.pool.release(pong)
    return written
  }

  /**
   * A local adjustment is two draws: the mask field into an R8 target, then the
   * adjustment weighted by it. Drawing the mask separately is what lets several
   * local adjusts share one raster, and it is why the Canvas2D twin can read the
   * *same* eight-bit field the shader sees instead of re-deriving it.
   */
  private drawLocalPass(
    pass: LocalPass,
    input: WebGLTexture | null,
    target: Fbo,
    maskTarget: Fbo,
    view: View,
    inputSize: Size,
  ): void {
    this.drawMask(pass.mask, input, maskTarget, view)
    this.drawPass(pass, input, target, view, inputSize, maskTarget.texture)
  }

  private drawMask(mask: Mask, input: WebGLTexture | null, maskTarget: Fbo, view: View): void {
    const gl = this.glContext
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskTarget.framebuffer)
    gl.viewport(0, 0, view.size.width, view.size.height)
    const program = this.programs.get('mask', S.QUAD_VERT, S.MASK_FRAG)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input)
    setInt(gl, program, 'u_tex', 0)
    setVec2(gl, program, 'u_texel', 1 / view.size.width, 1 / view.size.height)
    bindTexture(
      gl,
      program,
      'u_brushTex',
      mask.kind === 'brush' ? this.brushTexture(mask, view) : this.blackMask(),
      1,
    )
    setInt(gl, program, 'u_maskKind', maskKindIndex(mask.kind))
    setFloat(gl, program, 'u_feather', mask.feather)
    setFloat(gl, program, 'u_invert', 'invert' in mask && mask.invert ? 1 : 0)
    if (mask.kind === 'linear') {
      setVec2(gl, program, 'u_from', mask.from.x, mask.from.y)
      setVec2(gl, program, 'u_to', mask.to.x, mask.to.y)
    } else {
      setVec2(gl, program, 'u_from', 0, 0)
      setVec2(gl, program, 'u_to', 0, 0)
    }
    if (mask.kind === 'radial') {
      setVec2(gl, program, 'u_center', mask.center.x, mask.center.y)
      setVec2(gl, program, 'u_radius', mask.radiusX, mask.radiusY)
      setFloat(gl, program, 'u_rotation', mask.rotation)
    } else {
      setVec2(gl, program, 'u_center', 0, 0)
      setVec2(gl, program, 'u_radius', 0, 0)
      setFloat(gl, program, 'u_rotation', 0)
    }
    if (mask.kind === 'luminance') {
      setVec2(gl, program, 'u_range', mask.low, mask.high)
    } else {
      setVec2(gl, program, 'u_range', 0, 1)
    }
    // The metric is the whole output's, not the tile's: mask geometry is
    // authored in output space, so a radius has to mean the same thing in
    // every tile of a tiled render.
    setFloat(gl, program, 'u_squeeze', view.frame.height / Math.max(1, view.frame.width))
    setVec2(gl, program, 'u_origin', view.origin.x, view.origin.y)
    setVec2(gl, program, 'u_viewSize', view.size.width, view.size.height)
    setVec2(gl, program, 'u_frameSize', view.frame.width, view.frame.height)
    drawQuad(gl, this.vao)
  }

  /** Rasterise a brush mask to an 8-bit field, cached per mask and view size. */
  private brushTexture(mask: Mask, view: View): WebGLTexture {
    if (mask.kind !== 'brush') throw new Error('brushTexture needs a brush mask')
    const key = `${planHash([{ kind: 'local', maskId: mask.id, mask, values: {} }])}`
    const cached = this.brushFields.get(mask.id)
    if (cached && cached.key === key && cached.width === view.size.width) return cached.texture
    const field = rasterizeMask(mask, view.size.width, view.size.height, () => ({
      luma: 0,
      alpha: 0,
      aspect: view.size.width / Math.max(1, view.size.height),
    }))
    const texture = createFieldTexture(this.glContext, field, view.size.width, view.size.height)
    if (cached) disposeTexture(this.glContext, cached.texture)
    if (this.brushFields.size > 16) {
      const oldest = this.brushFields.keys().next().value
      const entry = oldest ? this.brushFields.get(oldest) : undefined
      if (oldest && entry) {
        disposeTexture(this.glContext, entry.texture)
        this.brushFields.delete(oldest)
      }
    }
    this.brushFields.set(mask.id, { texture, key, width: view.size.width })
    return texture
  }

  private blackMask(): WebGLTexture {
    if (this.emptyMask) return this.emptyMask
    this.emptyMask = createFieldTexture(this.glContext, new Uint8Array([0]), 1, 1)
    return this.emptyMask
  }

  private whiteImage(): WebGLTexture {
    if (this.emptyImage) return this.emptyImage
    this.emptyImage = createSolidTexture(this.glContext, [255, 255, 255, 255])
    return this.emptyImage
  }

  /** Copy one tile's core out of its halo-padded framebuffer into the canvas. */
  private blitTile(source: Fbo, tile: Tile, origin: { x: number; y: number }, size: Size): void {
    const gl = this.glContext
    const program = this.programs.get('blit', S.QUAD_VERT, S.BLIT_FRAG)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    // The canvas is bottom-up, so a top-down core rect has to be flipped.
    gl.viewport(tile.x, this.canvas.height - tile.y - tile.height, tile.width, tile.height)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source.texture)
    setInt(gl, program, 'u_tex', 0)
    setVec2(gl, program, 'u_texel', 1 / size.width, 1 / size.height)
    const u = (tile.x - origin.x) / size.width
    const v = 1 - (tile.y - origin.y) / size.height - tile.height / size.height
    setVec4(gl, program, 'u_uvRect', u, v, tile.width / size.width, tile.height / size.height)
    drawQuad(gl, this.vao)
  }

  private ensureSourceTexture(source: TexImageSource, sourceSize: Size): void {
    const gl = this.glContext
    this.sourceSize = sourceSize
    const owner = objectKey(source)
    const key = `${sourceSize.width}x${sourceSize.height}`
    if (
      owner &&
      this.sourceOwner === owner &&
      this.sourceKey === key &&
      this.uploadedSources.has(owner)
    ) {
      return
    }
    if (this.sourceOwner) this.uploadedSources.delete(this.sourceOwner)
    if (this.sourceTexture) disposeTexture(gl, this.sourceTexture)
    // Mipmaps (D3-F22): the source is minified in the normal case — a 6000 px
    // photo into a 2048 px proxy — and a single bilinear tap of a minified
    // texture point-samples, which aliases badly.
    this.sourceTexture = createTexture(gl, source, {
      flipY: false,
      linear: true,
      clamp: true,
      mipmaps: true,
    })
    this.sourceOwner = owner
    this.sourceKey = key
    if (owner) this.uploadedSources.add(owner)
  }

  private drawPass(
    pass: Pass,
    input: WebGLTexture | null,
    target: Fbo | null,
    view: View,
    inputSize: Size,
    maskTexture?: WebGLTexture | null,
  ): void {
    const gl = this.glContext
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null)
    gl.viewport(0, 0, view.size.width, view.size.height)

    const program = this.programFor(pass)
    if (!program) return
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input)
    setInt(gl, program, 'u_tex', 0)
    setVec2(
      gl,
      program,
      'u_texel',
      1 / Math.max(1, inputSize.width),
      1 / Math.max(1, inputSize.height),
    )

    switch (pass.kind) {
      case 'geometry':
        setMat3(gl, program, 'u_matrix', pass.matrix)
        setVec2(gl, program, 'u_sourceSize', inputSize.width, inputSize.height)
        setVec2(gl, program, 'u_outputSize', view.size.width, view.size.height)
        setInt(gl, program, 'u_clamp', pass.clamp ? 1 : 0)
        setVec2(gl, program, 'u_origin', view.origin.x, view.origin.y)
        break
      case 'tone':
        setFloat(gl, program, 'u_exposure', pass.exposure)
        setFloat(gl, program, 'u_brightness', pass.brightness)
        setFloat(gl, program, 'u_contrast', pass.contrast)
        setFloat(gl, program, 'u_highlights', pass.highlights)
        setFloat(gl, program, 'u_shadows', pass.shadows)
        setFloat(gl, program, 'u_blackPoint', pass.blackPoint)
        setFloat(gl, program, 'u_brilliance', pass.brilliance)
        break
      case 'color':
        setFloat(gl, program, 'u_saturation', pass.saturation)
        setFloat(gl, program, 'u_vibrance', pass.vibrance)
        setFloat(gl, program, 'u_warmth', pass.warmth)
        setFloat(gl, program, 'u_tint', pass.tint)
        break
      case 'curves': {
        const textures = this.curvesFor(pass.curves)
        bindTexture(gl, program, 'u_lutRgb', textures.rgb, 1)
        bindTexture(gl, program, 'u_lutR', textures.r, 2)
        bindTexture(gl, program, 'u_lutG', textures.g, 3)
        bindTexture(gl, program, 'u_lutB', textures.b, 4)
        break
      }
      case 'hsl': {
        const bands = new Float32Array(24)
        const order = [
          'red',
          'orange',
          'yellow',
          'green',
          'aqua',
          'blue',
          'purple',
          'magenta',
        ] as const
        order.forEach((band, index) => {
          bands[index * 3] = pass.mix[band].hue
          bands[index * 3 + 1] = pass.mix[band].sat
          bands[index * 3 + 2] = pass.mix[band].lum
        })
        const location = gl.getUniformLocation(program, 'u_bands')
        if (location) gl.uniform3fv(location, bands)
        break
      }
      case 'lut3d': {
        const texture = this.lutTextures.get(pass.id)
        if (texture) bindTexture(gl, program, 'u_lut', texture, 1)
        setFloat(gl, program, 'u_amount', pass.amount)
        setFloat(gl, program, 'u_size', LUT_SIZE)
        break
      }
      case 'denoise':
        setFloat(gl, program, 'u_radius', 1 + pass.amount * 2)
        setFloat(gl, program, 'u_pixelScale', view.scale)
        break
      case 'sharpen':
        setFloat(gl, program, 'u_amount', pass.amount)
        setFloat(gl, program, 'u_radius', sharpenRadius(pass.amount))
        setFloat(gl, program, 'u_pixelScale', view.scale)
        break
      case 'definition':
        setFloat(gl, program, 'u_amount', pass.amount)
        setFloat(gl, program, 'u_radius', definitionRadius(pass.amount))
        setFloat(gl, program, 'u_pixelScale', view.scale)
        break
      case 'effects':
        setFloat(gl, program, 'u_grain', pass.grain)
        setFloat(gl, program, 'u_bloom', pass.bloom)
        setFloat(gl, program, 'u_fieldBlur', pass.fieldBlur)
        setFloat(gl, program, 'u_pixelScale', view.scale)
        setVec2(gl, program, 'u_origin', view.origin.x, view.origin.y)
        break
      case 'vignette':
        setFloat(gl, program, 'u_amount', pass.amount)
        break
      case 'local': {
        // Every key of LOCAL_ADJUST_KEYS is uploaded every time, including the
        // ones this adjust leaves at zero: a local adjust of contrast alone
        // still has to send u_exposure = 0, or it inherits the previous one.
        bindTexture(gl, program, 'u_maskTex', maskTexture ?? this.blackMask(), 1)
        for (const key of LOCAL_ADJUST_KEYS) {
          setFloat(gl, program, `u_${key}`, pass.values[key] ?? 0)
        }
        break
      }
      case 'retouch':
        setFloat(gl, program, 'u_smooth', pass.smooth)
        setFloat(gl, program, 'u_radius', smoothRadius(pass.smooth, view.scale))
        setFloat(gl, program, 'u_range', SMOOTH_RANGE)
        break
      case 'heal':
      case 'redeye':
        setVec2(gl, program, 'u_at', pass.at.x, pass.at.y)
        setFloat(gl, program, 'u_radius', pass.radius)
        setFloat(gl, program, 'u_squeeze', view.frame.height / Math.max(1, view.frame.width))
        setVec2(gl, program, 'u_origin', view.origin.x, view.origin.y)
        setVec2(gl, program, 'u_viewSize', view.size.width, view.size.height)
        setVec2(gl, program, 'u_frameSize', view.frame.width, view.frame.height)
        break
      case 'background': {
        const [r, g, b] = hexToRgb(pass.background.color)
        setVec3(gl, program, 'u_color', r, g, b)
        const from = hexToRgb(pass.background.gradient.from)
        const to = hexToRgb(pass.background.gradient.to)
        setVec3(gl, program, 'u_gradientFrom', from[0], from[1], from[2])
        setVec3(gl, program, 'u_gradientTo', to[0], to[1], to[2])
        setFloat(gl, program, 'u_angle', pass.background.gradient.angle)
        setInt(
          gl,
          program,
          'u_mode',
          pass.background.mode === 'gradient'
            ? 2
            : pass.background.mode === 'color'
              ? 1
              : pass.background.mode === 'image'
                ? BACKGROUND_MODE_IMAGE
                : 0,
        )
        setFloat(gl, program, 'u_keepAlpha', pass.keepAlpha ? 1 : 0)
        // `fit` and `blur` were declared in the model and read by nothing; a
        // background image with no matte still shows through nothing, so these
        // only change pixels once `BackgroundPanel` has cut the subject out.
        setInt(gl, program, 'u_fit', fitIndex(pass.background.fit))
        setFloat(gl, program, 'u_blur', pass.background.blur)
        setFloat(gl, program, 'u_blurRadius', pass.background.blur * 12)
        setFloat(gl, program, 'u_pixelScale', view.scale)
        setVec2(gl, program, 'u_frameSize', view.frame.width, view.frame.height)
        const image = this.backgroundImage(pass.background.imageAssetId)
        bindTexture(gl, program, 'u_bgImage', image.texture, 1)
        setVec2(gl, program, 'u_imageSize', image.width, image.height)
        break
      }
      case 'output': {
        const [r, g, b] = hexToRgb(pass.matte)
        setVec3(gl, program, 'u_matte', r, g, b)
        setInt(gl, program, 'u_flatten', pass.flatten ? 1 : 0)
        setFloat(gl, program, 'u_alpha', pass.alpha ? 1 : 0)
        // D3-F23. The dither is anchored to the whole frame, so a tiled render
        // has to say where this tile sits or the pattern restarts per tile.
        setFloat(gl, program, 'u_dither', pass.dither)
        setVec2(gl, program, 'u_origin', view.origin.x, view.origin.y)
        break
      }
      default:
        break
    }

    drawQuad(gl, this.vao)
  }

  /**
   * The `background.imageAssetId` bitmap as a texture, or a 1x1 white stand-in.
   * Cached on the asset id so a slider frame does not re-upload a large image.
   */
  private backgroundImage(assetId: AssetId | null): {
    texture: WebGLTexture
    width: number
    height: number
  } {
    if (!assetId) return { texture: this.whiteImage(), width: 1, height: 1 }
    const cached = this.backgroundTextures.get(assetId)
    if (cached) return { ...cached, ...this.backgroundImageSize(assetId) }
    const source = this.assets(assetId)
    if (!source) return { texture: this.whiteImage(), width: 1, height: 1 }
    const texture = createTexture(this.glContext, source, { linear: true, clamp: true })
    const size = this.backgroundImageSize(assetId)
    this.backgroundTextures.set(assetId, { texture, key: assetId })
    return { texture, ...size }
  }

  private backgroundImageSize(assetId: AssetId): Size {
    const source = this.assets(assetId)
    if (source && 'width' in source && 'height' in source) {
      const width = Number(source.width)
      const height = Number(source.height)
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height }
      }
    }
    return { width: 1, height: 1 }
  }

  private programFor(pass: Pass): WebGLProgram | null {
    switch (pass.kind) {
      case 'geometry':
        return this.programs.get('geometry', S.QUAD_VERT, S.GEOMETRY_FRAG)
      case 'tone':
        return this.programs.get('tone', S.QUAD_VERT, S.TONE_FRAG)
      case 'color':
        return this.programs.get('color', S.QUAD_VERT, S.COLOR_FRAG)
      case 'curves':
        return this.programs.get('curves', S.QUAD_VERT, S.CURVES_FRAG)
      case 'hsl':
        return this.programs.get('hsl', S.QUAD_VERT, S.HSL_FRAG)
      case 'lut3d':
        return this.programs.get('lut3d', S.QUAD_VERT, S.LUT3D_FRAG)
      case 'denoise':
        return this.programs.get('blur', S.QUAD_VERT, S.BLUR_FRAG)
      case 'definition':
        return this.programs.get('definition', S.QUAD_VERT, S.DEFINITION_FRAG)
      case 'sharpen':
        return this.programs.get('sharpen', S.QUAD_VERT, S.SHARPEN_FRAG)
      case 'effects':
        return this.programs.get('effects', S.QUAD_VERT, S.EFFECTS_FRAG)
      case 'vignette':
        return this.programs.get('vignette', S.QUAD_VERT, S.VIGNETTE_FRAG)
      case 'local':
        return this.programs.get('local', S.QUAD_VERT, S.LOCAL_FRAG)
      case 'retouch':
        return this.programs.get('retouch', S.QUAD_VERT, S.RETOUCH_FRAG)
      case 'heal':
        return this.programs.get('heal', S.QUAD_VERT, S.HEAL_FRAG)
      case 'redeye':
        return this.programs.get('redeye', S.QUAD_VERT, S.REDEYE_FRAG)
      case 'background':
        return this.programs.get('background', S.QUAD_VERT, S.BACKGROUND_FRAG)
      case 'output':
        return this.programs.get('output', S.QUAD_VERT, S.OUTPUT_FRAG)
      default:
        return null
    }
  }

  private curvesFor(curves: Curves): CurveTextures {
    const key = planHash([{ kind: 'curves', curves }])
    const existing = this.curveTextures.get(key)
    if (existing) return existing
    const gl = this.glContext
    const luts = buildChannelLuts(curves)
    const set = {
      rgb: createLutTexture(gl, luts.rgb),
      r: createLutTexture(gl, luts.r),
      g: createLutTexture(gl, luts.g),
      b: createLutTexture(gl, luts.b),
    }
    // Bound the cache so a long editing session cannot grow it without limit.
    if (this.curveTextures.size > 32) {
      const oldest = this.curveTextures.keys().next().value
      if (oldest) {
        const old = this.curveTextures.get(oldest)
        if (old) {
          disposeTexture(gl, old.rgb)
          disposeTexture(gl, old.r)
          disposeTexture(gl, old.g)
          disposeTexture(gl, old.b)
        }
        this.curveTextures.delete(oldest)
      }
    }
    this.curveTextures.set(key, set)
    return set
  }
}

const identities = new WeakMap<object, number>()
let nextIdentity = 1

function objectKey(source: TexImageSource): object | null {
  return typeof source === 'object' && source !== null ? (source as object) : null
}

function identityOf(source: TexImageSource): number {
  const key = objectKey(source)
  if (!key) return 0
  let id = identities.get(key)
  if (id === undefined) {
    nextIdentity += 1
    id = nextIdentity
    identities.set(key, id)
  }
  return id
}

function bindTexture(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  texture: WebGLTexture,
  unit: number,
): void {
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  const location = gl.getUniformLocation(program, name)
  if (location) gl.uniform1i(location, unit)
}

function setFloat(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  value: number,
): void {
  const location = gl.getUniformLocation(program, name)
  if (location) gl.uniform1f(location, value)
}

function setInt(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  value: number,
): void {
  const location = gl.getUniformLocation(program, name)
  if (location) gl.uniform1i(location, value)
}

function setVec2(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
): void {
  const location = gl.getUniformLocation(program, name)
  if (location) gl.uniform2f(location, x, y)
}

function setVec3(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
  z: number,
): void {
  const location = gl.getUniformLocation(program, name)
  if (location) gl.uniform3f(location, x, y, z)
}

function setVec4(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  const location = gl.getUniformLocation(program, name)
  if (location) gl.uniform4f(location, x, y, z, w)
}

function setMat3(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
  matrix: Mat3,
): void {
  const location = gl.getUniformLocation(program, name)
  // `Mat3` is row-major (geometry.ts) and the shader multiplies by a column
  // vector, so the array must be uploaded as row-major: transpose = true.
  // Uploading with transpose = false makes the driver read it column-major and
  // the GPU computes M^T * p, which silently discards crop, rotate, flip,
  // straighten and perspective.
  if (location) gl.uniformMatrix3fv(location, true, matrix)
}
