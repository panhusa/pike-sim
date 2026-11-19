import { describe, expect, it } from "vitest";
import { DEFAULT_GFX, autoQuality, initialGfx, loadGfx, saveGfx, type GfxSettings } from "../src/render/gfxSettings";
import { CAMERA_MODES, CameraRig, chaseDistance, type CameraMode } from "../src/render/camera";
import { absorptionColor, causticStrength, waterLook } from "../src/render/water";
import { nearFade, plantCounts } from "../src/render/plants";
import * as THREE from "three";
import { SKINS, applyFishSkin, type FishSpecies } from "../src/render/fish";
import { ANATOMY, DETAIL, FIN, buildFishModel, profile } from "../src/render/fishModel";
import { World } from "../src/sim/world";
import { defaultParams } from "../src/sim/params";
import { burstsFromEvents, particleCounts } from "../src/render/particles";
import type { SimEvent } from "../src/sim/simulation";
import { gradeFor, pixelRatioFor } from "../src/render/post";
import { shaftCount } from "../src/render/water";

const memStorage = (init: Record<string, string> = {}): Storage => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
};
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } } as unknown as Storage;

describe("loadGfx", () => {
  it("defaults for null, throwing, invalid JSON and unknown values", () => {
    expect(loadGfx(null)).toEqual(DEFAULT_GFX);
    expect(loadGfx(throwing)).toEqual(DEFAULT_GFX);
    expect(loadGfx(memStorage({ "pike.gfx.v1": "{not json" }))).toEqual(DEFAULT_GFX);
    expect(loadGfx(memStorage({ "pike.gfx.v1": JSON.stringify({ style: "neon", quality: "ultra" }) }))).toEqual(DEFAULT_GFX);
    expect(loadGfx(memStorage({ "pike.gfx.v1": "42" }))).toEqual(DEFAULT_GFX);
  });
  it("defaults are realistic / high / not chosen", () => {
    expect(DEFAULT_GFX).toEqual({ style: "realistic", quality: "high", qualityChosen: false });
  });
  it("round-trips a valid save", () => {
    const s = memStorage();
    const g: GfxSettings = { style: "stylised", quality: "low", qualityChosen: true };
    expect(saveGfx(s, g)).toBe(true);
    expect(loadGfx(s)).toEqual(g);
  });
  it("saveGfx reports failure for null or throwing storage", () => {
    expect(saveGfx(null, DEFAULT_GFX)).toBe(false);
    expect(saveGfx(throwing, DEFAULT_GFX)).toBe(false);
  });
});

describe("autoQuality", () => {
  it("drops to low only when quality was not chosen and fps < 40", () => {
    expect(autoQuality(DEFAULT_GFX, 30).quality).toBe("low");
    expect(autoQuality(DEFAULT_GFX, 45).quality).toBe("high");
    expect(autoQuality(DEFAULT_GFX, 40).quality).toBe("high");
  });
  it("leaves a chosen high alone", () => {
    const chosen: GfxSettings = { style: "realistic", quality: "high", qualityChosen: true };
    expect(autoQuality(chosen, 10)).toEqual(chosen);
  });
});

describe("initialGfx", () => {
  it("starts low on coarse pointers when no quality was chosen", () => {
    expect(initialGfx(DEFAULT_GFX, true).quality).toBe("low");
    expect(initialGfx(DEFAULT_GFX, true).qualityChosen).toBe(false);
  });
  it("respects a chosen quality and fine pointers", () => {
    const chosen: GfxSettings = { style: "stylised", quality: "high", qualityChosen: true };
    expect(initialGfx(chosen, true)).toEqual(chosen);
    expect(initialGfx(DEFAULT_GFX, false)).toEqual(DEFAULT_GFX);
  });
});

describe("chaseDistance", () => {
  it("has a 0.6 m floor and scales 3.5 BL", () => {
    expect(chaseDistance(10)).toBe(0.6);
    expect(chaseDistance(22)).toBeCloseTo(0.77, 5);
    expect(chaseDistance(95)).toBeCloseTo(3.325, 5);
  });
});

