import { angleDiff, clamp, v3, type Vec3 } from "./math";
import { lungeCandidate, lungeRange } from "./lunge";
import { hunger, lengthM, type PikeInput, type PikeState } from "./pike";
import { preySpeed } from "./prey";
import { pikeSenses } from "./sensing";
import type { Simulation } from "./simulation";

export type RivalMode = "hold" | "hunt" | "patrol" | "flee" | "rest";

export interface RivalMemory {
  mode: RivalMode;
  home: Vec3;
  targetId: number | null;
  lostS: number; // seconds the current target has gone unsensed
  noTargetS: number; // seconds spent hungry without any target
  patrolTo: Vec3 | null;
  fleeS: number; // committed flight time left
  fleeFrom: Vec3 | null; // last sensed threat position
}

export function makeRivalMemory(home: Vec3): RivalMemory {
  return { mode: "hold", home: { ...home }, targetId: null, lostS: 0, noTargetS: 0, patrolTo: null, fleeS: 0, fleeFrom: null };
}

const coverCache = new WeakMap<Simulation["world"], Vec3[]>();

/** Cover points: centres of reed and weed patches dense enough to hide in (the world is static, so cached). */
export function coverPoints(sim: Simulation): Vec3[] {
  const w = sim.world;
  const cached = coverCache.get(w);
  if (cached) return cached;
  const maxR = w.size / 2 - sim.p.rival.coverEdgeMarginM;
  const out: Vec3[] = [];
  const consider = (x: number, z: number, y: number): void => {
    if (Math.hypot(x, z) > maxR) return;
    const floor = w.bottomY(x, z);
    const pos = v3(x, Math.min(-sim.p.rival.homeSurfaceClearanceM, Math.max(y, floor + sim.p.rival.homeFloorClearanceM)), z);
    if (w.coverAt(pos) >= sim.p.rival.homeMinCover) out.push(pos);
  };
  for (const r of w.reeds) consider(r.x, r.z, -r.height * 0.5);
  for (const k of w.weeds) consider(k.x, k.z, w.bottomY(k.x, k.z) + k.height * 0.5);
  coverCache.set(w, out);
  return out;
}

