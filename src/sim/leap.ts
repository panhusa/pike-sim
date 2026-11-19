/**
 * Game only: a human pike that hits the surface fast and nose-up leaves the water and flies a ballistic
 * arc, snapping hovering mayflies on the way, then splashes back in. Pure physics on the pike state,
 * so the multiplayer guest can run it for its own predicted pike too (with `eat` off).
 */
import { forward, type Vec3 } from "./math";
import type { PikeState } from "./pike";
import type { Simulation } from "./simulation";

export const LEAP = {
  /** upward speed (m/s) at the surface needed to break out */
  minRiseMS: 0.9,
  /** game boost on the launch speed so a leap clears the mayfly zone */
  boost: 1.6,
  maxLaunchMS: 5.5,
  gravity: 9.81,
  /** mouth reach for a mayfly while airborne (m) */
  snapM: 0.3,
  /** speed kept when diving back in */
  reentryKeep: 0.6,
};

export interface Airborne {
  vel: Vec3;
  t: number;
}

export type LeapEvent = { type: "leap"; pikeId: number; t: number } | { type: "splash"; pikeId: number; pos: Vec3; t: number };

/** Should this pike, just stepped underwater, break the surface now? Returns the launch velocity. */
export function leapLaunch(pk: PikeState): Vec3 | null {
  if (pk.pos.y < -0.12) return null;
  const f = forward(pk.yaw, pk.pitch);
  const rise = f.y * pk.speed;
  if (rise < LEAP.minRiseMS) return null;
  const sp = Math.min(LEAP.maxLaunchMS, pk.speed * LEAP.boost);
  return { x: f.x * sp, y: Math.max(f.y * sp, rise * LEAP.boost), z: f.z * sp };
}

/**
 * One airborne step: gravity, nose follows the arc. Returns true when the pike lands back in the water
 * this step (and has been put just under the surface with some forward speed).
 */
export function stepAirborne(pk: PikeState, a: Airborne, dt: number): boolean {
  a.t += dt;
  a.vel.y -= LEAP.gravity * dt;
  pk.pos.x += a.vel.x * dt;
  pk.pos.y += a.vel.y * dt;
  pk.pos.z += a.vel.z * dt;
  const h = Math.hypot(a.vel.x, a.vel.z);
  pk.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(a.vel.y, Math.max(h, 1e-3))));
  pk.speed = Math.hypot(h, a.vel.y);
  if (pk.pos.y > 0 || a.vel.y > 0) return false;
  pk.pos.y = -0.15;
  pk.speed *= LEAP.reentryKeep;
  pk.pitch = Math.max(-0.9, pk.pitch);
  return true;
}

/** Simulation hook for arcade humans. Returns true while the pike is out of the water (skip confine). */
export function leapStep(sim: Simulation, pk: PikeState, dt: number, eat: boolean): boolean {
  let a = sim.airborne.get(pk.id);
  if (!a) {
    const v = leapLaunch(pk);
    if (!v) return false;
    a = { vel: v, t: 0 };
    sim.airborne.set(pk.id, a);
    pk.pos.y = Math.max(pk.pos.y, 0.01);
    sim.events.push({ type: "leap", pikeId: pk.id, t: sim.time } as never);
    return true;
  }
  const landed = stepAirborne(pk, a, dt);
  if (eat) {
    const f = forward(pk.yaw, pk.pitch);
    const L = pk.lengthCm / 100;
    const mouth = { x: pk.pos.x + f.x * L * 0.5, y: pk.pos.y + f.y * L * 0.5, z: pk.pos.z + f.z * L * 0.5 };
    const bug = sim.extras.eatInsectAt(mouth, LEAP.snapM, true);
    if (bug) sim.feedInsect(pk, bug);
  }
  if (landed) {
    sim.airborne.delete(pk.id);
    sim.events.push({ type: "splash", pikeId: pk.id, pos: { ...pk.pos }, t: sim.time } as never);
  }
  return !landed;
}
