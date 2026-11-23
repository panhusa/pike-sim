import { describe, expect, it, vi } from "vitest";
import { ARCADE_BITE, Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { HERON, OTTER } from "../src/sim/extras";
import { v3, type Vec3 } from "../src/sim/math";
import { packExtras, parseHostMsg, unpackExtras } from "../src/net/protocol";
import { CHALLENGES, Challenges } from "../src/game/challenges";
import { parseSave, toSaveFile } from "../src/sim/save";
import { weedPoint } from "./helpers";

vi.setConfig({ testTimeout: 60000 }); // the natural heron clock needs two game minutes

const DT = 1 / 30;

function setup(opts: { chill?: boolean; arcade?: boolean; len?: number } = {}) {
  const sim = new Simulation({ seed: 4, settings: { ...presetSettings("gentle", "permadeath", defaultParams), chill: opts.chill ?? false }, startHour: 12 });
  const pl = sim.addPlayer(opts.len ?? 22);
  sim.arcade = opts.arcade ?? true;
  sim.pikes = sim.pikes.filter((k) => !k.ai); // no rivals biting the test player
  return { sim, pl };
}

/** A water point whose depth is within [lo, hi). */
function pointWithDepth(sim: Simulation, lo: number, hi: number): Vec3 {
  const w = sim.world;
  for (let x = -w.size / 2; x < w.size / 2; x += 0.5)
    for (let z = -w.size / 2; z < w.size / 2; z += 0.5) {
      const d = w.depthAt(x, z);
      if (!w.inWater(x, z) || d < lo || d >= hi) continue;
      // keep away from the very edge so a 1 m nudge stays in the water
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => w.inWater(x + a! * 1.5, z + b! * 1.5))) continue;
      return v3(x, -Math.min(0.4, d * 0.5), z);
    }
  throw new Error(`no point with depth ${lo}..${hi}`);
}

