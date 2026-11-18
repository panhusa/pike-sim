/**
 * Peer-to-peer transport. The host registers the id ROOM_PREFIX + code on the public PeerJS broker
 * (used only to introduce browsers); guests connect to it and talk over WebRTC data channels.
 * A small interface so tests can swap in a loopback.
 */
import { ROOM_PREFIX } from "./protocol";

export interface HostTransport {
  onJoin(cb: (peer: string) => void): void;
  onLeave(cb: (peer: string) => void): void;
  onMessage(cb: (peer: string, data: unknown) => void): void;
  send(peer: string, data: unknown): void;
  broadcast(data: unknown): void;
  kick(peer: string): void;
  close(): void;
}

export interface GuestTransport {
  onMessage(cb: (data: unknown) => void): void;
  onClose(cb: () => void): void;
  send(data: unknown): void;
  close(): void;
}

type PeerMod = typeof import("peerjs");
type Peer = import("peerjs").Peer;
type DataConnection = import("peerjs").DataConnection;

// PeerJS is only loaded when someone actually plays online, so single player stays as light as before.
const loadPeer = (): Promise<PeerMod> => import("peerjs");

const TIMEOUT_MS = 30000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), TIMEOUT_MS);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** Open a room as host. Rejects if the code is taken or the broker is unreachable. */
export async function hostRoom(code: string): Promise<HostTransport> {
  const { Peer } = await loadPeer();
  const peer: Peer = new Peer(ROOM_PREFIX + code, { debug: 0 });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      peer.once("open", () => resolve());
      peer.once("error", (e) => reject(e));
    }),
    "Opening the room",
  );
  const conns = new Map<string, DataConnection>();
  let join: (p: string) => void = () => undefined;
  let leave: (p: string) => void = () => undefined;
  let msg: (p: string, d: unknown) => void = () => undefined;
  peer.on("connection", (c) => {
    c.on("open", () => {
      conns.set(c.peer, c);
      join(c.peer);
    });
    c.on("data", (d) => msg(c.peer, d));
    const gone = () => {
      if (conns.delete(c.peer)) leave(c.peer);
    };
    c.on("close", gone);
    c.on("error", gone);
  });
  peer.on("disconnected", () => peer.reconnect()); // lost the broker: keep existing games, re-register for new joiners
  return {
    onJoin: (cb) => (join = cb),
    onLeave: (cb) => (leave = cb),
    onMessage: (cb) => (msg = cb),
    send: (p, d) => conns.get(p)?.send(d),
    broadcast: (d) => conns.forEach((c) => c.send(d)),
    kick: (p) => conns.get(p)?.close(),
    close: () => peer.destroy(),
  };
}

/** Join a room by code. */
export async function joinRoom(code: string): Promise<GuestTransport> {
  const { Peer } = await loadPeer();
  const peer: Peer = new Peer({ debug: 0 });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      peer.once("open", () => resolve());
      peer.once("error", (e) => reject(e));
    }),
    "Connecting",
  );
  const conn = peer.connect(ROOM_PREFIX + code, { reliable: true });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      conn.once("open", () => resolve());
      conn.once("error", (e) => reject(e));
      peer.once("error", (e) => reject(e.type === "peer-unavailable" ? new Error("No lake with that code") : e));
    }),
    "Joining the lake",
  );
  let msg: (d: unknown) => void = () => undefined;
  let closed: () => void = () => undefined;
  conn.on("data", (d) => msg(d));
  conn.on("close", () => closed());
  return {
    onMessage: (cb) => (msg = cb),
    onClose: (cb) => (closed = cb),
    send: (d) => conn.open && conn.send(d),
    close: () => peer.destroy(),
  };
}
