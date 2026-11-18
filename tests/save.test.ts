import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/sim/params";
import { parseSave, toSaveFile } from "../src/sim/save";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { jumpToDay } from "./helpers";

const settings = { ...presetSettings("natural", "permadeath", defaultParams), rivalCount: 4 };
const make = (): Simulation => {
  const sim = new Simulation({ seed: 4, settings });
  sim.addPlayer(60);
  return sim;
};
const run = (sim: Simulation, n: number): void => {
  for (let i = 0; i < n; i++) sim.step(1 / 20);
};
const load = (text: string): Simulation => {
  const r = parseSave(text);
  if (!r.ok) throw new Error(r.reason);
  return r.sim;
};

describe("save state", () => {
  it("round trip is exact", () => {
    const a = make();
    run(a, 300);
    const save = toSaveFile(a, new Date(0));
    run(a, 300);
    const b = load(save);
    run(b, 300);
    expect(JSON.stringify(b.toState())).toBe(JSON.stringify(a.toState()));
  }, 60000);

  it("round trip is exact across day boundaries with populated state", () => {
    const a = make();
    run(a, 20);
    jumpToDay(a, a.startDay + 1);
    const rival = a.pikes.find((k) => k.ai)!;
    rival.alive = false;
    rival.deathCause = "eaten";
    a.cohorts.push({ id: 5, parentIds: [a.pikes[0]!.id, rival.id], lineage: true, bornDay: a.dayIndex(), count: 400, meanLengthCm: 6 });
    a.nextCohortId = 6;
    a.spawn.dwell = { [a.pikes[0]!.id]: 12.5 };
    (a as unknown as { attempted: Set<string> }).attempted.add("9999:1:2");
    a.milestones = ["length-50", "first-winter"];
    a.playerSawWinter = true;
    const st = a.toState();
    expect(st.milestones).toEqual(["length-50", "first-winter"]);
    expect(st.playerSawWinter).toBe(true);
    expect(st.cohorts.length).toBeGreaterThan(0);
    expect(Object.keys(st.spawn.dwell).length).toBeGreaterThan(0);
    expect(st.attempted.length).toBeGreaterThan(0);
    expect(st.pikes.some((k) => !k.alive)).toBe(true);
    expect(st.prey.some((f) => f.ageDays > 0)).toBe(true);
    const b = load(toSaveFile(a, new Date(0)));
    expect(JSON.stringify(b.toState())).toBe(JSON.stringify(st));
    expect(b.milestones).toEqual(["length-50", "first-winter"]);
    expect(b.playerSawWinter).toBe(true);
    for (const s of [a, b]) {
      run(s, 100);
      jumpToDay(s, s.startDay + 3);
      run(s, 100);
    }
    expect(JSON.stringify(b.toState())).toBe(JSON.stringify(a.toState()));
  }, 120000);

  it("world regenerates", () => {
    const a = make();
    const b = load(toSaveFile(a, new Date(0)));
    expect(b.world.reeds).toEqual(a.world.reeds);
  });

  it("corrupt and unknown versions are reported", () => {
    const text = toSaveFile(make(), new Date(0));
    expect(parseSave("{")).toEqual({ ok: false, reason: "corrupt" });
    expect(parseSave(JSON.stringify({ ...JSON.parse(text), version: 2 }))).toEqual({ ok: false, reason: "version" });
    expect(parseSave(JSON.stringify({ version: 1, savedAt: "x" }))).toEqual({ ok: false, reason: "corrupt" });
  });

  it("dangling ids load", () => {
    const a = make();
    run(a, 20);
    const rival = a.pikes.find((k) => k.ai)!;
    rival.ai!.targetId = 999999;
    a.cohorts.push({ id: 77, parentIds: [999998], lineage: false, bornDay: 0, count: 50, meanLengthCm: 99 });
    a.nextCohortId = 78;
    const b = load(toSaveFile(a, new Date(0)));
    expect(() => {
      run(b, 100);
      jumpToDay(b, b.startDay + 2);
      run(b, 20);
    }).not.toThrow();
    expect(b.cohorts.some((c) => c.parentIds.includes(999998)) || b.pikes.some((k) => k.parentIds?.includes(999998))).toBe(true);
    expect(b.pikes.find((k) => k.id === rival.id)!.ai!.targetId).not.toBe(999999);
  }, 60000);

  it("incomplete or non-finite state is corrupt", () => {
    const good = JSON.parse(toSaveFile(make(), new Date(0)));
    for (const key of ["seed", "settings", "spawn"]) {
      const bad = structuredClone(good);
      delete bad.state[key];
      expect(parseSave(JSON.stringify(bad)), key).toEqual({ ok: false, reason: "corrupt" });
    }
    const bad = structuredClone(good);
    bad.state.time = "soon";
    expect(parseSave(JSON.stringify(bad))).toEqual({ ok: false, reason: "corrupt" });
    const badMs = structuredClone(good);
    badMs.state.milestones = [1];
    expect(parseSave(JSON.stringify(badMs))).toEqual({ ok: false, reason: "corrupt" });
    const badWinter = structuredClone(good);
    badWinter.state.playerSawWinter = "yes";
    expect(parseSave(JSON.stringify(badWinter))).toEqual({ ok: false, reason: "corrupt" });
  });

  it("playerHintsDone: false for a fresh sim, true for a legacy save without the field", () => {
    const a = make();
    expect(a.playerHintsDone).toBe(false);
    const st = a.toState();
    expect(st.playerHintsDone).toBe(false);
    delete st.playerHintsDone;
    expect(Simulation.fromState(st).playerHintsDone).toBe(true);
    a.playerHintsDone = true;
    expect(Simulation.fromState(a.toState()).playerHintsDone).toBe(true);
  });

  it("parseSave keeps a boolean playerHintsDone and defaults a malformed one instead of rejecting the save", () => {
    const a = make();
    const file = JSON.parse(toSaveFile(a, new Date(0)));
    const r = parseSave(JSON.stringify(file));
    expect(r.ok && r.sim.playerHintsDone).toBe(false);
    file.state.playerHintsDone = "yes";
    const bad = parseSave(JSON.stringify(file));
    expect(bad.ok).toBe(true);
    expect(bad.ok && bad.sim.playerHintsDone).toBe(true);
  });
});
