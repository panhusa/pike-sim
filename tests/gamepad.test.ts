import { describe, expect, it } from "vitest";
import { bindFrom, deadZone, detectChange, GamepadInput, PadMaps, snapshot, throttleOf } from "../src/ui/gamepad";

const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}, mapping = "standard", id = "Xbox pad") => ({
  connected: true,
  mapping,
  id,
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
});

describe("gamepad", () => {
  it("dead zone ignores drift and rescales the rest", () => {
    expect(deadZone(0.1)).toBe(0);
    expect(deadZone(-0.1)).toBe(0);
    expect(deadZone(1)).toBeCloseTo(1);
    expect(deadZone(-1)).toBeCloseTo(-1);
  });
  it("maps sticks and triggers: stick up = rise, RT swims, LT stalks", () => {
    const g = new GamepadInput(new PadMaps(null));
    const s = g.read([pad([1, -1, 0, 0], [], { 7: 0.6 })]);
    expect(s.connected).toBe(true);
    expect(s.turn).toBeCloseTo(1);
    expect(s.pitch).toBeCloseTo(1);
    expect(s.throttle).toBeCloseTo(0.6);
    expect(new GamepadInput(new PadMaps(null)).read([pad([0, 0, 0, 0], [6])]).throttle).toBeCloseTo(0.25);
  });
  it("strike, camera and pause fire once per press", () => {
    const g = new GamepadInput(new PadMaps(null));
    expect(g.read([pad([0, 0], [0, 3, 9])])).toMatchObject({ strike: true, camera: true, pause: true });
    expect(g.read([pad([0, 0], [0, 3, 9])])).toMatchObject({ strike: false, camera: false, pause: false });
    g.read([pad([0, 0])]);
    expect(g.read([pad([0, 0], [5])]).strike).toBe(true); // RB strikes too
  });
  it("reports nothing without a connected pad", () => {
    expect(new GamepadInput(new PadMaps(null)).read([null]).connected).toBe(false);
  });

  const radio = (axes: number[], pressed: number[] = []) => pad(axes, pressed, {}, "", "EdgeTX RadioMaster Joystick");
  it("a drone radio uses the Mode 2 preset: right stick steers, throttle swims from the bottom", () => {
    const g = new GamepadInput(new PadMaps(null));
    // throttle at the bottom (-1), right stick right and forward
    const s = g.read([radio([1, 1, -1, 0])]);
    expect(s.standard).toBe(false);
    expect(s.turn).toBeCloseTo(1);
    expect(s.pitch).toBeCloseTo(-1); // stick forward = dive
    expect(s.throttle).toBe(0);
    expect(g.read([radio([0, 0, 1, 0])]).throttle).toBeCloseTo(1);
    expect(g.read([radio([0, 0, 0, 0])]).throttle).toBeGreaterThan(0.4);
  });
  it("learns bindings from a stick move, a non-centring throttle and a switch on an axis", () => {
    const base = snapshot(radio([0, 0, -1, 0, -1]));
    const turn = detectChange(base, radio([0, 0, -1, -0.9, -1]))!;
    expect(bindFrom("turn", turn)).toEqual({ axis: 3, invert: true });
    const thr = detectChange(base, radio([0, 0, 1, 0, -1]), 0.8)!;
    expect(bindFrom("throttle", thr)).toEqual({ axis: 2, invert: false, full: true });
    const sw = detectChange(base, radio([0, 0, -1, 0, 1]))!;
    expect(bindFrom("strike", sw)).toEqual({ kind: "axis", axis: 4, sign: 1 });
    expect(bindFrom("turn", { kind: "button", index: 2 })).toBeNull(); // a stick action needs an axis
  });
  it("saved bindings win over the preset and fire switches once", () => {
    const maps = new PadMaps(null);
    maps.set("EdgeTX RadioMaster Joystick", { turn: { axis: 3, invert: false }, pitch: null, throttle: null, orbit: null, strike: { kind: "axis", axis: 4, sign: 1 }, camera: null, rest: null, pause: null });
    const g = new GamepadInput(maps);
    expect(g.read([radio([1, 0, 0, 0.5, -1])]).turn).toBeCloseTo(deadZone(0.5));
    expect(g.read([radio([0, 0, 0, 0, 1])]).strike).toBe(true);
    expect(g.read([radio([0, 0, 0, 0, 1])]).strike).toBe(false);
    expect(throttleOf(radio([0, 0, 0.5]), { axis: 2, invert: false, full: false })).toBeGreaterThan(0);
  });
});
