import { isFish, type ChallengeDef } from "./challenges";

const trial = (id: string, text: string, bonus: number, target: number, step: ChallengeDef["step"]): ChallengeDef => ({
  id: `trial-${id}`,
  text: `Trial: ${text}`,
  bonus,
  target,
  trial: true,
  step,
});

/** One trial per growth stage (key = stage index), started when the pike reaches that stage. */
export const TRIALS: Record<number, ChallengeDef> = {
  1: trial("triple", "3 catches inside 10 s", 1000, 1, (e, st) => {
    if (e.type !== "catch" || !isFish(e)) return 0;
    st.times = [...st.times.filter((t) => e.t - t <= 10), e.t];
    return st.times.length >= 3 ? 1 : 0;
  }),
  2: trial("ambush", "wait still in the weeds, then catch a fish", 1500, 1, (e) => (e.type === "catch" && isFish(e) && e.ambush ? 1 : 0)),
  3: trial("perch", "catch a perch", 2000, 1, (e) => (e.type === "catch" && e.kind === "perch" ? 1 : 0)),
  4: trial("air", "snap an insect in mid-air", 2500, 1, (e) => (e.type === "catch" && e.kind === "insect" && e.airborne ? 1 : 0)),
  5: trial("hunted", "survive a hunting pike", 3000, 1, (e) => (e.type === "hunter-survived" ? 1 : 0)),
  6: trial("clean", "5 catches in a row without a miss", 3500, 5, (e) => (e.type === "miss" ? -Infinity : e.type === "catch" && isFish(e) ? 1 : 0)),
  7: trial("hook", "throw the angler's hook", 4000, 1, (e) => (e.type === "hook-thrown" ? 1 : 0)),
  8: trial("tyrant", "drive off the Old Tyrant (bite it 3 times)", 10000, 1, (e) => (e.type === "tyrant-beaten" ? 1 : 0)),
};
