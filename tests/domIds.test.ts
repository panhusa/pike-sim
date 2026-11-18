import { describe, expect, it } from "vitest";
import html from "../index.html?raw";

/** Every element the code fetches by id with $("x") / el("x") / getElementById("x") must exist in index.html. */
const sources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("index.html ids", () => {
  it("has every id the UI code looks up", () => {
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set<string>();
    for (const src of Object.values(sources)) {
      for (const m of src.matchAll(/(?:\$|\bel|getElementById)\("([A-Za-z][\w-]*)"\)/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(10);
  });
});
