import { describe, expect, it } from "vitest";
import { createSaveStore } from "../src/ui/storage";

function fakeStorage(opts: { throwOnSet?: boolean } = {}): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => {
      if (opts.throwOnSet) throw new DOMException("full", "QuotaExceededError");
      m.set(k, v);
    },
  };
}

describe("save store", () => {
  it("returns false instead of throwing when the quota is exceeded", () => {
    const s = createSaveStore(fakeStorage({ throwOnSet: true }));
    expect(s.save("x")).toBe(false);
    expect(s.saveRewind("x")).toBe(false);
  });

  it("is unavailable without storage and never throws", () => {
    const s = createSaveStore(null);
    expect(s.available).toBe(false);
    expect(s.load()).toBeNull();
    expect(s.save("x")).toBe(false);
    expect(() => s.clear()).not.toThrow();
  });

  it("round-trips both slots and clear removes both", () => {
    const st = fakeStorage();
    const s = createSaveStore(st);
    expect(s.available).toBe(true);
    expect(s.save("a")).toBe(true);
    expect(s.saveRewind("b")).toBe(true);
    expect(s.load()).toBe("a");
    expect(s.loadRewind()).toBe("b");
    s.clear();
    expect(st.getItem("pike.save.v1")).toBeNull();
    expect(st.getItem("pike.save.v1.rewind")).toBeNull();
    expect(s.load()).toBeNull();
  });

  it("clearRewind removes only the rewind slot", () => {
    const s = createSaveStore(fakeStorage());
    s.save("a");
    s.saveRewind("b");
    expect(s.clearRewind()).toBe(true);
    expect(s.loadRewind()).toBeNull();
    expect(s.load()).toBe("a");
  });
});
