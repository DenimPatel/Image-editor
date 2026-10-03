/**
 * The 24 "look" 3D LUTs, as deterministic recipes rather than binaries.
 *
 * A .cube/.png look is a black box: you cannot review a diff of it, you cannot
 * tell a reviewer what changed, and regenerating it needs whatever proprietary
 * tool produced it. Every look here is a short declarative spec over a small set
 * of grading operators, so `public/luts/*.png` is reproducible output that any
 * reviewer can read, and `npm run luts:gen -- --check` proves the committed
 * bytes still match the recipe.
 *
 * Nothing here is sampled from a real film scan: these are *evocations* in the
 * sense the Filters panel implies (a warm Portra-ish look, a teal/orange grade),
 * authored from first principles so the app ships with no third-party LUT
 * licences attached.
 *
 * ── Strip layout ────────────────────────────────────────────────────────────
 * `LUT3D_FRAG` (src/gl/shaders/index.ts) addresses the texture as:
 *
 *   texW = u_size * u_size
 *   uv   = vec2((b * u_size + r + 0.5) / texW, (g + 0.5) / u_size)
 *
 * so the image is `u_size * u_size` texels wide and `u_size` tall, with
 *
 *   column x = blue * u_size + red      (blue selects the horizontal slice)
 *   row    y = green                     (green is the vertical axis)
 *
 * `createTexture` uploads with `UNPACK_FLIP_Y_WEBGL = false`
 * (src/gl/texture.ts:22), so GL's v = 0 is the *first row of the PNG*: green 0
 * is the top row, not the bottom. `src/lib/assets/assetIntegrity.test.ts` pins
 * that assumption against the real shader source and against the real files.
 */

import { encodeRgbPng } from './png.mjs'

/**
 * @typedef {{ lift?: number, gamma?: number, gain?: number }} ChannelLgg
 * @typedef {{ shadow: number[], highlight: number[], amount?: number, balance?: number }} SplitToneSpec
 * @typedef {{
 *   exposure?: number,
 *   balance?: number[],
 *   mix?: number[],
 *   lgg?: ChannelLgg[],
 *   contrast?: number,
 *   sat?: number,
 *   split?: SplitToneSpec,
 *   shoulder?: number,
 * }} LookSpec
 * @typedef {{ id: string, family: string, spec: LookSpec }} LutLook
 */

export const LUT_SIZE = 33
export const LUT_STRIP_WIDTH = LUT_SIZE * LUT_SIZE
export const LUT_STRIP_HEIGHT = LUT_SIZE

// ── colour space helpers ────────────────────────────────────────────────────

const clamp01 = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v)

const srgbToLinear = (/** @type {number} */ v) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)

const linearToSrgb = (/** @type {number} */ v) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055

const luminance = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b

/** The `SHOULDER_HEADROOM` of the tone stage's twin, in src/lib/tonemap.ts. */
const SHOULDER_HEADROOM = 0.14

// ── grading operators (all in display-referred 0..1 unless noted) ───────────

/** Multiplicative gain in linear light, where 1 = 2^stops. */
/** @param {number[]} rgb @param {number} stops */
function exposure(rgb, stops) {
  const k = Math.pow(2, stops)
  return rgb.map((c) => c * k)
}

/** Per-channel linear gain, the cheap white-balance approximation. */
/** @param {number[]} rgb @param {number[]} gains @returns {number[]} */
function balance(rgb, gains) {
  return rgb.map((c, i) => c * gains[i])
}

/** 3x3 channel mixer, row-major. The only way to cross channels. */
/** @param {number[]} rgb @param {number[]} m @returns {number[]} */
function channelMix(rgb, m) {
  const [r, g, b] = rgb
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ]
}

/**
 * Contrast as a smooth S pinned at 0 and 1. A plain `x^gamma` would move the
 * black point, which is what makes naive contrast crush or milk the toe; the
 * two-sided curve below only bends the middle. A negative `amount` is the same
 * curve applied to the complement, i.e. a flat, milky look.
 *
 * The clamp is load-bearing. Without it this evaluated `1 - c` on a value a
 * preceding gain had pushed past 1, and `Math.pow(-0.06, 1.1)` is NaN — which
 * `Math.round` turned into 0, so every look's pure-white node was silently
 * black. `assertStripIsSound` in gen-luts.mjs now refuses to write that.
 */
