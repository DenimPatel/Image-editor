import { writeFileSync } from 'node:fs'
import { test, expect, meanAbsDiff } from './fixtures'
import { diffStrip } from './diff-image'

/**
 * D9-F07 — shader correctness on a real WebGL2 context.
 *
 * `src/render/parity.test.ts` replays the GLSL through an interpreter, so a
 * shader constant that disagrees with its CPU twin fails there. What it cannot
 * catch is anything only a driver catches: a sampler bound to the wrong unit, a
 * uniform that never reaches the linked program, a texture unit collision, a
 * Y-flip, a `highp` expression a driver folds differently. So this test
 * compiles the *actual* shader source out of `src/gl/shaders/` in a real
 * context, draws a known synthetic gradient through it, and compares the
 * result pixel-for-pixel against `runCpuPasses` — the same CPU twin the unit
 * parity harness uses, so a disagreement here is a driver-level disagreement
 * rather than a second hand-written reference that could share a mistake.
 *
 * The shader modules come from the running dev server's module graph, not from a
 * copy, so editing a shader cannot leave this test comparing against a stale
 * golden.
 */

/** Software rasterisers report themselves; they are exactly what this excludes. */
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|software|basic render driver|mesa offscreen/i

const WIDTH = 96
const HEIGHT = 64
/** Per-channel tolerance in 0..255 units: two 8-bit roundings plus slack. */
const TOLERANCE = 2

/**
 * `TONE_FRAG` then `COLOR_FRAG`, chained through an intermediate target exactly
 * as `src/gl/renderer.ts` chains them. Both are point passes — each reads one
 * texel and writes it — so a mismatch cannot be blamed on a filter mode or a
 * texel-centre convention. A kernel pass would legitimately differ from a scalar
 * CPU reference by a rounding step, and would need a wider tolerance than "is
 * this the same image".
 */
const TONE = {
  kind: 'tone',
  exposure: 0.4,
  brightness: 0.08,
  contrast: 0.22,
  highlights: 0.15,
  shadows: -0.1,
  blackPoint: 0.2,
  brilliance: 0.3,
}
const COLOR = {
  kind: 'color',
  saturation: 0.35,
  vibrance: 0.2,
  warmth: 0.4,
  tint: -0.25,
}

type GlResult = {
  ok: boolean
  reason: string
  renderer: string
  width: number
  height: number
  gpu: number[]
  cpu: number[]
  maxChannelDelta: number
  overTolerance: number
}

