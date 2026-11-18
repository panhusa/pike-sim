import { describe, expect, it } from "vitest";
import { calSim, coarseRun, deadSpot, detailedRun, type CalMeasure } from "./calibrationRuns";

/**
 * Encounters are rare (about 0.5 per alive day, and a found player is usually eaten), so this is
 * the first run of 6 consecutive seeds whose detailed runs see at least 5. The coarse coefficients
 * were fitted on seeds 1-15 pooled, not on this set.
 */
const SEEDS = [6, 7, 8, 9, 10, 11];
const ratioOk = (r: number): boolean => r >= 0.65 && r <= 1.35;
/**
 * About 6 detailed encounters per 6-seed set make a +-35% encounter check noise-bound (one extra
 * event or an early death moves it by 0.2-0.5), so the per-set check is a wide regression band.
 * The real gate is the opt-in pooled 15-seed run: `npm run calibrate`.
 */
const encounterRegressionOk = (r: number): boolean => r >= 0.33 && r <= 3.0;
const FIT_SEEDS = Array.from({ length: 15 }, (_, i) => i + 1);

/** Pooled rates per alive game day: detailed runs stop when the player is eaten, coarse runs never do. */
function pooled(ms: CalMeasure[]) {
  const days = ms.reduce((a, m) => a + m.elapsedDays, 0);
  const sum = (k: "rivalGrams" | "playerCaptures" | "encounters"): number => ms.reduce((a, m) => a + m[k], 0);
  return {
    days,
    encounters: sum("encounters"),
    rivalGramsPerDay: sum("rivalGrams") / days,
    capturesPerDay: sum("playerCaptures") / days,
    encountersPerDay: sum("encounters") / days,
  };
}

describe("coarse sim calibration", () => {
  it("coarse rates reproduce detailed intake and encounters", () => {
    const detailed = SEEDS.map((s) => detailedRun(s));
    const coarse = SEEDS.map((s) => coarseRun(s));
    SEEDS.forEach((s, i) => console.log(`seed ${s}`, { detailed: detailed[i], coarse: coarse[i] }));
    const d = pooled(detailed);
    const c = pooled(coarse);
    const ratios = {
      rival: c.rivalGramsPerDay / d.rivalGramsPerDay,
      captures: c.capturesPerDay / d.capturesPerDay,
      encounters: c.encountersPerDay / d.encountersPerDay,
    };
    console.log("calibration pooled", { detailed: d, coarse: c, ratios });

    expect(d.encounters).toBeGreaterThanOrEqual(5); // otherwise the encounter ratio is noise
    expect(ratioOk(ratios.rival)).toBe(true);
    expect(ratioOk(ratios.captures)).toBe(true);
    expect(encounterRegressionOk(ratios.encounters)).toBe(true);
  }, 900000);

  it("resting at a weed bed no school uses is no more filling than ambushing there", () => {
    for (const seed of [1, 2]) {
      const { sim, player } = calSim(seed, { spot: deadSpot });
      const eligible = sim.prey.filter((f) => f.lengthCm <= sim.p.pike.maxPreyLengthFracOfBL * player.lengthCm);
      const onePrey = eligible.reduce((a, f) => a + f.weight, 0) / eligible.length;
      const detailed = detailedRun(seed, { spot: deadSpot });
      const coarse = coarseRun(seed, { spot: deadSpot });
      console.log(`dead spot seed ${seed}`, { detailed, coarse, onePrey });
      expect(coarse.playerGrams).toBeLessThanOrEqual(detailed.playerGrams + onePrey);
      // A 40 cm stomach holds less than one average prey, so grams alone cannot tell; count captures too.
      expect(coarse.playerCaptures).toBeLessThanOrEqual(detailed.playerCaptures + 1);
    }
  }, 600000);
});

/**
 * Opt-in calibration gate (about 25 min): `npm run calibrate` sets CALIBRATE=1. Seeds 1-15 pooled,
 * the set the coarse coefficients are fitted on, with +-35% on all three ratios.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
describe.skipIf(!env.CALIBRATE)("coarse sim calibration, pooled 15-seed gate", () => {
  it("pooled seeds 1-15 match within 35% on rival grams, captures and encounters", () => {
    const d = pooled(FIT_SEEDS.map((s) => detailedRun(s)));
    const c = pooled(FIT_SEEDS.map((s) => coarseRun(s)));
    const ratios = {
      rival: c.rivalGramsPerDay / d.rivalGramsPerDay,
      captures: c.capturesPerDay / d.capturesPerDay,
      encounters: c.encountersPerDay / d.encountersPerDay,
    };
    console.log("calibration pooled 1-15", { detailed: d, coarse: c, ratios });
    expect(ratioOk(ratios.rival)).toBe(true);
    expect(ratioOk(ratios.captures)).toBe(true);
    expect(ratioOk(ratios.encounters)).toBe(true);
  }, 3600000);
});
