import { describe, expect, it } from "vitest";
import { listSlots, migrateV1, slotKey, slotStore, SLOTS_PER_MAP } from "../src/ui/slots";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { toSaveFile } from "../src/sim/save";
import type { MapShape } from "../src/sim/world";

function fakeStorage(): Storage & { keys(): string[] } {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
    keys: () => [...m.keys()],
  };
}

function lifeText(map: MapShape, lengthCm: number): string {
  const sim = new Simulation({ seed: 5, settings: { ...presetSettings("gentle", "permadeath", defaultParams), map } });
  sim.addPlayer(lengthCm);
  return toSaveFile(sim, new Date("2026-11-20T10:00:00Z"));
}

describe("save slots", () => {
  it("names one key per water and slot", () => {
    expect(SLOTS_PER_MAP).toBe(3);
    expect(slotKey("river", 2)).toBe("pike.save.v2.river.2");
    expect(slotKey("lake", 1)).toBe("pike.save.v2.lake.1");
  });

  it("lists six empty slots on empty storage, lake 1-3 then river 1-3", () => {
    const list = listSlots(fakeStorage());
    expect(list.map((s) => `${s.map}${s.n}`)).toEqual(["lake1", "lake2", "lake3", "river1", "river2", "river3"]);
    expect(list.every((s) => s.empty && !s.corrupt)).toBe(true);
  });

  it("is safe without storage", () => {
    expect(listSlots(null)).toHaveLength(6);
    expect(() => migrateV1(null)).not.toThrow();
    expect(slotStore(null, "lake", 1).load()).toBeNull();
  });

  it("shows a saved life's stage, length and age", () => {
    const st = fakeStorage();
    st.setItem(slotKey("lake", 2), lifeText("lake", 40));
    const s = listSlots(st)[1]!;
    expect(s.empty).toBe(false);
    expect(s.stage).toBe("Hunter");
    expect(s.lengthCm).toBeCloseTo(40, 1);
    expect(typeof s.ageDays).toBe("number");
    expect(s.savedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(s.sim?.player()?.lengthCm).toBeCloseTo(40, 1);
  });

  it("an unreadable save shows as empty and corrupt", () => {
    const st = fakeStorage();
    st.setItem(slotKey("river", 3), "{nope");
    const s = listSlots(st)[5]!;
    expect(s.empty).toBe(true);
    expect(s.corrupt).toBe(true);
  });

  it("migrates a v1 river save into river 1 and removes the v1 keys", () => {
    const st = fakeStorage();
    const t = lifeText("river", 30);
    st.setItem("pike.save.v1", t);
    st.setItem("pike.save.v1.rewind", "rw");
    migrateV1(st);
    expect(st.getItem(slotKey("river", 1))).toBe(t);
    expect(st.getItem(slotKey("river", 1) + ".rewind")).toBe("rw");
    expect(st.getItem("pike.save.v1")).toBeNull();
    expect(st.getItem("pike.save.v1.rewind")).toBeNull();
  });

  it("migrates a v1 save without a map into lake 1", () => {
    const st = fakeStorage();
    const raw = JSON.parse(lifeText("lake", 22));
    delete raw.state.settings.map;
    st.setItem("pike.save.v1", JSON.stringify(raw));
    migrateV1(st);
    expect(st.getItem(slotKey("lake", 1))).not.toBeNull();
    expect(st.getItem("pike.save.v1")).toBeNull();
  });

  it("migration is a no-op when a v2 slot exists", () => {
    const st = fakeStorage();
    st.setItem("pike.save.v1", lifeText("lake", 22));
    st.setItem(slotKey("river", 3), "x");
    migrateV1(st);
    expect(st.getItem("pike.save.v1")).not.toBeNull();
    expect(st.getItem(slotKey("lake", 1))).toBeNull();
  });

  it("a slot store for lake 1 never touches river keys", () => {
    const st = fakeStorage();
    st.setItem(slotKey("river", 1), "R");
    st.setItem(slotKey("river", 1) + ".rewind", "RR");
    const s = slotStore(st, "lake", 1);
    expect(s.load()).toBeNull();
    s.save("a");
    s.saveRewind("b");
    expect(st.getItem(slotKey("lake", 1))).toBe("a");
    expect(st.getItem(slotKey("lake", 1) + ".rewind")).toBe("b");
    s.clear();
    expect(st.keys().sort()).toEqual([slotKey("river", 1), slotKey("river", 1) + ".rewind"].sort());
    expect(st.getItem(slotKey("river", 1))).toBe("R");
  });
});
