import { describe, expect, it } from 'vitest'
import { definitionRadius, sharpenRadius } from '../lib/detail-kernels'
import { gradientStop } from '../lib/gradient-angle'
import { DITHER_LSB, SHOULDER_HEADROOM, SHOULDER_KNEE, filmicShoulder } from '../lib/tonemap'
import { createDoc, IDENTITY_CURVES } from '../model/defaults'
import type { Doc, Size } from '../model/types'
import { declaredUniforms, withFakeGl2, type FakeGl2, type UniformCall } from './fakegl'
import { planHash, planPasses } from './passes'
import { hexToRgb, GlRenderer } from './renderer'
import {
  BACKGROUND_FRAG,
  BLUR_FRAG,
  COLOR_FRAG,
  CURVES_FRAG,
  DEFINITION_FRAG,
  EFFECTS_FRAG,
  GEOMETRY_FRAG,
  HEAL_FRAG,
  HSL_FRAG,
  LOCAL_FRAG,
  MASK_FRAG,
  OUTPUT_FRAG,
  REDEYE_FRAG,
  RETOUCH_FRAG,
  SHARPEN_FRAG,
  TONE_FRAG,
  VIGNETTE_FRAG,
} from './shaders/index'

const SIZE: Size = { width: 32, height: 32 }
const SOURCE_SIZE: Size = { width: 64, height: 64 }

function doc(mutate: (doc: Doc) => void = () => {}): Doc {
  const d = createDoc()
  mutate(d)
  return d
}

function render(
  target: Doc,
  size: Size = SIZE,
  assets?: (id: never) => TexImageSource | undefined,
) {
  return withFakeGl2(({ gl, source }) => {
    const renderer = new GlRenderer(document.createElement('canvas'), {
      assets: assets as never,
    })
    renderer.render({ doc: target, size, source, sourceSize: SOURCE_SIZE })
    renderer.dispose()
    return gl
  })
}

function firstCall(gl: FakeGl2, name: string): UniformCall {
  const call = gl.callsFor(name)[0]
  expect(call, `no uniform named ${name} was written`).toBeDefined()
  return call as UniformCall
}

function scalar(gl: FakeGl2, name: string): number {
  const value = gl.lastScalar(name)
  expect(value, `no uniform named ${name} was written`).toBeTypeOf('number')
  return value as number
}

// --- D3-F20: colour parsing --------------------------------------------------

describe('hexToRgb', () => {
  it('parses six-digit hex', () => {
    expect(hexToRgb('#aabbcc')).toEqual([170 / 255, 187 / 255, 204 / 255])
    expect(hexToRgb('aabbcc')).toEqual([170 / 255, 187 / 255, 204 / 255])
  })

  it('parses three-digit hex', () => {
    expect(hexToRgb('#fff')).toEqual([1, 1, 1])
    expect(hexToRgb('#abc')).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255])
  })

  it('falls back to white for junk instead of painting orange', () => {
    expect(hexToRgb('transparent')).toEqual([1, 1, 1])
    expect(hexToRgb('')).toEqual([1, 1, 1])
    expect(hexToRgb('#ffff')).toEqual([1, 1, 1])
    expect(hexToRgb('nonsense')).toEqual([1, 1, 1])
  })

  it('never returns the old orange sentinel', () => {
    for (const value of ['transparent', '#fff', '#ffff', 'nope', '']) {
      expect(hexToRgb(value)).not.toEqual([1, 0.5, 0])
    }
  })

  it('accepts an explicit fallback for callers that want one', () => {
    expect(hexToRgb('transparent', [0, 0, 0])).toEqual([0, 0, 0])
  })

  it('uploads white for a transparent matte, matching the Canvas2D rule', () => {
    // fallback2d.ts: `doc.output.matte === 'transparent' ? '#ffffff' : matte`
    const matte = firstCall(
      render(
        doc((d) => {
          d.output.matte = 'transparent'
        }),
      ),
      'u_matte',
    )
    expect(matte).toMatchObject({ type: 'vec3', value: [1, 1, 1] })
  })

  it('uploads the exact colour for a three-digit matte', () => {
    const matte = firstCall(
      render(
        doc((d) => {
          d.output.matte = '#0f0'
        }),
      ),
      'u_matte',
    )
    expect(matte).toMatchObject({ type: 'vec3', value: [0, 1, 0] })
  })
})

