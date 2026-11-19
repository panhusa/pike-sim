/**
 * Play-session recorder (F9, or ?rec=1): records the game canvas to a .webm video and writes a .json log
 * of inputs, the player's pike, camera, frame rate and game events. Stopping (F9 again) downloads both
 * files to the browser's Downloads folder. Nothing is sent anywhere. The HUD is HTML, so the video shows
 * the 3D view only; the log has the numbers.
 */
export interface RecSample {
  t: number;
  [k: string]: unknown;
}
export interface RecEvent {
  t: number;
  type: string;
  [k: string]: unknown;
}
export interface RecLog {
  version: 1;
  startedAt: string;
  meta: Record<string, unknown>;
  samples: RecSample[];
  events: RecEvent[];
}

/** Samples per second in the log. */
export const REC_HZ = 10;
/** A log that runs this long without a stop is cut short (memory): about an hour at REC_HZ. */
const MAX_SAMPLES = REC_HZ * 3600;

export class SessionRecorder {
  private log: RecLog | null = null;
  private t0 = 0;
  private nextSample = 0;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stamp = "";

  get active(): boolean {
    return this.log !== null;
  }

  /** Seconds since the recording started. */
  now(): number {
    return (performance.now() - this.t0) / 1000;
  }

  start(canvas: HTMLCanvasElement | null, meta: Record<string, unknown>): void {
    if (this.log) return;
    const d = new Date();
    this.stamp = d.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    this.t0 = performance.now();
    this.nextSample = 0;
    this.log = { version: 1, startedAt: d.toISOString(), meta, samples: [], events: [] };
    this.chunks = [];
    this.media = null;
    try {
      const stream = canvas?.captureStream?.(30);
      const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
      if (stream && type) {
        this.media = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
        this.media.ondataavailable = (e) => {
          if (e.data.size) this.chunks.push(e.data);
        };
        this.media.start(1000);
      }
    } catch (e) {
      this.event("rec-video-failed", { error: String(e) });
    }
  }

  /** True when a sample is due (REC_HZ); the caller then builds and passes it to sample(). */
  due(): boolean {
    return !!this.log && this.now() >= this.nextSample;
  }

  sample(data: Record<string, unknown>): void {
    if (!this.log || this.log.samples.length >= MAX_SAMPLES) return;
    const t = this.now();
    this.nextSample = t + 1 / REC_HZ;
    this.log.samples.push({ t: round(t), ...data });
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    this.log?.events.push({ t: round(this.now()), type, ...data });
  }

  /** Stop and download `pike-<time>.json` (and `.webm` when the browser could record video). */
  async stop(): Promise<{ json: string; video: boolean } | null> {
    const log = this.log;
    if (!log) return null;
    this.event("rec-stop");
    this.log = null;
    const media = this.media;
    this.media = null;
    let video: Blob | null = null;
    if (media && media.state !== "inactive") {
      await new Promise<void>((res) => {
        media.onstop = () => res();
        media.stop();
      });
      if (this.chunks.length) video = new Blob(this.chunks, { type: media.mimeType });
    }
    const json = JSON.stringify(log);
    download(new Blob([json], { type: "application/json" }), `pike-${this.stamp}.json`);
    if (video) download(video, `pike-${this.stamp}.webm`);
    this.chunks = [];
    return { json, video: !!video };
  }
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
