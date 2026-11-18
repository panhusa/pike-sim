import { describe, expect, it } from "vitest";
import { v3, type Vec3 } from "../src/sim/math";
import { defaultParams } from "../src/sim/params";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { cohortsDay, isMature, seasonOpen } from "../src/sim/spawning";
import { jumpToDay } from "./helpers";

const natural = presetSettings("natural", "permadeath", defaultParams);
const K = defaultParams.spawning;

function makeSim(opts: { seed?: number; startDay?: number } = {}): Simulation {
  const sim = new Simulation({ seed: opts.seed ?? 3, startDay: opts.startDay, settings: { ...natural, rivalCount: 0 } });
  sim.prey.length = 0;
  return sim;
}

/** Two points 3 m apart that both qualify as shallow reed cover. */
function reedPair(sim: Simulation): [Vec3, Vec3] {
  const ok = (v: Vec3): boolean => sim.world.depthAt(v.x, v.z) <= K.maxDepthM && sim.world.coverAt(v) >= K.minCover;
  for (const r of sim.world.reeds) {
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const p1 = v3(r.x, -0.4, r.z);
      const p2 = v3(r.x + Math.cos(a) * 3, -0.4, r.z + Math.sin(a) * 3);
      if (ok(p1) && ok(p2) && sim.world.inWater(p2.x, p2.z)) return [p1, p2];
    }
  }
  throw new Error("no reed pair found");
}

function forceOpen(sim: Simulation): void {
  sim.spawn.openDay = sim.dayIndex();
}

function run(sim: Simulation, seconds: number): void {
  for (let i = 0; i < seconds * 20; i++) sim.step(1 / 20);
}

const spawnEvents = (sim: Simulation) => sim.events.filter((e) => e.type === "spawn");

