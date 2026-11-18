/** Procedural noise helpers shared by the lakebed, logs and caustics shaders. */
export const noiseGlsl = /* glsl */ `
#ifndef PIKE_NOISE
#define PIKE_NOISE
float nzHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Value noise in 0..1.
float nzValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = nzHash(i);
  float b = nzHash(i + vec2(1.0, 0.0));
  float c = nzHash(i + vec2(0.0, 1.0));
  float d = nzHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 4-octave fbm in 0..1.
float nzFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * nzValue(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s;
}
#endif`;
