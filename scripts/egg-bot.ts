// Egg-start bot: a hatchling chases the nearest edible fish and strikes when a lunge target is ready.
// Reports time to each stage and catches, for Growth x1 / x3 / x8. Run: npx tsx scripts/egg-bot.ts
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { lungeCandidate } from "../src/sim/lunge";
import { angleDiff, clamp } from "../src/sim/math";
import { placeInWeedBed, startLengthCm, NURSERY_END_CM } from "../src/sim/nursery";
import { STAGES } from "../src/game/score";

const TARGET_CM = Number(process.env.TARGET_CM ?? 50);
const MIN = Number(process.env.MIN ?? 20);
function run(seed: number, growthMul: number, map: "lake" | "river") {
  const settings = { ...presetSettings("gentle", "permadeath", defaultParams), chill: true, big: true, startEgg: true, growthMul, map };
  const sim = new Simulation({ seed, settings });
  const pl = sim.addPlayer(startLengthCm(settings, sim.p));
  sim.arcade = true;
  placeInWeedBed(sim.world, pl);
  let targetId = -1, targetSince = 0, lastCap = 0;
  const banned = new Map<number, number>();
  let caps = 0, strikes = 0, cooldown = 0;
  const miss: Record<string, number> = {};
  const stageAt: Record<string, number> = {};
  const maxLen = sim.p.pike.maxPreyLengthFracOfBL;
  for (let i = 0; i < MIN * 3600; i++) {
    const t = i / 60;
    if (process.env.TRACE && i % 1800 === 0) console.log("t", Math.round(t), pl.lengthCm.toFixed(1), JSON.stringify(pl.pos), "alive", pl.alive, "nprey", sim.prey.filter((f) => f.alive && f.lengthCm <= maxLen * pl.lengthCm).length, "caps", caps, "strikes", strikes);
    let best = null as null | { x: number; y: number; z: number }, bd = Infinity, bestId = -1;
    for (const f of sim.prey) {
      if (!f.alive || f.lengthCm > maxLen * pl.lengthCm || (banned.get(f.id) ?? 0) > t) continue;
      const d = Math.hypot(f.pos.x - pl.pos.x, f.pos.y - pl.pos.y, f.pos.z - pl.pos.z);
      if (d < bd) { bd = d; best = f.pos; bestId = f.id; }
    }
    // a player gives up on a fish that will not be caught: ban a target chased for 6 s without a catch
    if (bestId !== targetId) { targetId = bestId; targetSince = t; }
    else if (bestId >= 0 && t - targetSince > 6 && t - lastCap > 6) { banned.set(bestId, t + 25); targetSince = t; }
    let input = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
    if (best) {
      const dx = best.x - pl.pos.x, dy = best.y - pl.pos.y, dz = best.z - pl.pos.z;
      const yawErr = angleDiff(Math.atan2(dz, dx), pl.yaw);
      const pitchErr = Math.atan2(dy, Math.hypot(dx, dz)) - pl.pitch;
      // like a player: ease off when close or badly aligned, so the pike does not orbit its target
      const L = pl.lengthCm / 100;
      const near = clamp(bd / (6 * L), 0.15, 1);
      input = { throttle: Math.abs(yawErr) > 0.6 || Math.abs(pitchErr) > 0.6 ? 0.1 : near, yawRate: clamp(yawErr * 3, -1, 1), pitchRate: clamp(pitchErr * 3, -1, 1), burst: false };
    }
    cooldown -= 1 / 60;
    if (cooldown <= 0 && lungeCandidate(sim, pl)) { input.burst = true; cooldown = 0.3; }
    sim.setInput(pl.id, input);
    sim.step(1 / 60);
    for (const e of sim.events) {
      if (e.type === "strike" && e.pikeId === pl.id) strikes++;
      if (e.type === "capture" && e.pikeId === pl.id) { caps++; lastCap = t; }
      if (e.type === "miss" && e.pikeId === pl.id) miss[e.reason] = (miss[e.reason] ?? 0) + 1;
    }
    sim.events.length = 0;
    for (const s of STAGES) if (pl.lengthCm >= s.fromCm && !(s.name in stageAt)) stageAt[s.name] = Math.round(t);
    if (!("22cm" in stageAt) && pl.lengthCm >= NURSERY_END_CM) stageAt["22cm"] = Math.round(t);
    if (!("50cm" in stageAt) && pl.lengthCm >= 50) stageAt["50cm"] = Math.round(t);
    if (pl.lengthCm >= TARGET_CM) break;
  }
  return { len: +pl.lengthCm.toFixed(1), caps, strikes, miss, stageAt };
}
for (const map of (process.env.MAP ? [process.env.MAP] : ["lake", "river"]) as ("lake" | "river")[])
  for (const g of (process.env.G ? [Number(process.env.G)] : [1, 3, 8])) {
    for (const seed of (process.env.SEEDS ?? "7").split(",").map(Number)) {
      const r = run(seed, g, map);
      console.log(map, `x${g}`, `seed${seed}`, JSON.stringify(r));
    }
  }
