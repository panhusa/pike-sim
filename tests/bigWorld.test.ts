import { describe, expect, it } from "vitest";
import { arcadeParams, Simulation } from "../src/sim/simulation";
import { defaultParams } from "../src/sim/params";
import { presetSettings } from "../src/sim/settings";
import { BIG, World } from "../src/sim/world";
import { PLAYER_AIM_S } from "../src/sim/lunge";
import { Rng, v3 } from "../src/sim/math";
import { spawnPrey } from "../src/sim/prey";

describe("game-size water (settings.big)", () => {
  it("is off by default: the small lake and river are unchanged", () => {
    expect(new World(defaultParams.world, 5).size).toBe(defaultParams.world.size);
    expect(new World(defaultParams.world, 5).reeds.length).toBe(140);
    expect(new World(defaultParams.world, 5, "river").size).toBeCloseTo(defaultParams.world.size * 1.6);
  });

  it("makes the lake wider with denser plant beds", () => {
    const small = new World(defaultParams.world, 5);
    const big = new World(defaultParams.world, 5, "lake", true);
    expect(big.size).toBeCloseTo(small.size * BIG.lakeMul);
    const density = (w: World) => (w.reeds.length + w.weeds.length) / (w.size * w.size);
    expect(density(big)).toBeGreaterThan(density(small) * 1.8);
  });

  it("makes the river longer, same width, with more beds", () => {
    const small = new World(defaultParams.world, 5, "river");
    const big = new World(defaultParams.world, 5, "river", true);
    expect(big.size).toBeCloseTo(small.size * BIG.riverLenMul);
    expect(big.halfWidth(0)).toBeCloseTo(small.halfWidth(0));
    expect(big.inWater(big.size * 0.4, big.centreZ(big.size * 0.4))).toBe(true);
    expect(big.reeds.length + big.weeds.length).toBeGreaterThan((small.reeds.length + small.weeds.length) * 3);
  });

  it("stocks more fish in the bigger water", () => {
    const base = presetSettings("gentle", "permadeath", defaultParams);
    const small = new Simulation({ seed: 2, settings: base });
    const big = new Simulation({ seed: 2, settings: { ...base, big: true } });
    expect(big.prey.length).toBeGreaterThan(small.prey.length * 2);
  });
});

describe("Growth option (settings.growthMul)", () => {
  it("multiplies the player's growth efficiency", () => {
    expect(arcadeParams(defaultParams, 3).metabolism.growthEfficiency).toBeCloseTo(arcadeParams(defaultParams).metabolism.growthEfficiency * 3);
    const sim = new Simulation({ seed: 2, settings: { ...presetSettings("gentle", "permadeath", defaultParams), growthMul: 8 } });
    const pl = sim.addPlayer(22);
    sim.arcade = true;
    expect(sim.paramsFor(pl).metabolism.growthEfficiency).toBeCloseTo(arcadeParams(defaultParams).metabolism.growthEfficiency * 8);
  });
});

describe("player lunge steering", () => {
  it("aims only briefly, then runs straight even if the fish dodges", () => {
    const sim = new Simulation({ seed: 1 });
    sim.prey = [];
    sim.pikes = [];
    sim.arcade = true;
    const pk = sim.addPlayer(30);
    pk.pos = v3(0, -2, 0);
    pk.yaw = 0;
    pk.pitch = 0;
    const f = spawnPrey(900, "roach", 0, v3(0.9, -2, 0.1), 8, sim.p, new Rng(9));
    f.vel = v3(0, 0, 0);
    sim.prey.push(f);
    sim.setInput(pk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    const dt = 1 / 60;
    sim.step(dt);
    expect(pk.lockId).toBe(900);
    sim.setInput(pk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
    // the fish teleports far to the side right after the aim window: the pike must not swing after it
    for (let t = dt; t < PLAYER_AIM_S + 0.05; t += dt) sim.step(dt);
    const yawAfterAim = pk.yaw;
    if (f.alive) f.pos = v3(pk.pos.x, -2, pk.pos.z + 1.2);
    for (let i = 0; i < 30; i++) sim.step(dt);
    expect(Math.abs(pk.yaw - yawAfterAim)).toBeLessThan(0.02);
  });
});
