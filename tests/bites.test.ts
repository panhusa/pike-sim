import { describe, expect, it } from "vitest";
import { ARCADE_BITE, Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { heartsOf } from "../src/ui/gameSession";

/** Put a big pike right behind-facing the player's flank and make it strike until the player is caught. */
function attack(arcade: boolean) {
  const sim = new Simulation({ seed: 9, settings: presetSettings("gentle", "permadeath", defaultParams) });
  const pl = sim.addPlayer(22);
  sim.arcade = arcade;
  const big = sim.addRival(80, "female");
  for (let i = 0; i < 600 && pl.alive; i++) {
    big.pos = { x: pl.pos.x - Math.cos(pl.yaw) * 0.45, y: pl.pos.y, z: pl.pos.z - Math.sin(pl.yaw) * 0.45 };
    big.yaw = pl.yaw;
    big.pitch = pl.pitch;
    big.stomachG = 0;
    big.burstCooldown = 0;
    sim.setInput(big.id, { throttle: 0, yawRate: 0, pitchRate: 0, burst: true });
    big.ai = undefined; // drive it directly
    sim.step(1 / 60);
    if (sim.events.some((e) => e.type === "bitten" || (e.type === "death" && e.pikeId === pl.id))) break;
  }
  return { sim, pl, big };
}

describe("arcade bites", () => {
  it("realistic mode: the player is swallowed", () => {
    const { pl } = attack(false);
    expect(pl.alive).toBe(false);
  });
  it("arcade mode: the first catch is a bite that costs one heart", () => {
    const { sim, pl, big } = attack(true);
    expect(pl.alive).toBe(true);
    expect(pl.health).toBeCloseTo(1 - ARCADE_BITE, 5);
    expect(big.stomachG).toBe(0);
    expect(sim.events.some((e) => e.type === "bitten")).toBe(true);
  });
  it("hearts track bites", () => {
    expect(heartsOf(1)).toBe(3);
    expect(heartsOf(1 - ARCADE_BITE)).toBe(2);
    expect(heartsOf(1 - 2 * ARCADE_BITE)).toBe(1);
    expect(heartsOf(0)).toBe(0);
  });
});
