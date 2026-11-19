/**
 * Game only: growing up from the egg. Below NURSERY_END_CM a human player grows straight from each catch
 * (no stomach / digestion wait), and schools of baby fish sized to what the player can swallow are kept
 * near them. From NURSERY_END_CM on, the normal growth model takes over.
 */
import { clamp } from "./math";
import { weightG } from "./biology";
import type { PikeState } from "./pike";
import type { Params } from "./params";

/** Hatchling length (cm) when a life starts from the egg. */
export const EGG_LENGTH_CM = 1.2;
/** Nursery growth stops here: the old 22 cm start, where the biology model takes over. */
export const NURSERY_END_CM = 22;
/** Length gain per catch at Growth x1, as a fraction of the pike's length (scaled by prey size). */
export const NURSERY_GAIN = 0.07;
/** Baby fish are this fraction of the player's length (well inside the 62% gape limit). */
export const NURSERY_PREY_FRAC: [number, number] = [0.22, 0.5];

/** Length gain fraction for one catch: bigger prey (relative to the pike) give more, the Growth option multiplies. */
export function nurseryGain(pikeCm: number, preyCm: number, growthMul = 1): number {
  const rel = clamp(preyCm / (0.4 * pikeCm), 0.4, 1.5);
  return NURSERY_GAIN * Math.max(1, growthMul) * rel;
}

/** Grow a nursery pike from one catch; returns true when it applied (the pike was still under NURSERY_END_CM). */
export function nurseryGrow(pk: PikeState, preyCm: number, growthMul: number, p: Params): boolean {
  if (pk.lengthCm >= NURSERY_END_CM) return false;
  const len = Math.min(NURSERY_END_CM, pk.lengthCm * (1 + nurseryGain(pk.lengthCm, preyCm, growthMul)));
  pk.lengthCm = len;
  pk.weight = weightG(len, p.pike.lengthWeight);
  pk.stomachG = 0; // the catch went straight into growth
  pk.energyBalanceJ = 0;
  return true;
}

/** Length a new human pike starts at: the hatchling for an egg start, else the 22 cm young pike. */
export function startLengthCm(settings: { startEgg?: boolean }, p: Params): number {
  return settings.startEgg ? EGG_LENGTH_CM : p.pike.startLengthCm;
}

interface EggWorld {
  weeds: ReadonlyArray<{ x: number; z: number; radius: number; height: number }>;
  depthAt(x: number, z: number): number;
  bottomY(x: number, z: number): number;
  inWater(x: number, z: number): boolean;
}

/**
 * Put an egg-start pike in a shallow weed bed (pike spawn on flooded plants), low in the fronds.
 * Picks by the pike's id so the sim RNG stream is untouched; false when the water has no fitting bed.
 */
export function placeInWeedBed(world: EggWorld, pk: PikeState): boolean {
  const beds = world.weeds.filter((w) => world.inWater(w.x, w.z) && world.depthAt(w.x, w.z) < 2.5 && world.depthAt(w.x, w.z) > 0.6);
  if (!beds.length) return false;
  const w = beds[(pk.id * 7919) % beds.length]!;
  const floor = world.bottomY(w.x, w.z);
  pk.pos = { x: w.x, y: Math.min(-0.2, floor + Math.min(0.4, w.height * 0.4)), z: w.z };
  pk.pitch = 0;
  return true;
}
