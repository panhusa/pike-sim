// Hunt bot: a simple player that chases the nearest edible prey and strikes when a lunge target is ready.
// Compares realistic vs arcade player tuning: captures and strikes over a few game minutes, several seeds.
import { placePlayerNearPrey, Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
import { lungeCandidate } from "../src/sim/lunge";
import { angleDiff, clamp } from "../src/sim/math";

const MIN = Number(process.env.MIN ?? 5);
function run(seed: number, arcade: boolean) {
  const sim = new Simulation({ seed, settings: presetSettings("gentle", "permadeath", defaultParams) });
  const pl = sim.addPlayer(sim.p.pike.startLengthCm);
  sim.arcade = arcade;
  if (arcade) placePlayerNearPrey(sim);
  let caps = 0, strikes = 0, first = -1, cooldown = 0;
  const miss: Record<string, number> = {};
  const maxLen = sim.p.pike.maxPreyLengthFracOfBL;
  for (let i = 0; i < MIN * 60 * 60; i++) {
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
      input = { throttle: Math.abs(yawErr) > 1 ? 0.4 : 1, yawRate: clamp(yawErr * 3, -1, 1), pitchRate: clamp(pitchErr * 3, -1, 1), burst: false };
    }
    cooldown -= 1 / 60;
    if (cooldown <= 0 && lungeCandidate(sim, pl)) { input.burst = true; cooldown = 0.3; }
    sim.setInput(pl.id, input);
    sim.step(1 / 60);
    for (const e of sim.events) {
      if (e.type === "strike" && e.pikeId === pl.id) strikes++;
      if (e.type === "capture" && e.pikeId === pl.id) { caps++; if (first < 0) first = t; }
      if (e.type === "miss" && e.pikeId === pl.id) miss[e.reason] = (miss[e.reason] ?? 0) + 1;
      if (e.type === "strike-empty" && e.pikeId === pl.id) miss.empty = (miss.empty ?? 0) + 1;
    }
    sim.events.length = 0;
    if (!pl.alive) break;
  }
  return { caps, strikes, first, alive: pl.alive, miss, stomach: pl.stomachG, len: pl.lengthCm };
}
for (const arcade of [false, true]) {
  const rs = [1, 2, 3, 4, 5].map((s) => run(s, arcade));
  const c = rs.reduce((a, r) => a + r.caps, 0), st = rs.reduce((a, r) => a + r.strikes, 0);
  const firsts = rs.map((r) => (r.first < 0 ? "-" : r.first.toFixed(0) + "s")).join(" ");
  const m: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.miss)) m[k] = (m[k] ?? 0) + v;
  console.log("  misses", JSON.stringify(m), "caps", rs.map((r) => r.caps).join(" "), "len", rs.map((r) => r.len.toFixed(1)).join(" "), "alive", rs.map((r) => r.alive).join(" "));
  console.log(`${arcade ? "arcade   " : "realistic"}  captures/${MIN}min avg ${(c / rs.length).toFixed(1)}  strikes ${(st / rs.length).toFixed(1)}  hit% ${st ? ((c / st) * 100).toFixed(0) : 0}  first catch: ${firsts}`);
}
