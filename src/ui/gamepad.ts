/**
 * Gamepads and drone radios for playing without a mouse.
 *
 * A pad the browser reports with the "standard" mapping (Xbox / PlayStation / most USB and Bluetooth pads)
 * uses the console layout: left stick steers, RT swims, LT stalks, A or RB strikes, B rests, Y camera,
 * right stick x orbits, Start pauses, Back toggles the minimap.
 *
 * Anything else (an RC transmitter in USB joystick mode: EdgeTX / OpenTX, RadioMaster, FrSky, Jumper...)
 * starts from the drone preset (Mode 2: right stick steers, the left stick's throttle swims) and can be
 * re-bound per action in Controller setup; bindings are saved per controller id.
 */
export interface PadState {
  connected: boolean;
  /** console layout (the player's Invert mouse setting also flips its stick); false = custom / drone bindings */
  standard: boolean;
  /** controller name as the browser reports it */
  id: string;
  /** -1..1 after the dead zone; + = right */
  turn: number;
  /** -1..1 after the dead zone; + = rise */
  pitch: number;
  /** 0..1 swim throttle */
  throttle: number;
  /** -1..1 camera orbit */
  orbit: number;
  rest: boolean;
  /** edge-triggered presses (true for one read only) */
  strike: boolean;
  camera: boolean;
  pause: boolean;
  minimap: boolean;
}

/** A stick axis; `invert` flips it so that + is right / rise / more swim. */
export interface AxisBind {
  axis: number;
  invert: boolean;
}
/** Throttle: a centring axis (0 at rest, swim when pushed +) or a full-range one (a drone throttle: bottom = 0, top = full). */
export interface ThrottleBind extends AxisBind {
  full: boolean;
}
/** A button, or a switch reported as an axis (on past half way in `sign`'s direction). */
export type ButtonBind = { kind: "button"; index: number } | { kind: "axis"; axis: number; sign: 1 | -1 };

export interface PadMap {
  turn: AxisBind | null;
  pitch: AxisBind | null;
  throttle: ThrottleBind | null;
  orbit: AxisBind | null;
  strike: ButtonBind | null;
  camera: ButtonBind | null;
  rest: ButtonBind | null;
  pause: ButtonBind | null;
}
export type PadAction = keyof PadMap;
export const PAD_ACTIONS: PadAction[] = ["turn", "pitch", "throttle", "strike", "camera", "rest", "orbit", "pause"];
export const PAD_ACTION_LABEL: Record<PadAction, string> = {
  turn: "Turn",
  pitch: "Dive / rise",
  throttle: "Swim",
  orbit: "Camera orbit",
  strike: "Strike",
  camera: "Next camera",
  rest: "Rest",
  pause: "Pause",
};

/**
 * Drone preset, EdgeTX / OpenTX joystick order: axis 0 aileron (right stick x), 1 elevator (right stick y),
 * 2 throttle (left stick y), 3 rudder (left stick x). Right stick steers like a fish's fins; the throttle swims.
 * Strike on the first switch/button; the rest are left for Controller setup.
 */
export const RC_PRESET: PadMap = {
  turn: { axis: 0, invert: false },
  pitch: { axis: 1, invert: true }, // stick forward = nose down = dive, as on a drone
  throttle: { axis: 2, invert: false, full: true },
  orbit: { axis: 3, invert: false },
  strike: { kind: "button", index: 0 },
  camera: { kind: "button", index: 1 },
  rest: null,
  pause: null,
};

const DEAD = 0.18;
const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9 } as const;

/** Dead zone with the remaining range rescaled to 0..1, so small stick drift does nothing. */
export function deadZone(v: number, dz = DEAD): number {
  const a = Math.abs(v);
  return a <= dz ? 0 : (Math.sign(v) * (a - dz)) / (1 - dz);
}

export type PadLike = Pick<Gamepad, "axes" | "buttons" | "connected"> & { id?: string; mapping?: string };

const axisOf = (pad: PadLike, b: AxisBind | null): number => (b ? (pad.axes[b.axis] ?? 0) * (b.invert ? -1 : 1) : 0);
export const buttonOn = (pad: PadLike, b: ButtonBind | null): boolean =>
  !b ? false : b.kind === "button" ? !!pad.buttons[b.index]?.pressed : (pad.axes[b.axis] ?? 0) * b.sign > 0.5;
/** Throttle 0..1: a full-range axis maps -1..1 to 0..1 with a small floor so a resting stick does not creep. */
export function throttleOf(pad: PadLike, b: ThrottleBind | null): number {
  if (!b) return 0;
  const v = axisOf(pad, b);
  if (!b.full) return Math.max(0, deadZone(v));
  const t = (v + 1) / 2;
  return t < 0.06 ? 0 : Math.min(1, (t - 0.06) / 0.94);
}

const MAP_KEY = "pike.padmap.v1";

/** Saved bindings per controller id (guarded: storage can be missing or blocked). */
export class PadMaps {
  private maps: Record<string, PadMap> = {};
  constructor(private storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null) {
    try {
      const raw = this.storage?.getItem(MAP_KEY);
      if (raw) this.maps = JSON.parse(raw) as Record<string, PadMap>;
    } catch {
      this.maps = {};
    }
  }
  get(id: string): PadMap | null {
    return this.maps[id] ?? null;
  }
  set(id: string, map: PadMap | null): void {
    if (map) this.maps[id] = map;
    else delete this.maps[id];
    try {
      this.storage?.setItem(MAP_KEY, JSON.stringify(this.maps));
    } catch {
      /* storage blocked: this visit only */
    }
  }
}

