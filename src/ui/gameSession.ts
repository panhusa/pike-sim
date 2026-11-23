/**
 * Game layer glue: score/combo, goals, growth stages, hunter events, juice and audio, driven by sim
 * events and per-frame state. main.ts calls enter / event / frame / death.
 */
import { Challenges } from "../game/challenges";
import { TRIALS } from "../game/trials";
import { TyrantCaller } from "../game/tyrantCall";
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
/** small bonus for slipping a heron or an otter (the goals pay more when they are current) */
const DODGE_BONUS = 300;
const HIT_STOP_S = 0.09;
const HIT_STOP_SCALE = 0.15;

interface Projector {
  project(p: { x: number; y: number; z: number }): { x: number; y: number; visible: boolean } | null;
  camera: { fov: number; updateProjectionMatrix(): void };
  baseFov: number;
}

/** a catch within this long after hiding still in cover counts as an ambush */
const AMBUSH_WINDOW_S = 2.5;

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
  /** the heron stalking us, known from events: its stab reads "Speared!", not "Bitten!" */
  private heronId: number | null = null;
  /** the otter chasing us, known from events */
  private otterId: number | null = null;
  /** the Old Tyrant after us, known from events */
  private tyrantId: number | null = null;
  /** host: calls the tyrant for every human (host or guest) growing into stage 8 */
  private tyrants = new TyrantCaller();
  private tyrantSim: Simulation | null = null;
  private playT = 0;
  /** the first leap of a life gets a hint banner */
  private leapt = false;
  /** last play time the player was hidden still in cover (ambush trial) */
  private hiddenT = -99;

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
    this.goals = new Challenges({ chill: sim.chill });
    this.danger = new DangerClock();
    this.playT = 0;
    this.hunterId = null;
    this.tyrantId = null;
    this.heronId = null;
    this.otterId = null;
    this.leapt = false;
    this.hiddenT = -99;
    // a different water or save slot: pike ids restart, so forget the stages seen in the last one
    if (sim !== this.tyrantSim) {
      this.tyrants = new TyrantCaller();
      this.tyrantSim = sim;
    }
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
        this.goal(
          this.goals.push({
            type: "catch",
            kind: e.kind,
            lengthCm: e.lengthCm,
            t: this.playT,
            airborne: sim.airborne.has(pl.id),
            ambush: this.playT - this.hiddenT <= AMBUSH_WINDOW_S,
          }),
        );
        return;
      }
      case "miss":
      case "strike-empty":
        if (e.pikeId !== pl.id) return;
        if (e.type === "miss" && e.reason === "full") return;
        this.goal(this.goals.push({ type: "miss" }));
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
        const speared = e.byPikeId === this.heronId;
        const pike = !speared && e.byPikeId !== this.otterId; // heron and otter hits are "hits", not bites
        this.juice.showBanner(speared ? "Speared!" : "Bitten!", left <= 1 ? `One more ${pike ? "bite" : "hit"} and you're done. Get away!` : `${left} hearts left. Burst away!`, "danger", 2200);
        return;
      }
      case "scared":
        if (e.pikeId !== pl.id) return;
        this.score.breakCombo();
        this.audio.bitten();
        this.juice.flash("rgba(120,110,120,.55)");
        this.juice.shake(8, 0.3);
        this.juice.showBanner("Chased off!", "It got you. In Chill nothing hurts, but your combo is gone", "danger", 2600);
        return;
      case "heron-warn":
        if (e.pikeId !== pl.id) return;
        this.heronId = e.heronId;
        this.audio.warning();
        this.juice.showBanner("A shadow overhead!", "Heron! Swim away", "danger", 2200);
        return;
      case "heron-stab":
        if (e.pikeId !== pl.id) return;
        this.audio.stab();
        this.juice.shake(e.hit ? 10 : 5, 0.3);
        return;
      case "heron-dodged":
        if (e.pikeId !== pl.id) return;
        this.dodged("Missed you!", this.goals.push({ type: "heron-dodged" }));
        return;
      case "otter-start":
        if (e.pikeId !== pl.id) return;
        this.otterId = e.otterId;
        this.audio.otterWarning();
        this.juice.showBanner("An otter is in the water!", "Hide still in the weeds or outswim it", "danger", 3500);
        this.juice.shake(4, 0.4);
        return;
      case "otter-lost":
        if (e.pikeId !== pl.id) return;
        this.dodged("The otter lost you!", this.goals.push({ type: "otter-lost" }));
        return;
      case "otter-end":
        if (e.pikeId !== pl.id) return;
        if (e.outcome === "timeout") this.juice.showBanner("The otter gave up", "", "", 2500);
        return;
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
      case "tyrant-start":
        if (e.targetId !== pl.id) return;
        this.tyrantId = e.tyrantId;
        this.audio.warning();
        this.juice.showBanner("The Old Tyrant rules this water", "Bite it 3 times to drive it off", "danger", 4000);
        this.juice.shake(6, 0.5);
        return;
      case "tyrant-hit": {
        if (e.tyrantId !== this.tyrantId) return;
        const tk = sim.pikes.find((k) => k.id === e.tyrantId);
        const at = this.screenAt(view, tk ?? pl);
        this.juice.floatText(`HIT! ${e.hp} left`, at.x, at.y - 30, "combo");
        this.juice.shake(8, 0.3);
        return;
      }
      case "tyrant-end": {
        if (e.targetId !== pl.id) return;
        this.tyrantId = null;
        if (e.outcome === "beaten") {
          const done = this.goals.push({ type: "tyrant-beaten" });
          if (done) this.goal(done);
          else {
            this.audio.fanfare();
            this.juice.showBanner("You drove off the Old Tyrant!", "This water is yours now", "good", 3500);
          }
          this.juice.flash("rgba(127,232,180,.45)");
        } else if (e.outcome === "left") this.juice.showBanner("The Old Tyrant swam away", "It will be back", "", 3000);
        return;
      }
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
        this.juice.showBanner("Landed... and released", sim.chill ? "A quick photo, and back into the water." : "The angler let you go. You are hurt.", sim.chill ? "good" : "danger", 3500);
        return;
      default:
        return;
    }
  }

  /** Only the newest stage's trial runs (a jump over several stages does not stack). */
  private startStageTrial(sim: Simulation, pl: PikeState, index: number): void {
    const t = TRIALS[index];
    if (t) this.goals.startTrial(t);
    if (index === 9) this.juice.showBanner("You are a Legend of the lake", "", "good", 4500);
    if (!this.authority) return;
    if (index === 5) this.danger.hunterWithin(10);
    if (index === 7) sim.extras.summonAngler(20);
  }

  /** Slipped a heron or an otter: a small bonus, or the goal's banner when that completed one. */
  private dodged(title: string, done: ReturnType<Challenges["push"]>): void {
    this.score.bonus(DODGE_BONUS);
    if (done) return this.goal(done);
    this.audio.fanfare();
    this.juice.showBanner(title, `+${DODGE_BONUS}`, "good", 2500);
  }

  private goal(done: ReturnType<Challenges["push"]>): void {
    if (!done) return;
    this.score.bonus(done.bonus);
    this.audio.fanfare();
    this.juice.showBanner(done.trial ? "Trial complete!" : "Goal complete!", `${done.text}  +${done.bonus}`, "good");
  }

  private screenAt(view: Projector, pl: PikeState): { x: number; y: number } {
    const p = view.project(pl.pos);
    return p && p.visible ? { x: p.x, y: p.y } : { x: innerWidth / 2, y: innerHeight / 2 };
  }

  /** Per rendered frame while a life is shown. `playing` is false when paused or dead. */
  frame(dt: number, sim: Simulation, pl: PikeState, view: Projector, playing: boolean): void {
    let danger01 = 0;
    let speed01 = 0;
    if (this.authority && playing) this.tyrants.tick(sim);
    if (playing && pl.alive) {
      this.playT += dt;
      // no hunter while the tyrant fight is on, or a heron or an otter is after someone
      if (this.authority && this.danger.tick(dt, sim.hunter !== null || sim.tyrant !== null || sim.extras.heron !== null || sim.extras.otter !== null, pl.lengthCm)) {
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
      // an otter after us, or a heron's shadow overhead
      const o = sim.extras.otter;
      if (o && !o.outcome && o.targetId === pl.id) {
        const near = Math.max(0, Math.min(1, 1 - (Math.hypot(o.pos.x - pl.pos.x, o.pos.y - pl.pos.y, o.pos.z - pl.pos.z) - 1) / 10));
        danger01 = Math.max(danger01, 0.35 + 0.65 * near);
        this.audio.heartbeat(true, near);
      }
      const hr = sim.extras.heron;
      if (hr && !hr.struck && hr.targetId === pl.id) danger01 = Math.max(danger01, 0.5 + 0.5 * Math.min(1, hr.t / 2));
      const L = pl.lengthCm / 100;
      speed01 = Math.min(1, pl.speed / (L * 10));
      if (pl.stillTime >= 1 && sim.world.coverAt(pl.pos) >= 0.35) this.hiddenT = this.playT;
      // growth stage
      const st = stageOf(pl.lengthCm);
      if (st.index > this.stageIndex) {
        this.stageIndex = st.index;
        this.score.bonus(1000 * st.index);
        this.audio.fanfare();
        this.juice.flash("rgba(127,232,180,.45)");
        this.juice.showBanner(`You are now a ${STAGES[st.index]!.name}!`, `Bigger prey on the menu  +${1000 * st.index}`, "good", 3500);
        this.startStageTrial(sim, pl, st.index);
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
    this.goals.fit(pl.lengthCm);
    const g = this.goals.current;
    this.hud.update({
      hearts: sim.chill ? -1 : pl.alive ? heartsOf(pl.health) : 0,
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
