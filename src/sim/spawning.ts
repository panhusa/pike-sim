import { checkMilestones } from "./milestones";
import { tempFactor } from "./biology";
import { environmentAt } from "./environment";
import { dist } from "./math";
import type { Params } from "./params";
import type { PikeState } from "./pike";
import type { Simulation } from "./simulation";

export interface Cohort {
  id: number;
  parentIds: number[];
  lineage: boolean;
  bornDay: number;
  count: number;
  meanLengthCm: number;
}

export interface SpawnState {
  year: number;
  openDay: number | null;
  /** Seconds a female and a suitable male have shared spawning habitat, keyed by female id. */
  dwell: Record<number, number>;
}

export const isMature = (pk: PikeState, p: Params): boolean => pk.lengthCm >= p.pike.maturityLengthCm[pk.sex];

export function seasonOpen(sim: Simulation): boolean {
  const open = sim.spawn.openDay;
  return open !== null && sim.dayIndex() < open + sim.p.spawning.seasonDays;
}

function inSpawningHabitat(sim: Simulation, pk: PikeState): boolean {
  const k = sim.p.spawning;
  return sim.world.depthAt(pk.pos.x, pk.pos.z) <= k.maxDepthM && sim.world.coverAt(pk.pos) >= k.minCover;
}

function eligible(sim: Simulation, pk: PikeState): boolean {
  return pk.alive && pk.spawnedYear !== sim.spawn.year && isMature(pk, sim.p) && inSpawningHabitat(sim, pk);
}

/** Detailed sim: mature pairs that share shallow cover for dwellS spawn once per season. */
export function stepSpawning(sim: Simulation, dt: number): void {
  if (!seasonOpen(sim)) {
    sim.spawn.dwell = {};
    return;
  }
  const k = sim.p.spawning;
  const prev = sim.spawn.dwell;
  const next: Record<number, number> = {}; // only pairs that stayed together this step carry over
  const ready = sim.pikes.filter((pk) => eligible(sim, pk));
  for (const f of ready) {
    if (f.sex !== "female") continue;
    let mate: PikeState | null = null;
    let best = k.mateRangeM;
    for (const m of ready) {
      if (m.sex !== "male" || m.spawnedYear === sim.spawn.year) continue; // ready was computed before this step's spawns
      const d = dist(f.pos, m.pos);
      if (d <= best) {
        best = d;
        mate = m;
      }
    }
    if (!mate) continue;
    const t = (prev[f.id] ?? 0) + dt;
    if (t >= k.dwellS) spawnPair(sim, f, mate);
    else next[f.id] = t;
  }
  sim.spawn.dwell = next;
}

/** Shared with the coarse sim: eggs scale with the female's weight, both parents lose weight. */
export function spawnPair(sim: Simulation, female: PikeState, male: PikeState): Cohort {
  const k = sim.p.spawning;
  const count = Math.round((female.weight / 1000) * k.eggsPerKgFemale * sim.settings.recruitmentScale);
  female.weight *= 1 - k.weightLossFrac;
  male.weight *= 1 - k.weightLossFrac;
  female.spawnedYear = sim.spawn.year;
  male.spawnedYear = sim.spawn.year;
  const parentIds = [female.id, male.id];
  const cohort: Cohort = {
    id: sim.nextCohortId++,
    parentIds,
    lineage: sim.playerId !== null && parentIds.includes(sim.playerId),
    bornDay: sim.dayIndex(),
    count,
    meanLengthCm: k.fryStartLengthCm,
  };
  sim.cohorts.push(cohort);
  sim.events.push({ type: "spawn", pikeIds: [female.id, male.id], cohortId: cohort.id, t: sim.time });
  checkMilestones(sim);
  return cohort;
}

/** Daily hook: season bookkeeping, then cohort mortality, growth and recruitment into rival pike. */
export function cohortsDay(sim: Simulation): void {
  const p = sim.p;
  const k = p.spawning;
  const day = sim.dayIndex();
  const year = Math.floor(day / p.environment.yearLengthDays);
  if (year !== sim.spawn.year) sim.spawn = { year, openDay: null, dwell: {} };
  // The season opens on the spring crossing itself: warm today, still below the threshold yesterday.
  const yesterday = environmentAt(sim.time - p.environment.dayLengthS, sim.startDay, p.environment).tempC;
  if (
    sim.spawn.openDay === null &&
    day % p.environment.yearLengthDays > p.environment.coldestDay &&
    sim.env.tempC >= k.startTempC &&
    yesterday < k.startTempC
  ) {
    sim.spawn.openDay = day;
  }

  const growth = k.fryGrowthCmPerDay * tempFactor(sim.env.tempC, p.metabolism);
  const survive = Math.exp(-k.fryMortalityPerDay);
  const keep: Cohort[] = [];
  for (const c of sim.cohorts) {
    c.count *= survive;
    c.meanLengthCm += growth;
    if (c.meanLengthCm >= k.recruitLengthCm) {
      const n = Math.min(Math.floor(c.count), k.recruitMax);
      const ids: number[] = [];
      for (let i = 0; i < n; i++) {
        const sex = sim.rng.next() < p.pike.maleFraction ? "male" : "female";
        const pk = sim.addRival(c.meanLengthCm, sex);
        pk.parentIds = [...c.parentIds];
        pk.lineage = c.lineage;
        ids.push(pk.id);
      }
      if (ids.length > 0) sim.events.push({ type: "recruit-pike", cohortId: c.id, pikeIds: ids, t: sim.time });
    } else if (c.count >= 1) {
      keep.push(c);
    }
  }
  sim.cohorts = keep;
}