/** Step `s` seconds holding the player still at `at` (or wherever it is). */
function hold(sim: Simulation, s: number, at?: () => Vec3, stopWhen?: () => boolean): void {
  const pl = sim.player()!;
  for (let i = 0; i < s / DT; i++) {
    if (at) pl.pos = { ...at() };
    pl.speed = 0;
    pl.stomachG = 0; // hungry but never starving in a short test
    sim.setInput(pl.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
    sim.step(DT);
    if (stopWhen?.()) return;
  }
}

const has = (sim: Simulation, type: string) => sim.events.some((e) => e.type === type);

describe("heron", () => {
  it("never triggers while the player stays in deep water", () => {
    const { sim } = setup();
    const deep = pointWithDepth(sim, 2.5, 99);
    hold(sim, HERON.everyS[1] + HERON.warnS + 30, () => deep);
    expect(has(sim, "heron-warn")).toBe(false);
  });

  it("triggers in shallow water within everyS[1] + warnS of play, and stabs", () => {
    const { sim } = setup();
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    hold(sim, HERON.everyS[1] + HERON.warnS + 0.5, () => shallow);
    const warn = sim.events.find((e) => e.type === "heron-warn");
    expect(warn).toBeDefined();
    expect(warn!.t - sim.events[0]!.t).toBeGreaterThanOrEqual(60 - 1); // never before a minute of play
    expect(has(sim, "heron-stab")).toBe(true);
  });

  it("does not trigger while a hunter is active", () => {
    const { sim, pl } = setup();
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    pl.pos = { ...shallow };
    sim.extras.playS.set(pl.id, 100);
    sim.extras.heronIn = 0;
    sim.startHunter(pl.id);
    hold(sim, 3, () => shallow);
    expect(has(sim, "heron-warn")).toBe(false);
  });

  it("a still player under the stab loses a heart in Challenge", () => {
    const { sim, pl } = setup();
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    pl.pos = { ...shallow };
    expect(sim.extras.startHeron(sim, pl.id)).toBe(true);
    hold(sim, HERON.warnS + 0.3, () => shallow);
    expect(pl.health).toBeCloseTo(1 - ARCADE_BITE, 2); // plus a few ticks of healing
    expect(sim.events.some((e) => e.type === "bitten" && e.pikeId === pl.id)).toBe(true);
    expect(has(sim, "heron-dodged")).toBe(false);
  });

  it("in Chill the stab only scares (health unchanged)", () => {
    const { sim, pl } = setup({ chill: true });
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    pl.pos = { ...shallow };
    sim.extras.startHeron(sim, pl.id);
    hold(sim, HERON.warnS + 0.3, () => shallow);
    expect(pl.health).toBe(1);
    expect(sim.events.some((e) => e.type === "scared" && e.cause === "heron")).toBe(true);
    expect(has(sim, "bitten")).toBe(false);
  });

  it("a player that moved 1 m in the last moment dodges", () => {
    const { sim, pl } = setup();
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    pl.pos = { ...shallow };
    sim.extras.startHeron(sim, pl.id);
    hold(sim, HERON.warnS - 0.2, () => shallow);
    const moved = v3(shallow.x + 1, shallow.y, shallow.z);
    hold(sim, 0.5, () => moved);
    expect(sim.events.some((e) => e.type === "heron-dodged" && e.pikeId === pl.id)).toBe(true);
    expect(pl.health).toBe(1);
  });
});

describe("otter", () => {
  it("loses a still player hidden in cover", () => {
    const { sim, pl } = setup();
    const weed = weedPoint(sim);
    pl.pos = { ...weed };
    pl.stillTime = 5;
    expect(sim.extras.startOtter(sim, pl.id)).toBe(true);
    expect(sim.events.some((e) => e.type === "otter-start" && e.pikeId === pl.id)).toBe(true);
    hold(sim, OTTER.durationS, () => weed, () => has(sim, "otter-lost"));
    expect(sim.events.some((e) => e.type === "otter-lost" && e.pikeId === pl.id)).toBe(true);
    expect(sim.events.some((e) => e.type === "otter-end" && e.outcome === "lost")).toBe(true);
    expect(pl.health).toBe(1);
  });

  it("takes the last heart: death cause otter", () => {
    const { sim, pl } = setup();
    const open = pointWithDepth(sim, 2, 99);
    pl.pos = { ...open };
    pl.health = ARCADE_BITE * 0.9;
    sim.extras.startOtter(sim, pl.id);
    hold(sim, OTTER.durationS, () => open, () => !pl.alive);
    expect(pl.alive).toBe(false);
    expect(pl.deathCause).toBe("otter");
    expect(sim.events.some((e) => e.type === "death" && e.pikeId === pl.id && e.cause === "otter")).toBe(true);
    expect(sim.events.some((e) => e.type === "otter-end" && e.outcome === "bit")).toBe(true);
  });

  it("only comes for pike in its size range", () => {
    const small = setup({ len: OTTER.minCm - 2 });
    expect(small.sim.extras.startOtter(small.sim, small.pl.id)).toBe(false);
  });
});

describe("one threat at a time", () => {
  it("no hunter starts during a heron warning or an otter chase", () => {
    const { sim, pl } = setup();
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    pl.pos = { ...shallow };
    sim.extras.startHeron(sim, pl.id);
    expect(sim.startHunter(pl.id)).toBeNull();
    hold(sim, HERON.warnS + 1, () => shallow, () => sim.extras.heron === null);
    expect(sim.extras.heron).toBeNull();
    pl.health = 1;
    sim.extras.startOtter(sim, pl.id);
    expect(sim.startHunter(pl.id)).toBeNull();
    expect(sim.hunter).toBeNull();
  });

  it("a hunter or tyrant blocks new herons and otters", () => {
    const { sim, pl } = setup();
    pl.pos = { ...pointWithDepth(sim, 0.5, HERON.shallowM) };
    sim.startHunter(pl.id);
    expect(sim.extras.startHeron(sim, pl.id)).toBe(false);
    expect(sim.extras.startOtter(sim, pl.id)).toBe(false);
  });

  it("the tyrant arriving sends off a heron before its stab and an otter mid-chase", () => {
    const { sim, pl } = setup({ len: 40 });
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    pl.pos = { ...shallow };
    sim.extras.startHeron(sim, pl.id);
    hold(sim, 1, () => shallow);
    expect(sim.startTyrant(pl.id)).not.toBeNull();
    expect(sim.extras.heron).toBeNull();
    hold(sim, HERON.warnS, () => shallow);
    expect(has(sim, "heron-stab")).toBe(false);
    expect(sim.events.some((e) => e.type === "bitten" && e.byPikeId >= 30_000_000)).toBe(false);

    const b = setup({ len: 40 });
    b.pl.pos = { ...pointWithDepth(b.sim, 2, 99) };
    b.sim.extras.startOtter(b.sim, b.pl.id);
    b.sim.startTyrant(b.pl.id);
    expect(b.sim.events.some((e) => e.type === "otter-end" && e.outcome === "interrupted")).toBe(true);
    expect(b.sim.events.some((e) => e.type === "otter-end" && e.outcome === "timeout")).toBe(false);
  });
});

describe("hurtPlayer", () => {
  it("Challenge: one heart per hit, death with the cause on the last", () => {
    const { sim, pl } = setup();
    sim.hurtPlayer(pl, "heron", 1);
    expect(pl.health).toBeCloseTo(1 - ARCADE_BITE, 5);
    pl.health = 0.2;
    sim.hurtPlayer(pl, "heron", 1);
    expect(pl.alive).toBe(false);
    expect(pl.deathCause).toBe("heron");
  });
  it("Chill: scared, never hurt", () => {
    const { sim, pl } = setup({ chill: true });
    pl.health = 0.2;
    sim.hurtPlayer(pl, "otter", 1);
    expect(pl.alive).toBe(true);
    expect(pl.health).toBe(0.2);
    expect(sim.events.some((e) => e.type === "scared" && e.cause === "otter")).toBe(true);
  });
});

describe("game rules", () => {
  it("the realistic sim has neither", () => {
    const { sim, pl } = setup({ arcade: false });
    const shallow = pointWithDepth(sim, 0.5, HERON.shallowM);
    expect(sim.extras.startHeron(sim, pl.id)).toBe(false);
    expect(sim.extras.startOtter(sim, pl.id)).toBe(false);
    hold(sim, HERON.everyS[1] + 10, () => shallow);
    expect(sim.extras.heron).toBeNull();
    expect(sim.extras.otter).toBeNull();
    expect(sim.events.some((e) => String(e.type).startsWith("heron") || String(e.type).startsWith("otter"))).toBe(false);
  });

  it("heron and otter are transient: not saved", () => {
    const { sim, pl } = setup();
    pl.pos = { ...weedPoint(sim) };
    sim.extras.startOtter(sim, pl.id);
    expect(sim.extras.otter).not.toBeNull();
    const r = parseSave(toSaveFile(sim, new Date(0)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sim.extras.otter).toBeNull();
    expect(r.sim.extras.heron).toBeNull();
  });

  it("goals for dodging a heron and losing an otter", () => {
    const heron = CHALLENGES.find((c) => c.text === "Dodge a heron's stab")!;
    const otter = CHALLENGES.find((c) => c.text === "Lose an otter in the weeds")!;
    expect(heron).toMatchObject({ minPikeCm: 4, bonus: 800 });
    expect(otter).toMatchObject({ minPikeCm: 10, bonus: 1200 });
    const c = new Challenges();
    c.index = CHALLENGES.indexOf(heron);
    expect(c.push({ type: "otter-lost" })).toBeNull();
    expect(c.push({ type: "heron-dodged" })?.id).toBe(heron.id);
  });
});

describe("multiplayer", () => {
  it("snapshot extras carry the heron and the otter; old snapshots still parse", () => {
    const heron = { id: 30000001, targetId: 7, t: 1.25, x: 1.234, z: -2, aimX: 1, aimZ: -2.1, struck: false, hit: false };
    const otter = { id: 30000002, targetId: 7, pos: { x: 3, y: -0.5, z: 4 }, yaw: 0.5, t: 3, lastSeen: { x: 0, y: 0, z: 0 }, lostS: 0, home: { x: 0, y: 0, z: 0 }, outcome: null };
    const back = unpackExtras(JSON.parse(JSON.stringify(packExtras([], null, [], heron, otter))))!;
    expect(back.heron).toMatchObject({ id: 30000001, targetId: 7, x: 1.23, z: -2, struck: false });
    expect(back.otter).toMatchObject({ id: 30000002, targetId: 7, pos: { x: 3, y: -0.5, z: 4 }, outcome: null });
    const old = unpackExtras({ insects: [], angler: null })!;
    expect(old.heron).toBeNull();
    expect(old.otter).toBeNull();
  });
  it("heron and otter events pass the guest allowlist", () => {
    const evs = ["heron-warn", "heron-stab", "heron-dodged", "otter-start", "otter-lost", "otter-end"].map((type) => ({ type, pikeId: 7, t: 0 }));
    const m = parseHostMsg({ t: "ev", events: evs });
    expect(m && m.t === "ev" && m.events.length).toBe(6);
  });
});
