import * as THREE from "three";
import type { Environment } from "../sim/environment";
import type { RenderCtx } from "./ctx";
import type { GfxStyle } from "./gfxSettings";
import { absorptionFragment, absorptionPars, absorptionVertex, absorptionVertexPars } from "./shaders/absorption.glsl";
import { causticFragment, causticFragmentPars, causticVertex, causticVertexPars } from "./shaders/caustics.glsl";
import { snellFragment, snellVertex } from "./shaders/snell.glsl";

type RGB = [number, number, number];

/** Water colours (sRGB 0..1), absorption per metre and the minimum ambient term. */
export interface WaterLook {
  shallow: RGB;
  deep: RGB;
  density: number;
  ambientFloor: number;
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
  };
}

/** Water colour at a depth: shallow to deep by depth/maxDepth, smoothstepped (same as the GLSL waterTint). */
export function absorptionColor(depthM: number, look: WaterLook, maxDepth: number): RGB {
  return mixRGB(look.shallow, look.deep, smooth(clamp01(depthM / maxDepth)));
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
}

export function createWaterUniforms(maxDepth: number): WaterUniforms {
  return {
    uWaterShallow: { value: new THREE.Color() },
    uWaterDeep: { value: new THREE.Color() },
    uWaterDensity: { value: 0.3 },
    uWaterFloor: { value: 0.06 },
    uWaterMaxDepth: { value: maxDepth },
    uWaterLight: { value: 1 },
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
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${absorptionVertexPars}${absorptionPars}`)
      .replace("#include <tonemapping_fragment>", `${absorptionFragment}\n#include <tonemapping_fragment>`);
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
      background.setRGB(...absorptionColor(Math.max(0, -cameraY), look, w.maxDepth), THREE.SRGBColorSpace);
      const t = dayness(env.light);
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
