import { Simulation, type SimState } from "./simulation";

export interface SaveFile {
  version: 1;
  savedAt: string;
  state: SimState;
}

export type ParseResult = { ok: true; sim: Simulation; savedAt: string } | { ok: false; reason: "corrupt" | "version" };

export function toSaveFile(sim: Simulation, now: Date): string {
  const file: SaveFile = { version: 1, savedAt: now.toISOString(), state: sim.toState() };
  return JSON.stringify(file);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);

function validState(s: unknown): s is SimState {
  if (!isObj(s)) return false;
  for (const k of ["seed", "startDay", "time", "rng", "nextId", "nextSchool", "nextCohort", "lastDay"]) if (!finite(s[k])) return false;
  if (s.playerId !== null && !finite(s.playerId)) return false;
  if (!Array.isArray(s.milestones) || !s.milestones.every((m) => typeof m === "string")) return false;
  if (typeof s.playerSawWinter !== "boolean") return false;
  if (!isObj(s.settings) || !isObj(s.spawn) || !isObj(s.spawn.dwell)) return false;
  for (const k of ["pikes", "prey", "cohorts", "attempted", "capacity"]) if (!Array.isArray(s[k])) return false;
  return (s.pikes as unknown[]).every(isObj) && (s.prey as unknown[]).every(isObj) && (s.cohorts as unknown[]).every(isObj);
}

export function parseSave(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "corrupt" };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "corrupt" };
  const f = raw as Partial<SaveFile>;
  if (typeof f.version !== "number") return { ok: false, reason: "corrupt" };
  if (f.version !== 1) return { ok: false, reason: "version" };
  if (typeof f.savedAt !== "string" || !validState(f.state)) return { ok: false, reason: "corrupt" };
  const s = f.state;
  // Optional fields: a malformed value falls back to the default instead of rejecting the save.
  if (s.playerHintsDone !== undefined && typeof s.playerHintsDone !== "boolean") delete s.playerHintsDone;
  try {
    return { ok: true, sim: Simulation.fromState(s), savedAt: f.savedAt };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}