const lum = (c: [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const env = (light: number, visibilityM = 6, season: "winter" | "spring" | "summer" | "autumn" = "spring") => ({ light, visibilityM, season });

describe("water absorption", () => {
  it("absorptionColor luminance falls as depth increases", () => {
    for (const season of ["winter", "spring", "summer", "autumn"] as const) {
      for (const light of [0, 0.5, 1]) {
        const look = waterLook(env(light, 6, season), "realistic");
        let prev = Infinity;
        for (let d = 0; d <= 6; d += 0.5) {
          const l = lum(absorptionColor(d, look, 6));
          expect(l).toBeLessThan(prev);
          prev = l;
        }
      }
    }
  });
  it("night is darker than noon at equal depth", () => {
    const night = waterLook(env(0.04), "realistic");
    const noon = waterLook(env(1), "realistic");
    for (const d of [0, 2, 5]) expect(lum(absorptionColor(d, night, 6))).toBeLessThan(lum(absorptionColor(d, noon, 6)));
  });
  it("density rises as visibility falls (2.2 / max(vis, 1.5))", () => {
    const ds = [12, 6, 3, 1.5].map((v) => waterLook(env(1, v), "realistic").density);
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThan(ds[i - 1]!);
    expect(ds[2]).toBeCloseTo(2.2 / 3, 6);
    expect(waterLook(env(1, 0.5), "realistic").density).toBeCloseTo(2.2 / 1.5, 6);
  });
  it("ambientFloor is at least 0.06 in the dark", () => {
    expect(waterLook(env(0), "realistic").ambientFloor).toBeGreaterThanOrEqual(0.06);
    expect(waterLook(env(0), "stylised").ambientFloor).toBeGreaterThanOrEqual(0.06);
  });
});

describe("caustics", () => {
  it("strength falls monotonically with depth", () => {
    for (const light of [0.3, 0.6, 1]) {
      let prev = Infinity;
      for (let d = 0; d <= 6; d += 0.25) {
        const s = causticStrength(d, light);
        expect(s).toBeLessThan(prev);
        prev = s;
      }
    }
  });
  it("is zero at night and strongest at noon", () => {
    for (const d of [0, 1, 3]) {
      expect(causticStrength(d, 0)).toBe(0);
      expect(causticStrength(d, 0.04)).toBe(0);
      expect(causticStrength(d, 1)).toBeGreaterThan(causticStrength(d, 0.5));
    }
  });
  it("is bounded in 0..1 and bright in the shallows at noon", () => {
    expect(causticStrength(0.3, 1)).toBeGreaterThan(0.6);
    expect(causticStrength(0, 1)).toBeLessThanOrEqual(1);
  });
});

describe("plants", () => {
  it("nearFade: 0 at <=0.4 m, 1 at >=1.4 m, monotonic", () => {
    expect(nearFade(0)).toBe(0);
    expect(nearFade(0.4)).toBe(0);
    expect(nearFade(1.4)).toBe(1);
    expect(nearFade(5)).toBe(1);
    let prev = -1;
    for (let d = 0; d <= 1.6; d += 0.01) {
      const f = nearFade(d);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(nearFade(0.9)).toBeCloseTo(0.5, 6);
  });
  it("plantCounts: high 40 per reed patch, 24 per weed bed; low is half, rounded", () => {
    const h = plantCounts("high", 140, 90);
    expect(h.reedBlades).toBe(140 * 40);
    expect(h.weedFronds).toBe(90 * 24);
    const l = plantCounts("low", 140, 90);
    expect(l.reedBlades).toBe(Math.round(h.reedBlades / 2));
    expect(l.weedFronds).toBe(Math.round(h.weedFronds / 2));
    expect(l.lilyPads).toBe(Math.round(h.lilyPads / 2));
    expect(h.lilyPads).toBeGreaterThan(0);
    expect(plantCounts("high", 0, 0)).toEqual({ reedBlades: 0, weedFronds: 0, lilyPads: 0 });
  });
});

describe("fish model v2 and skins", () => {
  const species: FishSpecies[] = ["pike", "perch", "roach", "rudd"];
  const count = (g: THREE.BufferGeometry, part: number) => {
    const a = g.getAttribute("aPart");
    let n = 0;
    for (let i = 0; i < a.count; i++) if (a.getX(i) === part) n++;
    return n;
  };
  it("has finite attributes for every species and detail level", () => {
    for (const s of species)
      for (const d of [DETAIL.low, DETAIL.high, DETAIL.hero]) {
        const g = buildFishModel(s, d);
        for (const name of ["position", "aUV", "aPart", "aFin"]) {
          const arr = g.getAttribute(name).array;
          for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
        }
        expect(g.getAttribute("aUV").count).toBe(g.getAttribute("position").count);
      }
  });
  it("has a body, fins and two eyes", () => {
    for (const s of species) {
      const g = buildFishModel(s, DETAIL.high);
      expect(count(g, 0)).toBeGreaterThan(500);
      expect(count(g, 1)).toBeGreaterThan(150);
      expect(count(g, 2)).toBeGreaterThan(100);
    }
  });
  it("perch has two dorsal fins, the others one", () => {
    const finIds = (s: FishSpecies) => new Set(Array.from(buildFishModel(s, DETAIL.low).getAttribute("aFin").array));
    expect(finIds("perch").has(FIN.dorsal2)).toBe(true);
    expect(finIds("pike").has(FIN.dorsal2)).toBe(false);
  });
  it("prey stay light enough to instance hundreds (high under 2500 vertices)", () => {
    for (const s of ["perch", "roach", "rudd"] as FishSpecies[]) expect(buildFishModel(s, DETAIL.high).getAttribute("position").count).toBeLessThan(2500);
  });
  it("stays inside a unit-fish box, nose at +0.5", () => {
    for (const s of species) {
      const g = buildFishModel(s, DETAIL.high);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.x).toBeCloseTo(0.5, 1);
      expect(g.boundingBox!.min.x).toBeGreaterThan(-0.55);
      expect(g.boundingBox!.max.y).toBeLessThan(0.3);
    }
  });
  it("profiles pass through their keys and stay positive", () => {
    const k = ANATOMY.pike.body;
    expect(profile(k, 1, k[4]![0])).toBeCloseTo(k[4]![1], 5);
    for (let t = 0; t <= 0.9; t += 0.01) expect(profile(k, 3, t)).toBeGreaterThan(0);
  });
  it("pike is slender and perch is deep-bodied", () => {
    const depth = (s: FishSpecies) => Math.max(...ANATOMY[s].body.map((r) => r[1] + r[2]));
    expect(depth("pike")).toBeLessThan(0.14);
    expect(depth("perch")).toBeGreaterThan(0.19);
  });
  it("SKINS: four species, pike spots pale on olive, perch bars, silver roach", () => {
    expect(Object.keys(SKINS).sort()).toEqual(["perch", "pike", "roach", "rudd"]);
    expect(SKINS.pike.pattern).toBe("spots");
    expect(SKINS.perch.pattern).toBe("bars");
    const lum = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;
    expect(lum(SKINS.pike.patternColor)).toBeGreaterThan(lum(SKINS.pike.flank));
    expect(SKINS.roach.metal).toBeGreaterThan(0.5);
    expect(SKINS.rudd.fins).toHaveLength(6);
  });
  it("material cache key differs by tint and by species", () => {
    const key = (sp: FishSpecies, tint: number) => {
      const m = new THREE.MeshStandardMaterial();
      applyFishSkin(m, {} as never, sp, tint, 0);
      return m.customProgramCacheKey();
    };
    expect(key("pike", 1)).not.toBe(key("pike", 0.55));
    expect(key("pike", 1)).not.toBe(key("perch", 1));
    expect(key("pike", 1)).toBe(key("pike", 1));
  });
});

describe("camera rig", () => {
  const world = new World(defaultParams.world, 1); // a real lake (the rig clamps over water)
  const pike = { pos: { x: 0, y: -2, z: 0 }, yaw: 0, pitch: 0, speed: 0, lengthCm: 22 } as never;
  const dist = (mode: CameraMode) => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.setMode(mode);
    for (let i = 0; i < 120; i++) rig.update(pike, { yaw: 0, pitch: 0 }, world, 1 / 60);
    return cam.position.distanceTo(new THREE.Vector3(0, -2, 0));
  };
  it("close is nearer than chase, chase nearer than wide", () => {
    expect(dist("close")).toBeLessThan(dist("chase"));
    expect(dist("chase")).toBeLessThan(dist("wide"));
  });
  it("cycles through every mode and back", () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera());
    const seen = CAMERA_MODES.map(() => rig.next());
    expect(new Set(seen).size).toBe(CAMERA_MODES.length);
    expect(rig.mode).toBe("chase");
  });
  it("eye view hides the player and sits at the head", () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.setMode("eye");
    rig.update(pike, { yaw: 0, pitch: 0 }, world, 1 / 60);
    expect(rig.hidesPlayer).toBe(true);
    expect(cam.position.x).toBeGreaterThan(0);
  });
  it("zoom scales the distance", () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.zoom = 2;
    for (let i = 0; i < 120; i++) rig.update(pike, { yaw: 0, pitch: 0 }, world, 1 / 60);
    expect(cam.position.distanceTo(new THREE.Vector3(0, -2, 0))).toBeCloseTo(dist("chase") * 2, 1);
  });
});

