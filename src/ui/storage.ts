export interface SaveStore {
  available: boolean;
  load(): string | null;
  save(text: string): boolean;
  loadRewind(): string | null;
  saveRewind(text: string): boolean;
  clear(): boolean;
  clearRewind(): boolean;
}

/** the single save from before save slots (migrated into a slot at start-up, see slots.ts) */
export const LEGACY_KEY = "pike.save.v1";
export const LEGACY_REWIND_KEY = "pike.save.v1.rewind";

/** localStorage-backed save and rewind snapshot under two keys; every access is guarded because storage can be missing, blocked or full. */
export function createSaveStore(storage: Storage | null, key = LEGACY_KEY, rewindKey = LEGACY_REWIND_KEY): SaveStore {
  const read = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, text: string): boolean => {
    try {
      if (!storage) return false;
      storage.setItem(k, text);
      return true;
    } catch {
      return false;
    }
  };
  const remove = (k: string): boolean => {
    try {
      storage?.removeItem(k);
      return true;
    } catch {
      return false;
    }
  };
  return {
    available: storage !== null,
    load: () => read(key),
    save: (t) => write(key, t),
    loadRewind: () => read(rewindKey),
    saveRewind: (t) => write(rewindKey, t),
    clear: () => remove(key) && remove(rewindKey),
    clearRewind: () => remove(rewindKey),
  };
}

/** The browser's localStorage, or null when access throws (privacy modes). */
export function browserStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem(LEGACY_KEY);
    return s;
  } catch {
    return null;
  }
}
