/**
 * Game-world extras (arcade only): insects on and above the surface, and a fisherman in a boat with a
 * lure. Stepped by Simulation only when `sim.arcade`, with their own RNG stream, so the realistic
 * model and its calibration are untouched. Only human players can take insects or strike the lure.
 */
import { clamp, forward, Rng, type Vec3, v3 } from "./math";
import type { PikeState } from "./pike";
import type { Simulation } from "./simulation";

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

export type ExtraEvent =
  | { type: "angler-arrive"; t: number }
  | { type: "angler-leave"; t: number }
  | { type: "hooked"; pikeId: number; t: number }
  | { type: "unhooked"; pikeId: number; t: number }
  | { type: "released"; pikeId: number; health: number; t: number };

export class Extras {
  insects: Insect[] = [];
  angler: Angler | null = null;
  private rng: Rng;
  private nextId = 10_000_000;
  /** seconds until the next fisherman */
  anglerIn = ANGLER.firstS;
  private spawnAcc = 0;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x5bd1e995) >>> 0);
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
    this.stepAngler(sim, dt);
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

  // ---------------- fisherman ----------------
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
    return this.insects.find((f) => f.id === id);
  }
}
