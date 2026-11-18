export interface SaveStore {
  available: boolean;
  load(): string | null;
  save(text: string): boolean;
  loadRewind(): string | null;
  saveRewind(text: string): boolean;
  clear(): boolean;
  clearRewind(): boolean;
}

const KEY = "pike.save.v1";
const REWIND_KEY = "pike.save.v1.rewind";

/** localStorage-backed save slots; every access is guarded because storage can be missing, blocked or full. */
export function createSaveStore(storage: Storage | null): SaveStore {
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
    load: () => read(KEY),
    save: (t) => write(KEY, t),
    loadRewind: () => read(REWIND_KEY),
    saveRewind: (t) => write(REWIND_KEY, t),
    clear: () => remove(KEY) && remove(REWIND_KEY),
    clearRewind: () => remove(REWIND_KEY),
  };
}

/** The browser's localStorage, or null when access throws (privacy modes). */
export function browserStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem(KEY);
    return s;
  } catch {
    return null;
  }
}
