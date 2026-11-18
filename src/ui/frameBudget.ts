/** Most sim steps one rendered frame may run: a slow frame then stretches dt instead of running
 *  more steps, which would make the next frame slower still (the lag spiral). */
export const MAX_STEPS_PER_FRAME = 3;

/** How many sim steps to run this frame and their dt. Aims for ~60 Hz steps, capped at MAX_STEPS_PER_FRAME. */
export function stepPlan(frameDt: number, timeScale: number): { steps: number; dt: number } {
  const steps = timeScale === 1 ? Math.min(MAX_STEPS_PER_FRAME, Math.max(1, Math.round(frameDt * 60))) : 4;
  return { steps, dt: Math.min(0.2, (frameDt * timeScale) / steps) };
}

/**
 * Lowers the render resolution when frames are persistently slow (fill rate is the usual phone bottleneck).
 * Judged over 2 s windows so a single GC pause or save does not trigger it; never raises again within a life.
 */
export class AdaptiveResolution {
  static readonly WINDOW_S = 2;
  static readonly SLOW_MS = 24; // window average above this (~<42 fps) counts as slow
  static readonly STEP = 0.8;
  static readonly MIN_RATIO = 0.6;
  private acc = 0;
  private frames = 0;

  constructor(public ratio: number) {}

  /** Feed one frame's dt in seconds; returns the new pixel ratio when it changed, else null. */
  frame(dtS: number): number | null {
    this.acc += dtS;
    this.frames++;
    if (this.acc < AdaptiveResolution.WINDOW_S) return null;
    const avgMs = (this.acc / this.frames) * 1000;
    this.acc = 0;
    this.frames = 0;
    if (avgMs <= AdaptiveResolution.SLOW_MS || this.ratio <= AdaptiveResolution.MIN_RATIO) return null;
    this.ratio = Math.max(AdaptiveResolution.MIN_RATIO, this.ratio * AdaptiveResolution.STEP);
    return this.ratio;
  }
}