/** @param {number[]} rgb @param {number} amount @returns {number[]} */
function contrast(rgb, amount) {
  if (amount === 0) return rgb
  const k = Math.abs(amount)
  const flat = amount < 0
  return rgb.map((c) => {
    const x = flat ? 1 - clamp01(c) : clamp01(c)
    const y = x < 0.5 ? 0.5 * Math.pow(2 * x, 1 + k) : 1 - 0.5 * Math.pow(2 * (1 - x), 1 + k)
    return flat ? 1 - y : y
  })
}

/** Lift/gamma/gain per channel — the three knobs a colourist reaches for first. */
/** @param {number[]} rgb @param {ChannelLgg[]} spec @returns {number[]} */
function lgg(rgb, spec) {
  return rgb.map((c, i) => {
    const { lift = 0, gamma = 1, gain = 1 } = spec[i]
    const lifted = Math.pow(Math.max(0, c + lift * (1 - c)), 1 / gamma)
    return lifted * gain
  })
}

/** @param {number[]} rgb @param {number} amount @returns {number[]} */
function saturate(rgb, amount) {
  const l = luminance(rgb[0], rgb[1], rgb[2])
  return rgb.map((c) => clamp01(l + (c - l) * amount))
}

/** Tint the shadows one way and the highlights the other. */
/** @param {number[]} rgb @param {SplitToneSpec} spec @returns {number[]} */
function splitTone(rgb, spec) {
  const { shadow, highlight, amount = 0.1, balance = 0.5 } = spec
  const t = clamp01(luminance(rgb[0], rgb[1], rgb[2]))
  const wShadow = Math.pow(1 - t, Math.max(0.2, balance * 2))
  const wHigh = Math.pow(t, Math.max(0.2, (1 - balance) * 2))
  return rgb.map((c, i) => c + amount * (wShadow * shadow[i] + wHigh * highlight[i]))
}

/**
 * Highlight shoulder. The identity up to full scale, then a rolloff with unit
 * slope at 1.0 that asymptotes to 1.14, so pure white stays white and only the
 * blown range is compressed. `strength` blends between a hard clip (0) and the
 * full rolloff (1).
 *
 * The knee is 1.0 and not the 0.86 this used to default to. An exponential that
 * asymptotes at 1 arrives at it by definition, so a knee below 1 put the
 * asymptote below the pixel's own value: every look carrying a shoulder shipped
 * with a dim baked into it, and a pure-white corner came out at 242/255. The
 * rolloff can only be the identity below 1 *and* approach 1 from above, so 1.0
 * is where it starts. It also matches the operator the tone stage runs
 * (`src/lib/tonemap.ts`), which is what the docs call the same curve.
 *
 * @param {number} x @param {number} strength @returns {number}
 */
export function shoulder(x, strength) {
  if (x <= 1) return x
  const rolled = 1 + SHOULDER_HEADROOM * (1 - Math.exp(-(x - 1) / SHOULDER_HEADROOM))
  // Blended against the hard clip, not against `x`: the clip is what the rolloff
  // is replacing, and interpolating towards `x` would *add* the rolloff on top of
  // the input instead of replacing it.
  return 1 + (rolled - 1) * clamp01(strength)
}

// ── the grade pipeline ──────────────────────────────────────────────────────

/**
 * One look is a spec over the operators above. Anything omitted is a no-op, so
 * a spec reads as the *difference* this look makes rather than as boilerplate.
 */
/** @param {LookSpec} spec @param {number[]} rgb @returns {number[]} */
export function grade(spec, rgb) {
  let [r, g, b] = rgb
  let lin = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
  if (spec.exposure) lin = exposure(lin, spec.exposure)
  if (spec.balance) lin = balance(lin, spec.balance)
  if (spec.mix) lin = channelMix(lin, spec.mix)

  let c = lin.map(linearToSrgb)
  c = c.map((v) => clamp01(v))
  if (spec.lgg) c = lgg(c, spec.lgg)
  if (spec.contrast) c = contrast(c, spec.contrast)
  if (spec.sat !== undefined) c = saturate(c, spec.sat)
  if (spec.split) c = splitTone(c, spec.split)
  const strength = spec.shoulder ?? 0
  if (strength > 0) c = c.map((v) => shoulder(v, strength))
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]
}

