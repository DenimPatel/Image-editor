/**
 * The Canvas2D backend.
 *
 * It runs the *same* pass list as the GL pipeline through `runCpuPasses`, so
 * the two engines produce the same pixels rather than the same intent: tone,
 * colour, curves, HSL, denoise, definition, sharpen, field blur, bloom, grain,
 * vignette, the background pass and the output matte all run here. Geometry is
 * a projective resample through `projectiveResample`, because a Canvas2D
 * `setTransform` takes six scalars and silently drops the projective terms —
 * perspective is structurally impossible through it.
 *
 * What this backend genuinely cannot do is declared in `CANVAS2D_SUPPORT`
 * (`src/gl/caps.ts`). A family marked false is *gated*: it is skipped and named
 * in `degraded`, so the caller can tell the user the render is incomplete
 * instead of exporting a file that silently lost every colour edit.
 */
import { assetStore } from '../model/assetsSingleton'
import type { AssetId } from '../model/types'
import { CANVAS2D_SUPPORT, type PassSupport } from '../gl/caps'
import { computeOutputToSource } from '../gl/geometry'
import { pixelScale } from '../gl/pixel-scale'
import { planPasses, withLeadingGeometry, type PassFamily } from '../gl/passes'
import type { RenderBackend, RenderRequest } from './backend'
import {
  leadingGeometryClamp,
  makePixels,
  projectiveResample,
  runCpuPasses,
  type Pixels,
} from './cpu-passes'

/**
 * Read a `TexImageSource` into a straight-alpha (non-premultiplied) buffer.
 *
 * The scratch surface has to be able to hold `size` in *both* dimensions, so it
 * is grown rather than assumed: the renderer's own canvas is the output size,
 * and drawing a larger source into it silently clips — `getImageData` past the
 * canvas edge is transparent black, not an error, so a downscale read a
 * mostly-empty buffer and the whole frame came out blank. That is why this
 * takes a scratch canvas rather than a context, and why `ensureScratch` widens
 * both axes.
 */
