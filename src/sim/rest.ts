import { coarseAdvance } from "./coarse";
import { dist } from "./math";
import { condition } from "./pike";
import type { Simulation } from "./simulation";

export type RestBlocker = "dead" | "moving" | "no-cover" | "rival-near";
export type RestStop =
  | { reason: "done" }
  | { reason: "threat"; rivalId: number }
  | { reason: "hunger" }
  | { reason: "death" };

/** Why the player cannot rest right now (empty when resting is allowed). */
export function restBlockers(sim: Simulation): RestBlocker[] {
  const player = sim.player();
  if (!player || !player.alive) return ["dead"];
  const k = sim.p.rest;
  const out: RestBlocker[] = [];
  if (player.stillTime < k.minStillS) out.push("moving");
  if (sim.world.coverAt(player.pos) < k.minCover) out.push("no-cover");
  const maxPrey = sim.p.pike.maxPreyLengthFracOfBL;
  const near = sim.pikes.some(
    (r) =>
      r !== player &&
      r.alive &&
      !!r.ai &&
      player.lengthCm <= maxPrey * r.lengthCm &&
      dist(r.pos, player.pos) <= k.safeRadiusM,
  );
  if (near) out.push("rival-near");
  return out;
}

/** Put the finder `threatSpawnDistM` from the player on the line from its home, hunting the player. */
function placeThreat(sim: Simulation, rivalId: number): void {
  const player = sim.player();
  const rival = sim.pikes.find((k) => k.id === rivalId);
  if (!player || !rival?.ai) return;
  const home = rival.ai.home;
  let dx = home.x - player.pos.x;
  let dz = home.z - player.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    dx = 1;
    dz = 0;
  } else {
    dx /= d;
    dz /= d;
  }
  const r = sim.p.rest.threatSpawnDistM;
  rival.pos = { x: player.pos.x + dx * r, y: player.pos.y, z: player.pos.z + dz * r };
  sim.world.confine(rival.pos, 0.1);
  rival.yaw = Math.atan2(player.pos.z - rival.pos.z, player.pos.x - rival.pos.x);
  rival.pitch = 0;
  rival.speed = 0;
  rival.ai.mode = "hunt";
  rival.ai.targetId = player.id;
  rival.ai.lostS = 0;
}

/** Rest for up to `bioSeconds`, stopping early on a rival's find or when the player gets hungry. */
export function restFor(sim: Simulation, bioSeconds: number): RestStop {
  const player = sim.player();
  if (!player) return { reason: "death" };
  const floor = sim.p.rest.hungerStopCondition;
  const report = coarseAdvance(sim, bioSeconds, { player: "resting", onThreat: "stop" }, () => condition(player, sim.p) < floor);
  if (report.playerDied) return { reason: "death" };
  if (report.threatRivalId !== null) {
    placeThreat(sim, report.threatRivalId);
    return { reason: "threat", rivalId: report.threatRivalId };
  }
  return condition(player, sim.p) < floor ? { reason: "hunger" } : { reason: "done" };
}
