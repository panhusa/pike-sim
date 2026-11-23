/**
 * Fish skin v2 (MeshStandardMaterial chunks): counter-shading, species patterns (pike's pale bean
 * spots on olive, perch's wedge bars, silver roach, brass rudd), procedural scales with relief and
 * glints, gill cover, mouth line, lateral line pores, real eyes (iris, pupil, gloss), fins with rays,
 * scalloped edges and species fin colours, and per-region metalness/roughness.
 */
import * as THREE from "three";
import { ANATOMY, FIN } from "../fishModel";

export type FishSpecies = "pike" | "perch" | "roach" | "rudd" | "bream" | "tench";

export interface SkinSpec {
  back: string;
  flank: string;
  belly: string;
  /** fin colours by FIN id: dorsal1, dorsal2, anal, caudal, pectoral, pelvic */
  fins: [string, string, string, string, string, string];
  iris: string;
  pattern: "spots" | "bars" | "none";
  patternColor: string;
  patternCount: number;
  /** scale counts: along the lateral line, and rows from belly to back on one side */
  scalesAlong: number;
  scalesAround: number;
  /** how strongly scale outlines and relief show (pike scales are tiny and embedded) */
  scaleContrast: number;
  /** flank metalness / roughness (silver fish are mirror-like) */
  metal: number;
  rough: number;
  /** curvature of the lateral line (positive = sags toward the belly mid-body) */
  lateralSag: number;
  /** fresnel sheen strength */
  sheen: number;
}

export const SKINS: Record<FishSpecies, SkinSpec> = {
  pike: {
    back: "#26341a",
    flank: "#5f6f33",
    belly: "#e6dfc3",
    fins: ["#7d5c33", "#7d5c33", "#86582f", "#7a5a34", "#8a7a4a", "#8a6a3c"],
    iris: "#d9b744",
    pattern: "spots",
    patternColor: "#d8d08c",
    patternCount: 60,
    scalesAlong: 120,
    scalesAround: 30,
    scaleContrast: 0.35,
    metal: 0.08,
    rough: 0.36,
    lateralSag: 0,
    sheen: 0.18,
  },
  perch: {
    back: "#2f4220",
    flank: "#a3a245",
    belly: "#ebe6cf",
    fins: ["#6e6a55", "#88825e", "#e2582a", "#c3683a", "#d1a064", "#e35b2c"],
    iris: "#d0a43c",
    pattern: "bars",
    patternColor: "#1b2412",
    patternCount: 6,
    scalesAlong: 62,
    scalesAround: 22,
    scaleContrast: 0.7,
    metal: 0.2,
    rough: 0.38,
    lateralSag: -0.04,
    sheen: 0.22,
  },
  roach: {
    back: "#2e4850",
    flank: "#c9d1d1",
    belly: "#f3f3ef",
    fins: ["#6f6a62", "#6f6a62", "#d5582f", "#7a6a60", "#c98a6a", "#d75a30"],
    iris: "#c3302a",
    pattern: "none",
    patternColor: "#000000",
    patternCount: 0,
    scalesAlong: 44,
    scalesAround: 15,
    scaleContrast: 0.75,
    metal: 0.75,
    rough: 0.27,
    lateralSag: 0.07,
    sheen: 0.6,
  },
  rudd: {
    back: "#484f26",
    flank: "#d0ad4c",
    belly: "#efe4bf",
    fins: ["#8a3a24", "#8a3a24", "#cc2a1d", "#c22d20", "#c4563a", "#cf2a1c"],
    iris: "#dca535",
    pattern: "none",
    patternColor: "#000000",
    patternCount: 0,
    scalesAlong: 40,
    scalesAround: 14,
    scaleContrast: 0.75,
    metal: 0.6,
    rough: 0.3,
    lateralSag: 0.06,
    sheen: 0.45,
  },
  bream: {
    back: "#3b3a2c",
    flank: "#a98a4a",
    belly: "#d9c88f",
    fins: ["#4a4a44", "#4a4a44", "#5a554a", "#3f3f3a", "#6a604a", "#5a554a"],
    iris: "#c9b25a",
    pattern: "none",
    patternColor: "#000000",
    patternCount: 0,
    scalesAlong: 38,
    scalesAround: 20,
    scaleContrast: 0.7,
    metal: 0.55,
    rough: 0.3,
    lateralSag: 0.05,
    sheen: 0.4,
  },
  tench: {
    back: "#24301a",
    flank: "#5d6a2c",
    belly: "#9c9a58",
    fins: ["#344020", "#344020", "#3a4624", "#2e3a1c", "#46512a", "#46512a"],
    iris: "#c0261c",
    pattern: "none",
    patternColor: "#000000",
    patternCount: 0,
    scalesAlong: 90,
    scalesAround: 26,
    scaleContrast: 0.15,
    metal: 0.05,
    rough: 0.55,
    lateralSag: 0,
    sheen: 0.12,
  },
};

