import { appetite, digestionRate, lengthCm, standardMetabolismW, weightG } from "./biology";
import { clamp, forward, v3, type Vec3 } from "./math";
import type { Params } from "./params";
import type { RivalMemory } from "./rival";

/** What a controller (player or AI) asks the body to do this tick. */
export interface PikeInput {
  throttle: number; // 0..1 fraction of sustained swimming speed
  yawRate: number; // -1..1
  pitchRate: number; // -1..1
  burst: boolean; // start a burst (edge triggered by the controller holding it)
}

export type Sex = "male" | "female";
export type DeathCause = "starvation" | "eaten";

export interface PikeState {
  id: number;
  sex: Sex;
  parentIds: number[];
  lineage: boolean;
  /** Calendar year of the last spawning, null if never. */
  spawnedYear: number | null;
  pos: Vec3;
  yaw: number;
  pitch: number;
  speed: number; // m/s along heading
  lengthCm: number;
  weight: number; // g, includes reserves but not stomach contents
  energy: number; // anaerobic burst reserve, 0..energyMax
  burstTimeLeft: number;
  burstCooldown: number;
  lockId: number | null; // committed lunge target, set when a burst starts
  burstSerial: number; // increments per burst so a strike resolves once per target per burst
  stomachG: number; // grams of undigested prey
  stress: number; // 0..1
  health: number; // 0..1
  ageDays: number;
  alive: boolean;
  deathCause?: DeathCause;
  killedBy?: number; // id of the pike that ate this one
  killedByLengthCm?: number; // killer's length at kill time
  /** Seconds since the last movement above cruise speed; drives camouflage. */
  stillTime: number;
  energyBalanceJ: number; // running joule balance, drained into growth/loss
  /** Present on AI-controlled rivals only. */
  ai?: RivalMemory;
}

export function makePike(id: number, pos: Vec3, lengthCmStart: number, p: Params, sex: Sex = "female"): PikeState {
  return {
    id,
    sex,
    parentIds: [],
    lineage: false,
    spawnedYear: null,
    pos: { ...pos },
    yaw: 0,
    pitch: 0,
    speed: 0,
    lengthCm: lengthCmStart,
    weight: weightG(lengthCmStart, p.pike.lengthWeight),
    energy: p.pike.energyMax,
    burstTimeLeft: 0,
    burstCooldown: 0,
    burstSerial: 0,
    lockId: null,
    stomachG: 0,
    stress: 0,
    health: 1,
    ageDays: 0,
    alive: true,
    stillTime: 0,
    energyBalanceJ: 0,
  };
}

export const lengthM = (s: PikeState): number => s.lengthCm / 100;
export const condition = (s: PikeState, p: Params): number => s.weight / weightG(s.lengthCm, p.pike.lengthWeight);
export const stomachFill = (s: PikeState, p: Params): number =>
  clamp(s.stomachG / (s.weight * p.pike.stomachMaxFracOfWeight), 0, 1.2);
export const hunger = (s: PikeState, p: Params, tempC: number): number => appetite(stomachFill(s, p), tempC);

/** Maximum burst speed shrinks with exhaustion and poor health. */
function burstSpeed(s: PikeState, p: Params): number {
  const vigor = clamp(s.energy / 40, 0.35, 1) * clamp(0.5 + 0.5 * s.health, 0.5, 1);
  return p.pike.burstBL * lengthM(s) * vigor;
}

/** Grams the stomach can still take. */
export function stomachRoom(s: PikeState, p: Params): number {
  return Math.max(0, s.weight * p.pike.stomachMaxFracOfWeight - s.stomachG);
}

/**
 * A sated pike does not take prey it cannot swallow: room under minSwallowRoomFrac of the prey's
 * weight (10%) or under minSwallowRoomG (1 g) is "too full". The prey lives.
 */
export function tooFullFor(s: PikeState, preyWeight: number, p: Params): boolean {
  return stomachRoom(s, p) < Math.max(p.pike.minSwallowRoomG, p.pike.minSwallowRoomFrac * preyWeight);
}

/** True when stepPike will start a burst this tick (cooldown is decremented by dt first). */
export function canStartBurst(s: PikeState, input: PikeInput, dt: number, p: Params): boolean {
  return input.burst && s.burstTimeLeft <= 0 && s.burstCooldown - dt <= 0 && s.energy > p.pike.exhaustedBelow;
}

/**
 * `bioScale` converts real simulation seconds into biological seconds (86400 / dayLengthS in the
 * game, 1 for pure real-time tests). Locomotion and burst costs run on real seconds; resting
 * metabolism, digestion, growth, ageing and starvation run on the calendar clock.
 */
