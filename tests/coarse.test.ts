import { describe, expect, it } from "vitest";
import { coarseAdvance } from "../src/sim/coarse";
import { v3 } from "../src/sim/math";
import { defaultParams } from "../src/sim/params";
import type { PikeState } from "../src/sim/pike";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { weedPoint } from "./helpers";

const natural = presetSettings("natural", "permadeath", defaultParams);
const harsh = presetSettings("harsh", "permadeath", defaultParams);
const DAY = 86400;

function withPlayer(sim: Simulation, lengthCm: number): PikeState {
  const pl = sim.addPlayer(lengthCm);
  pl.pos = weedPoint(sim);
  pl.speed = 0;
  pl.stillTime = 10;
  return pl;
}

describe("coarse simulation", () => {
  it("advances calendar and biology", () => {
    const sim = new Simulation({ seed: 1, settings: { ...natural, rivalCount: 3 } });
    sim.prey.length = 0; // nothing to eat, so the player stays unfed
    const pl = withPlayer(sim, 40);
    const t0 = sim.time;
    const day0 = sim.env.dayOfYear;
    const ages = new Map(sim.pikes.map((k) => [k.id, k.ageDays]));
    const w0 = pl.weight;
    coarseAdvance(sim, DAY, { player: "resting", onThreat: "count" });
    expect(Math.abs(sim.time - t0 - 600)).toBeLessThanOrEqual(2.1);
    expect(sim.env.dayOfYear).toBe(day0 + 1);
    for (const k of sim.pikes) if (k.alive) expect(Math.abs(k.ageDays - ages.get(k.id)! - 1)).toBeLessThanOrEqual(0.01);
    expect(pl.alive).toBe(true);
    expect(pl.weight).toBeLessThan(w0);
  });

  it("rivals feed", () => {
    let intake = 0;
    for (const seed of [1, 2, 3]) {
      const sim = new Simulation({ seed, settings: { ...natural, rivalCount: 6 } });
      const before = sim.prey.length;
      const report = coarseAdvance(sim, 2 * DAY, { player: "absent", onThreat: "count" });
      intake += Object.values(report.intake).reduce((a, b) => a + b, 0);
      let captures = 0;
      let recruits = 0;
      for (const e of sim.events) {
        if (e.type === "capture" && e.kind !== "pike") captures++;
        if (e.type === "recruit") recruits += e.count;
      }
      expect(before - sim.prey.length).toBeGreaterThanOrEqual(captures - recruits);
    }
    expect(intake).toBeGreaterThan(0);
  });

  it("cannibalism happens", () => {
    let eaten = false;
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = new Simulation({ seed, settings: { ...natural, rivalCount: 0, aggression: 1.5 } });
      const big = sim.addRival(90, "female");
      const small = sim.addRival(25, "male");
      small.ai!.home = v3(big.ai!.home.x + 3, big.ai!.home.y, big.ai!.home.z);
      small.pos = { ...small.ai!.home };
      big.stomachG = 0;
      small.stomachG = 0;
      coarseAdvance(sim, 10 * DAY, { player: "absent", onThreat: "count" });
      const death = sim.events.find((e) => e.type === "death" && e.pikeId === small.id);
      if (!small.alive && small.deathCause === "eaten" && death?.type === "death" && death.cause === "eaten") eaten = true;
    }
    expect(eaten).toBe(true);
  });

  it("threat stops rest", () => {
    let found = false;
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = new Simulation({ seed, settings: harsh });
      const pl = withPlayer(sim, 30);
      const big = sim.pikes.filter((k) => k.ai && k.lengthCm >= 30 / defaultParams.pike.maxPreyLengthFracOfBL);
      big.forEach((k, i) => {
        k.ai!.home = v3(pl.pos.x + 4 + i, pl.pos.y, pl.pos.z);
      });
      const report = coarseAdvance(sim, 20 * DAY, { player: "resting", onThreat: "stop" });
      expect(pl.alive).toBe(true);
      if (report.threatRivalId === null) continue;
      const rival = sim.pikes.find((k) => k.id === report.threatRivalId)!;
      expect(rival.lengthCm).toBeGreaterThanOrEqual(30 / defaultParams.pike.maxPreyLengthFracOfBL);
      found = true;
    }
    expect(found).toBe(true);
  });

  it("stops when the resting player starves", () => {
    const sim = new Simulation({ seed: 3, settings: { ...natural, rivalCount: 0 } });
    sim.prey.length = 0;
    const pl = withPlayer(sim, 40);
    pl.weight *= 0.4; // condition far below the starvation threshold
    pl.health = 0.001;
    const t0 = sim.time;
    const report = coarseAdvance(sim, 5 * DAY, { player: "resting", onThreat: "count" });
    expect(report.playerDied).toBe(true);
    expect(pl.alive).toBe(false);
    expect(pl.deathCause).toBe("starvation");
    expect(report.ticks).toBeLessThan((5 * DAY) / defaultParams.coarse.tickBioS);
    expect(sim.time - t0).toBeCloseTo((report.ticks * defaultParams.coarse.tickBioS) / sim.bioScale, 6);
  });

  it("empty lake", () => {
    const sim = new Simulation({ seed: 2, settings: { ...natural, rivalCount: 0 } });
    withPlayer(sim, 40);
    const report = coarseAdvance(sim, 5 * DAY, { player: "resting", onThreat: "count" });
    expect(report.threatCount).toBe(0);
    expect(report.threatRivalId).toBeNull();
  });

  it("speed", () => {
    const sim = new Simulation({ seed: 4, settings: { ...natural, rivalCount: 10 } });
    withPlayer(sim, 40);
    const t0 = performance.now();
    coarseAdvance(sim, DAY, { player: "resting", onThreat: "count" });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