/** Prey rim light strength. */
export const PREY_RIM = 0.35;
/** Daylight fill for prey (self-lit by scattered light, scaled by albedo) so they separate from the water. */
export const PREY_FILL = 0.35;

const vec3 = (hex: string, mul = 1): string => {
  const c = new THREE.Color(hex);
  return `vec3(${(c.r * mul).toFixed(4)}, ${(c.g * mul).toFixed(4)}, ${(c.b * mul).toFixed(4)})`;
};
const f = (n: number): string => n.toFixed(4);

export const fishVertexPars = /* glsl */ `
attribute float aPart;
attribute vec2 aUV;
attribute float aFin;
varying float vFishPart;
varying vec2 vFishUV;
varying float vFishSide;
varying float vFishFin;
varying float vFishLen;`;

export const fishVertex = /* glsl */ `
vFishPart = aPart;
vFishUV = aUV;
vFishFin = aFin;
vFishSide = position.z < 0.0 ? -1.0 : 1.0;
#ifdef USE_INSTANCING
vFishLen = length((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
#else
vFishLen = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
#endif`;

export const fishFragmentPars = /* glsl */ `
varying float vFishPart;
varying vec2 vFishUV;
varying float vFishSide;
varying float vFishFin;
varying float vFishLen;
uniform float uWaterLight;
float gFishH;     // scale relief height in metres, for the bump
float gFishMetal;
float gFishRough;
float gFishGlint;

float fishHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fishNoise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(fishHash(i), fishHash(i + vec2(1, 0)), u.x), mix(fishHash(i + vec2(0, 1)), fishHash(i + vec2(1, 1)), u.x), u.y);
}
// Overlapping cycloid scales: returns (height 0..1 inside a scale, edge 0..1 at its free rear rim).
vec2 fishScales(vec2 q) {
  float row = floor(q.y);
  vec2 g = vec2(q.x + 0.5 * mod(row, 2.0), q.y);
  vec2 fc = fract(g);
  float d = length(vec2(fc.x, (fc.y - 0.5) * 1.15));
  float d2 = length(vec2(fc.x - 1.0, (fc.y - 0.5) * 1.15));
  float h = 1.0 - smoothstep(0.0, 1.05, d);
  float edge = smoothstep(0.78, 1.0, d) * (1.0 - smoothstep(0.98, 1.08, d));
  edge = max(edge, 0.0);
  return vec2(h + 0.15 * (1.0 - smoothstep(0.0, 0.6, d2)), edge);
}
vec3 fishBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}`;

