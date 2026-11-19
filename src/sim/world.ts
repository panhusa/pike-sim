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

export type MapShape = "lake" | "river";

/** River layout: a meandering channel along x, flowing toward +x, pools (deep, slow) and riffles (wide, shallow, fast). */
const RIVER = {
  /** bounding square = lake size x this */
  sizeMul: 1.6,
  /** water flow (m3/s): speed = flow / cross-section */
  flow: 7,
  maxSpeed: 0.9,
};

/** Game-size water (settings.big): what the game plays on; the biology tests keep the small default. */
export const BIG = {
  lakeMul: 1.8,
  riverLenMul: 2.4,
  /** plant beds per square metre, relative to the small water */
  plantDensity: 2,
  /** blades/fronds per bed, relative to the small water (renderer) */
  bladesPerBed: 1.5,
};

export class World {
  /** side of the square that holds all the water (render and spawn bounds) */
  readonly size: number;
  readonly maxDepth: number;
  readonly shape: MapShape;
  /** game-size water (see BIG) */
  readonly big: boolean;
  /** water area relative to the small default of the same shape */
  readonly areaMul: number;
  readonly reeds: Reed[] = [];
  readonly weeds: Weed[] = [];
  readonly logs: Log[] = [];
  /** river shape phases (unused on the lake) */
  private ph = [0, 0, 0, 0];
  /** hill phases for the land around the water (from the seed, without touching the world RNG) */
  private readonly hillPh: number[];

