import { describe, expect, it } from "vitest";
import { NetHost } from "../src/net/host";
import { awaitWelcome, NetGuest } from "../src/net/guest";
import { makeRoomCode, normaliseRoomCode, packPrey, parseGuestMsg, parseHostMsg, PROTOCOL_VERSION, unpackPrey, MAX_PLAYERS } from "../src/net/protocol";
import type { GuestTransport, HostTransport } from "../src/net/transport";
import { Simulation } from "../src/sim/simulation";
import { presetSettings } from "../src/sim/settings";
import { defaultParams } from "../src/sim/params";

/** In-memory host + guests. Messages are delivered synchronously, structured-cloned like a data channel. */
function loopback() {
  let join: (p: string) => void = () => undefined;
  let leave: (p: string) => void = () => undefined;
  let hostMsg: (p: string, d: unknown) => void = () => undefined;
  const guests = new Map<string, { msg: (d: unknown) => void; close: () => void }>();
  const host: HostTransport = {
    onJoin: (cb) => (join = cb),
    onLeave: (cb) => (leave = cb),
    onMessage: (cb) => (hostMsg = cb),
    send: (p, d) => guests.get(p)?.msg(structuredClone(d)),
    broadcast: (d) => guests.forEach((g) => g.msg(structuredClone(d))),
    kick: (p) => {
      guests.get(p)?.close();
      guests.delete(p);
      leave(p);
    },
    close: () => undefined,
  };
  let n = 0;
  const connect = (): GuestTransport => {
    const id = `g${++n}`;
    const g = { msg: (_: unknown) => undefined as void, close: () => undefined as void };
    guests.set(id, g);
    join(id);
    return {
      onMessage: (cb) => (g.msg = cb),
      onClose: (cb) => (g.close = cb),
      send: (d) => hostMsg(id, structuredClone(d)),
      close: () => {
        guests.delete(id);
        leave(id);
      },
    };
  };
  return { host, connect };
}

function hostSim() {
  const sim = new Simulation({ seed: 21, settings: presetSettings("gentle", "permadeath", defaultParams) });
  sim.addPlayer(22);
  sim.arcade = true;
  return sim;
}

async function joined(lb: ReturnType<typeof loopback>, name = "Guest") {
  const t = lb.connect();
  const w = await awaitWelcome(t, name, PROTOCOL_VERSION);
  return new NetGuest(t, w);
}

describe("protocol", () => {
  it("room codes round-trip and reject junk", () => {
    const c = makeRoomCode();
    expect(normaliseRoomCode(` ${c.toLowerCase()} `)).toBe(c);
    expect(normaliseRoomCode("ABC")).toBeNull();
    expect(normaliseRoomCode("O0O0O")).toBeNull();
  });
  it("packs prey into 20 bytes each and back (cm / mm/s precision)", () => {
    const prey = [{ id: 70000, kind: "perch" as const, alive: true, lengthCm: 13.4, pos: { x: -12.345, y: -1.5, z: 30.01 }, vel: { x: 0.25, y: -0.01, z: 1.2 } }];
    const out = unpackPrey(packPrey(prey));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(70000);
    expect(out[0]!.kind).toBe("perch");
    expect(Math.abs(out[0]!.pos.x - -12.345)).toBeLessThan(0.006);
    expect(out[0]!.vel.z).toBeCloseTo(1.2, 3);
    expect(packPrey(prey).byteLength).toBe(20);
  });
  it("drops malformed or hostile messages and clamps inputs", () => {
    expect(parseGuestMsg({ t: "in", throttle: "x" })).toBeNull();
    expect(parseGuestMsg({ t: "evil" })).toBeNull();
    expect(parseGuestMsg(null)).toBeNull();
    expect(parseGuestMsg({ t: "in", throttle: 9, yawRate: -9, pitchRate: 0, burstSeq: 3 })).toEqual({ t: "in", throttle: 1, yawRate: -1, pitchRate: 0, burstSeq: 3 });
    expect(parseGuestMsg({ t: "hello", v: 1, name: "<script>Bob</script>" })).toMatchObject({ name: "scriptBobscript" });
    expect(parseHostMsg({ t: "snap", time: 1, pikes: [{ id: "x" }], players: [], prey: 5 })).toMatchObject({ pikes: [] });
  });
});