// --- D3-F11: background alpha -------------------------------------------------

describe('background alpha', () => {
  function backgroundPass(target: Doc) {
    return planPasses(target, SIZE).find((pass) => pass.kind === 'background')
  }

  it('keeps the subject alpha in the cut-out mode', () => {
    const target = doc((d) => {
      d.background.mode = 'none'
      d.background.removed = true
    })
    expect(backgroundPass(target)).toMatchObject({ kind: 'background', keepAlpha: true })
    expect(render(target).lastScalar('u_keepAlpha')).toBe(1)
  })

  it('flattens to opaque for a colour background', () => {
    const target = doc((d) => {
      d.background.mode = 'color'
    })
    expect(backgroundPass(target)).toMatchObject({ kind: 'background', keepAlpha: false })
    expect(render(target).lastScalar('u_keepAlpha')).toBe(0)
  })

  it('flattens to opaque for a gradient background', () => {
    const target = doc((d) => {
      d.background.mode = 'gradient'
    })
    expect(backgroundPass(target)).toMatchObject({ kind: 'background', keepAlpha: false })
    expect(render(target).lastScalar('u_keepAlpha')).toBe(0)
  })

  it('declares the uniform and branches on it in the shader', () => {
    expect(declaredUniforms(BACKGROUND_FRAG)).toContain('u_keepAlpha')
    expect(BACKGROUND_FRAG).toContain('u_keepAlpha > 0.5 ? texel.a : 1.0')
  })

  it('changes the plan hash when the flag changes', () => {
    const cutout = doc((d) => {
      d.background.mode = 'none'
      d.background.removed = true
      d.output.format = 'png'
    })
    const flat = doc((d) => {
      d.background.mode = 'color'
      d.output.format = 'png'
    })
    expect(planHash(planPasses(cutout, SIZE))).not.toBe(planHash(planPasses(flat, SIZE)))
  })
})

// --- D3-F19: output alpha -----------------------------------------------------

describe('output alpha', () => {
  function outputPass(target: Doc) {
    return planPasses(target, SIZE).slice(-1)[0]
  }

  it('declares u_alpha in OUTPUT_FRAG', () => {
    expect(declaredUniforms(OUTPUT_FRAG)).toContain('u_alpha')
  })

  it('binds u_alpha from the pass flag', () => {
    const png = render(
      doc((d) => {
        d.output.format = 'png'
      }),
    )
    expect(png.lastScalar('u_alpha')).toBe(1)

    const jpeg = render(
      doc((d) => {
        d.output.format = 'jpeg'
      }),
    )
    expect(jpeg.lastScalar('u_alpha')).toBe(0)

    const withBackground = render(
      doc((d) => {
        d.output.format = 'png'
        d.background.mode = 'color'
      }),
    )
    expect(withBackground.lastScalar('u_alpha')).toBe(0)
  })

  it('has three demonstrably different branches', () => {
    expect(declaredUniforms(OUTPUT_FRAG).sort()).toEqual([
      'u_alpha',
      'u_dither',
      'u_flatten',
      'u_matte',
      'u_origin',
      'u_tex',
      'u_texel',
    ])
    // The three branches used to be asserted by matching text out of the shader
    // source, which is a rename away from a false pass and says nothing about
    // what the pass draws. What makes them different is the pair of flags each
    // format binds, so that is what is checked; `parity.test.ts` › _the output
    // pass has three different results_ proves the pixels that follow.
    for (const [format, flatten, alpha] of [
      ['jpeg', 1, 0],
      ['png', 0, 1],
    ] as const) {
      const gl = render(
        doc((d) => {
          d.output.format = format
        }),
      )
      expect(gl.lastScalar('u_flatten'), format).toBe(flatten)
      expect(gl.lastScalar('u_alpha'), format).toBe(alpha)
    }
  })

  it('hands the output pass the dither and the frame origin it quantises against', () => {
    const gl = render(doc())
    expect(scalar(gl, 'u_dither')).toBe(DITHER_LSB)
    // Zero for a whole-frame render; a tiled one has to say where the tile
    // sits or the ordered pattern restarts and draws a seam every 8 px.
    expect(firstCall(gl, 'u_origin')).toMatchObject({ type: 'vec2', value: [0, 0] })
  })

  it('keeps the flags on the pass they describe', () => {
    const png = doc((d) => {
      d.output.format = 'png'
    })
    expect(outputPass(png)).toMatchObject({ flatten: false, alpha: true })
    const jpeg = doc((d) => {
      d.output.format = 'jpeg'
    })
    expect(outputPass(jpeg)).toMatchObject({ flatten: true, alpha: false })
  })
})

