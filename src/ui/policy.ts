import type { DeathMode } from "../sim/settings";
import type { SaveStore } from "./storage";

export type DeathPersistence = "clear" | "save-dead" | "copy-rewind";

/** What to persist at the moment the player dies, per death mode. */
export function deathPersistence(mode: DeathMode): DeathPersistence {
  return mode === "permadeath" ? "clear" : mode === "lineage" ? "save-dead" : "copy-rewind";
}

/** Rewind mode keeps a snapshot from the first moment of a life; other modes must not keep a stale one. */
export function newLifeRewindRule(mode: DeathMode): "write-rewind" | "clear-rewind" {
  return mode === "rewind" ? "write-rewind" : "clear-rewind";
}

/** Apply the death rule; returns false when persistence failed (the caller toasts). */
export function persistDeath(store: SaveStore, mode: DeathMode, deadText: string): boolean {
  const rule = deathPersistence(mode);
  if (rule === "clear") return store.clear() || store.save(deadText);
  if (rule === "copy-rewind") return store.save(store.loadRewind() ?? deadText);
  return store.save(deadText);
}

/** Persist a brand-new life: first save, plus the rewind snapshot or removal of a stale one. */
export function persistNewLife(store: SaveStore, mode: DeathMode, text: string): boolean {
  const ok = store.save(text);
  return (newLifeRewindRule(mode) === "write-rewind" ? store.saveRewind(text) : store.clearRewind()) && ok;
}
