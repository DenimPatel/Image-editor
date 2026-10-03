/**
 * GLSL ES 3.00 shader sources. All fragment shaders share one fullscreen-quad
 * vertex shader and operate on sRGB-encoded colour (matching the Canvas2D
 * fallback and the original `ctx.filter` behaviour), so switching engines does
 * not shift the look.
 */

export const QUAD_VERT = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

export const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_texel;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`

export const GEOMETRY_FRAG = `${HEADER}
uniform mat3 u_matrix;
uniform vec2 u_sourceSize;
uniform vec2 u_outputSize;
uniform int u_clamp;
uniform vec2 u_origin;
void main() {
  // u_origin is this pass's tile offset inside the whole output frame, so a
  // tiled render addresses the same source pixels the untiled one would.
  vec2 outPos = vec2(u_origin.x + gl_FragCoord.x, u_origin.y + u_outputSize.y - gl_FragCoord.y);
  vec3 src = u_matrix * vec3(outPos, 1.0);
  vec2 uv = src.xy / src.z / u_sourceSize;
  if (u_clamp == 1) {
    uv = clamp(uv, 0.0, 1.0);
  } else if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  // Source is uploaded top-down (flip-Y disabled), so uv already runs top-down.
  outColor = texture(u_tex, uv);
}`

/**
 * D4-F07 and D3-F23 in GLSL, and the twin of `whiteBalance` / `filmicShoulder`
 * in `src/lib/tonemap.ts`. One string rather than two so `TONE_FRAG` and
 * `LOCAL_FRAG` cannot drift into two different white balances — they are meant
 * to be the same edit, and `src/render/parity.test.ts` is what proves it.
 */
const TONEMAP_FUNCTIONS = `vec3 whiteBalance(vec3 c, float l, float delta) {
  float gain = 1.0 + delta / max(l, 1e-6);
  float peak = max(max(c.r, max(c.g, c.b)), 1e-6);
  return c * min(max(gain, 0.0), max(1.0, 1.0 / peak));
}
float shoulder(float x) {
  float rolled = 1.0 + 0.14 * (1.0 - exp(-max(x - 1.0, 0.0) / 0.14));
  return mix(x, rolled, step(1.0, x));
}
`

export const TONE_FRAG = `${HEADER}
${TONEMAP_FUNCTIONS}uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_blackPoint;
uniform float u_brilliance;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 c = texel.rgb;
  c *= exp2(u_exposure);
  c += u_brightness * 0.25;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  float l = luma(c);
  // D4-F07: each channel's gain is its own share of the luma, not the same
  // scalar on all three, so a lift moves luminance and leaves the hue alone.
  c = whiteBalance(c, l, u_shadows * 0.5 * (1.0 - smoothstep(0.0, 0.5, l)));
  c = whiteBalance(c, l, u_highlights * 0.5 * smoothstep(0.5, 1.0, l));
  // Raising the black point must crush the blacks: shift the black level up and
  // rescale what is left, so white stays put. See src/lib/tonemap.ts.
  float bp = u_blackPoint * 0.2;
  c = (c - bp) / max(1.0 - bp, 0.05);
  float mid = smoothstep(0.15, 0.6, l) * (1.0 - smoothstep(0.6, 0.95, l));
  c += u_brilliance * 0.25 * mid;
  // D3-F23: the only pass that runs values past 1.0, and so the only place a
  // blown highlight has anywhere to go other than the clamp on this line. The
  // knee is full scale, so a pure-white pixel is already 1.0 by the time the
  // clamp sees it. See src/lib/tonemap.ts.
  c = vec3(shoulder(c.r), shoulder(c.g), shoulder(c.b));
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`

export const COLOR_FRAG = `${HEADER}
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_warmth;
uniform float u_tint;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 c = texel.rgb;
  float l = luma(c);
  c = mix(vec3(l), c, 1.0 + u_saturation);
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float sat = maxC - minC;
  float vib = u_vibrance * (1.0 - sat);
  c = mix(vec3(luma(c)), c, 1.0 + vib);
  c.r += u_warmth * 0.12;
  c.b -= u_warmth * 0.12;
  c.g -= u_tint * 0.10;
  c.r += u_tint * 0.05;
  c.b += u_tint * 0.05;
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`

export const CURVES_FRAG = `${HEADER}
uniform sampler2D u_lutRgb;
uniform sampler2D u_lutR;
uniform sampler2D u_lutG;
uniform sampler2D u_lutB;
float curve(sampler2D lut, float v) { return texture(lut, vec2(clamp(v, 0.0, 1.0), 0.5)).r; }
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 c = texel.rgb;
  c = vec3(curve(u_lutRgb, c.r), curve(u_lutRgb, c.g), curve(u_lutRgb, c.b));
  c = vec3(curve(u_lutR, c.r), curve(u_lutG, c.g), curve(u_lutB, c.b));
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`

export const HSL_FRAG = `${HEADER}
uniform vec3 u_bands[8];
vec3 rgb2hsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float h = 0.0;
  float s = 0.0;
  float d = maxC - minC;
  if (d > 1e-5) {
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 1.0 / 2.0) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y <= 1e-5) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2rgb(p, q, hsl.x + 1.0 / 3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0 / 3.0));
}
int bandFor(float h) {
  float d = h * 360.0;
  if (d >= 345.0 || d < 15.0) return 0;
  if (d < 45.0) return 1;
  if (d < 75.0) return 2;
  if (d < 165.0) return 3;
  if (d < 195.0) return 4;
  if (d < 265.0) return 5;
  if (d < 315.0) return 6;
  return 7;
}
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 hsl = rgb2hsl(texel.rgb);
  int band = bandFor(hsl.x);
  vec3 shift = u_bands[band];
  hsl.x = fract(hsl.x + shift.x / 360.0);
  hsl.y = clamp(hsl.y * (1.0 + shift.y / 100.0), 0.0, 1.0);
  hsl.z = clamp(hsl.z * (1.0 + shift.z / 100.0), 0.0, 1.0);
  outColor = vec4(hsl2rgb(hsl), texel.a);
}`

export const LUT3D_FRAG = `${HEADER}
uniform sampler2D u_lut;
uniform float u_amount;
uniform float u_size;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 c = texel.rgb;
  float slice = u_size - 1.0;
  float bScaled = clamp(c.b, 0.0, 1.0) * slice;
  float b0 = floor(bScaled);
  float b1 = min(b0 + 1.0, slice);
  float fb = bScaled - b0;
  float rScaled = clamp(c.r, 0.0, 1.0) * slice;
  float gScaled = clamp(c.g, 0.0, 1.0) * slice;
  float texW = u_size * u_size;
  vec2 uv0 = vec2((b0 * u_size + rScaled + 0.5) / texW, (gScaled + 0.5) / u_size);
  vec2 uv1 = vec2((b1 * u_size + rScaled + 0.5) / texW, (gScaled + 0.5) / u_size);
  vec3 graded = mix(texture(u_lut, uv0).rgb, texture(u_lut, uv1).rgb, fb);
  outColor = vec4(mix(c, graded, u_amount), texel.a);
}`

export const BLUR_FRAG = `${HEADER}
uniform float u_radius;
uniform float u_pixelScale;
void main() {
  vec4 sum = texture(u_tex, v_uv);
  float total = 1.0;
  const vec2 dirs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
    vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071)
  );
  float radius = max(0.0, u_radius) * u_pixelScale;
  for (int i = 0; i < 8; i++) {
    float fi = float(i + 1);
    float w = exp(-0.5 * (fi / 3.0) * (fi / 3.0));
    vec2 offset = dirs[i] * u_texel * radius * (fi / 4.0);
    sum += texture(u_tex, v_uv + offset) * w;
    total += w;
  }
  outColor = sum / total;
}`

export const SHARPEN_FRAG = `${HEADER}
uniform float u_amount;
uniform float u_radius;
uniform float u_pixelScale;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec2 r = u_texel * (u_radius * u_pixelScale);
  vec3 blur = texel.rgb * 2.0;
  blur += texture(u_tex, v_uv + vec2(r.x, 0.0)).rgb;
  blur += texture(u_tex, v_uv - vec2(r.x, 0.0)).rgb;
  blur += texture(u_tex, v_uv + vec2(0.0, r.y)).rgb;
  blur += texture(u_tex, v_uv - vec2(0.0, r.y)).rgb;
  blur /= 6.0;
  vec3 detail = texel.rgb - blur;
  outColor = vec4(clamp(texel.rgb + detail * (u_amount * 2.0), 0.0, 1.0), texel.a);
}`

export const DEFINITION_FRAG = `${HEADER}
uniform float u_amount;
uniform float u_radius;
uniform float u_pixelScale;
vec3 ring(vec2 uv, float radius) {
  vec2 r = u_texel * radius;
  vec3 sum = vec3(0.0);
  sum += texture(u_tex, uv + vec2(r.x, 0.0)).rgb;
  sum += texture(u_tex, uv - vec2(r.x, 0.0)).rgb;
  sum += texture(u_tex, uv + vec2(0.0, r.y)).rgb;
  sum += texture(u_tex, uv - vec2(0.0, r.y)).rgb;
  sum += texture(u_tex, uv + vec2(r.x, r.y)).rgb;
  sum += texture(u_tex, uv - vec2(r.x, r.y)).rgb;
  sum += texture(u_tex, uv + vec2(r.x, -r.y)).rgb;
  // The last tap has to be the -x/+y diagonal. Subtracting a negated r.x here
  // repeats the tap above instead, so the average leans one way and the kernel
  // is not a ring at all.
  sum += texture(u_tex, uv + vec2(-r.x, r.y)).rgb;
  return sum / 8.0;
}
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 nearRing = ring(v_uv, u_radius * u_pixelScale);
  vec3 midRing = ring(v_uv, u_radius * 2.0 * u_pixelScale);
  vec3 farRing = ring(v_uv, u_radius * 4.0 * u_pixelScale);
  vec3 detail = (texel.rgb - nearRing) * 0.2
              + (texel.rgb - midRing) * 0.3
              + (texel.rgb - farRing) * 0.5;
  outColor = vec4(clamp(texel.rgb + detail * u_amount, 0.0, 1.0), texel.a);
}`

export const EFFECTS_FRAG = `${HEADER}
uniform float u_grain;
uniform float u_bloom;
uniform float u_fieldBlur;
uniform float u_pixelScale;
uniform vec2 u_origin;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 c = texel.rgb;
  const vec2 dirs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
    vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071)
  );
  if (u_fieldBlur > 0.001) {
    vec3 blur = vec3(0.0);
    float total = 0.0;
    float radius = (2.0 + u_fieldBlur * 40.0) * u_pixelScale;
    for (int i = 0; i < 8; i++) {
      float fi = float(i + 1);
      float w = exp(-0.5 * (fi / 3.0) * (fi / 3.0));
      vec2 offset = dirs[i] * u_texel * radius * (fi / 4.0);
      blur += texture(u_tex, v_uv + offset).rgb * w;
      total += w;
    }
    blur /= total;
    c = mix(c, blur, u_fieldBlur);
  }
  if (u_bloom > 0.001) {
    // The tap is a constant number of output pixels, so its uv step shrinks as
    // the export gets larger. Without the divide the halo is ~3x wider at
    // 6000 px than in the preview.
    float step_ = 0.004 / u_pixelScale;
    vec3 bright = max(c - 0.7, 0.0);
    vec3 halo = vec3(0.0);
    halo += texture(u_tex, v_uv + vec2(step_, 0.0)).rgb;
    halo += texture(u_tex, v_uv - vec2(step_, 0.0)).rgb;
    halo += texture(u_tex, v_uv + vec2(0.0, step_)).rgb;
    halo += texture(u_tex, v_uv - vec2(0.0, step_)).rgb;
    halo = max(halo / 4.0 - 0.7, 0.0);
    c += (halo + bright) * u_bloom * 0.8;
  }
  if (u_grain > 0.001) {
    // Grain cells are a constant two output pixels, anchored to the whole
    // frame (u_origin) rather than to the tile being drawn, so a tiled export
    // has no per-tile restart and the preview matches a 6000 px export.
    vec2 pixel = v_uv / u_texel + u_origin;
    float n = hash(pixel * (0.5 * u_pixelScale)) - 0.5;
    c += n * u_grain * 0.18;
  }
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`

export const VIGNETTE_FRAG = `${HEADER}
uniform float u_amount;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec2 d = v_uv - 0.5;
  float dist = length(d) * 1.4142;
  float mask = smoothstep(0.4, 1.0, dist);
  vec3 c = texel.rgb * (1.0 - u_amount * mask);
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`

/**
 * Evaluates a `Mask` into a single channel. The kinds and their transitions
 * are a transliteration of maskValueAt in src/gl/mask.ts; rasterizeMask
 * there is what the Canvas2D backend runs per pixel, and this is what the GL
 * backend draws into an R8 target — so the parity test is what proves the two
 * evaluations of the same mask agree.
 *
 * u_brushTex carries only the brush stroke field (rasterised on the CPU, because
 * a polyline of arbitrary length has no honest shader expression) and is a
 * 1x1 black texture for every other kind.
 */
export const MASK_FRAG = `${HEADER}
uniform sampler2D u_brushTex;
uniform int u_maskKind;
uniform float u_feather;
uniform float u_invert;
uniform vec2 u_from;
uniform vec2 u_to;
uniform vec2 u_center;
uniform vec2 u_radius;
uniform float u_rotation;
uniform vec2 u_range;
uniform float u_squeeze;
uniform vec2 u_origin;
uniform vec2 u_viewSize;
uniform vec2 u_frameSize;
float band(float a, float b, float t) { return smoothstep(a, max(b, a + 0.001), t); }
void main() {
  vec4 texel = texture(u_tex, v_uv);
  // Mask geometry lives in normalized *output* space, y down. v_uv is bottom-up
  // and runs over this tile, so the frame position is origin + the tile's own
  // extent: a tiled render lands on the same mask a whole-frame one would.
  vec2 p = (u_origin + vec2(v_uv.x, 1.0 - v_uv.y) * u_viewSize) / u_frameSize;
  float feather = max(0.0, u_feather);
  float m = 0.0;
  if (u_maskKind == 0) {
    m = band(0.5 - feather * 0.5, 0.5 + feather * 0.5, texel.a);
  } else if (u_maskKind == 1) {
    m = texture(u_brushTex, vec2(v_uv.x, 1.0 - v_uv.y)).r;
  } else if (u_maskKind == 2) {
    vec2 axis = u_to - u_from;
    float lengthSq = dot(axis, axis);
    if (lengthSq > 1e-12) {
      m = band(0.5 - feather * 0.5, 0.5 + feather * 0.5, dot(p - u_from, axis) / lengthSq);
    }
  } else if (u_maskKind == 3) {
    float rad = radians(-u_rotation);
    vec2 d = p - u_center;
    float rx = d.x * cos(rad) - d.y * sin(rad);
    float ry = (d.x * sin(rad) + d.y * cos(rad)) * u_squeeze;
    float ax = max(0.0001, abs(u_radius.x));
    float ay = max(0.0001, abs(u_radius.y));
    float e = sqrt((rx / ax) * (rx / ax) + (ry / ay) * (ry / ay));
    m = 1.0 - band(1.0 - feather, 1.0 + feather, e);
  } else {
    m = band(u_range.x - feather, u_range.y + feather, luma(texel.rgb));
  }
  if (u_maskKind == 3 || u_maskKind == 4) {
    m = mix(m, 1.0 - m, u_invert);
  }
  outColor = vec4(clamp(m, 0.0, 1.0), 0.0, 0.0, 1.0);
}`

/**
 * One `LocalAdjust`, weighted by its mask. The uniforms and the arithmetic
 * are exactly TONE_FRAG's *adjustments* followed by COLOR_FRAG, so a local
 * adjustment is the same edit as the global one, restricted to the mask - see
 * LOCAL_ADJUST_KEYS in src/gl/mask.ts for why it is these eleven and not the
 * neighbourhood kernels.
 *
 * The filmic shoulder is deliberately absent even though the rest is not: it is
 * the output transfer curve of the global tone stage, not an adjustment, and
 * running it a second time inside a mask would re-grade the whole neighbourhood
 * for an edit the user scoped to a spot.
 */
export const LOCAL_FRAG = `${HEADER}
${TONEMAP_FUNCTIONS}uniform sampler2D u_maskTex;
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_blackPoint;
uniform float u_brilliance;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_warmth;
uniform float u_tint;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  float m = clamp(texture(u_maskTex, v_uv).r, 0.0, 1.0);
  vec3 c = texel.rgb;
  c *= exp2(u_exposure);
  c += u_brightness * 0.25;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  float l = luma(c);
  c = whiteBalance(c, l, u_shadows * 0.5 * (1.0 - smoothstep(0.0, 0.5, l)));
  c = whiteBalance(c, l, u_highlights * 0.5 * smoothstep(0.5, 1.0, l));
  float bp = u_blackPoint * 0.2;
  c = (c - bp) / max(1.0 - bp, 0.05);
  float mid = smoothstep(0.15, 0.6, l) * (1.0 - smoothstep(0.6, 0.95, l));
  c += u_brilliance * 0.25 * mid;
  c = clamp(c, 0.0, 1.0);
  float l2 = luma(c);
  c = mix(vec3(l2), c, 1.0 + u_saturation);
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float sat = maxC - minC;
  float vib = u_vibrance * (1.0 - sat);
  c = mix(vec3(luma(c)), c, 1.0 + vib);
  c.r += u_warmth * 0.12;
  c.b -= u_warmth * 0.12;
  c.g -= u_tint * 0.10;
  c.r += u_tint * 0.05;
  c.b += u_tint * 0.05;
  outColor = vec4(mix(texel.rgb, clamp(c, 0.0, 1.0), m), texel.a);
}`

/** D1-F13: skin smoothing. A bilateral filter; see SMOOTH_RANGE. */
export const RETOUCH_FRAG = `${HEADER}
uniform float u_smooth;
uniform float u_radius;
uniform float u_range;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  if (u_smooth <= 0.0) { outColor = texel; return; }
  const vec2 dirs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
    vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071)
  );
  float lc = luma(texel.rgb);
  vec3 sum = texel.rgb;
  float total = 1.0;
  for (int i = 0; i < 8; i++) {
    float t = float(i + 1) / 4.0;
    for (int k = 0; k < 2; k++) {
      float ring = k == 0 ? t : t * 2.0;
      vec3 s = texture(u_tex, v_uv + dirs[i] * u_texel * u_radius * ring).rgb;
      float d = (luma(s) - lc) / u_range;
      float w = exp(-0.5 * d * d) * exp(-(ring * ring) / 8.0);
      sum += s * w;
      total += w;
    }
  }
  outColor = vec4(mix(texel.rgb, sum / total, u_smooth), texel.a);
}`

/** D1-F13: one heal spot, a rotationally symmetric clone stamp. */
/**
 * The early exits are a bare `return;`, which is what GLSL ES 3.0 actually
 * allows - `main()` is `void`, so `return outColor;` does not compile, and it
 * was this shader that would not compile. The `outColor = texel` before it is
 * the whole early exit: a void return carries no value, so whatever the
 * fragment already wrote is the result.
 */
export const HEAL_FRAG = `${HEADER}
uniform vec2 u_at;
uniform float u_radius;
uniform float u_squeeze;
uniform vec2 u_origin;
uniform vec2 u_viewSize;
uniform vec2 u_frameSize;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  if (u_radius <= 0.0) { outColor = texel; return; }
  vec2 p = (u_origin + vec2(v_uv.x, 1.0 - v_uv.y) * u_viewSize) / u_frameSize;
  vec2 d = p - u_at;
  float dist = length(vec2(d.x, d.y * u_squeeze));
  float w = 1.0 - smoothstep(u_radius * 0.75, u_radius, dist);
  if (w <= 0.0) { outColor = texel; return; }
  // Eight evenly spaced directions over two rings around the spot, so the
  // replacement is rotationally symmetric: a single-source clone stamps the
  // source's structure across the whole disc and cuts a hard wedge.
  vec3 donor = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981634;
    vec2 dir = vec2(cos(a), sin(a));
    for (int k = 0; k < 2; k++) {
      float reach = u_radius * (k == 0 ? 1.4 : 1.9);
      vec2 q = u_at + vec2(dir.x * reach / u_squeeze, dir.y * reach);
      donor += texture(u_tex, vec2(q.x, 1.0 - q.y)).rgb;
      total += 1.0;
    }
  }
  outColor = vec4(mix(texel.rgb, donor / total, w), texel.a);
}`

/** D1-F13: red-eye. Desaturates the iris and pulls it toward the sclera. */
export const REDEYE_FRAG = `${HEADER}
uniform vec2 u_at;
uniform float u_radius;
uniform float u_squeeze;
uniform vec2 u_origin;
uniform vec2 u_viewSize;
uniform vec2 u_frameSize;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  if (u_radius <= 0.0) { outColor = texel; return; }
  vec2 p = (u_origin + vec2(v_uv.x, 1.0 - v_uv.y) * u_viewSize) / u_frameSize;
  vec2 d = p - u_at;
  float dist = length(vec2(d.x, d.y * u_squeeze));
  float w = 1.0 - smoothstep(u_radius * 0.5, u_radius, dist);
  if (w <= 0.0) { outColor = texel; return; }
  float reach = u_radius * 1.8;
  vec2 sx = vec2(reach, 0.0);
  vec2 sy = vec2(0.0, reach / u_squeeze);
  vec3 ring = vec3(0.0);
  ring += texture(u_tex, vec2(p.x + sx.x, 1.0 - p.y)).rgb;
  ring += texture(u_tex, vec2(p.x - sx.x, 1.0 - p.y)).rgb;
  ring += texture(u_tex, vec2(p.x, 1.0 - (p.y + sy.y))).rgb;
  ring += texture(u_tex, vec2(p.x, 1.0 - (p.y - sy.y))).rgb;
  ring /= 4.0;
  float rl = luma(ring);
  vec3 target = mix(ring, vec3(rl), 0.6);
  outColor = vec4(mix(texel.rgb, clamp(target, 0.0, 1.0), w), texel.a);
}`

export const BACKGROUND_FRAG = `${HEADER}
uniform vec3 u_color;
uniform vec3 u_gradientFrom;
uniform vec3 u_gradientTo;
uniform float u_angle;
uniform int u_mode;
uniform int u_fit;
uniform float u_blur;
uniform float u_blurRadius;
uniform vec2 u_imageSize;
uniform vec2 u_frameSize;
uniform float u_pixelScale;
uniform float u_keepAlpha;
uniform sampler2D u_bgImage;
float fitScale() {
  float ratio = (u_frameSize.x / u_frameSize.y) / (u_imageSize.x / u_imageSize.y);
  return (u_frameSize.y / u_imageSize.y) * (u_fit == 1 ? min(ratio, 1.0) : max(ratio, 1.0));
}
vec3 sampleImage(vec2 uv) {
  if (u_blur <= 0.001) { return texture(u_bgImage, uv).rgb; }
  const vec2 dirs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
    vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071)
  );
  // The blur is authored in output pixels, so the step in image space shrinks
  // with the image's scale in the frame and grows with the export.
  float stepTexels = u_blurRadius * u_pixelScale / fitScale();
  vec3 sum = texture(u_bgImage, uv).rgb;
  float total = 1.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i + 1);
    float ring = fi / 4.0;
    float w = exp(-(ring * ring) / 8.0);
    sum += texture(u_bgImage, uv + dirs[i] * stepTexels * ring / u_imageSize).rgb * w;
    total += w;
  }
  return sum / total;
}
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 bg = u_color;
  if (u_mode == 2) {
    float a = radians(u_angle);
    // v_uv is bottom-up, so top-down y is 1.0 - v_uv.y. The direction is
    // (sin, cos) in that top-down frame: 0 degrees runs top to bottom, 90 runs
    // left to right. Centred so a diagonal angle still spans the full ramp.
    float t = clamp((v_uv.x - 0.5) * sin(a) + (0.5 - v_uv.y) * cos(a) + 0.5, 0.0, 1.0);
    bg = mix(u_gradientFrom, u_gradientTo, t);
  } else if (u_mode == 3) {
    // Frame pixels from the centre, top-down, matching backgroundImageUv.
    vec2 px = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_frameSize;
    vec2 uv = px / (fitScale() * u_imageSize) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      bg = u_color;
    } else {
      // uv is already top-down (px came from 0.5 - v_uv.y) and the image is
      // uploaded top-down with flip-Y disabled, so it samples directly.
      bg = sampleImage(uv);
    }
  }
  vec3 composited = mix(bg, texel.rgb, texel.a);
  // A colour, gradient or image background is opaque by construction; only the
  // cut-out mode has to hand the subject's alpha straight through.
  outColor = vec4(composited, u_keepAlpha > 0.5 ? texel.a : 1.0);
}`

/**
 * Copy a tile's core out of its halo-padded framebuffer and into the canvas.
 * Only linked when a render is actually tiled, so a whole-frame render never
 * pays for it.
 */
export const BLIT_FRAG = `${HEADER}
uniform vec4 u_uvRect;
void main() {
  outColor = texture(u_tex, u_uvRect.xy + v_uv * u_uvRect.zw);
}`

/**
 * D3-F23: the output stage, and with it the only 8-bit quantisation step in the
 * chain. The dither lives here rather than on any earlier pass so it can never
 * land on a float intermediate - every pass above this one feeds the next
 * through a target this shader does not own.
 *
 * `u_origin` anchors the pattern to the whole output frame, top-down, the same
 * way `EFFECTS_FRAG` anchors its grain: a tiled export (D3-F18) draws this
 * shader once per tile, and a pattern that restarted at each tile origin would
 * draw a visible seam every eight pixels along every tile edge.
 */
export const OUTPUT_FRAG = `${HEADER}
uniform vec3 u_matte;
uniform int u_flatten;
uniform float u_alpha;
uniform float u_dither;
uniform vec2 u_origin;
float bayer(vec2 p) {
  float v = 0.0;
  vec2 q = mod(floor(p), 8.0);
  for (int i = 0; i < 3; i++) {
    vec2 b = mod(q, 2.0);
    q = floor(q * 0.5);
    // b.x + b.y - 2.0 * b.x * b.y is the xor of two 0/1 values.
    v = v * 4.0 + 2.0 * b.y + (b.y + b.x - 2.0 * b.y * b.x);
  }
  return (v + 0.5) / 64.0;
}
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 c = texel.rgb;
  float a = texel.a;
  if (u_flatten == 1) {
    c = mix(u_matte, c, texel.a);
    a = 1.0;
  } else if (u_alpha <= 0.5) {
    a = 1.0;
  }
  // v_uv is bottom-up, so the top-down frame row is the height minus it. The
  // CPU twin walks the buffer top-down, and the two have to agree on which
  // pixel of the frame this is or the two engines transpose the pattern.
  vec2 pixel = vec2(v_uv.x / u_texel.x, 1.0 / u_texel.y - v_uv.y / u_texel.y) + u_origin;
  c += (bayer(pixel) - 0.5) * u_dither * (1.0 / 255.0);
  outColor = vec4(c, a);
}`
