/**
 * Minimap: the water's shape (drawn once per world), you as an arrow, prey you can eat (green), fish too big
 * (grey), rival pike (red = can eat you, orange = you can eat it), other players (blue), the boat (white).
 * North-up; redrawn ~8 times a second. Toggle with N (remembered).
 */
import type { PikeState } from "../sim/pike";
import type { Simulation } from "../sim/simulation";
import type { World } from "../sim/world";

const KEY = "pike.minimap.v1";
const REDRAW_S = 0.12;

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private baseWorld: World | null = null;
  private acc = REDRAW_S;
  visible: boolean;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    let v = true;
    try {
      v = localStorage.getItem(KEY) !== "0";
    } catch {
      /* storage blocked */
    }
    this.visible = v;
    this.hide(); // shown by the frame loop while a life is on screen
  }

  toggle(): boolean {
    this.visible = !this.visible;
    try {
      localStorage.setItem(KEY, this.visible ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    this.apply();
    return this.visible;
  }

  hide(): void {
    this.canvas.style.display = "none";
  }

  show(): void {
    this.canvas.style.display = "block";
  }

  private apply(): void {
    this.canvas.style.display = this.visible ? "block" : "none";
  }

  /** The water drawn once: shore land, shallows to deep. */
  private buildBase(w: World, px: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d")!;
    const img = g.createImageData(px, px);
    const span = w.size;
    for (let j = 0; j < px; j++) {
      for (let i = 0; i < px; i++) {
        const x = (i / px - 0.5) * span;
        const z = (j / px - 0.5) * span;
        const d = w.depthAt(x, z);
        const o = (j * px + i) * 4;
        if (d <= 0 || w.edgeDist(x, z) < 0.5) {
          img.data.set([58, 74, 44, 200], o);
        } else {
          const t = Math.min(1, d / w.maxDepth);
          img.data.set([Math.round(70 - 50 * t), Math.round(150 - 80 * t), Math.round(160 - 60 * t), 220], o);
        }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  update(dt: number, sim: Simulation, pl: PikeState): void {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < REDRAW_S) return;
    this.acc = 0;
    const cv = this.canvas;
    const px = cv.width;
    const w = sim.world;
    if (this.baseWorld !== w || !this.base) {
      this.base = this.buildBase(w, px);
      this.baseWorld = w;
    }
    const g = this.ctx;
    g.clearRect(0, 0, px, px);
    g.drawImage(this.base, 0, 0);
    const k = px / w.size;
    const X = (x: number) => (x / w.size + 0.5) * px;
    const Z = (z: number) => (z / w.size + 0.5) * px;
    const dot = (x: number, z: number, r: number, col: string) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(X(x), Z(z), r, 0, Math.PI * 2);
      g.fill();
    };
    const maxPrey = sim.paramsFor(pl).pike.maxPreyLengthFracOfBL * pl.lengthCm;
    for (const f of sim.prey) {
      if (!f.alive) continue;
      dot(f.pos.x, f.pos.z, 1.3, f.lengthCm <= maxPrey ? "rgba(140,255,160,.9)" : "rgba(200,200,200,.55)");
    }
    for (const o of sim.pikes) {
      if (!o.alive || o.id === pl.id) continue;
      if (sim.isHuman(o)) dot(o.pos.x, o.pos.z, 3, "#6cb8ff");
      else dot(o.pos.x, o.pos.z, 2.4, o.lengthCm > pl.lengthCm * 1.25 ? "#ff5b4f" : "#ffb347");
    }
    const a = sim.extras.angler;
    if (sim.arcade && a) {
      g.fillStyle = "#fff";
      g.fillRect(X(a.boat.x) - 3, Z(a.boat.z) - 3, 6, 6);
    }
    const ot = sim.extras.otter;
    if (sim.arcade && ot) {
      dot(ot.pos.x, ot.pos.z, 3.2, "#000");
      dot(ot.pos.x, ot.pos.z, 2.4, "#b07a45");
    }
    const hr = sim.extras.heron;
    if (sim.arcade && hr && !hr.struck) {
      g.strokeStyle = "rgba(220,220,220,.9)";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(X(hr.x), Z(hr.z), 4, 0, Math.PI * 2);
      g.stroke();
    }
    // you: an arrow along your heading
    const hx = Math.cos(pl.yaw);
    const hz = Math.sin(pl.yaw);
    const cx = X(pl.pos.x);
    const cz = Z(pl.pos.z);
    const s = Math.max(5, 2.2 * k * 2);
    g.fillStyle = "#ffe9b8";
    g.strokeStyle = "#000";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx + hx * s * 1.4, cz + hz * s * 1.4);
    g.lineTo(cx - hx * s + -hz * s * 0.7, cz - hz * s + hx * s * 0.7);
    g.lineTo(cx - hx * s * 0.4, cz - hz * s * 0.4);
    g.lineTo(cx - hx * s - -hz * s * 0.7, cz - hz * s - hx * s * 0.7);
    g.closePath();
    g.fill();
    g.stroke();
  }
}
