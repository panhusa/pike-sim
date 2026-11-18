import * as THREE from "three";

/** Adds a travelling tail wave to a standard material. `uTime`, `uWag` are shared uniforms. */
export function addTailWag(
  mat: THREE.MeshStandardMaterial,
  uniforms: { uTime: { value: number }; uWag: { value: number }; uFreq: { value: number } },
  instanced: boolean,
): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWag = uniforms.uWag;
    shader.uniforms.uFreq = uniforms.uFreq;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform float uWag;\nuniform float uFreq;${instanced ? "\nattribute float aPhase;" : ""}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float tailAmt = clamp(0.5 - position.x, 0.0, 1.0);
        float ph = uTime * uFreq + ${instanced ? "aPhase" : "0.0"} + tailAmt * 5.0;
        transformed.z += sin(ph) * uWag * tailAmt * tailAmt;`,
      );
  };
}
