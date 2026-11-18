import { angleDiff, clamp, dist, forward, sub, dot, norm, type Vec3 } from "./math";
import type { Environment } from "./environment";
import type { Params, PreySpec } from "./params";
import type { PikeState } from "./pike";
import type { World } from "./world";

/** How hard a pike is to see: stillness and cover both hide it. 0 = fully visible, 1 = invisible. */
export function pikeCamouflage(pike: PikeState, world: World, p: Params): number {
  const still = clamp(pike.stillTime / 2.5, 0, 1) * p.pike.camouflageStillBonus;
  const cover = world.coverAt(pike.pos) * 0.45;
  return clamp(still + cover, 0, 0.92);
}

/** Per-second detection pressure a prey fish feels from a pike (visual + lateral line). */
export function preyDetectionRate(
  preyPos: Vec3,
  spec: PreySpec,
  pike: PikeState,
  env: Environment,
  world: World,
  p: Params,
): number {
  const d = dist(preyPos, pike.pos);
  const baseRange = Math.min(spec.visionRangeM, env.visibilityM * 1.1);
  let visual = 0;
  // Camouflage only shrinks the range, so beyond the base range it need not be computed.
  if (d < baseRange) {
    const camo = pikeCamouflage(pike, world, p);
    const range = baseRange * (1 - p.preyDetect.hideRangeFactor * camo);
    if (d < range) {
      const x = 1 - d / range;
      visual = x * x * (1 - p.preyDetect.hideStrengthFactor * camo);
    }
  }
  // Vibration: a fast-moving body pushes a pressure wave the prey's lateral line feels.
  const vibRange = 0.8 + 1.1 * pike.speed * (pike.lengthCm / 60);
  const vib = d < vibRange && pike.speed > 0.3 ? 1 - d / vibRange : 0;
  return (visual * 2.2 + vib * 1.8) * (0.4 + spec.wariness);
}

export interface SensedPrey {
  index: number;
  distance: number;
  kind: "visual" | "vibration";
  bearing: number; // radians relative to pike heading, + = left
  clarity: number; // 0..1 how well the pike has the target
}

/**
 * What a pike perceives of a target: vision inside a wide-angle cone limited by
 * water clarity, binocular (accurate) only in the narrow forward cone;
 * lateral line catches nearby movers from any direction.
 */
export function pikeSenses(
  pike: PikeState,
  target: { pos: Vec3; speed: number; lengthCm: number; inCover: number },
  env: Environment,
  p: Params,
): Omit<SensedPrey, "index"> | null {
  const toT = sub(target.pos, pike.pos);
  const d = Math.hypot(toT.x, toT.y, toT.z);
  const f = forward(pike.yaw, pike.pitch);
  const cosAng = d > 1e-6 ? dot(f, norm(toT)) : 1;
  const ang = Math.acos(clamp(cosAng, -1, 1));
  const yawToT = Math.atan2(toT.z, toT.x);
  const bearing = angleDiff(yawToT, pike.yaw);

  const vis = Math.min(p.pike.visionRangeM, env.visibilityM);
  if (ang < p.pike.visionHalfAngleRad && d < vis) {
    // Small, still, covered targets are harder to resolve.
    const size = clamp(target.lengthCm / 15, 0.5, 1.4);
    const motion = 0.6 + 0.4 * clamp(target.speed / 0.5, 0, 1);
    let clarity = (1 - d / vis) * size * motion * (1 - 0.6 * target.inCover);
    if (ang < p.pike.binocularHalfAngleRad) clarity *= 1.4;
    clarity = clamp(clarity, 0, 1);
    if (clarity > 0.08) return { distance: d, kind: "visual", bearing, clarity };
  }
  const llRange = p.pike.lateralLineRangeBL * (pike.lengthCm / 100) * 2.5;
  if (d < llRange && target.speed > 0.15) {
    return { distance: d, kind: "vibration", bearing, clarity: clamp(0.5 * (1 - d / llRange) + 0.2, 0, 0.7) };
  }
  return null;
}
