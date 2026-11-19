import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RenderCtx } from "./ctx";
import type { GfxQuality } from "./gfxSettings";
import { nearFade, plantFragment, plantFragmentPars, plantVertex, plantVertexPars } from "./shaders/plantFade.glsl";
import { applyCaustics, applyWater } from "./water";

export { nearFade };

/** Instance counts per quality: high is 40 blades per reed patch and 24 fronds per weed bed, low is half. */
export function plantCounts(q: GfxQuality, reeds: number, weeds: number): { reedBlades: number; weedFronds: number; lilyPads: number } {
  const k = q === "low" ? 0.5 : 1;
  return {
    reedBlades: Math.round(reeds * 40 * k),
    weedFronds: Math.round(weeds * 24 * k),
    lilyPads: Math.round((reeds + weeds) * 5 * k),
  };
}

const FADE_KEY = "|plantfade2";

/** Near-camera dither fade (and, with `edge`, a procedural blade outline). Chains earlier onBeforeCompile; apply BEFORE applyCaustics. */
function applyPlantFade(mat: THREE.Material, edge: boolean): void {
  const prev = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey();
  if (edge) mat.defines = { ...mat.defines, PLANT_EDGE: "", PLANT_BLADE: "" };
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${plantVertexPars}`)
      .replace("#include <project_vertex>", `#include <project_vertex>${plantVertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${plantFragmentPars}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${plantFragment}`);
  };
  mat.customProgramCacheKey = () => baseKey + FADE_KEY + (edge ? "e" : "");
}

