import * as THREE from "three";
import type { Environment } from "../sim/environment";
import type { RenderCtx } from "./ctx";
import type { GfxQuality, GfxStyle } from "./gfxSettings";
import { absorptionFragment, absorptionPars, absorptionVertex, absorptionVertexPars } from "./shaders/absorption.glsl";
import { toonFragment } from "./shaders/toon.glsl";
import { causticFragment, causticFragmentPars, causticVertex, causticVertexPars } from "./shaders/caustics.glsl";
import { snellFragment, snellVertex } from "./shaders/snell.glsl";

type RGB = [number, number, number];

/** Water colours (sRGB 0..1), absorption per metre and the minimum ambient term. */
export interface WaterLook {
  shallow: RGB;
  deep: RGB;
  density: number;
  ambientFloor: number;
  /** Flat depth bands for the stylised look; 0 = smooth gradient. */
  bands: number;
}

const hex = (h: number): RGB => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const DAY_SHALLOW = hex(0x6fa7a0);
const DAY_DEEP = hex(0x20392f);
const NIGHT_SHALLOW = hex(0x1b2f3d);
const NIGHT_DEEP = hex(0x070d12);
/** Summer algae make the water greener; winter water is bluer and clearer. */
const SEASON_TINT: Record<Environment["season"], RGB> = {
  winter: [0.94, 1.03, 1.14],
  spring: [1, 1, 1],
  summer: [0.93, 1.05, 0.86],
  autumn: [1.04, 0.99, 0.9],
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => x * x * (3 - 2 * x);
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function grade(c: RGB, tint: RGB, style: GfxStyle): RGB {
  let out: RGB = [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2]];
  if (style === "stylised") {
    // A little more saturation and brightness for the painted look.
    const l = (out[0] + out[1] + out[2]) / 3;
    out = out.map((v) => (l + (v - l) * 1.25) * 1.08) as RGB;
  }
  return out.map(clamp01) as RGB;
}

/** Day/night blend: 0 in the dark, 1 from mid-morning. */
const dayness = (light: number): number => smooth(clamp01((light - 0.04) / 0.86));

export function waterLook(env: Pick<Environment, "light" | "season" | "visibilityM">, style: GfxStyle): WaterLook {
  const t = dayness(env.light);
  const tint = SEASON_TINT[env.season];
  return {
    shallow: grade(mixRGB(NIGHT_SHALLOW, DAY_SHALLOW, t), tint, style),
    deep: grade(mixRGB(NIGHT_DEEP, DAY_DEEP, t), tint, style),
    density: 2.2 / Math.max(env.visibilityM, 1.5),
    ambientFloor: 0.03 + 0.22 * (1 - t) + (style === "stylised" ? 0.02 : 0),
    bands: style === "stylised" ? STYLISED_BANDS : 0,
  };
}

export const STYLISED_BANDS = 4;

/** Depth fraction, quantised to `bands` flat steps when bands > 1 (same as the GLSL waterTint). */
export function bandDepth(t: number, bands: number): number {
  return bands > 1 ? Math.min(Math.floor(t * bands), bands - 1) / (bands - 1) : t;
}

/** Water colour at a depth: shallow to deep by depth/maxDepth, smoothstepped (same as the GLSL waterTint). */
export function absorptionColor(depthM: number, look: WaterLook, maxDepth: number): RGB {
  return mixRGB(look.shallow, look.deep, smooth(bandDepth(clamp01(depthM / maxDepth), look.bands)));
}

/** Uniforms shared by every material that applyWater touches and by the surface shader. Colours are linear. */
export interface WaterUniforms {
  uWaterShallow: { value: THREE.Color };
  uWaterDeep: { value: THREE.Color };
  uWaterDensity: { value: number };
  uWaterFloor: { value: number };
  uWaterMaxDepth: { value: number };
  /** Env light 0..1, drives the caustic fade. */
  uWaterLight: { value: number };
  /** The sky above the water (linear), for the surface seen from the air and the sky dome. */
  uAirZenith: { value: THREE.Color };
  uAirHorizon: { value: THREE.Color };
  /** Unit vector toward the sun. */
  uSunDir: { value: THREE.Vector3 };
  /** Stylised look: flat depth bands (0 = smooth) and the 3-band toon light ramp (0 off, 1 on). */
  uWaterBands: { value: number };
  uToon: { value: number };
}

export function createWaterUniforms(maxDepth: number): WaterUniforms {
  return {
    uWaterShallow: { value: new THREE.Color() },
    uWaterDeep: { value: new THREE.Color() },
    uWaterDensity: { value: 0.3 },
    uWaterFloor: { value: 0.06 },
    uWaterMaxDepth: { value: maxDepth },
    uWaterLight: { value: 1 },
    uAirZenith: { value: new THREE.Color() },
    uAirHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(10, 30, 5).normalize() },
    uWaterBands: { value: 0 },
    uToon: { value: 0 },
  };
}

