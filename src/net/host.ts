/**
 * Host side of a multiplayer lake: owns the guests' pike in the one real simulation, applies their
 * inputs before each sim step, forwards each guest the events about its own pike, and broadcasts
 * snapshots at SNAPSHOT_HZ.
 */
import { placePlayerNearPrey, type SimEvent, type Simulation } from "../sim/simulation";
import { MAX_PLAYERS, packExtras, packPrey, parseGuestMsg, PROTOCOL_VERSION, SNAPSHOT_HZ, type PikeSnap, type PlayerInfo } from "./protocol";
import type { HostTransport } from "./transport";

interface Guest {
  name: string;
  pikeId: number | null;
  score: number;
  input: { throttle: number; yawRate: number; pitchRate: number };
  burstSeq: number;
  pendingBurst: boolean;
}

const forGuest = (e: SimEvent, pikeId: number): boolean =>
  e.type === "angler-arrive" ||
  e.type === "angler-leave" ||
  ("pikeId" in e && e.pikeId === pikeId) || ((e.type === "hunter-start" || e.type === "hunter-end") && e.targetId === pikeId);

export class NetHost {
  private guests = new Map<string, Guest>();
  private snapAcc = 0;
  private eventCursor: number;
  /** host's own name and score, for the leaderboard */
  hostName = "Host";
  hostScore = 0;

  constructor(
    private sim: Simulation,
    private net: HostTransport,
    readonly code: string,
  ) {
    this.eventCursor = sim.events.length;
    net.onJoin(() => undefined); // a guest counts once it says hello
    net.onLeave((peer) => this.drop(peer));
    net.onMessage((peer, raw) => this.message(peer, raw));
  }

  get playerCount(): number {
    return 1 + [...this.guests.values()].filter((g) => g.pikeId !== null).length;
  }

  /** Switch to a new simulation object (host respawn keeps the same sim; kept for clarity). */
  private spawnFor(g: Guest): number {
    const pk = this.sim.addHuman(this.sim.p.pike.startLengthCm);
    placePlayerNearPrey(this.sim, 7, pk);
    g.pikeId = pk.id;
    return pk.id;
  }

  private message(peer: string, raw: unknown): void {
    const m = parseGuestMsg(raw);
    if (!m) return;
    let g = this.guests.get(peer);
    if (m.t === "hello") {
      if (g) return;
      if (this.playerCount >= MAX_PLAYERS || m.v !== PROTOCOL_VERSION) {
        this.net.send(peer, { t: "full" });
        setTimeout(() => this.net.kick(peer), 500);
        return;
      }
      g = { name: m.name, pikeId: null, score: 0, input: { throttle: 0, yawRate: 0, pitchRate: 0 }, burstSeq: 0, pendingBurst: false };
      this.guests.set(peer, g);
      const pikeId = this.spawnFor(g);
      this.net.send(peer, { t: "welcome", v: PROTOCOL_VERSION, seed: this.sim.seed, startDay: this.sim.startDay, pikeId, settings: this.sim.settings });
      return;
    }
    if (!g) return;
    if (m.t === "in") {
      g.input = { throttle: m.throttle, yawRate: m.yawRate, pitchRate: m.pitchRate };
      if (m.burstSeq > g.burstSeq) {
        g.burstSeq = m.burstSeq;
        g.pendingBurst = true;
      }
    } else if (m.t === "score") g.score = m.points;
    else if (m.t === "respawn") {
      const old = this.sim.pikes.find((k) => k.id === g!.pikeId);
      if (old?.alive) return;
      if (old) this.sim.humanIds.delete(old.id);
      g.score = 0;
      this.net.send(peer, { t: "you", pikeId: this.spawnFor(g) });
    }
  }

  private drop(peer: string): void {
    const g = this.guests.get(peer);
    this.guests.delete(peer);
    const pk = g && this.sim.pikes.find((k) => k.id === g.pikeId);
    if (pk) {
      pk.alive = false; // swims off: hidden, no death event
      this.sim.humanIds.delete(pk.id);
    }
  }

  /** Call before every sim step: guests' inputs, each strike press becoming one burst. */
  beforeStep(): void {
    for (const g of this.guests.values()) {
      if (g.pikeId === null) continue;
      this.sim.setInput(g.pikeId, { ...g.input, burst: g.pendingBurst });
      g.pendingBurst = false;
    }
  }

  players(): PlayerInfo[] {
    const out: PlayerInfo[] = [];
    const me = this.sim.player();
    if (me) out.push({ pikeId: me.id, name: this.hostName, score: this.hostScore });
    for (const g of this.guests.values()) if (g.pikeId !== null) out.push({ pikeId: g.pikeId, name: g.name, score: g.score });
    return out;
  }

  /** Call once per rendered frame after the sim stepped. */
  tick(dt: number): void {
    // events: each guest gets the ones about its own pike
    const evs = this.sim.events;
    if (evs.length < this.eventCursor) this.eventCursor = evs.length; // trimmed
    const fresh = evs.slice(this.eventCursor);
    this.eventCursor = evs.length;
    if (fresh.length) {
      for (const [peer, g] of this.guests) {
        if (g.pikeId === null) continue;
        const mine = fresh.filter((e) => forGuest(e, g.pikeId!));
        if (mine.length) this.net.send(peer, { t: "ev", events: mine });
      }
    }
    this.snapAcc += dt;
    if (this.snapAcc < 1 / SNAPSHOT_HZ || this.guests.size === 0) return;
    this.snapAcc = 0;
    const pikes: PikeSnap[] = this.sim.pikes
      .filter((k) => k.alive || this.sim.isHuman(k))
      .map((k) => ({
        id: k.id,
        x: k.pos.x,
        y: k.pos.y,
        z: k.pos.z,
        yaw: k.yaw,
        pitch: k.pitch,
        speed: k.speed,
        len: k.lengthCm,
        weight: k.weight,
        alive: k.alive,
        health: k.health,
        energy: k.energy,
        stomach: k.stomachG,
        age: k.ageDays,
        burst: Math.max(0, k.burstTimeLeft),
        sex: k.sex,
        human: this.sim.isHuman(k),
      }));
    this.net.broadcast({ t: "snap", time: this.sim.time, pikes, prey: packPrey(this.sim.prey), players: this.players(), extras: packExtras(this.sim.extras.insects, this.sim.extras.angler) });
  }

  close(): void {
    this.net.close();
  }
}
