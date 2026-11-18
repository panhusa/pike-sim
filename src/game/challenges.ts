/** One active goal at a time; completing it pays a bonus and draws the next. Pure. */
export type ChallengeEvent =
  | { type: "catch"; kind: string; lengthCm: number; t: number }
  | { type: "hunter-survived" };

export interface ChallengeDef {
  id: string;
  text: string;
  bonus: number;
  target: number;
  /** progress increment for an event given the progress state */
  step(e: ChallengeEvent, st: { times: number[] }): number;
}

const kindLabel: Record<string, string> = { roach: "roach", perch: "perch", rudd: "rudd" };

const catchKind = (kind: string, n: number, bonus: number): ChallengeDef => ({
  id: `catch-${kind}-${n}`,
  text: n === 1 ? `Catch a ${kindLabel[kind] ?? kind}` : `Catch ${n} ${kindLabel[kind] ?? kind}`,
  bonus,
  target: n,
  step: (e) => (e.type === "catch" && e.kind === kind ? 1 : 0),
});

export const CHALLENGES: ChallengeDef[] = [
  { id: "catch-any-2", text: "Catch 2 fish", bonus: 200, target: 2, step: (e) => (e.type === "catch" ? 1 : 0) },
  catchKind("roach", 3, 400),
  {
    id: "quick-double",
    text: "2 catches inside 10 s",
    bonus: 600,
    target: 1,
    step: (e, st) => {
      if (e.type !== "catch") return 0;
      st.times = [...st.times.filter((t) => e.t - t <= 10), e.t];
      return st.times.length >= 2 ? 1 : 0;
    },
  },
  catchKind("perch", 1, 500),
  { id: "big-one", text: "Catch a fish over 15 cm", bonus: 700, target: 1, step: (e) => (e.type === "catch" && e.lengthCm > 15 ? 1 : 0) },
  { id: "survive", text: "Survive a hunting pike", bonus: 800, target: 1, step: (e) => (e.type === "hunter-survived" ? 1 : 0) },
  catchKind("rudd", 2, 500),
  { id: "catch-any-5", text: "Catch 5 fish", bonus: 900, target: 5, step: (e) => (e.type === "catch" ? 1 : 0) },
];

export class Challenges {
  index = 0;
  progress = 0;
  completed = 0;
  private st = { times: [] as number[] };

  get current(): ChallengeDef {
    return CHALLENGES[this.index % CHALLENGES.length]!;
  }

  /** Feed an event; returns the finished challenge (and its bonus) when this event completed it. */
  push(e: ChallengeEvent): ChallengeDef | null {
    const c = this.current;
    this.progress += c.step(e, this.st);
    if (this.progress < c.target) return null;
    this.completed++;
    this.index++;
    this.progress = 0;
    this.st = { times: [] };
    return c;
  }
}