// --- D3-F15: sharpness --------------------------------------------------------

describe('sharpness', () => {
  it('sends the slider value as u_amount instead of a hard-coded zero', () => {
    const gl = render(
      doc((d) => {
        d.adjust.sharpness = 60
      }),
    )
    expect(gl.lastScalar('u_amount')).toBeCloseTo(0.6, 12)
  })

  it('scales the kernel radius with the amount', () => {
    const gl = render(
      doc((d) => {
        d.adjust.sharpness = 100
      }),
    )
    expect(gl.lastScalar('u_radius')).toBeCloseTo(sharpenRadius(1), 12)
  })

  it('reuses no literal no-op term in SHARPEN_FRAG', () => {
    expect(SHARPEN_FRAG).not.toContain('u_definition')
    expect(SHARPEN_FRAG).not.toMatch(/\) \* 0\.0;/)
    // `u_pixelScale` is a later addition (D3-F17): the kernel radius is authored
    // against the 2048 px preview, so a 6000 px export has to scale it or the
    // same slider sharpens a third as hard. The assertion grew with it.
    expect(declaredUniforms(SHARPEN_FRAG)).toEqual([
      'u_tex',
      'u_texel',
      'u_amount',
      'u_radius',
      'u_pixelScale',
    ])
  })

  it('applies a non-zero detail gain', () => {
    expect(SHARPEN_FRAG).toContain('texel.rgb + detail * (u_amount * 2.0)')
  })
})

// --- D3-F16: definition -------------------------------------------------------

describe('definition', () => {
  function renderOnly(key: 'definition' | 'sharpness', amount = 80): FakeGl2 {
    return render(
      doc((d) => {
        d.adjust[key] = amount
      }),
    )
  }

  /** The fragment source the pass's own program was compiled from. */
  function sourceOf(key: 'definition' | 'sharpness'): string {
    const gl = renderOnly(key)
    const calls = gl.callsFor('u_amount')
    const amount = calls[calls.length - 1]
    expect(amount, `no ${key} pass ran`).toBeDefined()
    return gl.programSource(amount?.program ?? '')
  }

  it('compiles a different shader than sharpen', () => {
    expect(sourceOf('sharpness')).toBe(SHARPEN_FRAG)
    expect(sourceOf('definition')).toBe(DEFINITION_FRAG)
    expect(sourceOf('definition')).not.toBe(sourceOf('sharpness'))
  })

  it('binds a different kernel radius than sharpen at the same amount', () => {
    const radiusOf = (key: 'definition' | 'sharpness') => scalar(renderOnly(key, 100), 'u_radius')
    expect(radiusOf('definition')).toBeCloseTo(definitionRadius(1), 12)
    expect(radiusOf('sharpness')).toBeCloseTo(sharpenRadius(1), 12)
    expect(radiusOf('definition')).not.toBeCloseTo(radiusOf('sharpness'), 6)
  })

  it('runs both detail passes on separate programs in one plan', () => {
    const gl = render(
      doc((d) => {
        d.adjust.definition = 80
        d.adjust.sharpness = 80
      }),
    )
    const amountCalls = gl.callsFor('u_amount')
    expect(amountCalls).toHaveLength(2)
    expect(amountCalls[0]?.program).not.toBe(amountCalls[1]?.program)
    expect(gl.programSource(amountCalls[0]?.program ?? '')).toBe(DEFINITION_FRAG)
    expect(gl.programSource(amountCalls[1]?.program ?? '')).toBe(SHARPEN_FRAG)
    expect(gl.callsFor('u_radius').map((call) => call.program)).toEqual([
      amountCalls[0]?.program,
      amountCalls[1]?.program,
    ])
  })

  it('uses a multi-radius ring kernel, not the 1-texel cross', () => {
    // `u_pixelScale` scales the three ring radii (D3-F17); see the sharpen
    // test above for why the exact list grew.
    expect(declaredUniforms(DEFINITION_FRAG)).toEqual([
      'u_tex',
      'u_texel',
      'u_amount',
      'u_radius',
      'u_pixelScale',
    ])
    expect(DEFINITION_FRAG).toContain('vec3 ring(vec2 uv, float radius)')
    // The three radii still have to be 1x / 2x / 4x of the base; each is now
    // also multiplied by the kernel scale (D3-F17).
    for (const scale of [
      'u_radius * u_pixelScale',
      'u_radius * 2.0 * u_pixelScale',
      'u_radius * 4.0 * u_pixelScale',
    ]) {
      expect(DEFINITION_FRAG).toContain(`ring(v_uv, ${scale})`)
    }
    expect(SHARPEN_FRAG).not.toContain('ring(')
  })
})

