import type { Simulation } from "./simulation";

export type MilestoneId = "first-winter" | "length-50" | "length-80" | "first-spawn" | "largest-pike";

export const MILESTONE_TEXT: Record<MilestoneId, string> = {
  "first-winter": "Survived your first winter",
  "length-50": "Reached 50 cm",
  "length-80": "Reached 80 cm",
  "first-spawn": "Spawned for the first time",
  "largest-pike": "Largest pike in the lake",
};

/** Award any newly met milestones to the living player; returns the new ids. */
export function checkMilestones(sim: Simulation): MilestoneId[] {
  const pl = sim.player();
  if (!pl || !pl.alive) return [];
  const met = (id: MilestoneId): boolean => {
    switch (id) {
      case "first-winter":
        return sim.playerSawWinter && sim.env.season !== "winter";
      case "length-50":
        return pl.lengthCm >= 50;
      case "length-80":
        return pl.lengthCm >= 80;
      case "first-spawn":
        return pl.spawnedYear !== null; // set by spawnPair, also on the coarse path
      case "largest-pike": {
        const others = sim.pikes.filter((k) => k.alive && k.id !== pl.id);
        return others.length > 0 && others.every((k) => pl.lengthCm > k.lengthCm);
      }
    }
  };
  const fresh: MilestoneId[] = [];
  for (const id of Object.keys(MILESTONE_TEXT) as MilestoneId[]) {
    if (sim.milestones.includes(id) || !met(id)) continue;
    sim.milestones.push(id);
    sim.events.push({ type: "milestone", id, t: sim.time });
    fresh.push(id);
  }
  return fresh;
}
