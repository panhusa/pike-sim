import type { Environment } from "./environment";
import { add, clamp, dist, len, norm, Rng, scale, sub, v3, type Vec3 } from "./math";
import type { Params, PreyKind } from "./params";
import type { PikeState } from "./pike";
import { preyDetectionRate } from "./sensing";
import type { World } from "./world";
import { weightG } from "./biology";

export interface PreyState {
  id: number;
  kind: PreyKind;
  schoolId: number;
  pos: Vec3;
  vel: Vec3;
  lengthCm: number;
  weight: number;
  alive: boolean;
  ageDays: number;
  alert: number; // 0..1, rises with detection pressure and decays when safe
  fleeTime: number; // seconds of flight remaining
  burstLeft: number;
  wanderPhase: number;
  homeDepth: number;
  coverTarget: Vec3 | null;
  forageTarget: Vec3 | null;
}

export function spawnPrey(
  id: number,
  kind: PreyKind,
  schoolId: number,
  pos: Vec3,
  lengthCm: number,
  p: Params,
  rng: Rng,
): PreyState {
  const spec = p.prey[kind];
  return {
    id,
    kind,
    schoolId,
    pos: { ...pos },
    vel: v3(rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)),
    lengthCm,
    weight: weightG(lengthCm, spec.lengthWeight),
    alive: true,
    ageDays: 0,
    alert: 0,
    fleeTime: 0,
    burstLeft: 0,
    wanderPhase: rng.range(0, 100),
    homeDepth: -rng.range(...(spec.habitat.depth as [number, number])),
    coverTarget: null,
    forageTarget: null,
  };
}

/** Centre of the nearest reed or weed patch within 25 m: where foraging and fleeing prey head. */
export function nearestCover(pos: Vec3, world: World): Vec3 | null {
  let best: Vec3 | null = null;
  let bestD = 25;
  for (const r of world.reeds) {
    const d = Math.hypot(pos.x - r.x, pos.z - r.z);
    if (d < bestD) {
      bestD = d;
      best = v3(r.x, -r.height * 0.5, r.z);
    }
  }
  for (const w of world.weeds) {
    const d = Math.hypot(pos.x - w.x, pos.z - w.z);
    if (d < bestD) {
      bestD = d;
      best = v3(w.x, world.bottomY(w.x, w.z) + w.height * 0.5, w.z);
    }
  }
  return best;
}

/** A point on the margin of the nearest reed or weed patch within 25 m, where grazing prey pass close to a pike waiting there. */
export function coverEdgePoint(pos: Vec3, world: World, rng: Rng): Vec3 | null {
  let best: { x: number; z: number; radius: number; y: (x: number, z: number) => number } | null = null;
  let bestD = 25;
  for (const r of world.reeds) {
    const d = Math.hypot(pos.x - r.x, pos.z - r.z);
    if (d < bestD) {
      bestD = d;
      best = { x: r.x, z: r.z, radius: r.radius, y: () => -r.height * 0.5 };
    }
  }
  for (const w of world.weeds) {
    const d = Math.hypot(pos.x - w.x, pos.z - w.z);
    if (d < bestD) {
      bestD = d;
      best = { x: w.x, z: w.z, radius: w.radius, y: (x, z) => world.bottomY(x, z) + w.height * 0.5 };
    }
  }
  if (!best) return null;
  const a = rng.range(0, Math.PI * 2);
  const rad = best.radius * rng.range(0.7, 1.1);
  const x = best.x + Math.cos(a) * rad;
  const z = best.z + Math.sin(a) * rad;
  return v3(x, best.y(x, z), z);
}

