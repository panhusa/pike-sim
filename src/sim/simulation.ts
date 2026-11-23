import { environmentAt, type Environment } from "./environment";
import { clamp, dist, dot, forward, norm, Rng, sub, v3, type Vec3 } from "./math";
import { defaultParams, isArcadeOnly, type Params, type PreyKind } from "./params";
import { checkMilestones, type MilestoneId } from "./milestones";
import { canStartBurst, condition, makePike, stepPike, lengthM, stomachRoom, tooFullFor, type PikeInput, type PikeState, type Sex, type DeathCause } from "./pike";
import { homingInput, lungeCandidate, PLAYER_AIM_S, PLAYER_HOMING_MAX } from "./lunge";
import { NURSERY_END_CM, NURSERY_PREY_FRAC, gameGrow, nurseryGrow } from "./nursery";
import { makeRivalMemory, pickHome, rivalInput } from "./rival";
import { presetSettings, type SimSettings } from "./settings";
import { spawnPrey, stepPrey, preySpeed, type PreyState } from "./prey";
import { growPreyDay, preyMortalityDay } from "./preyLife";
import { cohortsDay, stepSpawning, type Cohort, type SpawnState } from "./spawning";
import { World } from "./world";
import { HUNTER, hunterInput, hunterMinLength, type Hunter } from "./hunter";
import { closestOnBody, TYRANT, TYRANT_CHARGE_MAX_S, TYRANT_LEAVE_S, TYRANT_SPAWN_M, tyrantInput, type Tyrant } from "./tyrant";
import { ANGLER, Extras, FROG, type ExtraEvent, type Insect } from "./extras";
import { leapStep, type Airborne, type LeapEvent } from "./leap";

export type MissReason = "evaded" | "too-big" | "full" | "off-axis";

export type SimEvent =
  | { type: "bolt"; preyId: number; pikeDistance: number; t: number }
  | { type: "strike"; pikeId: number; lockId: number | null; t: number }
  | { type: "capture"; pikeId: number; preyId: number; kind: PreyKind | "pike" | "insect" | "frog"; grams: number; lengthCm: number; t: number }
  | { type: "miss"; pikeId: number; preyId: number; reason: MissReason; t: number }
  | { type: "strike-empty"; pikeId: number; t: number }
  | { type: "death"; pikeId: number; cause: DeathCause; byPikeId?: number; t: number }
  | { type: "recruit"; kind: PreyKind; count: number; t: number }
  | { type: "spawn"; pikeIds: [number, number]; cohortId: number; t: number }
  | { type: "recruit-pike"; cohortId: number; pikeIds: number[]; t: number }
  | { type: "milestone"; id: MilestoneId; t: number }
  | ExtraEvent
  | LeapEvent
  | { type: "bitten"; pikeId: number; byPikeId: number; health: number; t: number }
  | { type: "scared"; pikeId: number; byId: number; cause: "pike" | "heron" | "otter" | "tyrant"; t: number }
  | { type: "hunter-start"; hunterId: number; targetId: number; lengthCm: number; t: number }
  | { type: "hunter-end"; hunterId: number; targetId: number; outcome: NonNullable<Hunter["outcome"]>; t: number }
  | { type: "tyrant-start"; tyrantId: number; targetId: number; lengthCm: number; t: number }
  | { type: "tyrant-hit"; tyrantId: number; hp: number; t: number }
  | { type: "tyrant-end"; tyrantId: number; targetId: number; outcome: NonNullable<Tyrant["outcome"]>; t: number };

export interface SimOptions {
  seed?: number;
  params?: Params;
  startDay?: number;
  startHour?: number; // 0..24, default 08:00
  preyScale?: number; // multiplier on initial prey counts (performance tuning)
  settings?: SimSettings;
}

/** Everything needed to resume a simulation exactly; the world is regenerated from `seed`. */
export interface SimState {
  seed: number;
  startDay: number;
  time: number;
  rng: number;
  nextId: number;
  nextSchool: number;
  nextCohort: number;
  lastDay: number;
  settings: SimSettings;
  playerId: number | null;
  pikes: PikeState[];
  prey: PreyState[];
  cohorts: Cohort[];
  spawn: SpawnState;
  attempted: string[];
  capacity: [PreyKind, number][];
  milestones: MilestoneId[];
  playerSawWinter: boolean;
  playerHintsDone?: boolean;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Game only: live prey kept topped up to this multiple of each kind's carrying capacity. */
export const ARCADE_STOCK = 1.25;
/** Game-only species: carrying capacity as a share of the roach capacity (kept out of this.capacity, so recruitment never sees them). */
export const ARCADE_ONLY_STOCK: Partial<Record<PreyKind, number>> = { bream: 0.25, tench: 0.15 };
/** Health an arcade bite costs: three bites from full health kill. */
export const ARCADE_BITE = 0.34;
/** Arcade health regained per real second while not starving (one bite back in about a minute). */
const ARCADE_HEAL_PER_S = 0.0055;

/**
 * Game (river): share of the current that carries a nursery-sized fish (cm). Larvae and babies shelter in
 * the weeds, so the hatchling and its prey stay together; full current from 12.5 cm.
 */
export function shelteredDrift(lengthCm: number): number {
  return clamp((lengthCm - 2.5) / 10, 0, 1);
}

const NO_INPUT: PikeInput = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };

export class Simulation {
  readonly p: Params;
  readonly world: World;
  readonly rng: Rng;
  readonly seed: number;
  readonly settings: SimSettings;
  playerId: number | null = null;
  /** Milestones the player has achieved, in order. */
  milestones: MilestoneId[] = [];
  /** True once the living player has been through a winter day. */
  playerSawWinter = false;
  /** First-life hunting hints finished (set by the first player capture). */
  playerHintsDone = false;
  /** Offspring cohorts (plain JSON state). */
  cohorts: Cohort[] = [];
  nextCohortId = 1;
  spawn: SpawnState;
  pikes: PikeState[] = [];
  prey: PreyState[] = [];
  env: Environment;
  time = 0;
  events: SimEvent[] = [];
  /** Game feel: the player pike swims, strikes and hides by params.arcade (set by the game, never by tests or calibration). */
  arcade = false;
  /** Other human players' pike (multiplayer guests; transient, not saved). They get the arcade tuning like the player. */
  readonly humanIds = new Set<number>();
  /** Chill game: humans cannot die (arcade + settings.chill). */
  get chill(): boolean {
    return this.arcade && this.settings.chill === true;
  }

