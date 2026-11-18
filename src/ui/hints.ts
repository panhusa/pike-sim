export type HintId = "hide" | "wait" | "strike";

export const HINT_TEXT: Record<HintId, string> = {
  hide: "Fish have rings: chase one (W + mouse) until its ring turns green.",
  wait: "Tip: keep still in the weeds and fish swim right up to you.",
  strike: "Green ring: press Space or click to strike!",
};

export const TOUCH_HINT_TEXT: Record<HintId, string> = {
  hide: "Fish have rings: steer toward one until its ring turns green.",
  wait: HINT_TEXT.wait,
  strike: "Green ring: tap Strike to lunge!",
};

export function nextHint(state: { done: boolean; stillTime: number; inCover: boolean; hasStrikeMark: boolean }): HintId | null {
  if (state.done) return null;
  if (state.hasStrikeMark) return "strike"; // action first: a green ring always gets the strike prompt
  if (!state.inCover) return "hide"; // "hide" id kept for saves/tests; its text now says chase
  return "wait";
}
