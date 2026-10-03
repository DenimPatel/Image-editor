/**
 * A minimal but honest WebGL2 test double.
 *
 * "Honest" means three things that matter for the tests using it:
 *  - `getUniformLocation` parses the uniform declarations out of the source
 *    handed to `shaderSource` and returns `null` for anything else. Writing a
 *    uniform the program does not declare is therefore a silent no-op, exactly
 *    as on a real driver, so a missing `setFloat` shows up as a missing uniform
 *    instead of being papered over.
 *  - `uniformMatrix3fv` records the `transpose` flag *and* the raw array, and
 *    `decodeMat3` reconstructs the matrix the way the driver does.
 *  - Everything is recorded in call order: programs linked, uniforms written,
 *    draws issued, textures uploaded.
 */
import type { Mat3 } from './geometry'

export type UniformCall =
  | { program: string; name: string; type: 'float'; value: number }
  | { program: string; name: string; type: 'int'; value: number }
  | { program: string; name: string; type: 'vec2'; value: [number, number] }
  | { program: string; name: string; type: 'vec3'; value: [number, number, number] }
  | { program: string; name: string; type: 'vec3[]'; value: number[] }
  | { program: string; name: string; type: 'vec4'; value: [number, number, number, number] }
  | { program: string; name: string; type: 'mat3'; transpose: boolean; value: number[] }

export type Mat3Call = Extract<UniformCall, { type: 'mat3' }>

/** Everything needed to replay one draw on the CPU. */
export type DrawFrame = {
  program: string
  fragmentSource: string
  uniforms: UniformCall[]
}

const UNIFORM_DECL = /uniform\s+\w+\s+(\w+)\s*(?:\[\s*\d+\s*\])?\s*;/g

export function declaredUniforms(fragmentSource: string): string[] {
  const names: string[] = []
  for (const match of fragmentSource.matchAll(UNIFORM_DECL)) {
    if (match[1]) names.push(match[1])
  }
  return [...new Set(names)]
}

/**
 * Reconstruct the `mat3` the driver ends up with, in the row-major `Mat3`
 * convention of `src/gl/geometry.ts`.
 *
 * `uniformMatrix3fv` fills the *same* destination matrix either way; only the
 * layout of `value` changes. `transpose = false` means the nine floats are
 * column-major, so `value[col * 3 + row]` is matrix element `[row][col]`,
 * which is `transpose(value)` in `Mat3` terms. `transpose = true` means
 * row-major, so the array is the matrix as-is.
 */
export function decodeMat3(call: Mat3Call): Mat3 {
  const out = new Array(9) as Mat3
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] = call.transpose ? call.value[row * 3 + col]! : call.value[col * 3 + row]!
    }
  }
  return out
}

type FakeProgram = { label: string; uniforms: Set<string>; fragmentSource: string }
type FakeLocation = { program: FakeProgram; name: string }

const programCache = new WeakMap<object, FakeProgram>()

export class FakeGl2 {
  readonly uniforms: UniformCall[] = []
  readonly draws: string[] = []
  readonly programs: FakeProgram[] = []
  readonly textureUploads: number[] = []
  /** Names looked up that the linked program does not declare; a real driver
   *  drops those too, so this is how renderer/shader drift shows up. */
  readonly locationMisses: string[] = []
  /**
   * One entry per `drawArrays`: the fragment source that was linked and every
   * uniform written since the previous draw. That is enough to replay the
   * frame on the CPU, which is what the backend parity test does — it compares
   * the *real* shader against the *real* bound values, not against a hand copy.
   */
  readonly drawFrames: DrawFrame[] = []

  private current: FakeProgram | null = null
  private pending: UniformCall[] = []

  readonly VERTEX_SHADER = 0x8b31
  readonly FRAGMENT_SHADER = 0x8b30
  readonly COMPILE_STATUS = 0x8b81
  readonly LINK_STATUS = 0x8b82
  readonly ARRAY_BUFFER = 0x8892
  readonly STATIC_DRAW = 0x88e4
  readonly FLOAT = 0x1406
  readonly TRIANGLES = 0x0004
  readonly TEXTURE_2D = 0x0de1
  readonly TEXTURE0 = 0x84c0
  readonly TEXTURE_MIN_FILTER = 0x2801
  readonly TEXTURE_MAG_FILTER = 0x2800
  readonly TEXTURE_WRAP_S = 0x2802
  readonly TEXTURE_WRAP_T = 0x2803
  readonly NEAREST = 0x2600
  readonly LINEAR = 0x2601
  readonly NEAREST_MIPMAP_NEAREST = 0x2700
  readonly LINEAR_MIPMAP_LINEAR = 0x2703
  readonly CLAMP_TO_EDGE = 0x812f
  readonly REPEAT = 0x2901
  readonly RGBA = 0x1908
  readonly RGBA8 = 0x8058
  readonly RGBA16F = 0x881a
  readonly HALF_FLOAT = 0x140b
  readonly UNSIGNED_BYTE = 0x1401
  readonly R8 = 0x8229
  readonly RED = 0x1903
  readonly FRAMEBUFFER = 0x8d40
  readonly COLOR_ATTACHMENT0 = 0x8ce0
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241
  readonly UNPACK_ALIGNMENT = 0x0cf5

