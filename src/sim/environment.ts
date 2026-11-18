import { clamp, lerp } from "./math";
import type { Params } from "./params";

export interface Environment {
  timeS: number;
  dayFraction: number; // 0..1, 0 = midnight
  dayOfYear: number;
  tempC: number;
  light: number; // 0 (night) .. 1 (noon)
  visibilityM: number;
  season: "winter" | "spring" | "summer" | "autumn";
}

/** Pure function of simulation time, so any moment can be recomputed and tested. */
export function environmentAt(timeS: number, startDay: number, p: Params["environment"]): Environment {
  const dayFraction = ((timeS / p.dayLengthS) % 1 + 1) % 1;
  const dayOfYear = (startDay + Math.floor(timeS / p.dayLengthS)) % p.yearLengthDays;
  // Coldest on `coldestDay`; sinusoidal annual cycle.
  const phase = ((dayOfYear - p.coldestDay) / p.yearLengthDays) * Math.PI * 2;
  const tempC = p.meanTempC - p.tempAmplitudeC * Math.cos(phase);
  const sun = Math.sin((dayFraction - 0.25) * Math.PI * 2); // sunrise 0.25, sunset 0.75
  const light = clamp(0.5 + sun * 0.9, 0.04, 1);
  // Summer algae bloom lowers clarity; winter water is clearer.
  const bloom = clamp((tempC - 14) / 10, 0, 1);
  const visibilityM = lerp(p.visibilityClearM, p.visibilityTurbidM, bloom * 0.7) * lerp(0.45, 1, light);
  const season = dayOfYear < 80 || dayOfYear >= 355 ? "winter" : dayOfYear < 172 ? "spring" : dayOfYear < 264 ? "summer" : "autumn";
  return { timeS, dayFraction, dayOfYear, tempC, light, visibilityM, season };
}
