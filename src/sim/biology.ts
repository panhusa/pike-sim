import { clamp } from "./math";
import type { Params } from "./params";

/** Weight in grams from length in cm (W = a * L^b). */
export function weightG(lengthCm: number, lw: { a: number; b: number }): number {
  return lw.a * Math.pow(lengthCm, lw.b);
}

/** Inverse: length in cm from weight in grams. */
export function lengthCm(weight: number, lw: { a: number; b: number }): number {
  return Math.pow(Math.max(weight, 0) / lw.a, 1 / lw.b);
}

/**
 * Temperature scaling of metabolic rate: Q10 rise up to the optimum, then a
 * steep fall to zero at the lethal-ish maximum (pike stop feeding above ~26C).
 */
export function tempFactor(tempC: number, p: Params["metabolism"]): number {
  const rise = Math.pow(p.q10, (Math.min(tempC, p.tempOptC) - p.tempOptC) / 10);
  if (tempC <= p.tempOptC) return rise;
  const over = clamp((tempC - p.tempOptC) / (p.tempMaxC - p.tempOptC), 0, 1);
  return rise * (1 - over * over);
}

/** Resting metabolic cost in joules per second for a fish of `weight` g. */
export function standardMetabolismW(weight: number, tempC: number, p: Params["metabolism"]): number {
  const perHour = p.standardJPerGPerH * Math.pow(Math.max(weight, 1), p.weightExponent);
  return (perHour / 3600) * tempFactor(tempC, p);
}

/**
 * Digestion rate constant (1/s) from half life, Q10-scaled around a reference temperature.
 * Mass-specific rates fall with body size like metabolism does (exponent - 1), so a small fish
 * clears food faster per gram than a large one. The half life is defined for a 1 kg fish.
 */
export function digestionRate(
  tempC: number,
  p: Params["pike"]["digestionHalfLifeH"],
  weight = 1000,
  weightExponent = 0.8,
): number {
  const halfLifeS = (p.ref * 3600) / Math.pow(p.q10, (tempC - p.refTempC) / 10);
  return (Math.LN2 / halfLifeS) * Math.pow(Math.max(weight, 1) / 1000, weightExponent - 1);
}

/**
 * Appetite in [0,1]: rises as the stomach empties, and is suppressed by cold
 * and by heat stress (pike feeding drops sharply below ~4C and above ~26C).
 */
export function appetite(stomachFill: number, tempC: number): number {
  const empty = 1 - clamp(stomachFill, 0, 1);
  const cold = clamp((tempC - 2) / 8, 0.05, 1);
  const hot = clamp((29 - tempC) / 4, 0, 1);
  return empty * Math.min(cold, hot);
}