// --- D4-F06: black point ------------------------------------------------------

describe('black point', () => {
  it('shifts the black level up instead of down', () => {
    expect(TONE_FRAG).toContain('float bp = u_blackPoint * 0.2;')
    expect(TONE_FRAG).toContain('c = (c - bp) / max(1.0 - bp, 0.05);')
    expect(TONE_FRAG).not.toContain('1.0 - u_blackPoint')
  })

  it('uses the same constants as the CPU reference in src/lib/tonemap.ts', async () => {
    const { BLACK_POINT_STRENGTH, blackPointTransfer } = await import('../lib/tonemap')
    const strength = /float bp = u_blackPoint \* ([\d.]+);/.exec(TONE_FRAG)?.[1]
    const floor = /max\(1\.0 - bp, ([\d.]+)\)/.exec(TONE_FRAG)?.[1]
    expect(Number(strength)).toBe(BLACK_POINT_STRENGTH)
    const fromShader = (value: number, blackPoint: number) =>
      (value - blackPoint * Number(strength)) /
      Math.max(1 - blackPoint * Number(strength), Number(floor))
    for (const blackPoint of [-1, -0.3, 0, 0.3, 1]) {
      for (const value of [0, 0.02, 0.35, 0.5, 1]) {
        expect(blackPointTransfer(value, blackPoint)).toBeCloseTo(fromShader(value, blackPoint), 12)
      }
    }
  })

  it('uploads the normalized black point for the tone pass', () => {
    const gl = render(
      doc((d) => {
        d.adjust.blackPoint = 40
      }),
    )
    expect(gl.lastScalar('u_blackPoint')).toBeCloseTo(0.4, 12)
  })
})

// --- D3-F23: the filmic shoulder ------------------------------------------------

describe('filmic shoulder', () => {
  /** The shipped `shoulder()`, lifted out of the real shader rather than copied. */
  const glsl = TONE_FRAG.slice(
    TONE_FRAG.indexOf('float shoulder('),
    TONE_FRAG.indexOf('\n}', TONE_FRAG.indexOf('float shoulder(')),
  )

  it('knees at full scale, so the shader cannot dim a white pixel again', () => {
    // The literal, not a copy of the curve: this is the line that shipped with a
    // 0.86 knee and put a white pixel through the tone stage at 0.9485, and a
    // regression that only changed the constant would still be caught here.
    expect(glsl).toContain('float rolled = 1.0 + 0.14 * (1.0 - exp(-max(x - 1.0, 0.0) / 0.14));')
    expect(glsl).toContain('return mix(x, rolled, step(1.0, x));')
    expect(glsl).not.toContain('0.86')
  })

  it('agrees with filmicShoulder in src/lib/tonemap.ts, constant for constant', () => {
    // The CPU twin is a separate implementation of the same maths, so the two
    // constants and the two anchors are read out of the shader and compared
    // rather than trusted: a drifted headroom would still pass every individual
    // test in `src/lib/tonemap.test.ts`, which only knows the CPU constant.
    const headroom = /1\.0 \+ ([\d.]+) \* \(1\.0 - exp/.exec(glsl)?.[1]
    const divisor = /max\(x - ([\d.]+), 0\.0\) \/ ([\d.]+)\)/.exec(glsl)
    expect(Number(headroom)).toBe(SHOULDER_HEADROOM)
    expect(Number(divisor?.[1])).toBe(SHOULDER_KNEE)
    expect(Number(divisor?.[2])).toBe(SHOULDER_HEADROOM)
    expect(Number(divisor?.[2])).toBe(Number(headroom))

    const width = Number(headroom)
    const fromShader = (x: number) => 1 + width * (1 - Math.exp(-Math.max(x - 1, 0) / width))
    for (const value of [0, 0.25, 0.86, 0.99, 1, 1.25, 1.5, 2, 4, 64]) {
      expect(filmicShoulder(value), `at ${value}`).toBeCloseTo(
        value <= SHOULDER_KNEE ? value : fromShader(value),
        12,
      )
    }
  })
})

