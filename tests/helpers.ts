import { v3, type Vec3 } from "../src/sim/math";
import type { Simulation } from "../src/sim/simulation";
import { appetite } from "../src/sim/biology";
import type { Params } from "../src/sim/params";
import { stepMetabolism, type PikeState } from "../src/sim/pike";

/** Best possible feeding: whenever appetite says the fish will eat, a full meal is available. */
export function feedAppetiteGated(s: PikeState, tempC: number, days: number, p: Params, dt = 600): void {
  for (let t = 0; t < days * 86400; t += dt) {
    const cap = s.weight * p.pike.stomachMaxFracOfWeight;
    if (appetite(s.stomachG / cap, tempC) > 0.3) s.stomachG = cap;
    stepMetabolism(s, tempC, dt, dt, false, p);
  }
}

/** Jump to the start of calendar day `d` and step once so the environment and daily hooks refresh. */
export function jumpToDay(sim: Simulation, d: number): void {
  sim.time = (d - sim.startDay) * sim.p.environment.dayLengthS;
  sim.step(1 / 20);
}

/** Mid-height centre of the `index`-th weed bed whose centre gives good cover. */
export function weedPoint(sim: Simulation, index = 0): Vec3 {
  let found = 0;
  for (const w of sim.world.weeds) {
    const pos = v3(w.x, sim.world.bottomY(w.x, w.z) + w.height * 0.5, w.z);
    if (sim.world.coverAt(pos) < 0.5 || !sim.world.inWater(w.x, w.z)) continue;
    if (found++ === index) return pos;
  }
  throw new Error("no weed point found");
}
