import { noiseGlsl } from "./noise.glsl";

/** Lakebed detail: fbm mottling of the vertex colours and a perturbed normal for sand ripples and grain. */

export const lakebedVertexPars = /* glsl */ `
varying vec3 vBedWorld;`;

export const lakebedVertex = /* glsl */ `
vBedWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

export const lakebedFragmentPars = /* glsl */ `
varying vec3 vBedWorld;
${noiseGlsl}
float bedHeight(vec2 p) {
  return nzFbm(p * 2.6) * 0.7 + nzValue(p * 11.0) * 0.3;
}`;

/** After <color_fragment>: patchy sand/silt/mud variation on top of the vertex colour. */
export const lakebedColor = /* glsl */ `
{
  float bedPatch = nzFbm(vBedWorld.xz * 0.35);
  float grain = nzValue(vBedWorld.xz * 14.0);
  diffuseColor.rgb *= (0.7 + 0.6 * bedPatch) * (0.88 + 0.24 * grain);
  // Dark silt pockets.
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.52, 0.45), smoothstep(0.62, 0.8, nzFbm(vBedWorld.xz * 0.9 + 5.0)));
}`;

/** After <normal_fragment_maps>: height-field gradient tilts the shading normal. */
export const lakebedNormal = /* glsl */ `
{
  vec2 bp = vBedWorld.xz;
  float bh = bedHeight(bp);
  vec2 bg = vec2(bedHeight(bp + vec2(0.03, 0.0)) - bh, bedHeight(bp + vec2(0.0, 0.03)) - bh) / 0.03;
  normal = normalize(normal - (viewMatrix * vec4(bg.x, 0.0, bg.y, 0.0)).xyz * 0.12);
}`;