/** Caustic brightness factor 0..1 at a depth: day/night blend times exp(-0.55 d). Mirrors causticStrength in the GLSL. */
export function causticStrength(depthM: number, light: number): number {
  return dayness(light) * Math.exp(-Math.max(0, depthM) * 0.55);
}

const CAUSTIC_KEY = "|caustic1";

/** Adds animated caustics to a lit material. Chains earlier onBeforeCompile; apply BEFORE applyWater. */
export function applyCaustics(mat: THREE.Material, ctx: RenderCtx): void {
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uTime = ctx.uTime;
    shader.uniforms.uWaterLight = ctx.water.uWaterLight;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${causticVertexPars}`)
      .replace("#include <project_vertex>", `#include <project_vertex>${causticVertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${causticFragmentPars}`)
      .replace("#include <opaque_fragment>", `${causticFragment}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => baseKey + CAUSTIC_KEY;
}

const WATER_KEY = "|water1";

/** Adds water-volume absorption to a built-in material. Chains any earlier onBeforeCompile (sway, tail wag). */
export function applyWater(mat: THREE.Material, ctx: RenderCtx): void {
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, ctx.water);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${absorptionVertexPars}`)
      .replace("#include <project_vertex>", `#include <project_vertex>${absorptionVertex}`);
    let fs = shader.fragmentShader
      .replace("#include <common>", `#include <common>${absorptionVertexPars}${absorptionPars}`)
      .replace("#include <tonemapping_fragment>", `${absorptionFragment}\n#include <tonemapping_fragment>`);
    // lit materials get the stylised toon ramp (a uniform switch, so the style changes without recompiling)
    if (fs.includes("#include <lights_fragment_end>")) fs = fs.replace("#include <opaque_fragment>", `${toonFragment}\n#include <opaque_fragment>`);
    shader.fragmentShader = fs;
  };
  // The wrapper's source is the same for every material, so key on what it wraps.
  mat.customProgramCacheKey = () => baseKey + WATER_KEY;
}

function noiseTexture(rng: () => number): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rng() * 256);
  const tex = new THREE.DataTexture(data, n, n);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Day sky is HDR (> 1) so the window reads as the brightest thing on screen through the absorption.
const DAY_SKY = new THREE.Color().setRGB(0.92, 0.97, 1.0, THREE.SRGBColorSpace).multiplyScalar(1.8);
const DAY_SKY_EDGE = new THREE.Color().setRGB(0.7, 0.82, 0.84, THREE.SRGBColorSpace);
const NIGHT_SKY = new THREE.Color().setRGB(0.16, 0.22, 0.32, THREE.SRGBColorSpace);
const NIGHT_SKY_EDGE = new THREE.Color().setRGB(0.09, 0.13, 0.19, THREE.SRGBColorSpace);

const AIR_ZENITH_DAY = new THREE.Color().setRGB(0.32, 0.55, 0.9, THREE.SRGBColorSpace);
const AIR_HORIZON_DAY = new THREE.Color().setRGB(0.78, 0.86, 0.93, THREE.SRGBColorSpace);
const AIR_ZENITH_NIGHT = new THREE.Color().setRGB(0.02, 0.03, 0.08, THREE.SRGBColorSpace);
const AIR_HORIZON_NIGHT = new THREE.Color().setRGB(0.08, 0.1, 0.16, THREE.SRGBColorSpace);