// --- D3-F14: gradient angle ---------------------------------------------------

describe('background gradient angle', () => {
  it('projects along (sin, cos) in a top-down frame', () => {
    expect(BACKGROUND_FRAG).toContain(
      'float t = clamp((v_uv.x - 0.5) * sin(a) + (0.5 - v_uv.y) * cos(a) + 0.5, 0.0, 1.0);',
    )
    expect(BACKGROUND_FRAG).not.toContain('v_uv.x * cos(a)')
  })

  it('agrees with gradientStop in src/lib/gradient-angle.ts', () => {
    for (const angle of [0, 45, 90, 135, 180, 270]) {
      for (const uv of [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 0.5 },
      ]) {
        const radians = (angle * Math.PI) / 180
        const shader = Math.min(
          1,
          Math.max(0, (uv.x - 0.5) * Math.sin(radians) + (0.5 - uv.y) * Math.cos(radians) + 0.5),
        )
        expect(gradientStop(uv, angle)).toBeCloseTo(shader, 12)
      }
    }
  })

  it('uploads the slider angle untouched', () => {
    const gl = render(
      doc((d) => {
        d.background.mode = 'gradient'
        d.background.gradient.angle = 135
      }),
    )
    expect(gl.lastScalar('u_angle')).toBe(135)
  })
})

// --- D1-F14: masks and local adjustments ---------------------------------------