// ── the 24 looks ────────────────────────────────────────────────────────────

/**
 * `id` must match `LUT_PRESETS` in src/gl/luts.ts: that list is the catalogue
 * the panel renders and the filename the loader fetches. `family` is repeated
 * here only so the generator can report it; the panel groups by its own copy.
 */
/** @type {LutLook[]} */
export const LOOKS = [
  {
    id: 'kodak-portra',
    family: 'Film',
    spec: {
      exposure: -0.19,
      balance: [1.05, 1, 0.94],
      lgg: [
        { lift: 0.06, gamma: 1.02 },
        { lift: 0.055, gamma: 1.02, gain: 0.98 },
        { lift: 0.065, gamma: 1.05, gain: 0.95 },
      ],
      contrast: -0.16,
      sat: 0.84,
      split: {
        shadow: [-0.01, 0.015, 0.035],
        highlight: [0.035, 0.015, -0.02],
        amount: 0.4,
        balance: 0.55,
      },
      shoulder: 0.65,
    },
  },
  {
    id: 'kodak-gold',
    family: 'Film',
    spec: {
      exposure: 0.12,
      balance: [1.06, 1, 0.86],
      lgg: [
        { lift: 0.03, gamma: 0.9, gain: 1.08 },
        { lift: 0.03, gamma: 0.98 },
        { lift: 0.02, gamma: 1.06, gain: 0.8 },
      ],
      contrast: 0.44,
      sat: 1.3,
      split: {
        shadow: [0, 0.01, 0.05],
        highlight: [0.05, 0.02, -0.05],
        amount: 0.5,
        balance: 0.5,
      },
      shoulder: 0.85,
    },
  },
  {
    id: 'kodak-ektar',
    family: 'Film',
    spec: {
      exposure: 0.06,
      balance: [1.04, 1, 0.94],
      lgg: [
        { lift: 0.01, gamma: 0.92, gain: 1.08 },
        { lift: 0.015 },
        { lift: 0.015, gamma: 1.05, gain: 0.9 },
      ],
      contrast: 0.52,
      sat: 1.44,
      split: {
        shadow: [-0.05, 0.01, 0.07],
        highlight: [0.03, 0.01, -0.02],
        amount: 0.45,
        balance: 0.45,
      },
      shoulder: 0.8,
    },
  },
  {
    id: 'fuji-velvia',
    family: 'Film',
    spec: {
      exposure: 0.02,
      balance: [1.06, 0.99, 0.97],
      lgg: [
        { gamma: 0.86, gain: 1.12 },
        { lift: 0.005, gain: 0.98 },
        { gamma: 1.03, gain: 1.02 },
      ],
      contrast: 0.6,
      sat: 1.66,
      split: {
        shadow: [0.06, -0.03, 0.06],
        highlight: [0.035, 0, 0.015],
        amount: 0.4,
        balance: 0.35,
      },
      shoulder: 0.85,
    },
  },
  {
    id: 'fuji-superia',
    family: 'Film',
    spec: {
      exposure: 0,
      balance: [0.95, 1, 1.07],
      lgg: [{ lift: 0.05, gain: 0.99 }, { lift: 0.055, gamma: 1.01, gain: 0.98 }, { lift: 0.05 }],
      contrast: -0.01,
      sat: 0.9,
      split: {
        shadow: [-0.03, 0.015, 0.05],
        highlight: [-0.055, 0.005, 0.035],
        amount: 0.6,
        balance: 0.6,
      },
      shoulder: 0.6,
    },
  },
  {
    id: 'fuji-provia',
    family: 'Film',
    spec: {
      exposure: 0,
      balance: [0.99, 1, 1.05],
      lgg: [
        { lift: 0.005, gamma: 0.88, gain: 1.1 },
        { lift: 0.01, gamma: 0.875 },
        { lift: 0.01, gamma: 1.02, gain: 1.01 },
      ],
      contrast: 0.48,
      sat: 1.22,
      split: {
        shadow: [-0.02, -0.005, 0.06],
        highlight: [0.01, 0.005, 0.015],
        amount: 0.4,
        balance: 0.45,
      },
      shoulder: 0.78,
    },
  },
  {
    id: 'cinestill-800t',
    family: 'Film',
    spec: {
      exposure: 0.18,
      balance: [1, 0.99, 1.08],
      lgg: [
        { lift: 0.03, gamma: 0.98 },
        { lift: 0.04, gamma: 1.04, gain: 0.99 },
        { lift: 0.05, gamma: 1.02, gain: 1.04 },
      ],
      contrast: 0.3,
      sat: 1.06,
      split: {
        shadow: [-0.07, 0.015, 0.09],
        highlight: [0.06, 0.015, 0.005],
        amount: 0.85,
        balance: 0.28,
      },
      shoulder: 0.9,
    },
  },
  {
    id: 'agfa-vista',
    family: 'Film',
    spec: {
      exposure: 0.06,
      balance: [1.01, 1, 1],
      lgg: [
        { lift: 0.01, gamma: 0.96, gain: 1.03 },
        { lift: 0.012 },
        { lift: 0.012, gamma: 0.955, gain: 0.98 },
      ],
      contrast: 0.24,
      sat: 1.17,
      shoulder: 0.7,
    },
  },
  {
    id: 'polaroid-600',
    family: 'Film',
    spec: {
      exposure: 0.3,
      balance: [1.07, 1, 0.86],
      lgg: [
        { lift: 0.13, gamma: 0.95, gain: 0.99 },
        { lift: 0.13, gamma: 0.98, gain: 0.95 },
        { lift: 0.11, gamma: 1.02, gain: 0.87 },
      ],
      contrast: -0.28,
      sat: 0.9,
      split: {
        shadow: [-0.09, 0.03, 0.13],
        highlight: [0.11, 0.06, -0.05],
        amount: 0.8,
        balance: 0.5,
      },
      shoulder: 0.4,
    },
  },
  {
    id: 'lomo',
    family: 'Creative',
    spec: {
      exposure: 0.08,
      balance: [1.03, 0.98, 1.02],
      lgg: [
        { lift: 0.04, gamma: 0.92, gain: 1.06 },
        { lift: 0.03, gain: 0.98 },
        { lift: 0.05, gamma: 1.05, gain: 1.02 },
      ],
      contrast: 0.36,
      sat: 1.55,
      split: {
        shadow: [-0.08, 0.01, 0.1],
        highlight: [0.08, 0.02, 0.01],
        amount: 0.8,
        balance: 0.32,
      },
      shoulder: 0.8,
    },
  },
  {
    id: 'cross-process',
    family: 'Creative',
    spec: {
      exposure: 0.06,
      mix: [0.95, 0.35, 0.2, 0.15, 0.9, 0.25, 0.1, 0.2, 1.05],
      lgg: [
        { lift: 0.02, gamma: 0.88, gain: 1.1 },
        { lift: 0.05, gamma: 1.06, gain: 0.95 },
        { lift: 0.02, gamma: 0.94 },
      ],
      contrast: 0.42,
      sat: 1.5,
      split: {
        shadow: [-0.09, 0.02, 0.12],
        highlight: [0.09, 0.035, -0.07],
        amount: 0.8,
        balance: 0.35,
      },
      shoulder: 0.7,
    },
  },
  {
    id: 'bleach-bypass',
    family: 'Creative',
    spec: {
      exposure: -0.05,
      lgg: [
        { gamma: 0.86, gain: 1.06 },
        { gamma: 0.88, gain: 1.06 },
        { gamma: 0.9, gain: 1.06 },
      ],
      contrast: 0.62,
      sat: 0.48,
      shoulder: 0.9,
    },
  },
  {
    id: 'vintage-fade',
    family: 'Creative',
    spec: {
      exposure: 0.1,
      balance: [1.1, 1, 0.83],
      lgg: [
        { lift: 0.12, gamma: 0.94, gain: 0.98 },
        { lift: 0.11, gamma: 1.02, gain: 0.95 },
        { lift: 0.08, gamma: 1.02, gain: 0.89 },
      ],
      contrast: -0.2,
      sat: 0.74,
      split: {
        shadow: [0.015, 0.02, -0.045],
        highlight: [0.05, 0.025, -0.13],
        amount: 0.58,
        balance: 0.5,
      },
      shoulder: 0.5,
    },
  },
  {
    id: 'faded-matte',
    family: 'Creative',
    spec: {
      exposure: 0.16,
      lgg: [
        { lift: 0.17, gain: 0.9 },
        { lift: 0.17, gain: 0.9 },
        { lift: 0.15, gamma: 1.02, gain: 0.93 },
      ],
      contrast: -0.5,
      sat: 0.4,
      split: {
        shadow: [-0.03, 0.015, 0.005],
        highlight: [0.015, 0.015, 0.005],
        amount: 0.45,
        balance: 0.6,
      },
      shoulder: 0.3,
    },
  },
  {
    id: 'warm-cinema',
    family: 'Cinematic',
    spec: {
      exposure: 0.03,
      balance: [1.125, 1, 0.845],
      lgg: [
        { lift: 0.02, gamma: 0.93, gain: 1.04 },
        { lift: 0.02 },
        { lift: 0.03, gamma: 1.06, gain: 0.95 },
      ],
      contrast: 0.26,
      sat: 1,
      split: {
        shadow: [-0.06, 0.01, 0.07],
        highlight: [0.07, 0.025, -0.065],
        amount: 0.7,
        balance: 0.34,
      },
      shoulder: 0.85,
    },
  },
  {
    id: 'cool-cinema',
    family: 'Cinematic',
    spec: {
      exposure: 0.05,
      balance: [0.89, 0.99, 1.15],
      lgg: [{ lift: 0.02, gamma: 0.98 }, { lift: 0.02 }, { lift: 0.02, gamma: 1.03, gain: 1.05 }],
      contrast: 0.33,
      sat: 0.82,
      split: {
        shadow: [-0.04, -0.005, 0.07],
        highlight: [-0.01, 0, 0.05],
        amount: 0.58,
        balance: 0.45,
      },
      shoulder: 0.85,
    },
  },
  {
    id: 'teal-orange',
    family: 'Cinematic',
    spec: {
      exposure: -0.02,
      lgg: [{ gamma: 0.94, gain: 1.05 }, {}, { gamma: 1.04 }],
      contrast: 0.3,
      sat: 1.2,
      split: {
        shadow: [-0.12, 0.025, 0.15],
        highlight: [0.12, 0.04, -0.09],
        amount: 1,
        balance: 0.24,
      },
      shoulder: 0.88,
    },
  },
  {
    id: 'moody',
    family: 'Cinematic',
    spec: {
      exposure: -0.22,
      lgg: [
        { gamma: 0.9, gain: 0.95 },
        { lift: 0.005, gamma: 0.94, gain: 0.97 },
        { lift: 0.01, gamma: 0.98, gain: 1.02 },
      ],
      contrast: 0.46,
      sat: 0.68,
      split: {
        shadow: [-0.06, -0.01, 0.07],
        highlight: [0.03, 0.01, 0],
        amount: 0.6,
        balance: 0.34,
      },
      shoulder: 0.8,
    },
  },
  {
    id: 'cyberpunk',
    family: 'Cinematic',
    spec: {
      exposure: -0.02,
      balance: [1.02, 0.97, 1.06],
      lgg: [
        { lift: 0.02, gamma: 0.88, gain: 1.06 },
        { gamma: 0.94, gain: 0.98 },
        { lift: 0.02, gamma: 1.04, gain: 1.06 },
      ],
      contrast: 0.54,
      sat: 1.44,
      split: {
        shadow: [0.02, -0.05, 0.14],
        highlight: [0.13, -0.04, 0.06],
        amount: 0.95,
        balance: 0.3,
      },
      shoulder: 0.9,
    },
  },
  {
    id: 'infrared',
    family: 'Creative',
    spec: {
      mix: [0.7, 0.72, 0.2, 0.42, 0.18, 0.78, 0.26, 0.52, 0.78],
      lgg: [
        { lift: 0.03, gamma: 0.95, gain: 1.04 },
        { lift: 0.02, gain: 0.98 },
        { lift: 0.02, gamma: 0.98, gain: 1.02 },
      ],
      contrast: 0.34,
      sat: 1.15,
      shoulder: 0.8,
    },
  },
  {
    id: 'noir',
    family: 'Mono',
    spec: {
      lgg: [
        { gamma: 0.85, gain: 1.08 },
        { gamma: 0.85, gain: 1.08 },
        { gamma: 0.85, gain: 1.08 },
      ],
      contrast: 0.58,
      sat: 0,
      shoulder: 0.9,
    },
  },
  {
    id: 'sepia',
    family: 'Mono',
    spec: {
      lgg: [
        { lift: 0.06, gamma: 0.94, gain: 1.04 },
        { lift: 0.05, gamma: 0.96 },
        { lift: 0.02, gain: 0.96 },
      ],
      contrast: 0.28,
      sat: 0,
      split: {
        shadow: [0.075, 0.022, -0.062],
        highlight: [0.062, 0.012, -0.055],
        amount: 0.85,
        balance: 0.5,
      },
      shoulder: 0.7,
    },
  },
  {
    id: 'pastel',
    family: 'Creative',
    spec: {
      exposure: 0.1,
      balance: [1.03, 0.99, 1.03],
      lgg: [
        { lift: 0.05, gamma: 1.28 },
        { lift: 0.05, gamma: 1.26 },
        { lift: 0.05, gamma: 1.24 },
      ],
      contrast: -0.34,
      sat: 0.66,
      split: {
        shadow: [-0.02, 0.03, 0.02],
        highlight: [0.05, 0.005, 0.035],
        amount: 0.55,
        balance: 0.5,
      },
      shoulder: 0.35,
    },
  },
  {
    id: 'vivid',
    family: 'Creative',
    spec: {
      exposure: 0.06,
      lgg: [
        { gamma: 0.875, gain: 1.08 },
        { gamma: 0.995, gain: 1.06 },
        { gamma: 0.94, gain: 1.06 },
      ],
      contrast: 0.3,
      sat: 1.9,
      split: {
        shadow: [-0.045, 0, 0.055],
        highlight: [0.045, 0.015, 0.005],
        amount: 0.45,
        balance: 0.45,
      },
      shoulder: 0.85,
    },
  },
]