describe("life particles and strike bursts", () => {
  // minimal sim stand-in: burstsFromEvents only reads pikes, prey and the lakebed height
  const fakeSim = (pikeY: number) =>
    ({
      pikes: [{ id: 1, pos: { x: 0, y: pikeY, z: 0 }, yaw: 0, pitch: 0, lengthCm: 40 }],
      prey: [{ id: 7, pos: { x: 2, y: -1, z: 3 } }],
      world: { bottomY: () => -3 },
    }) as unknown as Parameters<typeof burstsFromEvents>[2];
  const strike = { type: "strike", pikeId: 1, lockId: null, t: 5 } as SimEvent;
  const capture = { type: "capture", pikeId: 1, preyId: 7, kind: "roach", grams: 10, lengthCm: 10, t: 6 } as SimEvent;

  it("maps a strike to bubbles at the mouth", () => {
    const r = burstsFromEvents([strike], 0, fakeSim(-1));
    expect(r.bursts.map((b) => b.kind)).toEqual(["bubbles"]);
    expect(r.bursts[0]!.pos.x).toBeCloseTo(0.2); // half a body length ahead (yaw 0 faces +x)
  });
  it("adds silt only when the strike is near the bottom", () => {
    const r = burstsFromEvents([strike], 0, fakeSim(-2.7));
    expect(r.bursts.map((b) => b.kind).sort()).toEqual(["bubbles", "silt"]);
    expect(r.bursts.find((b) => b.kind === "silt")!.pos.y).toBe(-3);
  });
  it("maps a capture to scales at the prey position", () => {
    const r = burstsFromEvents([capture], 0, fakeSim(-1));
    expect(r.bursts).toHaveLength(1);
    expect(r.bursts[0]).toMatchObject({ kind: "scales", pos: { x: 2, y: -1, z: 3 }, t0: 6 });
  });
  it("advances next and ignores events before fromIndex", () => {
    const r = burstsFromEvents([capture, strike], 1, fakeSim(-1));
    expect(r.next).toBe(2);
    expect(r.bursts.map((b) => b.kind)).toEqual(["bubbles"]);
  });
  it("restarts from the buffer start when the event buffer was trimmed", () => {
    const r = burstsFromEvents([strike], 50, fakeSim(-1));
    expect(r.next).toBe(1);
    expect(r.bursts).toHaveLength(0); // events behind a trim are not replayed
  });
  it("low quality has half the particles of high", () => {
    expect(particleCounts("high")).toEqual({ snow: 1800, glints: 250 });
    expect(particleCounts("low")).toEqual({ snow: 900, glints: 120 });
  });
});

