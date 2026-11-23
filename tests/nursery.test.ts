import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { weightG } from "../src/sim/biology";
import { EGG_LENGTH_CM, NURSERY_END_CM, ARCADE_GAIN, arcadeGain, gameGrow, nurseryGrow, placeInWeedBed, startLengthCm, yolkFrac } from "../src/sim/nursery";
import { Challenges } from "../src/game/challenges";

const eggSettings = (growthMul = 1) => ({ ...presetSettings("gentle", "permadeath", defaultParams), chill: true, big: true, startEgg: true, growthMul });

describe("egg start and nursery growth", () => {
  it("starts at the hatchling length only when asked", () => {
    expect(startLengthCm(eggSettings(), defaultParams)).toBe(EGG_LENGTH_CM);
    expect(startLengthCm({}, defaultParams)).toBe(defaultParams.pike.startLengthCm);
  });

  it("a later 'Start as' stage starts at its length; the larva wins over startCm", () => {
    expect(startLengthCm({ startCm: 40 }, defaultParams)).toBe(40);
    expect(startLengthCm({ startEgg: true, startCm: 40 }, defaultParams)).toBe(EGG_LENGTH_CM);
  });

  it("each catch grows a nursery pike, faster with the Growth option, capped at the nursery end", () => {
    const sim = new Simulation({ seed: 3, settings: eggSettings() });
    const a = sim.addPlayer(EGG_LENGTH_CM);
    const b = sim.addPlayer(EGG_LENGTH_CM);
    nurseryGrow(a, 0.5, 1, sim.p);
    nurseryGrow(b, 0.5, 3, sim.p);
    expect(a.lengthCm).toBeGreaterThan(EGG_LENGTH_CM);
    expect(b.lengthCm - EGG_LENGTH_CM).toBeCloseTo((a.lengthCm - EGG_LENGTH_CM) * 3, 6);
    expect(a.weight).toBeCloseTo(weightG(a.lengthCm, sim.p.pike.lengthWeight), 9);
    a.lengthCm = 21.9;
    nurseryGrow(a, 10, 8, sim.p);
    expect(a.lengthCm).toBe(NURSERY_END_CM);
    expect(nurseryGrow(a, 10, 8, sim.p)).toBe(false); // the biology model takes over
  });

  it("yolkFrac: full at hatching, linear to nothing at 2.5 cm", () => {
    expect(yolkFrac(1.2)).toBe(1);
    expect(yolkFrac(2.5)).toBe(0);
    expect(yolkFrac(1.85)).toBeCloseTo(0.5, 2);
    expect(yolkFrac(10)).toBe(0);
  });

  it("puts the egg in a shallow weed bed", () => {
    const sim = new Simulation({ seed: 3, settings: eggSettings() });
    const pl = sim.addPlayer(EGG_LENGTH_CM);
    expect(placeInWeedBed(sim.world, pl)).toBe(true);
    expect(sim.world.coverAt(pl.pos)).toBeGreaterThan(0);
    expect(sim.world.depthAt(pl.pos.x, pl.pos.z)).toBeLessThan(2.5);
  });

  it("keeps baby fish the hatchling can swallow close by, and it can catch and grow from them", () => {
    const sim = new Simulation({ seed: 3, settings: eggSettings(8) });
    const pl = sim.addPlayer(EGG_LENGTH_CM);
    sim.arcade = true;
    placeInWeedBed(sim.world, pl);
    sim.step(1 / 60);
    const babies = sim.prey.filter((f) => f.alive && f.lengthCm <= pl.lengthCm * 0.62);
    expect(babies.length).toBeGreaterThan(5);
    const near = Math.min(...babies.map((f) => Math.hypot(f.pos.x - pl.pos.x, f.pos.z - pl.pos.z)));
    expect(near).toBeLessThan(1.5);
    // aim straight at one in reach and strike until something is caught (odds are not 100%)
    const before = pl.lengthCm;
    for (let tries = 0; tries < 40 && pl.lengthCm === before; tries++) {
      const f = sim.prey.find((x) => x.alive && x.lengthCm <= pl.lengthCm * 0.62)!;
      f.vel = { x: 0, y: 0, z: 0 };
      pl.pos = { x: f.pos.x - 0.012, y: f.pos.y, z: f.pos.z };
      pl.yaw = 0;
      pl.pitch = 0;
      pl.burstCooldown = 0;
      pl.burstTimeLeft = 0; // one outcome per burst: start a fresh one each try
      sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
      for (let i = 0; i < 10; i++) sim.step(1 / 60);
      expect(sim.events.some((e) => e.type === "miss" && e.pikeId === pl.id && e.reason === "full")).toBe(false);
    }
    expect(pl.lengthCm).toBeGreaterThan(before);
  });

  it("goals a hatchling is too small for wait until it is big enough", () => {
    const c = new Challenges({ chill: true });
    for (let i = 0; i < 30; i++) {
      c.fit(2);
      expect(c.current.minPikeCm ?? 0).toBeLessThanOrEqual(2);
      c.index++;
    }
  });

  it("arcadeGain: scales with prey size, tapers above 50 cm, Growth multiplies", () => {
    expect(arcadeGain(30, 12)).toBeCloseTo(ARCADE_GAIN, 6);
    expect(arcadeGain(100, 40)).toBeCloseTo(ARCADE_GAIN / 2, 6);
    expect(arcadeGain(30, 12, 3)).toBeCloseTo(ARCADE_GAIN * 3, 6);
  });

  it("gameGrow: nursery behaviour under 22 cm, multiplicative length gain above, stomach untouched", () => {
    const sim = new Simulation({ seed: 3, settings: eggSettings() });
    const big = sim.addPlayer(30);
    big.stomachG = 5;
    gameGrow(big, 12, 1, sim.p);
    expect(big.lengthCm).toBeCloseTo(30 * (1 + ARCADE_GAIN), 6);
    expect(big.weight).toBeCloseTo(weightG(big.lengthCm, sim.p.pike.lengthWeight), 9);
    expect(big.stomachG).toBe(5);
    const a = sim.addPlayer(10);
    const b = sim.addPlayer(10);
    nurseryGrow(a, 4, 1, sim.p);
    gameGrow(b, 4, 1, sim.p);
    expect(b.lengthCm).toBe(a.lengthCm);
    expect(b.weight).toBe(a.weight);
  });
});
