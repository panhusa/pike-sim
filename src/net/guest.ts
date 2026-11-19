/**
 * Guest side of a multiplayer lake. Builds a mirror Simulation from the host's seed (same lake, plants,
 * logs) but never steps it: pike and prey come from host snapshots, smoothed between them by dead
 * reckoning. The guest's own pike is predicted locally with the same body model so steering feels
 * instant, and softly corrected toward the host's authoritative state.
 */
import { environmentAt } from "../sim/environment";
import { forward } from "../sim/math";
import { makePike, stepPike, type PikeInput, type PikeState } from "../sim/pike";
import type { PreyState } from "../sim/prey";
import type { SimSettings } from "../sim/settings";
import { presetSettings } from "../sim/settings";
import { defaultParams } from "../sim/params";
import { Simulation } from "../sim/simulation";
import { INPUT_HZ, parseHostMsg, unpackExtras, unpackPrey, type PikeSnap, type PlayerInfo, type WelcomeMsg } from "./protocol";
import type { GuestTransport } from "./transport";

const SNAP_ERR_M = 2.5; // own pike further off than this is snapped, not blended
const OWN_BLEND = 6; // 1/s correction rate toward the host for the own pike
const REMOTE_BLEND = 10; // 1/s for everything else

interface Target {
  x: number;
  y: number;
  z: number;
  at: number; // performance.now() of the snapshot
}

function settingsFrom(raw: unknown): SimSettings {
  const base = presetSettings("natural", "permadeath", defaultParams);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const n = (k: keyof SimSettings) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : (base[k] as number));
  return { ...base, rivalCount: Math.min(20, n("rivalCount")), rivalSizeScale: n("rivalSizeScale"), aggression: n("aggression"), recruitmentScale: n("recruitmentScale") };
}

export class NetGuest {
  readonly sim: Simulation;
  players: PlayerInfo[] = [];
  private targets = new Map<number, Target>(); // pike id -> latest host position
  private preyTargets = new Map<number, Target>();
  private burstSeq = 0;
  private inputAcc = 0;
  private scoreAcc = 0;
  private lastInput: PikeInput = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
  private gotSnap = false;
  onClosed: () => void = () => undefined;
  onFull: () => void = () => undefined;

  constructor(
    private net: GuestTransport,
    welcome: WelcomeMsg,
  ) {
    const sim = new Simulation({ seed: welcome.seed, startDay: welcome.startDay, settings: settingsFrom(welcome.settings) });
    sim.pikes = [];
    sim.prey = [];
    sim.arcade = true;
    sim.playerId = welcome.pikeId;
    this.sim = sim;
    net.onMessage((raw) => this.message(raw));
    net.onClose(() => this.onClosed());
  }

  /** True once the first snapshot arrived (the guest's pike exists in the mirror). */
  get ready(): boolean {
    return this.gotSnap && this.sim.player() !== null;
  }

  private message(raw: unknown): void {
    const m = parseHostMsg(raw);
    if (!m) return;
    if (m.t === "snap") {
      this.applySnap(m.time, m.pikes, m.prey, m.players);
      const ex = unpackExtras(m.extras);
      if (ex) {
        this.sim.extras.insects = ex.insects;
        this.sim.extras.angler = ex.angler;
      }
    }
    else if (m.t === "ev") for (const e of m.events) this.sim.events.push(e);
    else if (m.t === "you") {
      this.sim.playerId = m.pikeId;
      this.gotSnap = false;
    } else if (m.t === "full") this.onFull();
  }

