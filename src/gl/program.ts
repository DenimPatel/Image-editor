export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Unable to create shader: ${label}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed (${label}): ${info ?? 'unknown'}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label}:vertex`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}:fragment`);
  const program = gl.createProgram();
  if (!program) throw new Error('Unable to create program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed (${label}): ${info ?? 'unknown'}`);
  }
  return program;
}

export class ProgramCache {
  private readonly cache = new Map<string, WebGLProgram>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  get(key: string, vertexSource: string, fragmentSource: string): WebGLProgram {
    const existing = this.cache.get(key);
    if (existing) return existing;
    const program = createProgram(this.gl, vertexSource, fragmentSource, key);
    this.cache.set(key, program);
    return program;
  }

  dispose(): void {
    for (const program of this.cache.values()) this.gl.deleteProgram(program);
    this.cache.clear();
  }
}