  // --- shaders and programs -------------------------------------------------

  createShader(type: number): object {
    return { type, source: '' }
  }

  shaderSource(shader: object, source: string): void {
    const target = shader as { source: string }
    target.source = source
  }

  compileShader(): void {}

  getShaderParameter(): boolean {
    return true
  }

  getShaderInfoLog(): string | null {
    return ''
  }

  deleteShader(): void {}

  createProgram(): object {
    return { fragment: '' }
  }

  attachShader(program: object, shader: object): void {
    const holder = program as { uniforms?: Set<string>; fragment?: string }
    if ((shader as { type: number }).type !== this.FRAGMENT_SHADER) return
    const uniforms = holder.uniforms ?? new Set<string>()
    for (const name of declaredUniforms((shader as { source: string }).source)) uniforms.add(name)
    holder.uniforms = uniforms
    holder.fragment = (shader as { source: string }).source
  }

  linkProgram(program: object): void {
    const holder = program as { uniforms?: Set<string>; fragment?: string }
    const fake: FakeProgram = {
      label: `p${this.programs.length}`,
      uniforms: holder.uniforms ?? new Set<string>(),
      fragmentSource: holder.fragment ?? '',
    }
    this.programs.push(fake)
    programCache.set(program, fake)
  }

  getProgramParameter(): boolean {
    return true
  }

  getProgramInfoLog(): string | null {
    return ''
  }

  /**
   * Programs passed to `deleteProgram`, in call order.
   *
   * A fake cannot tell whether a program belongs to *this* context, so this is
   * the only handle a test has on the one thing a real driver is strict about:
   * a restored context is a different context, and deleting a program that
   * belonged to the lost one through it raises
   * `GL_INVALID_OPERATION: delete: object does not belong to this context`.
   */
  readonly deletedPrograms: FakeProgram[] = []

  deleteProgram(program: object): void {
    const fake = programCache.get(program)
    if (fake) this.deletedPrograms.push(fake)
  }

  useProgram(program: object | null): void {
    this.current = program ? (programCache.get(program) ?? null) : null
  }

  getUniformLocation(program: object, name: string): object | null {
    const fake = programCache.get(program)
    if (!fake || !fake.uniforms.has(name)) {
      this.locationMisses.push(name)
      return null
    }
    const location: FakeLocation = { program: fake, name }
    return location
  }

  // --- uniforms -------------------------------------------------------------

  uniform1f(location: object, value: number): void {
    this.push(location, { type: 'float', value })
  }

  uniform1i(location: object, value: number): void {
    this.push(location, { type: 'int', value })
  }

  uniform2f(location: object, x: number, y: number): void {
    this.push(location, { type: 'vec2', value: [x, y] })
  }

  uniform3f(location: object, x: number, y: number, z: number): void {
    this.push(location, { type: 'vec3', value: [x, y, z] })
  }

  uniform3fv(location: object, value: Float32Array): void {
    this.push(location, { type: 'vec3[]', value: Array.from(value) })
  }

  uniform4f(location: object, x: number, y: number, z: number, w: number): void {
    this.push(location, { type: 'vec4', value: [x, y, z, w] })
  }

  uniformMatrix3fv(location: object, transpose: boolean, value: number[] | Float32Array): void {
    this.push(location, { type: 'mat3', transpose, value: Array.from(value) })
  }

  private push(location: object, rest: Record<string, unknown>): void {
    const { program, name } = location as FakeLocation
    const call = { program: program.label, name, ...rest } as UniformCall
    this.uniforms.push(call)
    this.pending.push(call)
  }

  // --- geometry, textures, framebuffers -------------------------------------

  drawArrays(): void {
    const program = this.current
    this.draws.push(program?.label ?? 'none')
    this.drawFrames.push({
      program: program?.label ?? '',
      fragmentSource: program?.fragmentSource ?? '',
      uniforms: this.pending,
    })
    this.pending = []
  }

  createVertexArray(): object {
    return {}
  }

  createBuffer(): object {
    return {}
  }

  bindVertexArray(): void {}

  bindBuffer(): void {}

  bufferData(): void {}

  enableVertexAttribArray(): void {}

  vertexAttribPointer(): void {}

  createTexture(): object {
    return {}
  }

  bindTexture(): void {}

  activeTexture(): void {}

  pixelStorei(): void {}

  texParameteri(): void {}

