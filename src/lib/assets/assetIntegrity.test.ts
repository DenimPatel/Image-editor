/**
 * The shipped-asset gate (D6-F16 / D4-F05).
 *
 * Before this file existed, `public/luts/` and `public/fonts/` were gitignored
 * and empty. All 24 Look chips and all 14 font entries 404'd, and every layer
 * of the app reported success anyway: `loadLut` returned `null`, the renderer
 * `continue`d the `lut3d` pass, `ensureFont` swallowed the rejection, and
 * FiltersPanel still highlighted the selected chip. Nothing in the test suite
 * could see it, because no test touched the filesystem the app serves from.
 *
 * The LUT assertions here decode the real PNGs and re-derive the slice order
 * from the *shader source*, not from a copy of it, so a change to `LUT3D_FRAG`
 * is a loud failure rather than a silently-wrong lookup.
 *
 * Node globals are used through the ambient shims the repo already keeps
 * (`src/components/ui/nodeTestGlobals.d.ts` and, for binary reads,
 * `src/lib/assets/nodeBinaryGlobals.d.ts`) rather than by pulling `@types/node`
 * into the browser-only app program. The sha256 half of the font check lives in
 * `scripts/verify-assets.mjs`, which runs in `npm run build` and in CI, because
 * that script already has real Node.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { unzlibSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearLutCache,
  getLutFailure,
  loadLut,
  LUT_PRESETS,
  LUT_SIZE,
  LUT_STRIP_LONG_EDGE,
} from '../../gl/luts'
import { FONTS, resetFontCache } from '../../features/layers/fonts'

const repoRoot = process.cwd()
const publicDir = join(repoRoot, 'public')
const lock = JSON.parse(readFileSync(join(repoRoot, 'models.lock.json'), 'utf8') as string) as {
  fonts: {
    id: string
    target: string
    url: string
    bytes: number
    sha256: string
    licence: string
  }[]
}

/** Every shipped file, as a fresh ArrayBuffer-backed array so `Response` takes it. */
const bytesOf = (relative: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(join(repoRoot, relative)))

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

type Strip = { width: number; height: number; rgb: Uint8Array }

// ── a small PNG reader, so the test reads what the browser will read ────────

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** 8-bit truecolour, non-interlaced — exactly what scripts/png.mjs writes. */
function decodeStrip(bytes: Uint8Array): Strip {
  expect([...SIGNATURE]).toEqual([...bytes.subarray(0, 8)])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  expect({ depth: bytes[24], colourType: bytes[25], interlace: bytes[28] }).toEqual({
    depth: 8,
    colourType: 2,
    interlace: 0,
  })

  const idat: Uint8Array[] = []
  let offset = 8
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  const raw = unzlibSync(concat(idat))
  const stride = width * 3
  const rgb = new Uint8Array(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const row = y * stride
    const above = row - stride
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i]
      const a = i >= 3 ? rgb[row + i - 3] : 0
      const b = y > 0 ? rgb[above + i] : 0
      const c = y > 0 && i >= 3 ? rgb[above + i - 3] : 0
      let v: number
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else if (filter === 4) v = x + paeth(a, b, c)
      else throw new Error(`unknown PNG filter ${filter} on row ${y}`)
      rgb[row + i] = v & 0xff
    }
  }
  return { width, height, rgb }
}

const node = (strip: Strip, x: number, y: number): [number, number, number] => {
  const at = (y * strip.width + x) * 3
  return [strip.rgb[at], strip.rgb[at + 1], strip.rgb[at + 2]]
}

// ── the contract, read out of the shader rather than copied from it ─────────

const shaderSource = readFileSync(
  join(repoRoot, 'src', 'gl', 'shaders', 'index.ts'),
  'utf8',
) as string
const lut3dFrag = shaderSource.slice(shaderSource.indexOf('export const LUT3D_FRAG'))
const uploadSource = readFileSync(join(repoRoot, 'src', 'gl', 'texture.ts'), 'utf8') as string

