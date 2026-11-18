import type { LungeTarget } from "../sim/lunge";
import type { Vec3 } from "../sim/math";

export type MarkTone = "strike" | "edible" | "big"; // green / amber / grey
export interface Mark {
  id: number;
  x: number;
  y: number;
  tone: MarkTone;
  primary: boolean;
}

/**
 * Rings for the sensed targets (best first), at most `max`. The strike candidate (the first target
 * that can be lunged at, as lungeCandidate picks it) always gets a ring and the big primary one;
 * without a candidate the best visible target is primary.
 */
export function computeMarks(
  targets: LungeTarget[],
  project: (p: Vec3) => { x: number; y: number; visible: boolean },
  max: number,
): Mark[] {
  const visible: Mark[] = [];
  for (const t of targets) {
    const s = project(t.pos);
    if (!s.visible) continue;
    const tone: MarkTone = t.edible && t.inRange && t.inCone ? "strike" : t.edible ? "edible" : "big";
    visible.push({ id: t.id, x: s.x, y: s.y, tone, primary: false });
  }
  const primary = visible.find((m) => m.tone === "strike") ?? visible[0];
  if (!primary || max <= 0) return [];
  primary.primary = true;
  const marks = visible.filter((m) => m !== primary).slice(0, max - 1);
  marks.splice(Math.min(visible.indexOf(primary), marks.length), 0, primary); // keep best-first order
  return marks;
}

/** Reuses DOM nodes keyed by target id; nodes for vanished targets are removed. */
export function renderMarks(layer: HTMLElement, marks: Mark[]): void {
  const existing = new Map<string, HTMLElement>();
  for (const el of Array.from(layer.children) as HTMLElement[]) existing.set(el.dataset.id ?? "", el);
  const keep = new Set<string>();
  for (const m of marks) {
    const key = String(m.id);
    keep.add(key);
    let el = existing.get(key);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = key;
      layer.appendChild(el);
    }
    el.className = `mark ${m.tone}${m.primary ? " primary" : ""}`;
    el.style.transform = `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px) translate(-50%, -50%)`;
  }
  for (const [key, el] of existing) if (!keep.has(key)) el.remove();
}