function readSourcePixels(
  scratch: HTMLCanvasElement,
  source: TexImageSource,
  size: { width: number; height: number },
): Pixels {
  if (scratch.width < size.width || scratch.height < size.height) {
    scratch.width = Math.max(scratch.width, size.width)
    scratch.height = Math.max(scratch.height, size.height)
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas2D unavailable')
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.drawImage(source as CanvasImageSource, 0, 0, size.width, size.height)
  const image = ctx.getImageData(0, 0, size.width, size.height)
  ctx.restore()
  const out = makePixels(size.width, size.height)
  out.data.set(image.data.subarray(0, out.data.length))
  return out
}

export class Canvas2dRenderer implements RenderBackend {
  readonly kind = 'canvas2d' as const
  readonly canvas: HTMLCanvasElement

  private readonly ctx: CanvasRenderingContext2D
  /**
   * Off-frame surface the source and the background image are decoded through.
   * Separate from `canvas` because that one is the *output* size, and reading a
   * source that is larger than the output into it clips.
   */
  private readonly scratch: HTMLCanvasElement
  private readonly support: PassSupport
  private readonly assets: (id: AssetId) => TexImageSource | undefined
  /** Decoded background image, by asset id, so a slider frame is not a re-decode. */
  private backgroundImage: Pixels | null = null
  private backgroundKey = ''
  private lastDegraded: PassFamily[] = []
  private lastSize = ''
  private lastHash = ''
  private lastSource: TexImageSource | null = null

  constructor(
    canvas: HTMLCanvasElement = document.createElement('canvas'),
    support: PassSupport = CANVAS2D_SUPPORT,
    assets: (id: AssetId) => TexImageSource | undefined = (id) => assetStore.get(id),
  ) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas2D unavailable')
    this.ctx = ctx
    this.scratch = document.createElement('canvas')
    this.support = support
    this.assets = assets
  }

  /**
   * The `background.imageAssetId` bitmap as a byte buffer. The GL backend
   * uploads it as a texture and reads it back in the shader; there is no
   * texture here, so `fit` and `blur` need the pixels, and they are decoded
   * once per asset rather than per frame.
   */
  private backgroundPixels(id: AssetId | null): Pixels | null {
    if (!id) return null
    if (this.backgroundKey === id && this.backgroundImage) return this.backgroundImage
    const source = this.assets(id)
    if (!source) return null
    const size = this.backgroundSize(source)
    this.backgroundImage = readSourcePixels(this.scratch, source, size)
    this.backgroundKey = id
    return this.backgroundImage
  }

  private backgroundSize(source: TexImageSource): { width: number; height: number } {
    if ('width' in source && 'height' in source) {
      const width = Number(source.width)
      const height = Number(source.height)
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height }
      }
    }
    return { width: 1, height: 1 }
  }

  /**
   * Pass families the last render could not run. Empty means the frame is the
   * same on both engines. Anything in here is a real difference the user has to
   * be told about (D3-F10).
   */
  get degraded(): PassFamily[] {
    return this.lastDegraded
  }

  async prepare(): Promise<void> {
    // No LUT texture to warm: a 3D LUT is gated on this backend.
  }

  render(request: RenderRequest): void {
    const { doc, size, source, sourceSize } = request
    const matrix = computeOutputToSource(doc, sourceSize, size)
    const planned = withLeadingGeometry(planPasses(doc, size, matrix), matrix)
    // A family this backend cannot run is dropped here, not approximated, and
    // named in `degraded` so the caller can say the frame is incomplete.
    const gated: PassFamily[] = []
    const passes = planned.filter((pass) => {
      const family = pass.kind as PassFamily
      if (this.support[family] === false) {
        if (!gated.includes(family)) gated.push(family)
        return false
      }
      return true
    })

    const hash = `${docPassKey(doc)}|${size.width}x${size.height}|${source === this.lastSource ? 'same' : 'new'}`
    if (hash === this.lastHash) return
    this.lastHash = hash
    this.lastSource = source

    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width
      this.canvas.height = size.height
    }

    const read = readSourcePixels(this.scratch, source, sourceSize)
    const geometry = projectiveResample(
      read,
      matrix,
      size.width,
      size.height,
      sourceSize,
      leadingGeometryClamp(passes),
    )
    const { pixels, gated: cpuGated } = runCpuPasses(geometry, passes, {
      pixelScale: pixelScale(size),
      frame: size,
      backgroundImage: this.backgroundPixels(doc.background.imageAssetId) ?? undefined,
    })
    for (const family of cpuGated) if (!gated.includes(family)) gated.push(family)
    this.lastDegraded = gated
    this.lastSize = `${size.width}x${size.height}`

    // `createImageData` rather than `new ImageData(...)`: it is part of the 2D
    // context, so the buffer comes from the same canvas the rest of the frame
    // is written to.
    const image = this.ctx.createImageData(pixels.width, pixels.height)
    image.data.set(pixels.data)
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.putImageData(image, 0, 0)
  }

  /** Size of the last frame, for the caller's diagnostics. */
  get renderedSize(): string {
    return this.lastSize
  }

  dispose(): void {
    this.lastHash = ''
    this.lastSource = null
    this.lastDegraded = []
    this.backgroundImage = null
    this.backgroundKey = ''
  }
}

/**
 * Change key for the Canvas2D path. `planHash` needs the planned pass list, and
 * planning it needs the size, so this is the cheap version: it is only used to
 * skip a frame that cannot have changed, never to describe the render.
 */
function docPassKey(doc: Parameters<typeof planPasses>[0]): string {
  return JSON.stringify([
    doc.adjust,
    doc.curves,
    doc.hsl,
    doc.look,
    doc.effects,
    doc.geometry,
    doc.background,
    doc.masks,
    doc.localAdjusts,
    doc.retouch,
    doc.output.matte,
    doc.output.format,
  ])
}
