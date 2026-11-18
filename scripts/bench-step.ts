// Bench: average wall time of Simulation.step at 60 Hz during normal play (player swimming).
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";
const sim = new Simulation({ seed: 3, settings: presetSettings("natural", "permadeath", defaultParams) });
const pl = sim.addPlayer(sim.p.pike.startLengthCm);
const N = Number(process.env.N ?? 3000);
for (let i = 0; i < 300; i++) sim.step(1 / 60);
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  sim.setInput(pl.id, { throttle: 1, yawRate: Math.sin(i / 90), pitchRate: 0, burst: false });
  sim.step(1 / 60);
}
const ms = (performance.now() - t0) / N;
console.log(`step avg ${ms.toFixed(3)} ms  prey ${sim.prey.length}  pikes ${sim.pikes.length}`);
