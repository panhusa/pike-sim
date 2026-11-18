/**
 * Multiplayer wire protocol (host-authoritative). Guests send inputs; the host runs the only simulation
 * and streams snapshots: pike as small objects, prey packed into an ArrayBuffer (~16 bytes each).
 * Everything received is validated: a malformed or hostile message is dropped, never trusted.
 */
import type { PreyKind } from "../sim/params";
import type { SimEvent } from "../sim/simulation";

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 6;
export const SNAPSHOT_HZ = 15;
export const INPUT_HZ = 20;
export const ROOM_PREFIX = "pike-sim-room-";
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += ROOM_ALPHABET[Math.floor(rand() * ROOM_ALPHABET.length)];
  return s;
}

export function normaliseRoomCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 5 && [...c].every((ch) => ROOM_ALPHABET.includes(ch)) ? c : null;
}

export function cleanName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16) : "";
  return s || "Pike";
}

// ---- guest -> host ----
export interface HelloMsg {
  t: "hello";
  v: number;
  name: string;
}
export interface InputMsg {
  t: "in";
  throttle: number;
  yawRate: number;
  pitchRate: number;
  /** increments once per strike press; the host turns each increment into one burst */
  burstSeq: number;
}
export interface ScoreMsg {
  t: "score";
  points: number;
}
export interface RespawnMsg {
  t: "respawn";
}
export type GuestMsg = HelloMsg | InputMsg | ScoreMsg | RespawnMsg;

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

export function parseGuestMsg(raw: unknown): GuestMsg | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "hello":
      return { t: "hello", v: num(m.v, 0, 1e6) ?? 0, name: cleanName(m.name) };
    case "in": {
      const throttle = num(m.throttle, 0, 1), yawRate = num(m.yawRate, -1, 1), pitchRate = num(m.pitchRate, -1, 1), burstSeq = num(m.burstSeq, 0, 1e9);
      return throttle === null || yawRate === null || pitchRate === null || burstSeq === null ? null : { t: "in", throttle, yawRate, pitchRate, burstSeq: Math.floor(burstSeq) };
    }
    case "score": {
      const points = num(m.points, 0, 1e9);
      return points === null ? null : { t: "score", points: Math.floor(points) };
    }
    case "respawn":
      return { t: "respawn" };
    default:
      return null;
  }
}

// ---- host -> guest ----
export interface PikeSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  len: number;
  weight: number;
  alive: boolean;
  health: number;
  energy: number;
  stomach: number;
  age: number;
  burst: number;
  sex: "male" | "female";
  /** a human player's pike (for tint and name tags) */
  human: boolean;
}
export interface PlayerInfo {
  pikeId: number;
  name: string;
  score: number;
}
export interface WelcomeMsg {
  t: "welcome";
  v: number;
  seed: number;
  startDay: number;
  pikeId: number;
  settings: unknown;
}
export interface SnapMsg {
  t: "snap";
  time: number;
  pikes: PikeSnap[];
  prey: ArrayBuffer;
  players: PlayerInfo[];
}
export interface EventsMsg {
  t: "ev";
  events: SimEvent[];
}
export interface YouMsg {
  t: "you";
  pikeId: number;
}
export interface FullMsg {
  t: "full";
}
export type HostMsg = WelcomeMsg | SnapMsg | EventsMsg | YouMsg | FullMsg;

// ---- prey packing: id u32, kind u8, alive u8, len u16 (mm), pos 3 x i16 (cm), vel 3 x i16 (mm/s) = 20 bytes ----
export const PREY_KINDS: PreyKind[] = ["roach", "perch", "rudd"];
const PREY_BYTES = 20;

export interface PreyLite {
  id: number;
  kind: PreyKind;
  alive: boolean;
  lengthCm: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
}

const i16 = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

export function packPrey(prey: readonly PreyLite[]): ArrayBuffer {
  const live = prey.filter((f) => f.alive);
  const buf = new ArrayBuffer(live.length * PREY_BYTES);
  const dv = new DataView(buf);
  live.forEach((f, i) => {
    const o = i * PREY_BYTES;
    dv.setUint32(o, f.id, true);
    dv.setUint8(o + 4, Math.max(0, PREY_KINDS.indexOf(f.kind)));
    dv.setUint8(o + 5, 1);
    dv.setUint16(o + 6, Math.max(0, Math.min(65535, Math.round(f.lengthCm * 10))), true);
    dv.setInt16(o + 8, i16(f.pos.x * 100), true);
    dv.setInt16(o + 10, i16(f.pos.y * 100), true);
    dv.setInt16(o + 12, i16(f.pos.z * 100), true);
    dv.setInt16(o + 14, i16(f.vel.x * 1000), true);
    dv.setInt16(o + 16, i16(f.vel.y * 1000), true);
    dv.setInt16(o + 18, i16(f.vel.z * 1000), true);
  });
  return buf;
}