/** Returns true on the tick the fish bolts, so the sim can propagate the alarm to schoolmates. */
export function stepPrey(
  f: PreyState,
  mates: readonly PreyState[],
  pikes: readonly PikeState[],
  env: Environment,
  world: World,
  dt: number,
  rng: Rng,
  p: Params,
  /** How conspicuous each pike is to prey (1 = natural); the arcade player is harder to notice. */
  noticeOf?: (pk: PikeState) => number,
): boolean {
  if (!f.alive) return false;
  const spec = p.prey[f.kind];
  const L = f.lengthCm / 100;
  // Cold slows everything; fish are poikilotherms.
  const thermal = clamp(0.4 + 0.6 * (env.tempC / 15), 0.3, 1.2);

  // --- threat assessment ---
  let pressure = 0;
  let threat: PikeState | null = null;
  let worst = 0;
  for (const pk of pikes) {
    if (!pk.alive) continue;
    const r = preyDetectionRate(f.pos, spec, pk, env, world, p) * (noticeOf ? noticeOf(pk) : 1);
    pressure += r;
    if (r > worst) {
      worst = r;
      threat = pk;
    }
  }
  // Weak, distant threats let alertness fade; only a real, close threat builds it.
  const PRESSURE_FLOOR = 0.35;
  f.alert = clamp(f.alert + (pressure > PRESSURE_FLOOR ? (pressure - PRESSURE_FLOOR) * 1.2 : -0.25) * dt, 0, 1);

  let bolted = false;
  if (f.fleeTime <= 0 && threat && worst > PRESSURE_FLOOR && f.alert > 0.55 - 0.25 * spec.wariness) {
    f.fleeTime = 2.5 + rng.range(0, 1.5);
    f.burstLeft = spec.burstDurationS;
    f.coverTarget = nearestCover(f.pos, world);
    bolted = true;
  }

  // --- steering ---
  let desire = v3();
  let speed = spec.cruiseBL * L * thermal;
  let response = 3;

  if (f.fleeTime > 0 && threat) {
    f.fleeTime -= dt;
    let away = norm(sub(f.pos, threat.pos));
    // Break the symmetry: flee at an angle, bias toward cover and away from the bottom.
    away = add(away, v3(rng.range(-0.3, 0.3), rng.range(-0.15, 0.15), rng.range(-0.3, 0.3)));
    if (f.coverTarget) away = add(norm(away), scale(norm(sub(f.coverTarget, f.pos)), 0.7));
    desire = norm(away);
    const burstFrac = f.burstLeft > 0 ? 1 : 0.45;
    f.burstLeft = Math.max(0, f.burstLeft - dt);
    speed = spec.burstBL * L * burstFrac * thermal;
    response = 12;
  } else {
    f.fleeTime = 0;
    // Boids within the school
    // Scalar accumulators (no per-mate allocation); same arithmetic as add/sub/scale.
    let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0;
    let n = 0;
    const px = f.pos.x, py = f.pos.y, pz = f.pos.z;
    const sepM = spec.schooling.separationM;
    for (const m of mates) {
      if (m === f || !m.alive) continue;
      const mp = m.pos;
      const dx = mp.x - px, dy = mp.y - py, dz = mp.z - pz;
      if (dx * dx + dy * dy + dz * dz > 16.5) continue; // cheap reject well outside 4 m; exact test below
      const d = Math.hypot(dx, dy, dz);
      if (d > 4) continue;
      n++;
      ax += m.vel.x; ay += m.vel.y; az += m.vel.z;
      cx += mp.x; cy += mp.y; cz += mp.z;
      if (d < sepM && d > 1e-4) {
        const w = 1 / (d * d);
        sx += (px - mp.x) * w; sy += (py - mp.y) * w; sz += (pz - mp.z) * w;
      }
    }
    let ali = v3(ax, ay, az);
    let coh = v3(cx, cy, cz);
    const sep = v3(sx, sy, sz);
    if (n > 0) {
      ali = scale(ali, 1 / n);
      coh = sub(scale(coh, 1 / n), f.pos);
      desire = add(desire, scale(norm(ali), spec.schooling.alignment * 0.8));
      desire = add(desire, scale(norm(coh), spec.schooling.cohesion * 0.5));
      desire = add(desire, scale(sep, 0.25));
    }
    // Foraging: fish are drawn to cover edges in proportion to their habitat preference,
    // which is what makes reeds and weed beds productive ambush spots for a pike.
    if (f.alert < 0.25 && spec.habitat.cover > 0) {
      const cur = f.forageTarget;
      const arrived = cur !== null && Math.hypot(cur.x - f.pos.x, cur.z - f.pos.z) < 0.6;
      if (!cur || arrived || rng.next() < dt * 0.15) {
        // The school grazes one margin together: adopt a schoolmate's live target, otherwise
        // (none, or on arrival) pick a fresh angle on the same patch.
        let shared: Vec3 | null = null;
        if (!arrived) {
          for (const m of mates) {
            const t = m.forageTarget;
            if (m !== f && m.alive && t && !(cur && t.x === cur.x && t.z === cur.z) && dist(t, f.pos) < 25) {
              shared = t;
              break;
            }
          }
        }
        f.forageTarget = shared ?? coverEdgePoint(cur ?? f.pos, world, rng);
      }
      if (f.forageTarget) {
        // Horizontal pull only: depth keeping is the habitat term's job, so a deep weed bed does not pin the school above it.
        const to = v3(f.forageTarget.x - f.pos.x, 0, f.forageTarget.z - f.pos.z);
        if (len(to) > 0.6) desire = add(desire, scale(norm(to), spec.habitat.cover * 1.2));
      }
    }
    // Habitat depth and a slow wander
    f.wanderPhase += dt * 0.4;
    desire = add(desire, v3(Math.cos(f.wanderPhase * 1.3) * 0.35, clamp((f.homeDepth - f.pos.y) * 0.5, -0.5, 0.5), Math.sin(f.wanderPhase) * 0.35));
    // Alert fish edge toward cover and slow down to keep a low profile
    if (f.alert > 0.25) {
      f.coverTarget ??= nearestCover(f.pos, world);
      if (f.coverTarget) desire = add(desire, scale(norm(sub(f.coverTarget, f.pos)), f.alert * 1.2));
      speed *= 1.3;
    } else {
      f.coverTarget = null;
    }
    // Hold the school inside the basin
    const r = Math.hypot(f.pos.x, f.pos.z);
    const edge = world.size / 2 - 6;
    if (r > edge) desire = add(desire, v3((-f.pos.x / r) * (r - edge) * 0.5, 0, (-f.pos.z / r) * (r - edge) * 0.5));
    desire = norm(desire);
  }

  // Bottom avoidance
  const clearance = f.pos.y - world.bottomY(f.pos.x, f.pos.z);
  if (clearance < 0.6) desire = norm(add(desire, v3(0, (0.6 - clearance) * 2, 0)));
  if (f.pos.y > -0.3) desire = norm(add(desire, v3(0, -1, 0)));

  const targetVel = scale(desire, speed);
  const k = Math.min(1, response * dt);
  f.vel = v3(f.vel.x + (targetVel.x - f.vel.x) * k, f.vel.y + (targetVel.y - f.vel.y) * k, f.vel.z + (targetVel.z - f.vel.z) * k);
  f.pos = add(f.pos, scale(f.vel, dt));
  world.confine(f.pos, 0.1);
  return bolted;
}

export const preySpeed = (f: PreyState): number => len(f.vel);
