import * as THREE from "three";
import type { PikeState } from "../sim/pike";
import { yolkFrac } from "../sim/nursery";
import { len } from "../sim/math";
import { isArcadeOnly, type PreyKind } from "../sim/params";
import type { RenderCtx } from "./ctx";
import type { CullView } from "./cull";
import { OUTLINE_FRAC, OUTLINE_LAYER, outlineMaterial } from "./outline";
import { applyWater } from "./water";
import { addTailWag } from "./fishGeometry";
import { buildFishModel, DETAIL } from "./fishModel";
import {
  PREY_FILL,
  PREY_RIM,
  SKINS,
  fishColorChunk,
  fishFragmentPars,
  fishMetalChunk,
  fishNormalChunk,
  fishRimChunk,
  fishRoughChunk,
  fishVertex,
  fishVertexPars,
  type FishSpecies,
} from "./shaders/fishSkin.glsl";

export * from "./fishGeometry";
export { SKINS, type FishSpecies, type SkinSpec } from "./shaders/fishSkin.glsl";

/** Chains the species skin onto a standard material (after the tail wag, before applyWater). `tint` darkens it, `rim` is the rim-light gain. */
export function applyFishSkin(mat: THREE.MeshStandardMaterial, ctx: RenderCtx, species: FishSpecies, tint: number, rim: number, fill = 0): void {
  const spec = SKINS[species];
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uWaterLight = ctx.water.uWaterLight;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${fishVertexPars}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${fishVertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${fishFragmentPars}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${fishColorChunk(spec, tint, species)}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${fishRoughChunk}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${fishMetalChunk}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${fishNormalChunk}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>${fishRimChunk(spec, rim, fill)}`);
  };
  mat.customProgramCacheKey = () => `${baseKey}|skin2:${species}:${tint}:${rim}:${fill}`;
}

/**
 * Underwater light environment for fish reflections (silver flanks, wet gloss, eyes): bright Snell's
 * window above, green-blue horizon, dark bottom. Fish materials only; the scene itself is not lit by it.
 */
function waterEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 48, 24);
  const col = new Float32Array(geo.attributes.position!.count * 3);
  const top = new THREE.Color("#e8fbf2"), sky = new THREE.Color("#7fc2b6"), hor = new THREE.Color("#2f6a62"), low = new THREE.Color("#0a1a17");
  const c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position!.count; i++) {
    const y = geo.attributes.position!.getY(i) / 10;
    if (y > 0.75) c.copy(sky).lerp(top, (y - 0.75) / 0.25);
    else if (y > 0) c.copy(hor).lerp(sky, y / 0.75);
    else c.copy(hor).lerp(low, Math.min(1, -y * 2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  geo.dispose();
  return tex;
}

const MAX_PREY = 600;
/** Game-only species are a few schools: a small instance budget keeps them cheap on phones. */
const MAX_ARCADE_ONLY = 80;
/** Rival pike flank and back multiplier: clearly darker than the player, still pike. */
const RIVAL_TINT = 0.55;
/** Emissive red on the tyrant's body. */
const TYRANT_GLOW = 0x6a1010;
const PREY_KINDS: PreyKind[] = ["roach", "perch", "rudd", "bream", "tench"];
/** Fish nearer than this (m, from the camera to the nearest point of the body) keep full detail; farther ones use the coarser model. */
export const FISH_LOD_NEAR_M = 4;
type Lod = "near" | "far";
const LODS: Lod[] = ["near", "far"];

/** Where the camera is, for fish LOD and fog culling: `radius` is fogCullRadius(). */
export interface FishView extends CullView {
  y: number;
}

/** Which model a fish gets: full detail up close, the coarse one farther out, none once the water has swallowed it. */
export function fishLod(pos: { x: number; y: number; z: number }, lengthCm: number, view: FishView | undefined): Lod | null {
  if (!view) return "near";
  const d = Math.hypot(pos.x - view.x, pos.y - view.y, pos.z - view.z) - lengthCm / 200;
  if (d > view.radius) return null;
  return d < FISH_LOD_NEAR_M ? "near" : "far";
}

/** Model detail per LOD and quality (near is what each quality always drew). */
export function fishDetails(q: RenderCtx["gfx"]["quality"]): Record<Lod, (typeof DETAIL)[keyof typeof DETAIL]> {
  return q === "low" ? { near: DETAIL.low, far: DETAIL.far } : { near: DETAIL.high, far: DETAIL.low };
}

/** Stable tail-beat phase per fish id, so a fish keeps its stroke when it changes instance slot or LOD. */
const phaseOf = (id: number): number => (((id * 2654435761) >>> 0) / 4294967296) * 20;

/**
 * Pike meshes (one per sim pike) and instanced prey fish. Prey come in two LODs (FISH_LOD_NEAR_M) and are dropped
 * past the fog radius; rival pike switch to the coarser model when far. `envMap` is for tests (no WebGL there).
 */
export function buildFish(
  ctx: RenderCtx,
  envMap: THREE.Texture = waterEnvironment(ctx.renderer),
): { update(player: PikeState, hidePlayer?: boolean, view?: FishView): void; setTailBeat(player: PikeState): void; dispose(): void } {
  const pikeUniforms = { uTime: ctx.uTime, uWag: { value: 0.06 }, uFreq: { value: 6 } };
  const preyUniforms = { uTime: ctx.uTime, uWag: { value: 0.05 }, uFreq: { value: 14 } };
  const preyMeshes = new Map<PreyKind, Record<Lod, THREE.InstancedMesh>>();
  const pikeMeshes = new Map<number, THREE.Mesh>();
  const tmp = new THREE.Object3D();
  const fishMats: THREE.MeshStandardMaterial[] = [];
  const details = fishDetails(ctx.gfx.quality);
  const pikeGeo = { hero: buildFishModel("pike", DETAIL.hero), rival: buildFishModel("pike", DETAIL.high), rivalFar: buildFishModel("pike", details.far) };
  // stylised outlines (camera layer OUTLINE_LAYER); fish geometry is unit length, so thickness is a body-length share
  const pikeOutline = outlineMaterial(ctx, OUTLINE_FRAC, { uniforms: pikeUniforms, instanced: false });
  const preyOutline = outlineMaterial(ctx, OUTLINE_FRAC, { uniforms: preyUniforms, instanced: true });
  const preyOutlines = new Map<PreyKind, Record<Lod, THREE.InstancedMesh>>();
  const phaseAttrs = new Map<PreyKind, Record<Lod, THREE.InstancedBufferAttribute>>();

  const maxFor = (kind: PreyKind): number => (isArcadeOnly(ctx.sim.p.prey[kind]) ? MAX_ARCADE_ONLY : MAX_PREY);
  for (const kind of PREY_KINDS) {
    const cap = maxFor(kind);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.15, envMap, envMapIntensity: 1 });
    fishMats.push(mat);
    addTailWag(mat, preyUniforms, true);
    applyFishSkin(mat, ctx, kind, 1, PREY_RIM, PREY_FILL);
    applyWater(mat, ctx);
    const meshes = {} as Record<Lod, THREE.InstancedMesh>;
    const hulls = {} as Record<Lod, THREE.InstancedMesh>;
    const phases = {} as Record<Lod, THREE.InstancedBufferAttribute>;
    for (const lod of LODS) {
      // both LODs share the material: one shader program per species, as before
      const g = buildFishModel(kind, details[lod]);
      phases[lod] = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      g.setAttribute("aPhase", phases[lod]);
      const mesh = new THREE.InstancedMesh(g, mat, cap);
      mesh.name = `${kind} ${lod}`;
      mesh.frustumCulled = false;
      mesh.count = 0;
      meshes[lod] = mesh;
      ctx.scene.add(mesh);
      const hull = new THREE.InstancedMesh(g, preyOutline, cap);
      hull.name = `${kind} ${lod} outline`;
      hull.instanceMatrix = mesh.instanceMatrix; // same placements as the fish
      hull.frustumCulled = false;
      hull.count = 0;
      hull.layers.set(OUTLINE_LAYER);
      hulls[lod] = hull;
      ctx.scene.add(hull);
    }
    preyMeshes.set(kind, meshes);
    preyOutlines.set(kind, hulls);
    phaseAttrs.set(kind, phases);
  }

  // yolk sac: a translucent amber ellipsoid under the head of a hatchling (child of the pike mesh, so unit-length coordinates)
  const yolkGeo = new THREE.SphereGeometry(1, 14, 10);
  const yolkMat = new THREE.MeshStandardMaterial({ color: 0xe8b84a, emissive: 0x5a3a08, roughness: 0.3, transparent: true, opacity: 0.75 });
  const yolkSacs = new Map<number, THREE.Mesh>();

  /** isPlayer: the local player (hero detail); human: any player's pike (player colouring, not the darker rival tint). */
  const ensurePike = (pk: PikeState, isPlayer: boolean, human = isPlayer): THREE.Mesh => {
    let m = pikeMeshes.get(pk.id);
    if (!m) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.15, envMap, envMapIntensity: 1 });
      fishMats.push(mat);
      addTailWag(mat, pikeUniforms, false);
      applyFishSkin(mat, ctx, "pike", human ? 1 : RIVAL_TINT, 0);
      applyWater(mat, ctx);
      m = new THREE.Mesh(isPlayer ? pikeGeo.hero : pikeGeo.rival, mat);
      m.name = isPlayer ? "player pike" : "pike";
      m.rotation.order = "YZX";
      m.frustumCulled = false;
      const hull = new THREE.Mesh(m.geometry, pikeOutline);
      hull.name = "pike outline";
      hull.layers.set(OUTLINE_LAYER);
      hull.frustumCulled = false;
      m.add(hull);
      pikeMeshes.set(pk.id, m);
      ctx.scene.add(m);
    }
    return m;
  };

  return {
    /** Tail beat follows the player's swimming speed. */
    setTailBeat(player) {
      const L = player.lengthCm / 100;
      pikeUniforms.uFreq.value = 3 + 9 * Math.min(1, player.speed / (L * 4));
      pikeUniforms.uWag.value = 0.04 + 0.08 * Math.min(1, player.speed / (L * 3));
    },
    update(player, hidePlayer = false, view) {
      // reflections dim with the light in the water (night, depth)
      const envI = 0.25 + 0.95 * ctx.water.uWaterLight.value;
      for (const m of fishMats) m.envMapIntensity = envI;
      for (const m of pikeMeshes.values()) m.visible = false; // a pike that left the lake (the tyrant) is no longer listed
      // the Old Tyrant (game boss) glows a dull red while the fight is on
      const ty = ctx.sim.tyrant;
      const tyrantId = ty ? (ty.outcome ? null : ty.id) : ctx.sim.tyrantSeenId;
      for (const pk of ctx.sim.pikes) {
        const mesh = ensurePike(pk, pk === player, pk === player || ctx.sim.isHuman(pk));
        mesh.visible = pk.alive && !(hidePlayer && pk === player);
        (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(pk.id === tyrantId ? TYRANT_GLOW : 0x000000);
        mesh.position.set(pk.pos.x, pk.pos.y, pk.pos.z);
        mesh.rotation.set(0, -pk.yaw, pk.pitch);
        mesh.scale.setScalar(pk.lengthCm / 100);
        if (mesh.geometry !== pikeGeo.hero) {
          // rival pike: coarse model when far, never hidden by distance (three's compile() traverses hidden meshes too,
          // so the start-up shader compile does not depend on this)
          const geo = pk === player || fishLod(pk.pos, pk.lengthCm, view) === "near" ? pikeGeo.rival : pikeGeo.rivalFar;
          mesh.geometry = geo;
          (mesh.children[0] as THREE.Mesh).geometry = geo;
        }
        const yolk = ctx.sim.isHuman(pk) ? yolkFrac(pk.lengthCm) : 0;
        let sac = yolkSacs.get(pk.id);
        if (yolk > 0 && !sac) {
          sac = new THREE.Mesh(yolkGeo, yolkMat);
          sac.frustumCulled = false;
          mesh.add(sac);
          yolkSacs.set(pk.id, sac);
        }
        if (sac) {
          sac.visible = yolk > 0;
          sac.position.set(0.2, -0.045, 0);
          sac.scale.set(0.16 * (0.4 + 0.6 * yolk), 0.07 * (0.4 + 0.6 * yolk), 0.06 * (0.4 + 0.6 * yolk));
        }
      }
      const counts = new Map<PreyKind, number>(); // per kind, near + far together (the instance budget)
      const slots = { near: new Map<PreyKind, number>(), far: new Map<PreyKind, number>() };
      for (const f of ctx.sim.prey) {
        const used = counts.get(f.kind) ?? 0;
        if (used >= maxFor(f.kind)) continue;
        counts.set(f.kind, used + 1);
        const lod = fishLod(f.pos, f.lengthCm, view);
        if (!lod) continue;
        const mesh = preyMeshes.get(f.kind)![lod];
        const i = slots[lod].get(f.kind) ?? 0;
        slots[lod].set(f.kind, i + 1);
        const sp = len(f.vel);
        const yaw = sp > 0.01 ? Math.atan2(f.vel.z, f.vel.x) : 0;
        const pitch = sp > 0.01 ? Math.asin(Math.max(-1, Math.min(1, f.vel.y / sp))) : 0;
        tmp.position.set(f.pos.x, f.pos.y, f.pos.z);
        tmp.rotation.order = "YZX";
        tmp.rotation.set(0, -yaw, pitch);
        tmp.scale.setScalar(f.lengthCm / 100);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
        phaseAttrs.get(f.kind)![lod].setX(i, phaseOf(f.id));
      }
      for (const [kind, meshes] of preyMeshes) {
        for (const lod of LODS) {
          const mesh = meshes[lod];
          mesh.count = slots[lod].get(kind) ?? 0;
          mesh.instanceMatrix.needsUpdate = true;
          phaseAttrs.get(kind)![lod].needsUpdate = true;
          preyOutlines.get(kind)![lod].count = mesh.count;
        }
      }
    },
    dispose() {
      for (const m of pikeMeshes.values()) {
        ctx.scene.remove(m);
        (m.material as THREE.Material).dispose();
      }
      yolkGeo.dispose();
      yolkMat.dispose();
      pikeGeo.hero.dispose();
      pikeGeo.rival.dispose();
      pikeGeo.rivalFar.dispose();
      envMap.dispose();
      pikeOutline.dispose();
      preyOutline.dispose();
      for (const h of preyOutlines.values()) ctx.scene.remove(h.near, h.far); // geometry and matrix belong to the fish meshes
      for (const ms of preyMeshes.values()) {
        for (const m of [ms.near, ms.far]) {
          ctx.scene.remove(m);
          m.geometry.dispose();
          m.dispose();
        }
        (ms.near.material as THREE.Material).dispose();
      }
    },
  };
}
