export type GfxStyle = "realistic" | "stylised";
export type GfxQuality = "high" | "low";
export interface GfxSettings {
  style: GfxStyle;
  quality: GfxQuality;
  /** true once the user picked a quality explicitly; disables the automatic drop to low */
  qualityChosen: boolean;
}

export const DEFAULT_GFX: Readonly<GfxSettings> = Object.freeze({ style: "realistic", quality: "high", qualityChosen: false });
const KEY = "pike.gfx.v1";

/** Stored settings, or DEFAULT_GFX when storage is missing, blocked, corrupt or holds unknown values. */
export function loadGfx(storage: Storage | null): GfxSettings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_GFX };
    const o = JSON.parse(raw) as Partial<GfxSettings> | null;
    if (!o || typeof o !== "object") return { ...DEFAULT_GFX };
    if ((o.style !== "realistic" && o.style !== "stylised") || (o.quality !== "high" && o.quality !== "low")) return { ...DEFAULT_GFX };
    return { style: o.style, quality: o.quality, qualityChosen: o.qualityChosen === true };
  } catch {
    return { ...DEFAULT_GFX };
  }
}

export function saveGfx(storage: Storage | null, s: GfxSettings): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Drop to low when the user has not picked a quality and the measured fps is poor. */
export function autoQuality(s: GfxSettings, avgFps: number): GfxSettings {
  return !s.qualityChosen && avgFps < 40 ? { ...s, quality: "low" } : s;
}

/** Starting settings: touch devices begin on low unless the user already chose a quality. */
export function initialGfx(stored: GfxSettings, coarsePointer: boolean): GfxSettings {
  return coarsePointer && !stored.qualityChosen ? { ...stored, quality: "low" } : stored;
}
