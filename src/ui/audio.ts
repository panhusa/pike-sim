/**
 * Procedural game audio (WebAudio, no asset files): underwater ambience, burst whoosh, catch thump,
 * combo chime, miss whiff, danger heartbeat. Starts on the first user gesture (browser autoplay rule).
 */
const MUTE_KEY = "pike.mute.v1";

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private ambience: GainNode | null = null;
  private heartTimer = 0;
  muted: boolean;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    this.muted = m;
  }

  /** Call from a user gesture (click / key / touch). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    // 2 s of brown-ish noise, reused by every noise-based sound
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.startAmbience();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const g = (this.ambience = ctx.createGain());
    g.gain.value = 0.22;
    // slow swell, like moving water
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(lp.frequency);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    lfo.start();
  }

  /** Noise burst through a sweeping band-pass. */
  private swoosh(from: number, to: number, dur: number, gain: number, q = 1.2): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", glideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(): void {
    this.swoosh(300, 1800, 0.45, 0.5);
  }

  catch(mult: number): void {
    this.tone(140, 0.18, 0.7, "sine", 45); // gulp thump
    this.swoosh(2500, 600, 0.12, 0.35, 3); // crunch
    // combo chime climbs a pentatonic step per multiplier
    const steps = [0, 2, 4, 7, 9, 12];
    const f = 523 * Math.pow(2, steps[Math.min(mult - 1, steps.length - 1)]! / 12);
    this.tone(f, 0.35, 0.18, "triangle", undefined, 0.06);
    if (mult > 1) this.tone(f * 1.5, 0.3, 0.1, "triangle", undefined, 0.14);
  }

  /** Breaking out of the water: a bright splash. */
  leap(): void {
    this.swoosh(1200, 4000, 0.3, 0.45, 2);
  }

  /** Falling back in: a heavier plop and spray. */
  splash(): void {
    this.tone(160, 0.2, 0.5, "sine", 60);
    this.swoosh(3500, 700, 0.5, 0.5, 2);
  }

  miss(): void {
    this.swoosh(900, 250, 0.25, 0.25, 2);
  }

  fanfare(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 0.16, "triangle", undefined, i * 0.09));
  }

  bitten(): void {
    this.tone(90, 0.3, 0.8, "square", 40);
    this.swoosh(1800, 300, 0.3, 0.5, 2);
  }

  warning(): void {
    this.tone(220, 0.5, 0.3, "sawtooth", 110);
    this.tone(233, 0.5, 0.2, "sawtooth", 116, 0.02);
  }

  /** Heartbeat while danger is on; faster when the hunter is near (0..1). */
  heartbeat(on: boolean, urgency = 0): void {
    if (!this.ctx) return;
    const now = performance.now();
    if (!on || now < this.heartTimer) return;
    const interval = 900 - 450 * Math.min(1, Math.max(0, urgency));
    this.heartTimer = now + interval;
    this.tone(60, 0.12, 0.6, "sine", 40);
    this.tone(55, 0.1, 0.45, "sine", 38, 0.16);
  }

  /** Muffle the ambience when the game is not running. */
  setActive(active: boolean): void {
    if (this.ambience && this.ctx) this.ambience.gain.setTargetAtTime(active ? 0.22 : 0.06, this.ctx.currentTime, 0.3);
  }
}