  constructor(p: Params["world"], seed: number, shape: MapShape = "lake", big = false) {
    this.shape = shape;
    this.big = big;
    this.areaMul = big ? (shape === "river" ? BIG.riverLenMul : BIG.lakeMul * BIG.lakeMul) : 1;
    const beds = big ? this.areaMul * BIG.plantDensity : 1; // plant-bed count multiplier
    const logsK = this.areaMul;
    this.maxDepth = p.maxDepth;
    this.hillPh = [1, 2, 3].map((k) => ((Math.abs(Math.sin(seed * 12.9898 + k * 78.233)) * 43758.5453) % 1) * 6.28);
    if (shape === "river") {
      this.size = p.size * RIVER.sizeMul * (big ? BIG.riverLenMul : 1);
      this.buildRiver(seed, beds, logsK);
      return;
    }
    this.size = p.size * (big ? BIG.lakeMul : 1);
    const rng = new Rng(seed);
    const half = this.size / 2;
    // Reed belt on the shallow rim, weed beds on the shelf, a few sunken logs.
    for (let i = 0; i < Math.round(140 * beds); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = half * rng.range(0.72, 0.93);
      this.reeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, radius: rng.range(1.2, 3.2), height: rng.range(0.8, 1.8) });
    }
    for (let i = 0; i < Math.round(90 * beds); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = half * rng.range(0.35, 0.8);
      this.weeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, radius: rng.range(1.5, 4), height: rng.range(0.6, 1.8) });
    }
    for (let i = 0; i < Math.round(6 * logsK); i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = half * rng.range(0.45, 0.8);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      this.logs.push({ x, z, y: -this.depthAt(x, z) + 0.3, yaw: rng.range(0, Math.PI), length: rng.range(3, 6), radius: rng.range(0.2, 0.35) });
    }
  }

  // ---------------- river ----------------
  private get riverHalfLen(): number {
    return this.size / 2 - 4;
  }
  /** Channel centreline z at x, and its slope. */
  centreZ(x: number): number {
    const [a, b] = this.ph;
    return 14 * Math.sin(x * 0.045 + a!) + 6 * Math.sin(x * 0.11 + b!);
  }
  private centreSlope(x: number): number {
    const [a, b] = this.ph;
    return 14 * 0.045 * Math.cos(x * 0.045 + a!) + 6 * 0.11 * Math.cos(x * 0.11 + b!);
  }
  /** 0 = riffle .. 1 = pool at x along the river (the two ends are pools). */
  poolness(x: number): number {
    const [, , c, d] = this.ph;
    const wave = 0.5 + 0.5 * Math.sin(x * 0.085 + c!) * (0.75 + 0.25 * Math.sin(x * 0.031 + d!));
    const end = clamp((Math.abs(x) - (this.riverHalfLen - 22)) / 14, 0, 1);
    return Math.max(wave, end);
  }
  /** Half the channel width (m) at x: riffles spread wide, pools are narrower and deep. */
  halfWidth(x: number): number {
    return 6.5 + 3.5 * (1 - this.poolness(x));
  }
  private channelDepth(x: number): number {
    return 0.7 + this.poolness(x) * (this.maxDepth * 0.75 - 0.7);
  }
  /** Signed lateral offset from the centreline, measured across the channel. */
  private lateral(x: number, z: number): number {
    const s = this.centreSlope(x);
    return (z - this.centreZ(x)) / Math.sqrt(1 + s * s);
  }

  private buildRiver(seed: number, beds: number, logsK: number): void {
    const rng = new Rng(seed);
    this.ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
    const L = this.riverHalfLen;
    const at = (x: number, u: number): [number, number] => {
      // a point at fraction u (-1..1) across the channel at x
      const s = this.centreSlope(x);
      const n = 1 / Math.sqrt(1 + s * s);
      const off = u * this.halfWidth(x);
      return [x - s * n * off, this.centreZ(x) + n * off];
    };
    // reeds fringe both banks, thicker on slow pool margins
    for (let i = 0; i < Math.round(150 * beds); i++) {
      const x = rng.range(-L + 2, L - 2);
      const [rx, rz] = at(x, (rng.next() < 0.5 ? -1 : 1) * rng.range(0.7, 0.95));
      if (rng.next() > 0.35 + 0.65 * this.poolness(x)) continue;
      this.reeds.push({ x: rx, z: rz, radius: rng.range(1.0, 2.6), height: rng.range(0.6, 1.4) });
    }
    // weed beds in the pools' slack water
    for (let i = 0, cap = Math.round(70 * beds); i < Math.round(120 * beds) && this.weeds.length < cap; i++) {
      const x = rng.range(-L + 3, L - 3);
      if (this.poolness(x) < 0.45) continue;
      const [wx, wz] = at(x, rng.range(-0.7, 0.7));
      this.weeds.push({ x: wx, z: wz, radius: rng.range(1.4, 3.4), height: rng.range(0.6, 1.6) });
    }
    // snags: fallen trees lodged along the banks
    for (let i = 0; i < Math.round(9 * logsK); i++) {
      const x = rng.range(-L + 6, L - 6);
      const [lx, lz] = at(x, (rng.next() < 0.5 ? -1 : 1) * rng.range(0.3, 0.65));
      this.logs.push({ x: lx, z: lz, y: -this.depthAt(lx, lz) + 0.3, yaw: rng.range(0, Math.PI), length: rng.range(3, 6), radius: rng.range(0.2, 0.35) });
    }
  }

  /**
   * Distance (m) from a point to the nearest shore, positive in the water, negative on land.
   * The lake's is radial; the river's is across the channel (and to its two ends).
   */
  edgeDist(x: number, z: number): number {
    if (this.shape === "lake") return this.size / 2 - Math.hypot(x, z);
    const across = this.halfWidth(x) - Math.abs(this.lateral(x, z));
    return Math.min(across, this.riverHalfLen - Math.abs(x));
  }

  /** Unit horizontal direction from a point toward open water (away from the nearest shore). */
  inward(x: number, z: number): { x: number; z: number } {
    if (this.shape === "lake") {
      const r = Math.hypot(x, z) || 1;
      return { x: -x / r, z: -z / r };
    }
    const L = this.riverHalfLen;
    if (L - Math.abs(x) < this.halfWidth(x) - Math.abs(this.lateral(x, z))) return { x: -Math.sign(x) || 1, z: 0 };
    const s = this.centreSlope(x);
    const n = 1 / Math.sqrt(1 + s * s);
    const side = Math.sign(this.lateral(x, z)) || 1;
    return { x: s * n * side, z: -n * side };
  }

  /** Water current (m/s) at a point: zero on the lake; downstream along the river, fastest mid-channel and up high. */
  currentAt(x: number, y: number, z: number): Vec3 {
    if (this.shape === "lake") return { x: 0, y: 0, z: 0 };
    const hw = this.halfWidth(x);
    const u = this.lateral(x, z) / hw;
    if (Math.abs(u) >= 1) return { x: 0, y: 0, z: 0 };
    const area = 2 * hw * this.channelDepth(x) * 0.6;
    const ends = clamp((this.riverHalfLen - Math.abs(x)) / 10, 0, 1); // fades out in the end pools
    const floor = this.bottomY(x, z);
    const nearBed = clamp((y - floor) / 0.8, 0.35, 1);
    const sp = Math.min(RIVER.maxSpeed, RIVER.flow / area) * (1 - u * u) * nearBed * ends;
    const s = this.centreSlope(x);
    const n = 1 / Math.sqrt(1 + s * s);
    return { x: sp * n, y: 0, z: sp * s * n };
  }

  /** Height of dry land (renderers): a bank rising from the water, gentler further out, rolling hills beyond. */
  bankY(x: number, z: number): number {
    const e = Math.max(0, -this.edgeDist(x, z));
    const bank = 0.6 + Math.min(e, 40) * (6 / 45) + Math.max(0, e - 40) * 0.04;
    if (e <= 6) return bank;
    const h = this.hillPh;
    const a = Math.atan2(z, x);
    const d = Math.hypot(x, z);
    const hills = (Math.sin(a * 3 + h[0]!) * 0.5 + Math.sin(a * 7 + h[1]!) * 0.3 + Math.sin(d * 0.05 + a * 2 + h[2]!) * 0.4 + 1) * 4;
    const t = clamp((e - 6) / 34, 0, 1);
    return bank + hills * t * t * (3 - 2 * t);
  }

  /** Water depth in metres at a horizontal position: shallow rim, dished lake. */
  depthAt(x: number, z: number): number {
    if (this.shape === "river") {
      const u = Math.abs(this.lateral(x, z)) / this.halfWidth(x);
      if (u >= 1 || Math.abs(x) >= this.riverHalfLen) return 0;
      const endFall = clamp((this.riverHalfLen - Math.abs(x)) / 3, 0, 1);
      const ripple = 0.15 * Math.sin(x * 0.4) * Math.sin(z * 0.33);
      return clamp((this.channelDepth(x) * Math.pow(1 - u * u, 0.6) + ripple) * endFall, 0.15, this.maxDepth);
    }
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
    if (this.shape === "river") return this.edgeDist(x, z) > 1;
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

  /** Keep a leaping fish over the lake (horizontal limit only). */
  confineXZ(pos: Vec3): void {
    if (this.shape === "river") {
      this.pushInside(pos, 1.5);
      return;
    }
    const maxR = this.size / 2 - 1.5;
    const r = Math.hypot(pos.x, pos.z);
    if (r > maxR) {
      pos.x *= maxR / r;
      pos.z *= maxR / r;
    }
  }

  /** River: push a point back into the channel until it is `margin` from the bank. */
  private pushInside(pos: Vec3, margin: number): boolean {
    let hit = false;
    for (let i = 0; i < 4; i++) {
      const e = this.edgeDist(pos.x, pos.z);
      if (e >= margin) break;
      const d = this.inward(pos.x, pos.z);
      pos.x += d.x * (margin - e + 0.01);
      pos.z += d.z * (margin - e + 0.01);
      hit = true;
    }
    return hit;
  }

  /** Keep a camera (or anything) over the water horizontally, `margin` from the shore. */
  clampXZ(pos: { x: number; z: number }, margin: number): void {
    if (this.shape === "river") {
      this.pushInside(pos as Vec3, margin);
      return;
    }
    const maxR = this.size / 2 - margin;
    const r = Math.hypot(pos.x, pos.z);
    if (r > maxR) {
      pos.x *= maxR / r;
      pos.z *= maxR / r;
    }
  }

  /** Keep a fish inside the water volume; returns true if it was pushed back. */
  confine(pos: Vec3, margin = 0.15): boolean {
    let hit = false;
    if (this.shape === "river") hit = this.pushInside(pos, 1.5);
    else {
      const maxR = this.size / 2 - 1.5;
      const r = Math.hypot(pos.x, pos.z);
      if (r > maxR) {
        pos.x *= maxR / r;
        pos.z *= maxR / r;
        hit = true;
      }
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
