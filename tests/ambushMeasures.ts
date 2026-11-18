import { angleDiff, clamp, v3, type Vec3 } from "../src/sim/math";
import { lungeCandidate, lungeRange, lungeTargets } from "../src/sim/lunge";
import { tooFullFor, type PikeInput, type PikeState } from "../src/sim/pike";
import { presetSettings } from "../src/sim/settings";
import { Simulation } from "../src/sim/simulation";
import { defaultParams } from "../src/sim/params";
import type { PreyState } from "../src/sim/prey";

interface Patch {
  x: number;
  z: number;
  radius: number;
  /** Cover band (top y, bottom y) at a horizontal position inside the patch. */
  band: (x: number, z: number) => [number, number];
}

interface School {
  fish: PreyState[];
  centroid: Vec3;
  /** Where the school grazes: its shared forage target once it has one, else its centroid. */
  grazing: Vec3;
  /** Mean depth the fish hold (habitat home depth), y. */
  depth: number;
}

/** Living schools of at least `minSize` fish, largest first. */
function schools(sim: Simulation, minSize = 1): School[] {
  const groups = new Map<number, PreyState[]>();
  for (const f of sim.prey) {
    if (!f.alive) continue;
    const g = groups.get(f.schoolId) ?? [];
    g.push(f);
    groups.set(f.schoolId, g);
  }
  const out: School[] = [];
  for (const fish of groups.values()) {
    if (fish.length < minSize) continue;
    const mean = (g: (f: PreyState) => number): number => fish.reduce((a, f) => a + g(f), 0) / fish.length;
    const centroid = v3(mean((f) => f.pos.x), mean((f) => f.pos.y), mean((f) => f.pos.z));
    const target = fish.find((f) => f.forageTarget)?.forageTarget;
    out.push({ fish, centroid, grazing: target ? { ...target } : centroid, depth: mean((f) => f.homeDepth) });
  }
  return out.sort((a, b) => b.fish.length - a.fish.length || a.fish[0]!.id - b.fish[0]!.id);
}

function patches(sim: Simulation): Patch[] {
  const w = sim.world;
  return [
    ...w.reeds.map((r) => ({ x: r.x, z: r.z, radius: r.radius, band: (): [number, number] => [-0.3, -r.height - 0.1] })),
    ...w.weeds.map((k) => ({
      x: k.x,
      z: k.z,
      radius: k.radius,
      band: (x: number, z: number): [number, number] => [Math.min(-0.3, w.bottomY(x, z) + k.height - 0.1), w.bottomY(x, z) + 0.2],
    })),
  ];
}

/** Hiding spot on the patch a school grazes: inside the margin on the lake side, as near the school's depth as cover allows. */
function spotFor(school: School, all: Patch[]): { pos: Vec3; yaw: number; gap: number } {
  let patch = all[0]!;
  let bd = Infinity;
  for (const c of all) {
    const d = Math.hypot(c.x - school.grazing.x, c.z - school.grazing.z);
    if (d < bd) {
      bd = d;
      patch = c;
    }
  }
  const rr = Math.hypot(patch.x, patch.z) || 1;
  const ox = -patch.x / rr; // unit vector from the patch centre toward the lake centre
  const oz = -patch.z / rr;
  const x = patch.x + ox * patch.radius * 0.6; // cover there is 1 - 0.6 = 0.4 (0.36 in weed)
  const z = patch.z + oz * patch.radius * 0.6;
  const [top, bottom] = patch.band(x, z);
  const y = clamp(school.depth, bottom, top);
  return { pos: v3(x, y, z), yaw: Math.atan2(oz, ox), gap: Math.abs(y - school.depth) };
}

/**
 * Ambush spot: what a competent pike picks. Among the schools of 8+ fish it takes the one whose
 * grazing patch lets it hide nearest that school's depth (deep weed beds under a high school are
 * useless), larger schools first on ties. The spot is just inside that patch's margin on the lake
 * side (cover about 0.4), facing out of the cover.
 */
export function edgeSpotNearSchool(sim: Simulation): { pos: Vec3; yaw: number } {
  const all = patches(sim);
  let best: { pos: Vec3; yaw: number; gap: number } | null = null;
  for (const s of schools(sim, 8)) {
    const c = spotFor(s, all);
    if (!best || c.gap < best.gap - 0.25) best = c;
  }
  return { pos: best!.pos, yaw: best!.yaw };
}