  /** Game leaps in progress, by pike id (arcade humans only; transient). */
  airborne = new Map<number, Airborne>();
  /** Insects and the fisherman (arcade only; transient, own RNG). */
  extras: Extras;
  /** Active game hunter event (transient, not saved). */
  hunter: Hunter | null = null;
  /** Active game boss, the Old Tyrant (arcade only; transient, not saved). */
  tyrant: Tyrant | null = null;
  /** Guest mirror only: the tyrant's pike id, learned from events (the host has `tyrant`). For the renderer. */
  tyrantSeenId: number | null = null;
  private arcadeParams: Params | null = null;
  private inputs = new Map<number, PikeInput>();
  private attempted = new Set<string>();
  /** Pike ids whose current burst produced a capture or miss (transient, not saved). */
  private hadOutcome = new Set<number>();
  private nextId = 1;
  private nextSchool = 1;
  private lastDay = -1;
  readonly startDay: number;
  /** Biological seconds per simulation second: the calendar runs faster than locomotion. */
  readonly bioScale: number;
  /** Carrying capacity per species (individuals), derived from initial stocking. */
  private capacity = new Map<PreyKind, number>();

  constructor(opts: SimOptions = {}, restore?: SimState) {
    this.p = opts.params ?? defaultParams;
    this.seed = opts.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.settings = opts.settings ?? presetSettings("natural", "permadeath", this.p);
    this.world = new World(this.p.world, this.seed * 7919, this.settings.map === "river" ? "river" : "lake", this.settings.big === true);
    this.extras = new Extras(this.seed);
    this.startDay = opts.startDay ?? 120; // spring
    this.spawn = { year: Math.floor(this.startDay / this.p.environment.yearLengthDays), openDay: null, dwell: {} };
    this.bioScale = 86400 / this.p.environment.dayLengthS;
    this.time = (opts.startHour ?? 8) / 24 * this.p.environment.dayLengthS;
    this.env = environmentAt(this.time, this.startDay, this.p.environment);
    if (restore) {
      this.applyState(restore);
      return;
    }
    // game-size water: stock it at 75% of the small water's density, so it is not empty but the frame stays light
    const scale = (opts.preyScale ?? 1) * (this.world.big ? this.world.areaMul * 0.75 : 1);
    for (const kind of Object.keys(this.p.prey) as PreyKind[]) {
      const spec = this.p.prey[kind];
      if (isArcadeOnly(spec)) continue; // bream and tench arrive only through the game's restock
      const [minS, maxS] = spec.schooling.size as [number, number];
      const target = Math.round((kind === "roach" ? 60 : kind === "perch" ? 36 : 28) * scale);
      this.capacity.set(kind, Math.round(target * 1.6));
      let placed = 0;
      while (placed < target) {
        const n = Math.min(target - placed, this.rng.int(minS, maxS));
        this.spawnSchool(kind, n);
        placed += n;
      }
    }
    const [lo, hi] = this.p.rival.lengthCmRange as [number, number];
    for (let i = 0; i < this.settings.rivalCount; i++) {
      const len = this.rng.range(lo, hi) * this.settings.rivalSizeScale;
      this.addRival(len, this.rng.next() < this.p.pike.maleFraction ? "male" : "female");
    }
  }

  private applyState(s: SimState): void {
    const c = clone(s);
    this.time = c.time;
    this.env = environmentAt(this.time, this.startDay, this.p.environment);
    this.rng.state = c.rng;
    this.nextId = c.nextId;
    this.nextSchool = c.nextSchool;
    this.nextCohortId = c.nextCohort;
    this.lastDay = c.lastDay;
    this.playerId = c.playerId;
    this.milestones = c.milestones;
    this.playerSawWinter = c.playerSawWinter;
    this.playerHintsDone = c.playerHintsDone ?? true;
    this.pikes = c.pikes;
    for (const pk of this.pikes) pk.lockId ??= null;
    this.prey = c.prey;
    this.cohorts = c.cohorts;
    this.spawn = c.spawn;
    this.attempted = new Set(c.attempted);
    this.capacity = new Map(c.capacity);
  }

  toState(): SimState {
    return clone({
      seed: this.seed,
      startDay: this.startDay,
      time: this.time,
      rng: this.rng.state,
      nextId: this.nextId,
      nextSchool: this.nextSchool,
      nextCohort: this.nextCohortId,
      lastDay: this.lastDay,
      settings: this.settings,
      playerId: this.playerId,
      pikes: this.tyrant ? this.pikes.filter((k) => k.id !== this.tyrant!.id) : this.pikes, // the boss is not saved
      prey: this.prey,
      cohorts: this.cohorts,
      spawn: this.spawn,
      attempted: [...this.attempted],
      capacity: [...this.capacity],
      milestones: this.milestones,
      playerSawWinter: this.playerSawWinter,
      playerHintsDone: this.playerHintsDone,
    });
  }

  static fromState(s: SimState, params?: Params): Simulation {
    return new Simulation({ seed: s.seed, startDay: s.startDay, settings: clone(s.settings), params }, s);
  }

  /** Add an AI-controlled pike that holds a cover home, hunts, patrols and flees larger pike. */
  addRival(lengthCm: number, sex: Sex): PikeState {
    const pk = this.addPike(lengthCm, undefined, sex);
    pk.ai = makeRivalMemory(pk.pos);
    pk.ai.home = pickHome(this, pk);
    pk.pos = { ...pk.ai.home };
    return pk;
  }

  addPike(lengthCm: number, pos?: Vec3, sex: Sex = "female"): PikeState {
    const spawn = pos ?? this.randomWaterPos(0.55);
    const pk = makePike(this.nextId++, spawn, lengthCm, this.p, sex);
    pk.yaw = this.rng.range(0, Math.PI * 2);
    pk.stomachG = 0;
    this.pikes.push(pk);
    return pk;
  }

  /** Add the player's pike; sex is drawn from the sim RNG. */
  addPlayer(lengthCm: number): PikeState {
    const sex: Sex = this.rng.next() < this.p.pike.maleFraction ? "male" : "female";
    const pk = this.addPike(lengthCm, undefined, sex);
    this.playerId = pk.id;
    return pk;
  }

