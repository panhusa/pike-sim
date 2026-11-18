import { absorptionPars } from "./absorption.glsl";

/** cos(48.6 deg): rays steeper than this from the surface normal leave the water (Snell's window). */
export const SNELL_COS = Math.cos((48.6 * Math.PI) / 180);

export const snellVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** Surface from below: sky disc inside the critical cone, total internal reflection (deep colour) outside. */
export const snellFragment = /* glsl */ `
${absorptionPars}
uniform float uTime;
uniform vec3 uSky;
uniform vec3 uSkyEdge;
uniform sampler2D uNoise;
varying vec3 vWorld;
const float SNELL_COS = ${SNELL_COS.toFixed(5)};

// Gradient of a few summed travelling sines.
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = vec2(0.8, 0.6), d2 = vec2(-0.5, 0.87), d3 = vec2(0.17, -0.98);
  g += d1 * 0.030 * 2.1 * cos(dot(d1, p) * 2.1 + t * 1.7);
  g += d2 * 0.020 * 3.3 * cos(dot(d2, p) * 3.3 + t * 2.3);
  g += d3 * 0.012 * 5.7 * cos(dot(d3, p) * 5.7 + t * 3.1);
  return g;
}

void main() {
  vec2 p = vWorld.xz;
  vec2 g = waveGrad(p, uTime);
  g += (texture2D(uNoise, p * 0.07 + vec2(uTime * 0.012, uTime * 0.007)).rg - 0.5) * 0.1;
  g += (texture2D(uNoise, p * 0.23 - vec2(uTime * 0.017, -uTime * 0.011)).rg - 0.5) * 0.06;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(vWorld - cameraPosition);
  float cosI = abs(dot(v, n));
  float inWindow = smoothstep(SNELL_COS - 0.025, SNELL_COS + 0.025, cosI);
  // The whole sky hemisphere is squeezed into the disc: zenith in the centre, horizon at the rim.
  vec3 sky = mix(uSkyEdge, uSky, smoothstep(SNELL_COS, 1.0, cosI));
  float rim = exp(-pow((cosI - SNELL_COS) * 22.0, 2.0)) * 0.35;
  vec3 mirror = uWaterDeep * 0.7;
  vec3 col = mix(mirror, sky, inWindow) + uSkyEdge * rim;
  float f = 1.0 - exp(-uWaterDensity * length(vWorld - cameraPosition));
  col = mix(col, waterRayTint(vWorld), f);
  gl_FragColor = vec4(col, mix(0.9, 1.0, inWindow));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
