/**
 * Game-world extras (arcade only): insects on and above the surface, and a fisherman in a boat with a
 * lure. Stepped by Simulation only when `sim.arcade`, with their own RNG stream, so the realistic
 * model and its calibration are untouched. Only human players can take insects or strike the lure.
 */
import { clamp, dist, forward, Rng, type Vec3, v3 } from "./math";
import { HUNTER, playerHidden, type HideRule } from "./hunter";
import type { PikeState } from "./pike";
import type { Simulation } from "./simulation";
import { closestOnBody } from "./tyrant";

export type InsectKind = "fly" | "beetle" | "mayfly";
export interface Insect {
  id: number;
  kind: InsectKind;
  pos: Vec3;
  vel: Vec3;
  /** seconds left before it flies off */
  life: number;
  grams: number;
  /** mayflies dance above the water: only a leaping pike reaches them */
  aloft: boolean;
}

/** A frog sitting on the surface in the shallows. `diveT` > 0: it is under water (out of reach) for that many more seconds. */
export interface Frog {
  id: number;
  pos: Vec3;
  vel: Vec3;
  /** seconds until the next kick */
  kickT: number;
  alive: boolean;
  diveT: number;
}

export type LureState = "cast" | "sink" | "retrieve" | "hooked" | "gone";
export interface Lure {
  id: number;
  pos: Vec3;
  vel: Vec3;
  state: LureState;
  /** seconds in the current state */
  t: number;
  depth: number;
}
export interface Angler {
  boat: Vec3;
  boatYaw: number;
  /** where the boat is heading (arrive, then anchor; leave at the end) */
  goal: Vec3;
  phase: "arrive" | "fish" | "leave";
  /** seconds of fishing left */
  left: number;
  lure: Lure;
  hookedId: number | null;
  /** 0..1 struggle progress; 1 throws the hook */
  escape: number;
  /** seconds hooked */
  hookedT: number;
}

export const INSECT = { target: 12, life: [25, 60] as [number, number], grams: { fly: 0.6, beetle: 1.5, mayfly: 0.9 }, mayflyFrac: 0.3 };
export const FROG = {
  target: 5,
  maxDepthM: 1.5,
  kickEveryS: [0.8, 1.6] as [number, number],
  kickSpeed: 0.35,
  diveRangeM: 0.6,
  diveDepthM: 0.4,
  resurfaceS: 4,
  grams: 30,
  lengthCm: 7,
  /** gape: a smaller pike cannot swallow one */
  minPikeCm: 14,
};
export const ANGLER = {
  firstS: 200,
  gapS: [150, 240] as [number, number],
  fishS: 100,
  boatSpeed: 1.2,
  castMin: 12,
  castMax: 22,
  retrieveSpeed: 0.9,
  pullBase: 0.9, // m/s the line drags a hooked pike toward the boat
  pullGrow: 0.06, // extra m/s per second hooked
  tension: 0.5, // fraction of its own swimming a hooked pike loses to the line
  escapePerBurst: 0.2,
  escapeSwimPerS: 0.09,
  escapeDecayPerS: 0.04,
  landM: 1.3,
  releaseHearts: 0.66, // health lost when landed and released
};

export const LURE_LENGTH_CM = 11;

/** A heron wading the shallows: its shadow follows a human in shallow water, then it stabs where the fish was 0.3 s before. */
export const HERON = { minCm: 4, maxCm: 60, shallowM: 1.2, everyS: [70, 120] as [number, number], warnS: 2.0, hitR: 0.45 };
/** An otter: comes in from the nearest shore and chases one human; hides like from a hunter. */
export const OTTER = { minCm: 10, maxCm: 70, everyS: [200, 320] as [number, number], speedMS: 1.6, durationS: 18, hideStillS: 1.2, hideMinCover: 0.35, searchS: 4, biteR: 0.4 };
/** Neither predator comes before this much play (seconds the human has been alive in this sim). */
export const PREDATOR_MIN_PLAY_S = 60;
/** the stab aims where the fish was this long before it lands */
const HERON_AIM_LEAD_S = 0.3;
/** the heron stays on screen this long after its stab (beak back up, splash) */
const HERON_LINGER_S = 0.8;
/** a hidden fish: the otter circles its last seen spot this far out, at this share of its speed */
const OTTER_SEARCH_R = HUNTER.noticeRangeM + 1;
const OTTER_SEARCH_PACE = 0.6;
/** a leaving otter is gone after this long even if it never reaches the bank */
const OTTER_LEAVE_S = 10;
const OTTER_HIDE: HideRule = { hideStillS: OTTER.hideStillS, hideMinCover: OTTER.hideMinCover, noticeRangeM: HUNTER.noticeRangeM };