  /**
   * Recorded by argument count: a 6-argument call is a `TexImageSource` upload
   * (the source bitmap), a 9-argument call is a sized or array upload (an FBO
   * or a curve LUT). `sourceUploads` is what a "the same bitmap must not be
   * re-decoded every frame" assertion needs.
   */
  texImage2D(...args: unknown[]): void {
    this.textureUploads.push(args.length)
    if (args.length === 9) {
      this.sizedUploads.push(args)
      const width = args[3]
      const height = args[4]
      if (typeof width === 'number' && typeof height === 'number')
        this.fboSizes.push([width, height])
    }
  }

  /** Number of `texImage2D` calls that carried a bitmap or canvas. */
  get sourceUploads(): number {
    return this.textureUploads.filter((argc) => argc === 6).length
  }

  deleteTexture(): void {}

  createFramebuffer(): object {
    return {}
  }

  bindFramebuffer(): void {}

  framebufferTexture2D(): void {}

  deleteFramebuffer(): void {}

  generateMipmap(): void {
    this.mipmapRequests += 1
  }

  /** Every render target the pool ever created, as `[width, height]`. */
  readonly fboSizes: [number, number][] = []
  /** The full `texImage2D` argument list of every sized upload, in order. */
  readonly sizedUploads: unknown[][] = []
  mipmapRequests = 0

  /** Every `viewport` call, so a tiled render can be told from a single one. */
  viewports: [number, number, number, number][] = []

  viewport(x: number, y: number, width: number, height: number): void {
    this.viewports.push([x, y, width, height])
  }

  /**
   * `loseContext` is not a no-op in the double: a real call evicts the context
   * from the browser's pool, which is exactly the failure D3-F06 is about.
   */
  loseContextCalls = 0

  getExtension(name: string): { loseContext(): void } | null {
    return name === 'WEBGL_lose_context'
      ? {
          loseContext: () => {
            this.loseContextCalls += 1
          },
        }
      : null
  }

  // --- queries --------------------------------------------------------------

  /** Every uniform written for `name`, in call order. */
  callsFor(name: string): UniformCall[] {
    return this.uniforms.filter((call) => call.name === name)
  }

  /** The last value written for `name`, or `undefined` if it was never set. */
  lastScalar(name: string): number | undefined {
    for (let i = this.uniforms.length - 1; i >= 0; i -= 1) {
      const call = this.uniforms[i]!
      if (call.name === name && (call.type === 'float' || call.type === 'int')) return call.value
    }
    return undefined
  }

  /** Sorted uniform names of a linked program, for "which program was that". */
  programSignature(label: string): string {
    const program = this.programs.find((candidate) => candidate.label === label)
    return program ? [...program.uniforms].sort().join(',') : ''
  }

  /** The fragment source a linked program was compiled from. */
  programSource(label: string): string {
    return this.programs.find((candidate) => candidate.label === label)?.fragmentSource ?? ''
  }

  /**
   * Uniforms a linked program declares but never received a value for. A dead
   * uniform is exactly the shape of the D3-F15 / D3-F19 bugs, and it is
   * invisible without this query.
   */
  unboundUniforms(): { program: string; missing: string[] }[] {
    return this.programs
      .map((program) => ({
        program: program.label,
        missing: [...program.uniforms]
          .filter(
            (name) =>
              !this.uniforms.some((call) => call.program === program.label && call.name === name),
          )
          .sort(),
      }))
      .filter((entry) => entry.missing.length > 0)
  }

  reset(): void {
    this.uniforms.length = 0
    this.draws.length = 0
    this.textureUploads.length = 0
    this.locationMisses.length = 0
    this.viewports.length = 0
    this.drawFrames.length = 0
    this.fboSizes.length = 0
    this.sizedUploads.length = 0
    this.mipmapRequests = 0
    this.loseContextCalls = 0
    this.pending = []
  }
}

export type FakeGlHarness = {
  gl: FakeGl2
  /** Anything the renderer needs to pass as `source`. */
  source: HTMLCanvasElement
  restore: () => void
}

export function installFakeGl2(): FakeGlHarness {
  const gl = new FakeGl2()
  const original = HTMLCanvasElement.prototype.getContext
  // Delegates, so a 2D double installed underneath still answers `2d`.
  HTMLCanvasElement.prototype.getContext = function patched(this: HTMLCanvasElement, id: string) {
    if (id === 'webgl2') return gl as unknown as WebGL2RenderingContext
    return (original as unknown as (k: string) => unknown).call(this, id)
  } as unknown as HTMLCanvasElement['getContext']
  return {
    gl,
    source: document.createElement('canvas'),
    restore: () => {
      HTMLCanvasElement.prototype.getContext = original
    },
  }
}

export function withFakeGl2<T>(run: (harness: FakeGlHarness) => T): T {
  const harness = installFakeGl2()
  try {
    return run(harness)
  } finally {
    harness.restore()
  }
}
