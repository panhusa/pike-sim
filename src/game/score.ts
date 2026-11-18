/** Score and combo: catches in quick succession multiply points. Pure, driven by game time in seconds. */
export const COMBO_WINDOW_S = 15;
export const COMBO_MAX = 5;

export class Score {
  points = 0;
  combo = 0; // catches in the current streak
  catches = 0;
  private lastCatchT = -Infinity;

  /** Multiplier the next catch would get if made at time t. */
  multiplier(t: number): number {
    return this.comboAlive(t) ? Math.min(COMBO_MAX, this.combo + 1) : 1;
  }

  comboAlive(t: number): boolean {
    return this.combo > 0 && t - this.lastCatchT <= COMBO_WINDOW_S;
  }

  /** 0..1 of the combo window left (0 when no combo). */
  comboLeft(t: number): number {
    return this.comboAlive(t) ? 1 - (t - this.lastCatchT) / COMBO_WINDOW_S : 0;
  }

  /** Register a catch; returns the points it earned. */
  catch(grams: number, t: number): { points: number; mult: number } {
    const mult = this.multiplier(t);
    this.combo = this.comboAlive(t) ? this.combo + 1 : 1;
    this.lastCatchT = t;
    this.catches++;
    const points = Math.max(50, Math.round(grams * 40)) * mult;
    this.points += points;
    return { points, mult };
  }

  bonus(points: number): void {
    this.points += points;
  }
}

export interface Stage {
  name: string;
  fromCm: number;
}

export const STAGES: Stage[] = [
  { name: "Fry-hunter", fromCm: 0 },
  { name: "Jack", fromCm: 30 },
  { name: "Hunter", fromCm: 40 },
  { name: "Predator", fromCm: 55 },
  { name: "Lake tyrant", fromCm: 75 },
];

/** Current stage index, and progress 0..1 toward the next (1 at the last stage). */
export function stageOf(lengthCm: number, startCm = 22): { index: number; progress: number } {
  let index = 0;
  for (let i = 0; i < STAGES.length; i++) if (lengthCm >= STAGES[i]!.fromCm) index = i;
  const next = STAGES[index + 1];
  if (!next) return { index, progress: 1 };
  const from = index === 0 ? startCm : STAGES[index]!.fromCm;
  return { index, progress: Math.min(1, Math.max(0, (lengthCm - from) / (next.fromCm - from))) };
}
