import * as THREE from "three";
import type { RenderCtx } from "./ctx";
import { applyWater } from "./water";

/** Outline meshes live on this layer; the camera only sees it in the stylised style (PikeScene.setGfx). */
export const OUTLINE_LAYER = 1;
/** Outline thickness as a share of body (or log) length. */
export const OUTLINE_FRAC = 0.012;

type Wag = { uniforms: { uTime: { value: number }; uWag: { value: number }; uFreq: { value: number } }; instanced: boolean };

/**
 * Inverted-hull outline: back faces pushed out along the normal by `thickness` (object units), black at 0.6 alpha,
 * fogged by the water like everything else. `wag` repeats the fish tail wave so the hull follows the body.
 */
export function outlineMaterial(ctx: RenderCtx, thickness: number, wag?: Wag): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, side: THREE.BackSide, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thickness };
    let pars = "\nuniform float uOutline;";
    let body = "\ntransformed += normalize(normal) * uOutline;";
    if (wag) {
      Object.assign(shader.uniforms, wag.uniforms);
      pars += `\nuniform float uTime;\nuniform float uWag;\nuniform float uFreq;${wag.instanced ? "\nattribute float aPhase;" : ""}`;
      body += `
float tailAmt = clamp(0.5 - position.x, 0.0, 1.0);
float ph = uTime * uFreq + ${wag.instanced ? "aPhase" : "0.0"} + tailAmt * 5.0;
transformed.z += sin(ph) * uWag * tailAmt * tailAmt;`;
    }
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${pars}`).replace("#include <begin_vertex>", `#include <begin_vertex>${body}`);
  };
  const key = `outline|${thickness}|${wag ? (wag.instanced ? "wi" : "w") : ""}`;
  mat.customProgramCacheKey = () => key;
  applyWater(mat, ctx);
  return mat;
}

/** Show or hide outlines for a style. */
export function setOutlinesVisible(camera: THREE.Camera, on: boolean): void {
  if (on) camera.layers.enable(OUTLINE_LAYER);
  else camera.layers.disable(OUTLINE_LAYER);
}
