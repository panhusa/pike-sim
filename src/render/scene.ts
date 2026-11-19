import * as THREE from "three";
import type { Environment } from "../sim/environment";
import type { PikeState } from "../sim/pike";
import type { Vec3 } from "../sim/math";
import type { Simulation } from "../sim/simulation";
import { CameraRig } from "./camera";
import { seededRng, type RenderCtx } from "./ctx";
import { buildExtras } from "./extras";
import { buildFish } from "./fish";
import { DEFAULT_GFX, type GfxSettings } from "./gfxSettings";
import { buildParticles } from "./particles";
import { buildPlants } from "./plants";
import { buildTerrain } from "./terrain";
import { buildWater, createWaterUniforms } from "./water";

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
  private water: ReturnType<typeof buildWater>;
  private terrain: Part;
  private plants: Part & { padSpots: Array<[number, number]> };
  private parts: Part[];
  private gfx: GfxSettings;

  constructor(canvas: HTMLCanvasElement, sim: Simulation, gfx: GfxSettings = { ...DEFAULT_GFX }) {
    this.gfx = gfx;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(this.sunlight, this.ambient);
    this.sunlight.position.set(10, 30, 5);
    this.ctx = { scene: this.scene, camera: this.camera, renderer: this.renderer, sim, gfx, uTime: { value: 0 }, water: createWaterUniforms(sim.world.maxDepth), rng: (salt) => seededRng(sim.seed * 2654435761 + salt) };
    this.rig = new CameraRig(this.camera);
    this.fish = buildFish(this.ctx);
    this.particles = buildParticles(this.ctx);
    this.water = buildWater(this.ctx);
    this.terrain = buildTerrain(this.ctx);
    this.plants = buildPlants(this.ctx);
    this.extras = buildExtras(this.ctx);
    this.parts = [this.terrain, this.plants, this.water, this.fish, this.particles, this.extras];
    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  /** Dev/test hook: world x,z of every lily pad. */
  get padSpots(): Array<[number, number]> {
    return this.plants.padSpots;
  }

  /** Store new graphics settings; later tasks rebuild the quality- and style-dependent parts here. */
  setGfx(s: GfxSettings): void {
    const qualityChanged = s.quality !== this.gfx.quality;
    this.gfx = s;
    this.ctx.gfx = s;
    if (!qualityChanged) return;
    // Quality sets plant and stone/litter density: rebuild both, freeing the old geometry and materials.
    this.terrain.dispose();
    this.plants.dispose();
    this.terrain = buildTerrain(this.ctx);
    this.plants = buildPlants(this.ctx);
    this.parts = [this.terrain, this.plants, this.water, this.fish, this.particles, this.extras];
  }

  private onResize = (): void => this.resize();

  /** Release GPU resources and listeners; the canvas can then host a new PikeScene. */
  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    try {
      for (const p of this.parts) {
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
    this.renderer.setSize(c.clientWidth || window.innerWidth, c.clientHeight || window.innerHeight, false);
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
    this.particles.update(timeS, dt, this.rig.position);
    this.extras.update(timeS);
    this.renderer.render(this.scene, this.camera);
  }
}
