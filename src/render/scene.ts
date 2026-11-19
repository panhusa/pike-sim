import * as THREE from "three";
import type { Environment } from "../sim/environment";
import type { PikeState } from "../sim/pike";
import type { Vec3 } from "../sim/math";
import type { Simulation } from "../sim/simulation";
import { CameraRig } from "./camera";
import { seededRng, type RenderCtx } from "./ctx";
import { buildAbove, landOut } from "./above";
import { buildExtras } from "./extras";
import { buildFish } from "./fish";
import { DEFAULT_GFX, type GfxSettings } from "./gfxSettings";
import { buildParticles } from "./particles";
import { buildPlants } from "./plants";
import { buildTerrain } from "./terrain";
import { setOutlinesVisible } from "./outline";
import { buildPost, pixelRatioFor, type PostChain } from "./post";
import { buildShafts, buildWater, createWaterUniforms } from "./water";

type Part = { dispose(): void };

/** Orchestrator: owns the renderer, lights and camera, and delegates the world to the build* modules. */
export class PikeScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.05, 120);
  readonly renderer: THREE.WebGLRenderer;
  /** resting field of view: wider in portrait so a phone shows more than a sliver of water */
  baseFov = 65;
  private ctx: RenderCtx;
  readonly rig: CameraRig;
  private sunlight = new THREE.DirectionalLight(0xcfe8ff, 1.5);
  private ambient = new THREE.HemisphereLight(0x8fc4c9, 0x1a2a1d, 0.9);
  private fish: ReturnType<typeof buildFish>;
  private particles: ReturnType<typeof buildParticles>;
  private extras: ReturnType<typeof buildExtras>;
  private above: ReturnType<typeof buildAbove>;
  private water: ReturnType<typeof buildWater>;
  private terrain: Part;
  private plants: Part & { padSpots: Array<[number, number]> };
  private shafts: ReturnType<typeof buildShafts>;
  private post: PostChain | null = null;
  private parts: Part[];
  private gfx: GfxSettings;
  /** Draw calls in the last rendered frame, summed over every pass (for the ?debug=1 HUD). */
  drawCalls = 0;

  constructor(canvas: HTMLCanvasElement, sim: Simulation, gfx: GfxSettings = { ...DEFAULT_GFX }) {
    this.gfx = gfx;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(pixelRatioFor(gfx.quality, window.devicePixelRatio));
    this.renderer.info.autoReset = false; // the post chain renders several passes per frame; reset once per frame
    this.scene.add(this.sunlight, this.ambient);
    this.sunlight.position.set(10, 30, 5);
    this.ctx = { scene: this.scene, camera: this.camera, renderer: this.renderer, sim, gfx, uTime: { value: 0 }, water: createWaterUniforms(sim.world.maxDepth), rng: (salt) => seededRng(sim.seed * 2654435761 + salt) };
    this.rig = new CameraRig(this.camera);
    setOutlinesVisible(this.camera, gfx.style === "stylised");
    this.fish = buildFish(this.ctx);
    this.particles = buildParticles(this.ctx);
    this.water = buildWater(this.ctx);
    this.terrain = buildTerrain(this.ctx);
    this.plants = buildPlants(this.ctx);
    this.extras = buildExtras(this.ctx);
    this.above = buildAbove(this.ctx);
    this.shafts = buildShafts(this.ctx);
    this.parts = this.partList();
    this.resize();
    this.buildPostChain();
    window.addEventListener("resize", this.onResize);
  }

  /** Dev/test hook: world x,z of every lily pad. */
  get padSpots(): Array<[number, number]> {
    return this.plants.padSpots;
  }

  private partList(): Part[] {
    return [this.terrain, this.plants, this.water, this.fish, this.particles, this.extras, this.above, this.shafts];
  }

  /** High quality renders through the post chain; low renders straight to the canvas. */
  private buildPostChain(): void {
    this.post?.dispose();
    this.post = this.gfx.quality === "high" ? buildPost(this.ctx) : null;
    this.resize();
  }

  /** Render resolution multiplier (AdaptiveResolution lowers it on slow devices). */
  setPixelRatio(r: number): void {
    this.renderer.setPixelRatio(r);
    this.resize();
  }

  /** Apply new graphics settings live: quality rebuilds density-dependent parts and the post chain, style rebuilds the grade. */
  setGfx(s: GfxSettings): void {
    const qualityChanged = s.quality !== this.gfx.quality;
    const styleChanged = s.style !== this.gfx.style;
    this.gfx = s;
    this.ctx.gfx = s;
    if (qualityChanged) this.renderer.setPixelRatio(pixelRatioFor(s.quality, window.devicePixelRatio));
    if (qualityChanged || styleChanged) this.buildPostChain();
    setOutlinesVisible(this.camera, s.style === "stylised");
    if (!qualityChanged) return;
    // Quality sets plant, stone/litter and particle density: rebuild them, freeing the old geometry and materials.
    this.terrain.dispose();
    this.plants.dispose();
    this.particles.dispose();
    this.terrain = buildTerrain(this.ctx);
    this.plants = buildPlants(this.ctx);
    this.particles = buildParticles(this.ctx);
    this.shafts.dispose();
    this.shafts = buildShafts(this.ctx);
    this.parts = this.partList();
  }

  private onResize = (): void => this.resize();

  /** Release GPU resources and listeners; the canvas can then host a new PikeScene. */
  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    try {
      for (const p of [...this.parts, ...(this.post ? [this.post] : [])]) {
        try {
          p.dispose();
        } catch (e) {
          console.error("dispose failed", e);
        }
      }
    } finally {
      this.renderer.dispose();
    }
  }

  private resize(): void {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.resize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = (c.clientWidth || window.innerWidth) / (c.clientHeight || window.innerHeight);
    this.baseFov = this.camera.aspect < 1 ? 75 : 65;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /** Project a world position to canvas pixels using the current camera. */
  project(pos: Vec3): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(pos.x, pos.y, pos.z).project(this.camera);
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  /** Draw the current sim state from the player's pike. `look` is extra camera yaw/pitch offset. */
  render(player: PikeState, timeS: number, env: Environment, dt: number, look: { yaw: number; pitch: number }): void {
    this.ctx.uTime.value = timeS;
    this.fish.setTailBeat(player);

    // Light follows the time of day; water colour and absorption are driven from env after the camera moves.
    const day = env.light;
    this.sunlight.intensity = 0.15 + 1.6 * day;
    this.ambient.intensity = 0.25 + 0.8 * day;

    this.fish.update(player, this.rig.hidesPlayer);
    this.rig.update(player, look, this.ctx.sim.world, dt);
    this.water.update(env, this.rig.position.y);
    this.particles.update(timeS, dt, this.rig.position, env);
    this.shafts.update(env, this.rig.position);
    this.extras.update(timeS);
    const inAir = this.rig.position.y > 0;
    this.above.update(timeS, dt, this.rig.position.y);
    const far = inAir ? Math.max(420, landOut(this.ctx.sim.world.size / 2) + 60) : 120;
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.info.reset();
    if (this.post) this.post.render(dt, !inAir);
    else this.renderer.render(this.scene, this.camera);
    this.drawCalls = this.renderer.info.render.calls;
  }
}