/** The bindings a pad plays with: saved ones, else the console layout for standard pads, else the drone preset. */
export function mapFor(pad: PadLike, maps: PadMaps): PadMap | "standard" {
  const saved = pad.id ? maps.get(pad.id) : null;
  if (saved) return saved;
  return pad.mapping === "standard" ? "standard" : RC_PRESET;
}

export class GamepadInput {
  private prev = new Set<string>();
  readonly maps: PadMaps;

  constructor(maps?: PadMaps) {
    this.maps = maps ?? new PadMaps();
  }

  /** The first connected controller (setup screen reads it raw). */
  static first(pads: ReadonlyArray<PadLike | null> = browserPads()): PadLike | null {
    return pads.find((p) => p && p.connected) ?? null;
  }

  /** `pads` defaults to the browser's list; tests pass fakes. */
  read(pads: ReadonlyArray<PadLike | null> = browserPads()): PadState {
    const pad = GamepadInput.first(pads);
    const none: PadState = { connected: false, standard: false, id: "", turn: 0, pitch: 0, throttle: 0, orbit: 0, rest: false, strike: false, camera: false, pause: false, minimap: false };
    if (!pad) {
      this.prev.clear();
      return none;
    }
    const map = mapFor(pad, this.maps);
    const now = new Set<string>();
    const press = (name: string, on: boolean): boolean => {
      if (on) now.add(name);
      return on && !this.prev.has(name);
    };
    let s: PadState;
    if (map === "standard") {
      const down = (i: number): boolean => !!pad.buttons[i]?.pressed;
      s = {
        connected: true,
        standard: true,
        id: pad.id ?? "",
        turn: deadZone(pad.axes[0] ?? 0),
        pitch: -deadZone(pad.axes[1] ?? 0),
        throttle: Math.max(pad.buttons[B.rt]?.value ?? 0, down(B.lt) ? 0.25 : 0),
        orbit: deadZone(pad.axes[2] ?? 0),
        rest: down(B.b),
        strike: press("a", down(B.a)) || press("rb", down(B.rb)),
        camera: press("y", down(B.y)),
        pause: press("start", down(B.start)),
        minimap: press("back", down(B.back)),
      };
    } else {
      s = {
        connected: true,
        standard: false,
        id: pad.id ?? "",
        turn: deadZone(axisOf(pad, map.turn)),
        pitch: deadZone(axisOf(pad, map.pitch)),
        throttle: throttleOf(pad, map.throttle),
        orbit: deadZone(axisOf(pad, map.orbit)),
        rest: buttonOn(pad, map.rest),
        strike: press("strike", buttonOn(pad, map.strike)),
        camera: press("camera", buttonOn(pad, map.camera)),
        pause: press("pause", buttonOn(pad, map.pause)),
        minimap: false,
      };
    }
    this.prev = now;
    return s;
  }
}

function browserPads(): ReadonlyArray<PadLike | null> {
  return typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
}

// ---------------- learning a binding (Controller setup) ----------------

/** Snapshot of a pad's raw inputs, the baseline a "move the control now" step compares against. */
export interface PadSnapshot {
  axes: number[];
  buttons: boolean[];
}
export const snapshot = (pad: PadLike): PadSnapshot => ({ axes: [...pad.axes], buttons: pad.buttons.map((b) => !!b.pressed) });

/**
 * What changed since `base`: the axis that moved most (past `minMove`), or a newly pressed button.
 * Used to learn a binding: the player moves the stick / flips the switch / presses the button they want.
 */
export function detectChange(base: PadSnapshot, pad: PadLike, minMove = 0.5): { kind: "axis"; axis: number; delta: number; from: number } | { kind: "button"; index: number } | null {
  for (let i = 0; i < pad.buttons.length; i++) if (pad.buttons[i]?.pressed && !base.buttons[i]) return { kind: "button", index: i };
  let best = -1;
  let bestD = 0;
  for (let i = 0; i < pad.axes.length; i++) {
    const d = (pad.axes[i] ?? 0) - (base.axes[i] ?? 0);
    if (Math.abs(d) > Math.abs(bestD)) [best, bestD] = [i, d];
  }
  return best >= 0 && Math.abs(bestD) >= minMove ? { kind: "axis", axis: best, delta: bestD, from: base.axes[best] ?? 0 } : null;
}

/** Turn a detected change into a binding for `action`. Axis actions want the + direction the player moved. */
export function bindFrom(action: PadAction, c: NonNullable<ReturnType<typeof detectChange>>): AxisBind | ThrottleBind | ButtonBind | null {
  const axisAction = action === "turn" || action === "pitch" || action === "orbit" || action === "throttle";
  if (axisAction) {
    if (c.kind !== "axis") return null;
    const invert = c.delta < 0;
    if (action === "throttle") return { axis: c.axis, invert, full: Math.abs(c.from) > 0.7 }; // started at an end: a non-centring drone throttle
    return { axis: c.axis, invert };
  }
  return c.kind === "button" ? { kind: "button", index: c.index } : { kind: "axis", axis: c.axis, sign: c.delta > 0 ? 1 : -1 };
}
