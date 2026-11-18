// Determinism probe: run a seeded sim for N steps and print a hash of positions, so refactors can prove identical behaviour.
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
const sim = new Simulation({ seed: 3, settings: presetSettings("natural", "permadeath", defaultParams) });
const pl = sim.addPlayer(sim.p.pike.startLengthCm);
let h = 0;
const mix = (x: number) => { h = (Math.imul(h ^ Math.round(x * 1e6), 2654435761) + 0x9e3779b9) | 0; };
for (let i = 0; i < Number(process.env.N ?? 6000); i++) {
  sim.setInput(pl.id, { throttle: 1, yawRate: Math.sin(i / 90), pitchRate: 0, burst: i % 400 === 0 });
  sim.step(1 / 60);
  if (i % 100 === 0) for (const f of [...sim.prey, ...sim.pikes]) { mix(f.pos.x); mix(f.pos.y); mix(f.pos.z); }
}
console.log("hash", (h >>> 0).toString(16), "prey", sim.prey.length, "alive", sim.prey.filter((f) => f.alive).length);
