export type Fbo = {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
};

/**
 * Reuses render targets across frames so a 60fps preview loop does not
 * allocate and garbage-collect a framebuffer per pass per frame.
 */
export class FboPool {
  private readonly free: Fbo[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {}

  acquire(width: number, height: number): Fbo {
    const index = this.free.findIndex((fbo) => fbo.width === width && fbo.height === height);
    if (index !== -1) {
      const [fbo] = this.free.splice(index, 1);
      return fbo;
    }
    return this.create(width, height);
  }

  release(fbo: Fbo): void {
    this.free.push(fbo);
  }

  private create(width: number, height: number): Fbo {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Unable to allocate framebuffer');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture, width, height };
  }

  clear(): void {
    const gl = this.gl;
    for (const fbo of this.free) {
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.texture);
    }
    this.free.length = 0;
  }
}