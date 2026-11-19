import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";

vi.setConfig({ testTimeout: 60000 });

const make = (chill: boolean) => {
  const sim = new Simulation({ seed: 4, settings: { ...presetSettings("harsh", "permadeath", defaultParams), chill }, startHour: 12 });
  sim.addPlayer(22);
  sim.arcade = true;
  return sim;
};

describe("chill mode", () => {
  it("a big pike striking right at you never bites or kills you", () => {
    const sim = make(true);
    const pl = sim.player()!;
    const big = sim.pikes.find((k) => k.ai)!;
    big.lengthCm = 80;
    for (let n = 0; n < 40; n++) {
      big.pos = { x: pl.pos.x - 0.4, y: pl.pos.y, z: pl.pos.z };
      big.yaw = 0;
      big.pitch = 0;
      pl.yaw = 0;
      big.burstCooldown = 0;
      big.energy = 100;
      sim.setInput(big.id, { throttle: 1, yawRate: 0, pitchRate: 0, burst: true });
      for (let i = 0; i < 20; i++) sim.step(1 / 60);
    }
    expect(pl.alive).toBe(true);
    expect(sim.events.some((e) => e.type === "bitten" || (e.type === "death" && e.pikeId === pl.id))).toBe(false);
  });
  it("hunger cannot kill you", () => {
    const sim = make(true);
    const pl = sim.player()!;
    pl.weight *= 0.4;
    pl.health = 0.01;
    for (let i = 0; i < 60 * 60; i++) sim.step(1 / 60);
    expect(pl.alive).toBe(true);
  });
  it("is off unless asked for (and never outside the game)", () => {
    expect(make(false).chill).toBe(false);
    const r = make(true);
    r.arcade = false;
    expect(r.chill).toBe(false);
  });
});
