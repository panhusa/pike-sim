import { describe, expect, it } from "vitest";
import { COMBO_MAX, COMBO_WINDOW_S, Score, stageOf, STAGES } from "../src/game/score";
import { CHALLENGES, Challenges } from "../src/game/challenges";
import { DANGER, DangerClock } from "../src/game/danger";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { HUNTER, hunterMinLength } from "../src/sim/hunter";

describe("Score", () => {
  it("multiplies quick catches and resets after the window", () => {
    const s = new Score();
    expect(s.catch(5, 0).mult).toBe(1);
    expect(s.catch(5, 5).mult).toBe(2);
    expect(s.catch(5, 10).mult).toBe(3);
    expect(s.catch(5, 10 + COMBO_WINDOW_S + 1).mult).toBe(1);
  });
  it("caps the multiplier", () => {
    const s = new Score();
    let m = 0;
    for (let i = 0; i < 10; i++) m = s.catch(5, i).mult;
    expect(m).toBe(COMBO_MAX);
  });
  it("pays at least 50 points times the multiplier", () => {
    expect(new Score().catch(0.2, 0).points).toBe(50);
  });
});

describe("stages", () => {
  it("starts at the first stage and progresses to the next", () => {
    expect(stageOf(1.2)).toEqual({ index: 0, progress: 0 });
    expect(stageOf(1.85).progress).toBeCloseTo(0.5);
    expect(stageOf(2.5).index).toBe(1);
    expect(stageOf(22).index).toBe(STAGES.findIndex((s) => s.name === "Fry-hunter")); // the young-pike start
    expect(stageOf(24).progress).toBeCloseTo(0.5);
    expect(stageOf(30).index).toBe(5);
    expect(stageOf(200)).toEqual({ index: STAGES.length - 1, progress: 1 });
  });
});

describe("Challenges", () => {
  it("Chill never asks for goals that need a hunting pike", () => {
    const c = new Challenges({ chill: true });
    const seen = new Set<string>();
    for (let i = 0; i < CHALLENGES.length * 2; i++) {
      seen.add(c.current.id);
      expect(c.current.danger).toBeUndefined();
      c.index++;
    }
    expect(seen.has("survive")).toBe(false);
    expect(new Challenges().current.id).toBe(CHALLENGES[0]!.id);
  });

  it("completes the first challenge and moves on", () => {
    const c = new Challenges();
    expect(c.current.id).toBe(CHALLENGES[0]!.id);
    expect(c.push({ type: "catch", kind: "roach", lengthCm: 10, t: 0 })).toBeNull();
    expect(c.push({ type: "catch", kind: "roach", lengthCm: 10, t: 1 })?.id).toBe(CHALLENGES[0]!.id);
    expect(c.current.id).toBe(CHALLENGES[1]!.id);
  });
  it("quick double needs two catches within 10 s", () => {
    const c = new Challenges();
    c.index = CHALLENGES.findIndex((d) => d.id === "quick-double");
    expect(c.push({ type: "catch", kind: "roach", lengthCm: 10, t: 0 })).toBeNull();
    expect(c.push({ type: "catch", kind: "roach", lengthCm: 10, t: 20 })).toBeNull();
    expect(c.push({ type: "catch", kind: "perch", lengthCm: 10, t: 25 })?.id).toBe("quick-double");
  });
});

describe("DangerClock", () => {
  it("fires after the first delay and pauses during a hunt", () => {
    const d = new DangerClock(() => 0);
    expect(d.tick(DANGER.FIRST_S - 1, false)).toBe(false);
    expect(d.tick(5, true)).toBe(false);
    expect(d.tick(1, false)).toBe(true);
    expect(d.left).toBe(DANGER.GAP_MIN_S);
  });
});

describe("hunter event", () => {
  const make = () => {
    const sim = new Simulation({ seed: 5, settings: presetSettings("gentle", "permadeath", defaultParams) });
    sim.addPlayer(sim.p.pike.startLengthCm);
    sim.arcade = true;
    return sim;
  };
  it("sends a pike big enough to eat the player, from behind", () => {
    const sim = make();
    const pl = sim.player()!;
    const id = sim.startHunter()!;
    const hk = sim.pikes.find((k) => k.id === id)!;
    expect(hk.lengthCm).toBeGreaterThanOrEqual(hunterMinLength(sim, pl));
    expect(Math.hypot(hk.pos.x - pl.pos.x, hk.pos.z - pl.pos.z)).toBeLessThanOrEqual(HUNTER.spawnBehindM + 0.5);
    expect(sim.events.some((e) => e.type === "hunter-start")).toBe(true);
  });
  it("closes in on a player who sits in open water", () => {
    const sim = make();
    const pl = sim.player()!;
    const id = sim.startHunter()!;
    const hk = sim.pikes.find((k) => k.id === id)!;
    const d0 = Math.hypot(hk.pos.x - pl.pos.x, hk.pos.z - pl.pos.z);
    for (let i = 0; i < 180; i++) sim.step(1 / 60);
    expect(Math.hypot(hk.pos.x - pl.pos.x, hk.pos.z - pl.pos.z)).toBeLessThan(d0 - 2);
  });
  it("ends with an outcome event within its duration", () => {
    const sim = make();
    const pl = sim.player()!;
    sim.startHunter();
    for (let i = 0; i < (HUNTER.durationS + 1) * 60 && sim.hunter; i++) {
      sim.setInput(pl.id, { throttle: 1, yawRate: 0.3, pitchRate: 0, burst: false });
      sim.step(1 / 60);
    }
    expect(sim.hunter).toBeNull();
    expect(sim.events.some((e) => e.type === "hunter-end")).toBe(true);
  });
});
