import { describe, expect, it } from "vitest";
import { Rng, v3 } from "../src/sim/math";
import { defaultParams as P } from "../src/sim/params";
import { makePike } from "../src/sim/pike";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { feedAppetiteGated } from "./helpers";

describe("settings", () => {
  it("presets match params", () => {
    expect(presetSettings("harsh", "lineage", P)).toEqual({
      deathMode: "lineage",
      rivalCount: 12,
      rivalSizeScale: 1.25,
      aggression: 1.5,
      recruitmentScale: 1.4,
    });
  });
});

describe("rng state", () => {
  it("round-trips", () => {
    const a = new Rng(5);
    for (let i = 0; i < 10; i++) a.next();
    const saved = a.state;
    const want = Array.from({ length: 5 }, () => a.next());
    const b = new Rng(1);
    b.state = saved;
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(want);
  });
});

describe("growth ceiling", () => {
  it("females outgrow males near the male ceiling", () => {
    const gain = (sex: "male" | "female"): number => {
      const s = makePike(1, v3(0, -2, 0), 85, P, sex);
      const w0 = s.weight;
      feedAppetiteGated(s, 16, 20, P);
      return s.weight - w0;
    };
    expect(gain("female")).toBeGreaterThan(2 * gain("male"));
  });
});

describe("addPlayer", () => {
  it("registers the player with a seeded sex", () => {
    const sim = new Simulation({ seed: 3 });
    const pk = sim.addPlayer(30);
    expect(sim.playerId).toBe(pk.id);
    expect(sim.player()).toBe(pk);
    expect(["male", "female"]).toContain(pk.sex);
    expect(new Simulation({ seed: 3 }).addPlayer(30).sex).toBe(pk.sex);
  });
});