describe("spawning", () => {
  it("season opens on the spring temperature crossing", () => {
    const sim = makeSim({ startDay: 50 });
    let first = -1;
    let closedAgain = -1;
    for (let d = 50; d < 130; d++) {
      jumpToDay(sim, d);
      if (first < 0 && seasonOpen(sim)) first = d;
      if (first >= 0 && closedAgain < 0 && !seasonOpen(sim)) closedAgain = d;
      if (first < 0) expect(sim.env.tempC).toBeLessThan(K.startTempC);
    }
    expect(first).toBeGreaterThan(0);
    jumpToDay(sim, first);
    expect(sim.env.tempC).toBeGreaterThanOrEqual(K.startTempC);
    expect(closedAgain).toBe(first + K.seasonDays);
  });

  it("mature opposite-sex pair spawns in shallow cover", () => {
    const sim = makeSim();
    const [a, b] = reedPair(sim);
    const f = sim.addPike(55, a, "female");
    const m = sim.addPike(45, b, "male");
    forceOpen(sim);
    for (let i = 0; i < (K.dwellS + 2) * 20 && spawnEvents(sim).length === 0; i++) sim.step(1 / 20);
    const kg = f.weight / (1 - K.weightLossFrac) / 1000; // weight at the moment of spawning
    expect(spawnEvents(sim)).toHaveLength(1);
    expect(sim.cohorts).toHaveLength(1);
    expect(sim.cohorts[0]!.count).toBe(Math.round(kg * K.eggsPerKgFemale * natural.recruitmentScale));
    expect(sim.cohorts[0]!.parentIds).toEqual([f.id, m.id]);
    expect(f.spawnedYear).toBe(sim.spawn.year);
    expect(JSON.parse(JSON.stringify(sim.cohorts))).toEqual(sim.cohorts);
  });

  it("both parents lose 12% of body weight", () => {
    const sim = makeSim();
    const [a, b] = reedPair(sim);
    const f = sim.addPike(55, a, "female");
    const m = sim.addPike(45, b, "male");
    forceOpen(sim);
    const w0 = [f.weight, m.weight];
    sim.step(1 / 20);
    const w1 = [f.weight, m.weight]; // metabolism over one tick is negligible
    run(sim, K.dwellS + 2);
    expect(f.weight / w1[0]!).toBeCloseTo(1 - K.weightLossFrac, 2);
    expect(m.weight / w1[1]!).toBeCloseTo(1 - K.weightLossFrac, 2);
    expect(w1[0]!).toBeCloseTo(w0[0]!, 0);
  });

  it("no spawning for same-sex, immature, or out-of-season pairs", () => {
    const cases: Array<[number, "male" | "female", number, "male" | "female", boolean]> = [
      [55, "female", 50, "female", true],
      [30, "male", 25, "male", true],
      [30, "female", 25, "male", true], // female below 40 cm, male below 30 cm
      [55, "female", 45, "male", false], // mature but season closed
    ];
    for (const [l1, s1, l2, s2, open] of cases) {
      const sim = makeSim();
      const [a, b] = reedPair(sim);
      sim.addPike(l1, a, s1);
      sim.addPike(l2, b, s2);
      if (open) forceOpen(sim);
      run(sim, K.dwellS + 2);
      expect(spawnEvents(sim)).toHaveLength(0);
    }
  });

  it("each pike spawns at most once per season", () => {
    const sim = makeSim();
    const [a, b] = reedPair(sim);
    sim.addPike(55, a, "female");
    sim.addPike(45, b, "male");
    forceOpen(sim);
    run(sim, 3 * K.dwellS);
    expect(spawnEvents(sim)).toHaveLength(1);
  });

  it("dwell must be uninterrupted", () => {
    const sim = makeSim();
    const [a, b] = reedPair(sim);
    const f = sim.addPike(55, a, "female");
    sim.addPike(45, b, "male");
    forceOpen(sim);
    run(sim, K.dwellS / 2);
    expect(spawnEvents(sim)).toHaveLength(0);
    expect(sim.spawn.dwell[f.id]).toBeGreaterThan(0);
    const away = v3(0, -3, 0);
    expect(sim.world.depthAt(away.x, away.z)).toBeGreaterThan(K.maxDepthM);
    f.pos = { ...away };
    sim.step(1 / 20);
    expect(sim.spawn.dwell[f.id]).toBeUndefined();
    f.pos = { ...a };
    run(sim, K.dwellS * 0.75); // stale dwell would have spawned by now
    expect(spawnEvents(sim)).toHaveLength(0);
    run(sim, K.dwellS * 0.25 + 2);
    expect(spawnEvents(sim)).toHaveLength(1);
  });

  it("a male spawns once per season even with two ready females", () => {
    const sim = makeSim();
    const [a, b] = reedPair(sim);
    sim.addPike(55, a, "female");
    sim.addPike(50, { ...a, x: a.x + 0.01 }, "female");
    const m = sim.addPike(45, b, "male");
    forceOpen(sim);
    let before = m.weight;
    for (let i = 0; i < (K.dwellS + 2) * 20 && spawnEvents(sim).length === 0; i++) {
      before = m.weight;
      sim.step(1 / 20);
    }
    run(sim, 3);
    expect(spawnEvents(sim)).toHaveLength(1);
    expect(sim.cohorts).toHaveLength(1);
    expect(m.weight / before).toBeCloseTo(1 - K.weightLossFrac, 3);
  });

  it("maturity depends on sex", () => {
    const sim = makeSim();
    expect(isMature(sim.addPike(35, undefined, "male"), sim.p)).toBe(true);
    expect(isMature(sim.addPike(35, undefined, "female"), sim.p)).toBe(false);
  });

  it("cohort shrinks, grows, then recruits", () => {
    const sim = makeSim();
    sim.cohorts.push({ id: 99, parentIds: [7, 8], lineage: false, bornDay: 0, count: 20000, meanLengthCm: K.fryStartLengthCm });
    sim.env = { ...sim.env, tempC: 18 };
    let d = 0;
    while (sim.cohorts.length > 0 && d < 400) {
      const c = sim.cohorts[0]!;
      const len = c.meanLengthCm;
      cohortsDay(sim);
      d++;
      if (sim.cohorts.length > 0) {
        expect(sim.cohorts[0]!.count / (20000 * Math.exp(-K.fryMortalityPerDay * d))).toBeCloseTo(1, 2);
        expect(sim.cohorts[0]!.meanLengthCm).toBeGreaterThan(len);
      }
    }
    expect(sim.cohorts).toHaveLength(0);
    const kids = sim.pikes.filter((k) => k.parentIds.length > 0);
    expect(kids).toHaveLength(K.recruitMax);
    for (const k of kids) {
      expect(k.parentIds).toEqual([7, 8]);
      expect(k.lengthCm).toBeGreaterThanOrEqual(K.recruitLengthCm);
      expect(k.lengthCm).toBeLessThan(K.recruitLengthCm + 1);
      expect(k.ai).toBeDefined();
    }
    expect(sim.events.filter((e) => e.type === "recruit-pike")).toHaveLength(1);
  });

  it("player cohorts are lineage cohorts", () => {
    const sim = makeSim();
    const [a, b] = reedPair(sim);
    const pl = sim.addPlayer(55);
    pl.sex = "female";
    pl.pos = { ...a };
    sim.addPike(45, b, "male");
    forceOpen(sim);
    run(sim, K.dwellS + 2);
    expect(sim.cohorts).toHaveLength(1);
    expect(sim.cohorts[0]!.parentIds).toContain(sim.playerId);
    expect(sim.cohorts[0]!.lineage).toBe(true);
  });
});
