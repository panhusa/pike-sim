import { describe, expect, it } from "vitest";
import { HINT_TEXT, TOUCH_HINT_TEXT, nextHint, type HintId } from "../src/ui/hints";
import { computeMarks } from "../src/ui/markers";
import type { LungeTarget } from "../src/sim/lunge";

const tgt = (id: number, over: Partial<LungeTarget> = {}): LungeTarget => ({
  id,
  kind: "prey",
  pos: { x: id, y: 0, z: 0 },
  distance: 1,
  edible: true,
  inRange: true,
  inCone: true,
  ...over,
});
const proj = (p: { x: number }) => ({ x: p.x * 10, y: 5, visible: p.x !== 99 });

describe("nextHint", () => {
  const base = { done: false, stillTime: 0, inCover: true, hasStrikeMark: false };
  it("is null once done", () => expect(nextHint({ ...base, done: true, inCover: false })).toBeNull());
  it("asks to chase when out of cover", () => expect(nextHint({ ...base, inCover: false })).toBe("hide"));
  it("prompts a strike even out of cover", () => expect(nextHint({ ...base, inCover: false, hasStrikeMark: true })).toBe("strike"));
  it("prompts a strike when a strike mark exists", () => expect(nextHint({ ...base, hasStrikeMark: true })).toBe("strike"));
  it("otherwise waits", () => expect(nextHint(base)).toBe("wait"));
});

describe("touch hints", () => {
  it("has touch wording for every hint and no keyboard references", () => {
    for (const id of Object.keys(HINT_TEXT) as HintId[]) {
      expect(TOUCH_HINT_TEXT[id]).toBeTruthy();
      expect(TOUCH_HINT_TEXT[id]).not.toMatch(/\bW\b|Space/);
    }
    expect(HINT_TEXT.hide).toContain("chase");
  });
});

describe("computeMarks", () => {
  it("maps tones", () => {
    const m = computeMarks(
      [tgt(1), tgt(2, { inCone: false }), tgt(3, { edible: false }), tgt(4, { edible: false, inRange: false })],
      proj,
      5,
    );
    expect(m.map((x) => x.tone)).toEqual(["strike", "edible", "big", "big"]);
  });
  it("marks only the first as primary", () => {
    const m = computeMarks([tgt(1), tgt(2)], proj, 5);
    expect(m.map((x) => x.primary)).toEqual([true, false]);
  });
  it("gives the big ring to the strike candidate, not to a better-scored inedible fish", () => {
    const m = computeMarks([tgt(1, { edible: false }), tgt(2, { inCone: false }), tgt(3)], proj, 5);
    expect(m.filter((x) => x.primary).map((x) => x.id)).toEqual([3]);
  });
  it("without a strike candidate the best visible target is primary", () => {
    const m = computeMarks([tgt(99), tgt(1, { edible: false }), tgt(2, { inCone: false })], proj, 5);
    expect(m.filter((x) => x.primary).map((x) => x.id)).toEqual([1]);
  });
  it("keeps the strike candidate even when the cap is full of better-scored fish", () => {
    const m = computeMarks([...[1, 2, 3, 4, 5].map((i) => tgt(i, { edible: false })), tgt(6)], proj, 5);
    expect(m).toHaveLength(5);
    expect(m.find((x) => x.id === 6)).toMatchObject({ tone: "strike", primary: true });
  });
  it("drops off-screen targets", () => {
    const m = computeMarks([tgt(99), tgt(2)], proj, 5);
    expect(m.map((x) => x.id)).toEqual([2]);
  });
  it("caps at max", () => {
    expect(computeMarks([1, 2, 3, 4, 5, 6, 7].map((i) => tgt(i)), proj, 5)).toHaveLength(5);
  });
  it("projects positions", () => {
    expect(computeMarks([tgt(3)], proj, 5)[0]).toMatchObject({ id: 3, x: 30, y: 5 });
  });
});
