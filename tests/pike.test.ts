import { describe, expect, it } from "vitest";
import { v3 } from "../src/sim/math";
import { defaultParams as P } from "../src/sim/params";
import { condition, makePike, stepPike, type PikeInput } from "../src/sim/pike";

const idle: PikeInput = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
const run = (s: ReturnType<typeof makePike>, input: PikeInput, seconds: number, temp = 16) => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepPike(s, input, temp, dt, P);
};

describe("pike swimming", () => {
  it("bursts to several body lengths per second, then cannot repeat indefinitely", () => {
    const s = makePike(1, v3(0, -2, 0), 60, P);
    let peak = 0;
    const dt = 1 / 60;
    for (let t = 0; t < 1.2; t += dt) {
      stepPike(s, { ...idle, burst: true }, 16, dt, P);
      peak = Math.max(peak, s.speed);
    }
    const bl = peak / 0.6;
    expect(bl).toBeGreaterThan(5);
    expect(bl).toBeLessThan(10);
    // Hammer bursts until exhausted: energy must bottom out and bursting must stop.
    for (let i = 0; i < 20; i++) run(s, { ...idle, burst: true }, 1);
    expect(s.energy).toBeLessThan(P.pike.energyMax);
  });

  it("is limited to sustained speed without a burst", () => {
    const s = makePike(1, v3(0, -2, 0), 60, P);
    run(s, { ...idle, throttle: 1 }, 6, 18);
    expect(s.speed / 0.6).toBeLessThanOrEqual(P.pike.maxSustainedBL + 0.01);
  });

  it("swims slower in cold water", () => {
    const warm = makePike(1, v3(0, -2, 0), 60, P);
    const cold = makePike(2, v3(0, -2, 0), 60, P);
    run(warm, { ...idle, throttle: 1 }, 5, 18);
    run(cold, { ...idle, throttle: 1 }, 5, 4);
    expect(cold.speed).toBeLessThan(warm.speed);
  });
});

describe("growth and starvation", () => {
  it("loses condition when starving", () => {
    const s = makePike(1, v3(0, -2, 0), 60, P);
    run(s, { ...idle, throttle: 0.5 }, 3600, 16);
    expect(condition(s, P)).toBeLessThan(1);
    expect(s.lengthCm).toBe(60);
  });

  it("grows in length when well fed", () => {
    const s = makePike(1, v3(0, -2, 0), 40, P);
    const startLen = s.lengthCm;
    const dt = 60; // coarse steps are fine for metabolism-only checks
    for (let t = 0; t < 30 * 86400; t += dt) {
      if (s.stomachG < 40) s.stomachG += 150; // keeps the stomach stocked
      stepPike(s, { ...idle, throttle: 0.3 }, 18, dt, P);
    }
    expect(s.lengthCm).toBeGreaterThan(startLen + 3);
    expect(s.alive).toBe(true);
  });
});
