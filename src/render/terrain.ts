import * as THREE from "three";
import { OUTLINE_FRAC, OUTLINE_LAYER, outlineMaterial } from "./outline";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RenderCtx } from "./ctx";
import { GridCull, InstanceCull, type CullView } from "./cull";
import { lakebedColor, lakebedFragmentPars, lakebedNormal, lakebedVertex, lakebedVertexPars } from "./shaders/lakebed.glsl";
import { applyCaustics, applyWater } from "./water";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Deterministic hash of a position, so duplicated vertices of a non-indexed mesh get the same jitter. */
function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 997) * 78.233 + Math.round(z * 997) * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Lumpy low-poly rock: an icosahedron with hash-jittered radius, flattened at the base. */
function stoneGeometry(variant: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, variant === 0 ? 0 : 1);
  const p = g.attributes.position!;
  const squash = [0.7, 0.55, 0.85][variant]!;
  const jitter = [0.32, 0.25, 0.4][variant]!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (hash3(x + variant, y, z) - 0.5) * 2 * jitter;
    p.setXYZ(i, x * k, Math.max(y * k * squash, -0.35), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Bark brightness 0.4..1.2: long vertical ridges that wander along the log. Continuous around the seam. */
function barkShade(angle: number, along: number, k: number): number {
  const ridge = Math.sin(angle * 6 + Math.sin(along * 1.7 + k) * 1.6 + k);
  const fine = Math.sin(angle * 17 + along * 0.9 + k * 3);
  return 0.78 + 0.28 * ridge + 0.1 * fine;
}

function paintBark(g: THREE.BufferGeometry, base: THREE.Color, k: number, axis: "y" | "stub"): void {
  const p = g.attributes.position!;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const s = clamp01(barkShade(Math.atan2(z, x), axis === "y" ? y : y * 3, k) / 1.2) * 1.2;
    col.set([base.r * s, base.g * s, base.b * s], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/** A log: bark-shaded cylinder along local Y with 2-4 branch stubs, merged into one geometry. */
function logGeometry(radius: number, length: number, rng: () => number): THREE.BufferGeometry {
  const bark = new THREE.Color(0x4a3a2b);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(radius * 0.85, radius, length, 12, 10);
  paintBark(trunk, bark, rng() * 6, "y");
  parts.push(trunk);
  const stubs = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < stubs; i++) {
    const len = radius * (1.2 + rng() * 1.6);
    const r = radius * (0.2 + rng() * 0.15);
    const s = new THREE.CylinderGeometry(r * 0.6, r, len, 6, 2);
    s.translate(0, len * 0.45, 0);
    paintBark(s, bark.clone().multiplyScalar(0.9), rng() * 6, "stub");
    const along = (rng() - 0.5) * length * 0.8;
    const a = rng() * Math.PI * 2;
    const rr = radius * (0.85 + 0.15 * (0.5 - along / length));
    const m = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeTranslation(rr * 0.9, along, 0)).multiply(new THREE.Matrix4().makeRotationZ(-(0.9 + rng() * 0.5)));
    s.applyMatrix4(m);
    parts.push(s);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  return merged;
}

/**
 * Lakebed (vertex colours by depth and slope, fbm detail in the shader), stones, logs and leaf litter.
 * `update` cuts the bed grid, stones and litter down to what the water's absorption leaves visible (fogCullRadius).
 */
export function buildTerrain(ctx: RenderCtx): { update(view: CullView): void; dispose(): void } {
  const w = ctx.sim.world;
  const low = ctx.gfx.quality === "low";
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const added: THREE.Object3D[] = [];
  const dispose = (): void => {
    for (const o of added) {
      ctx.scene.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
    }
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
  };
  const finish = (m: THREE.Material): void => {
    applyCaustics(m, ctx);
    applyWater(m, ctx);
    mats.push(m);
  };
  const add = (o: THREE.Object3D): void => {
    ctx.scene.add(o);
    added.push(o);
  };

  // Lakebed plane.
  const seg = w.big ? Math.min(320, Math.round(w.size / 0.9)) : 160; // keep ~1 m cells on the game-size water
  const g = new THREE.PlaneGeometry(w.size, w.size, seg, seg);
  g.rotateX(-Math.PI / 2);
  geos.push(g);
  const pos = g.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xa89e74);
  const silt = new THREE.Color(0x6a6249);
  const mud = new THREE.Color(0x35342a);
  const bank = new THREE.Color(0x4f5b34);
  const c = new THREE.Color();
  const jr = ctx.rng(31);
  const e = w.size / seg;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = w.depthAt(x, z);
    const dry = w.shape === "river" ? d <= 0 : Math.hypot(x, z) / (w.size / 2) >= 1;
    pos.setY(i, dry ? w.bankY(x, z) : -d);
    if (dry) c.copy(bank);
    else {
      const slope = Math.hypot(w.depthAt(x + e, z) - w.depthAt(x - e, z), w.depthAt(x, z + e) - w.depthAt(x, z - e)) / (2 * e);
      const deep = clamp01(d / (w.maxDepth * 0.8));
      c.copy(sand).lerp(silt, clamp01(deep * 1.6 + slope * 3)).lerp(mud, clamp01((deep - 0.45) * 1.8));
    }
    const j = 0.92 + jr() * 0.16;
    col.set([c.r * j, c.g * j, c.b * j], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const bedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  bedMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${lakebedVertexPars}`)
      .replace("#include <project_vertex>", `#include <project_vertex>${lakebedVertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${lakebedFragmentPars}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${lakebedColor}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>${lakebedNormal}`);
  };
  finish(bedMat);
  const bed = new THREE.Mesh(g, bedMat);
  bed.name = "lakebed";
  add(bed);
  const culls: Array<{ update(v: CullView): void }> = [new GridCull(g, w.size, seg)];

  // Stones: three variants, denser in the shallows.
  const stoneCount = Math.round((low ? 300 : 600) * Math.min(3, w.areaMul));
  const sr = ctx.rng(4242);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  finish(stoneMat);
  const tmp = new THREE.Object3D();
  const tint = new THREE.Color();
  const spots: { x: number; z: number; s: number }[] = [];
  for (let guard = 0; spots.length < stoneCount && guard < stoneCount * 40; guard++) {
    const a = sr() * Math.PI * 2;
    const rad = Math.sqrt(sr()) * (w.size / 2) * 0.96;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (w.shape === "river" && !w.inWater(x, z)) continue;
    const shallow = 1 - w.depthAt(x, z) / w.maxDepth;
    if (sr() > 0.12 + 0.88 * shallow * shallow) continue;
    spots.push({ x, z, s: 0.05 + Math.pow(sr(), 2.4) * 0.28 });
  }
  const perVariant = [0, 1, 2].map((v) => spots.filter((_, i) => i % 3 === v));
  perVariant.forEach((list, v) => {
    const sg = stoneGeometry(v);
    geos.push(sg);
    const im = new THREE.InstancedMesh(sg, stoneMat, list.length);
    list.forEach((sp, i) => {
      tmp.position.set(sp.x, w.bottomY(sp.x, sp.z) + sp.s * 0.15, sp.z);
      tmp.rotation.set((sr() - 0.5) * 0.4, sr() * Math.PI * 2, (sr() - 0.5) * 0.4);
      tmp.scale.set(sp.s * (0.8 + sr() * 0.5), sp.s * (0.7 + sr() * 0.5), sp.s * (0.8 + sr() * 0.5));
      tmp.updateMatrix();
      im.setMatrixAt(i, tmp.matrix);
      const grey = 0.16 + sr() * 0.22;
      tint.setRGB(grey * (1.05 + sr() * 0.15), grey * (0.98 + sr() * 0.08), grey * (0.8 + sr() * 0.12));
      im.setColorAt(i, tint);
    });
    im.instanceMatrix.needsUpdate = true;
    im.name = "stones";
    im.frustumCulled = false; // InstanceCull changes the instance set; a cached bounding sphere would go stale
    add(im);
    culls.push(new InstanceCull(im, 0.5));
  });

  // Sunken logs.
  const logMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  finish(logMat);
  const lr = ctx.rng(5353);
  for (const l of w.logs) {
    const lg = logGeometry(l.radius, l.length, lr);
    geos.push(lg);
    const m = new THREE.Mesh(lg, logMat);
    m.rotation.set(0, -l.yaw, Math.PI / 2 + 0.12);
    m.position.set(l.x, l.y, l.z);
    const hullMat = outlineMaterial(ctx, OUTLINE_FRAC * l.length);
    mats.push(hullMat);
    const hull = new THREE.Mesh(lg, hullMat);
    hull.layers.set(OUTLINE_LAYER);
    m.add(hull);
    add(m);
  }

  // Leaf litter: flat leaf-shaped decals scattered around the reed patches.
  const perReed = low ? 6 : 12;
  const litterGeo = new THREE.CircleGeometry(0.07, 6);
  geos.push(litterGeo);
  const litterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide });
  finish(litterMat);
  const litter = new THREE.InstancedMesh(litterGeo, litterMat, w.reeds.length * perReed);
  const tr = ctx.rng(6161);
  const leaf = [new THREE.Color(0x6b4b22), new THREE.Color(0x7d6a2c), new THREE.Color(0x4a3b20), new THREE.Color(0x5a5a2a)];
  tmp.rotation.order = "YXZ";
  let n = 0;
  for (const r of w.reeds) {
    for (let i = 0; i < perReed; i++) {
      const a = tr() * Math.PI * 2;
      const d = Math.sqrt(tr()) * r.radius * 1.5;
      const x = r.x + Math.cos(a) * d;
      const z = r.z + Math.sin(a) * d;
      if (w.shape === "river" ? !w.inWater(x, z) : Math.hypot(x, z) > (w.size / 2) * 0.97) continue;
      const s = 0.7 + tr() * 1.1;
      tmp.position.set(x, w.bottomY(x, z) + 0.012, z);
      tmp.rotation.set(-Math.PI / 2 + (tr() - 0.5) * 0.3, tr() * Math.PI * 2, 0);
      tmp.scale.set(s * 0.55, s, 1);
      tmp.updateMatrix();
      litter.setMatrixAt(n, tmp.matrix);
      litter.setColorAt(n, tint.copy(leaf[Math.floor(tr() * leaf.length)]!).multiplyScalar(0.8 + tr() * 0.5));
      n++;
    }
  }
  litter.count = n;
  litter.instanceMatrix.needsUpdate = true;
  litter.name = "leaf litter";
  litter.frustumCulled = false;
  add(litter);
  culls.push(new InstanceCull(litter, 0.2));

  return {
    update(view) {
      for (const c of culls) c.update(view);
    },
    dispose,
  };
}
