import { describe, expect, it, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { FROG } from "../src/sim/extras";
import { packExtras, packPrey, parseHostMsg, unpackExtras, unpackPrey } from "../src/net/protocol";
import { CHALLENGES, isFish } from "../src/game/challenges";

vi.setConfig({ testTimeout: 60000 });

const make = (opts: { arcade: boolean; chill?: boolean; len?: number }) => {
  const sim = new Simulation({ seed: 4, settings: { ...presetSettings("gentle", "permadeath", defaultParams), chill: opts.chill === true }, startHour: 12 });
  sim.addPlayer(opts.len ?? 22);
  sim.arcade = opts.arcade;
  return sim;
};
const run = (sim: Simulation, s: number) => {
  for (let i = 0; i < s * 60; i++) sim.step(1 / 60);
};
const kinds = (sim: Simulation) => new Set(sim.prey.map((f) => f.kind));

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

describe("bream and tench", () => {
  it("are arcade-only species in the params", () => {
    expect((defaultParams.prey.bream as { arcadeOnly?: boolean }).arcadeOnly).toBe(true);
    expect((defaultParams.prey.tench as { arcadeOnly?: boolean }).arcadeOnly).toBe(true);
    expect(defaultParams.prey.bream.lengthCm).toEqual([20, 45]);
    expect(defaultParams.prey.tench.lengthCm).toEqual([15, 40]);
  });
  it("never enter the realistic model: no stocking, no recruitment", () => {
    const sim = new Simulation({ seed: 3 });
    expect(kinds(sim).has("bream" as never)).toBe(false);
    run(sim, 120);
    expect([...kinds(sim)].every((k) => k === "roach" || k === "perch" || k === "rudd")).toBe(true);
  });
  it("arrive in the arcade lake through restock", () => {
    const sim = make({ arcade: true });
    run(sim, 60);
    expect(kinds(sim).has("bream")).toBe(true);
    expect(kinds(sim).has("tench")).toBe(true);
    for (const f of sim.prey.filter((x) => x.kind === "bream")) expect(f.lengthCm).toBeGreaterThanOrEqual(20);
  });
  it("survive the wire: kinds round-trip in a prey snapshot", () => {
    const sim = make({ arcade: true });
    run(sim, 60);
    const back = unpackPrey(packPrey(sim.prey));
    expect(back.some((f) => f.kind === "bream")).toBe(true);
    expect(back.some((f) => f.kind === "tench")).toBe(true);
  });
});

describe("frogs", () => {
  it("live only in the game, in shallow water at the surface", () => {
    const r = make({ arcade: false });
    run(r, 30);
    expect(r.extras.frogs).toHaveLength(0);
    const g = make({ arcade: true });
    run(g, 40);
    expect(g.extras.frogs.length).toBeGreaterThan(0);
    for (const f of g.extras.frogs) {
      expect(g.world.inWater(f.pos.x, f.pos.z)).toBe(true);
      expect(g.world.depthAt(f.pos.x, f.pos.z)).toBeLessThan(1.5);
    }
  });
  it("a 20 cm pike striking a frog in reach catches it", () => {
    const sim = make({ arcade: true, len: 20 });
    run(sim, 40);
    sim.extras.insects = [];
    const frog = sim.extras.frogs.find((f) => f.alive)!;
    strikeAt(sim, { x: frog.pos.x, y: frog.pos.y, z: frog.pos.z });
    const cap = sim.events.find((e) => e.type === "capture" && e.kind === "frog");
    expect(cap).toMatchObject({ grams: FROG.grams, lengthCm: FROG.lengthCm });
    expect(sim.extras.frogs.includes(frog)).toBe(false);
  });
  it("a 10 cm pike cannot swallow one", () => {
    const sim = make({ arcade: true, len: 10 });
    run(sim, 40);
    sim.extras.insects = [];
    const frog = sim.extras.frogs.find((f) => f.alive)!;
    strikeAt(sim, { x: frog.pos.x, y: frog.pos.y, z: frog.pos.z });
    expect(sim.events.some((e) => e.type === "capture" && e.kind === "frog")).toBe(false);
    expect(sim.extras.frogs.includes(frog)).toBe(true);
  });
  it("dive when a pike creeps close, and come back up", () => {
    const sim = make({ arcade: true, len: 30 });
    run(sim, 40);
    const frog = sim.extras.frogs.find((f) => f.alive)!;
    const pl = sim.player()!;
    pl.pos = { x: frog.pos.x + 0.4, y: -0.2, z: frog.pos.z };
    sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
    sim.step(1 / 60);
    expect(frog.pos.y).toBeLessThan(-0.2);
    pl.pos = { x: frog.pos.x + 20, y: -0.5, z: frog.pos.z };
    run(sim, FROG.resurfaceS + 1);
    expect(frog.pos.y).toBeGreaterThan(-0.1);
  });
  it("reach a chill guest in the extras snapshot", () => {
    const sim = make({ arcade: true, chill: true });
    run(sim, 40);
    expect(sim.chill).toBe(true);
    const wire = JSON.parse(JSON.stringify({ t: "snap", time: 1, pikes: [], players: [], prey: new ArrayBuffer(0), extras: packExtras(sim.extras.insects, sim.extras.angler, sim.extras.frogs) }));
    const m = parseHostMsg(wire);
    expect(m && m.t === "snap").toBe(true);
    const ex = unpackExtras(m && m.t === "snap" ? m.extras : null)!;
    expect(ex.frogs.length).toBe(sim.extras.frogs.length);
    expect(ex.frogs[0]!.pos.x).toBeCloseTo(sim.extras.frogs[0]!.pos.x, 1);
    // an older host sends no frogs: still fine
    expect(unpackExtras({ insects: [], angler: null })!.frogs).toEqual([]);
  });
});

describe("goals", () => {
  it("add a frog and a bream goal; a frog is not a fish", () => {
    expect(CHALLENGES.find((c) => c.id === "catch-frog-1")).toMatchObject({ text: "Catch a frog", minPikeCm: 14, bonus: 700 });
    expect(CHALLENGES.find((c) => c.id === "catch-bream-1")).toMatchObject({ text: "Catch a bream", minPikeCm: 45, bonus: 900 });
    expect(isFish({ type: "catch", kind: "frog", lengthCm: 7, t: 0 })).toBe(false);
    expect(isFish({ type: "catch", kind: "bream", lengthCm: 30, t: 0 })).toBe(true);
  });
});
