import { angleDiff, clamp, dot, forward, norm, sub, v3, type Vec3 } from "./math";
import { pikeSenses } from "./sensing";
import { preySpeed } from "./prey";
import type { PikeInput, PikeState } from "./pike";
import type { Params } from "./params";
import type { Simulation } from "./simulation";
import { LURE_LENGTH_CM } from "./extras";

export interface LungeTarget {
  id: number;
  kind: "prey" | "pike" | "insect" | "lure";
  pos: Vec3;
  distance: number; // m, from the pike's mouth
  edible: boolean;
  inRange: boolean;
  inCone: boolean;
}

/** Lunge reach from the mouth: body lengths, but never under the absolute floor (small pike still lunge ~1 m). */
export function lungeRange(pk: PikeState, p: Params): number {
  return Math.max(p.pike.lungeRangeBL * (pk.lengthCm / 100), p.pike.lungeMinRangeM);
}

/** Sensed targets around a pike, best lunge target first. Only what pikeSenses perceives is listed. */
export function lungeTargets(sim: Simulation, pk: PikeState): LungeTarget[] {
  const p = sim.paramsFor(pk);
  const L = pk.lengthCm / 100;
  const f = forward(pk.yaw, pk.pitch);
  const mouth = v3(pk.pos.x + f.x * L * 0.5, pk.pos.y + f.y * L * 0.5, pk.pos.z + f.z * L * 0.5);
  const range = lungeRange(pk, p);
  const maxLen = p.pike.maxPreyLengthFracOfBL * pk.lengthCm;
  const scored: { t: LungeTarget; score: number }[] = [];

  const consider = (id: number, kind: LungeTarget["kind"], pos: Vec3, speed: number, lengthCm: number): void => {
    if (kind === "insect") {
      // a silhouette on the bright surface: seen within a few metres, inside the vision cone
      const d = Math.hypot(pos.x - pk.pos.x, pos.y - pk.pos.y, pos.z - pk.pos.z);
      if (d > Math.min(6, sim.env.visibilityM)) return;
    } else {
      const sensed = pikeSenses(pk, { pos, speed, lengthCm, inCover: kind === "lure" ? 0 : sim.world.coverAt(pos) }, sim.env, p);
      if (!sensed) return;
    }
    const toT = sub(pos, mouth);
    const distance = Math.hypot(toT.x, toT.y, toT.z);
    const cosAngle = distance > 1e-6 ? dot(f, norm(toT)) : 1;
    const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
    const t: LungeTarget = {
      id,
      kind,
      pos,
      distance,
      edible: lengthCm <= maxLen,
      inRange: distance <= range,
      inCone: angle <= p.pike.lungeConeRad,
    };
    scored.push({ t, score: cosAngle * 1.0 - (distance / range) * 0.5 });
  };

  for (const prey of sim.prey) if (prey.alive) consider(prey.id, "prey", prey.pos, preySpeed(prey), prey.lengthCm);
  for (const o of sim.pikes) if (o.alive && o !== pk) consider(o.id, "pike", o.pos, o.speed, o.lengthCm);
  if (sim.arcade && sim.isHuman(pk)) {
    const lure = sim.extras.lureLive();
    if (lure) consider(lure.id, "lure", lure.pos, 0.9, LURE_LENGTH_CM);
    const nearSurface = pk.pos.y > -0.6;
    for (const f of sim.extras.insects) if (!f.aloft || nearSurface) consider(f.id, "insect", f.pos, 0.1, 1);
  }

  return scored.sort((a, b) => b.score - a.score || a.t.id - b.t.id).map((s) => s.t);
}

/** Best target that can actually be lunged at now: edible, in range and inside the cone. */
export function lungeCandidate(sim: Simulation, pk: PikeState): LungeTarget | null {
  return lungeTargets(sim, pk).find((t) => t.edible && t.inRange && t.inCone) ?? null;
}

const HOMING_GAIN = 4;

/** Committed-lunge steering: turn toward the target, no throttle, burst held. */
export function homingInput(pk: PikeState, target: Vec3): PikeInput {
  const dx = target.x - pk.pos.x;
  const dy = target.y - pk.pos.y;
  const dz = target.z - pk.pos.z;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pk.pitch;
  return {
    throttle: 0,
    yawRate: clamp(yawErr * HOMING_GAIN, -1, 1),
    pitchRate: clamp(pitchErr * HOMING_GAIN, -1, 1),
    burst: true,
  };
}
