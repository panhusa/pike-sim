import { describe, expect, it } from "vitest";
import { deadZone, GamepadInput } from "../src/ui/gamepad";

const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}) => ({
  connected: true,
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
    const g = new GamepadInput();
    const s = g.read([pad([1, -1, 0, 0], [], { 7: 0.6 })]);
    expect(s.connected).toBe(true);
    expect(s.turn).toBeCloseTo(1);
    expect(s.pitch).toBeCloseTo(1);
    expect(s.throttle).toBeCloseTo(0.6);
    expect(new GamepadInput().read([pad([0, 0, 0, 0], [6])]).throttle).toBeCloseTo(0.25);
  });
  it("strike, camera and pause fire once per press", () => {
    const g = new GamepadInput();
    expect(g.read([pad([0, 0], [0, 3, 9])])).toMatchObject({ strike: true, camera: true, pause: true });
    expect(g.read([pad([0, 0], [0, 3, 9])])).toMatchObject({ strike: false, camera: false, pause: false });
    g.read([pad([0, 0])]);
    expect(g.read([pad([0, 0], [5])]).strike).toBe(true); // RB strikes too
  });
  it("reports nothing without a connected pad", () => {
    expect(new GamepadInput().read([null]).connected).toBe(false);
  });
});
