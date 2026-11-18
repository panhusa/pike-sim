import { describe, expect, it } from "vitest";
import { AdaptiveResolution, MAX_STEPS_PER_FRAME, stepPlan } from "../src/ui/frameBudget";

describe("stepPlan", () => {
  it("runs one 60 Hz step per frame at 60 fps", () => {
    const { steps, dt } = stepPlan(1 / 60, 1);
    expect(steps).toBe(1);
    expect(dt).toBeCloseTo(1 / 60);
  });
  it("caps steps on a slow frame and stretches dt instead (no lag spiral)", () => {
    const { steps, dt } = stepPlan(0.1, 1);
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(steps * dt).toBeCloseTo(0.1); // game time still keeps pace with wall time
  });
  it("keeps the debug time-scale path at 4 steps", () => {
    expect(stepPlan(1 / 60, 8).steps).toBe(4);
  });
});

describe("AdaptiveResolution", () => {
  const run = (a: AdaptiveResolution, dt: number, seconds: number): (number | null)[] => {
    const out: (number | null)[] = [];
    for (let t = 0; t < seconds; t += dt) out.push(a.frame(dt));
    return out;
  };
  it("leaves resolution alone at 60 fps", () => {
    const a = new AdaptiveResolution(2);
    expect(run(a, 1 / 60, 10).every((r) => r === null)).toBe(true);
    expect(a.ratio).toBe(2);
  });
  it("steps down while slow, never below the floor", () => {
    const a = new AdaptiveResolution(2);
    run(a, 1 / 20, 60);
    expect(a.ratio).toBe(AdaptiveResolution.MIN_RATIO);
  });
  it("ignores a single long frame inside a fast window", () => {
    const a = new AdaptiveResolution(2);
    a.frame(0.1);
    run(a, 1 / 60, 4);
    expect(a.ratio).toBe(2);
  });
});