export interface Heron {
  id: number;
  targetId: number;
  /** seconds since the warning */
  t: number;
  /** its shadow on the surface */
  x: number;
  z: number;
  /** where the beak will land */
  aimX: number;
  aimZ: number;
  struck: boolean;
  hit: boolean;
}

export interface Otter {
  id: number;
  targetId: number;
  pos: Vec3;
  yaw: number;
  t: number;
  lastSeen: Vec3;
  /** seconds the target has been hidden from it */
  lostS: number;
  /** the bank it came from and goes back to */
  home: Vec3;
  /** set once: then it swims home */
  /** "interrupted": a hunter or the tyrant took over */
  outcome: null | "bit" | "lost" | "timeout" | "gone" | "interrupted";
}

export type ExtraEvent =
  | { type: "angler-arrive"; t: number }
  | { type: "angler-leave"; t: number }
  | { type: "hooked"; pikeId: number; t: number }
  | { type: "unhooked"; pikeId: number; t: number }
  | { type: "released"; pikeId: number; health: number; t: number }
  | { type: "heron-warn"; pikeId: number; heronId: number; x: number; z: number; t: number }
  | { type: "heron-stab"; pikeId: number; x: number; z: number; hit: boolean; t: number }
  | { type: "heron-dodged"; pikeId: number; t: number }
  | { type: "otter-start"; pikeId: number; otterId: number; t: number }
  | { type: "otter-lost"; pikeId: number; t: number }
  | { type: "otter-end"; pikeId: number; outcome: NonNullable<Otter["outcome"]>; t: number };

