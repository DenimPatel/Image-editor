export type TextureOptions = {
  flipY?: boolean
  linear?: boolean
  clamp?: boolean
  /**
   * Build a mip chain. The source bitmap is minified in the normal case — a
   * 6000 px photo into a 2048 px proxy — and a single bilinear tap of a
   * minified texture point-samples, which aliases badly. NPOT mipmaps are core
   * in WebGL2, so there is no reason to leave this off for the source.
   */
  mipmaps?: boolean
}

/**
 * The unit a texture factory binds to while it fills the object in.
 *
 * `texImage2D` and `texParameteri` operate on whatever is bound to the *active*
 * unit, so a factory has to bind something. Binding to whatever unit happened to
 * be active is the trap: `drawPass` binds `u_tex` on unit 0 and *then* asks for a
 * curve LUT, a background image or the 1x1 white placeholder, and the factory
 * overwrites unit 0 with its own object. The pass then samples the placeholder
 * instead of its input, which is why a document with a background pass rendered
 * as a flat colour and why a cut-out frame came out fully opaque.
 *
 * Nothing in the pass chain uses this unit — `u_tex` is 0, curves take 1..4, the
 * LUT and the background image take 1 — so binding here cannot clobber a live
 * binding, and `bindTexture` always sets the unit explicitly afterwards.
 */
export const TEXTURE_SCRATCH_UNIT = 7

function bindScratch(gl: WebGL2RenderingContext): void {
  gl.activeTexture(gl.TEXTURE0 + TEXTURE_SCRATCH_UNIT)
}

export function createTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource,
  options: TextureOptions = {},
): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to create texture')
  bindScratch(gl)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, options.flipY ?? false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  const nearest = options.linear === false
  const mipmaps = options.mipmaps === true
  if (mipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      nearest ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR,
    )
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR)
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR)
  const wrap = options.clamp === false ? gl.REPEAT : gl.CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
  return texture
}

/**
 * A single-texel `RGBA8` texture of `rgba` (0..255 each), `size` square.
 *
 * There is no `TexImageSource` for "one white pixel": the DOM overloads accept an
 * `ImageBitmap`, a canvas, an image element or raw video, and a `{width, height,
 * data}` object is none of them - `texImage2D` fails overload resolution on it
 * and throws, taking the whole pass chain with it. A solid placeholder has to go
 * through the `ArrayBufferView` overload, which is what this is.
 */
export function createSolidTexture(
  gl: WebGL2RenderingContext,
  rgba: readonly [number, number, number, number],
  size = 1,
): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to create texture')
  bindScratch(gl)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    size,
    size,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(rgba),
  )
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

/** 256x1 red-channel texture from a curve LUT. */
export function createLutTexture(gl: WebGL2RenderingContext, lut: Uint8Array): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to create LUT texture')
  bindScratch(gl)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, lut)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  return texture
}

/** Single-channel `R8` texture from a 0..255 field, one byte per pixel. */
export function createFieldTexture(
  gl: WebGL2RenderingContext,
  field: Uint8Array,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to create texture')
  bindScratch(gl)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, field)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  return texture
}

export function disposeTexture(gl: WebGL2RenderingContext, texture: WebGLTexture | null): void {
  if (texture) gl.deleteTexture(texture)
}