describe("host and guest", () => {
  it("a guest joins, gets its own pike in the host sim, and sees the lake", async () => {
    const lb = loopback();
    const sim = hostSim();
    const host = new NetHost(sim, lb.host, "ABCDE");
    const g = await joined(lb);
    expect(sim.humanIds.size).toBe(1);
    host.tick(1); // snapshot
    expect(g.ready).toBe(true);
    expect(g.sim.pikes.length).toBe(sim.pikes.filter((k) => k.alive || sim.isHuman(k)).length);
    expect(g.sim.prey.length).toBe(sim.prey.filter((f) => f.alive).length);
    expect(g.sim.world.reeds.length).toBe(sim.world.reeds.length); // same lake from the seed
    expect(g.sim.world.reeds[3]).toEqual(sim.world.reeds[3]);
    expect(host.players().map((p) => p.name)).toEqual(["Host", "Guest"]);
  });

  it("the guest's input drives its pike on the host, and a strike press becomes one burst", async () => {
    const lb = loopback();
    const sim = hostSim();
    const host = new NetHost(sim, lb.host, "ABCDE");
    const g = await joined(lb);
    host.tick(1);
    const id = g.sim.playerId!;
    const pk = sim.pikes.find((k) => k.id === id)!;
    const start = { ...pk.pos };
    for (let i = 0; i < 60; i++) {
      g.frame(1 / 60, { throttle: 1, yawRate: 0, pitchRate: 0, burst: i === 30 });
      host.beforeStep();
      sim.step(1 / 60);
      host.tick(1 / 60);
    }
    expect(Math.hypot(pk.pos.x - start.x, pk.pos.z - start.z)).toBeGreaterThan(0.3);
    expect(sim.events.filter((e) => e.type === "strike" && e.pikeId === id)).toHaveLength(1);
    // the guest's prediction stays close to the host's truth
    const me = g.sim.player()!;
    expect(Math.hypot(me.pos.x - pk.pos.x, me.pos.z - pk.pos.z)).toBeLessThan(0.5);
  });

  it("forwards a guest only the events about its own pike", async () => {
    const lb = loopback();
    const sim = hostSim();
    const host = new NetHost(sim, lb.host, "ABCDE");
    const g = await joined(lb);
    const id = g.sim.playerId!;
    sim.events.push({ type: "strike", pikeId: id, lockId: null, t: 0 }, { type: "strike", pikeId: sim.playerId!, lockId: null, t: 0 });
    host.tick(0.01);
    expect(g.sim.events.filter((e) => e.type === "strike").map((e) => ("pikeId" in e ? e.pikeId : -1))).toEqual([id]);
  });

  it("a leaving guest's pike disappears; a full lake turns new guests away", async () => {
    const lb = loopback();
    const sim = hostSim();
    new NetHost(sim, lb.host, "ABCDE");
    const t = lb.connect();
    const w = await awaitWelcome(t, "A", PROTOCOL_VERSION);
    t.close();
    expect(sim.pikes.find((k) => k.id === w.pikeId)!.alive).toBe(false);
    for (let i = 0; i < MAX_PLAYERS - 1; i++) await joined(lb);
    await expect(joined(lb)).rejects.toThrow(/full/);
  });

  it("guest pike get the arcade tuning on the host; rivals do not", async () => {
    const lb = loopback();
    const sim = hostSim();
    new NetHost(sim, lb.host, "ABCDE");
    const g = await joined(lb);
    const pk = sim.pikes.find((k) => k.id === g.sim.playerId)!;
    const rival = sim.pikes.find((k) => k.ai)!;
    expect(sim.paramsFor(pk)).not.toBe(sim.p);
    expect(sim.paramsFor(rival)).toBe(sim.p);
  });
});

describe("extras snapshot", () => {
  it("round-trips insects and the fisherman, and drops junk", async () => {
    const { packExtras, unpackExtras } = await import("../src/net/protocol");
    const insects = [{ id: 10000001, kind: "mayfly" as const, pos: { x: 1.234, y: 0.2, z: -3 }, vel: { x: 0, y: 0, z: 0 }, life: 9, grams: 0.9, aloft: true }];
    const angler = {
      boat: { x: 5, y: 0, z: 6 },
      boatYaw: 1.2,
      goal: { x: 0, y: 0, z: 0 },
      phase: "fish" as const,
      left: 40,
      lure: { id: 10000009, state: "hooked" as const, pos: { x: 3, y: -1, z: 4 }, vel: { x: 0.5, y: 0, z: -0.5 }, t: 2, depth: 1 },
      hookedId: 7,
      escape: 0.42,
      hookedT: 3.5,
    };
    const back = unpackExtras(JSON.parse(JSON.stringify(packExtras(insects, angler))))!;
    expect(back.insects[0]).toMatchObject({ id: 10000001, kind: "mayfly", aloft: true, pos: { x: 1.23, y: 0.2, z: -3 } });
    expect(back.angler).toMatchObject({ phase: "fish", hookedId: 7, escape: 0.42, lure: { state: "hooked", id: 10000009 } });
    expect(unpackExtras({ insects: "x" })).toBeNull();
    expect(unpackExtras({ insects: [[1, 99, "a", 0, 0, 0]], angler: { lure: [1] } })).toMatchObject({ insects: [{ kind: "fly", pos: { x: 0 } }], angler: null });
  });
});