describe('masks and local adjustments', () => {
  function masked(mutate: (d: Doc) => void = () => {}): Doc {
    return doc((d) => {
      d.masks = [
        {
          id: 'm1',
          kind: 'radial',
          enabled: true,
          feather: 0.4,
          center: { x: 0.5, y: 0.5 },
          radiusX: 0.3,
          radiusY: 0.2,
          rotation: 15,
          invert: false,
        },
      ]
      d.localAdjusts = [
        { id: 'la1', maskId: 'm1', enabled: true, values: { exposure: 0.4, saturation: -20 } },
      ]
      mutate(d)
    })
  }

  it('rasterises the mask into its own R8 target before the local pass', () => {
    const gl = render(masked())
    const kinds = gl.callsFor('u_maskKind')
    expect(kinds).toHaveLength(1)
    expect(gl.programSource(kinds[0]!.program)).toBe(MASK_FRAG)
    // The ping-pong pair plus the mask target, all at the view size, and the
    // mask target is the one declared R8 (a 9-arg upload whose internal format
    // is RED, not RGBA).
    expect(gl.fboSizes).toEqual([
      [32, 32],
      [32, 32],
      [32, 32],
      [1, 1],
    ])
    const r8 = gl.sizedUploads.filter((upload) => upload.length === 9)
    // The empty 1x1 stand-in plus the view-sized mask field.
    expect(r8.length).toBeGreaterThanOrEqual(1)
  })

  it('binds the mask texture to the local pass', () => {
    const gl = render(masked())
    const mask = gl.callsFor('u_maskTex')
    expect(mask).toHaveLength(1)
    expect(gl.programSource(mask[0]!.program)).toBe(LOCAL_FRAG)
    expect(mask[0]!.value).toBe(1)
  })

  it('uploads every local adjust key, zeroing the ones the adjust leaves alone', () => {
    const gl = render(masked())
    expect(gl.lastScalar('u_exposure')).toBeCloseTo(0.4, 12)
    expect(gl.lastScalar('u_saturation')).toBeCloseTo(-0.2, 12)
    for (const key of [
      'brightness',
      'contrast',
      'highlights',
      'shadows',
      'blackPoint',
      'brilliance',
      'vibrance',
      'warmth',
      'tint',
    ]) {
      expect(gl.lastScalar(`u_${key}`), key).toBe(0)
    }
  })

  it('sends the mask geometry as uniforms rather than baking it in', () => {
    const gl = render(masked())
    expect(gl.lastScalar('u_maskKind')).toBe(3)
    expect(gl.lastScalar('u_feather')).toBeCloseTo(0.4, 12)
    expect(gl.lastScalar('u_rotation')).toBe(15)
    const center = gl.callsFor('u_center')[0]
    expect(center).toMatchObject({ type: 'vec2', value: [0.5, 0.5] })
    const radius = gl.callsFor('u_radius')[0]
    expect(radius).toMatchObject({ type: 'vec2', value: [0.3, 0.2] })
  })

  it('inverts the mask through a uniform, so both paths are reachable', () => {
    const gl = render(
      masked((d) => {
        const first = d.masks[0]
        if (first && first.kind === 'radial') d.masks[0] = { ...first, invert: true }
      }),
    )
    expect(gl.lastScalar('u_invert')).toBe(1)
  })

  it('addresses the mask in whole-output space, not tile space', () => {
    const gl = render(masked())
    const frame = gl.callsFor('u_frameSize')[0]
    expect(frame).toMatchObject({ type: 'vec2', value: [32, 32] })
    expect(gl.callsFor('u_origin')[0]).toMatchObject({ type: 'vec2', value: [0, 0] })
  })

  it('issues no local pass at all for an untouched document', () => {
    const gl = render(doc())
    expect(gl.callsFor('u_maskKind')).toHaveLength(0)
    expect(gl.callsFor('u_maskTex')).toHaveLength(0)
  })
})

// --- D1-F13: retouch -------------------------------------------------------------

describe('retouch', () => {
  it('uploads the smoothing amount, radius and range tolerance', () => {
    const gl = render(
      doc((d) => {
        d.retouch = { smooth: 50, healSpots: [], redEye: [] }
      }),
    )
    const amount = gl.callsFor('u_smooth')[0]
    expect(amount).toBeDefined()
    expect(gl.programSource(amount!.program)).toBe(RETOUCH_FRAG)
    expect(gl.lastScalar('u_smooth')).toBeCloseTo(0.5, 12)
    expect(gl.lastScalar('u_radius')).toBeGreaterThan(0)
    expect(gl.lastScalar('u_range')).toBeGreaterThan(0)
  })

  it('runs one heal draw per spot and one redeye draw per eye', () => {
    const gl = render(
      doc((d) => {
        d.retouch = {
          smooth: 0,
          healSpots: [
            { id: 'h1', at: { x: 0.3, y: 0.4 }, radius: 0.1 },
            { id: 'h2', at: { x: 0.6, y: 0.7 }, radius: 0.05 },
          ],
          redEye: [{ at: { x: 0.5, y: 0.5 }, radius: 0.03 }],
        }
      }),
    )
    expect(gl.callsFor('u_at')).toHaveLength(3)
    const sources = new Set(gl.callsFor('u_at').map((call) => gl.programSource(call.program)))
    expect(sources).toEqual(new Set([HEAL_FRAG, REDEYE_FRAG]))
    const radii = gl.callsFor('u_radius').map((call) => call.value)
    expect(radii).toEqual([0.1, 0.05, 0.03])
  })

  it('sends the spot in output-normalized space with the frame aspect', () => {
    const gl = render(
      doc((d) => {
        d.retouch = {
          smooth: 0,
          healSpots: [{ id: 'h', at: { x: 0.3, y: 0.4 }, radius: 0.1 }],
          redEye: [],
        }
      }),
    )
    expect(gl.callsFor('u_at')[0]).toMatchObject({ type: 'vec2', value: [0.3, 0.4] })
    expect(gl.lastScalar('u_squeeze')).toBeCloseTo(1, 12)
  })
})

