/**
 * Stylised 3-band toon ramp. Runs just before <opaque_fragment> in lit materials, where `outgoingLight` and
 * `diffuseColor` are in scope: the light reaching the surface (outgoing / albedo) is snapped to three flat bands.
 * uToon comes from applyWater's absorptionPars.
 */
export const toonFragment = /* glsl */ `
if (uToon > 0.5) {
  float toonAlb = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  float toonL = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)) / toonAlb;
  float toonBand = toonL < 0.3 ? 0.35 : toonL < 0.85 ? 0.7 : 1.05;
  outgoingLight = diffuseColor.rgb * toonBand;
}`;