export function stepPike(s: PikeState, input: PikeInput, tempC: number, dt: number, p: Params, bioScale = 1): void {
  if (!s.alive) return;
  const L = lengthM(s);
  const pp = p.pike;

  // --- burst state machine ---
  s.burstCooldown = Math.max(0, s.burstCooldown - dt);
  if (canStartBurst(s, input, 0, p)) {
    s.burstTimeLeft = pp.burstDurationS;
    s.burstCooldown = pp.burstCooldownS;
    s.burstSerial++;
  }
  const bursting = s.burstTimeLeft > 0;
  if (bursting) {
    s.burstTimeLeft -= dt;
    s.energy = Math.max(0, s.energy - pp.burstCostPerS * dt);
    if (s.energy <= 0) s.burstTimeLeft = 0;
  }

  // --- target speed and acceleration ---
  const sustained = pp.maxSustainedBL * L;
  const cold = clamp(0.55 + 0.45 * (tempC / 15), 0.35, 1);
  const target = bursting ? burstSpeed(s, p) : clamp(input.throttle, 0, 1) * sustained * cold;
  const accelMax = pp.accelBL * L;
  const dv = clamp(target - s.speed, -accelMax * dt * 0.6, accelMax * dt);
  s.speed += dv;
  // quadratic drag, small at cruise, dominant at burst speeds
  s.speed -= pp.dragCoef * s.speed * Math.abs(s.speed) * dt * 0.04 / Math.max(L, 0.1);
  s.speed = Math.max(0, s.speed);

  // --- steering: turn rate falls with speed, long fish turn wider ---
  const turn = (bursting ? pp.burstTurnRateRadS : pp.turnRateRadS) / (0.6 + 0.8 * L);
  const speedFactor = 1 / (1 + 0.15 * s.speed);
  s.yaw += clamp(input.yawRate, -1, 1) * turn * speedFactor * dt;
  s.pitch = clamp(s.pitch + clamp(input.pitchRate, -1, 1) * turn * 0.6 * dt, -0.9, 0.9);

  const f = forward(s.yaw, s.pitch);
  s.pos = v3(s.pos.x + f.x * s.speed * dt, s.pos.y + f.y * s.speed * dt, s.pos.z + f.z * s.speed * dt);

  // --- recovery, stillness, stress ---
  if (!bursting) {
    const rec = pp.energyRecoveryPerS * (s.speed < sustained * 0.5 ? 1.4 : 0.7) * clamp(tempC / 15, 0.3, 1.3);
    s.energy = Math.min(pp.energyMax, s.energy + rec * dt);
  }
  s.stillTime = s.speed < pp.cruiseBL * L * 0.5 ? s.stillTime + dt : 0;
  s.stress = clamp(s.stress + (bursting ? 0.02 : -0.01) * dt * 10, 0, 1);

  stepMetabolism(s, tempC, dt, dt * bioScale, bursting, p);
  s.ageDays += (dt * bioScale) / 86400;
}

/** Digest, burn energy, and convert the balance into weight and length. */
export function stepMetabolism(s: PikeState, tempC: number, dt: number, bioDt: number, bursting: boolean, p: Params): void {
  const m = p.metabolism;
  const L = lengthM(s);
  const std = standardMetabolismW(s.weight, tempC, m);
  // Background cost on the calendar clock: resting plus how actively the fish is swimming.
  const swimming = 1 + (m.activityMultiplierCruise - 1) * clamp(s.speed / Math.max(p.pike.cruiseBL * L, 0.05), 0, 2);
  // A burst is a real ~1 s event, so its extra cost is charged in real seconds, not calendar time.
  const burstExtra = bursting ? std * (m.activityMultiplierBurst - 1) * dt : 0;
  const costJ = std * swimming * bioDt + burstExtra;

  // digestion releases assimilated energy out of the stomach (calendar clock)
  const digested = s.stomachG * (1 - Math.exp(-digestionRate(tempC, p.pike.digestionHalfLifeH, s.weight, m.weightExponent) * bioDt));
  s.stomachG -= digested;
  const intakeJ = digested * m.preyEnergyDensityJPerG * m.assimilationEfficiency;

  s.energyBalanceJ += intakeJ - costJ;
  // Settle the balance into body mass in chunks to avoid float dust.
  if (Math.abs(s.energyBalanceJ) > 50) {
    if (s.energyBalanceJ > 0) {
      // Growth slows toward the sex-specific maximum length.
      const ceiling = clamp(1 - s.lengthCm / p.pike.maxLengthCm[s.sex], p.pike.growthCeilingFloor, 1);
      s.weight += (s.energyBalanceJ * m.growthEfficiency * ceiling) / m.pikeTissueEnergyDensityJPerG;
    } else {
      s.weight += s.energyBalanceJ / m.pikeTissueEnergyDensityJPerG; // burning reserves, efficiency 1
    }
    s.energyBalanceJ = 0;
    const lw = p.pike.lengthWeight;
    // Length grows only when the fish is plump; it never shrinks.
    if (s.weight > weightG(s.lengthCm, lw) * 1.04) s.lengthCm = Math.max(s.lengthCm, lengthCm(s.weight / 1.0, lw));
  }

  // starvation damage: severely thin fish lose health, well-fed ones recover
  const k = condition(s, p);
  if (k < 0.6) s.health = Math.max(0, s.health - bioDt * 0.0002 * (0.6 - k) * 10);
  else if (k > 0.85) s.health = Math.min(1, s.health + bioDt * 0.00002);
  if (s.health <= 0) s.alive = false;
}
