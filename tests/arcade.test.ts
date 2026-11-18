import { describe, expect, it } from "vitest";
import { arcadeParams, placePlayerNearPrey, Simulation } from "../src/sim/simulation";
import { defaultParams } from "../src/sim/params";
import { presetSettings } from "../src/sim/settings";
import { dist } from "../src/sim/math";

const make = () => {
  const sim = new Simulation({ seed: 3, settings: presetSettings("gentle", "permadeath", defaultParams) });
  sim.addPlayer(sim.p.pike.startLengthCm);
  return sim;
};

describe("arcade player tuning", () => {
  it("applies multipliers, nested keys and fixed values without touching the shared params", () => {
    const a = arcadeParams(defaultParams);
    const m = defaultParams.arcade;
    expect(a.pike.maxSustainedBL).toBeCloseTo(defaultParams.pike.maxSustainedBL * m.pikeMul.maxSustainedBL);
    expect(a.pike.digestionHalfLifeH.ref).toBeCloseTo(defaultParams.pike.digestionHalfLifeH.ref * m.pikeMul["digestionHalfLifeH.ref"]);
    expect(a.metabolism.growthEfficiency).toBeCloseTo(defaultParams.metabolism.growthEfficiency * m.metabolismMul.growthEfficiency);
    expect(a.strike.oddsMin).toBe(m.strikeSet.oddsMin);
    expect(a.pike.burstCooldownS).toBe(m.pikeSet.burstCooldownS);
    expect(defaultParams.pike.maxSustainedBL).toBe(2.0); // shared set unchanged
  });

  it("is off by default and only ever applies to the player", () => {
    const sim = make();
    const pl = sim.player()!;
    const rival = sim.pikes.find((k) => k !== pl)!;
    expect(sim.paramsFor(pl)).toBe(sim.p);
    sim.arcade = true;
    expect(sim.paramsFor(pl).pike.maxSustainedBL).toBeGreaterThan(sim.p.pike.maxSustainedBL);
    expect(sim.paramsFor(rival)).toBe(sim.p);
  });

  it("makes the player faster", () => {
    const top = (arcade: boolean): number => {
      const sim = make();
      sim.arcade = arcade;
      const pl = sim.player()!;
      for (let i = 0; i < 120; i++) {
        sim.setInput(pl.id, { throttle: 1, yawRate: 0, pitchRate: 0, burst: false });
        sim.step(1 / 60);
      }
      return pl.speed;
    };
    expect(top(true)).toBeGreaterThan(top(false) * 2);
  });

  it("starts a new life within sight of edible prey, facing it", () => {
    const sim = make();
    sim.arcade = true;
    placePlayerNearPrey(sim);
    const pl = sim.player()!;
    const maxLen = sim.p.pike.maxPreyLengthFracOfBL * pl.lengthCm;
    const near = Math.min(...sim.prey.filter((f) => f.lengthCm <= maxLen).map((f) => dist(f.pos, pl.pos)));
    expect(near).toBeLessThanOrEqual(7.5);
    expect(sim.world.inWater(pl.pos.x, pl.pos.z)).toBe(true);
  });
});
