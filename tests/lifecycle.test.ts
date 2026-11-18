import { describe, expect, it } from "vitest";
import { continueAsOffspring, lifeSummary, offspringOptions } from "../src/sim/lifecycle";
import { defaultParams } from "../src/sim/params";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";

const settings = { ...presetSettings("natural", "lineage", defaultParams), rivalCount: 0 };

function deadPlayerSim(params = defaultParams): Simulation {
  const sim = new Simulation({ seed: 1, settings, params });
  sim.prey.length = 0;
  const pl = sim.addPlayer(50);
  pl.alive = false;
  pl.deathCause = "starvation";
  sim.milestones = ["length-50"];
  sim.playerSawWinter = true;
  sim.playerHintsDone = true;
  return sim;
}

const cohort = (sim: Simulation, over: Partial<Simulation["cohorts"][number]> = {}) =>
  sim.cohorts.push({ id: sim.nextCohortId++, parentIds: [sim.playerId ?? 0], lineage: true, bornDay: 0, count: 50, meanLengthCm: 10, ...over });

describe("lifecycle", () => {
  it("continues as the largest living lineage pike", () => {
    const sim = deadPlayerSim();
    const small = sim.addRival(30, "female");
    const big = sim.addRival(45, "male");
    sim.addRival(80, "female"); // not lineage
    small.lineage = true;
    big.lineage = true;
    expect(offspringOptions(sim)).toEqual({ living: 2, cohorts: 0 });
    const r = continueAsOffspring(sim);
    expect(r).toEqual({ ok: true, fastForwardDays: 0 });
    expect(sim.player()).toBe(big);
    expect(big.ai).toBeUndefined();
    expect(sim.milestones).toEqual([]);
    expect(sim.playerSawWinter).toBe(false);
    expect(sim.playerHintsDone).toBe(false);
  });

  it("fast-forwards a lineage cohort until it recruits", () => {
    const sim = deadPlayerSim();
    cohort(sim);
    expect(offspringOptions(sim)).toEqual({ living: 0, cohorts: 1 });
    const r = continueAsOffspring(sim);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fastForwardDays).toBeGreaterThan(0);
    const pl = sim.player()!;
    expect(pl.alive).toBe(true);
    expect(pl.ai).toBeUndefined();
    expect(pl.lengthCm).toBeGreaterThan(14.5);
    expect(pl.lengthCm).toBeLessThan(17);
  });

  it("times out when the cohort never grows", () => {
    const params = { ...defaultParams, spawning: { ...defaultParams.spawning, fryGrowthCmPerDay: 0, fryMortalityPerDay: 0 } };
    const sim = deadPlayerSim(params);
    cohort(sim);
    const r = continueAsOffspring(sim);
    expect(r).toEqual({ ok: false, reason: "timeout" });
    expect((sim.time / params.environment.dayLengthS)).toBeLessThanOrEqual(730 + 1);
  }, 30000);

  it("reports none without lineage", () => {
    const sim = deadPlayerSim();
    cohort(sim, { lineage: false });
    sim.addRival(40, "male");
    expect(continueAsOffspring(sim)).toEqual({ ok: false, reason: "none" });
  });

  it("summarises an eaten player", () => {
    const sim = deadPlayerSim();
    const pl = sim.player()!;
    pl.deathCause = "eaten";
    pl.killedByLengthCm = 70;
    const s = lifeSummary(sim)!;
    expect(s).toMatchObject({ cause: "eaten", byLengthCm: 70, lengthCm: pl.lengthCm, ageDays: pl.ageDays, milestones: ["length-50"] });
    pl.alive = true;
    expect(lifeSummary(sim)).toBeNull();
  });
});
