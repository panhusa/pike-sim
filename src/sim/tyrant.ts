import { angleDiff, clamp, type Vec3 } from "./math";
import { lungeRange } from "./lunge";
import type { PikeInput, PikeState } from "./pike";
import type { Simulation } from "./simulation";

/**
 * Game boss (stage-8 trial): the Old Tyrant, a pike a quarter longer than its target. It circles the
 * target, charges every few seconds, and backs off after landing a strike or taking a bite. The target
 * drives it off with TYRANT.hp bites, each from a separate burst. Transient game state, not saved;
 * host-authoritative (guests see a normal pike plus the events).
 */
export interface Tyrant {
  id: number;
  /** the human pike it came for */
  targetId: number;
  /** bites left before it gives up */
  hp: number;
  /** seconds since it arrived */
  t: number;
  phase: "circle" | "charge" | "flee";
  /** seconds in the current phase (after the end: seconds since the end) */
  phaseT: number;
  /** `${pikeId}:${burstSerial}` of bursts that already hit it */
  hitSerials: Set<string>;
  /** how it ended, set once; it then swims off and is removed after TYRANT_LEAVE_S */
  outcome: null | "beaten" | "left" | "ate-player";
}

export const TYRANT = { hp: 3, sizeMul: 1.25, circleM: 5, chargeEveryS: 6, fleeS: 3, timeoutS: 120 };

/** After the fight ends it swims away for this long, then leaves the lake. */
export const TYRANT_LEAVE_S = 8;
/** A charge that has not landed by then turns back into circling. */
export const TYRANT_CHARGE_MAX_S = 4;
/** Spawn distance from the target (m), tried nearest the middle first. */
export const TYRANT_SPAWN_M = [14, 13, 15, 12, 16];

function steer(pk: PikeState, to: Vec3, throttle: number, burst: boolean): PikeInput {
  const dx = to.x - pk.pos.x;
  const dy = to.y - pk.pos.y;
  const dz = to.z - pk.pos.z;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pk.pitch;
  return {
    throttle: Math.abs(yawErr) > 1.2 ? Math.min(throttle, 0.5) : throttle,
    yawRate: clamp(yawErr * 3, -1, 1),
    pitchRate: clamp(pitchErr * 3, -1, 1),
    burst,
  };
}

/** Deterministic steering (no RNG): orbit, charge with a burst once in lunge reach, or swim away. */
export function tyrantInput(sim: Simulation, pk: PikeState, ty: Tyrant): PikeInput {
  const pl = sim.pikes.find((k) => k.id === ty.targetId);
  if (!pl || !pl.alive) return { throttle: 0.6, yawRate: 0, pitchRate: 0, burst: false };
  const dx = pk.pos.x - pl.pos.x;
  const dz = pk.pos.z - pl.pos.z;
  const away = Math.atan2(dz, dx);
  if (ty.outcome || ty.phase === "flee") {
    const to = { x: pk.pos.x + Math.cos(away) * 10, y: pk.pos.y, z: pk.pos.z + Math.sin(away) * 10 };
    return steer(pk, to, 1, !ty.outcome && ty.phaseT < 0.2);
  }
  if (ty.phase === "circle") {
    // a point a little further round the circle: it keeps orbiting at circleM
    const a = away + 0.5;
    const to = { x: pl.pos.x + Math.cos(a) * TYRANT.circleM, y: pl.pos.y, z: pl.pos.z + Math.sin(a) * TYRANT.circleM };
    return steer(pk, to, 0.7, false);
  }
  const L = pk.lengthCm / 100;
  const mouthD = Math.hypot(dx, pk.pos.y - pl.pos.y, dz) - L * 0.5;
  const facing = Math.abs(angleDiff(away + Math.PI, pk.yaw)) < 0.5;
  return steer(pk, pl.pos, 1, facing && mouthD <= lungeRange(pk, sim.p));
}

/** Closest point to `p` on a pike's body axis (head to tail). */
export function closestOnBody(pk: PikeState, p: Vec3): Vec3 {
  const L = pk.lengthCm / 100;
  const fx = Math.cos(pk.pitch) * Math.cos(pk.yaw);
  const fy = Math.sin(pk.pitch);
  const fz = Math.cos(pk.pitch) * Math.sin(pk.yaw);
  const s = clamp((p.x - pk.pos.x) * fx + (p.y - pk.pos.y) * fy + (p.z - pk.pos.z) * fz, -L * 0.5, L * 0.5);
  return { x: pk.pos.x + fx * s, y: pk.pos.y + fy * s, z: pk.pos.z + fz * s };
}
