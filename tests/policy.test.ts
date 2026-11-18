import { describe, expect, it } from "vitest";
import { deathPersistence, newLifeRewindRule, persistDeath, persistNewLife } from "../src/ui/policy";
import { createSaveStore } from "../src/ui/storage";

function fake(failRemove = false): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => {
      if (failRemove) throw new Error("blocked");
      m.delete(k);
    },
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("persistence policy", () => {
  it("maps modes to death rules", () => {
    expect(deathPersistence("permadeath")).toBe("clear");
    expect(deathPersistence("lineage")).toBe("save-dead");
    expect(deathPersistence("rewind")).toBe("copy-rewind");
    expect(newLifeRewindRule("rewind")).toBe("write-rewind");
    expect(newLifeRewindRule("lineage")).toBe("clear-rewind");
  });

  it("new life drops a stale rewind snapshot outside rewind mode and writes one in rewind mode", () => {
    const s = createSaveStore(fake());
    s.saveRewind("old");
    expect(persistNewLife(s, "lineage", "new")).toBe(true);
    expect(s.loadRewind()).toBeNull();
    expect(s.load()).toBe("new");
    expect(persistNewLife(s, "rewind", "new2")).toBe(true);
    expect(s.loadRewind()).toBe("new2");
  });

  it("permadeath clears; a failed clear overwrites the main save with the dead state", () => {
    const s = createSaveStore(fake());
    s.save("alive");
    expect(persistDeath(s, "permadeath", "dead")).toBe(true);
    expect(s.load()).toBeNull();
    const bad = createSaveStore(fake(true));
    bad.save("alive");
    expect(persistDeath(bad, "permadeath", "dead")).toBe(true);
    expect(bad.load()).toBe("dead");
  });

  it("lineage saves the dead state; rewind copies the snapshot into the main save", () => {
    const s = createSaveStore(fake());
    s.save("alive");
    persistDeath(s, "lineage", "dead");
    expect(s.load()).toBe("dead");
    s.saveRewind("snap");
    persistDeath(s, "rewind", "dead");
    expect(s.load()).toBe("snap");
  });
});