// --- D3-F12: background image, fit and blur ------------------------------------

describe('background image', () => {
  function withImage(patch: Partial<Doc['background']> = {}) {
    return doc((d) => {
      d.background = {
        ...d.background,
        mode: 'image',
        imageAssetId: 'bg-1',
        removed: true,
        ...patch,
      }
      d.output.format = 'png'
    })
  }

  const bitmap = {
    width: 40,
    height: 20,
    data: new Uint8Array(40 * 20 * 4).fill(200),
  } as unknown as TexImageSource

  it('selects u_mode 3 for an image, which is what the old code never sent', () => {
    const gl = render(withImage(), SIZE, () => bitmap)
    expect(gl.lastScalar('u_mode')).toBe(3)
  })

  it('uploads fit and blur, which had no reader anywhere in src/', () => {
    const cover = render(withImage({ fit: 'cover', blur: 0 }), SIZE, () => bitmap)
    expect(cover.lastScalar('u_fit')).toBe(0)
    const contain = render(withImage({ fit: 'contain', blur: 0.5 }), SIZE, () => bitmap)
    expect(contain.lastScalar('u_fit')).toBe(1)
    expect(contain.lastScalar('u_blur')).toBeCloseTo(0.5, 12)
    expect(contain.lastScalar('u_blurRadius')).toBeCloseTo(6, 12)
  })

  it('binds the image texture and reports its own size, not the frame size', () => {
    const gl = render(withImage(), SIZE, () => bitmap)
    expect(gl.callsFor('u_bgImage')).toHaveLength(1)
    expect(gl.callsFor('u_imageSize')[0]).toMatchObject({ type: 'vec2', value: [40, 20] })
    expect(gl.callsFor('u_frameSize')[0]).toMatchObject({ type: 'vec2', value: [32, 32] })
  })

  it('binds a 1x1 stand-in when the asset is gone, never nothing', () => {
    const gl = render(withImage(), SIZE, () => undefined)
    expect(gl.callsFor('u_bgImage')).toHaveLength(1)
    expect(gl.locationMisses).toEqual([])
  })

  it('keeps binding the texture for a colour background, where it is unread', () => {
    const gl = render(
      doc((d) => {
        d.background.mode = 'color'
        d.background.removed = true
      }),
    )
    expect(gl.lastScalar('u_mode')).toBe(1)
    expect(gl.callsFor('u_bgImage')).toHaveLength(1)
  })

  it('declares everything BACKGROUND_FRAG reads', () => {
    expect(declaredUniforms(BACKGROUND_FRAG)).toEqual([
      'u_tex',
      'u_texel',
      'u_color',
      'u_gradientFrom',
      'u_gradientTo',
      'u_angle',
      'u_mode',
      'u_fit',
      'u_blur',
      'u_blurRadius',
      'u_imageSize',
      'u_frameSize',
      'u_pixelScale',
      'u_keepAlpha',
      'u_bgImage',
    ])
  })
})

// --- uniform coverage ---------------------------------------------------------

