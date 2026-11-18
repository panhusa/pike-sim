import { environmentAt } from "./environment";
import type { Rng, Vec3 } from "./math";
import { hunger, stepMetabolism, stomachRoom, tooFullFor, type PikeState } from "./pike";
import { nearestCover, type PreyState } from "./prey";
import { coverPoints, pickHome } from "./rival";
import { pikeCamouflage } from "./sensing";
import type { Simulation } from "./simulation";
import { isMature, seasonOpen, spawnPair } from "./spawning";

/**
 * Coarse "skip time" simulation: while the player rests (or is absent), the lake advances in
 * ticks of `coarse.tickBioS` biological seconds using encounter rates instead of locomotion.
 * Rates are calibrated against the detailed sim (tests/calibration.test.ts) so resting is
 * neither safer nor more filling than playing through the same time.
 */
export interface CoarseOptions {
  player: "resting" | "absent";
  onThreat: "stop" | "count";
}

export interface CoarseReport {
  ticks: number;
  threatRivalId: number | null;
  threatCount: number;
  /** Grams eaten, by pike id. */
  intake: Record<number, number>;
  /** Prey and pike swallowed, by pike id (including captures that found the stomach full). */
  captures: Record<number, number>;
  /** The resting player starved; the advance stopped on that tick. */
  playerDied: boolean;
}

/** Poisson sample: Knuth's method for small means, a rounded normal for large ones. */
export function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.gauss()));
  const limit = Math.exp(-lambda);
  let k = 0;
  let prod = rng.next();
  while (prod > limit) {
    k++;
    prod *= rng.next();
  }
  return k;
}

const flatDist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Where a pike spends the skipped time: a rival at its home, the player where it rests. */
const anchor = (pk: PikeState): Vec3 => pk.ai?.home ?? pk.pos;

const canEat = (sim: Simulation, eater: PikeState, lengthCm: number): boolean =>
  lengthCm <= sim.p.pike.maxPreyLengthFracOfBL * eater.lengthCm;

/** Live prey the pike can swallow within `radius` (horizontal) of `pos`, per m². */
function densityOfEligiblePrey(sim: Simulation, pk: PikeState, pos: Vec3, radius: number): number {
  let n = 0;
  for (const f of sim.prey) if (f.alive && canEat(sim, pk, f.lengthCm) && flatDist(f.pos, pos) <= radius) n++;
  return n / (Math.PI * radius * radius);
}

/** Prey are calm while the lake is unobserved. */
const MEAN_PREY_ALERT = 0;
const captureOdds = (sim: Simulation): number => sim.p.strike.oddsBase * (1 - MEAN_PREY_ALERT);

/** Expected prey captures per bio-second for a rival searching around its home. */
export function feedRate(sim: Simulation, pk: PikeState): number {
  const c = sim.p.coarse;
  const density = densityOfEligiblePrey(sim, pk, anchor(pk), c.densityRadiusM);
  return c.feedK * density * hunger(pk, sim.p, sim.env.tempC) * captureOdds(sim);
}

/** Schools graze up to this many patch radii from a patch centre (see coverEdgePoint). */
const PATCH_MARGIN = 1.1;

interface Patch {
  x: number;
  z: number;
  radius: number;
}

/** Is `pos` on the grazing margin of `patch` and not nearer another patch's centre whose margin also holds it? */
function onPatch(sim: Simulation, pos: Vec3, patch: Patch): boolean {
  const d = Math.hypot(pos.x - patch.x, pos.z - patch.z);
  if (d > patch.radius * PATCH_MARGIN) return false;
  for (const ks of [sim.world.reeds, sim.world.weeds]) {
    for (const k of ks) {
      if (k === patch) continue;
      const dk = Math.hypot(pos.x - k.x, pos.z - k.z);
      if (dk < d && dk <= k.radius * PATCH_MARGIN) return false;
    }
  }
  return true;
}