/** The water volume (shared uniforms, background) and the surface seen from below (Snell's window). */
export function buildWater(ctx: RenderCtx): { update(env: Environment, cameraY: number): void; dispose(): void } {
  const w = ctx.sim.world;
  const noise = noiseTexture(ctx.rng(777));
  const uniforms = { ...ctx.water, uTime: ctx.uTime, uSky: { value: new THREE.Color() }, uSkyEdge: { value: new THREE.Color() }, uNoise: { value: noise } };
  const g = new THREE.PlaneGeometry(w.size, w.size).rotateX(Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: snellVertex,
    fragmentShader: snellFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.y = 0;
  ctx.scene.add(m);
  const background = new THREE.Color();
  ctx.scene.background = background;

  return {
    update(env, cameraY) {
      const look = waterLook(env, ctx.gfx.style);
      const u = ctx.water;
      u.uWaterShallow.value.setRGB(...look.shallow, THREE.SRGBColorSpace);
      u.uWaterDeep.value.setRGB(...look.deep, THREE.SRGBColorSpace);
      u.uWaterDensity.value = look.density;
      u.uWaterFloor.value = look.ambientFloor;
      u.uWaterLight.value = env.light;
      u.uWaterBands.value = look.bands;
      u.uToon.value = ctx.gfx.style === "stylised" ? 1 : 0;
      const t = dayness(env.light);
      u.uAirZenith.value.copy(AIR_ZENITH_NIGHT).lerp(AIR_ZENITH_DAY, t);
      u.uAirHorizon.value.copy(AIR_HORIZON_NIGHT).lerp(AIR_HORIZON_DAY, t);
      if (cameraY > 0) background.copy(u.uAirHorizon.value);
      else background.setRGB(...absorptionColor(Math.max(0, -cameraY), look, w.maxDepth), THREE.SRGBColorSpace);
      uniforms.uSky.value.copy(NIGHT_SKY).lerp(DAY_SKY, t);
      uniforms.uSkyEdge.value.copy(NIGHT_SKY_EDGE).lerp(DAY_SKY_EDGE, t);
    },
    dispose() {
      ctx.scene.remove(m);
      if (ctx.scene.background === background) ctx.scene.background = null;
      g.dispose();
      mat.dispose();
      noise.dispose();
    },
  };
}

/** Number of light-shaft quads: high only. */
export function shaftCount(q: GfxQuality): number {
  return q === "high" ? 24 : 0;
}

const SHAFT_BOX = 24; // shafts wrap in a box this wide around the camera
const SHAFT_LEN = 9;

const shaftVertex = /* glsl */ `
attribute vec3 aShaft; // x, z offset in the wrap box; width
attribute float aPhase;
uniform vec3 uCam;
uniform vec3 uAxis;     // unit, pointing down along the refracted sun ray
uniform float uBox;
uniform float uLen;
varying vec2 vUv;
varying float vPhase;
varying float vDepth;
varying float vDist;
void main() {
  // wrap each shaft into a box centred on the camera so they never run out
  vec2 base = uCam.xz + mod(aShaft.xy - uCam.xz + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 top = vec3(base.x, -0.02, base.y);
  vec3 along = uAxis * (position.y * uLen);       // position.y in 0..1
  vec3 mid = top + uAxis * (0.5 * uLen);
  vec3 side = normalize(cross(uAxis, normalize(uCam - mid))) * aShaft.z;
  vec3 world = top + along + side * position.x;   // position.x in -0.5..0.5
  vUv = vec2(position.x + 0.5, position.y);
  vPhase = aPhase;
  vDepth = -world.y;
  vDist = distance(world, uCam);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const shaftFragment = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform float uWaterDensity;
uniform vec3 uTint;
uniform sampler2D uNoise;
varying vec2 vUv;
varying float vPhase;
varying float vDepth;
varying float vDist;
void main() {
  float edge = sin(vUv.x * 3.14159);
  edge *= edge;
  float flicker = texture2D(uNoise, vec2(vUv.x * 0.35 + vPhase, vUv.y * 0.12 - uTime * 0.025)).r;
  flicker = 0.45 + 0.9 * flicker;
  float fall = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y)) * exp(-vDepth * 0.28);
  float near = smoothstep(0.8, 3.0, vDist);       // a shaft hugging the lens would fill the screen
  float fog = exp(-vDist * uWaterDensity * 0.9);
  float a = edge * flicker * fall * near * fog * uStrength;
  gl_FragColor = vec4(uTint, a); // additive blending multiplies by alpha itself
}`;

/** Sunlight shafts hanging from the surface (additive, noise-scrolled, depth-faded). High quality only; empty on low. */
export function buildShafts(ctx: RenderCtx): { update(env: Environment, cam: THREE.Vector3): void; dispose(): void } {
  const n = shaftCount(ctx.gfx.quality);
  if (n === 0) return { update() {}, dispose() {} };
  const rng = ctx.rng(4242);
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // x -0.5..0.5, y 0..1
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute("position", quad.getAttribute("position"));
  g.setAttribute("uv", quad.getAttribute("uv"));
  const shaft = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    shaft.set([(rng() - 0.5) * SHAFT_BOX, (rng() - 0.5) * SHAFT_BOX, 0.6 + rng() * 1.6], i * 3);
    phase[i] = rng() * 10;
  }
  g.setAttribute("aShaft", new THREE.InstancedBufferAttribute(shaft, 3));
  g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
  g.instanceCount = n;
  const noise = noiseTexture(ctx.rng(4343));
  const axis = new THREE.Vector3();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uAxis: { value: axis },
      uBox: { value: SHAFT_BOX },
      uLen: { value: SHAFT_LEN },
      uTime: ctx.uTime,
      uStrength: { value: 0 },
      uWaterDensity: ctx.water.uWaterDensity,
      uTint: { value: new THREE.Color(0.85, 0.95, 0.8) },
      uNoise: { value: noise },
    },
    vertexShader: shaftVertex,
    fragmentShader: shaftFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  ctx.scene.add(m);
  quad.dispose();
  return {
    update(env, cam) {
      // Snell: the sun ray bends toward the vertical under water (n = 1.33)
      const s = ctx.water.uSunDir.value;
      const horiz = Math.hypot(s.x, s.z);
      const sinT = Math.min(1, horiz) / 1.33;
      const cosT = Math.sqrt(1 - sinT * sinT);
      if (horiz > 1e-4) axis.set((-s.x / horiz) * sinT, -cosT, (-s.z / horiz) * sinT);
      else axis.set(0, -1, 0);
      mat.uniforms.uCam!.value.copy(cam);
      const under = cam.y < 0 ? 1 : 0;
      mat.uniforms.uStrength!.value = 0.45 * dayness(env.light) * under;
    },
    dispose() {
      ctx.scene.remove(m);
      g.dispose();
      mat.dispose();
      noise.dispose();
    },
  };
}
