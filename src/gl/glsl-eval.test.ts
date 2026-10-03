import { describe, expect, it } from 'vitest'
import { filmicShoulder } from '../lib/tonemap'
import { compileFragment, runFragment, type GlslSampler } from './glsl-eval'
import * as SHADERS from './shaders/index'
import {
  BLUR_FRAG,
  EFFECTS_FRAG,
  GEOMETRY_FRAG,
  HSL_FRAG,
  SHARPEN_FRAG,
  TONE_FRAG,
} from './shaders/index'

function flatSampler(rgba: [number, number, number, number]): GlslSampler {
  return () => rgba
}

describe('glsl-eval', () => {
  it('evaluates arithmetic, builtins and swizzles', () => {
    const shader = compileFragment(`
      precision highp float;
      in vec2 v_uv;
      out vec4 outColor;
      void main() {
        vec3 c = vec3(0.25, 0.5, 0.75);
        float s = smoothstep(0.0, 1.0, 0.5);
        outColor = vec4(c.b + s, mix(c.r, c.g, 0.5), max(c.g, 0.1), length(c));
      }
    `)
    const out = runFragment(shader, { fragCoord: [0.5, 0.5], vUv: [0.5, 0.5] })
    expect(out[0]).toBeCloseTo(1.25, 12)
    expect(out[1]).toBeCloseTo(0.375, 12)
    expect(out[2]).toBeCloseTo(0.5, 12)
    expect(out[3]).toBeCloseTo(Math.hypot(0.25, 0.5, 0.75), 12)
  })

  it('runs a for loop and accumulates like a GPU would', () => {
    const shader = compileFragment(`
      precision highp float;
      in vec2 v_uv;
      out vec4 outColor;
      void main() {
        vec4 sum = vec4(0.0);
        float total = 0.0;
        for (int i = 0; i < 4; i++) {
          float fi = float(i + 1);
          sum += vec4(fi) * fi;
          total += fi;
        }
        outColor = sum / total;
      }
    `)
    const out = runFragment(shader, { fragCoord: [0, 0], vUv: [0, 0] })
    expect(out[0]).toBeCloseTo(30 / 10, 12)
  })

  it('evaluates the real TONE_FRAG on one pixel', () => {
    const shader = compileFragment(TONE_FRAG)
    const tone = (exposure: number) =>
      runFragment(shader, {
        fragCoord: [0.5, 0.5],
        vUv: [0.5, 0.5],
        samplers: { u_tex: flatSampler([0.5, 0.5, 0.5, 1]) },
        uniforms: {
          u_texel: [1 / 32, 1 / 32],
          u_exposure: exposure,
          u_brightness: 0,
          u_contrast: 0,
          u_highlights: 0,
          u_shadows: 0,
          u_blackPoint: 0,
          u_brilliance: 0,
        },
      })
    // +1 EV on a mid grey is a pixel of exactly 1.0, and it has to come out of
    // the tone stage still 1.0. It used to be 0.9485 — the shoulder's knee sat
    // at 0.86, so the exponential arrived at its own asymptote below 1 and a
    // white pixel left the pass at 242/255. This assertion is the regression
    // that bug would fail: the same claim in the pass itself, in the pipeline's
    // own units, at the pixel the clamp would have rescued.
    expect(tone(1)[0]).toBe(1)
    expect(tone(1)[0]).toBe(filmicShoulder(1))
    // 1.05 and 4.0 used to be the same pixel; the shoulder is what keeps them
    // apart, and `shoulder in the shipped GLSL` asserts the separation itself,
    // because the clamp on the last line of TONE_FRAG hides it here.
    expect(tone(4)[0]).toBeGreaterThanOrEqual(tone(1)[0]!)
    expect(tone(1)[3]).toBe(1)
  })

  it('runs the shipped shoulder() from TONE_FRAG, unclamped, over its whole range', () => {
    // The real function text, lifted out of the real shader rather than copied,
    // so this cannot pass against a twin that has drifted. It has to be lifted
    // because TONE_FRAG ends in `clamp(c, 0.0, 1.0)`, and every property below
    // lives on the far side of that clamp.
    const start = TONE_FRAG.indexOf('float shoulder(')
    const end = TONE_FRAG.indexOf('\n}', start)
    expect(start).toBeGreaterThan(-1)
    const source = TONE_FRAG.slice(start, end + 2)
    const shader = compileFragment(`precision highp float;
      in vec2 v_uv;
      out vec4 outColor;
      uniform float u_x;
      ${source}
      void main() { outColor = vec4(shoulder(u_x), shoulder(u_x), shoulder(u_x), 1.0); }`)
    const glsl = (x: number): number =>
      runFragment(shader, { fragCoord: [0.5, 0.5], vUv: [0.5, 0.5], uniforms: { u_x: x } })[0]!

    // The three assertions the contract is made of, in the shader that ships.
    expect(glsl(0)).toBe(0)
    expect(glsl(1)).toBe(1)
    for (let i = 0; i <= 99; i += 1) {
      const value = i / 100
      expect(glsl(value), `dimmed ${value}`).toBeGreaterThanOrEqual(value)
      expect(value - glsl(value), `dimmed ${value}`).toBeLessThan(1 / 255)
    }
    // Still a rolloff, not a clip: the blown range is compressed and keeps
    // resolving, above 1.0, where a hard clamp would be flat.
    expect(glsl(2)).toBeGreaterThan(glsl(1.5)!)
    expect(glsl(1.5)).toBeGreaterThan(glsl(1.25)!)
    expect(glsl(1.25)).toBeGreaterThan(1)
    for (const x of [1.01, 1.25, 1.5, 2, 4, 64, 1024]) {
      expect(glsl(x), `${x} is not compressed`).toBeLessThan(x)
    }
    // And it is the CPU twin, value for value, across the range the two engines
    // can disagree on.
    for (let i = 0; i <= 2000; i += 1) {
      const x = (i / 2000) * 2
      expect(glsl(x), `GL and CPU disagree at ${x}`).toBeCloseTo(filmicShoulder(x), 12)
    }
  })

  it('parses every fragment shader the GL backend links', () => {
    for (const [name, source] of Object.entries(SHADERS)) {
      expect(() => compileFragment(source), name).not.toThrow()
    }
  })

  it('evaluates the real geometry, blur, sharpen, effects and hsl shaders', () => {
    const texel: [number, number, number, number] = [0.4, 0.5, 0.6, 1]
    expect(
      runFragment(compileFragment(GEOMETRY_FRAG), {
        fragCoord: [4.5, 2.5],
        vUv: [0.2, 0.1],
        samplers: { u_tex: flatSampler(texel) },
        uniforms: {
          u_texel: [1 / 32, 1 / 32],
          u_matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          u_sourceSize: [32, 32],
          u_outputSize: [32, 32],
          u_clamp: 1,
          u_origin: [0, 0],
        },
      }),
    ).toHaveLength(4)

    const blur = runFragment(compileFragment(BLUR_FRAG), {
      fragCoord: [0, 0],
      vUv: [0.5, 0.5],
      samplers: { u_tex: flatSampler(texel) },
      uniforms: { u_texel: [1 / 32, 1 / 32], u_radius: 1, u_pixelScale: 1 },
    })
    expect(blur[0]).toBeCloseTo(0.4, 12)

    const sharpen = runFragment(compileFragment(SHARPEN_FRAG), {
      fragCoord: [0, 0],
      vUv: [0.5, 0.5],
      samplers: { u_tex: flatSampler(texel) },
      uniforms: { u_texel: [1 / 32, 1 / 32], u_amount: 0.5, u_radius: 2, u_pixelScale: 1 },
    })
    expect(sharpen[0]).toBeCloseTo(0.4, 12)

    const effects = runFragment(compileFragment(EFFECTS_FRAG), {
      fragCoord: [0, 0],
      vUv: [0.5, 0.5],
      samplers: { u_tex: flatSampler([0.9, 0.9, 0.9, 1]) },
      uniforms: {
        u_texel: [1 / 32, 1 / 32],
        u_grain: 0,
        u_bloom: 1,
        u_fieldBlur: 0,
        u_pixelScale: 1,
        u_origin: [0, 0],
      },
    })
    // A flat white field has no halo to add, only its own bright term.
    expect(effects[0]).toBeGreaterThan(0.9)

    const hsl = runFragment(compileFragment(HSL_FRAG), {
      fragCoord: [0, 0],
      vUv: [0.5, 0.5],
      samplers: { u_tex: flatSampler([1, 0, 0, 1]) },
      uniforms: {
        u_texel: [1 / 32, 1 / 32],
        u_bands: new Array<number[]>(8).fill([0, 0, 0]),
      },
    })
    expect(hsl[0]).toBeCloseTo(1, 6)
  })
})
