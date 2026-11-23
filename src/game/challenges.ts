/** One active goal at a time; completing it pays a bonus and draws the next. Pure. */
export type ChallengeEvent =
  | { type: "catch"; kind: string; lengthCm: number; t: number; airborne?: boolean; ambush?: boolean }
  | { type: "hunter-survived" }
  | { type: "hook-thrown" }
  | { type: "leap" }
  | { type: "miss" }
  | { type: "tyrant-beaten" }
  | { type: "heron-dodged" }
  | { type: "otter-lost" };

export const isFish = (e: ChallengeEvent): boolean => e.type === "catch" && e.kind !== "insect" && e.kind !== "frog"; // a frog is not a fish

export interface ChallengeDef {
  id: string;
  text: string;
  bonus: number;
  target: number;
  /** needs a pike at least this long (cm); a smaller one gets the next goal that fits */
  minPikeCm?: number;
  /** a stage trial: runs outside the rotation until done */
  trial?: boolean;
  /** progress increment for an event given the progress state (-Infinity resets progress to 0) */
  step(e: ChallengeEvent, st: { times: number[] }): number;
}

const kindLabel: Record<string, string> = { roach: "roach", perch: "perch", rudd: "rudd", frog: "frog", bream: "bream" };

const catchKind = (kind: string, n: number, bonus: number, minPikeCm?: number): ChallengeDef => ({
  id: `catch-${kind}-${n}`,
  text: n === 1 ? `Catch a ${kindLabel[kind] ?? kind}` : `Catch ${n} ${kindLabel[kind] ?? kind}`,
  bonus,
  target: n,
  minPikeCm,
  step: (e) => (e.type === "catch" && e.kind === kind ? 1 : 0),
});

export const CHALLENGES: ChallengeDef[] = [
  { id: "catch-any-2", text: "Catch 2 fish", bonus: 200, target: 2, step: (e) => (isFish(e) ? 1 : 0) },
  catchKind("roach", 3, 400),
  {
    id: "quick-double",
    text: "2 catches inside 10 s",
    bonus: 600,
    target: 1,
    step: (e, st) => {
      if (!isFish(e) || e.type !== "catch") return 0;
      st.times = [...st.times.filter((t) => e.t - t <= 10), e.t];
      return st.times.length >= 2 ? 1 : 0;
    },
  },
  { id: "leap", text: "Leap out of the water (swim up fast + Strike)", bonus: 400, target: 1, minPikeCm: 4, step: (e) => (e.type === "leap" ? 1 : 0) },
  catchKind("perch", 1, 500),
  { id: "insects-3", text: "Snap up 3 insects off the surface", bonus: 500, target: 3, minPikeCm: 3, step: (e) => (e.type === "catch" && e.kind === "insect" ? 1 : 0) },
  catchKind("frog", 1, 700, 14),
  { id: "big-one", text: "Catch a fish over 15 cm", bonus: 700, target: 1, minPikeCm: 25, step: (e) => (isFish(e) && e.type === "catch" && e.lengthCm > 15 ? 1 : 0) },
  { id: "survive", text: "Survive a hunting pike", bonus: 800, target: 1, step: (e) => (e.type === "hunter-survived" ? 1 : 0) },
  { id: "dodge-heron", text: "Dodge a heron's stab", bonus: 800, target: 1, minPikeCm: 4, step: (e) => (e.type === "heron-dodged" ? 1 : 0) },
  catchKind("rudd", 2, 500),
  catchKind("bream", 1, 900, 45),
  { id: "lose-otter", text: "Lose an otter in the weeds", bonus: 1200, target: 1, minPikeCm: 10, step: (e) => (e.type === "otter-lost" ? 1 : 0) },
  { id: "throw-hook", text: "Get hooked by a lure and throw the hook", bonus: 1500, target: 1, minPikeCm: 18, step: (e) => (e.type === "hook-thrown" ? 1 : 0) },
  { id: "catch-any-5", text: "Catch 5 fish", bonus: 900, target: 5, step: (e) => (isFish(e) ? 1 : 0) },
];

export class Challenges {
  index = 0;
  progress = 0;
  completed = 0;
  private st = { times: [] as number[] };
  private trial: ChallengeDef | null = null;
  private saved: { progress: number; st: { times: number[] } } | null = null;
  private readonly list: ChallengeDef[];

  /** Chill has the same goals now: hunters chase there too (they scare instead of bite). */
  constructor(_opts: { chill?: boolean } = {}) {
    this.list = CHALLENGES;
  }

  get current(): ChallengeDef {
    return this.trial ?? this.list[this.index % this.list.length]!;
  }

  /** A stage trial takes over as the current goal until done; the rotation resumes where it was. */
  startTrial(def: ChallengeDef): void {
    if (!this.trial) this.saved = { progress: this.progress, st: this.st };
    this.trial = def;
    this.progress = 0;
    this.st = { times: [] };
  }

  /** Skip goals the pike is too small for (they come round again later in the cycle). */
  fit(lengthCm: number): void {
    if (this.trial) return;
    for (let i = 0; i < this.list.length && (this.current.minPikeCm ?? 0) > lengthCm; i++) {
      this.index++;
      this.progress = 0;
      this.st = { times: [] };
    }
  }

  /** Feed an event; returns the finished challenge (and its bonus) when this event completed it. */
  push(e: ChallengeEvent): ChallengeDef | null {
    const c = this.current;
    this.progress = Math.max(0, this.progress + c.step(e, this.st));
    if (this.progress < c.target) return null;
    this.completed++;
    if (this.trial) {
      this.trial = null;
      this.progress = this.saved?.progress ?? 0;
      this.st = this.saved?.st ?? { times: [] };
      this.saved = null;
      return c;
    }
    this.index++;
    this.progress = 0;
    this.st = { times: [] };
    return c;
  }
}
