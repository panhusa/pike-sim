import { coarseAdvance } from "./coarse";
import type { MilestoneId } from "./milestones";
import type { DeathCause, PikeState } from "./pike";
import type { Simulation } from "./simulation";

export interface LifeSummary {
  cause: DeathCause;
  byLengthCm: number | null;
  ageDays: number;
  lengthCm: number;
  milestones: MilestoneId[];
}

/** The dead player's life in numbers; null while the player is alive (or absent). */
export function lifeSummary(sim: Simulation): LifeSummary | null {
  const pl = sim.player();
  if (!pl || pl.alive) return null;
  return {
    cause: pl.deathCause ?? "starvation",
    byLengthCm: pl.deathCause === "eaten" ? (pl.killedByLengthCm ?? null) : null,
    ageDays: pl.ageDays,
    lengthCm: pl.lengthCm,
    milestones: [...sim.milestones],
  };
}

function livingLineage(sim: Simulation): PikeState[] {
  return sim.pikes.filter((k) => k.alive && k.lineage && k.id !== sim.playerId);
}

export function offspringOptions(sim: Simulation): { living: number; cohorts: number } {
  return { living: livingLineage(sim).length, cohorts: sim.cohorts.filter((c) => c.lineage && c.count >= 1).length };
}

function largest(pikes: PikeState[]): PikeState | null {
  let best: PikeState | null = null;
  for (const k of pikes) if (!best || k.lengthCm > best.lengthCm) best = k;
  return best;
}

/**
 * Continue as the largest living lineage pike. With none alive, fast-forward the lake until a lineage
 * cohort recruits (or all are gone), capped at `lineageMaxFastForwardDays`.
 */
export function continueAsOffspring(
  sim: Simulation,
): { ok: true; fastForwardDays: number } | { ok: false; reason: "none" | "timeout" } {
  let fastForwardDays = 0;
  if (livingLineage(sim).length === 0) {
    if (!sim.cohorts.some((c) => c.lineage && c.count >= 1)) return { ok: false, reason: "none" };
    const t0 = sim.time;
    const cap = sim.p.spawning.lineageMaxFastForwardDays;
    coarseAdvance(
      sim,
      cap * 86400,
      { player: "absent", onThreat: "count" },
      (s) => livingLineage(s).length > 0 || !s.cohorts.some((c) => c.lineage),
    );
    fastForwardDays = (sim.time - t0) / sim.p.environment.dayLengthS;
  }
  const heir = largest(livingLineage(sim));
  if (!heir) return { ok: false, reason: sim.cohorts.some((c) => c.lineage) ? "timeout" : "none" };
  sim.playerId = heir.id;
  delete heir.ai;
  sim.milestones = [];
  sim.playerSawWinter = false;
  sim.playerHintsDone = false;
  return { ok: true, fastForwardDays };
}
