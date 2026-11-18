import { describe, expect, it } from "vitest";
import { angleDiff, clamp, dist } from "../src/sim/math";
import type { PikeInput } from "../src/sim/pike";
import { Simulation } from "../src/sim/simulation";

/** Minimal stalk-and-strike controller: sneak toward the nearest prey, burst when in range. */
function hunterInput(sim: Simulation, id: number): PikeInput {
  const pk = sim.pikes.find((k) => k.id === id)!;
  let best = null as (typeof sim.prey)[number] | null;
  let bd = 12;
  for (const f of sim.prey) {
    if (f.lengthCm > pk.lengthCm * sim.p.pike.maxPreyLengthFracOfBL) continue;
    const d = dist(f.pos, pk.pos);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  if (!best) return { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
  const dx = best.pos.x - pk.pos.x;
  const dz = best.pos.z - pk.pos.z;
  const dy = best.pos.y - pk.pos.y;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pk.pitch;
  const reach = sim.p.pike.strikeRangeBL * (pk.lengthCm / 100) * 2.4;
  const aligned = Math.abs(yawErr) < 0.3;
  return {
    throttle: bd > reach ? 0.3 : 0,
    yawRate: clamp(yawErr * 3, -1, 1),
    pitchRate: clamp(pitchErr * 3, -1, 1),
    burst: aligned && bd < reach,
  };
}

describe("hunting loop", () => {
  it("a stalk-and-strike pike catches fish, but not every attempt succeeds", () => {
    let captures = 0;
    let strikes = 0;
    let misses = 0;
    let bolts = 0;
    for (const seed of [1, 2, 3, 4]) {
      const sim = new Simulation({ seed });
      const pk = sim.addPike(60);
      for (let i = 0; i < 20 * 300; i++) {
        sim.setInput(pk.id, hunterInput(sim, pk.id));
        sim.step(1 / 20);
      }
      for (const e of sim.events) {
        if (e.type === "capture") captures++;
        else if (e.type === "strike") strikes++;
        else if (e.type === "miss") misses++;
        else if (e.type === "bolt") bolts++;
      }
    }
    console.log({ captures, strikes, misses, bolts });
    expect(strikes).toBeGreaterThan(0);
    expect(captures).toBeGreaterThan(0); // hunting is possible
    expect(captures).toBeLessThan(strikes); // and not guaranteed
    expect(bolts).toBeGreaterThan(0); // prey actually react
  }, 120000);
});