function swayMaterial(uTime: { value: number }, side: THREE.Side): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          float baseX = instanceMatrix[3].x; float baseZ = instanceMatrix[3].z;
          float h = abs(position.y);
          transformed.x += sin(uTime * 0.9 + baseX * 0.7 + baseZ * 0.3) * 0.08 * h * h;
          transformed.z += cos(uTime * 0.7 + baseZ * 0.6) * 0.06 * h * h;`,
      );
  };
  mat.customProgramCacheKey = () => "plantsway1";
  return mat;
}

/** One flat blade, base at y = 0, tip at y = 1: 2 columns x 6 rows, a slight curve and a centre crease. */
function bladeGeometry(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.05, 1, 2, 6);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const crease = Math.abs(p.getX(i)) < 1e-6 ? -0.012 : 0;
    p.setZ(i, p.getZ(i) + 0.14 * y * y + crease);
  }
  g.computeVertexNormals();
  return g;
}

/** Milfoil frond: a thin stem plus whorls of four leaf cards, tilted outward, rotated a little each whorl. */
function frondGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.PlaneGeometry(0.022, 1, 1, 4);
  stem.translate(0, 0.5, 0);
  parts.push(stem);
  const whorls = 8;
  for (let w = 0; w < whorls; w++) {
    const y = 0.12 + (w / whorls) * 0.8;
    const size = 1 - (w / whorls) * 0.55;
    for (let c = 0; c < 4; c++) {
      const card = new THREE.PlaneGeometry(0.04 * size, 0.17 * size, 1, 1);
      card.translate(0, 0.085 * size, 0);
      card.rotateX(0.95);
      card.rotateY((c / 4) * Math.PI * 2 + w * 0.7);
      card.translate(0, y, 0);
      parts.push(card);
    }
  }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return g;
}

/** Disc with a wedge cut out, lying flat (normal +y), radius 1. */
function padGeometry(): THREE.BufferGeometry {
  const segs = 22;
  const notch = 0.5;
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i <= segs; i++) {
    const a = notch / 2 + (i / segs) * (Math.PI * 2 - notch);
    pos.push(Math.cos(a), 0, Math.sin(a));
  }
  const idx: number[] = [];
  for (let i = 1; i <= segs; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Reeds (blades), bottom weed (milfoil fronds) and lily pads with stems. Placement is seeded per world. */
export function buildPlants(ctx: RenderCtx): { dispose(): void; padSpots: Array<[number, number]> } {
  const w = ctx.sim.world;
  const counts = plantCounts(ctx.gfx.quality, w.reeds.length, w.weeds.length);
  const perReed = w.reeds.length ? counts.reedBlades / w.reeds.length : 0;
  const perWeed = w.weeds.length ? counts.weedFronds / w.weeds.length : 0;
  const edge = (w.size / 2) * 0.99;
  const outside = (x: number, z: number): boolean => (w.shape === "river" ? w.edgeDist(x, z) < 0.4 : Math.hypot(x, z) > edge);
  const tmp = new THREE.Object3D();
  tmp.rotation.order = "YXZ";
  const col = new THREE.Color();
  const added: THREE.InstancedMesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number): THREE.InstancedMesh => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.frustumCulled = false; // instances span the whole lake; per-instance culling is not worth the bounds upkeep
    ctx.scene.add(m);
    added.push(m);
    return m;
  };
  const finish = (m: THREE.Material, fadeEdge: boolean): void => {
    applyPlantFade(m, fadeEdge);
    applyCaustics(m, ctx);
    applyWater(m, ctx);
    mats.push(m);
  };

  // Reed blades: grow from the bottom through the surface, olive to yellow-green, darker at the base (shader).
  const bladeGeo = bladeGeometry();
  const reedMat = swayMaterial(ctx.uTime, THREE.DoubleSide);
  finish(reedMat, true);
  const rr = ctx.rng(9101);
  const reeds = add(bladeGeo, reedMat, counts.reedBlades);
  const olive = new THREE.Color(0x5f6e2a);
  const lime = new THREE.Color(0x9bab3c);
  let n = 0;
  for (const r of w.reeds) {
    for (let i = 0; i < perReed; i++) {
      const a = rr() * Math.PI * 2;
      const d = Math.sqrt(rr()) * r.radius;
      const x = r.x + Math.cos(a) * d;
      const z = r.z + Math.sin(a) * d;
      const bottom = w.bottomY(x, z);
      if (outside(x, z)) {
        rr(); rr(); rr(); rr(); rr(); rr(); rr();
        continue;
      }
      tmp.position.set(x, bottom - 0.03, z);
      tmp.rotation.set((rr() - 0.5) * 0.3, rr() * Math.PI * 2, (rr() - 0.5) * 0.3);
      tmp.scale.set(0.7 + rr() * 0.7, -bottom + 0.3 + r.height * 0.25 + rr() * 0.5, 1);
      tmp.updateMatrix();
      reeds.setMatrixAt(n, tmp.matrix);
      reeds.setColorAt(n, col.copy(olive).lerp(lime, rr()).multiplyScalar(0.85 + rr() * 0.3));
      n++;
    }
  }
  reeds.count = n;
  reeds.instanceMatrix.needsUpdate = true;
  if (reeds.instanceColor) reeds.instanceColor.needsUpdate = true;

  // Weed: milfoil fronds from the bed.
  const frondGeo = frondGeometry();
  const weedMat = swayMaterial(ctx.uTime, THREE.DoubleSide);
  finish(weedMat, true);
  const wr = ctx.rng(9102);
  const weeds = add(frondGeo, weedMat, counts.weedFronds);
  const deep = new THREE.Color(0x2c6a3a);
  const pale = new THREE.Color(0x6a9a40);
  n = 0;
  for (const wd of w.weeds) {
    for (let i = 0; i < perWeed; i++) {
      const a = wr() * Math.PI * 2;
      const d = Math.sqrt(wr()) * wd.radius;
      const x = wd.x + Math.cos(a) * d;
      const z = wd.z + Math.sin(a) * d;
      const h = wd.height * (0.6 + wr() * 0.7);
      tmp.position.set(x, w.bottomY(x, z) - 0.02, z);
      tmp.rotation.set((wr() - 0.5) * 0.25, wr() * Math.PI * 2, (wr() - 0.5) * 0.25);
      tmp.scale.set(h * 0.9, h, h * 0.9);
      tmp.updateMatrix();
      weeds.setMatrixAt(n, tmp.matrix);
      weeds.setColorAt(n, col.copy(deep).lerp(pale, wr()).multiplyScalar(0.85 + wr() * 0.3));
      n++;
    }
  }
  weeds.count = n;
  weeds.instanceMatrix.needsUpdate = true;
  if (weeds.instanceColor) weeds.instanceColor.needsUpdate = true;

  // Lily pads over shallow reed and weed areas, with thin stems to the bottom.
  const padGeo = padGeometry();
  const stemGeo = new THREE.CylinderGeometry(0.005, 0.009, 1, 4, 1, true);
  stemGeo.translate(0, 0.5, 0);
  const padMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x2f5a22, emissiveIntensity: 0.55 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4d6b2e, roughness: 0.9 });
  finish(padMat, false);
  finish(stemMat, false);
  const lr = ctx.rng(9103);
  const pads = add(padGeo, padMat, counts.lilyPads);
  const stems = add(stemGeo, stemMat, counts.lilyPads);
  const patches = [...w.reeds.map((r) => ({ x: r.x, z: r.z, radius: r.radius })), ...w.weeds.map((d) => ({ x: d.x, z: d.z, radius: d.radius }))];
  const padGreen = new THREE.Color(0x3f6e2a);
  const padYellow = new THREE.Color(0x7d8a32);
  n = 0;
  const padSpots: Array<[number, number]> = []; // test hook: where pads ended up
  // Clusters of 3-6 pads around a centre inside a patch; centres cycle over the patches.
  for (let c = 0, tries = 0; n < counts.lilyPads && patches.length && tries < counts.lilyPads * 4; tries++, c++) {
    const p = patches[c % patches.length]!;
    const ca = lr() * Math.PI * 2;
    const cd = Math.sqrt(lr()) * p.radius * 1.2;
    const cx = p.x + Math.cos(ca) * cd;
    const cz = p.z + Math.sin(ca) * cd;
    const members = 3 + Math.floor(lr() * 4);
    for (let m = 0; m < members && n < counts.lilyPads; m++) {
      const a = lr() * Math.PI * 2;
      const d = Math.sqrt(lr()) * 0.9;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const s = 0.2 + lr() * 0.3;
      const yaw = lr() * Math.PI * 2;
      const tint = lr();
      const depth = w.depthAt(x, z);
      if (outside(x, z) || depth < 0.2 || depth > 2.5) continue;
      tmp.position.set(x, -0.01, z);
      tmp.rotation.set(0, yaw, 0);
      tmp.scale.set(s, 1, s);
      tmp.updateMatrix();
      pads.setMatrixAt(n, tmp.matrix);
      pads.setColorAt(n, col.copy(padGreen).lerp(padYellow, tint * 0.6));
      tmp.position.set(x, -depth, z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, depth - 0.01, 1);
      tmp.updateMatrix();
      stems.setMatrixAt(n, tmp.matrix);
      padSpots.push([x, z]);
      n++;
    }
  }
  pads.count = stems.count = n;
  pads.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true;
  if (pads.instanceColor) pads.instanceColor.needsUpdate = true;

  geos.push(bladeGeo, frondGeo, padGeo, stemGeo);
  return {
    padSpots,
    dispose() {
      for (const o of added) {
        ctx.scene.remove(o);
        o.dispose();
      }
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
