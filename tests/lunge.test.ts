import { describe, expect, it } from "vitest";
import { angleDiff, v3, Rng, type Vec3 } from "../src/sim/math";
import { lungeCandidate, lungeRange, lungeTargets } from "../src/sim/lunge";
import { spawnPrey } from "../src/sim/prey";
import { Simulation } from "../src/sim/simulation";
import type { PreyKind } from "../src/sim/params";

function setup() {
  const sim = new Simulation({ seed: 1 });
  sim.prey = [];
  sim.pikes = [];
  const pk = sim.addPlayer(30);
  pk.yaw = 0;
  pk.pitch = 0;
  pk.speed = 0;
  return { sim, pk };
}

/** Place a still fish at `dist` m from the pike centre, `bearing` rad off its heading (horizontal). */
function fish(sim: Simulation, base: Vec3, dist: number, bearing: number, lengthCm: number, id: number, kind: PreyKind = "roach") {
  const pos = v3(base.x + Math.cos(bearing) * dist, base.y, base.z + Math.sin(bearing) * dist);
  const f = spawnPrey(id, kind, 0, pos, lengthCm, sim.p, new Rng(id));
  f.vel = v3(0, 0, 0);
  sim.prey.push(f);
  return f;
}

describe("lunge target ranking", () => {
  it("picks an edible fish ahead within lunge range", () => {
    const { sim, pk } = setup();
    const f = fish(sim, pk.pos, 0.5, 0, 12, 1001);
    const c = lungeCandidate(sim, pk);
    expect(c?.id).toBe(f.id);
    expect(c?.inRange).toBe(true);
    expect(c?.inCone).toBe(true);
    expect(c?.edible).toBe(true);
  });

  it("rejects fish too big to swallow but still lists them", () => {
    const { sim, pk } = setup();
    const f = fish(sim, pk.pos, 0.5, 0, 20, 1001);
    expect(lungeCandidate(sim, pk)).toBeNull();
    expect(lungeTargets(sim, pk).find((t) => t.id === f.id)?.edible).toBe(false);
  });

  it("rejects fish outside the cone", () => {
    const { sim, pk } = setup();
    fish(sim, pk.pos, 0.5, 1.2, 12, 1001);
    expect(lungeCandidate(sim, pk)).toBeNull();
  });

  it("rejects fish beyond lunge range", () => {
    const { sim, pk } = setup();
    const f = fish(sim, pk.pos, 1.2, 0, 12, 1001);
    expect(lungeCandidate(sim, pk)).toBeNull();
    expect(lungeTargets(sim, pk).find((t) => t.id === f.id)?.inRange).toBe(false);
  });

  it("a small pike still reaches lungeMinRangeM from its mouth", () => {
    const { sim, pk } = setup();
    pk.lengthCm = 22;
    const L = pk.lengthCm / 100;
    const range = Math.max(sim.p.pike.lungeRangeBL * L, sim.p.pike.lungeMinRangeM);
    expect(range).toBeGreaterThan(sim.p.pike.lungeRangeBL * L);
    expect(lungeRange(pk, sim.p)).toBeCloseTo(range);
    const f = fish(sim, pk.pos, L * 0.5 + range - 0.05, 0, 10, 1001);
    expect(lungeCandidate(sim, pk)?.id).toBe(f.id);
    const g = fish(sim, pk.pos, L * 0.5 + range + 0.05, 0, 10, 1002);
    sim.prey = [g];
    expect(lungeCandidate(sim, pk)).toBeNull();
  });

  it("lists only sensed targets", () => {
    const { sim, pk } = setup();
    fish(sim, pk.pos, 0.5, Math.PI, 12, 1001);
    expect(lungeTargets(sim, pk)).toEqual([]);
  });

  it("orders candidates by alignment and distance", () => {
    const { sim, pk } = setup();
    const L = pk.lengthCm / 100;
    const mouth = v3(pk.pos.x + L * 0.5, pk.pos.y, pk.pos.z); // yaw 0, pitch 0
    // Decoy inserted first: closer to the mouth but more off-axis; both inside cone and range.
    const decoy = fish(sim, mouth, 0.15, 0.55, 12, 1002);
    const ahead = fish(sim, mouth, 0.3, 0, 12, 1001);
    const ts = lungeTargets(sim, pk);
    expect(ts.map((t) => t.id)).toEqual([ahead.id, decoy.id]);
    expect(ts.every((t) => t.inCone && t.inRange && t.edible)).toBe(true);
    expect(ts[1]!.distance).toBeLessThan(ts[0]!.distance);
    expect(lungeCandidate(sim, pk)?.id).toBe(ahead.id);
  });
});