export class Extras {
  insects: Insect[] = [];
  frogs: Frog[] = [];
  angler: Angler | null = null;
  heron: Heron | null = null;
  otter: Otter | null = null;
  /** Seconds each living human has played (alive in this sim), by pike id. Transient. */
  readonly playS = new Map<number, number>();
  /** Seconds of eligible play until the next heron / otter. */
  heronIn: number;
  otterIn: number;
  private rng: Rng;
  /** frogs draw from their own stream, so adding them never shifts the insects or the fisherman */
  private frogRng: Rng;
  private frogId = 20_000_000;
  /** herons and otters draw from their own stream too */
  private predRng: Rng;
  private predId = 30_000_000;
  private nextId = 10_000_000;
  /** seconds until the next fisherman */
  anglerIn = ANGLER.firstS;
  private spawnAcc = 0;
  private frogAcc = 0;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
    this.frogRng = new Rng((seed ^ 0x2f6b4d1) >>> 0);
    this.predRng = new Rng((seed ^ 0x6a09e667) >>> 0);
    this.heronIn = this.predRng.range(HERON.everyS[0], HERON.everyS[1]);
    this.otterIn = this.predRng.range(OTTER.everyS[0], OTTER.everyS[1]);
  }

  /** Any point inside the water body, away from the shore. */
  private waterPoint(sim: Simulation, minDepth = 0.8): Vec3 {
    const w = sim.world;
    for (let i = 0; i < 60; i++) {
      const x = this.rng.range(-w.size / 2, w.size / 2);
      const z = this.rng.range(-w.size / 2, w.size / 2);
      if (w.inWater(x, z) && w.depthAt(x, z) >= minDepth) return v3(x, 0, z);
    }
    return v3(0, 0, 0);
  }

  step(sim: Simulation, dt: number): void {
    this.stepInsects(sim, dt);
    this.stepFrogs(sim, dt);
    this.stepAngler(sim, dt);
    this.stepPredators(sim, dt);
  }

  // ---------------- insects ----------------
  private stepInsects(sim: Simulation, dt: number): void {
    const env = sim.env;
    // more at dawn and dusk, none in cold water
    const dusk = 1 - Math.abs(env.light - 0.5) * 2;
    const want = env.tempC < 6 ? 0 : Math.round(INSECT.target * (0.6 + 0.8 * dusk));
    this.spawnAcc += dt;
    if (this.insects.length < want && this.spawnAcc > 1.2) {
      this.spawnAcc = 0;
      this.insects.push(this.spawnInsect(sim));
    }
    for (const f of this.insects) {
      f.life -= dt;
      if (f.aloft) {
        // a dancing mayfly: up and down in a column
        f.pos.y = 0.18 + 0.14 * Math.sin(f.life * 2.3 + f.id);
        f.pos.x += Math.sin(f.life * 0.7 + f.id) * 0.15 * dt;
        f.pos.z += Math.cos(f.life * 0.6 + f.id) * 0.15 * dt;
      } else {
        // stuck in the surface film: drifts (downstream on the river) and twitches
        const c = sim.world.currentAt(f.pos.x, -0.05, f.pos.z);
        f.pos.x += (f.vel.x + c.x) * dt;
        f.pos.z += (f.vel.z + c.z) * dt;
        f.pos.y = -0.01;
        if (this.rng.next() < dt * 0.8) f.vel = v3(this.rng.range(-0.08, 0.08), 0, this.rng.range(-0.08, 0.08));
      }
      if (!sim.world.inWater(f.pos.x, f.pos.z)) f.life = 0;
    }
    this.insects = this.insects.filter((f) => f.life > 0);
  }

  private spawnInsect(sim: Simulation): Insect {
    const w = sim.world;
    // most fall in near the reeds and weed beds
    let p: Vec3;
    const beds = [...w.reeds, ...w.weeds];
    if (beds.length && this.rng.next() < 0.7) {
      const b = beds[Math.floor(this.rng.next() * beds.length)]!;
      const a = this.rng.range(0, Math.PI * 2);
      const r = b.radius * this.rng.range(0.6, 1.6);
      p = v3(b.x + Math.cos(a) * r, 0, b.z + Math.sin(a) * r);
      if (!w.inWater(p.x, p.z)) p = this.waterPoint(sim, 0.3);
    } else p = this.waterPoint(sim, 0.3);
    const aloft = this.rng.next() < INSECT.mayflyFrac;
    const kind: InsectKind = aloft ? "mayfly" : this.rng.next() < 0.3 ? "beetle" : "fly";
    return {
      id: this.nextId++,
      kind,
      pos: v3(p.x, aloft ? 0.2 : -0.01, p.z),
      vel: v3(this.rng.range(-0.05, 0.05), 0, this.rng.range(-0.05, 0.05)),
      life: this.rng.range(INSECT.life[0], INSECT.life[1]),
      grams: INSECT.grams[kind],
      aloft,
    };
  }

  /** The pike's mouth reaches an insect: eat it. Returns grams, or null if none in reach. */
  eatInsectAt(mouth: Vec3, reach: number, canReachAir: boolean): Insect | null {
    for (const f of this.insects) {
      if (f.aloft && !canReachAir) continue;
      if (Math.hypot(f.pos.x - mouth.x, f.pos.y - mouth.y, f.pos.z - mouth.z) > reach) continue;
      f.life = 0;
      this.insects = this.insects.filter((x) => x !== f);
      return f;
    }
    return null;
  }

  // ---------------- frogs ----------------
  private stepFrogs(sim: Simulation, dt: number): void {
    const w = sim.world;
    // none in cold water; they sit in the shallows near the weeds
    this.frogAcc += dt;
    if (this.frogs.length < FROG.target && sim.env.tempC >= 8 && this.frogAcc > 3) {
      this.frogAcc = 0;
      const f = this.spawnFrog(sim);
      if (f) this.frogs.push(f);
    }
    for (const f of this.frogs) {
      if (f.diveT > 0) {
        f.diveT -= dt;
        if (f.diveT <= 0) f.pos.y = -0.02; // back on the surface
        continue;
      }
      // a pike creeping close sends it under; a lunge is too quick for it to react
      const scared = sim.pikes.some((k) => k.alive && k.burstTimeLeft <= 0 && Math.hypot(k.pos.x - f.pos.x, k.pos.y - f.pos.y, k.pos.z - f.pos.z) < FROG.diveRangeM);
      if (scared) {
        f.diveT = FROG.resurfaceS;
        f.pos.y = -FROG.diveDepthM;
        f.vel = v3();
        continue;
      }
      f.kickT -= dt;
      if (f.kickT <= 0) {
        f.kickT = this.frogRng.range(FROG.kickEveryS[0], FROG.kickEveryS[1]);
        const a = this.frogRng.range(0, Math.PI * 2);
        f.vel = v3(Math.cos(a) * FROG.kickSpeed, 0, Math.sin(a) * FROG.kickSpeed);
      }
      const nx = f.pos.x + f.vel.x * dt;
      const nz = f.pos.z + f.vel.z * dt;
      if (w.inWater(nx, nz) && w.depthAt(nx, nz) < FROG.maxDepthM) {
        f.pos.x = nx;
        f.pos.z = nz;
      } else f.vel = v3();
      f.vel = v3(f.vel.x * (1 - Math.min(1, dt * 3)), 0, f.vel.z * (1 - Math.min(1, dt * 3))); // the glide dies away between kicks
    }
  }

  private spawnFrog(sim: Simulation): Frog | null {
    const w = sim.world;
    const beds = w.weeds;
    for (let i = 0; i < 40; i++) {
      let x: number;
      let z: number;
      if (beds.length && i < 30) {
        const b = beds[Math.floor(this.frogRng.next() * beds.length)]!;
        const a = this.frogRng.range(0, Math.PI * 2);
        const r = b.radius * this.frogRng.range(0.3, 1.4);
        x = b.x + Math.cos(a) * r;
        z = b.z + Math.sin(a) * r;
      } else {
        x = this.frogRng.range(-w.size / 2, w.size / 2);
        z = this.frogRng.range(-w.size / 2, w.size / 2);
      }
      if (!w.inWater(x, z) || w.depthAt(x, z) >= FROG.maxDepthM) continue;
      return { id: this.frogId++, pos: v3(x, -0.02, z), vel: v3(), kickT: this.frogRng.range(FROG.kickEveryS[0], FROG.kickEveryS[1]), alive: true, diveT: 0 };
    }
    return null;
  }

  /** The pike's mouth reaches a frog sitting on the surface (not one that dived): take it. */
  eatFrogAt(mouth: Vec3, reach: number): Frog | null {
    for (const f of this.frogs) {
      if (f.diveT > 0) continue;
      if (Math.hypot(f.pos.x - mouth.x, f.pos.y - mouth.y, f.pos.z - mouth.z) > reach) continue;
      f.alive = false;
      this.frogs = this.frogs.filter((x) => x !== f);
      return f;
    }
    return null;
  }

  // ---------------- heron and otter ----------------
  private humans(sim: Simulation): PikeState[] {
    return sim.pikes.filter((k) => k.alive && sim.isHuman(k));
  }

  private stepPredators(sim: Simulation, dt: number): void {
    const humans = this.humans(sim);
    for (const id of [...this.playS.keys()]) if (!humans.some((k) => k.id === id)) this.playS.delete(id);
    for (const k of humans) this.playS.set(k.id, (this.playS.get(k.id) ?? 0) + dt);
    if (this.heron) this.stepHeron(sim, dt);
    if (this.otter) this.stepOtter(sim, dt);
    // the clocks only run while nothing else is after anyone
    if (sim.hunter || sim.tyrant || this.heron || this.otter) return;
    const ready = (k: PikeState) => (this.playS.get(k.id) ?? 0) >= PREDATOR_MIN_PLAY_S;
    const wading = humans.filter((k) => this.heronFits(sim, k));
    if (wading.length) {
      this.heronIn -= dt;
      const ok = wading.filter(ready);
      if (this.heronIn <= 0 && ok.length) {
        this.startHeron(sim, ok[Math.floor(this.predRng.next() * ok.length)]!.id);
        return;
      }
    }
    const prey = humans.filter((k) => k.lengthCm >= OTTER.minCm && k.lengthCm <= OTTER.maxCm);
    if (prey.length) {
      this.otterIn -= dt;
      const ok = prey.filter(ready);
      if (this.otterIn <= 0 && ok.length) this.startOtter(sim, ok[Math.floor(this.predRng.next() * ok.length)]!.id);
    }
  }

  private heronFits(sim: Simulation, k: PikeState): boolean {
    return k.lengthCm >= HERON.minCm && k.lengthCm <= HERON.maxCm && sim.world.depthAt(k.pos.x, k.pos.z) < HERON.shallowM;
  }

  /** A heron spots a human in the shallows: the warning starts now (game only; no clock or play-time check). */
  startHeron(sim: Simulation, targetId: number): boolean {
    const pl = sim.pikes.find((k) => k.id === targetId);
    if (!sim.arcade || this.heron || this.otter || sim.hunter || sim.tyrant || !pl || !pl.alive || !sim.isHuman(pl) || !this.heronFits(sim, pl)) return false;
    this.heron = { id: this.predId++, targetId, t: 0, x: pl.pos.x, z: pl.pos.z, aimX: pl.pos.x, aimZ: pl.pos.z, struck: false, hit: false };
    sim.events.push({ type: "heron-warn", pikeId: targetId, heronId: this.heron.id, x: pl.pos.x, z: pl.pos.z, t: sim.time } as never);
    return true;
  }

  private stepHeron(sim: Simulation, dt: number): void {
    const h = this.heron!;
    h.t += dt;
    const pl = sim.pikes.find((k) => k.id === h.targetId);
    if (h.struck) {
      if (h.t >= HERON.warnS + HERON_LINGER_S) this.endHeron();
      return;
    }
    if (!pl || !pl.alive || sim.hunter || sim.tyrant) return this.endHeron(); // another threat took over: it flies off
    // the shadow drifts after the fish; the aim freezes just before the stab
    const k = Math.min(1, dt * 3);
    h.x += (pl.pos.x - h.x) * k;
    h.z += (pl.pos.z - h.z) * k;
    if (h.t < HERON.warnS - HERON_AIM_LEAD_S) [h.aimX, h.aimZ] = [pl.pos.x, pl.pos.z];
    if (h.t < HERON.warnS) return;
    h.struck = true;
    h.hit = Math.hypot(pl.pos.x - h.aimX, pl.pos.z - h.aimZ) < HERON.hitR;
    sim.events.push({ type: "heron-stab", pikeId: pl.id, x: h.aimX, z: h.aimZ, hit: h.hit, t: sim.time } as never);
    if (h.hit) sim.hurtPlayer(pl, "heron", h.id);
    else sim.events.push({ type: "heron-dodged", pikeId: pl.id, t: sim.time } as never);
  }

  /** A hunter or the tyrant is starting: a heron that has not struck flies off, a chasing otter leaves. */
  interrupt(sim: Simulation): void {
    if (this.heron && !this.heron.struck) this.endHeron();
    if (this.otter && !this.otter.outcome) this.endOtter(sim, "interrupted");
  }

  private endHeron(): void {
    this.heron = null;
    this.heronIn = this.predRng.range(HERON.everyS[0], HERON.everyS[1]);
  }

  /** The nearest bank point to `p`, stepped back into the water. Deterministic. */
  private shoreNear(sim: Simulation, p: Vec3): Vec3 {
    const w = sim.world;
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (let r = 0.5; r < Math.min(bestD, 40); r += 0.5) {
        if (w.inWater(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r)) continue;
        const back = Math.max(0, r - 1);
        best = v3(p.x + Math.cos(a) * back, -0.2, p.z + Math.sin(a) * back);
        bestD = r;
        break;
      }
    }
    if (!best) best = v3(p.x - 15, -0.2, p.z); // far from any bank: it swam over from somewhere
    w.confine(best, 0.1);
    return best;
  }

  /** An otter slips in from the nearest bank after this human (game only; no clock or play-time check). */
  startOtter(sim: Simulation, targetId: number): boolean {
    const pl = sim.pikes.find((k) => k.id === targetId);
    if (!sim.arcade || this.otter || this.heron || sim.hunter || sim.tyrant || !pl || !pl.alive || !sim.isHuman(pl) || pl.lengthCm < OTTER.minCm || pl.lengthCm > OTTER.maxCm) return false;
    const home = this.shoreNear(sim, pl.pos);
    this.otter = { id: this.predId++, targetId, pos: { ...home }, yaw: Math.atan2(pl.pos.z - home.z, pl.pos.x - home.x), t: 0, lastSeen: { ...pl.pos }, lostS: 0, home, outcome: null };
    sim.events.push({ type: "otter-start", pikeId: targetId, otterId: this.otter.id, t: sim.time } as never);
    return true;
  }

  private endOtter(sim: Simulation, outcome: NonNullable<Otter["outcome"]>): void {
    const o = this.otter!;
    o.outcome = outcome;
    o.t = 0;
    if (outcome === "lost") sim.events.push({ type: "otter-lost", pikeId: o.targetId, t: sim.time } as never);
    sim.events.push({ type: "otter-end", pikeId: o.targetId, outcome, t: sim.time } as never);
  }

  private swimTo(sim: Simulation, o: Otter, to: Vec3, speed: number, dt: number): number {
    const dx = to.x - o.pos.x;
    const dy = to.y - o.pos.y;
    const dz = to.z - o.pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 1e-3) {
      const s = Math.min(d, speed * dt);
      o.pos.x += (dx / d) * s;
      o.pos.y += (dy / d) * s;
      o.pos.z += (dz / d) * s;
      if (Math.hypot(dx, dz) > 1e-3) o.yaw = Math.atan2(dz, dx);
    }
    o.pos.y = Math.min(o.pos.y, -0.1);
    sim.world.confine(o.pos, 0.1);
    return d;
  }

  private stepOtter(sim: Simulation, dt: number): void {
    const o = this.otter!;
    o.t += dt;
    if (o.outcome) {
      if (this.swimTo(sim, o, o.home, OTTER.speedMS, dt) < 0.5 || o.t >= OTTER_LEAVE_S) {
        this.otter = null;
        this.otterIn = this.predRng.range(OTTER.everyS[0], OTTER.everyS[1]);
      }
      return;
    }
    const pl = sim.pikes.find((k) => k.id === o.targetId);
    if (!pl || !pl.alive) return this.endOtter(sim, "gone");
    if (sim.hunter || sim.tyrant) return this.endOtter(sim, "interrupted");
    if (o.t >= OTTER.durationS) return this.endOtter(sim, "timeout");
    // same hidden rule as the hunter (still, in cover, not right next to it)
    if (playerHidden(sim, o, pl, OTTER_HIDE)) o.lostS += dt;
    else {
      o.lostS = 0;
      o.lastSeen = { ...pl.pos };
    }
    if (o.lostS >= OTTER.searchS) return this.endOtter(sim, "lost");
    if (o.lostS > 0) {
      // circle the spot where it lost the fish
      const a = Math.atan2(o.pos.z - o.lastSeen.z, o.pos.x - o.lastSeen.x) + 0.6;
      this.swimTo(sim, o, v3(o.lastSeen.x + Math.cos(a) * OTTER_SEARCH_R, o.lastSeen.y, o.lastSeen.z + Math.sin(a) * OTTER_SEARCH_R), OTTER.speedMS * OTTER_SEARCH_PACE, dt);
      return;
    }
    this.swimTo(sim, o, pl.pos, OTTER.speedMS, dt);
    if (dist(closestOnBody(pl, o.pos), o.pos) < OTTER.biteR) {
      sim.hurtPlayer(pl, "otter", o.id);
      this.endOtter(sim, "bit");
    }
  }

  // ---------------- fisherman ----------------
  /** The next angler arrives within `inS` seconds (no effect while one is already here). */
  summonAngler(inS: number): void {
    if (!this.angler) this.anglerIn = Math.min(this.anglerIn, inS);
  }

  private stepAngler(sim: Simulation, dt: number): void {
    const a = this.angler;
    if (!a) {
      this.anglerIn -= dt;
      if (this.anglerIn <= 0) this.arrive(sim);
      return;
    }
    // boat
    const dx = a.goal.x - a.boat.x;
    const dz = a.goal.z - a.boat.z;
    const d = Math.hypot(dx, dz);
    if (a.phase !== "fish" && d > 0.5 && sim.world.shape === "river") {
      // on the river the boat follows the channel's centreline, then sidles over to its spot
      const w = sim.world;
      const ox = a.boat.x;
      const oz = a.boat.z;
      a.boat.x += Math.sign(dx) * Math.min(ANGLER.boatSpeed * dt, Math.abs(dx));
      const tz = Math.abs(a.goal.x - a.boat.x) < 4 ? a.goal.z : w.centreZ(a.boat.x);
      a.boat.z += (tz - a.boat.z) * Math.min(1, dt * 1.5);
      if (Math.hypot(a.boat.x - ox, a.boat.z - oz) > 1e-4) a.boatYaw = Math.atan2(a.boat.z - oz, a.boat.x - ox);
    } else if (a.phase !== "fish" && d > 0.5) {
      const want = Math.atan2(dz, dx);
      a.boatYaw += clamp(Math.atan2(Math.sin(want - a.boatYaw), Math.cos(want - a.boatYaw)), -0.6 * dt, 0.6 * dt);
      const sp = Math.min(ANGLER.boatSpeed, d);
      a.boat.x += Math.cos(a.boatYaw) * sp * dt;
      a.boat.z += Math.sin(a.boatYaw) * sp * dt;
    } else if (a.phase === "arrive") {
      a.phase = "fish";
      this.cast(sim, a);
    } else if (a.phase === "leave") {
      this.angler = null;
      this.anglerIn = this.rng.range(ANGLER.gapS[0], ANGLER.gapS[1]);
      sim.events.push({ type: "angler-leave", t: sim.time } as never);
      return;
    }
    if (a.phase === "fish") {
      a.left -= dt;
      if (a.left <= 0 && a.hookedId === null) this.leave(sim, a);
    }
    this.stepLure(sim, a, dt);
  }

  private arrive(sim: Simulation): void {
    const w = sim.world;
    const goal = this.waterPoint(sim, 2);
    // start at the shore on the far side of the goal
    const ang = Math.atan2(goal.z, goal.x) + Math.PI + this.rng.range(-0.6, 0.6);
    let start = v3(Math.cos(ang) * w.size * 0.45, 0, Math.sin(ang) * w.size * 0.45);
    if (w.shape === "river") {
      const x = (goal.x > 0 ? -1 : 1) * (w.size / 2 - 7); // drifts in from the far end
      start = v3(x, 0, w.centreZ(x));
    }
    if (!w.inWater(start.x, start.z)) start = this.waterPoint(sim, 0.5);
    this.angler = {
      boat: start,
      boatYaw: Math.atan2(goal.z - start.z, goal.x - start.x),
      goal,
      phase: "arrive",
      left: ANGLER.fishS,
      lure: { id: this.nextId++, pos: v3(start.x, 0, start.z), vel: v3(), state: "gone", t: 0, depth: 1 },
      hookedId: null,
      escape: 0,
      hookedT: 0,
    };
    sim.events.push({ type: "angler-arrive", t: sim.time } as never);
  }

  private leave(sim: Simulation, a: Angler): void {
    a.phase = "leave";
    a.lure.state = "gone";
    const w = sim.world;
    if (w.shape === "river") {
      const x = (a.boat.x > 0 ? 1 : -1) * (w.size / 2 - 5); // off round the nearest bend
      a.goal = v3(x, 0, w.centreZ(x));
      return;
    }
    const ang = Math.atan2(a.boat.z, a.boat.x);
    a.goal = v3(Math.cos(ang) * w.size * 0.48, 0, Math.sin(ang) * w.size * 0.48);
  }

  private cast(sim: Simulation, a: Angler): void {
    const w = sim.world;
    for (let i = 0; i < 20; i++) {
      const ang = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(ANGLER.castMin, ANGLER.castMax);
      const x = a.boat.x + Math.cos(ang) * r;
      const z = a.boat.z + Math.sin(ang) * r;
      if (!w.inWater(x, z) || w.depthAt(x, z) < 0.8) continue;
      const depth = Math.min(w.depthAt(x, z) - 0.3, this.rng.range(0.5, 1.8));
      a.lure = { id: a.lure.id, pos: v3(x, -0.05, z), vel: v3(), state: "sink", t: 0, depth };
      return;
    }
    a.lure.state = "gone";
  }

  private stepLure(sim: Simulation, a: Angler, dt: number): void {
    const L = a.lure;
    L.t += dt;
    if (L.state === "gone") {
      if (a.phase === "fish" && a.hookedId === null && L.t > 2.5) this.cast(sim, a);
      return;
    }
    if (L.state === "sink") {
      L.pos.y = Math.max(-L.depth, L.pos.y - 0.6 * dt);
      if (L.pos.y <= -L.depth + 0.01) {
        L.state = "retrieve";
        L.t = 0;
      }
      return;
    }
    if (L.state === "retrieve") {
      const dx = a.boat.x - L.pos.x;
      const dz = a.boat.z - L.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2) {
        L.state = "gone";
        L.t = 0;
        return;
      }
      // a wobbler: steady pull toward the boat with a side-to-side swim and slow rise near the end
      const wob = Math.sin(L.t * 6) * 0.35;
      const ux = dx / d;
      const uz = dz / d;
      L.vel = v3((ux - uz * wob) * ANGLER.retrieveSpeed, 0, (uz + ux * wob) * ANGLER.retrieveSpeed);
      L.pos.x += L.vel.x * dt;
      L.pos.z += L.vel.z * dt;
      L.pos.y = Math.min(-0.2, -L.depth * clamp(d / 8, 0.25, 1));
      return;
    }
    if (L.state === "hooked") {
      const pk = sim.pikes.find((k) => k.id === a.hookedId);
      if (!pk || !pk.alive) {
        a.hookedId = null;
        L.state = "gone";
        L.t = 0;
        return;
      }
      const f = forward(pk.yaw, pk.pitch);
      const Lm = pk.lengthCm / 100;
      L.pos = v3(pk.pos.x + f.x * Lm * 0.5, pk.pos.y + f.y * Lm * 0.5, pk.pos.z + f.z * Lm * 0.5);
    }
  }

  /** A human strike reached the lure: hook the pike. */
  hook(sim: Simulation, pk: PikeState): void {
    const a = this.angler;
    if (!a || a.lure.state !== "retrieve") return;
    a.lure.state = "hooked";
    a.hookedId = pk.id;
    a.escape = 0;
    a.hookedT = 0;
    pk.burstTimeLeft = 0;
    sim.events.push({ type: "hooked", pikeId: pk.id, t: sim.time } as never);
  }

  /**
   * After the pike moved this step: the line drags a hooked pike toward the boat; bursts and swimming
   * away build escape. Landing: released with damage if it has hearts to spare, else caught.
   */
  afterPikeStep(sim: Simulation, pk: PikeState, burstStarted: boolean, dt: number, landed: (pk: PikeState) => void): void {
    const a = this.angler;
    if (!a || a.hookedId !== pk.id) return;
    a.hookedT += dt;
    const dx = a.boat.x - pk.pos.x;
    const dz = a.boat.z - pk.pos.z;
    const dy = -0.05 - pk.pos.y;
    const d = Math.hypot(dx, dz, dy);
    const f = forward(pk.yaw, pk.pitch);
    const away = d > 1e-3 ? -(f.x * dx + f.y * dy + f.z * dz) / d : 0;
    // the line takes half of whatever the pike swims (the strike's leftover momentum included)
    pk.pos.x -= f.x * pk.speed * dt * ANGLER.tension;
    pk.pos.y -= f.y * pk.speed * dt * ANGLER.tension;
    pk.pos.z -= f.z * pk.speed * dt * ANGLER.tension;
    const swimming = a.hookedT > 1 && away > 0.4 && pk.speed > 0.2; // the first second is the strike's coast, not a fight
    a.escape += (burstStarted ? ANGLER.escapePerBurst : 0) + (swimming ? ANGLER.escapeSwimPerS * dt : 0) - ANGLER.escapeDecayPerS * dt;
    a.escape = clamp(a.escape, 0, 1);
    if (a.escape >= 1) {
      a.hookedId = null;
      a.lure.state = "gone";
      a.lure.t = 0;
      sim.events.push({ type: "unhooked", pikeId: pk.id, t: sim.time } as never);
      this.leave(sim, a); // a lost fish ends the session
      return;
    }
    const pull = (ANGLER.pullBase + ANGLER.pullGrow * a.hookedT) * dt;
    if (d > 1e-3) {
      pk.pos.x += (dx / d) * pull;
      pk.pos.y += (dy / d) * pull;
      pk.pos.z += (dz / d) * pull;
    }
    if (Math.hypot(dx, dz) < ANGLER.landM && pk.pos.y > -0.6) {
      a.hookedId = null;
      a.lure.state = "gone";
      a.lure.t = 0;
      landed(pk);
      this.leave(sim, a);
    }
  }

  /** Strike targets an extra offers a human pike (insects in the film, the lure while it swims). */
  lureLive(): Lure | null {
    const L = this.angler?.lure;
    return L && L.state === "retrieve" ? L : null;
  }

  find(id: number): { pos: Vec3 } | undefined {
    const L = this.lureLive();
    if (L && L.id === id) return L;
    return this.insects.find((f) => f.id === id) ?? this.frogs.find((f) => f.id === id);
  }
}
