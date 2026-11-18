import type { Params } from "./params";

export type DeathMode = "permadeath" | "lineage" | "rewind";
export type DangerPreset = "gentle" | "natural" | "harsh";

export interface SimSettings {
  deathMode: DeathMode;
  rivalCount: number;
  rivalSizeScale: number;
  aggression: number;
  recruitmentScale: number;
}

export function presetSettings(preset: DangerPreset, deathMode: DeathMode, p: Params): SimSettings {
  return { deathMode, ...p.danger.presets[preset] };
}