/** Fragment body after <color_fragment>. `tint` darkens back and flank (rival pike). */
export function fishColorChunk(spec: SkinSpec, tint = 1, species: FishSpecies = "pike"): string {
  const a = ANATOMY[species];
  const pattern =
    spec.pattern === "spots"
      ? `
    // Pike: horizontal rows of pale, bean-shaped spots on the olive flank (denser and rounder toward the tail).
    vec2 sq = vec2(along / 0.042, around * 9.0);
    float srow = floor(sq.y);
    sq.x += 0.5 * mod(srow, 2.0);
    vec2 scell = floor(sq);
    vec2 sfc = fract(sq) - 0.5;
    float sd2 = vFishSide >= 0.0 ? 1.0 : -1.0;
    vec2 sj = (vec2(fishHash(scell + sd2 * 3.1), fishHash(scell * 1.3 + sd2 * 7.7)) - 0.5) * 0.35;
    float present = step(0.3, fishHash(scell + 11.0 + sd2));
    vec2 se = (sfc - sj) * vec2(1.0 + 0.3 * along, 1.25 + 0.3 * along);
    float sdist = length(se);
    float spotPx = max(fwidth(sq.x), fwidth(sq.y));
    float saa = fwidth(sdist) * 1.2 + 0.01;
    float smask = smoothstep(${f(a.gillT - 0.02)}, ${f(a.gillT + 0.05)}, along) * (1.0 - smoothstep(0.86, 0.9, along)) * smoothstep(0.3, 0.42, around) * (1.0 - smoothstep(0.86, 0.96, around));
    float spot = (1.0 - smoothstep(0.26 - saa, 0.26 + saa, sdist)) * present * smask;
    spot = mix(spot, 0.22 * smask, smoothstep(0.4, 0.9, spotPx));
    c = mix(c, ${vec3(spec.patternColor)} * (0.85 + 0.25 * fishNoise(sq * 3.0)), spot * 0.85);`
      : spec.pattern === "bars"
        ? `
    // Perch: dark wedge bars, wide on the back, tapering to points below mid-flank, leaning forward.
    float bx = (along - 0.2 + 0.05 * (around - 0.5)) * ${f(spec.patternCount / 0.64)};
    float bc = fract(bx) - 0.5;
    float width = mix(0.04, 0.3, smoothstep(0.32, 0.85, around));
    float baa = fwidth(bx) * 1.5;
    float bar = 1.0 - smoothstep(width - baa, width + baa, abs(bc));
    float bmask = smoothstep(0.2, 0.28, along) * (1.0 - smoothstep(0.83, 0.88, along)) * smoothstep(0.28, 0.45, around) * step(0.0, bx) * step(bx, ${f(spec.patternCount)});
    bar = mix(bar, 0.35, smoothstep(0.5, 1.0, fwidth(bx)));
    c = mix(c, ${vec3(spec.patternColor)}, bar * bmask * 0.8);`
        : "";
  const finColor = spec.fins
    .map((hex, i) => `${i === 0 ? "" : "else "}if (vFishFin < ${i}.5) fb = ${vec3(hex, i === FIN.pectoral ? 1 : tint)};`)
    .join("\n      ");
  const perchSpot =
    species === "perch"
      ? `
      // the black blotch at the rear of the spiny dorsal
      if (vFishFin < 0.5) fc0 = mix(fc0, vec3(0.03), (1.0 - smoothstep(0.08, 0.16, length(vec2((along - 0.86) * 1.2, around - 0.55)))));`
      : "";
  const pikeFinBlotch =
    species === "pike"
      ? `
      // pike fins: dark irregular blotches between the rays
      float bl = fishNoise(vec2(along * 9.0, around * 6.0) + vFishFin * 7.0);
      fc0 *= 1.0 - 0.55 * smoothstep(0.55, 0.7, bl);`
      : "";
  return /* glsl */ `
{
  float along = vFishUV.x;
  float around = vFishUV.y;
  gFishH = 0.0;
  gFishGlint = 0.0;
  if (vFishPart > 1.5) {
    // --- eye: along = angle from the pupil centre / pi ---
    float r = along;
    float iris = 1.0 - smoothstep(0.24, 0.28, r);
    float pupil = 1.0 - smoothstep(0.09, 0.115, r);
    vec3 ic = ${vec3(spec.iris)} * (0.75 + 0.35 * fishNoise(vec2(r * 40.0, vFishSide * 3.0)));
    ic = mix(ic * 0.55, ic, smoothstep(0.11, 0.2, r));
    vec3 e = mix(vec3(0.05, 0.05, 0.04), ic, iris);
    e = mix(e, vec3(0.005), pupil);
    diffuseColor.rgb = e;
    gFishMetal = 0.0;
    gFishRough = 0.06;
  } else if (vFishPart > 0.5) {
    // --- fin: along = base position, around = base->tip ---
    vec3 fb = vec3(0.5);
    ${finColor}
    float rays = vFishFin > 2.5 && vFishFin < 3.5 ? 22.0 : 14.0;
    float rv = abs(fract(along * rays) - 0.5) * 2.0;           // 0 on a ray, 1 between rays
    float raw = fwidth(along * rays) * 2.0;
    float ray = 1.0 - smoothstep(0.15, 0.35 + raw, rv);
    // scalloped margin: membrane falls short of the ray tips
    float tipCut = 1.0 - 0.13 * smoothstep(0.2, 1.0, rv);
    if (around > tipCut) discard;
    vec3 fc0 = fb * (0.7 + 0.35 * ray) * mix(0.8, 1.12, around);
    float lum = dot(fc0, vec3(0.333));
    fc0 = mix(fc0, vec3(lum) * 1.2 + 0.04, 0.35 * around);${perchSpot}${pikeFinBlotch}
    diffuseColor.rgb = fc0;
    gFishMetal = 0.0;
    gFishRough = 0.5;
  } else {
    // --- body ---
    float back = smoothstep(0.58, 0.86, around);
    float belly = 1.0 - smoothstep(0.22, 0.42, around);
    vec3 c = mix(${vec3(spec.flank, tint)}, ${vec3(spec.back, tint)}, back);
    c = mix(c, ${vec3(spec.belly)}, belly);
    // subtle mottling so no two patches are flat
    c *= 0.9 + 0.2 * fishNoise(vec2(along * 40.0, around * 12.0 + vFishSide * 5.0));
    ${pattern}
    float head = 1.0 - smoothstep(${f(a.gillT - 0.01)}, ${f(a.gillT + 0.01)}, along);
    // scales: counts are per body, so they shrink with the fish like the real thing
    vec2 q = vec2(along * ${f(spec.scalesAlong)}, around * ${f(spec.scalesAround)});
    vec2 scl = fishScales(q);
    float spx = max(fwidth(q.x), fwidth(q.y));
    float sFade = (1.0 - smoothstep(0.22, 0.6, spx)) * (1.0 - head) * (1.0 - smoothstep(0.86, 0.9, along)) * ${f(spec.scaleContrast)};
    c *= 1.0 - 0.16 * scl.y * sFade * (1.0 - belly * 0.6);
    c += 0.04 * scl.x * sFade * (0.4 + back * 0.6);
    gFishH = scl.x * sFade * vFishLen * ${f(1 / spec.scalesAlong)} * 0.18;
    gFishGlint = scl.x * sFade;
    // lateral line: a row of darker pores
    float llY = 0.54 - ${f(spec.lateralSag)} * sin(3.1416 * clamp((along - ${f(a.gillT)}) / ${f(0.86 - a.gillT)}, 0.0, 1.0));
    float llw = 0.012 + fwidth(around);
    float ll = (1.0 - smoothstep(llw * 0.6, llw, abs(around - llY))) * step(${f(a.gillT)}, along) * (1.0 - smoothstep(0.84, 0.88, along));
    float pore = mix(0.6, step(0.5, fract(q.x)), sFade);
    c = mix(c, c * 0.55, ll * pore * 0.8);
    // gill cover: a backward-bowed crescent, and the fainter pre-opercle line ahead of it
    float gl = ${f(a.gillT)} - 0.03 * pow(abs(around - 0.5) * 2.0, 2.0);
    float gw = 0.0035 + fwidth(along) * 1.2;
    float gill = (1.0 - smoothstep(gw * 0.5, gw, abs(along - gl))) * smoothstep(0.12, 0.25, around) * (1.0 - smoothstep(0.8, 0.9, around));
    float pre = (1.0 - smoothstep(gw * 0.4, gw, abs(along - gl + 0.045))) * smoothstep(0.2, 0.3, around) * (1.0 - smoothstep(0.65, 0.75, around));
    c = mix(c, c * 0.35, gill * 0.85);
    c = mix(c, c * 0.7, pre * 0.5);
    c += vec3(0.06, 0.05, 0.03) * smoothstep(0.0, 0.03, gl - along) * (1.0 - smoothstep(0.03, 0.06, gl - along)) * head; // sheen on the cover
    // mouth: the gape line from the snout back to tEnd
    float mY = 0.5 + 0.5 * ${f(a.mouth.yFrac)};
    float mw = (0.012 + fwidth(around)) * (1.0 - 0.6 * along / ${f(a.mouth.tEnd)});
    float mouth = (1.0 - smoothstep(mw * 0.5, mw, abs(around - mY - 0.02 * along / ${f(a.mouth.tEnd)}))) * (1.0 - smoothstep(${f(a.mouth.tEnd * 0.85)}, ${f(a.mouth.tEnd)}, along));
    c = mix(c, vec3(0.04, 0.03, 0.02), mouth * 0.9);
    // nose tip and the top of the head a touch darker
    c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.035, along));
    diffuseColor.rgb = c;
    float silver = (1.0 - back) * (1.0 - head * 0.5);
    gFishMetal = mix(0.05, ${f(spec.metal)}, silver) * (1.0 - belly * 0.35);
    gFishRough = mix(${f(spec.rough)}, 0.3, head) - 0.06 * gFishGlint;
  }
}`;
}

