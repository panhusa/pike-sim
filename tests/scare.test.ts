import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { Score } from "../src/game/score";
import { parseHostMsg } from "../src/net/protocol";

function chase(chill: boolean, len = 22) {
  const sim = new Simulation({ seed: 9, settings: { ...presetSettings("gentle", "permadeath", defaultParams), chill } });
  const pl = sim.addPlayer(len);
  sim.arcade = true;
  const hid = sim.startHunter()!;
  const hk = sim.pikes.find((k) => k.id === hid)!;
  const health0 = pl.health;
  for (let i = 0; i < 1200 && sim.hunter; i++) {
    hk.pos = { x: pl.pos.x - Math.cos(pl.yaw) * hk.lengthCm * 0.004, y: pl.pos.y, z: pl.pos.z - Math.sin(pl.yaw) * hk.lengthCm * 0.004 };
    hk.yaw = pl.yaw;
    hk.pitch = pl.pitch;
    hk.stomachG = 0;
    hk.burstCooldown = 0;
    hk.energy = 100;
    sim.setInput(hk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    hk.ai = undefined;
    sim.step(1 / 60);
  }
  return { sim, pl, hk, health0 };
}

describe("scared in Chill", () => {
  it("the hunter's strike scares instead of hurting; the hunt ends scared-player", () => {
    const { sim, pl, health0 } = chase(true);
    expect(sim.events.some((e) => e.type === "scared" && e.pikeId === pl.id && e.cause === "pike")).toBe(true);
    expect(pl.alive).toBe(true);
    expect(pl.health).toBe(health0);
    expect(sim.events.some((e) => e.type === "hunter-end" && e.outcome === "scared-player")).toBe(true);
    expect(sim.events.some((e) => e.type === "bitten")).toBe(false);
  });
  it("Challenge mode still bites", () => {
    const { sim, pl, health0 } = chase(false);
    expect(sim.events.some((e) => e.type === "scared")).toBe(false);
    expect(sim.events.some((e) => e.type === "bitten")).toBe(true);
    expect(pl.health).toBeLessThan(health0);
  });
  it("scare() stops the player, leaves health alone", () => {
    const sim = new Simulation({ seed: 1, settings: { ...presetSettings("gentle", "permadeath", defaultParams), chill: true } });
    const pl = sim.addPlayer(22);
    sim.arcade = true;
    pl.speed = 1;
    const h = pl.health;
    sim.scare(pl, 99, "heron");
    expect(pl.speed).toBe(0);
    expect(pl.health).toBe(h);
    expect(sim.events.at(-1)).toMatchObject({ type: "scared", pikeId: pl.id, byId: 99, cause: "heron" });
  });
  it("hunters work for a tiny larva: spawn scales, the chase reaches it", () => {
    for (const len of [1.2, 2, 5]) {
      const sim = new Simulation({ seed: 3, settings: { ...presetSettings("gentle", "permadeath", defaultParams), chill: true } });
      const pl = sim.addPlayer(len);
      sim.arcade = true;
      const id = sim.startHunter();
      expect(id).not.toBeNull();
      const hk = sim.pikes.find((k) => k.id === id)!;
      expect(hk.lengthCm).toBeGreaterThanOrEqual(len);
      expect(Math.hypot(hk.pos.x - pl.pos.x, hk.pos.z - pl.pos.z)).toBeLessThan(14);
      expect(pl.alive).toBe(true);
    }
  });
  it("Score.breakCombo clears the streak", () => {
    const s = new Score();
    s.catch(10, 1);
    s.catch(10, 2);
    s.breakCombo();
    expect(s.combo).toBe(0);
    expect(s.multiplier(3)).toBe(1);
  });
  it("the scared event passes the guest message parser", () => {
    const ev = { type: "scared", pikeId: 1, byId: 2, cause: "pike", t: 3 };
    expect(parseHostMsg({ t: "ev", events: [ev] })).toEqual({ t: "ev", events: [ev] });
  });
});
