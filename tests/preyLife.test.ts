import { describe, expect, it } from "vitest";
import { weightG } from "../src/sim/biology";
import { Rng, v3 } from "../src/sim/math";
import { defaultParams as P } from "../src/sim/params";
import { spawnPrey } from "../src/sim/prey";
import { growPreyDay, preyMortalityDay } from "../src/sim/preyLife";

const mk = (id: number, len: number, rng = new Rng(1)) => spawnPrey(id, "roach", 0, v3(), len, P, rng);

describe("prey life", () => {
  it("grows toward but never past max", () => {
    const f = mk(1, 10);
    for (let i = 0; i < 200; i++) growPreyDay(f, 18, P);
    expect(f.lengthCm).toBeGreaterThan(10);
    expect(f.lengthCm).toBeLessThan(35);
    expect(f.weight).toBeCloseTo(weightG(f.lengthCm, P.prey.roach.lengthWeight), 9);
  });
  it("no growth in cold water", () => {
    const f = mk(1, 10);
    for (let i = 0; i < 30; i++) growPreyDay(f, 5, P);
    expect(f.lengthCm).toBe(10);
  });
  it("ages", () => {
    const f = mk(1, 10);
    expect(f.ageDays).toBe(0);
    growPreyDay(f, 5, P);
    expect(f.ageDays).toBe(1);
    growPreyDay(f, 18, P);
    expect(f.ageDays).toBe(2);
  });
  it("mortality rate", () => {
    const rng = new Rng(7);
    const fish = Array.from({ length: 1000 }, (_, i) => mk(i, 12, rng));
    let dead = 0;
    for (let d = 0; d < 365; d++) dead += preyMortalityDay(fish, rng, P);
    const alive = fish.filter((f) => f.alive).length;
    expect(dead).toBe(1000 - alive);
    expect(alive / 1000).toBeGreaterThan(0.52);
    expect(alive / 1000).toBeLessThan(0.64);
  });
});
