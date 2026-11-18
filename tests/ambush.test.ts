import { describe, expect, it } from "vitest";
import { dist, v3 } from "../src/sim/math";
import { makePike } from "../src/sim/pike";
import { preyDetectionRate } from "../src/sim/sensing";
import { Simulation } from "../src/sim/simulation";
import type { World } from "../src/sim/world";
import { edgeSpotNearSchool, huntRun, type HuntRun } from "./ambushMeasures";

describe("ambush at cover edges", () => {
  it("a still pike in cover is not seen from 2.5 m but is up close, and a moving one is", () => {
    const sim = new Simulation({ seed: 1 });
    const p = sim.p;
    const world: World = sim.world;
    const reed = world.reeds.find((r) => world.coverAt(v3(r.x, -r.height * 0.5, r.z)) > 0.8)!;
    const pos = v3(reed.x, -reed.height * 0.5, reed.z);
    const hidden = makePike(900, pos, 60, p, "female");
    hidden.stillTime = 10;
    const roach = v3(pos.x + 2.5, pos.y, pos.z);
    expect(preyDetectionRate(roach, p.prey.roach, hidden, sim.env, world, p)).toBe(0);
    // Never fully invisible at contact: the same still, hidden pike is seen up close.
    const close = v3(pos.x + 0.3, pos.y, pos.z);
    expect(preyDetectionRate(close, p.prey.roach, hidden, sim.env, world, p)).toBeGreaterThan(0);

    const open = makePike(901, v3(0, -1, 0), 60, p, "female");
    open.stillTime = 0;
    open.speed = 0.4;
    const r2 = v3(2.5, -1, 0);
    expect(dist(r2, open.pos)).toBeCloseTo(2.5);
    expect(preyDetectionRate(r2, p.prey.roach, open, sim.env, world, p)).toBeGreaterThan(0);
  });

  // Measured at the old spot (largest roach school's patch, radius x 0.9), seeds 1..8, 300 s, dt 1/20:
  // 0, 2, 17, 0, 23, 11, 0, 19 (median 6.5). Task 6 moved the spot inside the margin, on the patch of
  // the school whose depth the cover reaches (edgeSpotNearSchool); the median still clears 3.
  it("foraging prey come within 1 m of a pike waiting at a patch edge", () => {
    const counts: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const sim = new Simulation({ seed });
      const spot = edgeSpotNearSchool(sim).pos;
      const pk = sim.addPike(60, spot);
      const seen = new Set<number>();
      for (let i = 0; i < 20 * 300; i++) {
        sim.setInput(pk.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
        sim.step(1 / 20);
        for (const f of sim.prey) if (f.alive && dist(f.pos, pk.pos) < 1) seen.add(f.id);
      }
      counts.push(seen.size);
    }
    const sorted = [...counts].sort((a, b) => a - b);
    const median = (sorted[3]! + sorted[4]!) / 2;
    expect(median).toBeGreaterThanOrEqual(3);
  }, 600000);
});

const SEEDS = [1, 2, 3, 4, 5, 6];
const cache = new Map<string, HuntRun[]>();
/** Each controller runs every seed once; the measures below share the results. */
function runs(controller: "ambusher" | "chaser", seconds: number): HuntRun[] {
  const key = `${controller}:${seconds}`;
  let r = cache.get(key);
  if (!r) cache.set(key, (r = SEEDS.map((seed) => huntRun(seed, controller, seconds))));
  return r;
}
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

// One game day is 600 s. Catches count only useful meals (>= 1 g). A too-full pike refuses prey ("full"
// miss) and the scripted ambusher does not strike what it has no room for. A 22 cm pike's 8.9 g stomach
// fills on the first roach, so the day is digestion-limited. Measured (seeds 1-6, lungeMinRangeM 1.0,
// minSwallowRoom 10% / 1 g): first catch 16, 172, 72, 5, 19, 133 s; catches 2, 2, 2, 2, 3, 3 (bursts 5, 7,
// 6, 5, 9, 6). Before the full rule the count was 2, 4, 16, 2, 7, 6, mostly 0-1 g kills. Chaser over
// 300 s: catches 3, 2, 2, 2, 2, 3 of bursts 39, 50, 53, 51, 47, 21 (5.4%).
describe("hunting success measures", () => {
  it("an ambusher's median first catch is within 180 s", () => {
    const first = runs("ambusher", 600).map((r) => r.firstCatchS ?? Infinity);
    expect(median(first)).toBeLessThanOrEqual(180);
  }, 900000);

  it("an ambusher eats 2 to 8 useful meals per game day", () => {
    expect(median(runs("ambusher", 600).map((r) => r.catches))).toBeGreaterThanOrEqual(2);
    expect(median(runs("ambusher", 600).map((r) => r.catches))).toBeLessThanOrEqual(8);
  }, 900000);

  it("a chaser lands under 20% of its strikes", () => {
    const rs = runs("chaser", 300);
    const catches = rs.reduce((a, r) => a + r.catches, 0);
    const bursts = rs.reduce((a, r) => a + r.bursts, 0);
    expect(bursts).toBeGreaterThanOrEqual(10);
    expect(catches / bursts).toBeLessThan(0.2);
  }, 900000);
});