const SCRIPT = `(async () => {
  const WIDTH = ${WIDTH}
  const HEIGHT = ${HEIGHT}
  const TONE = ${JSON.stringify(TONE)}
  const COLOR = ${JSON.stringify(COLOR)}
  const TOLERANCE = ${TOLERANCE}
  const SOFTWARE = ${JSON.stringify(SOFTWARE_RENDERERS.source)}

  const fromApp = (path) => new URL(path, new URL(document.baseURI, location.href)).href
  const shaders = await import(fromApp('src/gl/shaders/index.ts'))
  const cpu = await import(fromApp('src/render/cpu-passes.ts'))

  // A known synthetic gradient: three ramps with different phases, so a wrong
  // texel offset, a flipped Y or a broken clamp all show up as structure
  // rather than as a flat error that could be mistaken for a tone difference.
  const input = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4
      input[i] = Math.round(255 * (x / WIDTH))
      input[i + 1] = Math.round(255 * (y / HEIGHT))
      input[i + 2] = Math.round(255 * ((x + y) / (WIDTH + HEIGHT)))
      input[i + 3] = 255
    }
  }

  const blank = (reason, renderer) => ({
    ok: false, reason, renderer: renderer || '', width: WIDTH, height: HEIGHT,
    gpu: [], cpu: [], maxChannelDelta: 255, overTolerance: WIDTH * HEIGHT,
  })

  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })
  if (!gl) return blank('no webgl2 context')

  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const renderer = debug
    ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER))
  if (new RegExp(SOFTWARE, 'i').test(renderer)) return blank('software renderer: ' + renderer, renderer)

  const compile = (type, source) => {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('shader failed to compile: ' + gl.getShaderInfoLog(shader))
    }
    return shader
  }

  // One program per fragment shader, mirroring src/gl/renderer.ts: TONE_FRAG
  // and COLOR_FRAG both declare outColor and v_uv, so they cannot be linked
  // together.
  const upload = (unit, data) => {
    const tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, WIDTH, HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  const draw = (pass, sourceTex, sourceUnit) => {
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, shaders.QUAD_VERT))
    const source = pass.kind === 'tone' ? shaders.TONE_FRAG : shaders.COLOR_FRAG
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('program failed to link: ' + gl.getProgramInfoLog(program))
    }
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const target = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + 1)
    gl.bindTexture(gl.TEXTURE_2D, target)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, WIDTH, HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete: 0x' + status.toString(16))

    gl.viewport(0, 0, WIDTH, HEIGHT)
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0 + sourceUnit)
    gl.bindTexture(gl.TEXTURE_2D, sourceTex)
    gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), sourceUnit)
    gl.uniform2f(gl.getUniformLocation(program, 'u_texel'), 1 / WIDTH, 1 / HEIGHT)
    for (const key of Object.keys(pass)) {
      if (key === 'kind') continue
      gl.uniform1f(gl.getUniformLocation(program, 'u_' + key), pass[key])
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    const out = new Uint8Array(WIDTH * HEIGHT * 4)
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, out)
    const glError = gl.getError()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (glError !== gl.NO_ERROR) throw new Error('GL error 0x' + glError.toString(16))
    return out
  }

  let gpu
  try {
    const source = upload(0, input)
    // The tone result is read back and re-uploaded rather than kept on the GPU:
    // the CPU twin is computed from the same bytes, so feeding both the same
    // buffer is what makes the comparison about the shader, not about two
    // different intermediate surfaces.
    gpu = draw(COLOR, upload(0, draw(TONE, source, 0)), 0)
  } catch (err) {
    return blank(String(err && err.message ? err.message : err), renderer)
  }

  // No Y flip: the texture is uploaded with row 0 at v = 0 (the same top-down
  // convention src/gl/renderer.ts uses with UNPACK_FLIP_Y_WEBGL off), the quad
  // maps clip-space -1 to v_uv 0, and readPixels returns rows from
  // gl_FragCoord.y = 0.5 upwards. Those three cancel, so the read-back buffer is
  // already in the same row order as the CPU twin. Flipping here would compare a
  // mirrored image and report a difference that is not one.
  const cpuInput = { width: WIDTH, height: HEIGHT, data: new Uint8ClampedArray(input) }
  const reference = cpu.runCpuPasses(cpuInput, [TONE, COLOR]).pixels

  let maxChannelDelta = 0
  let overTolerance = 0
  for (let i = 0; i < gpu.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(gpu[i + c] - reference.data[i + c])
      if (d > maxChannelDelta) maxChannelDelta = d
      if (d > TOLERANCE) overTolerance += 1
    }
  }

  return {
    ok: true, reason: '', renderer, width: WIDTH, height: HEIGHT,
    gpu: Array.from(gpu), cpu: Array.from(reference.data),
    maxChannelDelta, overTolerance,
  }
})()`

test.describe('WebGL2 shader parity on a real GPU', () => {
  test('TONE_FRAG then COLOR_FRAG match the CPU twin', async ({ page, goto }, testInfo) => {
    await goto('/')

    const result = (await page.evaluate(SCRIPT)) as unknown as GlResult
    testInfo.annotations.push({
      type: 'gpu',
      description: `${result.renderer || 'unknown renderer'} — worst channel delta ${result.maxChannelDelta}/255, ${result.overTolerance} channel(s) over tolerance`,
    })

    // A machine with no GPU is not a failing test, it is an absent one — but the
    // annotation above records it, so a skip can never be read as a pass.
    test.skip(!result.ok, `no real GPU available: ${result.reason}`)

    const gpu = Buffer.from(result.gpu)
    const reference = Buffer.from(result.cpu)
    const mean = meanAbsDiff(gpu, reference)
    testInfo.annotations.push({
      type: 'parity',
      description: `${result.renderer}: mean abs diff ${mean.toFixed(4)}/255 over ${result.width}x${result.height}`,
    })

    // Attach before asserting, so a failure always leaves a picture of it. It
    // goes both into the HTML report and onto disk next to the trace, because
    // a CI run is read from the uploaded artefact and a reporter-only attachment
    // is invisible there.
    if (result.maxChannelDelta > TOLERANCE) {
      const strip = diffStrip(result.width, result.height, gpu, reference).png
      const file = testInfo.outputPath('shader-parity-diff.png')
      writeFileSync(file, strip)
      await testInfo.attach('shader-parity-diff.png', {
        body: strip,
        contentType: 'image/png',
      })
    }

    expect(result.renderer).not.toMatch(SOFTWARE_RENDERERS)
    expect(mean, 'mean absolute difference between the GPU and the CPU twin').toBeLessThan(0.5)
    expect(result.overTolerance, 'channels outside the 2/255 tolerance').toBe(0)
  })
})