export function unpackPrey(buf: ArrayBuffer): PreyLite[] {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength % PREY_BYTES !== 0 || buf.byteLength > 4000 * PREY_BYTES) return [];
  const dv = new DataView(buf);
  const out: PreyLite[] = [];
  for (let o = 0; o < buf.byteLength; o += PREY_BYTES) {
    out.push({
      id: dv.getUint32(o, true),
      kind: PREY_KINDS[dv.getUint8(o + 4)] ?? "roach",
      alive: dv.getUint8(o + 5) === 1,
      lengthCm: dv.getUint16(o + 6, true) / 10,
      pos: { x: dv.getInt16(o + 8, true) / 100, y: dv.getInt16(o + 10, true) / 100, z: dv.getInt16(o + 12, true) / 100 },
      vel: { x: dv.getInt16(o + 14, true) / 1000, y: dv.getInt16(o + 16, true) / 1000, z: dv.getInt16(o + 18, true) / 1000 },
    });
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function parsePikeSnap(v: unknown): PikeSnap | null {
  if (!isObj(v)) return null;
  const f = (k: string, lo = -1e6, hi = 1e6) => num(v[k], lo, hi);
  const vals = [f("id", 0, 1e9), f("x"), f("y"), f("z"), f("yaw"), f("pitch"), f("speed"), f("len", 0, 500), f("weight", 0, 1e6), f("health", 0, 1), f("energy", 0, 1e3), f("stomach", 0, 1e6), f("age", 0, 1e6), f("burst", 0, 100)];
  if (vals.some((x) => x === null)) return null;
  const [id, x, y, z, yaw, pitch, speed, len, weight, health, energy, stomach, age, burst] = vals as number[];
  return { id: id!, x: x!, y: y!, z: z!, yaw: yaw!, pitch: pitch!, speed: speed!, len: len!, weight: weight!, alive: v.alive === true, health: health!, energy: energy!, stomach: stomach!, age: age!, burst: burst!, sex: v.sex === "male" ? "male" : "female", human: v.human === true };
}

const EVENT_TYPES = new Set(["strike", "capture", "miss", "strike-empty", "death", "bitten", "hunter-start", "hunter-end", "milestone"]);

export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!isObj(raw)) return null;
  switch (raw.t) {
    case "welcome": {
      const seed = num(raw.seed, 0, 2 ** 32), startDay = num(raw.startDay, 0, 1e5), pikeId = num(raw.pikeId, 0, 1e9), v = num(raw.v, 0, 1e6);
      return seed === null || startDay === null || pikeId === null || v === null ? null : { t: "welcome", v, seed, startDay, pikeId, settings: raw.settings };
    }
    case "snap": {
      const time = num(raw.time, 0, 1e12);
      if (time === null || !Array.isArray(raw.pikes) || !Array.isArray(raw.players) || raw.pikes.length > 200) return null;
      const pikes = raw.pikes.map(parsePikeSnap).filter((p): p is PikeSnap => p !== null);
      const players = raw.players
        .slice(0, MAX_PLAYERS)
        .filter(isObj)
        .map((p) => ({ pikeId: num(p.pikeId, 0, 1e9) ?? -1, name: cleanName(p.name), score: Math.floor(num(p.score, 0, 1e9) ?? 0) }));
      const prey = raw.prey instanceof ArrayBuffer ? raw.prey : ArrayBuffer.isView(raw.prey) ? (raw.prey.buffer.slice(raw.prey.byteOffset, raw.prey.byteOffset + raw.prey.byteLength) as ArrayBuffer) : new ArrayBuffer(0);
      return { t: "snap", time, pikes, prey, players };
    }
    case "ev":
      return Array.isArray(raw.events) ? { t: "ev", events: raw.events.filter((e) => isObj(e) && EVENT_TYPES.has(e.type as string)).slice(0, 100) as SimEvent[] } : null;
    case "you": {
      const pikeId = num(raw.pikeId, 0, 1e9);
      return pikeId === null ? null : { t: "you", pikeId };
    }
    case "full":
      return { t: "full" };
    default:
      return null;
  }
}
