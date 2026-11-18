import * as THREE from "three";
import type { PikeState } from "../sim/pike";
import { len } from "../sim/math";
import type { PreyKind } from "../sim/params";
import type { RenderCtx } from "./ctx";
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
/** Rival pike flank and back multiplier: clearly darker than the player, still pike. */
const RIVAL_TINT = 0.55;
const PREY_KINDS: PreyKind[] = ["roach", "perch", "rudd"];

/** Pike meshes (one per sim pike) and instanced prey fish. */
export function buildFish(ctx: RenderCtx): { update(player: PikeState, hidePlayer?: boolean): void; setTailBeat(player: PikeState): void; dispose(): void } {
  const pikeUniforms = { uTime: ctx.uTime, uWag: { value: 0.06 }, uFreq: { value: 6 } };
  const preyUniforms = { uTime: ctx.uTime, uWag: { value: 0.05 }, uFreq: { value: 14 } };
  const preyMeshes = new Map<PreyKind, THREE.InstancedMesh>();
  const pikeMeshes = new Map<number, THREE.Mesh>();
  const tmp = new THREE.Object3D();
  const envMap = waterEnvironment(ctx.renderer);
  const fishMats: THREE.MeshStandardMaterial[] = [];
  const preyDetail = ctx.gfx.quality === "low" ? DETAIL.low : DETAIL.high;
  const pikeGeo = { hero: buildFishModel("pike", DETAIL.hero), rival: buildFishModel("pike", DETAIL.high) };

  for (const kind of PREY_KINDS) {
    const g = buildFishModel(kind, preyDetail);
    const phases = new Float32Array(MAX_PREY);
    for (let i = 0; i < MAX_PREY; i++) phases[i] = Math.random() * 20;
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.15, envMap, envMapIntensity: 1 });
    fishMats.push(mat);
    addTailWag(mat, preyUniforms, true);
    applyFishSkin(mat, ctx, kind, 1, PREY_RIM, PREY_FILL);
    applyWater(mat, ctx);
    const mesh = new THREE.InstancedMesh(g, mat, MAX_PREY);
    mesh.frustumCulled = false;
    mesh.count = 0;
    preyMeshes.set(kind, mesh);
    ctx.scene.add(mesh);
  }

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
      m.rotation.order = "YZX";
      m.frustumCulled = false;
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
    update(player, hidePlayer = false) {
      // reflections dim with the light in the water (night, depth)
      const envI = 0.25 + 0.95 * ctx.water.uWaterLight.value;
      for (const m of fishMats) m.envMapIntensity = envI;
      for (const pk of ctx.sim.pikes) {
        const mesh = ensurePike(pk, pk === player, pk === player || ctx.sim.isHuman(pk));
        mesh.visible = pk.alive && !(hidePlayer && pk === player);
        mesh.position.set(pk.pos.x, pk.pos.y, pk.pos.z);
        mesh.rotation.set(0, -pk.yaw, pk.pitch);
        mesh.scale.setScalar(pk.lengthCm / 100);
      }
      const counts = new Map<PreyKind, number>();
      for (const f of ctx.sim.prey) {
        const mesh = preyMeshes.get(f.kind)!;
        const i = counts.get(f.kind) ?? 0;
        if (i >= MAX_PREY) continue;
        counts.set(f.kind, i + 1);
        const sp = len(f.vel);
        const yaw = sp > 0.01 ? Math.atan2(f.vel.z, f.vel.x) : 0;
        const pitch = sp > 0.01 ? Math.asin(Math.max(-1, Math.min(1, f.vel.y / sp))) : 0;
        tmp.position.set(f.pos.x, f.pos.y, f.pos.z);
        tmp.rotation.order = "YZX";
        tmp.rotation.set(0, -yaw, pitch);
        tmp.scale.setScalar(f.lengthCm / 100);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      }
      for (const [kind, mesh] of preyMeshes) {
        mesh.count = counts.get(kind) ?? 0;
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      for (const m of pikeMeshes.values()) {
        ctx.scene.remove(m);
        (m.material as THREE.Material).dispose();
      }
      pikeGeo.hero.dispose();
      pikeGeo.rival.dispose();
      envMap.dispose();
      for (const m of preyMeshes.values()) {
        ctx.scene.remove(m);
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      }
    },
  };
}
