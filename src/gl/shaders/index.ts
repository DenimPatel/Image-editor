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
}`;

export const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform vec2 u_texel;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const GEOMETRY_FRAG = `${HEADER}
uniform mat3 u_matrix;
uniform vec2 u_sourceSize;
uniform vec2 u_outputSize;
void main() {
  vec2 outPos = vec2(gl_FragCoord.x, u_outputSize.y - gl_FragCoord.y);
  vec3 src = u_matrix * vec3(outPos, 1.0);
  vec2 uv = src.xy / src.z / u_sourceSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  outColor = texture(u_tex, vec2(uv.x, 1.0 - uv.y));
}`;

export const TONE_FRAG = `${HEADER}
uniform float u_exposure;
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
  c += u_shadows * 0.5 * (1.0 - smoothstep(0.0, 0.5, l));
  c += u_highlights * 0.5 * smoothstep(0.5, 1.0, l);
  float bp = 1.0 - u_blackPoint * 0.2;
  c = (c - u_blackPoint * 0.2) / max(bp, 0.05);
  float mid = smoothstep(0.15, 0.6, l) * (1.0 - smoothstep(0.6, 0.95, l));
  c += u_brilliance * 0.25 * mid;
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`;

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
}`;

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
}`;

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
}`;

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
}`;

export const BLUR_FRAG = `${HEADER}
uniform float u_radius;
void main() {
  vec4 sum = texture(u_tex, v_uv);
  float total = 1.0;
  const vec2 dirs[8] = vec2[8](
    vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
    vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071)
  );
  for (int i = 0; i < 8; i++) {
    float fi = float(i + 1);
    float w = exp(-0.5 * (fi / 3.0) * (fi / 3.0));
    vec2 offset = dirs[i] * u_radius * u_texel * (fi / 4.0);
    sum += texture(u_tex, v_uv + offset) * w;
    total += w;
  }
  outColor = sum / total;
}`;

export const SHARPEN_FRAG = `${HEADER}
uniform float u_amount;
uniform float u_definition;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 blur = vec3(0.0);
  blur += texture(u_tex, v_uv + vec2(-u_texel.x, 0.0)).rgb;
  blur += texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb;
  blur += texture(u_tex, v_uv + vec2(0.0, -u_texel.y)).rgb;
  blur += texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb;
  blur += texture(u_tex, v_uv + vec2(-u_texel.x, -u_texel.y)).rgb;
  blur += texture(u_tex, v_uv + vec2(u_texel.x, -u_texel.y)).rgb;
  blur += texture(u_tex, v_uv + vec2(-u_texel.x, u_texel.y)).rgb;
  blur += texture(u_tex, v_uv + vec2(u_texel.x, u_texel.y)).rgb;
  blur /= 8.0;
  vec3 detail = texel.rgb - blur;
  vec3 c = texel.rgb + detail * (u_amount * 1.6);
  // Definition adds a broader local-contrast term.
  vec3 wide = texture(u_tex, v_uv).rgb;
  c += (texel.rgb - wide) * 0.0;
  c += detail * (u_definition * 0.6);
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`;

export const EFFECTS_FRAG = `${HEADER}
uniform float u_grain;
uniform float u_bloom;
uniform float u_fieldBlur;
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
    for (int i = 0; i < 8; i++) {
      float fi = float(i + 1);
      float w = exp(-0.5 * (fi / 3.0) * (fi / 3.0));
      vec2 offset = dirs[i] * u_texel * (2.0 + u_fieldBlur * 40.0) * (fi / 4.0);
      blur += texture(u_tex, v_uv + offset).rgb * w;
      total += w;
    }
    blur /= total;
    c = mix(c, blur, u_fieldBlur);
  }
  if (u_bloom > 0.001) {
    vec3 bright = max(c - 0.7, 0.0);
    vec3 halo = vec3(0.0);
    halo += texture(u_tex, v_uv + vec2(0.004, 0.0)).rgb;
    halo += texture(u_tex, v_uv - vec2(0.004, 0.0)).rgb;
    halo += texture(u_tex, v_uv + vec2(0.0, 0.004)).rgb;
    halo += texture(u_tex, v_uv - vec2(0.0, 0.004)).rgb;
    halo = max(halo / 4.0 - 0.7, 0.0);
    c += (halo + bright) * u_bloom * 0.8;
  }
  if (u_grain > 0.001) {
    float n = hash(v_uv * 1024.0) - 0.5;
    c += n * u_grain * 0.18;
  }
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`;

export const VIGNETTE_FRAG = `${HEADER}
uniform float u_amount;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec2 d = v_uv - 0.5;
  float dist = length(d) * 1.4142;
  float mask = smoothstep(0.4, 1.0, dist);
  vec3 c = texel.rgb * (1.0 - u_amount * mask);
  outColor = vec4(clamp(c, 0.0, 1.0), texel.a);
}`;

export const BACKGROUND_FRAG = `${HEADER}
uniform vec3 u_color;
uniform vec3 u_gradientFrom;
uniform vec3 u_gradientTo;
uniform float u_angle;
uniform int u_mode;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  vec3 bg = u_color;
  if (u_mode == 2) {
    float a = radians(u_angle);
    float t = clamp(v_uv.x * cos(a) + (1.0 - v_uv.y) * sin(a), 0.0, 1.0);
    bg = mix(u_gradientFrom, u_gradientTo, t);
  }
  outColor = vec4(mix(bg, texel.rgb, texel.a), 1.0);
}`;

export const OUTPUT_FRAG = `${HEADER}
uniform vec3 u_matte;
uniform int u_flatten;
void main() {
  vec4 texel = texture(u_tex, v_uv);
  if (u_flatten == 1) {
    outColor = vec4(mix(u_matte, texel.rgb, texel.a), 1.0);
  } else {
    outColor = texel;
  }
}`;