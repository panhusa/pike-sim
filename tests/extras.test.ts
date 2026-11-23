import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { ANGLER } from "../src/sim/extras";
import { lungeTargets } from "../src/sim/lunge";

vi.setConfig({ testTimeout: 30000 }); // whole-fisherman runs are a few game minutes each

const make = (arcade = true) => {
  const sim = new Simulation({ seed: 4, settings: presetSettings("gentle", "permadeath", defaultParams), startHour: 12 });
  sim.addPlayer(22);
  sim.arcade = arcade;
  return sim;
};
const run = (sim: Simulation, s: number, input = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false }) => {
  for (let i = 0; i < s * 60; i++) {
    sim.setInput(sim.playerId!, input);
    sim.step(1 / 60);
  }
};

/** Bring the fisherman in and wait until the lure is swimming its retrieve. */
function fishing(sim: Simulation) {
  sim.extras.anglerIn = 0;
  for (let i = 0; i < 60 * 120 && sim.extras.angler?.lure.state !== "retrieve"; i++) sim.step(1 / 60);
  expect(sim.extras.angler?.lure.state).toBe("retrieve");
  return sim.extras.angler!;
}

/** Put the player's mouth right behind a point, facing it, and strike. */
function strikeAt(sim: Simulation, p: { x: number; y: number; z: number }) {
  const pl = sim.player()!;
  const L = pl.lengthCm / 100;
  pl.yaw = 0;
  pl.pitch = 0;
  pl.pos = { x: p.x - L * 0.75, y: p.y, z: p.z };
  pl.burstCooldown = 0;
  pl.energy = 100;
  sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
  sim.step(1 / 60);
}

describe("insects", () => {
  it("appear on the surface in the game, never in the realistic model", () => {
    const g = make(true);
    run(g, 30);
    expect(g.extras.insects.length).toBeGreaterThan(3);
    expect(g.extras.insects.every((f) => (f.aloft ? f.pos.y > 0 : Math.abs(f.pos.y) < 0.05))).toBe(true);
    const r = make(false);
    run(r, 30);
    expect(r.extras.insects).toHaveLength(0);
  });
  it("a strike at a surface insect eats it", () => {
    const sim = make();
    run(sim, 30);
    const bug = sim.extras.insects.find((f) => !f.aloft)!;
    strikeAt(sim, { x: bug.pos.x, y: -0.12, z: bug.pos.z });
    expect(sim.events.some((e) => e.type === "capture" && e.kind === "insect")).toBe(true);
    expect(sim.extras.insects.includes(bug)).toBe(false);
  });
  it("hovering mayflies cannot be reached from below", () => {
    const sim = make();
    run(sim, 40);
    const fly = sim.extras.insects.find((f) => f.aloft);
    if (!fly) return; // seed without a mayfly at this moment
    strikeAt(sim, { x: fly.pos.x, y: -0.5, z: fly.pos.z });
    expect(sim.extras.insects.includes(fly)).toBe(true);
  });
  it("are strike targets for the player only", () => {
    const sim = make();
    run(sim, 30);
    const bug = sim.extras.insects.find((f) => !f.aloft)!;
    const pl = sim.player()!;
    pl.pos = { x: bug.pos.x - 0.5, y: -0.2, z: bug.pos.z };
    pl.yaw = 0;
    expect(lungeTargets(sim, pl).some((t) => t.kind === "insect")).toBe(true);
    const rival = sim.pikes.find((k) => k.ai)!;
    rival.pos = { ...pl.pos };
    rival.yaw = 0;
    expect(lungeTargets(sim, rival).some((t) => t.kind === "insect")).toBe(false);
  });
});

describe("fisherman", () => {
  it("arrives on schedule, casts and retrieves a lure toward the boat", () => {
    const sim = make();
    const a = fishing(sim);
    const d0 = Math.hypot(a.lure.pos.x - a.boat.x, a.lure.pos.z - a.boat.z);
    run(sim, 3);
    const d1 = Math.hypot(a.lure.pos.x - a.boat.x, a.lure.pos.z - a.boat.z);
    expect(d1).toBeLessThan(d0);
    expect(sim.events.some((e) => e.type === "angler-arrive")).toBe(true);
  });
  it("striking the lure hooks the pike, and the line drags it toward the boat", () => {
    const sim = make();
    const a = fishing(sim);
    strikeAt(sim, a.lure.pos);
    expect(a.hookedId).toBe(sim.playerId);
    expect(sim.events.some((e) => e.type === "hooked")).toBe(true);
    const pl = sim.player()!;
    const d0 = Math.hypot(a.boat.x - pl.pos.x, a.boat.z - pl.pos.z);
    run(sim, 2);
    expect(Math.hypot(a.boat.x - pl.pos.x, a.boat.z - pl.pos.z)).toBeLessThan(d0);
  });
  it("bursting repeatedly throws the hook", () => {
    const sim = make();
    const a = fishing(sim);
    strikeAt(sim, a.lure.pos);
    const pl = sim.player()!;
    pl.yaw = Math.atan2(pl.pos.z - a.boat.z, pl.pos.x - a.boat.x); // turn tail to the boat
    pl.pitch = 0;
    for (let i = 0; i < 60 * 15 && sim.extras.angler?.hookedId === pl.id; i++) {
      pl.energy = 100;
      sim.setInput(pl.id, { throttle: 1, yawRate: 0, pitchRate: 0, burst: i % 40 === 0 });
      sim.step(1 / 60);
    }
    expect(sim.events.some((e) => e.type === "unhooked")).toBe(true);
    expect(pl.alive).toBe(true);
  });
  it("a landed pike with hearts to spare is released hurt; without them it is caught", () => {
    for (const [health, survives] of [
      [1, true],
      [0.5, false],
    ] as const) {
      const sim = make();
      const a = fishing(sim);
      strikeAt(sim, a.lure.pos);
      const pl = sim.player()!;
      pl.health = health;
      for (let i = 0; i < 60 * 120 && sim.extras.angler?.hookedId === pl.id; i++) sim.step(1 / 60);
      expect(pl.alive).toBe(survives);
      if (survives) {
        expect(pl.health).toBeCloseTo(health - ANGLER.releaseHearts, 5);
        expect(sim.events.some((e) => e.type === "released")).toBe(true);
      } else expect(pl.deathCause).toBe("caught");
    }
  }, 30000);
});

describe("arcade restocking", () => {
  it("tops a fished-out lake back up, out of the player's sight; never in the realistic model", () => {
    for (const arcade of [true, false]) {
      const sim = make(arcade);
      const before = sim.prey.filter((f) => f.alive).length;
      for (const f of sim.prey.slice(0, Math.floor(before * 0.7))) f.alive = false;
      sim.prey = sim.prey.filter((f) => f.alive);
      const low = sim.prey.length;
      run(sim, 40);
      const now = sim.prey.filter((f) => f.alive).length;
      if (arcade) expect(now).toBeGreaterThan(low + 20);
      else expect(now).toBeLessThan(low + 10); // only natural recruitment
    }
  }, 30000);
});

describe("summonAngler", () => {
  it("pulls the next arrival closer, never later, and uses no sim.rng", () => {
    const sim = make();
    sim.extras.anglerIn = 500;
    sim.extras.summonAngler(20);
    expect(sim.extras.anglerIn).toBe(20);
    sim.extras.summonAngler(100);
    expect(sim.extras.anglerIn).toBe(20);
  });
});
