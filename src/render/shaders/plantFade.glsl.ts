/** Plant shading helpers: near-camera screen-door fade (mirrored by nearFade in TS) and a procedural blade edge. */

export const FADE_NEAR = 0.4;
export const FADE_FAR = 1.4;

/** 0 at <= 0.4 m, 1 at >= 1.4 m, smoothstep between. Mirrors the GLSL below. */
export function nearFade(distToCamera: number): number {
  const t = Math.min(1, Math.max(0, (distToCamera - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
  return t * t * (3 - 2 * t);
}

export const plantVertexPars = /* glsl */ `
varying vec3 vPlantWorld;
varying vec2 vPlantUv;`;

/** Vertex body; runs after <project_vertex> (sway has already moved `transformed`). */
export const plantVertex = /* glsl */ `
{
  vec4 pfWp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  pfWp = instanceMatrix * pfWp;
  #endif
  vPlantWorld = (modelMatrix * pfWp).xyz;
  vPlantUv = uv;
}`;

export const plantFragmentPars = /* glsl */ `
varying vec3 vPlantWorld;
varying vec2 vPlantUv;

float plantNearFade(float d) { return smoothstep(${FADE_NEAR.toFixed(2)}, ${FADE_FAR.toFixed(2)}, d); }
// Interleaved gradient noise: a stable screen-space dither in [0, 1).
float plantDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

/** Fragment body; runs after <color_fragment>. Discards by dither (no transparency sorting). */
export const plantFragment = /* glsl */ `
{
  float pfDist = distance(vPlantWorld, cameraPosition);
  if (plantNearFade(pfDist) <= plantDither(gl_FragCoord.xy)) discard;
  #ifdef PLANT_BLADE
  diffuseColor.rgb *= mix(0.45, 1.0, clamp(vPlantUv.y, 0.0, 1.0));
  #endif
  #ifdef PLANT_EDGE
  float pfU = abs(vPlantUv.x * 2.0 - 1.0);
  float pfWob = 0.08 * sin(vPlantUv.y * 40.0 + vPlantWorld.x * 9.0 + vPlantWorld.z * 7.0);
  if (pfU > 1.0 - 0.92 * pow(clamp(vPlantUv.y, 0.0, 1.0), 1.5) + pfWob) discard;
  #endif
}`;
