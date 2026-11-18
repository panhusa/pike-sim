import { describe, expect, it } from "vitest";
import type { SimEvent } from "../src/sim/simulation";
import { BurstOutcomes } from "../src/ui/outcome";

const strike = (lockId: number | null): SimEvent => ({ type: "strike", pikeId: 1, lockId, t: 0 });
const miss = (preyId: number, reason: "evaded" | "too-big" | "off-axis"): SimEvent => ({ type: "miss", pikeId: 1, preyId, reason, t: 0 });
const capture = (preyId: number): SimEvent => ({ type: "capture", pikeId: 1, preyId, kind: "roach", grams: 5, lengthCm: 9, t: 0 });
const empty: SimEvent = { type: "strike-empty", pikeId: 1, t: 0 };

function burst(lockId: number | null, events: SimEvent[]): SimEvent | null {
  const b = new BurstOutcomes();
  expect(b.push(strike(lockId))).toBeNull();
  for (const e of events) expect(b.push(e)).toBeNull();
  return b.end(false);
}

describe("BurstOutcomes: one outcome line per burst", () => {
  it("a capture beats every miss of the same burst", () => {
    expect(burst(7, [miss(3, "too-big"), miss(7, "evaded"), capture(4)])).toMatchObject({ type: "capture", preyId: 4 });
  });
  it("the miss on the locked target beats earlier misses on bystanders", () => {
    expect(burst(7, [miss(3, "too-big"), miss(7, "evaded")])).toMatchObject({ type: "miss", preyId: 7, reason: "evaded" });
  });
  it("without a lock miss, the first miss is reported", () => {
    expect(burst(7, [miss(3, "too-big"), miss(5, "evaded")])).toMatchObject({ preyId: 3, reason: "too-big" });
    expect(burst(null, [miss(5, "off-axis"), miss(3, "evaded")])).toMatchObject({ preyId: 5, reason: "off-axis" });
  });
  it("an empty burst reports strike-empty", () => {
    expect(burst(null, [empty])).toEqual(empty);
  });
  it("waits while the burst runs and reports once", () => {
    const b = new BurstOutcomes();
    b.push(strike(7));
    b.push(miss(3, "too-big"));
    expect(b.end(true)).toBeNull();
    b.push(miss(7, "evaded"));
    expect(b.end(false)).toMatchObject({ preyId: 7 });
    expect(b.end(false)).toBeNull();
  });
  it("a new strike reports the previous burst first", () => {
    const b = new BurstOutcomes();
    b.push(strike(7));
    b.push(miss(3, "too-big"));
    expect(b.push(strike(9))).toMatchObject({ preyId: 3 });
    b.push(capture(9));
    expect(b.end(false)).toMatchObject({ type: "capture", preyId: 9 });
  });
  it("ignores unrelated events", () => {
    const b = new BurstOutcomes();
    expect(b.push({ type: "bolt", preyId: 3, pikeDistance: 1, t: 0 })).toBeNull();
    expect(b.end(false)).toBeNull();
  });
});
