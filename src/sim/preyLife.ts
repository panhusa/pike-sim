import { weightG } from "./biology";
import { clamp, type Rng } from "./math";
import type { Params } from "./params";
import type { PreyState } from "./prey";

/** One game day of ageing and von Bertalanffy growth, scaled by water temperature. */
export function growPreyDay(f: PreyState, tempC: number, p: Params): void {
  const spec = p.prey[f.kind];
  const { minGrowthTempC, optGrowthTempC, maxTempFactor } = p.preyLife;
  f.ageDays += 1;
  const tf = clamp((tempC - minGrowthTempC) / (optGrowthTempC - minGrowthTempC), 0, maxTempFactor);
  const dL = (spec.maxLengthCm - f.lengthCm) * (1 - Math.exp(-spec.growthKPerYear / p.environment.yearLengthDays)) * tf;
  if (dL <= 0) return;
  f.lengthCm += dL;
  f.weight = weightG(f.lengthCm, spec.lengthWeight);
}

/** Natural daily mortality; marks victims dead and returns how many died. */
export function preyMortalityDay(prey: PreyState[], rng: Rng, p: Params): number {
  let died = 0;
  for (const f of prey) {
    if (!f.alive) continue;
    if (rng.next() < 1 - Math.exp(-p.prey[f.kind].mortalityPerDay)) {
      f.alive = false;
      died++;
    }
  }
  return died;
}