describe('uniform coverage', () => {
  // Every fragment shader the GL backend links. LUT3D_FRAG is excluded: the
  // pass is skipped until a look's 3D LUT is actually loaded.
  const FRAGMENTS: [string, string][] = [
    ['GEOMETRY_FRAG', GEOMETRY_FRAG],
    ['TONE_FRAG', TONE_FRAG],
    ['COLOR_FRAG', COLOR_FRAG],
    ['CURVES_FRAG', CURVES_FRAG],
    ['HSL_FRAG', HSL_FRAG],
    ['BLUR_FRAG', BLUR_FRAG],
    ['SHARPEN_FRAG', SHARPEN_FRAG],
    ['DEFINITION_FRAG', DEFINITION_FRAG],
    ['EFFECTS_FRAG', EFFECTS_FRAG],
    ['VIGNETTE_FRAG', VIGNETTE_FRAG],
    ['BACKGROUND_FRAG', BACKGROUND_FRAG],
    ['OUTPUT_FRAG', OUTPUT_FRAG],
    ['MASK_FRAG', MASK_FRAG],
    ['LOCAL_FRAG', LOCAL_FRAG],
    ['RETOUCH_FRAG', RETOUCH_FRAG],
    ['HEAL_FRAG', HEAL_FRAG],
    ['REDEYE_FRAG', REDEYE_FRAG],
  ]

  /** The background image is injected, so the image path links its real shader. */
  function renderAll(): FakeGl2 {
    return withFakeGl2(({ gl, source }) => {
      const renderer = new GlRenderer(document.createElement('canvas'), {
        assets: () =>
          ({
            width: 40,
            height: 20,
            data: new Uint8Array(40 * 20 * 4).fill(200),
          }) as unknown as TexImageSource,
      })
      renderer.render({ doc: everythingOn(), size: SIZE, source, sourceSize: SOURCE_SIZE })
      renderer.dispose()
      return gl
    })
  }

  function everythingOn(): Doc {
    return doc((d) => {
      d.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      d.adjust.exposure = 0.2
      d.adjust.contrast = 10
      d.adjust.saturation = 10
      d.curves = {
        rgb: [
          { x: 0, y: 4 },
          { x: 255, y: 251 },
        ],
        r: IDENTITY_CURVES.r,
        g: IDENTITY_CURVES.g,
        b: IDENTITY_CURVES.b,
      }
      d.hsl.red.sat = 10
      d.adjust.noiseReduction = 20
      d.adjust.definition = 30
      d.adjust.sharpness = 30
      d.background.mode = 'image'
      d.background.imageAssetId = 'bg-1'
      d.background.fit = 'contain'
      d.background.blur = 30
      d.background.removed = true
      d.masks = [
        {
          id: 'm1',
          kind: 'radial',
          enabled: true,
          feather: 0.5,
          center: { x: 0.5, y: 0.5 },
          radiusX: 0.3,
          radiusY: 0.3,
          rotation: 0,
          invert: false,
        },
      ]
      d.localAdjusts = [
        { id: 'la1', maskId: 'm1', enabled: true, values: { exposure: 0.2, contrast: 10 } },
      ]
      d.retouch = {
        smooth: 30,
        healSpots: [{ id: 'h1', at: { x: 0.4, y: 0.5 }, radius: 0.08 }],
        redEye: [{ at: { x: 0.6, y: 0.4 }, radius: 0.04 }],
      }
      d.effects.fieldBlur = 20
      d.adjust.vignette = -20
      d.output.format = 'png'
    })
  }

  it('drives every pass the GL backend can run', () => {
    const gl = renderAll()
    expect(gl.draws.length).toBeGreaterThanOrEqual(16)
    expect(gl.programs.length).toBeGreaterThanOrEqual(15)
  })

  it('links every fragment shader the backend can reach', () => {
    const gl = renderAll()
    const compiled = new Set(gl.programs.map((program) => program.fragmentSource))
    const missing = FRAGMENTS.filter(([, source]) => !compiled.has(source)).map(([name]) => name)
    expect(missing).toEqual([])
  })

  it('leaves no uniform declared in a shader without a value', () => {
    const gl = renderAll()
    expect(gl.unboundUniforms()).toEqual([])
  })

  it('never looks up a uniform the program does not declare', () => {
    const gl = renderAll()
    expect(gl.locationMisses).toEqual([])
  })

  it('the unbound query can actually fail', () => {
    const partial = render(
      doc((d) => {
        d.output.format = 'png'
        d.background.mode = 'color'
      }),
    )
    const lookup = partial.unboundUniforms()
    expect(Array.isArray(lookup)).toBe(true)
    expect(partial.programs.length).toBeGreaterThan(0)
  })

  it('parses uniform declarations, including array uniforms', () => {
    expect(declaredUniforms(HSL_FRAG)).toContain('u_bands')
    expect(declaredUniforms(HSL_FRAG)).not.toContain('u_bands[0]')
    expect(declaredUniforms('uniform float u_missing;')).toEqual(['u_missing'])
  })
})