/** The reed or weed patch whose grazing margin holds `pos` (nearest centre wins). */
function patchAt(sim: Simulation, pos: Vec3): Patch | null {
  let best: Patch | null = null;
  let bestD = Infinity;
  for (const ks of [sim.world.reeds, sim.world.weeds]) {
    for (const k of ks) {
      const d = Math.hypot(pos.x - k.x, pos.z - k.z);
      if (d <= k.radius * PATCH_MARGIN && d < bestD) {
        bestD = d;
        best = k;
      }
    }
  }
  return best;
}

/**
 * Does this fish use the player's patch? Calm schools graze points on one patch's margin and cross
 * it between them, so only fish whose forage (or flight) target is on that patch ever pass a still
 * ambusher. A player outside every patch gets no visitors.
 */
function usesPatch(sim: Simulation, f: PreyState, patch: Patch): boolean {
  const target = f.forageTarget ?? nearestCover(f.pos, sim.world);
  if (target && onPatch(sim, target, patch)) return true;
  return f.coverTarget !== null && onPatch(sim, f.coverTarget, patch);
}

/** Prey the resting player can ambush from where it sits. */
function ambushPreyFilter(sim: Simulation, player: PikeState): (f: PreyState) => boolean {
  const patch = patchAt(sim, player.pos);
  return (f) => patch !== null && f.alive && canEat(sim, player, f.lengthCm) && usesPatch(sim, f, patch);
}

/** Expected prey captures per bio-second for the resting player, ambushing from cover. */
export function ambushRate(sim: Simulation, player: PikeState): number {
  const visits = ambushPreyFilter(sim, player);
  let visitors = 0;
  for (const f of sim.prey) if (visits(f)) visitors++;
  const concealed = pikeCamouflage(player, sim.world, sim.p); // cover and stillness make the ambush work
  return sim.p.coarse.ambushK * visitors * hunger(player, sim.p, sim.env.tempC) * captureOdds(sim) * concealed;
}

/** Expected finds of the resting player per bio-second by a rival big enough to eat it (else 0). */
export function findRate(sim: Simulation, rival: PikeState, player: PikeState): number {
  if (!rival.alive || !canEat(sim, rival, player.lengthCm)) return 0;
  const c = sim.p.coarse;
  const near = Math.exp(-flatDist(anchor(rival), player.pos) / sim.p.rival.territoryRadiusM);
  return c.findK * hunger(rival, sim.p, sim.env.tempC) * (1 - pikeCamouflage(player, sim.world, sim.p)) * near;
}

/**
 * Mirrors the detailed rival's patrol: a hungry rival with nothing to eat near home moves to a new
 * cover home after about `patrolAfterS` real seconds.
 */
function relocate(sim: Simulation, pk: PikeState, dt: number): void {
  const k = sim.p.rival;
  if (hunger(pk, sim.p, sim.env.tempC) <= k.huntAppetite / sim.settings.aggression) return;
  if (densityOfEligiblePrey(sim, pk, anchor(pk), sim.p.coarse.densityRadiusM) > 0) return;
  if (sim.rng.next() < dt / sim.bioScale / k.patrolAfterS) pk.ai!.home = pickHome(sim, pk);
}

/** Swallow a victim of `weight` g under the stomach-room rule; returns grams actually taken. */
function swallow(sim: Simulation, pk: PikeState, weight: number): number {
  const grams = Math.min(weight, stomachRoom(pk, sim.p));
  pk.stomachG += grams;
  return grams;
}

