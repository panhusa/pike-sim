import * as THREE from "three";

/**
 * Distance culling against the water's own absorption. Every lit material fades to the water colour as
 * 1 - exp(-density * distance) with density = 2.2 / max(visibility, 1.5) (see waterLook / absorption.glsl).
 * Past this radius less than 0.5 % of an object's own colour is left (well under one 8-bit step against
 * the water tint), so geometry there is invisible and need not be drawn. Infinity in the air: seen from
 * above, reeds stand in clear air and the water surface is see-through.
 */
export function fogCullRadius(visibilityM: number, cameraInAir: boolean): number {
  if (cameraInAir) return Infinity;
  return (Math.log(200) * Math.max(visibilityM, 1.5)) / 2.2;
}

/** The camera has to move this far (m) before a cull is repacked; the kept radius is padded by the same amount. */
export const CULL_STEP = 1;

/** True when a cull last packed for `l` may miss something visible from `v` (the CULL_STEP padding is used up). */
function needsRepack(l: CullView | null, v: CullView): boolean {
  if (!l) return true;
  if ((l.radius === Infinity) !== (v.radius === Infinity)) return true;
  if (v.radius === Infinity) return false;
  return Math.hypot(v.x - l.x, v.z - l.z) + Math.abs(v.radius - l.radius) >= CULL_STEP;
}

export interface CullView {
  x: number;
  z: number;
  /** fogCullRadius(); Infinity draws everything */
  radius: number;
}

/**
 * Keeps only the instances of an InstancedMesh whose base lies within the cull radius (plus `margin`, the
 * instance's own reach) of the camera, measured on the ground plane (never more than the true distance).
 * The full set is snapshotted at construction; kept instances are packed to the front and `count` is cut.
 * The material and draw call stay the same, so no shader changes and no extra draw calls.
 */
export class InstanceCull {
  private readonly mats: Float32Array;
  private readonly cols: Float32Array | null;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private readonly total: number;
  private last: CullView | null = null;

  constructor(
    readonly mesh: THREE.InstancedMesh,
    private readonly margin: number,
  ) {
    const n = (this.total = mesh.count);
    this.mats = mesh.instanceMatrix.array.slice(0, n * 16) as Float32Array;
    this.cols = mesh.instanceColor ? (mesh.instanceColor.array.slice(0, n * 3) as Float32Array) : null;
    this.xs = new Float32Array(n);
    this.zs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = this.mats[i * 16 + 12]!;
      this.zs[i] = this.mats[i * 16 + 14]!;
    }
  }

  /** Instances in the full (uncut) set. */
  get size(): number {
    return this.total;
  }

  update(v: CullView): void {
    if (!needsRepack(this.last, v)) return;
    this.last = { ...v };
    const m = this.mesh;
    const dst = m.instanceMatrix.array as Float32Array;
    const dcol = m.instanceColor ? (m.instanceColor.array as Float32Array) : null;
    let k = 0;
    if (v.radius === Infinity) {
      dst.set(this.mats);
      if (dcol && this.cols) dcol.set(this.cols);
      k = this.total;
    } else {
      const r = v.radius + this.margin + CULL_STEP;
      const r2 = r * r;
      for (let i = 0; i < this.total; i++) {
        const dx = this.xs[i]! - v.x;
        const dz = this.zs[i]! - v.z;
        if (dx * dx + dz * dz > r2) continue;
        // always copy: dst still holds the previous pack, so slot k is not instance k
        dst.set(this.mats.subarray(i * 16, i * 16 + 16), k * 16);
        if (dcol && this.cols) dcol.set(this.cols.subarray(i * 3, i * 3 + 3), k * 3);
        k++;
      }
    }
    m.count = k;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, k * 16);
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) {
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, k * 3);
      m.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * Cuts a rotated PlaneGeometry grid (rotateX(-PI/2), `seg` x `seg` cells over `size` m, centred on the origin)
 * down to the square of cells around the camera by rewriting its index. Normals and colours were computed on
 * the full grid first, so there are no seams. One draw call, as before.
 */
export class GridCull {
  private readonly full: Uint16Array | Uint32Array;
  private readonly index: THREE.BufferAttribute;
  private last: CullView | null = null;

  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly size: number,
    private readonly seg: number,
  ) {
    const idx = geo.index!;
    this.full = (idx.array as Uint16Array | Uint32Array).slice();
    this.index = idx;
  }

  update(v: CullView): void {
    if (!needsRepack(this.last, v)) return;
    this.last = { ...v };
    const dst = this.index.array as Uint16Array | Uint32Array;
    let n = 0;
    if (v.radius === Infinity) {
      dst.set(this.full);
      n = this.full.length;
    } else {
      const cell = this.size / this.seg;
      const half = this.size / 2;
      const r = v.radius + CULL_STEP + cell;
      const clampCell = (c: number): number => Math.min(this.seg - 1, Math.max(0, Math.floor(c)));
      const x0 = clampCell((v.x - r + half) / cell);
      const x1 = clampCell((v.x + r + half) / cell);
      const z0 = clampCell((v.z - r + half) / cell);
      const z1 = clampCell((v.z + r + half) / cell);
      const inside = v.x + r > -half && v.x - r < half && v.z + r > -half && v.z - r < half;
      if (inside) {
        for (let iz = z0; iz <= z1; iz++) {
          const a = (iz * this.seg + x0) * 6;
          const b = (iz * this.seg + x1 + 1) * 6;
          dst.set(this.full.subarray(a, b), n);
          n += b - a;
        }
      }
    }
    this.geo.setDrawRange(0, n);
    this.index.clearUpdateRanges();
    this.index.addUpdateRange(0, n);
    this.index.needsUpdate = true;
  }
}

/** Triangles of one mesh as the renderer would submit them (index or position count, draw range, instance count). */
export function meshTriangles(o: THREE.Mesh): number {
  const g = o.geometry;
  const verts = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
  const start = Math.max(0, g.drawRange.start);
  const count = Math.max(0, Math.min(verts, g.drawRange.start + g.drawRange.count) - start);
  const ig = g instanceof THREE.InstancedBufferGeometry && Number.isFinite(g.instanceCount) ? g.instanceCount : 1;
  const instances = (o instanceof THREE.InstancedMesh ? o.count : 1) * ig;
  return Math.floor(count / 3) * instances;
}

/**
 * Triangles a camera draws from `root` per frame: visible meshes (the whole parent chain) on a layer the
 * camera sees. No frustum test, so it is the worst case over every view direction from that spot.
 * Points and lines count as no triangles.
 */
export function trianglesOf(root: THREE.Object3D, camera: THREE.Camera, byName?: Map<string, number>): number {
  let sum = 0;
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    if (o instanceof THREE.Mesh && o.layers.test(camera.layers)) {
      const t = meshTriangles(o);
      sum += t;
      if (byName && t) {
        const k = o.name || o.geometry.type;
        byName.set(k, (byName.get(k) ?? 0) + t);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return sum;
}
