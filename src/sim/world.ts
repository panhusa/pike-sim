import { clamp, Rng, type Vec3 } from "./math";
import type { Params } from "./params";

export interface Reed {
  x: number;
  z: number;
  radius: number;
  height: number; // metres below the surface the stems reach down from the surface
}
export interface Weed {
  x: number;
  z: number;
  radius: number;
  height: number; // metres up from the bottom
}
export interface Log {
  x: number;
  z: number;
  y: number;
  yaw: number;
  length: number;
  radius: number;
}

export class World {
  readonly size: number;
  readonly maxDepth: number;
  readonly reeds: Reed[] = [];
  readonly weeds: Weed[] = [];
  readonly logs: Log[] = [];

  constructor(p: Params["world"], seed: number) {
    this.size = p.size;
    this.maxDepth = p.maxDepth;
    const rng = new Rng(seed);
    const half = this.size / 2;
    // Reed belt on the shallow rim, weed beds on the shelf, a few sunken logs.
    for (let i = 0; i < 140; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = half * rng.range(0.72, 0.93);
      this.reeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, radius: rng.range(1.2, 3.2), height: rng.range(0.8, 1.8) });
    }
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = half * rng.range(0.35, 0.8);
      this.weeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, radius: rng.range(1.5, 4), height: rng.range(0.6, 1.8) });
    }
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = half * rng.range(0.45, 0.8);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      this.logs.push({ x, z, y: -this.depthAt(x, z) + 0.3, yaw: rng.range(0, Math.PI), length: rng.range(3, 6), radius: rng.range(0.2, 0.35) });
    }
  }

  /** Water depth in metres at a horizontal position: shallow rim, dished lake. */
  depthAt(x: number, z: number): number {
    const r = Math.hypot(x, z) / (this.size / 2);
    if (r >= 1) return 0;
    const dish = Math.sin((1 - r) * Math.PI * 0.5);
    const ripple = 0.25 * Math.sin(x * 0.18) * Math.sin(z * 0.15);
    return clamp(0.2 + dish * (this.maxDepth - 0.2) + ripple * dish, 0.15, this.maxDepth);
  }

  bottomY(x: number, z: number): number {
    return -this.depthAt(x, z);
  }

  /** Is the horizontal position inside the lake basin? */
  inWater(x: number, z: number): boolean {
    return Math.hypot(x, z) < this.size / 2 - 1;
  }

  /**
   * Cover density in [0,1] at a point: how much vegetation or wood hides a fish there.
   * Used by both camouflage (pike) and shelter-seeking (prey).
   */
  coverAt(pos: Vec3): number {
    const cell = this.coverCell(pos.x, pos.z);
    if (!cell) return 0;
    let c = 0;
    for (const r of cell.reeds) {
      const d = Math.hypot(pos.x - r.x, pos.z - r.z);
      if (d < r.radius && pos.y > -r.height - 0.2) c = Math.max(c, 1 - d / r.radius);
    }
    if (cell.weeds.length) {
      const floor = this.bottomY(pos.x, pos.z);
      for (const w of cell.weeds) {
        const d = Math.hypot(pos.x - w.x, pos.z - w.z);
        if (d < w.radius && pos.y < floor + w.height) c = Math.max(c, (1 - d / w.radius) * 0.9);
      }
    }
    for (const l of cell.logs) {
      const d = Math.hypot(pos.x - l.x, pos.z - l.z);
      if (d < l.length * 0.6 && Math.abs(pos.y - l.y) < 0.8) c = Math.max(c, 0.6 * (1 - d / (l.length * 0.6)));
    }
    return clamp(c, 0, 1);
  }

  // Uniform grid over the lake: each cell lists the features whose cover radius touches it, so coverAt
  // checks a handful of patches instead of all ~240 (it runs per prey x pike every step). Built lazily
  // from the feature arrays; results are identical to a full scan.
  private static readonly CELL = 4;
  private grid: { reeds: Reed[]; weeds: Weed[]; logs: Log[] }[] | null = null;
  private gridN = 0;

  private coverCell(x: number, z: number): { reeds: Reed[]; weeds: Weed[]; logs: Log[] } | null {
    if (!this.grid) this.buildGrid();
    const half = this.size / 2 + World.CELL;
    const i = Math.floor((x + half) / World.CELL);
    const j = Math.floor((z + half) / World.CELL);
    if (i < 0 || j < 0 || i >= this.gridN || j >= this.gridN) return null;
    return this.grid![j * this.gridN + i]!;
  }

  private buildGrid(): void {
    const C = World.CELL;
    const half = this.size / 2 + C; // one cell of padding past the shore
    const n = (this.gridN = Math.ceil(this.size / C) + 2);
    const g = (this.grid = Array.from({ length: n * n }, () => ({ reeds: [] as Reed[], weeds: [] as Weed[], logs: [] as Log[] })));
    const add = <T>(pick: (c: (typeof g)[number]) => T[], item: T, x: number, z: number, r: number): void => {
      const i0 = Math.max(0, Math.floor((x - r + half) / C));
      const i1 = Math.min(n - 1, Math.floor((x + r + half) / C));
      const j0 = Math.max(0, Math.floor((z - r + half) / C));
      const j1 = Math.min(n - 1, Math.floor((z + r + half) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) pick(g[j * n + i]!).push(item);
    };
    for (const r of this.reeds) add((c) => c.reeds, r, r.x, r.z, r.radius);
    for (const w of this.weeds) add((c) => c.weeds, w, w.x, w.z, w.radius);
    for (const l of this.logs) add((c) => c.logs, l, l.x, l.z, l.length * 0.6);
  }

  /** Keep a fish inside the water volume; returns true if it was pushed back. */
  confine(pos: Vec3, margin = 0.15): boolean {
    let hit = false;
    const maxR = this.size / 2 - 1.5;
    const r = Math.hypot(pos.x, pos.z);
    if (r > maxR) {
      pos.x *= maxR / r;
      pos.z *= maxR / r;
      hit = true;
    }
    const floor = this.bottomY(pos.x, pos.z) + margin;
    if (pos.y < floor) {
      pos.y = floor;
      hit = true;
    }
    if (pos.y > -margin) {
      pos.y = -margin;
      hit = true;
    }
    return hit;
  }
}
