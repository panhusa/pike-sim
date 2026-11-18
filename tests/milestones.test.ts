import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/sim/params";
import { checkMilestones, MILESTONE_TEXT } from "../src/sim/milestones";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { spawnPair } from "../src/sim/spawning";
import { jumpToDay } from "./helpers";

const settings = { ...presetSettings("natural", "permadeath", defaultParams), rivalCount: 0 };
const make = (len = 40): Simulation => {
  const sim = new Simulation({ seed: 3, settings });
  sim.addPlayer(len);
  return sim;
};
const ids = (sim: Simulation): string[] => sim.events.filter((e) => e.type === "milestone").map((e) => (e as { id: string }).id);

describe("milestones", () => {
  it("has the exact copy", () => {
    expect(MILESTONE_TEXT).toEqual({
      "first-winter": "Survived your first winter",
      "length-50": "Reached 50 cm",
      "length-80": "Reached 80 cm",
      "first-spawn": "Spawned for the first time",
      "largest-pike": "Largest pike in the lake",
    });
  });

  it("first-winter: needs a winter day then a spring day", () => {
    const sim = make();
    jumpToDay(sim, 10); // winter
    expect(sim.playerSawWinter).toBe(true);
    expect(sim.milestones).not.toContain("first-winter");
    jumpToDay(sim, 100); // spring
    expect(sim.milestones).toContain("first-winter");
    expect(ids(sim)).toEqual(["first-winter"]);
  });

  it("first-winter: spring alone does not count", () => {
    const sim = make();
    jumpToDay(sim, 100);
    expect(sim.playerSawWinter).toBe(false);
    expect(sim.milestones).not.toContain("first-winter");
  });

  it("length-50 and length-80", () => {
    const sim = make(49);
    expect(checkMilestones(sim)).toEqual([]);
    sim.player()!.lengthCm = 50;
    expect(checkMilestones(sim)).toEqual(["length-50"]);
    sim.player()!.lengthCm = 85;
    expect(checkMilestones(sim)).toEqual(["length-80"]);
    expect(sim.milestones).toEqual(["length-50", "length-80"]);
  });

  it("first-spawn fires on a spawn that includes the player only", () => {
    const sim = make();
    const a = sim.addRival(60, "female");
    const b = sim.addRival(60, "male");
    spawnPair(sim, a, b);
    expect(sim.milestones).not.toContain("first-spawn");
    const pl = sim.player()!;
    const mate = pl.sex === "male" ? a : b;
    spawnPair(sim, pl.sex === "male" ? mate : pl, pl.sex === "male" ? pl : mate);
    expect(sim.milestones).toContain("first-spawn");
    expect(ids(sim)).toContain("first-spawn");
  });

  it("largest-pike needs another live pike and being longer than all", () => {
    const sim = make(90);
    expect(checkMilestones(sim)).not.toContain("largest-pike"); // empty lake
    const r = sim.addRival(70, "female");
    expect(checkMilestones(sim)).toContain("largest-pike");
    const sim2 = make(60);
    sim2.addRival(70, "female");
    expect(checkMilestones(sim2)).not.toContain("largest-pike");
    r.alive = false;
  });

  it("largest-pike ignores dead rivals", () => {
    const sim = make(60);
    const r = sim.addRival(90, "female");
    r.alive = false;
    expect(checkMilestones(sim)).not.toContain("largest-pike");
  });

  it("each fires once", () => {
    const sim = make(90);
    sim.addRival(50, "female");
    const first = checkMilestones(sim);
    expect(first.length).toBeGreaterThan(0);
    expect(checkMilestones(sim)).toEqual([]);
    expect(ids(sim).length).toBe(first.length);
  });

  it("a dead player achieves nothing", () => {
    const sim = make(90);
    sim.addRival(50, "female");
    sim.player()!.alive = false;
    expect(checkMilestones(sim)).toEqual([]);
    expect(sim.milestones).toEqual([]);
  });

  it("onNewDay runs the check", () => {
    const sim = make(85);
    jumpToDay(sim, sim.startDay + 1);
    expect(sim.milestones).toEqual(expect.arrayContaining(["length-50", "length-80"]));
  });
});
