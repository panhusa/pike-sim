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
}

export function presetSettings(preset: DangerPreset, deathMode: DeathMode, p: Params): SimSettings {
  return { deathMode, ...p.danger.presets[preset] };
}
