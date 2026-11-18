import { noiseGlsl } from "./noise.glsl";

/** Animated caustic light patterns on lit materials (via applyCaustics). Runs before the water absorption. */

export const causticVertexPars = /* glsl */ `
varying vec3 vCausticWorld;`;

/** Vertex body; runs after <project_vertex>. Mirrors three's instancing. */
export const causticVertex = /* glsl */ `
vec4 causticWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
causticWp = instanceMatrix * causticWp;
#endif
vCausticWorld = (modelMatrix * causticWp).xyz;`;

export const causticFragmentPars = /* glsl */ `
uniform float uTime;
uniform float uWaterLight;
varying vec3 vCausticWorld;
${noiseGlsl}

// Mirror of causticStrength() in water.ts: depth fade times the day/night blend.
float causticStrength(float depthM, float light) {
  float t = clamp((light - 0.04) / 0.86, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t) * exp(-depthM * 0.55);
}

// Two crossing ridged-noise layers drifting in different directions: bright thin networks with dark cells between.
float causticPattern(vec2 p, float t) {
  vec2 warp = vec2(nzValue(p * 0.6 + t * 0.12), nzValue(p * 0.6 - t * 0.1 + 7.3)) - 0.5;
  vec2 q = p + warp * 1.4;
  float r1 = 1.0 - abs(2.0 * nzValue(q * 1.1 + vec2(t * 0.32, t * 0.21)) - 1.0);
  float r2 = 1.0 - abs(2.0 * nzValue(q * 1.7 + vec2(-t * 0.27, t * 0.35) + 11.0) - 1.0);
  return pow(r1 * r2, 3.0) * 4.0;
}`;

/** Fragment body; runs before <opaque_fragment>, so it adds to outgoingLight (linear). */
export const causticFragment = /* glsl */ `
{
  float cDepth = max(0.0, -vCausticWorld.y);
  float cUp = 0.35 + 0.65 * max(0.0, inverseTransformDirection(normal, viewMatrix).y);
  float cStr = causticStrength(cDepth, uWaterLight) * cUp;
  // Soft clamp: the raw pattern peaks at 4.0, which clipped near stones to white.
  if (cStr > 0.002) outgoingLight += diffuseColor.rgb * (1.0 - exp(-causticPattern(vCausticWorld.xz, uTime) * cStr * 1.5)) * 1.2;
}`;