  private applySnap(time: number, pikes: PikeSnap[], preyBuf: ArrayBuffer, players: PlayerInfo[]): void {
    const now = performance.now();
    const sim = this.sim;
    sim.time = time;
    sim.env = environmentAt(time, sim.startDay, sim.p.environment);
    this.players = players;
    const seen = new Set<number>();
    sim.humanIds.clear();
    for (const s of pikes) {
      seen.add(s.id);
      if (s.human && s.id !== sim.playerId) sim.humanIds.add(s.id);
      let pk = sim.pikes.find((k) => k.id === s.id);
      const own = s.id === sim.playerId;
      if (!pk) {
        pk = makePike(s.id, { x: s.x, y: s.y, z: s.z }, s.len, sim.p, s.sex);
        pk.yaw = s.yaw;
        sim.pikes.push(pk);
      }
      // authoritative body state
      pk.lengthCm = s.len;
      pk.weight = s.weight;
      pk.alive = s.alive;
      pk.health = s.health;
      pk.stomachG = s.stomach;
      pk.ageDays = s.age;
      pk.sex = s.sex;
      if (!own) {
        pk.energy = s.energy;
        pk.yaw = s.yaw;
        pk.pitch = s.pitch;
        pk.speed = s.speed;
        pk.burstTimeLeft = s.burst;
      } else {
        pk.energy = s.energy;
        const err = Math.hypot(s.x - pk.pos.x, s.y - pk.pos.y, s.z - pk.pos.z);
        if (err > SNAP_ERR_M || !this.gotSnap) {
          pk.pos = { x: s.x, y: s.y, z: s.z };
          pk.yaw = s.yaw;
          pk.pitch = s.pitch;
        }
      }
      this.targets.set(s.id, { x: s.x, y: s.y, z: s.z, at: now });
    }
    for (const pk of sim.pikes) if (!seen.has(pk.id)) pk.alive = false;

    // prey: update in place by id so the renderer and lunge targeting keep working
    const lite = unpackPrey(preyBuf);
    const byId = new Map(sim.prey.map((f) => [f.id, f]));
    const next: PreyState[] = [];
    for (const l of lite) {
      let f = byId.get(l.id);
      if (!f) {
        f = { id: l.id, kind: l.kind, alive: true, lengthCm: l.lengthCm, pos: { ...l.pos }, vel: { ...l.vel } } as unknown as PreyState;
      }
      f.alive = l.alive;
      f.lengthCm = l.lengthCm;
      f.vel = { ...l.vel };
      next.push(f);
      this.preyTargets.set(l.id, { ...l.pos, at: now });
    }
    sim.prey = next;
    if (this.preyTargets.size > next.length * 2) {
      const keep = new Set(next.map((f) => f.id));
      for (const id of this.preyTargets.keys()) if (!keep.has(id)) this.preyTargets.delete(id);
    }
    this.gotSnap = true;
  }

  /** Per frame: predict the own pike, smooth everything else, send input. */
  frame(dt: number, input: PikeInput): void {
    const sim = this.sim;
    const now = performance.now();
    const me = sim.player();
    if (input.burst) this.burstSeq++;
    this.lastInput = { ...input, burst: input.burst || this.lastInput.burst };

    if (me && me.alive && this.gotSnap) {
      stepPike(me, input, sim.env.tempC, dt, sim.paramsFor(me), 1);
      sim.world.confine(me.pos, 0.1);
      const t = this.targets.get(me.id);
      if (t) {
        // the host's position is ~half a round trip old; lead it by the current velocity before blending
        const age = (now - t.at) / 1000;
        const f = forward(me.yaw, me.pitch);
        const k = 1 - Math.exp(-OWN_BLEND * dt);
        me.pos.x += (t.x + f.x * me.speed * age - me.pos.x) * k;
        me.pos.y += (t.y + f.y * me.speed * age - me.pos.y) * k;
        me.pos.z += (t.z + f.z * me.speed * age - me.pos.z) * k;
      }
    }
    const kr = 1 - Math.exp(-REMOTE_BLEND * dt);
    for (const pk of sim.pikes) {
      if (pk === me || !pk.alive) continue;
      const t = this.targets.get(pk.id);
      if (!t) continue;
      const age = (now - t.at) / 1000;
      const f = forward(pk.yaw, pk.pitch);
      pk.pos.x += (t.x + f.x * pk.speed * age - pk.pos.x) * kr;
      pk.pos.y += (t.y + f.y * pk.speed * age - pk.pos.y) * kr;
      pk.pos.z += (t.z + f.z * pk.speed * age - pk.pos.z) * kr;
    }
    for (const f of sim.prey) {
      const t = this.preyTargets.get(f.id);
      if (!t) continue;
      const age = (now - t.at) / 1000;
      f.pos.x += (t.x + f.vel.x * age - f.pos.x) * kr;
      f.pos.y += (t.y + f.vel.y * age - f.pos.y) * kr;
      f.pos.z += (t.z + f.vel.z * age - f.pos.z) * kr;
    }

    this.inputAcc += dt;
    if (this.inputAcc >= 1 / INPUT_HZ) {
      this.inputAcc = 0;
      const i = this.lastInput;
      this.net.send({ t: "in", throttle: i.throttle, yawRate: i.yawRate, pitchRate: i.pitchRate, burstSeq: this.burstSeq });
      this.lastInput = { ...this.lastInput, burst: false };
    }
  }

  reportScore(points: number, dt: number): void {
    this.scoreAcc += dt;
    if (this.scoreAcc < 1) return;
    this.scoreAcc = 0;
    this.net.send({ t: "score", points });
  }

  respawn(): void {
    this.net.send({ t: "respawn" });
  }

  close(): void {
    this.net.close();
  }
}

/** Wait for the host's welcome on a fresh guest connection. */
export function awaitWelcome(net: GuestTransport, name: string, version: number): Promise<WelcomeMsg> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The host did not answer")), 15000);
    net.onMessage((raw) => {
      const m = parseHostMsg(raw);
      if (m?.t === "welcome") {
        clearTimeout(t);
        resolve(m);
      } else if (m?.t === "full") {
        clearTimeout(t);
        reject(new Error("That lake is full"));
      }
    });
    net.send({ t: "hello", v: version, name });
  });
}

export type { PikeState };
