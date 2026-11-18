import type { SimEvent } from "../sim/simulation";

type Outcome = Extract<SimEvent, { type: "capture" | "miss" | "strike-empty" }>;

/**
 * Collects the outcome events of one burst (a burst can roll several fish in reach) and reports a
 * single one: a capture, else the miss on the locked target, else the first miss, else strike-empty.
 * Feed it only the player's events.
 */
export class BurstOutcomes {
  private lockId: number | null = null;
  private pending: Outcome[] = [];

  /** Returns the previous burst's outcome when a new strike starts before it was reported. */
  push(e: SimEvent): Outcome | null {
    if (e.type === "strike") {
      const prev = this.take();
      this.lockId = e.lockId;
      return prev;
    }
    if (e.type === "capture" || e.type === "miss" || e.type === "strike-empty") this.pending.push(e);
    return null;
  }

  /** Call once the frame's events are in: reports the burst's outcome once it is over. */
  end(burstActive: boolean): Outcome | null {
    return burstActive ? null : this.take();
  }

  private take(): Outcome | null {
    const p = this.pending;
    this.pending = [];
    const misses = p.filter((e) => e.type === "miss");
    return (
      p.find((e) => e.type === "capture") ??
      misses.find((e) => e.preyId === this.lockId) ??
      misses[0] ??
      p.find((e) => e.type === "strike-empty") ??
      null
    );
  }
}
