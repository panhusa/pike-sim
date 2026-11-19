import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { World } from "../src/sim/world";

vi.setConfig({ testTimeout: 60000 });

const river = () => new World(defaultParams.world, 1234, "river");

describe("river world", () => {
  it("has water along a meandering channel and dry land beside it", () => {
    const w = river();
    for (let x = -60; x <= 60; x += 5) {
      const zc = w.centreZ(x);
      expect(w.inWater(x, zc)).toBe(true);
      expect(w.depthAt(x, zc)).toBeGreaterThan(0.5);
      expect(w.inWater(x, zc + 25)).toBe(false);
      expect(w.edgeDist(x, zc + 25)).toBeLessThan(0);
      expect(w.bankY(x, zc + 25)).toBeGreaterThan(0.6);
    }
  });
  it("flows downstream (+x), faster over riffles than in pools, never on the lake", () => {
    const w = river();
    let riffle = { x: 0, p: 2 };
    let pool = { x: 0, p: -1 };
    for (let x = -40; x <= 40; x += 0.5) {
      const p = w.poolness(x);
      if (p < riffle.p) riffle = { x, p };
      if (p > pool.p) pool = { x, p };
    }
    const at = (x: number) => w.currentAt(x, -0.3, w.centreZ(x));
    expect(at(riffle.x).x).toBeGreaterThan(0.3);
    expect(at(riffle.x).x).toBeGreaterThan(at(pool.x).x * 1.5);
    expect(w.depthAt(pool.x, w.centreZ(pool.x))).toBeGreaterThan(w.depthAt(riffle.x, w.centreZ(riffle.x)) * 2);
    const lake = new World(defaultParams.world, 1234);
    expect(lake.currentAt(3, -1, 4)).toEqual({ x: 0, y: 0, z: 0 });
  });
  it("confine pushes a stray point back into the channel", () => {
    const w = river();
    const p = { x: 10, y: -0.5, z: w.centreZ(10) + 30 };
    w.confine(p);
    expect(w.edgeDist(p.x, p.z)).toBeGreaterThan(1.4);
  });
  it("the inward direction points away from the nearest bank", () => {
    const w = river();
    const x = 5;
    const z = w.centreZ(x) + w.halfWidth(x) * 0.8;
    const d = w.inward(x, z);
    expect(w.edgeDist(x + d.x, z + d.z)).toBeGreaterThan(w.edgeDist(x, z));
  });
});

describe("river simulation", () => {
  it("fish start in the water and stay in it, holding against the current", () => {
    const sim = new Simulation({ seed: 9, settings: { ...presetSettings("natural", "permadeath", defaultParams), map: "river" }, startHour: 12 });
    sim.addPlayer(30);
    sim.arcade = true;
    const w = sim.world;
    expect(w.shape).toBe("river");
    const wet = () => [...sim.prey.filter((f) => f.alive), ...sim.pikes.filter((k) => k.alive)].every((f) => w.edgeDist(f.pos.x, f.pos.z) > 0.5);
    expect(wet()).toBe(true);
    const meanX0 = sim.prey.reduce((s, f) => s + f.pos.x, 0) / sim.prey.length;
    for (let i = 0; i < 60 * 60; i++) sim.step(1 / 60);
    expect(wet()).toBe(true);
    const live = sim.prey.filter((f) => f.alive);
    const meanX = live.reduce((s, f) => s + f.pos.x, 0) / live.length;
    expect(meanX - meanX0).toBeLessThan(15); // not all washed down to the end pool
    // the player drifts when idle
    const pl = sim.player()!;
    let x = 0;
    for (let i = 0; i < 400; i++) {
      x = w.centreZ(0);
      if (w.currentAt(i * 0.2 - 40, -0.3, w.centreZ(i * 0.2 - 40)).x > 0.3) {
        x = i * 0.2 - 40;
        break;
      }
    }
    pl.pos = { x, y: -0.3, z: w.centreZ(x) };
    pl.speed = 0;
    const x0 = pl.pos.x;
    for (let i = 0; i < 60; i++) {
      sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
      sim.step(1 / 60);
    }
    expect(pl.pos.x - x0).toBeGreaterThan(0.15);
  });
  it("keeps the river through a save round-trip", () => {
    const sim = new Simulation({ seed: 9, settings: { ...presetSettings("natural", "permadeath", defaultParams), map: "river" } });
    sim.addPlayer(30);
    const back = Simulation.fromState(JSON.parse(JSON.stringify(sim.toState())));
    expect(back.world.shape).toBe("river");
  });
});
