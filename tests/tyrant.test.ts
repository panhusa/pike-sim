import { describe, expect, it } from "vitest";
import { ARCADE_BITE, Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { forward } from "../src/sim/math";
import type { PikeState } from "../src/sim/pike";
import { TYRANT } from "../src/sim/tyrant";
import { parseHostMsg } from "../src/net/protocol";
import { TyrantCaller } from "../src/game/tyrantCall";

const DT = 1 / 60;

function setup(chill = false, len = 40, arcade = true) {
  const sim = new Simulation({ seed: 5, settings: { ...presetSettings("gentle", "permadeath", defaultParams), chill } });
  const pl = sim.addPlayer(len);
  sim.arcade = arcade;
  return { sim, pl };
}

/** Hold the tyrant broadside just ahead of the player's mouth. */
function faceOff(pl: PikeState, ty: PikeState): void {
  const L = pl.lengthCm / 100;
  const f = forward(pl.yaw, pl.pitch);
  ty.pos = { x: pl.pos.x + f.x * (L * 0.5 + 0.05), y: pl.pos.y, z: pl.pos.z + f.z * (L * 0.5 + 0.05) };
  ty.yaw = pl.yaw + Math.PI / 2;
  ty.pitch = 0;
  ty.speed = 0;
  ty.burstTimeLeft = 0;
  ty.burstCooldown = 5;
}

/** One fresh player burst with the tyrant in reach for `steps` ticks. */
function strike(sim: Simulation, pl: PikeState, ty: PikeState, steps = 3): void {
  pl.burstTimeLeft = 0;
  pl.burstCooldown = 0;
  pl.energy = sim.paramsFor(pl).pike.energyMax;
  pl.pitch = 0;
  for (let i = 0; i < steps; i++) {
    faceOff(pl, ty);
    sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    sim.step(DT);
  }
  sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
}

/** Tyrant charging the still player from just behind. */
function charge(sim: Simulation, pl: PikeState, ty: PikeState): void {
  const t = sim.tyrant!;
  t.phase = "charge";
  t.phaseT = 0;
  pl.pitch = 0;
  for (let i = 0; i < 240 && !sim.events.some((e) => e.type === "scared" || e.type === "bitten"); i++) {
    if (i === 0) {
      const f = forward(pl.yaw, 0);
      const back = (ty.lengthCm / 100) * 0.9;
      ty.pos = { x: pl.pos.x - f.x * back, y: pl.pos.y, z: pl.pos.z - f.z * back };
      ty.yaw = pl.yaw;
      ty.pitch = 0;
      ty.burstCooldown = 0;
      ty.energy = sim.p.pike.energyMax;
    }
    sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
    sim.step(DT);
  }
}

describe("lake tyrant", () => {
  it("startTyrant spawns a pike 1.25x the player, 12-16 m away, with a tyrant-start event", () => {
    const { sim, pl } = setup();
    const id = sim.startTyrant(pl.id);
    expect(id).not.toBeNull();
    const ty = sim.pikes.find((k) => k.id === id)!;
    expect(ty.lengthCm).toBeCloseTo(pl.lengthCm * TYRANT.sizeMul, 5);
    const d = Math.hypot(ty.pos.x - pl.pos.x, ty.pos.z - pl.pos.z);
    expect(d).toBeGreaterThanOrEqual(11.5);
    expect(d).toBeLessThanOrEqual(16.5);
    expect(sim.tyrant).toMatchObject({ id, targetId: pl.id, hp: TYRANT.hp, outcome: null });
    expect(sim.events.at(-1)).toMatchObject({ type: "tyrant-start", tyrantId: id, targetId: pl.id, lengthCm: ty.lengthCm });
    expect(sim.startTyrant(pl.id)).toBeNull(); // one at a time
  });

  it("non-arcade sim: startTyrant returns null", () => {
    const { sim, pl } = setup(false, 40, false);
    expect(sim.startTyrant(pl.id)).toBeNull();
    expect(sim.tyrant).toBeNull();
  });

  it("three strikes from three bursts beat it", () => {
    const { sim, pl } = setup();
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    for (let n = 0; n < 3; n++) strike(sim, pl, ty);
    const hits = sim.events.filter((e) => e.type === "tyrant-hit");
    expect(hits.map((e) => (e as { hp: number }).hp)).toEqual([2, 1, 0]);
    expect(sim.events.some((e) => e.type === "tyrant-end" && e.outcome === "beaten" && e.tyrantId === id && e.targetId === pl.id)).toBe(true);
    expect(ty.alive).toBe(true); // driven off, not eaten
    expect(sim.events.some((e) => e.type === "capture" && e.preyId === id)).toBe(false);
  });

  it("two ticks in reach within the same burst count one hit", () => {
    const { sim, pl } = setup();
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    strike(sim, pl, ty, 4);
    expect(sim.tyrant!.hp).toBe(TYRANT.hp - 1);
    expect(sim.events.filter((e) => e.type === "tyrant-hit")).toHaveLength(1);
    expect(sim.tyrant!.phase).toBe("flee");
  });

  it("beaten: it swims off and is removed after 8 s; nothing else touches it meanwhile", () => {
    const { sim, pl } = setup();
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    for (let n = 0; n < 3; n++) strike(sim, pl, ty);
    expect(sim.tyrant?.outcome).toBe("beaten");
    strike(sim, pl, ty); // a strike after the end: no extra hit
    expect(sim.events.filter((e) => e.type === "tyrant-hit")).toHaveLength(3);
    for (let i = 0; i < 8.5 / DT; i++) sim.step(DT);
    expect(sim.tyrant).toBeNull();
    expect(sim.pikes.some((k) => k.id === id)).toBe(false);
    expect(sim.events.filter((e) => e.type === "tyrant-end")).toHaveLength(1);
  });

  it("chill: its strike scares the player, health unchanged, then it flees", () => {
    const { sim, pl } = setup(true);
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    const h0 = pl.health;
    charge(sim, pl, ty);
    expect(sim.events.some((e) => e.type === "scared" && e.pikeId === pl.id && e.byId === id && e.cause === "tyrant")).toBe(true);
    expect(sim.events.some((e) => e.type === "bitten")).toBe(false);
    expect(pl.health).toBe(h0);
    expect(pl.alive).toBe(true);
    expect(sim.tyrant!.phase).toBe("flee");
  });

  it("challenge: its strike costs a heart", () => {
    const { sim, pl } = setup(false);
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    const h0 = pl.health;
    charge(sim, pl, ty);
    expect(sim.events.some((e) => e.type === "bitten" && e.pikeId === pl.id && e.byPikeId === id)).toBe(true);
    expect(pl.health).toBeCloseTo(h0 - ARCADE_BITE, 5);
    expect(pl.alive).toBe(true);
    expect(sim.tyrant!.phase).toBe("flee");
  });

  it("challenge: on the last heart it eats the player (ate-player)", () => {
    const { sim, pl } = setup(false);
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    pl.health = ARCADE_BITE;
    charge(sim, pl, ty);
    for (let i = 0; i < 240 && pl.alive; i++) sim.step(DT);
    expect(pl.alive).toBe(false);
    expect(pl.killedBy).toBe(id);
    sim.step(DT);
    expect(sim.events.some((e) => e.type === "tyrant-end" && e.outcome === "ate-player")).toBe(true);
  });

  it("times out: left", () => {
    const { sim, pl } = setup(true);
    const id = sim.startTyrant(pl.id)!;
    sim.tyrant!.t = TYRANT.timeoutS - 0.01;
    sim.tyrant!.phase = "circle";
    sim.tyrant!.phaseT = 0;
    sim.step(DT);
    sim.step(DT);
    expect(sim.events.some((e) => e.type === "tyrant-end" && e.tyrantId === id && e.outcome === "left")).toBe(true);
  });

  it("a big rival's strike never eats it", () => {
    const { sim, pl } = setup(false, 20);
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    const big = sim.addRival(150, "female");
    big.ai = undefined;
    strike(sim, big, ty, 10);
    expect(ty.alive).toBe(true);
    expect(sim.events.some((e) => e.type === "capture" && e.preyId === id)).toBe(false);
    expect(sim.tyrant!.hp).toBe(TYRANT.hp); // only its target can hurt it
  });

  it("is not saved", () => {
    const { sim, pl } = setup();
    const id = sim.startTyrant(pl.id)!;
    expect(sim.toState().pikes.some((k) => k.id === id)).toBe(false);
  });

  it("tyrant events pass the guest message parser", () => {
    const evs = [
      { type: "tyrant-start", tyrantId: 2, targetId: 1, lengthCm: 50, t: 1 },
      { type: "tyrant-hit", tyrantId: 2, hp: 2, t: 2 },
      { type: "tyrant-end", tyrantId: 2, targetId: 1, outcome: "beaten", t: 3 },
    ];
    expect(parseHostMsg({ t: "ev", events: evs })).toEqual({ t: "ev", events: evs });
  });

  it("a beaten tyrant stops its charge: burst and lock cleared", () => {
    const { sim, pl } = setup();
    const id = sim.startTyrant(pl.id)!;
    const ty = sim.pikes.find((k) => k.id === id)!;
    strike(sim, pl, ty);
    strike(sim, pl, ty);
    // mid-charge when the last bite lands
    const f = forward(pl.yaw, 0);
    pl.burstTimeLeft = 0;
    pl.burstCooldown = 0;
    pl.energy = sim.paramsFor(pl).pike.energyMax;
    faceOff(pl, ty);
    ty.burstTimeLeft = 0.3;
    ty.lockId = pl.id;
    sim.tyrant!.phase = "charge";
    sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    // keep the tyrant in place for the tick (its own input would move it)
    ty.pos = { x: pl.pos.x + f.x * (pl.lengthCm / 200 + 0.05), y: pl.pos.y, z: pl.pos.z + f.z * (pl.lengthCm / 200 + 0.05) };
    sim.step(DT);
    expect(sim.tyrant!.outcome).toBe("beaten");
    expect(ty.burstTimeLeft).toBe(0);
    expect(ty.lockId).toBeNull();
  });

  it("host: a guest growing into stage 8 gets a tyrant; a second request waits until the lake is free", () => {
    const { sim, pl } = setup(true, 50);
    const g1 = sim.addHuman(70);
    const g2 = sim.addHuman(72);
    const caller = new TyrantCaller();
    expect(caller.tick(sim)).toBeNull(); // first sight: nobody crossed
    g1.lengthCm = 76;
    const id = caller.tick(sim);
    expect(id).not.toBeNull();
    expect(sim.tyrant).toMatchObject({ id, targetId: g1.id });
    expect(sim.tyrant!.targetId).not.toBe(pl.id);
    g2.lengthCm = 75.5;
    expect(caller.tick(sim)).toBeNull();
    expect(caller.waiting).toEqual([g2.id]);
    // the first fight ends and the tyrant leaves the lake
    sim.tyrant!.t = 1e9;
    for (let i = 0; i < 9 / DT && sim.tyrant; i++) sim.step(DT);
    expect(sim.tyrant).toBeNull();
    const id2 = caller.tick(sim);
    expect(id2).not.toBeNull();
    expect(sim.tyrant).toMatchObject({ id: id2, targetId: g2.id });
    expect(caller.waiting).toEqual([]);
  });

  it("host: the host's own pike crossing 75 cm also calls it; a pike first seen at stage 8 does not", () => {
    const { sim, pl } = setup(true, 74);
    sim.addHuman(80); // already a Lake tyrant when first seen
    const caller = new TyrantCaller();
    expect(caller.tick(sim)).toBeNull();
    expect(caller.tick(sim)).toBeNull();
    pl.lengthCm = 75.2;
    caller.tick(sim);
    expect(sim.tyrant?.targetId).toBe(pl.id);
  });
  it("host: no tyrant while a hunter is after someone; it comes once the hunt ends", () => {
    const { sim, pl } = setup(true, 74);
    const caller = new TyrantCaller();
    caller.tick(sim);
    expect(sim.startHunter(pl.id)).not.toBeNull();
    pl.lengthCm = 75.2;
    expect(caller.tick(sim)).toBeNull();
    expect(sim.tyrant).toBeNull();
    expect(caller.waiting).toEqual([pl.id]);
    sim.hunter = null;
    expect(caller.tick(sim)).not.toBeNull();
    expect(sim.tyrant?.targetId).toBe(pl.id);
  });

  it("startHunter refuses while the tyrant fight is on", () => {
    const { sim, pl } = setup(true, 76);
    expect(sim.startTyrant(pl.id)).not.toBeNull();
    expect(sim.startHunter(pl.id)).toBeNull();
    expect(sim.hunter).toBeNull();
  });

  it("host: a tyrant that left comes back after a cooldown; a beaten one does not", () => {
    const { sim, pl } = setup(true, 74);
    const caller = new TyrantCaller();
    caller.tick(sim);
    pl.lengthCm = 75.2;
    expect(caller.tick(sim)).not.toBeNull();
    sim.tyrant!.t = 1e9; // times out: "left"
    for (let i = 0; i < 9 / DT && sim.tyrant; i++) {
      sim.step(DT);
      caller.tick(sim);
    }
    expect(sim.tyrant).toBeNull();
    // not straight away (only the clock matters to the caller)
    sim.time += 30;
    expect(caller.tick(sim)).toBeNull();
    sim.time += 31;
    expect(caller.tick(sim)).not.toBeNull();
    expect(sim.tyrant?.targetId).toBe(pl.id);
    // beaten this time: it stays away
    sim.tyrant!.hp = 0;
    (sim as unknown as { endTyrant(o: string): void }).endTyrant("beaten");
    for (let i = 0; i < 9 / DT && sim.tyrant; i++) {
      sim.step(DT);
      caller.tick(sim);
    }
    expect(sim.tyrant).toBeNull();
    sim.time += 120;
    expect(caller.tick(sim)).toBeNull();
  });
});
