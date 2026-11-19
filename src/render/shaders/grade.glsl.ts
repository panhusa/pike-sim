/** Final colour pass: underwater heat-shimmer warp, vignette and a per-style grade. Runs on linear colour before OutputPass. */
export const gradeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const gradeFragment = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uWarp;      // uv amplitude; 0 above water
uniform float uVignette;  // 0..1 darkening at the corners
uniform float uSaturation;
uniform float uContrast;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  uv += uWarp * vec2(sin(uv.y * 38.0 + uTime * 1.7), cos(uv.x * 31.0 + uTime * 1.3));
  vec4 c = texture2D(tDiffuse, uv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, uSaturation);
  c.rgb = (c.rgb - 0.18) * uContrast + 0.18;
  vec2 d = vUv - 0.5;
  c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.75, dot(d, d) * 2.0);
  gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
}`;