describe("post chain and quality", () => {
  it("high caps the pixel ratio at 2, low pins it at 1", () => {
    expect(pixelRatioFor("high", 1)).toBe(1);
    expect(pixelRatioFor("high", 1.5)).toBe(1.5);
    expect(pixelRatioFor("high", 3)).toBe(2);
    expect(pixelRatioFor("low", 3)).toBe(1);
    expect(pixelRatioFor("low", 0.8)).toBe(0.8); // never upscale a sub-1 display
  });
  it("light shafts exist on high only", () => {
    expect(shaftCount("high")).toBe(24);
    expect(shaftCount("low")).toBe(0);
  });
});

describe("stylised style", () => {
  const env = { light: 0.8, season: "summer" as const, visibilityM: 4 };
  const lum = (c: [number, number, number]): number => Math.round((0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * 1000);
  it("stylised absorption takes at most 4 flat depth bands", () => {
    const look = waterLook(env, "stylised");
    const seen = new Set<number>();
    for (let d = 0; d <= 8; d += 0.05) seen.add(lum(absorptionColor(d, look, 8)));
    expect(seen.size).toBeLessThanOrEqual(4);
    expect(seen.size).toBeGreaterThan(1);
  });
  it("realistic absorption stays a smooth gradient", () => {
    const look = waterLook(env, "realistic");
    const seen = new Set<number>();
    for (let d = 0; d <= 8; d += 0.05) seen.add(lum(absorptionColor(d, look, 8)));
    expect(seen.size).toBeGreaterThan(20);
  });
  it("stylised grade is more saturated than realistic", () => {
    expect(gradeFor("stylised").saturation).toBeGreaterThan(gradeFor("realistic").saturation);
  });
});
