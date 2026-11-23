import { stageOf, STAGES } from "../game/score";
import { parseSave } from "../sim/save";
import type { Simulation } from "../sim/simulation";
import type { MapShape } from "../sim/world";
import { createSaveStore, LEGACY_KEY, LEGACY_REWIND_KEY, type SaveStore } from "./storage";

export const SLOTS_PER_MAP = 3;
export type SlotNo = 1 | 2 | 3;
export const SLOT_MAPS: readonly MapShape[] = ["lake", "river"];

export const slotKey = (map: MapShape, n: SlotNo): string => `pike.save.v2.${map}.${n}`;

export interface SlotSummary {
  map: MapShape;
  n: SlotNo;
  empty: boolean;
  /** the slot holds text that does not parse: shown as empty, may be overwritten */
  corrupt?: boolean;
  /** the raw text of a corrupt slot (offered as a download) */
  text?: string;
  stage?: string;
  lengthCm?: number;
  ageDays?: number;
  savedAt?: string;
  /** the parsed life, ready to continue (parsed once per screen build) */
  sim?: Simulation;
}

/** The per-life store (load/save/rewind/clear) bound to one slot's keys. */
export function slotStore(storage: Storage | null, map: MapShape, n: SlotNo): SaveStore {
  const k = slotKey(map, n);
  return createSaveStore(storage, k, `${k}.rewind`);
}

function read(storage: Storage | null, k: string): string | null {
  try {
    return storage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}

function slotNos(): SlotNo[] {
  return Array.from({ length: SLOTS_PER_MAP }, (_, i) => (i + 1) as SlotNo);
}

/** Six entries, lake 1-3 then river 1-3; each filled slot is parsed once. */
export function listSlots(storage: Storage | null): SlotSummary[] {
  const out: SlotSummary[] = [];
  for (const map of SLOT_MAPS)
    for (const n of slotNos()) {
      const text = read(storage, slotKey(map, n));
      if (text === null) {
        out.push({ map, n, empty: true });
        continue;
      }
      const r = parseSave(text);
      const pk = r.ok ? r.sim.player() : null;
      if (!r.ok || !pk) {
        out.push({ map, n, empty: true, corrupt: true, text });
        continue;
      }
      out.push({ map, n, empty: false, stage: STAGES[stageOf(pk.lengthCm).index]!.name, lengthCm: pk.lengthCm, ageDays: pk.ageDays, savedAt: r.savedAt, sim: r.sim });
    }
  return out;
}

function mapOf(text: string): MapShape {
  try {
    const raw = JSON.parse(text) as { state?: { settings?: { map?: unknown } } };
    return raw.state?.settings?.map === "river" ? "river" : "lake";
  } catch {
    return "lake";
  }
}

/** One-time move of the single v1 save into slot 1 of its water; a no-op once any v2 slot exists. */
export function migrateV1(storage: Storage | null): void {
  if (!storage) return;
  const text = read(storage, LEGACY_KEY);
  if (text === null) return;
  for (const map of SLOT_MAPS) for (const n of slotNos()) if (read(storage, slotKey(map, n)) !== null) return;
  try {
    const k = slotKey(mapOf(text), 1);
    storage.setItem(k, text);
    const rw = storage.getItem(LEGACY_REWIND_KEY);
    if (rw !== null) storage.setItem(`${k}.rewind`, rw);
    storage.removeItem(LEGACY_KEY);
    storage.removeItem(LEGACY_REWIND_KEY);
  } catch {
    /* storage full or blocked: keep the v1 save where it is */
  }
}
