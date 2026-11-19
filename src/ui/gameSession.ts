/**
 * Game layer glue: score/combo, goals, growth stages, hunter events, juice and audio, driven by sim
 * events and per-frame state. main.ts calls enter / event / frame / death.
 */
import { Challenges } from "../game/challenges";
import { DANGER, DangerClock } from "../game/danger";
import { COMBO_MAX, Score, stageOf, STAGES } from "../game/score";
import type { PikeState } from "../sim/pike";
import { ARCADE_BITE, type SimEvent, type Simulation } from "../sim/simulation";
import { GameAudio } from "./audio";
import { GameHud, Juice } from "./juice";

/** Hearts shown for a health value: 3 at full, one per bite left. */
export const heartsOf = (health: number): number => Math.max(0, Math.min(3, Math.ceil(health / ARCADE_BITE - 0.01)));

const BEST_KEY = "pike.best.v1";
const HOOK_BONUS = 1500;
const HIT_STOP_S = 0.09;
const HIT_STOP_SCALE = 0.15;

interface Projector {
  project(p: { x: number; y: number; z: number }): { x: number; y: number; visible: boolean } | null;
  camera: { fov: number; updateProjectionMatrix(): void };
  baseFov: number;
}

export class GameSession {
  readonly audio = new GameAudio();
  private juice: Juice;
  private hud = new GameHud();
  private score = new Score();
  private goals = new Challenges();
  private danger = new DangerClock();
  private best = 0;
  private stageIndex = 0;
  /** false on a multiplayer guest: the host's session schedules hunters for everyone */
  authority = true;
  /** pike hunting us, known from events (guests have no sim.hunter) */
  private hunterId: number | null = null;
  private playT = 0;
  /** the first leap of a life gets a hint banner */
  private leapt = false;

  constructor(canvas: HTMLElement) {
    this.juice = new Juice(canvas);
    try {
      this.best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0;
    } catch {
      /* storage blocked */
    }
  }

  /** A life starts or resumes. */
  enter(sim: Simulation): void {
    this.score = new Score();
    this.goals = new Challenges();
    this.danger = new DangerClock();
    this.playT = 0;
    this.hunterId = null;
    this.leapt = false;
    const pl = sim.player();
    this.stageIndex = pl ? stageOf(pl.lengthCm).index : 0;
    this.juice.clear();
    this.audio.setActive(true);
  }

  /** Sim time multiplier for the hit-stop after a catch. */
  timeScale(): number {
    return this.juice.hitStop > 0 ? HIT_STOP_SCALE : 1;
  }

  event(e: SimEvent, sim: Simulation, pl: PikeState, view: Projector): void {
    switch (e.type) {
      case "strike":
        if (e.pikeId === pl.id) this.audio.burst();
        return;
      case "capture": {
        if (e.pikeId !== pl.id) return;
        const { points, mult } = this.score.catch(e.grams, this.playT);
        this.juice.flash(mult >= COMBO_MAX ? "rgba(242,184,75,.5)" : "rgba(255,255,255,.45)");
        this.juice.shake(6 + mult * 2);
        this.juice.hitStop = HIT_STOP_S;
        this.audio.catch(mult);
        const at = this.screenAt(view, pl);
        this.juice.floatText(`+${points}`, at.x, at.y - 30, mult > 1 ? "combo" : "");
        if (mult > 1) this.juice.floatText(`COMBO x${mult}`, at.x, at.y - 70, "combo");
        this.goal(this.goals.push({ type: "catch", kind: e.kind, lengthCm: e.lengthCm, t: this.playT }));
        return;
      }
      case "miss":
      case "strike-empty":
        if (e.pikeId !== pl.id) return;
        if (e.type === "miss" && e.reason === "full") return;
        this.audio.miss();
        {
          const at = this.screenAt(view, pl);
          this.juice.floatText(e.type === "miss" && e.reason === "evaded" ? "dodged!" : "miss", at.x, at.y - 30, "miss");
        }
        return;
      case "bitten": {
        if (e.pikeId !== pl.id) return;
        const left = heartsOf(e.health);
        this.audio.bitten();
        this.juice.flash("rgba(220,30,30,.55)");
        this.juice.shake(14, 0.45);
        this.juice.showBanner("Bitten!", left <= 1 ? "One more bite and you're done. Get away!" : `${left} hearts left. Burst away!`, "danger", 2200);
        return;
      }
      case "hunter-start":
        if (e.targetId !== pl.id) return;
        this.hunterId = e.hunterId;
        this.audio.warning();
        this.juice.showBanner("A big pike is hunting you!", "Outswim it, or hide still in the weeds", "danger", 3500);
        this.juice.shake(4, 0.4);
        return;
      case "hunter-end":
        if (e.targetId !== pl.id) return;
        this.hunterId = null;
        if (e.outcome === "escaped" || e.outcome === "timeout") {
          this.score.bonus(DANGER.SURVIVE_BONUS);
          this.audio.fanfare();
          this.juice.showBanner(e.outcome === "escaped" ? "It lost you!" : "You got away!", `+${DANGER.SURVIVE_BONUS}`, "good");
          this.goal(this.goals.push({ type: "hunter-survived" }));
        }
        return;
      case "leap":
        if (e.pikeId !== pl.id) return;
        this.audio.leap();
        this.goal(this.goals.push({ type: "leap" }));
        if (!this.leapt) {
          this.leapt = true;
          this.juice.showBanner("Airborne!", "Leap at dancing mayflies to snap them", "good", 2000);
        }
        return;
      case "splash":
        if (e.pikeId !== pl.id) return;
        this.audio.splash();
        this.juice.shake(5, 0.25);
        return;
      case "angler-arrive":
        this.audio.warning();
        this.juice.showBanner("A boat is overhead", "One of those fish is a lure. Look for the line!", "", 3500);
        return;
      case "hooked":
        if (e.pikeId !== pl.id) return;
        this.audio.bitten();
        this.juice.flash("rgba(242,184,75,.55)");
        this.juice.shake(12, 0.5);
        this.juice.showBanner("HOOKED!", "Mash Strike and swim away from the boat", "danger", 3000);
        return;
      case "unhooked":
        if (e.pikeId !== pl.id) return;
        this.score.bonus(HOOK_BONUS);
        this.audio.fanfare();
        this.juice.flash("rgba(127,232,180,.5)");
        this.juice.showBanner("You threw the hook!", `+${HOOK_BONUS}`, "good", 3000);
        this.goal(this.goals.push({ type: "hook-thrown" }));
        return;
      case "released":
        if (e.pikeId !== pl.id) return;
        this.audio.bitten();
        this.juice.showBanner("Landed... and released", "The angler let you go. You are hurt.", "danger", 3500);
        return;
      default:
        return;
    }
  }

