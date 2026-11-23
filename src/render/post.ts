import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { RenderCtx } from "./ctx";
import type { GfxQuality } from "./gfxSettings";
import { gradeFragment, gradeVertex } from "./shaders/grade.glsl";

export interface PostChain {
  /** the target the scene is drawn into (shaders are compiled against it ahead of play) */
  readonly sceneTarget: THREE.WebGLRenderTarget;
  /** `underwater` turns the shimmer warp on. */
  render(dt: number, underwater: boolean): void;
  resize(w: number, h: number, pixelRatio: number): void;
  dispose(): void;
}

/** Device pixel ratio for a quality: high caps at 2, low at 1 (a sub-1 display is never upscaled). */
export function pixelRatioFor(q: GfxQuality, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, q === "high" ? 2 : 1);
}

/** Per-style grade values for the colour pass. */
export function gradeFor(style: RenderCtx["gfx"]["style"]): { saturation: number; contrast: number; vignette: number } {
  return style === "stylised" ? { saturation: 1.3, contrast: 1.08, vignette: 0.25 } : { saturation: 1.0, contrast: 1.0, vignette: 0.35 };
}

/**
 * High: RenderPass (4x MSAA half-float target) → UnrealBloom → grade (warp, vignette) → OutputPass (sRGB).
 * Low: none (see PikeScene) — phones are fill-rate bound and a full-screen chain costs more than it gives.
 */
export function buildPost(ctx: RenderCtx): PostChain {
  const r = ctx.renderer;
  const size = r.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x * r.getPixelRatio(), size.y * r.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(r, target);
  const renderPass = new RenderPass(ctx.scene, ctx.camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.4, 0.82);
  const g = gradeFor(ctx.gfx.style);
  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: ctx.uTime,
      uWarp: { value: 0 },
      uVignette: { value: g.vignette },
      uSaturation: { value: g.saturation },
      uContrast: { value: g.contrast },
    },
    vertexShader: gradeVertex,
    fragmentShader: gradeFragment,
  });
  const output = new OutputPass();
  composer.addPass(renderPass);
  if (ctx.gfx.style !== "stylised") composer.addPass(bloom); // stylised has no bloom (flat look)
  composer.addPass(grade);
  composer.addPass(output);
  return {
    sceneTarget: target,
    render(dt, underwater) {
      grade.uniforms.uWarp!.value = underwater ? 0.0015 : 0;
      composer.render(dt);
    },
    resize(w, h, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
    },
    dispose() {
      bloom.dispose();
      grade.dispose();
      output.dispose();
      renderPass.dispose();
      composer.dispose(); // frees its two internal targets; the target we passed is renderTarget1
      target.dispose();
    },
  };
}