/** A new cover point away from the homes of rivals that are not much smaller than `pk`. */
export function pickHome(sim: Simulation, pk: PikeState): Vec3 {
  const k = sim.p.rival;
  const peers: Vec3[] = [];
  for (const o of sim.pikes) {
    if (o === pk || !o.alive || !o.ai) continue;
    if (o.lengthCm >= pk.lengthCm / k.fleeSizeRatio) peers.push(o.ai.home);
  }
  const clearance = (c: Vec3): number => {
    let m = Infinity;
    for (const h of peers) m = Math.min(m, Math.hypot(c.x - h.x, c.z - h.z));
    return m;
  };
  const points = coverPoints(sim);
  if (points.length === 0) return { ...pk.pos };
  const free = points.filter((c) => clearance(c) >= k.territoryRadiusM);
  if (free.length > 0) return { ...free[sim.rng.int(0, free.length - 1)]! };
  let best = points[0]!;
  let bestD = -1;
  for (const c of points) {
    const d = clearance(c);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return { ...best };
}

function steer(sim: Simulation, pk: PikeState, to: Vec3, throttle: number, burst = false): PikeInput {
  const gain = sim.p.rival.steerGain;
  const dx = to.x - pk.pos.x;
  const dz = to.z - pk.pos.z;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(to.y - pk.pos.y, Math.hypot(dx, dz)) - pk.pitch;
  return { throttle, yawRate: clamp(yawErr * gain, -1, 1), pitchRate: clamp(pitchErr * gain, -1, 1), burst };
}

/**
 * Decide this tick's input for a rival. Perception is limited to `pikeSenses` hits;
 * the rival never reads positions of things it cannot sense. Mutates `pk.ai`.
 */
export function rivalInput(sim: Simulation, pk: PikeState, dt: number): PikeInput {
  const ai = pk.ai!;
  const k = sim.p.rival;
  const pp = sim.p.pike;
  const env = sim.env;
  const world = sim.world;
  const aggression = sim.settings.aggression;
  const ownLen = lengthM(pk);
  const gape = pp.maxPreyLengthFracOfBL * pk.lengthCm;
  const senseR = Math.max(Math.min(pp.visionRangeM, env.visibilityM), pp.lateralLineRangeBL * ownLen * k.senseLateralFactor);
  const senseR2 = senseR * senseR;

  let threat: Vec3 | null = null;
  let threatD = Infinity;
  let best: { id: number; pos: Vec3; d: number; score: number } | null = null;
  let current: { pos: Vec3; d: number } | null = null;

  const consider = (id: number, pos: Vec3, speed: number, lengthCm: number, isPike: boolean): void => {
    const dx = pos.x - pk.pos.x;
    const dy = pos.y - pk.pos.y;
    const dz = pos.z - pk.pos.z;
    if (dx * dx + dy * dy + dz * dz > senseR2) return;
    const sensed = pikeSenses(pk, { pos, speed, lengthCm, inCover: world.coverAt(pos) }, env, sim.p);
    if (!sensed) return;
    const d = sensed.distance;
    if (isPike && lengthCm >= pk.lengthCm * k.fleeSizeRatio && d <= k.fleeRangeM && d < threatD) {
      threat = pos;
      threatD = d;
    }
    if (lengthCm > gape) return;
    if (id === ai.targetId) current = { pos, d };
    const score = (isPike ? aggression : 1) * sensed.clarity / (1 + d);
    if (!best || score > best.score) best = { id, pos, d, score };
  };

  for (const f of sim.prey) if (f.alive) consider(f.id, f.pos, preySpeed(f), f.lengthCm, false);
  for (const o of sim.pikes) if (o.alive && o !== pk) consider(o.id, o.pos, o.speed, o.lengthCm, true);

  // Target memory: keep a sensed target, drop it after it stays unsensed for loseTargetS.
  const cur = current as { pos: Vec3; d: number } | null;
  const bst = best as { id: number; pos: Vec3; d: number; score: number } | null;
  let target: { pos: Vec3; d: number } | null = null;
  if (cur) {
    target = cur;
    ai.lostS = 0;
  } else if (ai.targetId !== null) {
    ai.lostS += dt;
    if (ai.lostS > k.loseTargetS) {
      ai.targetId = null;
      ai.lostS = 0;
    }
  }
  if (!target && ai.targetId === null && bst) {
    ai.targetId = bst.id;
    target = bst;
  }

  // --- flee: top priority; committed for fleeCommitS after the last sighting ---
  const thr = threat as Vec3 | null;
  if (thr) {
    ai.fleeFrom = { ...thr };
    ai.fleeS = k.fleeCommitS;
  } else if (ai.fleeS > 0) {
    ai.fleeS -= dt;
  }
  if (ai.fleeS > 0 && ai.fleeFrom) {
    ai.mode = "flee";
    ai.targetId = null;
    const ax = pk.pos.x - ai.fleeFrom.x;
    const az = pk.pos.z - ai.fleeFrom.z;
    const an = Math.hypot(ax, az) || 1;
    const hx = ai.home.x - pk.pos.x;
    const hz = ai.home.z - pk.pos.z;
    const hn = Math.hypot(hx, hz) || 1;
    const bias = k.fleeHomeBias;
    const look = k.fleeLookaheadM;
    const away = v3(pk.pos.x + (ax / an + bias * (hx / hn)) * look, pk.pos.y, pk.pos.z + (az / an + bias * (hz / hn)) * look);
    return steer(sim, pk, away, 1, true);
  }
  ai.fleeFrom = null;

  const hungry = hunger(pk, sim.p, env.tempC) > k.huntAppetite / aggression;
  if (!hungry) {
    ai.noTargetS = 0;
    ai.patrolTo = null;
  }

  if (hungry) {
    if (target) {
      ai.mode = "hunt";
      ai.noTargetS = 0;
      ai.patrolTo = null;
      // cheap range pre-check (target.d is from the body centre, the mouth is L/2 ahead): the full lunge scan only runs once the target is near
      const near = target.d <= lungeRange(pk, sim.p) + 0.5 * ownLen;
      const close = near && ai.targetId !== null && lungeCandidate(sim, pk)?.id === ai.targetId;
      const input = steer(sim, pk, target.pos, close ? 0 : k.stalkThrottle);
      input.burst = close;
      return input;
    }
    ai.noTargetS += dt;
    if (ai.patrolTo || ai.noTargetS >= k.patrolAfterS) {
      ai.mode = "patrol";
      if (!ai.patrolTo) ai.patrolTo = pickHome(sim, pk);
      if (Math.hypot(ai.patrolTo.x - pk.pos.x, ai.patrolTo.z - pk.pos.z) < k.patrolArriveM) {
        ai.home = ai.patrolTo;
        ai.patrolTo = null;
        ai.noTargetS = 0;
        ai.mode = "hunt";
        return steer(sim, pk, ai.home, 0);
      }
      return steer(sim, pk, ai.patrolTo, k.patrolThrottle);
    }
    ai.mode = "hunt";
    if (ai.targetId !== null) return { throttle: k.stalkThrottle, yawRate: 0, pitchRate: 0, burst: false };
    return atHome(sim, pk, ai.home);
  }

  if (env.light < k.restLight && hunger(pk, sim.p, env.tempC) < k.restAppetite) {
    ai.mode = "rest";
    return atHome(sim, pk, ai.home);
  }
  ai.mode = "hold";
  return atHome(sim, pk, ai.home);
}

/** Steer to home and go still within arrival range. */
function atHome(sim: Simulation, pk: PikeState, home: Vec3): PikeInput {
  const d = Math.hypot(home.x - pk.pos.x, home.z - pk.pos.z);
  if (d < sim.p.rival.homeArriveM) return { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
  return steer(sim, pk, home, sim.p.rival.homeThrottle);
}

