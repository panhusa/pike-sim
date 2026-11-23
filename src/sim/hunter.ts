import { angleDiff, clamp, type Vec3 } from "./math";
import { lungeCandidate } from "./lunge";
import type { PikeInput, PikeState } from "./pike";
import type { Simulation } from "./simulation";

/**
 * Game "hunter" event: one big pike is sent after the player. It always knows where the player is,
 * unless the player hides (still, in cover, and not too close): then it swims to the last seen spot
 * and gives up after searchS. Transient game state, not saved.
 */
export interface Hunter {
  id: number;
  /** the human pike it is after */
  targetId: number;
  /** seconds since the hunt began */
  t: number;
  lastSeen: Vec3;
  /** seconds the player has been hidden from it */
  lostS: number;
  /** how it ended, set once */
  outcome: null | "escaped" | "timeout" | "bit-player" | "scared-player" | "ate-player" | "hunter-died";
}

export const HUNTER = {
  durationS: 25,
  searchS: 4,
  hideStillS: 1.2,
  hideMinCover: 0.35,
  noticeRangeM: 3,
  spawnBehindM: 14,
  /** hunter length relative to the smallest pike that can swallow the player */
  sizeMargin: 1.1,
};

/** Hunter body length needed to swallow the player. */
export function hunterMinLength(sim: Simulation, player: PikeState): number {
  return (player.lengthCm / sim.p.pike.maxPreyLengthFracOfBL) * HUNTER.sizeMargin;
}

export interface HideRule {
  hideStillS: number;
  hideMinCover: number;
  noticeRangeM: number;
}

/** The player is hidden from a seeker: still long enough, in cover, and not right next to it. */
export function playerHidden(sim: Simulation, seeker: { pos: Vec3 }, player: PikeState, rule: HideRule = HUNTER): boolean {
  const d = Math.hypot(player.pos.x - seeker.pos.x, player.pos.y - seeker.pos.y, player.pos.z - seeker.pos.z);
  return player.stillTime >= rule.hideStillS && sim.world.coverAt(player.pos) >= rule.hideMinCover && d > rule.noticeRangeM;
}

/** Full-speed chase toward the player (or its last seen spot), bursting when the player is lungeable. */
export function hunterInput(sim: Simulation, pk: PikeState, h: Hunter, dt: number): PikeInput {
  const pl = sim.pikes.find((k) => k.id === h.targetId);
  if (!pl || !pl.alive) return { throttle: 0.3, yawRate: 0, pitchRate: 0, burst: false };
  if (playerHidden(sim, pk, pl)) h.lostS += dt;
  else {
    h.lostS = 0;
    h.lastSeen = { ...pl.pos };
  }
  const to = h.lastSeen;
  const dx = to.x - pk.pos.x;
  const dy = to.y - pk.pos.y;
  const dz = to.z - pk.pos.z;
  const yawErr = angleDiff(Math.atan2(dz, dx), pk.yaw);
  const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pk.pitch;
  const burst = h.lostS === 0 && lungeCandidate(sim, pk)?.id === pl.id;
  return {
    throttle: Math.abs(yawErr) > 1.2 ? 0.5 : 1,
    yawRate: clamp(yawErr * 3, -1, 1),
    pitchRate: clamp(pitchErr * 3, -1, 1),
    burst,
  };
}
