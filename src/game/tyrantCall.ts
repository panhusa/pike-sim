import { stageOf } from "./score";
import type { Simulation } from "../sim/simulation";

/** Growth stage whose trial is the tyrant fight (Lake tyrant, 75 cm). */
export const TYRANT_STAGE = 8;

/** Sim seconds before a tyrant that swam away ("left", e.g. timed out) comes back for the same pike. */
export const TYRANT_RETURN_S = 60;

/**
 * Host side (authoritative session): watches every living human pike, the host's and the guests', and
 * calls the Old Tyrant for each one that grows into TYRANT_STAGE. One tyrant at a time: later requests
 * wait in a queue until the lake is free. A pike first seen already at the stage (a resumed game) does not count.
 * A tyrant that swam away unbeaten comes back for its target after TYRANT_RETURN_S, so the trial can still be won.
 */
export class TyrantCaller {
  private stages = new Map<number, number>();
  private queue: number[] = [];
  /** tyrants seen leaving unbeaten (by tyrant id), and when each target gets another one (sim time) */
  private seenLeft = new Set<number>();
  private returns = new Map<number, number>();

  /** Call once per frame; returns the id of a tyrant started now, else null. */
  tick(sim: Simulation): number | null {
    for (const k of sim.pikes) {
      if (!k.alive || !sim.isHuman(k)) continue;
      const idx = stageOf(k.lengthCm).index;
      const prev = this.stages.get(k.id);
      this.stages.set(k.id, idx);
      // the session runs only the newest stage's trial: a jump past stage 8 skips the tyrant too
      if (prev !== undefined && prev < TYRANT_STAGE && idx === TYRANT_STAGE && !this.queue.includes(k.id)) this.queue.push(k.id);
    }
    const ty = sim.tyrant;
    if (ty?.outcome === "left" && !this.seenLeft.has(ty.id)) {
      this.seenLeft.add(ty.id);
      this.returns.set(ty.targetId, sim.time + TYRANT_RETURN_S);
    }
    for (const [id, at] of this.returns) {
      if (sim.time < at) continue;
      this.returns.delete(id);
      const k = sim.pikes.find((p) => p.id === id);
      if (k?.alive && stageOf(k.lengthCm).index >= TYRANT_STAGE && !this.queue.includes(id)) this.queue.push(id);
    }
    // one threat at a time: wait out a hunt too
    if (sim.tyrant || sim.hunter) return null;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const started = sim.startTyrant(id); // null when that pike is gone or dead
      if (started !== null) return started;
    }
    return null;
  }

  /** Queued target ids (for tests). */
  get waiting(): readonly number[] {
    return this.queue;
  }
}