  private goal(done: ReturnType<Challenges["push"]>): void {
    if (!done) return;
    this.score.bonus(done.bonus);
    this.audio.fanfare();
    this.juice.showBanner("Goal complete!", `${done.text}  +${done.bonus}`, "good");
  }

  private screenAt(view: Projector, pl: PikeState): { x: number; y: number } {
    const p = view.project(pl.pos);
    return p && p.visible ? { x: p.x, y: p.y } : { x: innerWidth / 2, y: innerHeight / 2 };
  }

  /** Per rendered frame while a life is shown. `playing` is false when paused or dead. */
  frame(dt: number, sim: Simulation, pl: PikeState, view: Projector, playing: boolean): void {
    let danger01 = 0;
    let speed01 = 0;
    if (playing && pl.alive) {
      this.playT += dt;
      if (this.authority && this.danger.tick(dt, sim.hunter !== null)) {
        // in a shared lake the hunter picks any human player
        const humans = sim.pikes.filter((k) => k.alive && sim.isHuman(k));
        const target = humans[Math.floor(Math.random() * humans.length)];
        if (target) sim.startHunter(target.id);
      }
      const h = sim.hunter && sim.hunter.targetId === pl.id ? sim.hunter : this.hunterId !== null ? { id: this.hunterId, lostS: 0 } : null;
      if (h) {
        const hk = sim.pikes.find((k) => k.id === h.id);
        const d = hk ? Math.hypot(hk.pos.x - pl.pos.x, hk.pos.y - pl.pos.y, hk.pos.z - pl.pos.z) : 99;
        const near = Math.max(0, Math.min(1, 1 - (d - 2) / 12));
        danger01 = h.lostS > 0 ? 0.3 : 0.35 + 0.65 * near;
        this.audio.heartbeat(true, near);
      }
      const L = pl.lengthCm / 100;
      speed01 = Math.min(1, pl.speed / (L * 10));
      // growth stage
      const st = stageOf(pl.lengthCm);
      if (st.index > this.stageIndex) {
        this.stageIndex = st.index;
        this.score.bonus(1000 * st.index);
        this.audio.fanfare();
        this.juice.flash("rgba(127,232,180,.45)");
        this.juice.showBanner(`You are now a ${STAGES[st.index]!.name}!`, `Bigger prey on the menu  +${1000 * st.index}`, "good", 3500);
      }
    }
    // FOV kick with speed (bursts feel fast)
    const fov = view.baseFov + 14 * Math.max(0, speed01 - 0.3);
    if (Math.abs(view.camera.fov - fov) > 0.05) {
      view.camera.fov += (fov - view.camera.fov) * Math.min(1, dt * 8);
      view.camera.updateProjectionMatrix();
    }
    // hooked: the escape bar fills as the pike fights; the line pulls hard
    const a = sim.extras.angler;
    const hooked = playing && pl.alive && a !== null && a.hookedId === pl.id;
    this.hud.hook(hooked ? a!.escape : null);
    if (hooked) danger01 = Math.max(danger01, 0.8);
    this.juice.frame(dt, speed01, danger01);
    if (this.score.points > this.best) {
      this.best = this.score.points;
      try {
        localStorage.setItem(BEST_KEY, String(this.best));
      } catch {
        /* storage blocked */
      }
    }
    const st = stageOf(pl.lengthCm);
    const g = this.goals.current;
    this.hud.update({
      hearts: pl.alive ? heartsOf(pl.health) : 0,
      points: this.score.points,
      best: this.best,
      mult: Math.min(COMBO_MAX, this.score.combo),
      comboLeft: this.score.comboLeft(this.playT),
      goal: g.text,
      goalProgress: g.target > 1 ? `(${this.goals.progress}/${g.target})` : "",
      stage: `${STAGES[st.index]!.name} ${pl.lengthCm.toFixed(1)} cm`,
      stageProgress: st.progress,
      nextStage: STAGES[st.index + 1] ? `${STAGES[st.index + 1]!.name} ${STAGES[st.index + 1]!.fromCm} cm` : "",
    });
  }

  death(): void {
    this.juice.clear();
    this.audio.setActive(false);
  }

  get points(): number {
    return this.score.points;
  }
}
