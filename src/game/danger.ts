/** When to send a hunter after the player: first after FIRST_S of play, then every GAP_S range. Pure. */
export const DANGER = { FIRST_S: 150, GAP_MIN_S: 120, GAP_MAX_S: 180, SURVIVE_BONUS: 500 };

export class DangerClock {
  /** play seconds until the next hunter */
  left: number = DANGER.FIRST_S;

  constructor(private rand: () => number = Math.random) {}

  /** Advance by play time; true when a hunter should start now. Paused while a hunt is on. */
  tick(dt: number, huntActive: boolean): boolean {
    if (huntActive) return false;
    this.left -= dt;
    if (this.left > 0) return false;
    this.left = DANGER.GAP_MIN_S + this.rand() * (DANGER.GAP_MAX_S - DANGER.GAP_MIN_S);
    return true;
  }
}
