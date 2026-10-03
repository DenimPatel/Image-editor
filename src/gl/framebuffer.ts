export type Fbo = {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
}

/**
 * `EXT_color_buffer_half_float` lets every intermediate pass carry more than
 * 8 bits per channel. Without it a 13-pass chain quantises to RGBA8 thirteen
 * times, which is where the banding in skies comes from.
 */
export type BufferFormat = 'rgba8' | 'rgba16f'

import { TEXTURE_SCRATCH_UNIT } from './texture'

export function resolveBufferFormat(halfFloat: boolean): BufferFormat {
  return halfFloat ? 'rgba16f' : 'rgba8'
}

/**
 * A framebuffer attachment is filled in on a scratch unit, never on whatever
 * unit the pass currently has bound - see `TEXTURE_SCRATCH_UNIT`.
 */
function bindTextureScratch(gl: WebGL2RenderingContext): void {
  gl.activeTexture(gl.TEXTURE0 + TEXTURE_SCRATCH_UNIT)
}

export type FboPoolOptions = {
  halfFloat?: boolean
}

/**
 * Reuses render targets across frames so a 60fps preview loop does not
 * allocate and garbage-collect a framebuffer per pass per frame.
 */
export class FboPool {
  private readonly free: Fbo[] = []
  private readonly format: BufferFormat

  constructor(
    private readonly gl: WebGL2RenderingContext,
    options: FboPoolOptions = {},
  ) {
    this.format = resolveBufferFormat(options.halfFloat === true)
  }

  get internalFormat(): BufferFormat {
    return this.format
  }

  acquire(width: number, height: number): Fbo {
    const index = this.free.findIndex((fbo) => fbo.width === width && fbo.height === height)
    if (index !== -1) {
      const [fbo] = this.free.splice(index, 1)
      return fbo
    }
    return this.create(width, height)
  }

  release(fbo: Fbo): void {
    this.free.push(fbo)
  }

  private create(width: number, height: number): Fbo {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new Error('Unable to allocate framebuffer')
    const halfFloat = this.format === 'rgba16f'
    const internalFormat = halfFloat ? gl.RGBA16F : gl.RGBA8
    // The type has to agree with the internal format. Passing HALF_FLOAT with
    // an RGBA8 attachment is rejected outright ("invalid combination of format,
    // type and internalFormat"), which leaves the framebuffer incomplete: every
    // draw is a GL error and the canvas stays black.
    const type = halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
    // The attachment is filled in on a scratch unit for the same reason the
    // texture factories do: binding to the active unit would overwrite whatever
    // the pass currently has bound there.
    bindTextureScratch(gl)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    return { framebuffer, texture, width, height }
  }

  clear(): void {
    const gl = this.gl
    for (const fbo of this.free) {
      gl.deleteFramebuffer(fbo.framebuffer)
      gl.deleteTexture(fbo.texture)
    }
    this.free.length = 0
  }
}

/**
 * Single-channel `R8` render targets, for a mask field.
 *
 * A mask is one 0..1 value per pixel, so an RGBA target would waste three
 * quarters of its bandwidth for nothing. `R8` is a required colour-renderable
 * format in WebGL2 core, so this needs no extension and no feature gate.
 */
export class SingleChannelPool {
  private readonly free: Fbo[] = []

  constructor(private readonly gl: WebGL2RenderingContext) {}

  acquire(width: number, height: number): Fbo {
    const index = this.free.findIndex((fbo) => fbo.width === width && fbo.height === height)
    if (index !== -1) {
      const [fbo] = this.free.splice(index, 1)
      return fbo
    }
    return this.create(width, height)
  }

  release(fbo: Fbo): void {
    this.free.push(fbo)
  }

  private create(width: number, height: number): Fbo {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) throw new Error('Unable to allocate mask target')
    bindTextureScratch(gl)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    return { framebuffer, texture, width, height }
  }

  clear(): void {
    const gl = this.gl
    for (const fbo of this.free) {
      gl.deleteFramebuffer(fbo.framebuffer)
      gl.deleteTexture(fbo.texture)
    }
    this.free.length = 0
  }
}
