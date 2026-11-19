/** Water-volume absorption shared by every lit material (via applyWater) and the surface shader. */

/** Vertex declarations: world position for the fragment-side absorption. */
export const absorptionVertexPars = /* glsl */ `
varying vec3 vWaterWorld;`;

/** Vertex body; runs after <project_vertex>, so `transformed` is final. Mirrors three's instancing. */
export const absorptionVertex = /* glsl */ `
vec4 waterWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
waterWp = instanceMatrix * waterWp;
#endif
vWaterWorld = (modelMatrix * waterWp).xyz;`;

/** Uniforms and helpers. Colours are linear. `cameraPosition` is a three built-in. */
export const absorptionPars = /* glsl */ `
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform float uWaterDensity;
uniform float uWaterFloor;
uniform float uWaterMaxDepth;
uniform float uWaterBands;
uniform float uToon;

// Water colour at a depth: shallow -> deep, smoothstep over the lake's max depth.
vec3 waterTint(float depthM) {
  float t = clamp(depthM / uWaterMaxDepth, 0.0, 1.0);
  if (uWaterBands > 1.0) t = min(floor(t * uWaterBands), uWaterBands - 1.0) / (uWaterBands - 1.0);
  return mix(uWaterShallow, uWaterDeep, t * t * (3.0 - 2.0 * t));
}

// In-scattered water colour along a ray from the camera to a world point.
vec3 waterRayTint(vec3 wp) {
  return waterTint(mix(max(0.0, -cameraPosition.y), max(0.0, -wp.y), 0.5));
}

// Depth tint (red is absorbed first on the way down), a moonlit-blue minimum ambient term so dark scenes stay
// readable, then distance absorption.
// Share of the camera->point segment that runs under the surface (1 when both are underwater).
float underwaterShare(vec3 wp) {
  float a = cameraPosition.y, b = wp.y;
  if (a <= 0.0 && b <= 0.0) return 1.0;
  if (a > 0.0 && b > 0.0) return 0.0;
  return max(-a, -b) / max(abs(a - b), 1e-4);
}

vec3 waterVolume(vec3 col, vec3 albedo, vec3 wp) {
  float share = underwaterShare(wp);
  if (share <= 0.0) return col; // in the air, seen from the air
  col *= exp(-max(0.0, -wp.y) * uWaterDensity * 0.5 * vec3(1.5, 0.85, 0.95));
  col = max(col, albedo * uWaterFloor * vec3(0.85, 0.95, 1.15));
  float f = 1.0 - exp(-uWaterDensity * length(wp - cameraPosition) * share);
  return mix(col, waterRayTint(wp), f);
}`;

/** Fragment body; runs after <opaque_fragment>, before tone mapping (linear space). */
export const absorptionFragment = /* glsl */ `
gl_FragColor.rgb = waterVolume(gl_FragColor.rgb, diffuseColor.rgb, vWaterWorld);`;
