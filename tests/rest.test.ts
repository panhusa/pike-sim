import { describe, expect, it } from "vitest";
import { dist, v3 } from "../src/sim/math";
import { defaultParams } from "../src/sim/params";
import { condition, type PikeState } from "../src/sim/pike";
import { restBlockers, restFor } from "../src/sim/rest";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { weedPoint } from "./helpers";

const natural = presetSettings("natural", "permadeath", defaultParams);
const harsh = presetSettings("harsh", "permadeath", defaultParams);
const DAY = 86400;
const MAX_PREY = defaultParams.pike.maxPreyLengthFracOfBL;

function withPlayer(sim: Simulation, lengthCm: number): PikeState {
  const pl = sim.addPlayer(lengthCm);
  pl.pos = weedPoint(sim);
  pl.speed = 0;
  pl.stillTime = 10;
  return pl;
}

describe("rest gating", () => {
  const empty = (): { sim: Simulation; pl: PikeState } => {
    const sim = new Simulation({ seed: 1, settings: { ...natural, rivalCount: 0 } });
    return { sim, pl: withPlayer(sim, 40) };
  };

  it("all conditions met gives no blockers", () => {
    const { sim } = empty();
    expect(restBlockers(sim)).toEqual([]);
  });

  it("each blocker appears alone", () => {
    let c = empty();
    c.pl.stillTime = 1;
    expect(restBlockers(c.sim)).toEqual(["moving"]);

    c = empty();
    let open = null;
    for (let x = -20; x <= 20 && !open; x += 2)
      for (let z = -20; z <= 20 && !open; z += 2) {
        const pos = v3(x, c.pl.pos.y, z);
        if (c.sim.world.inWater(x, z) && c.sim.world.coverAt(pos) < defaultParams.rest.minCover) open = pos;
      }
    expect(open).not.toBeNull();
    c.pl.pos = open!;
    expect(restBlockers(c.sim)).toEqual(["no-cover"]);

    c = empty();
    const r = c.sim.addRival(40 / MAX_PREY + 20, "female");
    r.pos = v3(c.pl.pos.x + 5, c.pl.pos.y, c.pl.pos.z);
    expect(restBlockers(c.sim)).toEqual(["rival-near"]);
    r.pos = v3(c.pl.pos.x + 30, c.pl.pos.y, c.pl.pos.z);
    expect(restBlockers(c.sim)).toEqual([]);
    const small = c.sim.addRival(10, "male"); // cannot swallow the player
    small.pos = v3(c.pl.pos.x + 3, c.pl.pos.y, c.pl.pos.z);
    expect(restBlockers(c.sim)).toEqual([]);

    c = empty();
    c.pl.alive = false;
    expect(restBlockers(c.sim)).toEqual(["dead"]);
  });
});

describe("restFor", () => {
  it("hunger stops rest before death", () => {
    const sim = new Simulation({ seed: 3, settings: { ...natural, rivalCount: 0 } });
    sim.prey.length = 0;
    const pl = withPlayer(sim, 40);
    pl.weight = 0.81 * (pl.weight / condition(pl, sim.p));
    const stop = restFor(sim, 60 * DAY);
    expect(stop).toEqual({ reason: "hunger" });
    expect(pl.alive).toBe(true);
    expect(condition(pl, sim.p)).toBeGreaterThanOrEqual(0.79);
  });

  it("done: a safe, fed player rests one day", () => {
    const sim = new Simulation({ seed: 2, settings: { ...natural, rivalCount: 0 } });
    const pl = withPlayer(sim, 40);
    const t0 = sim.time;
    expect(restFor(sim, DAY)).toEqual({ reason: "done" });
    expect(Math.abs(sim.time - t0 - 600)).toBeLessThanOrEqual(2.1);
    expect(pl.alive).toBe(true);
  });

  it("threat places the rival", () => {
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const sim = new Simulation({ seed, settings: harsh });
      const pl = withPlayer(sim, 30);
      sim.prey.length = 0;
      sim.pikes
        .filter((k) => k.ai && k.lengthCm >= 30 / MAX_PREY)
        .forEach((k, i) => {
          k.ai!.home = v3(pl.pos.x + 4 + i, pl.pos.y, pl.pos.z);
        });
      pl.weight *= 1.3; // fed enough that hunger does not pre-empt the threat
      const stop = restFor(sim, 20 * DAY);
      if (stop.reason !== "threat") continue;
      found = true;
      const rival = sim.pikes.find((k) => k.id === stop.rivalId)!;
      expect(Math.abs(dist(rival.pos, pl.pos) - defaultParams.rest.threatSpawnDistM)).toBeLessThanOrEqual(0.5);
      expect(rival.ai!.mode).toBe("hunt");
      expect(rival.ai!.targetId).toBe(sim.playerId);
    }
    expect(found).toBe(true);
  });
});