function nearestEligiblePrey(
  sim: Simulation,
  pk: PikeState,
  pos: Vec3,
  eligible: (f: PreyState) => boolean,
): PreyState | null {
  let best: PreyState | null = null;
  let bestD = Infinity;
  for (const f of sim.prey) {
    if (!eligible(f)) continue;
    const d = flatDist(f.pos, pos);
    if (d <= bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

function recordMeal(report: CoarseReport, pikeId: number, grams: number): void {
  report.intake[pikeId] = (report.intake[pikeId] ?? 0) + grams;
  report.captures[pikeId] = (report.captures[pikeId] ?? 0) + 1;
}

function feed(
  sim: Simulation,
  pk: PikeState,
  rate: number,
  eligible: (f: PreyState) => boolean,
  dt: number,
  report: CoarseReport,
): void {
  const n = poisson(sim.rng, rate * dt);
  for (let i = 0; i < n; i++) {
    const f = nearestEligiblePrey(sim, pk, anchor(pk), eligible);
    if (!f || tooFullFor(pk, f.weight, sim.p)) return; // same body rule as a detailed strike: a sated pike leaves it
    const grams = swallow(sim, pk, f.weight);
    f.alive = false;
    recordMeal(report, pk.id, grams);
    sim.events.push({ type: "capture", pikeId: pk.id, preyId: f.id, kind: f.kind, grams, lengthCm: f.lengthCm, t: sim.time });
    if (grams < f.weight) return; // stomach full: a sated pike stops taking prey this tick
  }
}

/** Big rivals encounter and eat smaller rivals living within the density radius of their home. */
function cannibalism(sim: Simulation, rivals: PikeState[], dt: number, report: CoarseReport): void {
  const c = sim.p.coarse;
  for (const big of rivals) {
    if (!big.alive) continue;
    const rate = c.cannibalK * sim.settings.aggression * hunger(big, sim.p, sim.env.tempC);
    if (rate <= 0) continue;
    for (const small of rivals) {
      if (small === big || !small.alive || !canEat(sim, big, small.lengthCm)) continue;
      if (flatDist(anchor(small), anchor(big)) > c.densityRadiusM) continue;
      if (poisson(sim.rng, rate * dt) === 0) continue;
      if (tooFullFor(big, small.weight, sim.p)) break;
      const grams = swallow(sim, big, small.weight);
      small.alive = false;
      small.deathCause = "eaten";
      small.killedBy = big.id;
      small.killedByLengthCm = big.lengthCm;
      recordMeal(report, big.id, grams);
      sim.events.push({ type: "capture", pikeId: big.id, preyId: small.id, kind: "pike", grams, lengthCm: small.lengthCm, t: sim.time });
      sim.events.push({ type: "death", pikeId: small.id, cause: "eaten", byPikeId: big.id, t: sim.time });
      break; // one pike meal per tick
    }
  }
}

/** In season, mature unspawned rival pairs with nearby homes spawn at a daily probability. */
function spawning(sim: Simulation, rivals: PikeState[], dt: number): void {
  if (!seasonOpen(sim)) return;
  const prob = sim.p.coarse.rivalSpawnProbPerDay * (dt / 86400);
  const ready = (pk: PikeState): boolean => pk.alive && pk.spawnedYear !== sim.spawn.year && isMature(pk, sim.p);
  for (const f of rivals) {
    if (f.sex !== "female" || !ready(f)) continue;
    for (const m of rivals) {
      if (m.sex !== "male" || !ready(m)) continue;
      if (flatDist(anchor(f), anchor(m)) > sim.p.spawning.mateRangeM) continue;
      if (sim.rng.next() < prob) {
        spawnPair(sim, f, m);
        break;
      }
    }
  }
}

/** Shift each school's centre up to `schoolDriftM` toward a random cover point; members move together. */
export function scatterSchools(sim: Simulation): void {
  const points = coverPoints(sim);
  if (points.length === 0) return;
  const schools = new Map<number, PreyState[]>();
  for (const f of sim.prey) {
    if (!f.alive) continue;
    let arr = schools.get(f.schoolId);
    if (!arr) schools.set(f.schoolId, (arr = []));
    arr.push(f);
  }
  for (const members of schools.values()) {
    let cx = 0;
    let cz = 0;
    for (const f of members) {
      cx += f.pos.x;
      cz += f.pos.z;
    }
    cx /= members.length;
    cz /= members.length;
    const to = points[sim.rng.int(0, points.length - 1)]!;
    const d = Math.hypot(to.x - cx, to.z - cz);
    const step = d > 1e-6 ? Math.min(d, sim.p.coarse.schoolDriftM) / d : 0;
    const dx = (to.x - cx) * step;
    const dz = (to.z - cz) * step;
    for (const f of members) {
      f.pos = { x: f.pos.x + dx, y: f.pos.y, z: f.pos.z + dz };
      sim.world.confine(f.pos, 0.1);
      f.alert = 0;
      f.fleeTime = 0;
      f.burstLeft = 0;
      f.forageTarget = null; // moved schools pick their new nearest cover
      f.coverTarget = null;
    }
  }
}

/** Rivals wake up at home, still, with no stale target or flight. */
function settleRivals(sim: Simulation): void {
  for (const pk of sim.pikes) {
    if (!pk.alive || !pk.ai) continue;
    const h = pk.ai.home;
    pk.pos = { x: h.x + sim.rng.range(-1, 1), y: h.y, z: h.z + sim.rng.range(-1, 1) };
    sim.world.confine(pk.pos, 0.1);
    pk.speed = 0;
    pk.ai.mode = "hold";
    pk.ai.targetId = null;
    pk.ai.lostS = 0;
    pk.ai.fleeS = 0;
    pk.ai.fleeFrom = null;
    pk.ai.patrolTo = null;
  }
}

/**
 * Advance the lake by `bioSeconds` of calendar time. A resting player feeds by ambush and can be
 * found by rivals big enough to eat it, but never dies by predation here: a find either stops the
 * advance (`onThreat: "stop"`, `threatRivalId` set) or is counted. If the resting player starves, the
 * advance stops on that tick with `playerDied` set. An absent player is not simulated.
 * `stop` is checked after every tick.
 */
export function coarseAdvance(
  sim: Simulation,
  bioSeconds: number,
  opts: CoarseOptions,
  stop?: (sim: Simulation) => boolean,
): CoarseReport {
  const p = sim.p;
  const report: CoarseReport = {
    ticks: 0,
    threatRivalId: null,
    threatCount: 0,
    intake: {},
    captures: {},
    playerDied: false,
  };
  const player = sim.player();
  const resting = opts.player === "resting" && player !== null && player.alive ? player : null;
  for (const pk of sim.pikes) if (pk.alive) pk.speed = 0;

  let left = bioSeconds;
  while (left > 1e-9) {
    const dt = Math.min(p.coarse.tickBioS, left);
    left -= dt;
    report.ticks++;
    sim.time += dt / sim.bioScale;
    sim.env = environmentAt(sim.time, sim.startDay, p.environment);
    sim.onNewDay(); // guarded by the day index: runs on every rollover, never skips one
    const T = sim.env.tempC;

    for (const pk of sim.pikes) {
      if (!pk.alive || (pk === player && !resting)) continue;
      stepMetabolism(pk, T, 0, dt, false, p);
      pk.ageDays += dt / 86400;
      if (pk === resting) pk.stillTime += dt / sim.bioScale;
      if (!pk.alive) {
        pk.deathCause = "starvation";
        sim.events.push({ type: "death", pikeId: pk.id, cause: "starvation", t: sim.time });
      }
    }
    if (resting && !resting.alive) {
      report.playerDied = true; // safety net: the caller's hunger stop should end rest before this
      break;
    }

    const rivals = sim.pikes.filter((k) => k.alive && k.ai);
    for (const pk of rivals) {
      if (!pk.alive) continue;
      relocate(sim, pk, dt);
      const home = anchor(pk);
      const near = (f: PreyState): boolean =>
        f.alive && canEat(sim, pk, f.lengthCm) && flatDist(f.pos, home) <= p.coarse.densityRadiusM;
      feed(sim, pk, feedRate(sim, pk), near, dt, report);
    }
    if (resting?.alive) {
      const player = resting;
      feed(sim, player, ambushRate(sim, player), ambushPreyFilter(sim, player), dt, report);
    }
    cannibalism(sim, rivals, dt, report);
    spawning(sim, rivals, dt);
    sim.prey = sim.prey.filter((f) => f.alive);

    if (resting?.alive) {
      for (const rival of rivals) {
        const finds = poisson(sim.rng, findRate(sim, rival, resting) * dt);
        if (finds === 0) continue;
        if (opts.onThreat === "stop") {
          report.threatRivalId = rival.id;
          break;
        }
        report.threatCount += finds;
      }
    }
    if (sim.events.length > 2000) sim.events.splice(0, sim.events.length - 1000);
    if (report.threatRivalId !== null || stop?.(sim)) break;
  }

  settleRivals(sim);
  scatterSchools(sim);
  return report;
}