export const LUT_IDS = LOOKS.map((look) => look.id)

/** @param {string} id @returns {LutLook | undefined} */
export function lookById(id) {
  return LOOKS.find((look) => look.id === id)
}

// ── strip raster ────────────────────────────────────────────────────────────

/**
 * Build the `1089 x 33` RGB strip for one look. `LUT3D_FRAG` samples column
 * `blue * 33 + red` at row `green`, so that is exactly what is written here; see
 * the layout note at the top of this file.
 */
/** @param {string} id @returns {Uint8Array} */
export function buildStrip(id) {
  const look = lookById(id)
  if (!look) throw new Error(`Unknown look "${id}"`)
  const rgb = new Uint8Array(LUT_STRIP_WIDTH * LUT_STRIP_HEIGHT * 3)
  const last = LUT_SIZE - 1
  let offset = 0
  for (let green = 0; green < LUT_SIZE; green += 1) {
    const g = green / last
    for (let blue = 0; blue < LUT_SIZE; blue += 1) {
      const b = blue / last
      for (let red = 0; red < LUT_SIZE; red += 1) {
        const out = grade(look.spec, [red / last, g, b])
        rgb[offset] = Math.round(out[0] * 255)
        rgb[offset + 1] = Math.round(out[1] * 255)
        rgb[offset + 2] = Math.round(out[2] * 255)
        offset += 3
      }
    }
  }
  return rgb
}

/** @param {string} id @returns {Uint8Array} */
export function generateStripPng(id) {
  return encodeRgbPng(LUT_STRIP_WIDTH, LUT_STRIP_HEIGHT, buildStrip(id))
}
