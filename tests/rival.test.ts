import { describe, expect, it } from "vitest";
import { dist, Rng, v3 } from "../src/sim/math";
import { spawnPrey } from "../src/sim/prey";
import { rivalInput } from "../src/sim/rival";
import { defaultParams } from "../src/sim/params";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";

const natural = presetSettings("natural", "permadeath", defaultParams);

describe("rival pike", () => {
  it("rival hunts and feeds", () => {
    let rivalCaptures = 0;
    for (const seed of [1, 2, 3]) {
      const sim = new Simulation({ seed, settings: { ...natural, rivalCount: 1 } });
      const rivalIds = new Set(sim.pikes.map((k) => k.id));
      for (let i = 0; i < 20 * 600 * 2; i++) sim.step(1 / 20);
      for (const e of sim.events) if (e.type === "capture" && rivalIds.has(e.pikeId)) rivalCaptures++;
    }
    expect(rivalCaptures).toBeGreaterThanOrEqual(1);
  }, 120000);

  it("rival flees a much bigger pike", () => {
    const sim = new Simulation({ seed: 5, settings: { ...natural, rivalCount: 0 } });
    sim.prey.length = 0;
    const rival = sim.addRival(30, "male");
    rival.pos = v3(0, -2, 0);
    rival.yaw = Math.PI; // facing the approaching pike: vision is forward-biased, the lateral line is short
    const big = sim.addPike(90, v3(-4, -2, 0), "female");
    big.yaw = 0;
    big.stomachG = 1e9; // not interested in eating, only bursting at the rival
    let fled = false;
    let committed = 0;
    let prevD = Infinity;
    for (let i = 0; i < 60 * 3; i++) {
      sim.setInput(big.id, { throttle: i < 30 ? 1 : 0, yawRate: 0, pitchRate: 0, burst: i < 30 });
      sim.step(1 / 60);
      if (i < 30 && rival.ai?.mode === "flee") fled = true;
      // big pike has stopped: once it is out of sensing the rival must stay committed and not turn back
      const d = dist(rival.pos, big.pos);
      if (i >= 90 && rival.ai!.fleeS > 0) {
        committed++;
        expect(rival.ai!.mode).toBe("flee");
        expect(d).toBeGreaterThanOrEqual(prevD - 0.05);
      }
      prevD = d;
    }
    expect(committed).toBeGreaterThan(0);
    expect(fled).toBe(true);
    expect(dist(rival.pos, big.pos)).toBeGreaterThan(4);
  });

  it("flight stays committed after the threat is out of every sense", () => {
    const sim = new Simulation({ seed: 5, settings: { ...natural, rivalCount: 0 } });
    sim.prey.length = 0;
    const rival = sim.addRival(30, "male");
    rival.pos = v3(0, -2, 0);
    rival.yaw = Math.PI;
    const big = sim.addPike(90, v3(-4, -2, 0), "female");
    big.yaw = 0;
    sim.step(1 / 60);
    const ai = rival.ai!;
    expect(ai.mode).toBe("flee");
    expect(ai.fleeFrom).not.toBeNull();
    const from = { ...ai.fleeFrom! };
    big.pos = v3(-40, -2, 0); // far beyond vision and lateral line from here on
    const commit = sim.p.rival.fleeCommitS;
    const dFrom = (): number => Math.hypot(rival.pos.x - from.x, rival.pos.z - from.z);
    let prevS = ai.fleeS;
    let ticks = 0;
    const d0 = dFrom();
    let dMid = 0;
    let prevD = d0;
    while (ai.fleeS > 0 && ticks < 60 * (commit + 2)) {
      sim.step(1 / 60);
      ticks++;
      if (ai.fleeS <= 0) break;
      expect(ai.mode).toBe("flee");
      expect(ai.fleeFrom).toEqual(from);
      expect(ai.fleeS).toBeLessThan(prevS);
      prevS = ai.fleeS;
      if (ticks === 60) dMid = dFrom();
      if (ticks > 60) expect(dFrom()).toBeGreaterThanOrEqual(prevD - 0.02);
      prevD = dFrom();
    }
    expect(ticks).toBeGreaterThan(60 * (commit - 0.5));
    expect(ticks).toBeLessThanOrEqual(60 * commit + 2);
    expect(dFrom()).toBeGreaterThan(dMid);
    expect(dMid).toBeGreaterThan(d0 - 0.5);
    sim.step(1 / 60);
    expect(ai.mode).not.toBe("flee");
    expect(ai.fleeFrom).toBeNull();
  });

  it("rivals only target what they sense", () => {
    const sim = new Simulation({ seed: 6, settings: { ...natural, rivalCount: 0 } });
    sim.prey.length = 0;
    const rival = sim.addRival(60, "female");
    rival.pos = v3(-15, -2, 0);
    rival.yaw = 0;
    rival.ai!.home = { ...rival.pos };
    sim.prey.push(spawnPrey(9999, "roach", 1, v3(10, -2, 0), 12, sim.p, sim.rng));
    for (let i = 0; i < 40; i++) sim.step(1 / 20);
    expect(rival.ai!.targetId).toBeNull();
  });

  it("homes are spread out", () => {
    const sim = new Simulation({ seed: 7, settings: { ...natural, rivalCount: 0 } });
    const rivals = [50, 52, 54, 56, 58, 60].map((len, i) => sim.addRival(len, i % 2 ? "male" : "female"));
    const min = sim.p.rival.territoryRadiusM * 0.5;
    for (let i = 0; i < rivals.length; i++)
      for (let j = i + 1; j < rivals.length; j++)
        expect(dist(rivals[i]!.ai!.home, rivals[j]!.ai!.home)).toBeGreaterThanOrEqual(min);
  });

  it("empty lake works", () => {
    const sim = new Simulation({ seed: 8, settings: { ...natural, rivalCount: 0 } });
    sim.addPlayer(40);
    expect(() => {
      for (let i = 0; i < 600; i++) sim.step(1 / 60);
    }).not.toThrow();
  });

  it("detailed step budget", () => {
    const sim = new Simulation({ seed: 9, settings: { ...natural, rivalCount: 10 } });
    sim.addPlayer(40);
    for (let i = 0; i < 60; i++) sim.step(1 / 60); // warm up
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) sim.step(1 / 60);
    const mean = (performance.now() - t0) / 600;
    console.log(`rival step budget: mean ${mean.toFixed(3)} ms/step with 10 rivals`);
    expect(mean).toBeLessThanOrEqual(8);
  });

  describe("lunge strike", () => {
    function hungryRival(fishDist: number) {
      const sim = new Simulation({ seed: 5, settings: { ...natural, rivalCount: 0 } });
      sim.prey.length = 0;
      const rival = sim.addRival(40, "male");
      rival.pos = v3(0, -2, 0);
      rival.yaw = 0;
      rival.pitch = 0;
      rival.speed = 0;
      rival.stomachG = 0;
      const base = v3(rival.pos.x + 0.2, rival.pos.y, rival.pos.z); // mouth is half a body length ahead
      const pos = v3(base.x + fishDist, base.y, base.z);
      const f = spawnPrey(9001, "roach", 0, pos, 10, sim.p, new Rng(9001));
      f.vel = v3(0, 0, 0);
      sim.prey.push(f);
      return { sim, rival, fish: f };
    }

    it("a hungry rival bursts only when its target is a lunge candidate", () => {
      const { sim, rival, fish } = hungryRival(1.8);
      expect(rivalInput(sim, rival, 1 / 60).burst).toBe(false);
      fish.pos = v3(rival.pos.x + 0.2 + 0.8, rival.pos.y, rival.pos.z);
      expect(rivalInput(sim, rival, 1 / 60).burst).toBe(true);
    });

    it("rival strike path uses lungeCandidate", () => {
      const { sim, rival, fish } = hungryRival(0.8);
      sim.step(1 / 60);
      expect(rival.lockId).toBe(fish.id);
    });
  });
});