  /**
   * Send a big pike after the player (game event). Reuses a resident rival big enough to swallow the
   * player, else adds one; it starts spawnBehindM behind the player, facing it. Returns its id or null.
   */
  startHunter(targetId: number | null = this.playerId): number | null {
    const pl = this.pikes.find((k) => k.id === targetId) ?? null;
    // one threat at a time: no hunter while a heron stalks, an otter chases or the tyrant is here
    if (!pl || !pl.alive || this.hunter || this.tyrant || this.extras.heron || this.extras.otter) return null;
    const minLen = hunterMinLength(this, pl);
    let hk = this.pikes.find((k) => k.alive && k.ai && k.lengthCm >= minLen && k.lengthCm <= minLen * 2.2) ?? null;
    hk ??= this.addRival(minLen * 1.05, this.rng.next() < 0.5 ? "male" : "female");
    // a tiny hunter swims slowly: start closer so the chase reaches a larva/fry within the hunt's duration
    const back = clamp(hk.lengthCm * 0.35, 2, HUNTER.spawnBehindM);
    hk.pos = v3(pl.pos.x - Math.cos(pl.yaw) * back, pl.pos.y, pl.pos.z - Math.sin(pl.yaw) * back);
    this.world.confine(hk.pos, 0.2);
    hk.yaw = Math.atan2(pl.pos.z - hk.pos.z, pl.pos.x - hk.pos.x);
    hk.pitch = 0;
    hk.speed = 0;
    hk.burstCooldown = 0;
    hk.stomachG = 0; // a hungry hunter
    this.hunter = { id: hk.id, targetId: pl.id, t: 0, lastSeen: { ...pl.pos }, lostS: 0, outcome: null };
    this.events.push({ type: "hunter-start", hunterId: hk.id, targetId: pl.id, lengthCm: hk.lengthCm, t: this.time });
    return hk.id;
  }

  /** Arcade: a strike that would swallow the player takes a bite instead; the attacker backs off. */
  private bitePlayer(attacker: PikeState, pl: PikeState, grams: number): void {
    attacker.stomachG -= grams; // rollStrike filled it; nothing was swallowed
    attacker.burstTimeLeft = 0;
    attacker.burstCooldown = 4;
    attacker.speed *= 0.2;
    if (attacker.ai) {
      attacker.ai.targetId = null;
      attacker.ai.fleeFrom = { ...pl.pos };
      attacker.ai.fleeS = 4;
    }
    pl.health = Math.max(0.01, pl.health - ARCADE_BITE);
    pl.energy = this.paramsFor(pl).pike.energyMax; // adrenaline: a full burst to get away
    pl.burstCooldown = 0;
    pl.stillTime = 0;
    if (this.hunter?.id === attacker.id) this.hunter.outcome = "bit-player";
    this.events.push({ type: "bitten", pikeId: pl.id, byPikeId: attacker.id, health: pl.health, t: this.time });
  }

  /**
   * Game: a heron's stab or an otter's bite on a human. Chill: a scare. Otherwise one heart; the last
   * heart kills with `deathCause = cause`.
   */
  hurtPlayer(pk: PikeState, cause: "heron" | "otter", byId: number): void {
    if (!pk.alive) return;
    if (this.chill) return this.scare(pk, byId, cause);
    if (pk.health > ARCADE_BITE + 0.01) {
      pk.health = Math.max(0.01, pk.health - ARCADE_BITE);
      pk.energy = this.paramsFor(pk).pike.energyMax; // adrenaline, as after a pike's bite
      pk.burstCooldown = 0;
      pk.stillTime = 0;
      this.events.push({ type: "bitten", pikeId: pk.id, byPikeId: byId, health: pk.health, t: this.time });
      return;
    }
    pk.alive = false;
    pk.deathCause = cause;
    this.events.push({ type: "death", pikeId: pk.id, cause, t: this.time });
  }

  /** Game: a threat frightened a chill player. Stops it dead; health untouched. Used by hunters, birds, otters, tyrants. */
  scare(pk: PikeState, byId: number, cause: "pike" | "heron" | "otter" | "tyrant"): void {
    pk.speed = 0;
    pk.burstTimeLeft = 0;
    this.events.push({ type: "scared", pikeId: pk.id, byId, cause, t: this.time });
  }

