import type { Params } from "./params";
import type { MapShape } from "./world";

export type DeathMode = "permadeath" | "lineage" | "rewind";
export type DangerPreset = "gentle" | "natural" | "harsh";

export interface SimSettings {
  deathMode: DeathMode;
  rivalCount: number;
  rivalSizeScale: number;
  aggression: number;
  recruitmentScale: number;
  /** which water: the round lake (default, and every save from before rivers) or the river */
  map?: MapShape;
  /** game only: nothing can kill a human player (no bites, no starving, the angler always lets you go) */
  chill?: boolean;
  /** game only: the bigger, denser game-size water (lake x1.8 across, river x2.4 longer, 2x plant beds). Old saves and tests: off */
  big?: boolean;
  /** game only: multiplier on the human players' growth efficiency (1 = normal) */
  growthMul?: number;
  /** game only: humans start as an egg (hatch at EGG_LENGTH_CM) instead of the 22 cm young pike */
  startEgg?: boolean;
  /** game only: a later "Start as" stage, the humans' start length in cm (ignored when startEgg). Absent: 22 cm */
  startCm?: number;
}

export function presetSettings(preset: DangerPreset, deathMode: DeathMode, p: Params): SimSettings {
  return { deathMode, ...p.danger.presets[preset] };
}