const STILL: PikeInput = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };

/** Competent ambusher: never swims; slowly turns toward the best edible sensed fish; bursts on a green candidate it has room for. */
export function ambusherInput(sim: Simulation, pk: PikeState): PikeInput {
  const best = lungeTargets(sim, pk)[0];
  if (!best || !best.edible) return STILL;
  const dx = best.pos.x - pk.pos.x;
  const dy = best.pos.y - pk.pos.y;
  const dz = best.pos.z - pk.pos.z;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pk.pitch;
  return {
    throttle: 0,
    yawRate: clamp(yawErr * 2, -0.3, 0.3),
    pitchRate: clamp(pitchErr * 2, -0.3, 0.3),
    burst: pk.energy > 50 && worthStriking(sim, pk),
  };
}

/** A green candidate the pike has stomach room for (a sated pike only scares fish and leaves cover). */
function worthStriking(sim: Simulation, pk: PikeState): boolean {
  const c = lungeCandidate(sim, pk);
  if (!c) return false;
  const w = sim.prey.find((f) => f.id === c.id)?.weight ?? sim.pikes.find((o) => o.id === c.id)?.weight ?? 0;
  return !tooFullFor(pk, w, sim.p);
}

/** Open-water chaser: full throttle at the nearest edible sensed fish, bursting inside 1.5 x lunge range. */
export function chaserInput(sim: Simulation, pk: PikeState): PikeInput {
  let best: { pos: Vec3; distance: number } | null = null;
  for (const t of lungeTargets(sim, pk)) if (t.edible && (!best || t.distance < best.distance)) best = t;
  // Nothing sensed: head for the largest school so the chase keeps going.
  const goal = best?.pos ?? schools(sim)[0]!.centroid;
  const dx = goal.x - pk.pos.x;
  const dy = goal.y - pk.pos.y;
  const dz = goal.z - pk.pos.z;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pk.pitch;
  return {
    throttle: 1,
    yawRate: clamp(yawErr * 3, -1, 1),
    pitchRate: clamp(pitchErr * 3, -1, 1),
    burst: best !== null && best.distance <= 1.5 * lungeRange(pk, sim.p),
  };
}

/** Catches count only useful meals (at least USEFUL_G swallowed). */
export interface HuntRun {
  firstCatchS: number | null;
  catches: number;
  bursts: number;
}

const USEFUL_G = 1;

const DT = 1 / 30;
/** Seconds the lake runs before the pike arrives, so schools have settled on a grazing margin. */
const SETTLE_S = 20;

/** A rival-free lake from 08:00 with a 22 cm pike placed for the given controller. */
export function huntSim(seed: number, controller: "ambusher" | "chaser"): { sim: Simulation; pk: PikeState } {
  const settings = { ...presetSettings("natural", "permadeath", defaultParams), rivalCount: 0 };
  const sim = new Simulation({ seed, startHour: 8, settings });
  for (let i = 0; i < SETTLE_S / DT; i++) sim.step(DT);
  sim.events.length = 0;
  let pk: PikeState;
  if (controller === "ambusher") {
    const spot = edgeSpotNearSchool(sim);
    pk = sim.addPike(22, spot.pos);
    pk.yaw = spot.yaw;
  } else {
    pk = sim.addPike(22, v3(0, -1.5, 0));
  }
  pk.pitch = 0;
  pk.speed = 0;
  return { sim, pk };
}

/** One hunting run, timed from the pike's arrival, driven by a scripted controller. */
export function huntRun(seed: number, controller: "ambusher" | "chaser", seconds: number): HuntRun {
  const { sim, pk } = huntSim(seed, controller);
  const input = controller === "ambusher" ? ambusherInput : chaserInput;
  const run: HuntRun = { firstCatchS: null, catches: 0, bursts: 0 };
  const steps = Math.round(seconds / DT);
  for (let i = 1; i <= steps && pk.alive; i++) {
    sim.setInput(pk.id, input(sim, pk));
    sim.step(DT);
    for (const e of sim.events) {
      if (e.type === "strike" && e.pikeId === pk.id) run.bursts++;
      if (e.type === "capture" && e.pikeId === pk.id && e.grams >= USEFUL_G) {
        run.catches++;
        run.firstCatchS ??= i * DT;
      }
    }
    sim.events.length = 0;
  }
  return run;
}