  /**
   * Game boss (stage-8 trial): the Old Tyrant, TYRANT.sizeMul x the target's length, appears 12-16 m
   * away facing it. Arcade only, one at a time; no RNG draws. Returns its pike id or null.
   */
  startTyrant(targetId: number): number | null {
    const pl = this.pikes.find((k) => k.id === targetId) ?? null;
    if (!this.arcade || !pl || !pl.alive || this.tyrant) return null;
    let pos: Vec3 | null = null;
    // behind the target first, then round both sides
    for (let i = 0; i < 12 && !pos; i++) {
      const a = pl.yaw + Math.PI + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 6);
      for (const r of TYRANT_SPAWN_M) {
        const x = pl.pos.x + Math.cos(a) * r;
        const z = pl.pos.z + Math.sin(a) * r;
        if (!this.world.inWater(x, z) || this.world.depthAt(x, z) < 1) continue;
        pos = v3(x, clamp(pl.pos.y, -this.world.depthAt(x, z) + 0.4, -0.4), z);
        break;
      }
    }
    pos ??= v3(pl.pos.x - Math.cos(pl.yaw) * 14, pl.pos.y, pl.pos.z - Math.sin(pl.yaw) * 14);
    this.world.confine(pos, 0.2);
    const ty = makePike(this.nextId++, pos, pl.lengthCm * TYRANT.sizeMul, this.p, "female");
    ty.yaw = Math.atan2(pl.pos.z - pos.z, pl.pos.x - pos.x);
    ty.stomachG = 0;
    ty.spawnedYear = this.spawn.year; // here to fight, not to breed
    this.pikes.push(ty);
    this.extras.interrupt(this); // the boss fight wins: a stalking heron flies off, an otter slips away
    this.tyrant = { id: ty.id, targetId: pl.id, hp: TYRANT.hp, t: 0, phase: "circle", phaseT: 0, hitSerials: new Set(), outcome: null };
    this.events.push({ type: "tyrant-start", tyrantId: ty.id, targetId: pl.id, lengthCm: ty.lengthCm, t: this.time });
    return ty.id;
  }

  private endTyrant(outcome: NonNullable<Tyrant["outcome"]>): void {
    const ty = this.tyrant!;
    ty.outcome = outcome;
    ty.phase = "flee";
    ty.phaseT = 0;
    this.events.push({ type: "tyrant-end", tyrantId: ty.id, targetId: ty.targetId, outcome, t: this.time });
  }

  private stepTyrant(dt: number): void {
    const ty = this.tyrant!;
    ty.t += dt;
    ty.phaseT += dt;
    const tk = this.pikes.find((k) => k.id === ty.id);
    if (ty.outcome) {
      if (ty.phaseT < TYRANT_LEAVE_S && tk) return;
      // gone from the lake: snapshots stop listing it, guests mark it dead
      this.pikes = this.pikes.filter((k) => k.id !== ty.id);
      this.inputs.delete(ty.id);
      this.tyrant = null;
      return;
    }
    const pl = this.pikes.find((k) => k.id === ty.targetId) ?? null;
    if (pl && !pl.alive && pl.killedBy === ty.id) this.endTyrant("ate-player");
    else if (!pl || !pl.alive || !tk || !tk.alive || ty.t >= TYRANT.timeoutS) this.endTyrant("left");
    else if (ty.phase === "circle" && ty.phaseT >= TYRANT.chargeEveryS) [ty.phase, ty.phaseT] = ["charge", 0];
    else if (ty.phase === "charge" && ty.phaseT >= TYRANT_CHARGE_MAX_S && tk.burstTimeLeft <= 0) [ty.phase, ty.phaseT] = ["circle", 0];
    else if (ty.phase === "flee" && ty.phaseT >= TYRANT.fleeS) [ty.phase, ty.phaseT] = ["circle", 0];
  }

  /** The tyrant's own strike: only while charging, only at its target, once per burst. A bursting target slips it. */
  private tyrantStrike(tk: PikeState): void {
    const ty = this.tyrant!;
    if (ty.outcome || ty.phase !== "charge") return;
    const pl = this.pikes.find((k) => k.id === ty.targetId);
    if (!pl || !pl.alive) return;
    const L = lengthM(tk);
    const f = forward(tk.yaw, tk.pitch);
    const mouth = v3(tk.pos.x + f.x * L * 0.5, tk.pos.y + f.y * L * 0.5, tk.pos.z + f.z * L * 0.5);
    const at = closestOnBody(pl, mouth);
    if (dist(at, mouth) > this.p.pike.strikeRangeBL * L || dot(f, norm(sub(at, tk.pos))) < this.p.strike.alignMin) return;
    const key = `${tk.id}:${tk.burstSerial}:${pl.id}`;
    if (this.attempted.has(key)) return;
    this.attempted.add(key);
    this.hadOutcome.add(tk.id);
    if (pl.burstTimeLeft > 0) {
      this.events.push({ type: "miss", pikeId: tk.id, preyId: pl.id, reason: "evaded", t: this.time });
      return;
    }
    tk.burstTimeLeft = 0;
    tk.burstCooldown = 4;
    tk.speed *= 0.2;
    ty.phase = "flee";
    ty.phaseT = 0;
    if (this.chill && this.isHuman(pl)) this.scare(pl, tk.id, "tyrant");
    else if (this.isHuman(pl) && pl.health > ARCADE_BITE + 0.01) this.bitePlayer(tk, pl, 0);
    else {
      pl.alive = false;
      pl.deathCause = "eaten";
      pl.killedBy = tk.id;
      pl.killedByLengthCm = tk.lengthCm;
      const grams = Math.min(pl.weight, stomachRoom(tk, this.p));
      tk.stomachG += grams;
      this.events.push({ type: "capture", pikeId: tk.id, preyId: pl.id, kind: "pike", grams, lengthCm: pl.lengthCm, t: this.time });
      this.events.push({ type: "death", pikeId: pl.id, cause: "eaten", byPikeId: tk.id, t: this.time });
      this.endTyrant("ate-player");
    }
  }

  /** The target's strike reaching the tyrant's body counts one hit per burst (not a capture). True on a hit. */
  private tyrantHit(pk: PikeState, mouth: Vec3, reach: number, f: Vec3): boolean {
    const ty = this.tyrant;
    if (!ty || ty.outcome || pk.id !== ty.targetId) return false;
    const key = `${pk.id}:${pk.burstSerial}`;
    if (ty.hitSerials.has(key)) return false;
    const tk = this.pikes.find((k) => k.id === ty.id);
    if (!tk || !tk.alive) return false;
    const at = closestOnBody(tk, mouth);
    if (dist(at, mouth) > reach || dot(f, norm(sub(at, pk.pos))) < this.paramsFor(pk).strike.alignMin) return false;
    ty.hitSerials.add(key);
    this.hadOutcome.add(pk.id);
    ty.hp -= 1;
    tk.burstTimeLeft = 0; // a bite stops its charge dead
    tk.lockId = null;
    this.events.push({ type: "tyrant-hit", tyrantId: ty.id, hp: ty.hp, t: this.time });
    if (ty.hp <= 0) this.endTyrant("beaten");
    else {
      ty.phase = "flee";
      ty.phaseT = 0;
    }
    return true;
  }

  private stepHunter(dt: number): void {
    const h = this.hunter!;
    h.t += dt;
    const hk = this.pikes.find((k) => k.id === h.id);
    const pl = this.pikes.find((k) => k.id === h.targetId) ?? null;
    if (h.outcome) {
      /* set elsewhere this tick (bite) */
    } else if (pl && !pl.alive && pl.killedBy === h.id) h.outcome = "ate-player";
    else if (!hk || !hk.alive) h.outcome = "hunter-died";
    else if (h.lostS >= HUNTER.searchS) h.outcome = "escaped";
    else if (h.t >= HUNTER.durationS) h.outcome = "timeout";
    if (!h.outcome) return;
    if (hk?.ai) {
      hk.ai.mode = "hold";
      hk.ai.targetId = null;
      hk.ai.lostS = 0;
    }
    this.events.push({ type: "hunter-end", hunterId: h.id, targetId: h.targetId, outcome: h.outcome, t: this.time });
    this.hunter = null;
  }

  /** Params a pike lives by: the shared set, or the arcade-tuned copy for the player when arcade is on. */
  paramsFor(pk: PikeState): Params {
    if (!this.arcade || !this.isHuman(pk)) return this.p;
    return (this.arcadeParams ??= arcadeParams(this.p, this.settings.growthMul ?? 1));
  }

  isHuman(pk: PikeState): boolean {
    return pk.id === this.playerId || this.humanIds.has(pk.id);
  }

  /** Add a multiplayer guest's pike (a human that is not the local player). */
  addHuman(lengthCm: number): PikeState {
    const sex: Sex = this.rng.next() < this.p.pike.maleFraction ? "male" : "female";
    const pk = this.addPike(lengthCm, undefined, sex);
    this.humanIds.add(pk.id);
    return pk;
  }

  player(): PikeState | null {
    return this.pikes.find((k) => k.id === this.playerId) ?? null;
  }

  setInput(pikeId: number, input: PikeInput): void {
    this.inputs.set(pikeId, input);
  }

  private randomWaterPos(depthFrac: number): Vec3 {
    const half = this.world.size / 2;
    for (;;) {
      const x = this.rng.range(-half, half) * 0.8;
      const z = this.rng.range(-half, half) * 0.8;
      if (!this.world.inWater(x, z)) continue;
      const d = this.world.depthAt(x, z);
      if (d < 1) continue;
      return v3(x, -d * depthFrac, z);
    }
  }

  /** `sizes` (game nursery): baby fish lengths in cm, and a school spread to match (m). */
  private spawnSchool(kind: PreyKind, count: number, juvenile = false, at?: Vec3, sizes?: { cm: [number, number]; spreadM: number }): void {
    const spec = this.p.prey[kind];
    const [minL, maxL] = spec.lengthCm as [number, number];
    const id = this.nextSchool++;
    const centre = at ?? this.randomWaterPos(0.5);
    const spread = sizes?.spreadM ?? 1.2;
    for (let i = 0; i < count; i++) {
      const L = sizes
        ? this.rng.range(sizes.cm[0], sizes.cm[1])
        : juvenile
          ? minL * this.rng.range(0.7, 1)
          : minL + (maxL - minL) * Math.pow(this.rng.next(), this.p.preyLife.stockSizeSkew);
      const pos = v3(centre.x + this.rng.gauss() * spread, centre.y + this.rng.gauss() * (sizes ? spread * 0.33 : 0.4), centre.z + this.rng.gauss() * spread);
      this.world.confine(pos);
      this.prey.push(spawnPrey(this.nextId++, kind, id, pos, L, this.p, this.rng));
    }
  }

  /** Advance by dt seconds (use a fixed step such as 1/60). */
  step(dt: number): void {
    this.time += dt;
    this.env = environmentAt(this.time, this.startDay, this.p.environment);

    for (const pk of this.pikes) {
      const wasAlive = pk.alive;
      const before = pk.burstTimeLeft;
      if (pk.alive && pk.ai) {
        const h = this.hunter;
        this.inputs.set(pk.id, h && h.id === pk.id ? hunterInput(this, pk, h, dt) : rivalInput(this, pk, dt));
      } else if (pk.alive && this.tyrant?.id === pk.id) this.inputs.set(pk.id, tyrantInput(this, pk, this.tyrant));
      let input = this.inputs.get(pk.id) ?? NO_INPUT;
      const starting = canStartBurst(pk, input, dt, this.paramsFor(pk));
      if (starting) {
        const ty = this.tyrant;
        // the tyrant only ever lunges at its target (and not while backing off)
        pk.lockId = ty?.id === pk.id ? (!ty.outcome && ty.phase === "charge" ? ty.targetId : null) : (lungeCandidate(this, pk)?.id ?? null);
        this.hadOutcome.delete(pk.id);
      }
      if (pk.lockId !== null && (pk.burstTimeLeft > 0 || starting)) {
        const t = this.findLive(pk.lockId);
        if (!t) pk.lockId = null;
        else if (this.arcade && this.isHuman(pk)) {
          // the player's lunge aims briefly, then runs straight: no chasing a dodging fish round in circles
          const elapsed = starting ? 0 : this.paramsFor(pk).pike.burstDurationS - pk.burstTimeLeft;
          input = elapsed < PLAYER_AIM_S ? homingInput(pk, t.pos, PLAYER_HOMING_MAX) : { throttle: 0, yawRate: 0, pitchRate: 0, burst: true };
        } else input = homingInput(pk, t.pos);
      }
      // out of the water (game leap): ballistic flight instead of swimming; burst timers still run down
      const flying = this.airborne.has(pk.id);
      if (flying) {
        pk.burstCooldown = Math.max(0, pk.burstCooldown - dt);
        pk.burstTimeLeft = Math.max(0, pk.burstTimeLeft - dt);
      } else {
        if (this.chill && this.isHuman(pk)) pk.health = Math.max(pk.health, 0.5); // hunger never kills in chill
        stepPike(pk, input, this.env.tempC, dt, this.paramsFor(pk), this.bioScale);
        if (this.world.shape === "river") this.drift(pk.pos, dt * this.nurseryDrift(pk));
      }
      if (this.arcade && this.isHuman(pk) && pk.alive && pk.health < 1 && condition(pk, this.p) >= 0.8)
        pk.health = Math.min(1, pk.health + ARCADE_HEAL_PER_S * dt);
      if (before > 0 && pk.burstTimeLeft <= 0) {
        if (!this.hadOutcome.has(pk.id)) this.events.push({ type: "strike-empty", pikeId: pk.id, t: this.time });
        this.hadOutcome.delete(pk.id);
        pk.lockId = null;
      }
      if (before <= 0 && pk.burstTimeLeft > 0) this.events.push({ type: "strike", pikeId: pk.id, lockId: pk.lockId, t: this.time });
      if (wasAlive && !pk.alive) {
        pk.deathCause = "starvation";
        this.events.push({ type: "death", pikeId: pk.id, cause: "starvation", t: this.time });
      }
      const leaping = this.arcade && pk.alive && this.isHuman(pk) && (this.extras.angler?.hookedId ?? -1) !== pk.id && leapStep(this, pk, dt, true);
      if (leaping) this.world.confineXZ(pk.pos);
      else this.world.confine(pk.pos, 0.1);
      if (this.arcade && pk.alive && !leaping) this.extras.afterPikeStep(this, pk, starting, dt, (p) => this.landed(p));
      if (pk.burstTimeLeft <= 0) this.clearAttempts(pk.id);
    }

    // schools: group living fish by schoolId once per tick
    const schools = new Map<number, PreyState[]>();
    for (const f of this.prey) {
      if (!f.alive) continue;
      let arr = schools.get(f.schoolId);
      if (!arr) schools.set(f.schoolId, (arr = []));
      arr.push(f);
    }
    const live = this.pikes.filter((k) => k.alive);
    const noticeMul = this.arcade ? this.p.arcade.preyNoticeMul : 1;
    const noticeOf = (pk: PikeState): number => (this.isHuman(pk) ? noticeMul : 1);
    for (const f of this.prey) {
      if (!f.alive) continue;
      const mates = schools.get(f.schoolId) ?? [];
      if (this.world.shape === "river" && f.alive) this.drift(f.pos, this.arcade && f.lengthCm < 6 ? dt * shelteredDrift(f.lengthCm) : dt);
      if (stepPrey(f, mates, live, this.env, this.world, dt, this.rng, this.p, noticeOf)) {
        const nearest = live.reduce((m, k) => Math.min(m, dist(k.pos, f.pos)), Infinity);
        this.events.push({ type: "bolt", preyId: f.id, pikeDistance: nearest, t: this.time });
        // Alarm spreads through the school: neighbours get a startle even without seeing the pike.
        for (const m of mates) if (m !== f && dist(m.pos, f.pos) < 4) m.alert = Math.min(1, m.alert + 0.55);
      }
    }

    if (this.arcade) {
      this.extras.step(this, dt);
      this.arcadeRestock(dt);
      this.nurseryStock(dt);
    }
    for (const pk of live) if (pk.alive && pk.burstTimeLeft > 0) this.resolveStrikes(pk);
    for (const pk of live) if (pk.burstTimeLeft <= 0) pk.lockId = null; // a capture ends the burst inside resolveStrikes
    if (this.hunter) this.stepHunter(dt);
    if (this.tyrant) this.stepTyrant(dt);
    stepSpawning(this, dt);
    this.prey = this.prey.filter((f) => f.alive);
    this.onNewDay();
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 1000);
  }

  private findLive(id: number): { pos: Vec3 } | undefined {
    return this.prey.find((f) => f.alive && f.id === id) ?? this.pikes.find((o) => o.alive && o.id === id) ?? (this.arcade ? this.extras.find(id) : undefined);
  }

  /** A human pike reached the fisherman's boat: released with damage if it can spare it, else caught. */
  private landed(pk: PikeState): void {
    if (this.chill || pk.health > ANGLER.releaseHearts + 0.01) {
      if (!this.chill) pk.health -= ANGLER.releaseHearts; // chill: a photo and back in, unharmed
      // dropped back over the side, a little dazed
      const a = this.extras.angler;
      const ang = a ? a.boatYaw + Math.PI / 2 : 0;
      pk.pos = v3(pk.pos.x + Math.cos(ang) * 2.5, -1, pk.pos.z + Math.sin(ang) * 2.5);
      this.world.confine(pk.pos, 0.2);
      pk.speed = 0;
      this.events.push({ type: "released", pikeId: pk.id, health: pk.health, t: this.time });
      return;
    }
    pk.alive = false;
    pk.deathCause = "caught";
    this.events.push({ type: "death", pikeId: pk.id, cause: "caught", t: this.time });
  }

  private clearAttempts(pikeId: number): void {
    const prefix = `${pikeId}:`;
    for (const k of this.attempted) if (k.startsWith(prefix)) this.attempted.delete(k);
  }

  /**
   * One capture roll per target per burst: gape, alignment and odds are shared by prey and pike.
   * Returns grams swallowed on success (the caller does victim bookkeeping), or null.
   */
  private rollStrike(
    pk: PikeState,
    f: Vec3,
    targetId: number,
    pos: Vec3,
    targetLengthCm: number,
    targetWeight: number,
    escape: number,
  ): number | null {
    const key = `${pk.id}:${pk.burstSerial}:${targetId}`;
    if (this.attempted.has(key)) return null;
    this.attempted.add(key);
    this.hadOutcome.add(pk.id);
    const miss = (reason: MissReason): null => {
      this.events.push({ type: "miss", pikeId: pk.id, preyId: targetId, reason, t: this.time });
      return null;
    };
    const pp = this.paramsFor(pk);
    const k = pp.strike;
    if (targetLengthCm > pp.pike.maxPreyLengthFracOfBL * pk.lengthCm) return miss("too-big");
    // a nursery pike (game, egg start) turns each catch straight into growth, so its tiny stomach never fills
    const nursery = this.arcade && this.isHuman(pk) && pk.lengthCm < NURSERY_END_CM;
    if (!nursery && tooFullFor(pk, targetWeight, pp)) return miss("full");
    const align = dot(f, norm(sub(pos, pk.pos)));
    if (align < k.alignMin) return miss("off-axis");
    // Capture odds: aligned, fast attack vs. how fast and how alert the target is.
    const closing = clamp(pk.speed / (pp.pike.burstBL * lengthM(pk)), k.closingMin, 1);
    // nursery strikes (game, egg start) land more often: baby fish are what a hatchling lives on
    const odds = clamp(k.oddsBase * ((align - k.alignOffset) / k.alignSpan) * closing * (1 - escape), nursery ? Math.max(k.oddsMin, 0.55) : k.oddsMin, k.oddsMax);
    if (this.rng.next() >= odds) return miss("evaded");
    const grams = nursery ? targetWeight : Math.min(targetWeight, stomachRoom(pk, this.p));
    pk.stomachG += grams;
    pk.speed *= k.momentumKept; // gulping and turning the prey costs momentum
    pk.burstTimeLeft = 0;
    return grams;
  }

  /** Arcade extras for a human strike: the lure hooks it; an insect in reach is eaten. True when handled. */
  private strikeExtras(pk: PikeState, mouth: Vec3, reach: number, f: Vec3): boolean {
    const lure = this.extras.lureLive();
    if (lure && dist(lure.pos, mouth) <= reach && dot(f, norm(sub(lure.pos, pk.pos))) >= this.paramsFor(pk).strike.alignMin) {
      this.hadOutcome.add(pk.id);
      this.extras.hook(this, pk);
      return true;
    }
    const key = `${pk.id}:${pk.burstSerial}:insect`;
    if (this.attempted.has(key)) return false;
    const bug = this.extras.eatInsectAt(mouth, reach * 1.2, pk.pos.y > -0.12);
    if (!bug) return this.strikeFrog(pk, mouth, reach);
    this.attempted.add(key);
    this.hadOutcome.add(pk.id);
    this.feedInsect(pk, bug);
    return true;
  }

  /** A frog on the surface in reach of a pike with a wide enough gape: swallowed whole. */
  private strikeFrog(pk: PikeState, mouth: Vec3, reach: number): boolean {
    const key = `${pk.id}:${pk.burstSerial}:frog`;
    if (this.attempted.has(key) || pk.lengthCm < FROG.minPikeCm) return false;
    const frog = this.extras.eatFrogAt(mouth, reach * 1.2);
    if (!frog) return false;
    this.attempted.add(key);
    this.hadOutcome.add(pk.id);
    pk.stomachG += Math.min(FROG.grams, Math.max(stomachRoom(pk, this.p), 0.1)); // a small stomach takes what it can; the catch still scores a full frog
    this.events.push({ type: "capture", pikeId: pk.id, preyId: frog.id, kind: "frog", grams: FROG.grams, lengthCm: FROG.lengthCm, t: this.time });
    if (this.isHuman(pk)) gameGrow(pk, FROG.lengthCm, this.settings.growthMul ?? 1, this.p);
    return true;
  }

  /** Game: a nursery pike (arcade human under NURSERY_END_CM) shelters from the current in the weeds; else 1. */
  private nurseryDrift(pk: PikeState): number {
    return this.arcade && this.isHuman(pk) && pk.lengthCm < NURSERY_END_CM ? shelteredDrift(pk.lengthCm) : 1;
  }

  /** River current carries a fish (it swims against it to hold station). */
  drift(pos: Vec3, dt: number): void {
    const c = this.world.currentAt(pos.x, pos.y, pos.z);
    pos.x += c.x * dt;
    pos.z += c.z * dt;
  }

  /** An insect goes down: grams into the stomach (always a little room for a bug) and a capture event. */
  feedInsect(pk: PikeState, bug: Insect): void {
    const grams = Math.min(bug.grams, Math.max(stomachRoom(pk, this.p), 0.1));
    pk.stomachG += grams;
    this.events.push({ type: "capture", pikeId: pk.id, preyId: bug.id, kind: "insect", grams, lengthCm: 2, t: this.time });
    if (this.arcade && this.isHuman(pk)) nurseryGrow(pk, 2, this.settings.growthMul ?? 1, this.p);
  }

  private resolveStrikes(pk: PikeState): void {
    if (this.tyrant?.id === pk.id) return this.tyrantStrike(pk); // it ignores prey and other pike
    const L = lengthM(pk);
    const pp = this.paramsFor(pk);
    const reach = pp.pike.strikeRangeBL * L;
    const f = forward(pk.yaw, pk.pitch);
    const k = pp.strike;
    // The mouth sits ahead of the body centre.
    const mouth = v3(pk.pos.x + f.x * L * 0.5, pk.pos.y + f.y * L * 0.5, pk.pos.z + f.z * L * 0.5);
    if (this.tyrant && this.tyrantHit(pk, mouth, reach, f)) return;
    if (this.arcade && this.isHuman(pk) && this.strikeExtras(pk, mouth, reach, f)) return;
    for (const prey of this.prey) {
      if (!prey.alive || dist(prey.pos, mouth) > reach) continue;
      const spec = this.p.prey[prey.kind];
      const escape =
        clamp(preySpeed(prey) / (spec.burstBL * (prey.lengthCm / 100)), 0, 1) * k.escapeSpeedWeight + prey.alert * k.escapeAlertWeight;
      const grams = this.rollStrike(pk, f, prey.id, prey.pos, prey.lengthCm, prey.weight, escape);
      if (grams === null) continue;
      prey.alive = false;
      this.events.push({ type: "capture", pikeId: pk.id, preyId: prey.id, kind: prey.kind, grams, lengthCm: prey.lengthCm, t: this.time });
      if (this.arcade && this.isHuman(pk)) gameGrow(pk, prey.lengthCm, this.settings.growthMul ?? 1, this.p);
      return;
    }

    for (const other of this.pikes) {
      if (!other.alive || other.id === pk.id || dist(other.pos, mouth) > reach) continue;
      if (this.tyrant?.id === other.id) continue; // nobody eats the tyrant
      // nobody eats you in chill; only the active hunter gets to scare you
      const scaring = this.chill && this.isHuman(other) && this.hunter?.id === pk.id && this.hunter.targetId === other.id;
      if (this.chill && this.isHuman(other) && !scaring) continue;
      const escape =
        clamp(other.speed / (this.p.pike.burstBL * lengthM(other)), 0, 1) * k.escapeSpeedWeight +
        (other.burstTimeLeft > 0 ? k.escapeAlertWeight : 0);
      const grams = this.rollStrike(pk, f, other.id, other.pos, other.lengthCm, other.weight, escape);
      if (grams === null) continue;
      if (scaring) {
        pk.stomachG -= grams; // nothing was swallowed
        pk.burstTimeLeft = 0;
        pk.burstCooldown = 4;
        pk.speed *= 0.2;
        this.scare(other, pk.id, "pike");
        this.hunter!.outcome = "scared-player";
        return;
      }
      if (this.arcade && this.isHuman(other) && other.health > ARCADE_BITE + 0.01) {
        this.bitePlayer(pk, other, grams);
        return;
      }
      other.alive = false;
      other.deathCause = "eaten";
      other.killedBy = pk.id;
      other.killedByLengthCm = pk.lengthCm;
      this.events.push({ type: "capture", pikeId: pk.id, preyId: other.id, kind: "pike", grams, lengthCm: other.lengthCm, t: this.time });
      if (this.arcade && this.isHuman(pk)) gameGrow(pk, other.lengthCm, this.settings.growthMul ?? 1, this.p);
      this.events.push({ type: "death", pikeId: other.id, cause: "eaten", byPikeId: pk.id, t: this.time });
      return;
    }
  }

  /**
   * Once-per-game-day hook (internal to src/sim; the coarse sim calls it directly).
   * Order: grow, mortality, recruit, then cohorts.
   */
  onNewDay(): void {
    const day = Math.floor(this.time / this.p.environment.dayLengthS);
    if (day === this.lastDay) return;
    this.lastDay = day;
    for (const f of this.prey) growPreyDay(f, this.env.tempC, this.p);
    if (preyMortalityDay(this.prey, this.rng, this.p) > 0) this.prey = this.prey.filter((f) => f.alive);
    this.recruit();
    cohortsDay(this);
    if (this.env.season === "winter" && this.player()?.alive) this.playerSawWinter = true;
    checkMilestones(this);
  }

  private restockIn = 0;
  /**
   * Game only: keep the lake well stocked (playtests found it emptied fast, rivals eat a lot). Every few
   * seconds, while live prey are under ARCADE_STOCK x carrying capacity, a school of the scarcest kind
   * arrives somewhere out of every human's sight.
   */
  private arcadeRestock(dt: number): void {
    this.restockIn -= dt;
    if (this.restockIn > 0) return;
    this.restockIn = 6;
    let best: PreyKind | null = null;
    let bestFill = ARCADE_STOCK;
    const roachCap = this.capacity.get("roach") ?? 0;
    const caps: [PreyKind, number][] = [...this.capacity];
    for (const kind of Object.keys(this.p.prey) as PreyKind[]) if (isArcadeOnly(this.p.prey[kind])) caps.push([kind, Math.max(1, Math.round(roachCap * (ARCADE_ONLY_STOCK[kind] ?? 0.2)))]);
    for (const [kind, cap] of caps) {
      const minL = (this.p.prey[kind].lengthCm as [number, number])[0] * 0.7; // nursery babies do not count
      const fill = this.prey.filter((f) => f.alive && f.kind === kind && f.lengthCm >= minL).length / cap;
      if (fill < bestFill) [best, bestFill] = [kind, fill];
    }
    if (!best) return;
    const humans = this.pikes.filter((k) => k.alive && this.isHuman(k));
    for (let i = 0; i < 12; i++) {
      const c = this.randomWaterPos(0.5);
      if (humans.every((h) => Math.hypot(h.pos.x - c.x, h.pos.z - c.z) > 14)) {
        const [minS, maxS] = this.p.prey[best].schooling.size as [number, number];
        this.spawnSchool(best, isArcadeOnly(this.p.prey[best]) ? this.rng.int(minS, maxS) : 8 + Math.floor(this.rng.next() * 6), false, c);
        return;
      }
    }
  }

  private nurseryIn = 0;
  /**
   * Game only: a human still in the nursery (under NURSERY_END_CM) gets schools of baby fish sized to their
   * gape, close by (a 1 cm larva swims a few cm a second); babies nobody small is near any more are removed.
   */
  private nurseryStock(dt: number): void {
    this.nurseryIn -= dt;
    if (this.nurseryIn > 0) return;
    this.nurseryIn = 2;
    const small = this.pikes.filter((k) => k.alive && this.isHuman(k) && k.lengthCm < NURSERY_END_CM);
    const kinds: PreyKind[] = ["roach", "rudd", "perch"];
    for (const f of this.prey) {
      if (!f.alive || f.lengthCm >= 6) continue;
      const near = small.some((h) => Math.hypot(h.pos.x - f.pos.x, h.pos.z - f.pos.z) < Math.max(3, h.lengthCm * 1.2) && f.lengthCm < h.lengthCm * 0.8);
      if (!near) f.alive = false;
    }
    for (const h of small) {
      const L = h.lengthCm;
      const lo = L * NURSERY_PREY_FRAC[0];
      const hi = L * NURSERY_PREY_FRAC[1];
      const range = Math.max(1.5, L * 0.5); // m
      const edible = this.prey.filter((f) => f.alive && f.lengthCm >= lo * 0.7 && f.lengthCm <= L * 0.62 && Math.hypot(h.pos.x - f.pos.x, h.pos.z - f.pos.z) < range).length;
      if (edible >= 14) continue;
      const d = clamp(L * 0.4, 0.35, 6); // m from the player
      for (let i = 0; i < 8; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const c = v3(h.pos.x + Math.cos(a) * d, h.pos.y + this.rng.range(-0.3, 0.3) * d, h.pos.z + Math.sin(a) * d);
        if (!this.world.inWater(c.x, c.z)) continue;
        this.world.confine(c, 0.1);
        const kind = kinds[Math.floor(this.rng.next() * kinds.length)]!;
        this.spawnSchool(kind, 10 + Math.floor(this.rng.next() * 8), false, c, { cm: [Math.max(0.4, lo), Math.max(0.6, hi)], spreadM: Math.max(0.06, L * 0.04) });
        break;
      }
    }
  }

  /** Logistic recruitment: young fish join the population toward carrying capacity. */
  private recruit(): void {
    if (this.env.tempC < 10) return; // spawning/recruitment only when warm enough
    for (const [kind, cap] of this.capacity) {
      const pop = this.prey.filter((f) => f.kind === kind).length;
      const born = Math.round(0.08 * pop * (1 - pop / cap));
      if (born > 0) {
        this.spawnSchool(kind, born, true);
        this.events.push({ type: "recruit", kind, count: born, t: this.time });
      }
    }
  }

  /** Absolute calendar day (start day plus elapsed game days). */
  dayIndex(): number {
    return this.startDay + Math.floor(this.time / this.p.environment.dayLengthS);
  }

  preyCount(kind?: PreyKind): number {
    return kind ? this.prey.filter((f) => f.kind === kind).length : this.prey.length;
  }
}