describe('LUT3D_FRAG addressing, as the shipped strips must match it', () => {
  it('still reads a horizontal strip of size*size blue slices with green on Y', () => {
    const body = lut3dFrag.slice(0, lut3dFrag.indexOf('export const BLUR_FRAG'))
    expect(body).toContain('float texW = u_size * u_size;')
    expect(body).toContain(
      'vec2 uv0 = vec2((b0 * u_size + rScaled + 0.5) / texW, (gScaled + 0.5) / u_size);',
    )
    expect(body).toContain(
      'vec2 uv1 = vec2((b1 * u_size + rScaled + 0.5) / texW, (gScaled + 0.5) / u_size);',
    )
    // `b1` only exists to interpolate between two *blue* slices. If this ever
    // addresses a different axis, the layout below is wrong and the strips have
    // to be regenerated.
    expect(body).toContain('float b1 = min(b0 + 1.0, slice);')
  })

  it('uploads the strip with the first PNG row at v = 0, so green 0 is on top', () => {
    // A flipped Y would turn every look's green channel upside down while
    // still producing plausible-looking output, so the assumption is pinned
    // here rather than trusted.
    expect(uploadSource).toMatch(/UNPACK_FLIP_Y_WEBGL,\s*options\.flipY\s*\?\?\s*false\b/)
    expect(uploadSource).not.toMatch(/flipY\s*\?\?\s*true/)
  })

  it('declares the same size the generator wrote', () => {
    expect(LUT_STRIP_LONG_EDGE).toBe(LUT_SIZE * LUT_SIZE)
  })
})

/**
 * The shader's own lookup, in JS: blue picks the horizontal slice, red the
 * column inside it, green the row. `column = b * u_size + r`, `row = g`.
 */
function sampleStrip(strip: Strip, r: number, g: number, b: number): [number, number, number] {
  const last = LUT_SIZE - 1
  const column =
    Math.round(Math.min(1, Math.max(0, b)) * last) * LUT_SIZE +
    Math.round(Math.min(1, Math.max(0, r)) * last)
  const row = Math.round(Math.min(1, Math.max(0, g)) * last)
  return node(strip, column, row)
}

