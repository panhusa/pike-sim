import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";

const make = (arcade = true) => {
  const sim = new Simulation({ seed: 4, settings: presetSettings("gentle", "permadeath", defaultParams), startHour: 12 });
  sim.addPlayer(22);
  sim.arcade = arcade;
  return sim;
};

/** Point the player steeply up just under the surface over deep water and burst. */
function burstUp(sim: Simulation) {
  const pl = sim.player()!;
  pl.pos = { x: 0, y: -0.6, z: 0 };
  pl.yaw = 0;
  pl.pitch = 0.85;
  pl.burstCooldown = 0;
  pl.energy = 100;
  pl.lockId = null;
  let top = -Infinity;
  for (let i = 0; i < 180; i++) {
    sim.setInput(pl.id, { throttle: 1, yawRate: 0, pitchRate: 0, burst: i === 0 });
    sim.step(1 / 60);
    top = Math.max(top, pl.pos.y);
  }
  return top;
}

describe("leaping (game only)", () => {
  it("a fast nose-up rise breaks the surface, flies an arc and splashes back in", () => {
    const sim = make();
    const top = burstUp(sim);
    expect(top).toBeGreaterThan(0.25);
    const types = sim.events.map((e) => e.type);
    expect(types).toContain("leap");
    expect(types).toContain("splash");
    expect(sim.player()!.pos.y).toBeLessThan(0);
    expect(sim.airborne.size).toBe(0);
  });
  it("never happens in the realistic model", () => {
    const sim = make(false);
    expect(burstUp(sim)).toBeLessThanOrEqual(-0.09);
    expect(sim.events.some((e) => e.type === "leap")).toBe(false);
  });
  it("snaps a hovering mayfly in flight", () => {
    const sim = make();
    for (let i = 0; i < 60; i++) sim.step(1 / 60);
    sim.extras.insects.push({ id: 10_999_999, kind: "mayfly", pos: { x: 0, y: 0.25, z: 0 }, vel: { x: 0, y: 0, z: 0 }, life: 999, grams: 0.9, aloft: true });
    const fly = sim.extras.insects.at(-1)!;
    // keep the mayfly parked on the arc: put it where the pike's mouth will pass
    const pl = sim.player()!;
    pl.pos = { x: 0, y: -0.6, z: 0 };
    pl.yaw = 0;
    pl.pitch = 0.85;
    pl.burstCooldown = 0;
    pl.energy = 100;
    let caught = false;
    for (let i = 0; i < 180 && !caught; i++) {
      if (sim.airborne.has(pl.id)) {
        const a = sim.airborne.get(pl.id)!;
        const L = pl.lengthCm / 100;
        fly.pos = { x: pl.pos.x + a.vel.x * 0.05 + Math.cos(pl.pitch) * L * 0.5, y: pl.pos.y + a.vel.y * 0.05 + Math.sin(pl.pitch) * L * 0.5, z: pl.pos.z };
      }
      sim.setInput(pl.id, { throttle: 1, yawRate: 0, pitchRate: 0, burst: i === 0 });
      sim.step(1 / 60);
      caught = sim.events.some((e) => e.type === "capture" && e.kind === "insect" && e.preyId === fly.id);
    }
    expect(caught).toBe(true);
  });
});