/** The shared params with params.arcade applied to the pike and strike blocks (multipliers, then fixed values). */
export function arcadeParams(p: Params, growthMul = 1): Params {
  const out = clone(p);
  const a = p.arcade;
  const apply = (dst: Record<string, unknown>, mul: Record<string, number>, set: Record<string, number>): void => {
    for (const [key, m] of Object.entries(mul)) {
      // "a.b" scales a nested number (e.g. digestionHalfLifeH.ref)
      const path = key.split(".");
      let o = dst;
      for (const part of path.slice(0, -1)) o = o[part] as Record<string, unknown>;
      const leaf = path[path.length - 1]!;
      if (typeof o[leaf] !== "number") throw new Error(`arcade: ${key} is not a number`);
      o[leaf] = (o[leaf] as number) * m;
    }
    Object.assign(dst, set);
  };
  apply(out.pike as unknown as Record<string, unknown>, a.pikeMul, a.pikeSet);
  apply(out.strike as unknown as Record<string, unknown>, a.strikeMul, a.strikeSet);
  apply(out.metabolism as unknown as Record<string, unknown>, a.metabolismMul, {});
  out.metabolism.growthEfficiency *= growthMul > 0 ? growthMul : 1; // the game's Growth option
  return out;
}

/**
 * Game start: move the player within sight of the nearest edible prey (7 m, on the lake-centre side,
 * facing it) so a new life opens with something to hunt. Uses no RNG, so the sim stream is untouched.
 */
export function placePlayerNearPrey(sim: Simulation, gapM = 7, pike: PikeState | null = sim.player()): void {
  const pl = pike;
  if (!pl) return;
  const maxLen = sim.paramsFor(pl).pike.maxPreyLengthFracOfBL * pl.lengthCm;
  let best: PreyState | null = null;
  let bd = Infinity;
  for (const f of sim.prey) {
    if (!f.alive || f.lengthCm > maxLen) continue;
    const d = dist(f.pos, pl.pos);
    if (d < bd) [bd, best] = [d, f];
  }
  if (!best || bd <= gapM) return;
  if (sim.world.shape === "river") {
    // upstream of the fish, facing down at it: the current carries you in
    pl.pos = v3(best.pos.x - gapM, best.pos.y, best.pos.z);
  } else {
    const r = Math.hypot(best.pos.x, best.pos.z) || 1;
    pl.pos = v3(best.pos.x - (best.pos.x / r) * gapM, best.pos.y, best.pos.z - (best.pos.z / r) * gapM);
  }
  sim.world.confine(pl.pos, 0.3);
  pl.yaw = Math.atan2(best.pos.z - pl.pos.z, best.pos.x - pl.pos.x);
  pl.pitch = 0;
}
