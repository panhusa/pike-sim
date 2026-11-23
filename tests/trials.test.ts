import { describe, expect, it } from "vitest";
import { Challenges, CHALLENGES, type ChallengeEvent } from "../src/game/challenges";
import { TRIALS } from "../src/game/trials";

const catchE = (kind: string, t = 0, extra: object = {}): ChallengeEvent => ({ type: "catch", kind, lengthCm: 5, t, ...extra });
const run = (i: number, evs: ChallengeEvent[]) => {
  const c = new Challenges();
  c.startTrial(TRIALS[i]!);
  return evs.map((e) => c.push(e));
};

describe("trials", () => {
  it("covers stages 1-8 with Trial: text", () => {
    for (let i = 1; i <= 8; i++) {
      expect(TRIALS[i]!.trial).toBe(true);
      expect(TRIALS[i]!.text.startsWith("Trial: ")).toBe(true);
    }
  });
  it("1: three fish inside 10 s", () => {
    expect(run(1, [catchE("roach", 0), catchE("roach", 5), catchE("roach", 20)]).every((r) => r === null)).toBe(true);
    expect(run(1, [catchE("roach", 0), catchE("roach", 5), catchE("roach", 9)])[2]).not.toBeNull();
  });
  it("2: ambush only", () => {
    expect(run(2, [catchE("roach")])[0]).toBeNull();
    expect(run(2, [catchE("roach", 0, { ambush: true })])[0]).not.toBeNull();
  });
  it("3: perch", () => {
    expect(run(3, [catchE("roach")])[0]).toBeNull();
    expect(run(3, [catchE("perch")])[0]).not.toBeNull();
  });
  it("4: airborne insect", () => {
    expect(run(4, [catchE("insect"), catchE("roach", 0, { airborne: true })]).every((r) => r === null)).toBe(true);
    expect(run(4, [catchE("insect", 0, { airborne: true })])[0]).not.toBeNull();
  });
  it("5: survive hunter", () => {
    expect(run(5, [{ type: "leap" }])[0]).toBeNull();
    expect(run(5, [{ type: "hunter-survived" }])[0]).not.toBeNull();
  });
  it("6: miss resets the streak", () => {
    const f = catchE("roach");
    expect(run(6, [f, f, f, f, { type: "miss" }, f, f, f, f]).every((r) => r === null)).toBe(true);
    expect(run(6, [f, f, { type: "miss" }, f, f, f, f, f])[7]).not.toBeNull();
  });
  it("7: hook thrown", () => {
    expect(run(7, [{ type: "hook-thrown" }])[0]).not.toBeNull();
  });
  it("8: tyrant beaten", () => {
    expect(run(8, [{ type: "leap" }])[0]).toBeNull();
    expect(run(8, [{ type: "tyrant-beaten" }])[0]).not.toBeNull();
  });
});

describe("Challenges.startTrial", () => {
  it("ignores fit for a too-small pike", () => {
    const c = new Challenges();
    c.startTrial(TRIALS[7]!);
    c.fit(1);
    expect(c.current.id).toBe(TRIALS[7]!.id);
  });
  it("finishing restores the rotation index and progress", () => {
    const c = new Challenges();
    c.push(catchE("roach"));
    c.startTrial(TRIALS[3]!);
    expect(c.push(catchE("perch"))?.trial).toBe(true);
    expect(c.index).toBe(0);
    expect(c.current).toBe(CHALLENGES[0]);
    expect(c.progress).toBe(1);
  });
  it("jumping stages leaves only the newest trial", () => {
    const c = new Challenges();
    c.startTrial(TRIALS[1]!);
    c.startTrial(TRIALS[3]!);
    expect(c.current.id).toBe(TRIALS[3]!.id);
    c.push(catchE("perch"));
    expect(c.current).toBe(CHALLENGES[0]);
  });
});
