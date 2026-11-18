import { describe, expect, it } from "vitest";
import { calibrate, joystickToInput, tiltToRates, type TiltCal } from "../src/ui/tilt";

const RAD = Math.PI / 180;
/**
 * W3C (beta, gamma) for a physical pose, independent of src/ui/tilt: the screen top tilted back
 * `pitch` deg from flat, then the screen's right edge `roll` deg below horizontal, at a screen angle
 * (counter-clockwise device rotation). Conventions: flat = (0, 0); upright portrait = beta 90;
 * gamma > 0 = right edge down; beta in [-180, 180), gamma in [-90, 90).
 */
function euler(pitch: number, roll: number, screenAngle: number): [number, number] {
  const xs = -Math.sin(roll * RAD);
  const ys = Math.cos(roll * RAD) * Math.sin(pitch * RAD);
  const zs = Math.cos(roll * RAD) * Math.cos(pitch * RAD);
  const a = screenAngle * RAD;
  const ux = xs * Math.cos(a) + ys * Math.sin(a);
  const uy = -xs * Math.sin(a) + ys * Math.cos(a);
  const sgn = zs < 0 ? -1 : 1; // sign of cos(beta), since cos(gamma) >= 0
  const cb = sgn * Math.hypot(ux, zs);
  return [Math.atan2(uy, cb) / RAD, Math.atan2(-ux / cb, zs / cb) / RAD];
}
const at = (pitch: number, roll: number, a: number, cal: TiltCal) => tiltToRates(...euler(pitch, roll, a), cal);

const portrait = calibrate(60, 0, 0);
const flat = calibrate(0, 0, 0);
// Landscape held 70 deg back from flat. At angle 90 the device top points left, so the screen top is
// the device's right edge, raised: gamma -70. At 270 it is the left edge: gamma +70.
const land = calibrate(0, -70, 90);
const land270 = calibrate(0, 70, 270);

describe("euler test helper", () => {
  it("matches the W3C reference poses", () => {
    expect(euler(0, 0, 0).map((v) => v + 0)).toEqual([0, 0]);
    expect(euler(90, 0, 0)[0]).toBeCloseTo(90);
    expect(euler(0, 30, 0)[1]).toBeCloseTo(30); // right edge down
    expect(euler(70, 0, 90)[1]).toBeCloseTo(-70);
    expect(euler(70, 0, 270)[1]).toBeCloseTo(70);
    const past = euler(95, 0, 90); // beyond vertical, leaning toward the user
    expect(past[0]).toBeCloseTo(180);
    expect(past[1]).toBeCloseTo(85);
  });
});

/** Pitch sweep 40..120 deg (through vertical) in 0.5 deg steps. */
const sweep = <T,>(f: (pitch: number) => T): T[] => Array.from({ length: 161 }, (_, i) => f(40 + i * 0.5));
/** Never falls, never jumps: each 0.5 deg step changes the rate by under 0.05. */
function expectSmoothRise(xs: number[]): void {
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
    expect(xs[i]! - xs[i - 1]!).toBeLessThan(0.05);
  }
}