/** After <roughnessmap_fragment> / <metalnessmap_fragment>: per-region surface. */
export const fishRoughChunk = /* glsl */ `roughnessFactor = clamp(gFishRough, 0.04, 1.0);`;
export const fishMetalChunk = /* glsl */ `metalnessFactor = clamp(gFishMetal, 0.0, 1.0);`;
/** After <normal_fragment_maps>: scale relief as a derivative bump. */
export const fishNormalChunk = /* glsl */ `
if (gFishH > 0.0) normal = fishBump(-vViewPosition, normal, vec2(dFdx(gFishH), dFdy(gFishH)), faceDirection);`;

/** Fragment body after <emissivemap_fragment> (`normal` exists): fresnel sheen, prey rim and fill. */
export function fishRimChunk(spec: SkinSpec, rim: number, fill = 0): string {
  return /* glsl */ `
{
  float fnv = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float fAmt = (${f(rim)} * pow(fnv, 3.0) + ${f(spec.sheen * 0.25)} * pow(fnv, 2.0)) * (0.25 + 0.75 * uWaterLight);
  totalEmissiveRadiance += diffuseColor.rgb * ${f(fill)} * uWaterLight;
  totalEmissiveRadiance += diffuseColor.rgb * 1.4 * fAmt + vec3(0.8, 0.95, 0.9) * ${f(rim)} * 0.25 * pow(fnv, 3.0) * uWaterLight;
}`;
}
