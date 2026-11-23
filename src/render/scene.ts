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
import { HatchBurst } from "./hatch";
import { DEFAULT_GFX, warmMayContinue, warmTargets, type GfxSettings } from "./gfxSettings";
import { buildParticles } from "./particles";
import { buildPlants } from "./plants";
import { buildTerrain } from "./terrain";
import { fogCullRadius } from "./cull";
import { setOutlinesVisible } from "./outline";
import { buildPost, pixelRatioFor, type PostChain } from "./post";
import { plantFadeScale } from "./shaders/plantFade.glsl";
import { buildShafts, buildWater, createWaterUniforms } from "./water";

type Part = { dispose(): void };

/** Orchestrator: owns the renderer, lights and camera, and delegates the world to the build* modules. */
export class PikeScene {
  readonly scene = new THREE.Scene();
  private hatch: HatchBurst;
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
  private terrain: ReturnType<typeof buildTerrain>;
  private plants: ReturnType<typeof buildPlants>;
  private shafts: ReturnType<typeof buildShafts>;
  private post: PostChain | null = null;
  private parts: Part[];
  private gfx: GfxSettings;
  /** set by dispose(); a late prewarm stage then does nothing */
  private disposed = false;
  /** set by abandonPrewarm() when play started without waiting for the prewarm (timeout) */
  private warmAbandoned = false;
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
    this.hatch = new HatchBurst(this.scene);
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
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.hatch.dispose();
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

  /** Start the egg-cluster hatch effect (2.5 s) at a world position. */
  hatchAt(pos: Vec3, timeS: number): void {
    this.hatch.start(pos, timeS);
  }

  /**
   * Compile every shader the scene can use before the first play frame, hidden actors (heron, otter, frogs, hatch
   * burst) included, then draw one frame so the post passes compile too. Without this, three.js compiles each
   * program on the frame that first draws it: the first play frame stalls for seconds and later first sightings hitch.
   * Uses KHR_parallel_shader_compile where the browser has it (the page stays responsive while drivers compile).
   */
  async prewarm(player: PikeState, timeS: number, env: Environment): Promise<void> {
    const live = (): boolean => warmMayContinue({ disposed: this.disposed, abandoned: this.warmAbandoned });
    this.prepareActors(player);
    const want = warmTargets(this.gfx);
    if (want.post && this.post && live()) await this.compileFor(this.post.sceneTarget);
    if (want.screen && live()) await this.compileFor(null);
    if (live()) this.render(player, timeS, env, 0, { yaw: 0, pitch: 0 });
  }

  /** Play started without waiting for prewarm() (timeout): its remaining stages and the warm frame are skipped. */
  abandonPrewarm(): void {
    this.warmAbandoned = true;
  }

  /** Create the pike meshes (and a hatchling's yolk sac) for the current pikes, as the first frame would. */
  prepareActors(player: PikeState): void {
    this.fish.update(player, this.rig.hidesPlayer);
  }

  /**
   * Compile the canvas (Low) variants in the background so an automatic drop to Low does not stall on compiles.
   * Only where KHR_parallel_shader_compile exists: without it compiling would block the frame it runs in.
   */
  warmOtherQuality(): void {
    if (!this.post || !this.renderer.extensions.has("KHR_parallel_shader_compile")) return;
    this.compileFor(null).catch((e: unknown) => console.warn("background shader compile failed", e));
  }

  /** compileAsync against one render target (it selects the program variant); compile() itself runs synchronously. */
  private compileFor(target: THREE.WebGLRenderTarget | null): Promise<unknown> {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(target);
    try {
      return r.compileAsync(this.scene, this.camera);
    } finally {
      r.setRenderTarget(prev);
    }
  }

  /** Draw the current sim state from the player's pike. `look` is extra camera yaw/pitch offset. */
  render(player: PikeState, timeS: number, env: Environment, dt: number, look: { yaw: number; pitch: number }): void {
    this.ctx.uTime.value = timeS;
    this.fish.setTailBeat(player);

    // Light follows the time of day; water colour and absorption are driven from env after the camera moves.
    const day = env.light;
    this.sunlight.intensity = 0.15 + 1.6 * day;
    this.ambient.intensity = 0.25 + 0.8 * day;

    this.rig.update(player, look, this.ctx.sim.world, dt);
    // drop what the water's absorption hides (and draw distant fish coarser): the triangle budget
    const cam = this.rig.position;
    const view = { x: cam.x, y: cam.y, z: cam.z, radius: fogCullRadius(env.visibilityM, cam.y > 0) };
    this.fish.update(player, this.rig.hidesPlayer, view);
    this.terrain.update(view);
    this.plants.update(view);
    // tiny fish: bring the near plane and the plant fade in with the camera, so a 1 cm larva is visible in its weed bed
    const near = Math.min(0.05, Math.max(0.003, this.rig.lastDist * 0.15));
    if (Math.abs(this.camera.near - near) > near * 0.1) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    plantFadeScale.value = Math.min(1, Math.max(0.03, player.lengthCm / 22));
    this.hatch.update(timeS);
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