describe("committed lunge", () => {
  const on = { throttle: 0, yawRate: -1, pitchRate: 0, burst: true };
  const off = { ...on, burst: false };

  it("a locked lunge homes on a fish off the nose and ignores steering input", () => {
    const { sim, pk } = setup();
    const f = fish(sim, pk.pos, 0.6, 0.35, 12, 1001);
    sim.setInput(pk.id, on);
    sim.step(1 / 60);
    expect(pk.lockId).toBe(f.id);
    expect(sim.events.find((e) => e.type === "strike" && e.pikeId === pk.id)).toMatchObject({ lockId: f.id });
    sim.setInput(pk.id, off);
    for (let i = 0; i < 6; i++) sim.step(1 / 60);
    expect(angleDiff(pk.yaw, 0)).toBeGreaterThan(0.1);
  });

  it("pitches toward a target above", () => {
    const { sim, pk } = setup();
    // 0.5 m ahead of the mouth (centre + 0.15 m) and 0.3 m up: inside the 0.6 rad cone
    const f = fish(sim, pk.pos, 0.65, 0, 12, 1001);
    f.pos.y += 0.3;
    sim.setInput(pk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    sim.step(1 / 60);
    sim.setInput(pk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
    for (let i = 0; i < 5; i++) sim.step(1 / 60);
    expect(pk.pitch).toBeGreaterThan(0.05);
    expect(Math.abs(pk.pitch)).toBeLessThanOrEqual(0.9);
  });

  it("clears the lock when the target dies and keeps bursting straight", () => {
    const { sim, pk } = setup();
    const f = fish(sim, pk.pos, 0.6, 0.2, 12, 1001);
    sim.setInput(pk.id, on);
    sim.step(1 / 60);
    expect(pk.lockId).toBe(f.id);
    f.alive = false;
    sim.setInput(pk.id, off);
    sim.step(1 / 60);
    expect(pk.lockId).toBeNull();
    expect(pk.burstTimeLeft).toBeGreaterThan(0);
    expect(Number.isFinite(pk.yaw)).toBe(true);
    expect(Number.isFinite(pk.pitch)).toBe(true);
  });

  it("an empty burst emits one strike-empty", () => {
    const { sim, pk } = setup();
    sim.setInput(pk.id, on);
    sim.step(1 / 60);
    sim.setInput(pk.id, off);
    for (let i = 0; i < 120; i++) sim.step(1 / 60);
    expect(sim.events.filter((e) => e.type === "strike-empty" && e.pikeId === pk.id)).toHaveLength(1);
    expect(sim.events.filter((e) => e.type === "miss")).toHaveLength(0);
  });

  it("a rival burst uses the same lock", () => {
    const { sim } = setup();
    const rv = sim.addPike(40, v3(5, -1, 5));
    rv.yaw = 0;
    rv.pitch = 0;
    rv.speed = 0;
    const f = fish(sim, rv.pos, 0.5, 0, 12, 1001);
    sim.setInput(rv.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    sim.step(1 / 60);
    expect(rv.lockId).toBe(f.id);
  });

  it("a held burst re-locks and homes when the cooldown expires", () => {
    const { sim, pk } = setup();
    sim.setInput(pk.id, on);
    for (let i = 0; i < 140; i++) sim.step(1 / 60); // first burst (empty), then cooldown nearly over
    expect(pk.burstCooldown).toBeGreaterThan(0);
    pk.yaw = 0;
    pk.pitch = 0;
    pk.speed = 0;
    const f = fish(sim, pk.pos, 0.6, 0.35, 12, 1002);
    sim.setInput(pk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    let locked = false;
    for (let i = 0; i < 200 && !locked; i++) {
      sim.step(1 / 60);
      locked = pk.lockId === f.id;
    }
    expect(locked).toBe(true);
    expect(pk.burstTimeLeft).toBeGreaterThan(0);
  });

  it("clears the lock after a capture ends the burst", () => {
    const { sim, pk } = setup();
    fish(sim, pk.pos, 0.6, 0.2, 12, 1001);
    sim.setInput(pk.id, on);
    sim.step(1 / 60);
    sim.setInput(pk.id, off);
    for (let i = 0; i < 30; i++) sim.step(1 / 60);
    expect(sim.events.some((e) => e.type === "capture" || e.type === "miss")).toBe(true);
    expect(pk.burstTimeLeft).toBe(0);
    expect(pk.lockId).toBeNull();
  });

  it("a Stage 2 state without lockId loads", () => {
    const { sim } = setup();
    sim.addPike(40);
    const st = sim.toState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of st.pikes) delete (p as any).lockId;
    const loaded = Simulation.fromState(st);
    expect(loaded.pikes.length).toBeGreaterThan(0);
    for (const p of loaded.pikes) expect(p.lockId).toBeNull();
  });
});