const luma = ([r, g, b]: [number, number, number]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

describe('public/luts (D6-F16, D4-F05)', () => {
  it('ships a 33x33-per-slice strip for every declared preset, and nothing more', () => {
    expect(LUT_PRESETS.length).toBe(24)
    const missing = LUT_PRESETS.filter(
      (preset) => !existsSync(join(publicDir, 'luts', `${preset.id}.png`)),
    )
    expect(missing).toEqual([])
    // The set on disk must be *exactly* the declared catalogue. A stale strip
    // left behind by a renamed preset is dead weight that still ships, and the
    // previous version of this assertion compared the list to a sorted copy of
    // itself, so it could not fail.
    const declared = new Set(LUT_PRESETS.map((preset) => `${preset.id}.png`))
    const shipped = readdirSync(join(publicDir, 'luts'), { withFileTypes: true })
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.png'))
      .sort()
    expect(shipped.filter((name) => !declared.has(name))).toEqual([])
  })

  it.each(LUT_PRESETS.map((preset) => [preset.id] as const))(
    'writes %s as a %i x %i blue-slice strip',
    (id) => {
      const strip = decodeStrip(bytesOf(`public/luts/${id}.png`))
      expect({ width: strip.width, height: strip.height }).toEqual({
        width: LUT_SIZE * LUT_SIZE,
        height: LUT_SIZE,
      })
    },
  )

  it('grades black to black and white to white through the shader addressing', () => {
    for (const preset of LUT_PRESETS) {
      const strip = decodeStrip(bytesOf(`public/luts/${preset.id}.png`))
      const black = sampleStrip(strip, 0, 0, 0)
      const white = sampleStrip(strip, 1, 1, 1)
      // `faded-matte` and `agfa-vista` lift the toe on purpose; a strip whose
      // white corner is dark is a broken grade, not a look.
      expect(luma(black), `${preset.id} black corner`).toBeLessThan(48)
      expect(luma(white), `${preset.id} white corner`).toBeGreaterThan(224)
      for (const channel of [...black, ...white]) {
        expect(Number.isInteger(channel)).toBe(true)
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(255)
      }
    }
  })

  it('rises along the neutral diagonal, so a grey ramp is never inverted', () => {
    for (const preset of LUT_PRESETS) {
      const strip = decodeStrip(bytesOf(`public/luts/${preset.id}.png`))
      const ramp = Array.from({ length: 12 }, (_, step) =>
        luma(sampleStrip(strip, step / 11, step / 11, step / 11)),
      )
      for (let i = 1; i < ramp.length; i += 1) {
        expect(
          ramp[i] ?? 0,
          `${preset.id} inverts between step ${i - 1} and ${i}`,
        ).toBeGreaterThanOrEqual((ramp[i - 1] ?? 0) - 2)
      }
      expect(ramp[ramp.length - 1] ?? 0).toBeGreaterThan((ramp[0] ?? 0) + 100)
    }
  })

  it('puts green on the Y axis, not mirrored', () => {
    // The one failure mode a source pin cannot catch on its own: a strip
    // written bottom-up. Every one of these looks shifts green away from its
    // input value, so a vertically mirrored read lands somewhere else entirely.
    const mismatched = LUT_PRESETS.filter((preset) => {
      const strip = decodeStrip(bytesOf(`public/luts/${preset.id}.png`))
      const step = 8
      const read = sampleStrip(strip, 0.4, step / 32, 0.6)
      const mirrored = node(strip, 19 * LUT_SIZE + 12, LUT_SIZE - 1 - step)
      return Math.max(...read.map((channel, i) => Math.abs(channel - (mirrored[i] ?? 0)))) <= 4
    })
    expect(mismatched).toEqual([])
  })

  it('actually changes the image: no preset is the identity and none is a duplicate', () => {
    const signatures = LUT_PRESETS.map((preset) => {
      const strip = decodeStrip(bytesOf(`public/luts/${preset.id}.png`))
      let worst = 0
      for (let i = 0; i < 12; i += 1) {
        const t = i / 11
        const graded = sampleStrip(strip, t, t, t)
        worst = Math.max(worst, Math.abs(graded[0] - Math.round(t * 255)))
      }
      return { id: preset.id, worst }
    })
    for (const { id, worst } of signatures) {
      expect(worst, `look "${id}" is the identity LUT`).toBeGreaterThan(6)
    }
    const fingerprints = LUT_PRESETS.map((preset) =>
      bytesOf(`public/luts/${preset.id}.png`).join(','),
    )
    expect(new Set(fingerprints).size).toBe(LUT_PRESETS.length)
  })

  it('tints the picture: no look but noir grades any input back to r === g === b', () => {
    // `grade()` in scripts/lut-looks.mjs runs `lgg` *before* `saturate`, so a
    // look that carries its warmth in `lgg` and also sets `sat: 0` has that
    // warmth erased and comes out pure grey. "Sepia" shipped exactly that way
    // and rendered as black and white, and nothing in the suite noticed: the
    // other assertions here all still pass on a neutral strip, and
    // `npm run luts:gen -- --check` only proves the committed bytes match the
    // recipe — a recipe that grades to grey is perfectly self-consistent. So
    // the property is asserted on the shipped bytes.
    //
    // The whole cube is scanned — every one of the 35 937 nodes the shader can
    // address — because a split tone tints the shadows hardest and a probe set
    // that only looked at mid-greys would call several of these looks neutral.
    const MONO_BY_INTENT = new Set(['noir'])
    // 8/255 is about 3%: far above the 0 a lost tint produces, and well under
    // the weakest real tint in the set (Sepia's, 30/255 across the cube).
    const MIN_TINT = 8
    const last = LUT_SIZE - 1

    for (const preset of LUT_PRESETS) {
      const strip = decodeStrip(bytesOf(`public/luts/${preset.id}.png`))
      let widest = 0
      for (let blue = 0; blue <= last; blue += 1) {
        for (let green = 0; green <= last; green += 1) {
          for (let red = 0; red <= last; red += 1) {
            const pixel = sampleStrip(strip, red / last, green / last, blue / last)
            widest = Math.max(widest, Math.max(...pixel) - Math.min(...pixel))
          }
        }
      }
      if (MONO_BY_INTENT.has(preset.id)) {
        // Noir is the one look whose recipe is mono end to end — neutral lgg,
        // `sat: 0`, no split tone — so it is exempt, and the exemption is
        // pinned: a regenerated Noir that picked up a tint fails here too.
        expect(widest, `${preset.id} is exempt as mono, but is tinted`).toBe(0)
      } else {
        expect(widest, `look "${preset.id}" grades to r === g === b everywhere`).toBeGreaterThan(
          MIN_TINT,
        )
      }
    }
  })
})

describe('public/look-thumbs (the Look grid previews)', () => {
  /**
   * The probe coordinates the generator reads, as pixels. Duplicated on purpose:
   * this file asserts on the *shipped bytes*, and a generator that moved its own
   * probes would move them with the answer. If either half moves, the ordering
   * assertions below are what notices.
   *
   * These are the regions of the current subject — a blue sky over a warm
   * neutral wall, a red-coated figure lit from the sun side, a near-black
   * doorway, a yellow window and a green hedge. `SCENE_PROBES` in
   * `scripts/look-thumb-scene.mjs` is the other copy, and the two have to agree:
   * a scene that moved a probe onto the wrong side of a hard edge would make
   * every separation assertion below measure the wrong pair of pixels.
   */
  const SUN: [number, number] = [115, 12]
  const SKY: [number, number] = [23, 19]
  const DOORWAY: [number, number] = [105, 72]
  const ROOF: [number, number] = [86, 46]
  const WALL: [number, number] = [89, 57]
  const SKIN: [number, number] = [57, 57]
  const COAT: [number, number] = [47, 72]
  const WINDOW: [number, number] = [16, 57]
  const FOLIAGE: [number, number] = [12, 86]
  const WIDTH = 144
  const HEIGHT = 96

  const thumbOf = (id: string): Strip => decodeStrip(bytesOf(`public/look-thumbs/${id}.png`))

  it('ships a 144 x 96 preview for every declared preset, and nothing more', () => {
    const missing = LUT_PRESETS.filter(
      (preset) => !existsSync(join(publicDir, 'look-thumbs', `${preset.id}.png`)),
    )
    expect(missing).toEqual([])
    // Same assertion shape as `public/luts`, and for the same reason: a preview
    // left behind by a renamed look is fetched by nothing and still ships.
    const declared = new Set(LUT_PRESETS.map((preset) => `${preset.id}.png`))
    const shipped = readdirSync(join(publicDir, 'look-thumbs'), { withFileTypes: true })
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.png'))
    expect(shipped.filter((name) => !declared.has(name))).toEqual([])
  })

  it.each(LUT_PRESETS.map((preset) => [preset.id] as const))(
    'writes %s as a %i x %i 8-bit truecolour PNG the browser can decode',
    (id) => {
      // `decodeStrip` re-implements the unfilter, so this is the bytes going
      // through the same arithmetic the app's own decoder uses. The aspect is
      // pinned at 2x the 72 x 48 the component renders it in.
      const thumb = thumbOf(id)
      expect({ width: thumb.width, height: thumb.height }).toEqual({
        width: WIDTH,
        height: HEIGHT,
      })
      expect(thumb.rgb).toHaveLength(WIDTH * HEIGHT * 3)
    },
  )

  it('is a preview, not a swatch: every look spans a picture on every channel', () => {
    // The claim `gen-look-thumbs.test.mjs` makes about a fresh render, asserted
    // here on the committed file. A thumbnail that decoded to one flat colour
    // is a valid PNG of nothing, and this is the only test in the repo that
    // would notice.
    for (const preset of LUT_PRESETS) {
      const thumb = thumbOf(preset.id)
      for (let channel = 0; channel < 3; channel += 1) {
        /** @type {Set<number>} */
        const levels = new Set()
        for (let i = channel; i < thumb.rgb.length; i += 3) levels.add(thumb.rgb[i] ?? 0)
        expect(levels.size, `${preset.id} channel ${channel} is flat`).toBeGreaterThan(48)
      }
      const lumas: number[] = []
      for (let i = 0; i < thumb.rgb.length; i += 3) {
        lumas.push(luma([thumb.rgb[i] ?? 0, thumb.rgb[i + 1] ?? 0, thumb.rgb[i + 2] ?? 0]))
      }
      lumas.sort((a, b) => a - b)
      const spread =
        (lumas[Math.floor(lumas.length * 0.95)] ?? 0) -
        (lumas[Math.floor(lumas.length * 0.05)] ?? 0)
      expect(spread, `${preset.id} tonal range`).toBeGreaterThan(90)
    }
  })

  it('keeps sun, sky and shadow in that order, in every look', () => {
    // The three values a photograph cannot reorder. `faded-matte` lifts the
    // doorway from 10/255 to well past 40/255 and that is the look working,
    // so nothing here is about absolute levels — only that no grade has
    // inverted the frame or crushed it flat.
    for (const preset of LUT_PRESETS) {
      const thumb = thumbOf(preset.id)
      const at = ([x, y]: [number, number]) => luma(node(thumb, x, y))
      expect(at(SUN) - at(SKY), `${preset.id} highlight`).toBeGreaterThan(20)
      expect(at(SKY) - at(DOORWAY), `${preset.id} shadow`).toBeGreaterThan(12)
    }
  })

  it('still has a subject in it: the regions read against each other after grading', () => {
    // The scene has to keep its shape after grading or the chip is a picture of
    // nothing in particular and a look's split tone has nowhere to be seen. The
    // claim is about *separation*, not about hue: `infrared` remaps the hedge
    // green to magenta and `noir` collapses every channel to the same value, and
    // both are the looks working as intended, so "the hedge is still green"
    // would be a statement about art direction in a test file whose job is
    // correctness.
    //
    // The four separations are the ones the subject exists for: the figure
    // against the wall it stands on, the near-black doorway against that same
    // wall, the roofline against it, and the warm window against the cool hedge
    // — the last being the one place a look's saturation knob is visible at
    // thumbnail size. The floors are the ungraded separations (168, 190, 189
    // and 128) minus roughly two thirds, so a look that flattens the picture
    // has to work hard to clear them.
    for (const preset of LUT_PRESETS) {
      const thumb = thumbOf(preset.id)
      const at = ([x, y]: [number, number]) => luma(node(thumb, x, y))
      expect(Math.abs(at(COAT) - at(WALL)), `${preset.id} figure against wall`).toBeGreaterThan(60)
      expect(Math.abs(at(SKIN) - at(COAT)), `${preset.id} face against coat`).toBeGreaterThan(60)
      expect(Math.abs(at(DOORWAY) - at(WALL)), `${preset.id} doorway against wall`).toBeGreaterThan(
        60,
      )
      expect(Math.abs(at(ROOF) - at(WALL)), `${preset.id} roofline against wall`).toBeGreaterThan(
        60,
      )
      expect(
        Math.abs(at(WINDOW) - at(FOLIAGE)),
        `${preset.id} warm accent against hedge`,
      ).toBeGreaterThan(40)
    }
  })

  it('makes every look look different, which is the only reason to ship 24 previews', () => {
    const prints = LUT_PRESETS.map((preset) =>
      bytesOf(`public/look-thumbs/${preset.id}.png`).join(','),
    )
    expect(new Set(prints).size).toBe(LUT_PRESETS.length)
    // Byte inequality is trivial. What matters for the grid is that two chips do
    // not differ by a rounding step: 24 images that are the same picture to the
    // eye would be a grid of 24 words with extra requests attached.
    //
    // The floor is `MIN_PAIRWISE_RMS / 3`: `scripts/lut-looks.test.mjs` measures
    // the *same* pair on the same scene at 12/255 RMS over all three channels,
    // and this is the per-channel mean of that, so a regression in the recipes
    // goes red in both files rather than in one.
    const rms = (left: Uint8Array, right: Uint8Array): number => {
      let total = 0
      for (let i = 0; i < left.length; i += 3) {
        total +=
          ((left[i] ?? 0) - (right[i] ?? 0)) ** 2 +
          ((left[i + 1] ?? 0) - (right[i + 1] ?? 0)) ** 2 +
          ((left[i + 2] ?? 0) - (right[i + 2] ?? 0)) ** 2
      }
      return Math.sqrt(total / (left.length / 3))
    }
    const rgb = LUT_PRESETS.map((preset) => thumbOf(preset.id).rgb)
    for (let a = 0; a < LUT_PRESETS.length; a += 1) {
      for (let b = a + 1; b < LUT_PRESETS.length; b += 1) {
        expect(
          rms(rgb[a] ?? new Uint8Array(0), rgb[b] ?? new Uint8Array(0)),
          `${LUT_PRESETS[a]?.id} vs ${LUT_PRESETS[b]?.id}`,
        ).toBeGreaterThan(4)
      }
    }
  })

  it('keeps noir mono and every other look tinted, as the LUT strips do', () => {
    // The same claim the LUT strip tests make about `LUT3D_FRAG`, made about the
    // preview: if a look grades to r === g === b everywhere then it is not a
    // look, and no amount of self-consistent regenerating will say otherwise.
    for (const preset of LUT_PRESETS) {
      const thumb = thumbOf(preset.id)
      let widest = 0
      for (let i = 0; i < thumb.rgb.length; i += 3) {
        const px = [thumb.rgb[i] ?? 0, thumb.rgb[i + 1] ?? 0, thumb.rgb[i + 2] ?? 0]
        widest = Math.max(widest, Math.max(...px) - Math.min(...px))
      }
      if (preset.id === 'noir') {
        expect(widest, 'noir is exempt as mono, but is tinted').toBe(0)
      } else {
        expect(widest, `look "${preset.id}" grades to r === g === b everywhere`).toBeGreaterThan(8)
      }
    }
  })
})

describe('public/fonts (D6-F16)', () => {
  it('offers 14 fonts and every one of them is a pinned, correctly-sized woff2', () => {
    expect(FONTS.length).toBe(14)
    expect(FONTS.map((font) => font.id)).toEqual(lock.fonts.map((entry) => entry.id))
    for (const font of FONTS) {
      const entry = lock.fonts.find((candidate) => candidate.id === font.id)
      expect(entry, `${font.id} is not pinned`).toBeDefined()
      expect(font.url).toBe(`fonts/${font.id}.woff2`)
      expect(font.licence).toBe(entry?.licence)

      // The sha256 half of this check needs `node:crypto` and therefore lives in
      // scripts/verify-assets.mjs, which runs in `npm run build` and in CI. What
      // is checked here is that the declared file exists at the declared size,
      // which is the failure a fresh clone without a fetch step produces.
      expect(existsSync(join(repoRoot, entry?.target ?? '')), `${entry?.target} is missing`).toBe(
        true,
      )
      const bytes = bytesOf(entry?.target ?? '')
      expect(bytes.length, `${font.id} size`).toBe(entry?.bytes)
      expect(ascii(bytes, 0, 4), `${font.id} magic`).toBe('wOF2')
    }
  })

  it('ships a distinct family for every entry, so the dropdown is not 14 aliases', () => {
    expect(new Set(FONTS.map((font) => font.family)).size).toBeGreaterThanOrEqual(10)
  })
})

describe('a missing asset is a reported failure, not a silent no-op', () => {
  beforeEach(() => {
    clearLutCache()
    resetFontCache()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearLutCache()
    resetFontCache()
  })

  it('rejects instead of resolving null, and records why', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404, statusText: 'Not Found' })),
    )
    await expect(loadLut('kodak-portra')).rejects.toMatchObject({
      name: 'LutLoadError',
      id: 'kodak-portra',
      status: 404,
    })
    expect(getLutFailure('kodak-portra')?.message).toContain('kodak-portra')
  })

  it('keeps the renderer honest: a load failure is not cached as a success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    )
    await expect(loadLut('teal-orange')).rejects.toThrow()
    // A retry after the network returns must be allowed to succeed, so the
    // failure is not written into the cache as if the strip were loaded.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(bytesOf('public/luts/teal-orange.png'), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
      ),
    )
    const bytes = bytesOf('public/luts/teal-orange.png')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: LUT_SIZE * LUT_SIZE, height: LUT_SIZE, close: () => {}, bytes })),
    )
    const bitmap = await loadLut('teal-orange')
    expect(bitmap.width).toBe(LUT_SIZE * LUT_SIZE)
    expect(getLutFailure('teal-orange')).toBeUndefined()
  })
})
