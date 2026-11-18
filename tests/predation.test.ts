import { describe, expect, it } from "vitest";
import { v3 } from "../src/sim/math";
import { Simulation } from "../src/sim/simulation";
import { tooFullFor } from "../src/sim/pike";

const BURST = { throttle: 0, yawRate: 0, pitchRate: 0, burst: true };

function setup(seed: number, bigCm: number, smallCm: number) {
  const sim = new Simulation({ seed, preyScale: 0 });
  let pos = v3(0, -1, 0);
  for (let x = -20; x <= 20; x += 2) if (sim.world.inWater(x, 0) && sim.world.depthAt(x, 0) > 2 && sim.world.inWater(x + 2, 0)) { pos = v3(x, -1, 0); break; }
  const big = sim.addPike(bigCm, pos);
  big.yaw = 0;
  big.pitch = 0;
  const small = sim.addPike(smallCm, v3(pos.x + bigCm / 200 + 0.45, pos.y, pos.z));
  small.yaw = 0;
  small.pitch = 0;
  return { sim, big, small };
}

function run(sim: Simulation, id: number, seconds: number): void {
  sim.setInput(id, BURST);
  for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60);
}

describe("pike predation", () => {
  it("big pike can eat a small pike", () => {
    let eaten = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { sim, big, small } = setup(seed, 90, 30);
      run(sim, big.id, 1);
      const cap = sim.events.find((e) => e.type === "capture" && e.kind === "pike");
      if (!cap) continue;
      eaten++;
      const death = sim.events.find((e) => e.type === "death" && e.cause === "eaten");
      expect(death).toMatchObject({ pikeId: small.id, byPikeId: big.id });
      expect(small.alive).toBe(false);
      expect(small.deathCause).toBe("eaten");
      expect(small.killedBy).toBe(big.id);
      expect(small.killedByLengthCm).toBe(90);
    }
    expect(eaten).toBeGreaterThan(0);
  });

  it("gape limit applies to pike", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { sim, big, small } = setup(seed, 60, 45);
      run(sim, big.id, 1);
      expect(sim.events.some((e) => e.type === "capture")).toBe(false);
      expect(sim.events.some((e) => e.type === "miss" && e.reason === "too-big" && e.preyId === small.id)).toBe(true);
      expect(small.alive).toBe(true);
    }
  });

  it("a full stomach refuses prey: a 'full' miss and the prey lives", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { sim, big, small } = setup(seed, 90, 30);
      big.stomachG = big.weight * sim.p.pike.stomachMaxFracOfWeight - 0.5; // 0.5 g of room
      run(sim, big.id, 1);
      expect(sim.events.some((e) => e.type === "capture")).toBe(false);
      expect(sim.events.some((e) => e.type === "miss" && e.reason === "full" && e.preyId === small.id)).toBe(true);
      expect(small.alive).toBe(true);
    }
  });

  it("tooFullFor: room under max(minSwallowRoomG, minSwallowRoomFrac x prey weight)", () => {
    const sim = new Simulation({ seed: 1, preyScale: 0 });
    const pk = sim.addPike(60);
    const cap = pk.weight * sim.p.pike.stomachMaxFracOfWeight;
    const { minSwallowRoomG: g, minSwallowRoomFrac: f } = sim.p.pike;
    pk.stomachG = 0;
    expect(tooFullFor(pk, 50, sim.p)).toBe(false);
    pk.stomachG = cap - 50 * f + 0.01;
    expect(tooFullFor(pk, 50, sim.p)).toBe(true);
    pk.stomachG = cap - 50 * f - 0.01;
    expect(tooFullFor(pk, 50, sim.p)).toBe(false);
    pk.stomachG = cap - g + 0.01; // a tiny fry still needs the absolute minimum
    expect(tooFullFor(pk, 2, sim.p)).toBe(true);
  });

  it("a pike never strikes itself", () => {
    const sim = new Simulation({ seed: 3, preyScale: 0 });
    const pk = sim.addPike(70);
    run(sim, pk.id, 3);
    expect(sim.events.some((e) => (e.type === "capture" || e.type === "miss") && e.preyId === pk.id)).toBe(false);
  });

  it("starvation death carries a cause", () => {
    const sim = new Simulation({ seed: 1, preyScale: 0 });
    const pk = sim.addPike(70);
    pk.weight *= 0.4;
    pk.health = 0.0001;
    for (let i = 0; i < 600 && pk.alive; i++) sim.step(1 / 60);
    expect(pk.alive).toBe(false);
    expect(pk.deathCause).toBe("starvation");
    expect(sim.events.find((e) => e.type === "death")).toMatchObject({ pikeId: pk.id, cause: "starvation" });
  });
});
