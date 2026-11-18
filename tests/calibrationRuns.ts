import { coarseAdvance } from "../src/sim/coarse";
import { lungeCandidate, lungeRange } from "../src/sim/lunge";
import { dist, type Vec3 } from "../src/sim/math";
import { defaultParams, type Params } from "../src/sim/params";
import type { PikeState } from "../src/sim/pike";
import { nearestCover } from "../src/sim/prey";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { ambusherInput } from "./ambushMeasures";
import { weedPoint } from "./helpers";

export const CAL_DAYS = 2;
const DT = 1 / 20;

/** Unscaled counts over `elapsedDays`; compare runs by pooled rates (sum of counts / sum of days). */
export interface CalMeasure {
  /** Rival grams eaten, not counting the player itself (the coarse sim never eats the player). */
  rivalGrams: number;
  playerGrams: number;
  /** Prey the player swallowed (a too-full pike refuses prey, so a capture is a real meal). */
  playerCaptures: number;
  encounters: number;
  /** Game days the player was alive and measured (a detailed run ends when the player is eaten). */
  elapsedDays: number;
  playerEaten: boolean;
}

/** A natural lake with 6 rivals plus a still 40 cm player (at the busiest weed bed by default). */
export interface CalOptions {
  params?: Params;
  /** Where the player sits; defaults to the busiest weed bed. */
  spot?: (sim: Simulation) => Vec3;
  days?: number;
}

export function calSim(seed: number, opts: CalOptions = {}): { sim: Simulation; player: PikeState } {
  const params = opts.params ?? defaultParams;
  const settings = { ...presetSettings("natural", "permadeath", params), rivalCount: 6 };
  const sim = new Simulation({ seed, params, settings });
  const player = sim.addPlayer(40);
  player.pos = (opts.spot ?? ambushSpot)(sim);
  player.speed = 0;
  player.stillTime = 10;
  return { sim, player };
}

/**
 * The weed bed most prey forage toward (their nearest cover) at the start: a still ambusher
 * only gets chances where schools gather, and the coarse sim rests the player in the same spot.
 */
export function ambushSpot(sim: Simulation): Vec3 {
  const w = sim.world;
  const votes = new Map<string, { pos: Vec3; n: number }>();
  for (const f of sim.prey) {
    const c = nearestCover(f.pos, w);
    if (!c || w.coverAt(c) < 0.5 || !w.weeds.some((k) => k.x === c.x && k.z === c.z)) continue;
    const key = `${c.x},${c.z}`;
    const v = votes.get(key) ?? { pos: c, n: 0 };
    v.n++;
    votes.set(key, v);
  }
  let best: { pos: Vec3; n: number } | null = null;
  for (const v of votes.values()) if (!best || v.n > best.n) best = v;
  return best ? { ...best.pos } : weedPoint(sim);
}

/** A good-cover weed bed that no fish treats as its nearest cover at the start. */
export function deadSpot(sim: Simulation): Vec3 {
  const w = sim.world;
  const used = sim.prey.map((f) => nearestCover(f.pos, w)).filter((c): c is Vec3 => c !== null);
  for (const k of w.weeds) {
    const pos = { x: k.x, y: w.bottomY(k.x, k.z) + k.height * 0.5, z: k.z };
    if (w.coverAt(pos) < 0.5 || !w.inWater(k.x, k.z)) continue;
    if (!used.some((c) => c.x === k.x && c.z === k.z)) return pos;
  }
  throw new Error("no unvisited weed bed");
}

/** Seconds within which repeat sightings by the same rival count as one encounter. */
const ENCOUNTER_GAP_S = 10;

/** The rival would lunge at (or is already locked on) the player right now. */
function rivalTargetsPlayer(sim: Simulation, rival: PikeState, player: PikeState): boolean {
  if (rival.lockId === player.id) return true;
  // lungeCandidate scans every sensed fish; skip rivals that cannot reach the player anyway.
  if (dist(rival.pos, player.pos) > lungeRange(rival, sim.p) + rival.lengthCm / 100) return false;
  return lungeCandidate(sim, rival)?.id === player.id;
}

/**
 * Detailed sim for CAL_DAYS game days with the player as a competent still ambusher. An encounter is
 * a gape-capable rival whose lunge candidate (or lock) is the still player, counted once per rival
 * per ENCOUNTER_GAP_S.
 */
export function detailedRun(seed: number, opts: CalOptions = {}): CalMeasure {
  const params = opts.params ?? defaultParams;
  const days = opts.days ?? CAL_DAYS;
  const { sim, player } = calSim(seed, opts);
  const rivalIds = new Set(sim.pikes.filter((k) => k.ai).map((k) => k.id));
  const lastEncounter = new Map<number, number>();
  let rivalGrams = 0;
  let playerGrams = 0;
  let playerCaptures = 0;
  let encounters = 0;
  const steps = Math.round((days * params.environment.dayLengthS) / DT);
  let done = 0;
  for (; done < steps && player.alive; done++) {
    sim.setInput(player.id, ambusherInput(sim, player));
    sim.step(DT);
    for (const e of sim.events) {
      if (e.type !== "capture") continue;
      if (e.pikeId === player.id) {
        playerGrams += e.grams;
        playerCaptures++;
      }
      else if (rivalIds.has(e.pikeId) && e.preyId !== player.id) rivalGrams += e.grams; // coarse never eats the player
    }
    sim.events.length = 0;
    for (const r of sim.pikes) {
      if (!r.ai || !r.alive || r.lengthCm * params.pike.maxPreyLengthFracOfBL < player.lengthCm) continue;
      if (player.stillTime <= 2 || !rivalTargetsPlayer(sim, r, player)) continue;
      const last = lastEncounter.get(r.id);
      if (last !== undefined && sim.time - last < ENCOUNTER_GAP_S) continue;
      lastEncounter.set(r.id, sim.time);
      encounters++;
    }
  }
  return {
    rivalGrams,
    playerGrams,
    playerCaptures,
    encounters,
    elapsedDays: (done * DT) / params.environment.dayLengthS,
    playerEaten: !player.alive,
  };
}

/** Same seed and setup, skipped through with the coarse sim (resting player, threats counted). */
export function coarseRun(seed: number, opts: CalOptions = {}): CalMeasure {
  const days = opts.days ?? CAL_DAYS;
  const { sim, player } = calSim(seed, opts);
  const report = coarseAdvance(sim, days * 86400, { player: "resting", onThreat: "count" });
  let rivalGrams = 0;
  for (const [id, g] of Object.entries(report.intake)) if (Number(id) !== player.id) rivalGrams += g;
  return {
    rivalGrams,
    playerGrams: report.intake[player.id] ?? 0,
    playerCaptures: report.captures[player.id] ?? 0,
    encounters: report.threatCount,
    elapsedDays: days,
    playerEaten: false,
  };
}
