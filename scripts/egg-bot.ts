// Egg-start bot: a hatchling chases the nearest edible fish and strikes when a lunge target is ready.
// Reports time to each stage and catches, for Growth x1 / x3 / x8. Run: npx tsx scripts/egg-bot.ts
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { lungeCandidate } from "../src/sim/lunge";
import { angleDiff, clamp } from "../src/sim/math";
import { placeInWeedBed, startLengthCm, NURSERY_END_CM } from "../src/sim/nursery";
import { STAGES } from "../src/game/score";

const MIN = Number(process.env.MIN ?? 20);
function run(seed: number, growthMul: number, map: "lake" | "river") {
  const settings = { ...presetSettings("gentle", "permadeath", defaultParams), chill: true, big: true, startEgg: true, growthMul, map };
  const sim = new Simulation({ seed, settings });
  const pl = sim.addPlayer(startLengthCm(settings, sim.p));
  sim.arcade = true;
  placeInWeedBed(sim.world, pl);
  let caps = 0, strikes = 0, cooldown = 0;
  const miss: Record<string, number> = {};
  const stageAt: Record<string, number> = {};
  const maxLen = sim.p.pike.maxPreyLengthFracOfBL;
  for (let i = 0; i < MIN * 3600; i++) {
    const t = i / 60;
    let best = null as null | { x: number; y: number; z: number }, bd = Infinity;
    for (const f of sim.prey) {
      if (!f.alive || f.lengthCm > maxLen * pl.lengthCm) continue;
      const d = Math.hypot(f.pos.x - pl.pos.x, f.pos.y - pl.pos.y, f.pos.z - pl.pos.z);
      if (d < bd) { bd = d; best = f.pos; }
    }
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
      if (e.type === "capture" && e.pikeId === pl.id) caps++;
      if (e.type === "miss" && e.pikeId === pl.id) miss[e.reason] = (miss[e.reason] ?? 0) + 1;
    }
    sim.events.length = 0;
    for (const s of STAGES) if (pl.lengthCm >= s.fromCm && !(s.name in stageAt)) stageAt[s.name] = Math.round(t);
    if (pl.lengthCm >= NURSERY_END_CM) break;
  }
  return { len: +pl.lengthCm.toFixed(1), caps, strikes, miss, stageAt };
}
for (const map of (process.env.MAP ? [process.env.MAP] : ["lake", "river"]) as ("lake" | "river")[])
  for (const g of (process.env.G ? [Number(process.env.G)] : [1, 3, 8])) {
    const r = run(7, g, map);
    console.log(map, `x${g}`, JSON.stringify(r));
  }
