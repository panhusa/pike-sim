import type * as THREE from "three";
import type { Simulation } from "../sim/simulation";
import type { GfxSettings } from "./gfxSettings";
import type { WaterUniforms } from "./water";

/** Shared handles passed to every render module builder. */
export interface RenderCtx {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sim: Simulation;
  gfx: GfxSettings;
  uTime: { value: number };
  /** Water-volume uniforms shared by every material (see applyWater). */
  water: WaterUniforms;
  /** Fresh deterministic RNG per call, derived from the world seed and a per-builder salt: rebuilds give the same layout. */
  rng: (salt: number) => () => number;
}

/** Deterministic LCG; same seed gives the same lake. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
