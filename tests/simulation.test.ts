import { describe, expect, it } from "vitest";
import { dist, v3 } from "../src/sim/math";
import { Simulation } from "../src/sim/simulation";
import { defaultParams } from "../src/sim/params";
import { presetSettings } from "../src/sim/settings";

const DT = 1 / 30;

function snapshot(sim: Simulation): string {
  return JSON.stringify(sim.prey.slice(0, 5).map((f) => [f.pos.x.toFixed(4), f.pos.y.toFixed(4), f.pos.z.toFixed(4)]));
}

describe("simulation", () => {
  it("is deterministic for a given seed", () => {
    const a = new Simulation({ seed: 7 });
    const b = new Simulation({ seed: 7 });
    for (const s of [a, b]) {
      s.addPike(50, v3(0, -2, 0));
      for (let i = 0; i < 300; i++) s.step(DT);
    }
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it("keeps every fish inside the water volume", () => {
    const sim = new Simulation({ seed: 3 });
    const pk = sim.addPike(50);
    sim.setInput(pk.id, { throttle: 1, yawRate: 0.2, pitchRate: 0, burst: false });
    for (let i = 0; i < 900; i++) sim.step(DT);
    for (const f of sim.prey) {
      expect(f.pos.y).toBeLessThanOrEqual(0);
      expect(f.pos.y).toBeGreaterThanOrEqual(sim.world.bottomY(f.pos.x, f.pos.z) - 1e-6);
      expect(Math.hypot(f.pos.x, f.pos.z)).toBeLessThanOrEqual(sim.world.size / 2);
    }
  });

  it("schooling fish stay clustered", () => {
    const sim = new Simulation({ seed: 5 });
    for (let i = 0; i < 600; i++) sim.step(DT);
    const bySchool = new Map<number, number[]>();
    sim.prey.forEach((f, i) => (bySchool.get(f.schoolId) ?? bySchool.set(f.schoolId, []).get(f.schoolId)!).push(i));
    let spreadSum = 0;
    let n = 0;
    for (const idx of bySchool.values()) {
      if (idx.length < 5) continue;
      const c = idx.reduce((a, i) => v3(a.x + sim.prey[i]!.pos.x, a.y + sim.prey[i]!.pos.y, a.z + sim.prey[i]!.pos.z), v3());
      const centre = v3(c.x / idx.length, c.y / idx.length, c.z / idx.length);
      spreadSum += idx.reduce((a, i) => a + dist(sim.prey[i]!.pos, centre), 0) / idx.length;
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(spreadSum / n).toBeLessThan(12); // lake is 90 m wide; random scatter would be ~30 m
  });

  it("prey bolt when a pike charges in, and alarm spreads to schoolmates", () => {
    const sim = new Simulation({ seed: 11 });
    const target = sim.prey[0]!;
    const pk = sim.addPike(60, v3(target.pos.x - 2.5, target.pos.y, target.pos.z));
    pk.stillTime = 0;
    pk.yaw = 0;
    sim.setInput(pk.id, { throttle: 1, yawRate: 0, pitchRate: 0, burst: true });
    for (let i = 0; i < 90; i++) sim.step(DT);
    expect(sim.events.some((e) => e.type === "bolt")).toBe(true);
  });

  it("a hidden, motionless pike surprises prey more than an open-water charger", () => {
    const trial = (ambush: boolean, seed: number): number => {
      const sim = new Simulation({ seed, settings: { ...presetSettings("natural", "permadeath", defaultParams), rivalCount: 0 } });
      const target = sim.prey[0]!;
      // Place the pike in/near cover for the ambush case, in the open otherwise.
      const reed = sim.world.reeds[0]!;
      const pos = ambush ? v3(reed.x, -0.5, reed.z) : v3(reed.x * 0.2, -3, reed.z * 0.2);
      const pk = sim.addPike(60, pos);
      pk.stillTime = ambush ? 5 : 0;
      target.pos = v3(pos.x + 1.8, pos.y, pos.z);
      sim.setInput(pk.id, { throttle: ambush ? 0 : 1, yawRate: 0, pitchRate: 0, burst: false });
      for (let i = 0; i < 60; i++) sim.step(DT);
      return sim.events.filter((e) => e.type === "bolt").length;
    };
    let ambushBolts = 0;
    let chargeBolts = 0;
    for (let s = 1; s <= 12; s++) {
      ambushBolts += trial(true, s);
      chargeBolts += trial(false, s);
    }
    expect(ambushBolts).toBeLessThan(chargeBolts);
  });

  it("an idle, unfed pike loses weight over one in-game day and the calendar advances", () => {
    const sim = new Simulation({ seed: 2, startDay: 120 });
    const pk = sim.addPike(60);
    const w0 = pk.weight;
    for (let i = 0; i < 30 * sim.p.environment.dayLengthS + 30; i++) sim.step(DT);
    expect(pk.alive).toBe(true);
    expect(pk.weight).toBeLessThan(w0);
    expect(sim.env.dayOfYear).toBe(121);
  }, 180000); // ~37 s alone, over 60 s while the long ambush measures share the CPU
});

describe("stocking", () => {
  it("at least 40% of stocked prey are edible for a 22 cm pike", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = new Simulation({ seed });
      const edible = sim.prey.filter((f) => f.lengthCm <= 0.62 * 22).length;
      expect(edible / sim.prey.length).toBeGreaterThanOrEqual(0.4);
    }
  });
});