describe("tiltToRates", () => {
  it("is zero inside the dead zone", () => {
    expect(tiltToRates(62, 3, portrait)).toEqual({ yawRate: 0, pitchRate: 0 });
    expect(tiltToRates(57, -3.9, portrait)).toEqual({ yawRate: 0, pitchRate: 0 });
  });
  it("reaches +-1 at fullDeg and clamps beyond", () => {
    expect(tiltToRates(0, 25, flat).yawRate).toBeCloseTo(1);
    expect(tiltToRates(0, 14.5, flat).yawRate).toBeCloseTo(0.5, 1);
    expect(at(60, -80, 0, portrait).yawRate).toBe(-1);
    expect(tiltToRates(60 + 90, 0, portrait).pitchRate).toBe(1);
    expect(at(60, 14.5, 0, portrait).yawRate).toBeCloseTo(0.5, 1);
  });
  it("tilting right gives the same sign as mouse-right (positive yaw); top away dives (negative pitch)", () => {
    expect(tiltToRates(60, 15, portrait).yawRate).toBeGreaterThan(0);
    expect(tiltToRates(60, -15, portrait).yawRate).toBeLessThan(0);
    expect(tiltToRates(45, 0, portrait).pitchRate).toBeLessThan(0);
    expect(tiltToRates(75, 0, portrait).pitchRate).toBeGreaterThan(0);
  });
  it("landscape at 90: rotating clockwise (device top up) turns right, top away dives", () => {
    const r = tiltToRates(15, -70, land);
    expect(r.yawRate).toBeGreaterThan(0);
    expect(r.pitchRate).toBe(0);
    expect(tiltToRates(-15, -70, land).yawRate).toBeLessThan(0);
    const d = tiltToRates(0, -55, land);
    expect(d.yawRate).toBe(0);
    expect(d.pitchRate).toBeLessThan(0);
  });
  it("the neutral landscape pose reaches full dive and full climb (through vertical)", () => {
    expect(tiltToRates(0, -45, land)).toEqual({ yawRate: 0, pitchRate: -1 });
    expect(tiltToRates(180, 85, land).yawRate).toBeCloseTo(0);
    expect(tiltToRates(180, 85, land).pitchRate).toBeCloseTo(1); // 95 deg: past vertical
  });
  it("is continuous across gamma +-90 in landscape (no wrap at vertical)", () => {
    // gamma -89 and the post-vertical (beta 180, gamma 89) are 2 deg apart physically
    const before = tiltToRates(0, -89, land);
    const after = tiltToRates(180, 89, land);
    expect(Math.abs(after.pitchRate - before.pitchRate)).toBeLessThan(0.1);
    expect(before.yawRate).toBeCloseTo(0);
    expect(after.yawRate).toBeCloseTo(0);
    for (const [a, cal] of [[90, land], [270, land270]] as const) {
      const rs = sweep((pitch) => at(pitch, 0, a, cal));
      expect(rs[0]!.pitchRate).toBe(-1);
      expect(rs.at(-1)!.pitchRate).toBe(1);
      for (const r of rs) expect(r.yawRate).toBeCloseTo(0);
      expectSmoothRise(rs.map((r) => r.pitchRate));
    }
  });
  it("steering keeps its sign through vertical in landscape", () => {
    for (const pitch of [80, 88, 92, 100]) {
      expect(at(pitch, 15, 90, land).yawRate).toBeGreaterThan(0);
      expect(at(pitch, -15, 90, land).yawRate).toBeLessThan(0);
      expect(at(pitch, 15, 270, land270).yawRate).toBeGreaterThan(0);
    }
  });
  it("the 270 degree orientation mirrors 90", () => {
    expect(tiltToRates(-15, 70, land270).yawRate).toBeGreaterThan(0);
    expect(tiltToRates(15, 70, land270).yawRate).toBeLessThan(0);
    expect(tiltToRates(0, 55, land270).pitchRate).toBeLessThan(0);
    expect(tiltToRates(0, 85, land270).pitchRate).toBeGreaterThan(0);
  });
  it("is continuous across beta 90 in portrait", () => {
    const rs = sweep((pitch) => at(pitch, 0, 0, portrait));
    expectSmoothRise(rs.map((r) => r.pitchRate));
  });
  it("calibrate makes the current pose neutral", () => {
    const cal = calibrate(33, -12, 0);
    expect(tiltToRates(33, -12, cal)).toEqual({ yawRate: 0, pitchRate: 0 });
    const cl = calibrate(-8, -64, 90);
    expect(tiltToRates(-8, -64, cl)).toEqual({ yawRate: 0, pitchRate: 0 });
    const c2 = calibrate(180, 80, 90);
    expect(tiltToRates(180, 80, c2)).toEqual({ yawRate: 0, pitchRate: 0 });
  });
});

describe("joystickToInput", () => {
  it("has a dead zone below 0.15", () => {
    expect(joystickToInput(0.1, 0.05)).toEqual({ yawRate: 0, pitchRate: 0, throttle: 0 });
  });
  it("stalks below 0.5, full throttle above", () => {
    expect(joystickToInput(0.3, 0).throttle).toBe(0.25);
    expect(joystickToInput(0.8, 0).throttle).toBe(1);
  });
  it("steers right with positive x", () => {
    expect(joystickToInput(0.8, 0).yawRate).toBeGreaterThan(0);
    expect(joystickToInput(-0.8, 0).yawRate).toBeLessThan(0);
  });
  it("normalises vectors beyond the unit circle", () => {
    expect(joystickToInput(3, 0)).toEqual({ yawRate: 1, pitchRate: 0, throttle: 1 });
  });
  it("never pitches: full up or down swims level at full throttle", () => {
    expect(joystickToInput(0, -1)).toEqual({ yawRate: 0, pitchRate: 0, throttle: 1 });
    expect(joystickToInput(0, 1)).toEqual({ yawRate: 0, pitchRate: 0, throttle: 1 });
  });
});
