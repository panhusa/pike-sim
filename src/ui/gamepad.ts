/**
 * Gamepad (standard mapping: Xbox / PlayStation / most USB and Bluetooth pads) for playing without a mouse.
 * Left stick steers (x turns, y dives and rises), RT swims (analog), LT stalks, A or RB strikes, B rests,
 * Y changes the camera, right stick x orbits the camera, Start pauses and resumes, Back toggles the minimap.
 */
export interface PadState {
  connected: boolean;
  /** -1..1 after the dead zone; + = right */
  turn: number;
  /** -1..1 after the dead zone; + = stick pushed up */
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

const DEAD = 0.18;
const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9 } as const;

/** Dead zone with the remaining range rescaled to 0..1, so small stick drift does nothing. */
export function deadZone(v: number, dz = DEAD): number {
  const a = Math.abs(v);
  return a <= dz ? 0 : (Math.sign(v) * (a - dz)) / (1 - dz);
}

type PadLike = Pick<Gamepad, "axes" | "buttons" | "connected">;

export class GamepadInput {
  private prev = new Set<number>();

  /** `pads` defaults to the browser's list; tests pass fakes. */
  read(pads: ReadonlyArray<PadLike | null> = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : []): PadState {
    const pad = pads.find((p) => p && p.connected) ?? null;
    const none: PadState = { connected: false, turn: 0, pitch: 0, throttle: 0, orbit: 0, rest: false, strike: false, camera: false, pause: false, minimap: false };
    if (!pad) {
      this.prev.clear();
      return none;
    }
    const val = (i: number): number => pad.buttons[i]?.value ?? 0;
    const down = (i: number): boolean => !!pad.buttons[i]?.pressed;
    const now = new Set<number>();
    for (let i = 0; i < pad.buttons.length; i++) if (down(i)) now.add(i);
    const edge = (i: number): boolean => now.has(i) && !this.prev.has(i);
    const s: PadState = {
      connected: true,
      turn: deadZone(pad.axes[0] ?? 0),
      pitch: -deadZone(pad.axes[1] ?? 0),
      throttle: Math.max(val(B.rt), down(B.lt) ? 0.25 : 0),
      orbit: deadZone(pad.axes[2] ?? 0),
      rest: down(B.b),
      strike: edge(B.a) || edge(B.rb),
      camera: edge(B.y),
      pause: edge(B.start),
      minimap: edge(B.back),
    };
    this.prev = now;
    return s;
  }
}
