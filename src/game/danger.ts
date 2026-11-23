/** Length (cm) from which the pike counts as grown: hunts then come later and less often. */
const GROWN_CM = 22;

/** When to send a hunter after the player. Small fish (under GROWN_CM) are hunted sooner and more often. Pure. */
export const DANGER = {
  FIRST_SMALL_S: 45,
  FIRST_GROWN_S: 90,
  GAP_SMALL_MIN_S: 60,
  GAP_SMALL_MAX_S: 100,
  GAP_GROWN_MIN_S: 90,
  GAP_GROWN_MAX_S: 150,
  SURVIVE_BONUS: 500,
};

export const firstS = (lengthCm: number): number => (lengthCm < GROWN_CM ? DANGER.FIRST_SMALL_S : DANGER.FIRST_GROWN_S);

export class DangerClock {
  /** play seconds until the next hunter (null until the first tick, which knows the pike size) */
  left: number | null = null;

  constructor(private rand: () => number = Math.random) {}

  /** Make sure a hunter comes within `s` play seconds; one already due sooner keeps its time. */
  hunterWithin(s: number): void {
    this.left = Math.min(this.left ?? s, s);
  }

  /** Advance by play time; true when a hunter should start now. Paused while a hunt is on. */
  tick(dt: number, huntActive: boolean, lengthCm: number): boolean {
    this.left ??= firstS(lengthCm);
    if (huntActive) return false;
    this.left -= dt;
    if (this.left > 0) return false;
    const small = lengthCm < GROWN_CM;
    const lo = small ? DANGER.GAP_SMALL_MIN_S : DANGER.GAP_GROWN_MIN_S;
    const hi = small ? DANGER.GAP_SMALL_MAX_S : DANGER.GAP_GROWN_MAX_S;
    this.left = lo + this.rand() * (hi - lo);
    return true;
  }
}
