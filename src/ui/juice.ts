/**
 * Screen feedback done in DOM/CSS so it stays independent of the renderer: catch flash, canvas shake,
 * floating score text, speed streaks, danger vignette, banners, and the score/goal HUD.
 */
import { COMBO_MAX } from "../game/score";

const el = (id: string): HTMLElement => document.getElementById(id)!;

export class Juice {
  private canvas: HTMLElement;
  private flashEl = el("flash");
  private vignette = el("vignette");
  private streaks = el("streaks");
  private floaters = el("floaters");
  private banner = el("banner");
  private shakeT = 0;
  private shakeAmp = 0;
  private bannerTimer = 0;
  /** remaining hit-stop seconds: the sim runs slowed while > 0 */
  hitStop = 0;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
  }

  flash(color = "rgba(255,255,255,.55)"): void {
    this.flashEl.style.transition = "none";
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = "1";
    void this.flashEl.offsetWidth;
    this.flashEl.style.transition = "opacity .35s ease-out";
    this.flashEl.style.opacity = "0";
  }

  shake(amp: number, dur = 0.25): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  floatText(text: string, x: number, y: number, cls = ""): void {
    const d = document.createElement("div");
    d.className = `floater ${cls}`;
    d.textContent = text;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.floaters.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  showBanner(title: string, sub = "", cls = "", ms = 2600): void {
    this.banner.className = `show ${cls}`;
    this.banner.innerHTML = "";
    const h = document.createElement("b");
    h.textContent = title;
    this.banner.appendChild(h);
    if (sub) {
      const s = document.createElement("span");
      s.textContent = sub;
      this.banner.appendChild(s);
    }
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.banner.className = ""), ms);
  }

  /** Per frame: shake decay, streak intensity from speed (0..1), danger vignette (0..1). */
  frame(dt: number, speed01: number, danger01: number): void {
    this.hitStop = Math.max(0, this.hitStop - dt);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 0.25);
      this.canvas.style.transform = `translate(${(Math.random() - 0.5) * a}px, ${(Math.random() - 0.5) * a}px)`;
      if (this.shakeT <= 0) {
        this.shakeAmp = 0;
        this.canvas.style.transform = "";
      }
    }
    this.streaks.style.opacity = String(Math.max(0, Math.min(1, (speed01 - 0.35) / 0.65)) * 0.9);
    this.vignette.style.opacity = String(danger01);
  }

  clear(): void {
    this.canvas.style.transform = "";
    this.streaks.style.opacity = "0";
    this.vignette.style.opacity = "0";
    this.floaters.innerHTML = "";
    this.banner.className = "";
  }
}

/** Score, combo, goal and growth-stage HUD (top centre). */
export class GameHud {
  private score = el("score");
  private best = el("best");
  private combo = el("combo");
  private comboBar = el("comboBar").firstElementChild as HTMLElement;
  private goal = el("goal");
  private stage = el("stage");
  private stageBar = el("stageBar").firstElementChild as HTMLElement;
  private hearts = el("hearts");
  private lastHearts = -1;
  private hookBar = el("hookBar");
  private hookFill = this.hookBar.firstElementChild!.firstElementChild as HTMLElement;

  /** The fight bar while hooked (0..1 escape), hidden when null. */
  hook(escape: number | null): void {
    this.hookBar.classList.toggle("show", escape !== null);
    if (escape !== null) this.hookFill.style.width = `${Math.round(escape * 100)}%`;
  }

  update(s: { hearts: number; points: number; best: number; mult: number; comboLeft: number; goal: string; goalProgress: string; stage: string; stageProgress: number; nextStage: string }): void {
    this.score.textContent = s.points.toLocaleString("en");
    if (s.hearts !== this.lastHearts) {
      this.hearts.innerHTML = [0, 1, 2].map((i) => `<span${i < s.hearts ? "" : ' class="lost"'}>&#9829;</span>`).join("");
      if (s.hearts < this.lastHearts) {
        this.hearts.classList.remove("hit");
        void this.hearts.offsetWidth;
        this.hearts.classList.add("hit");
      }
      this.lastHearts = s.hearts;
    }
    this.best.textContent = s.best > 0 ? `best ${s.best.toLocaleString("en")}` : "";
    const on = s.comboLeft > 0 && s.mult >= 2;
    this.combo.style.visibility = on ? "visible" : "hidden";
    this.combo.firstElementChild!.textContent = `x${s.mult}${s.mult >= COMBO_MAX ? " FRENZY" : ""}`;
    this.comboBar.style.width = `${s.comboLeft * 100}%`;
    this.goal.textContent = `${s.goal} ${s.goalProgress}`;
    this.stage.textContent = s.nextStage ? `${s.stage} → ${s.nextStage}` : s.stage;
    this.stageBar.style.width = `${s.stageProgress * 100}%`;
  }
}
