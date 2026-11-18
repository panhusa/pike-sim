import { describe, expect, it } from "vitest";
import { appetite, digestionRate, lengthCm, standardMetabolismW, tempFactor, weightG } from "../src/sim/biology";
import { v3 } from "../src/sim/math";
import { defaultParams as P } from "../src/sim/params";
import { makePike } from "../src/sim/pike";
import { feedAppetiteGated } from "./helpers";

describe("length-weight", () => {
  it("gives plausible pike weights", () => {
    const w60 = weightG(60, P.pike.lengthWeight);
    const w90 = weightG(90, P.pike.lengthWeight);
    expect(w60).toBeGreaterThan(1200);
    expect(w60).toBeLessThan(1700);
    expect(w90).toBeGreaterThan(4000);
    expect(w90).toBeLessThan(5500);
  });
  it("round-trips", () => {
    expect(lengthCm(weightG(47, P.pike.lengthWeight), P.pike.lengthWeight)).toBeCloseTo(47, 6);
  });
});

describe("temperature", () => {
  it("peaks at the optimum and collapses above max", () => {
    expect(tempFactor(20, P.metabolism)).toBeCloseTo(1, 6);
    expect(tempFactor(10, P.metabolism)).toBeLessThan(0.55);
    expect(tempFactor(29, P.metabolism)).toBeCloseTo(0, 6);
  });
  it("cold water means lower metabolism and slower digestion", () => {
    expect(standardMetabolismW(1000, 4, P.metabolism)).toBeLessThan(standardMetabolismW(1000, 18, P.metabolism));
    expect(digestionRate(4, P.pike.digestionHalfLifeH)).toBeLessThan(digestionRate(18, P.pike.digestionHalfLifeH));
  });
});

describe("appetite", () => {
  it("is high when hungry and warm, near zero when full or freezing", () => {
    expect(appetite(0.05, 16)).toBeGreaterThan(0.8);
    expect(appetite(0.95, 16)).toBeLessThan(0.1);
    expect(appetite(0.05, 1)).toBeLessThan(0.1);
  });
});

describe("calibration against published pike growth", () => {
  const maxFedGrowthPctPerDay = (lengthCmStart: number, tempC: number, days: number): number => {
    const s = makePike(1, v3(0, -2, 0), lengthCmStart, P);
    const w0 = s.weight;
    feedAppetiteGated(s, tempC, days, P);
    return (Math.log(s.weight / w0) / days) * 100;
  };

  it("a permanently full 60 cm pike at 10 C grows well under 1.5 %/day", () => {
    const g = maxFedGrowthPctPerDay(60, 10, 20);
    expect(g).toBeGreaterThan(0.2);
    expect(g).toBeLessThan(1.5);
  });
  it("growth peaks in warm water and stops in near-freezing water", () => {
    expect(maxFedGrowthPctPerDay(40, 18, 10)).toBeGreaterThan(maxFedGrowthPctPerDay(40, 6, 10));
    expect(maxFedGrowthPctPerDay(40, 2, 10)).toBeLessThan(0.4);
  });
  it("small pike grow faster in relative terms than big ones", () => {
    expect(maxFedGrowthPctPerDay(25, 16, 10)).toBeGreaterThan(maxFedGrowthPctPerDay(80, 16, 10));
  });
});
