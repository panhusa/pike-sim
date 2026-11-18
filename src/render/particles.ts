import * as THREE from "three";
import type { RenderCtx } from "./ctx";
import { applyWater } from "./water";

/** Drifting suspended particles anchored around the camera. */
export function buildParticles(ctx: RenderCtx): { update(timeS: number, dt: number, cam: THREE.Vector3): void; dispose(): void } {
  const n = 900;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([(Math.random() - 0.5) * 30, -Math.random() * 6, (Math.random() - 0.5) * 30], i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(a, 3));
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const cx = cv.getContext("2d")!;
  const grad = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.PointsMaterial({ color: 0xd8efe8, size: 0.025, map: tex, transparent: true, opacity: 0.6, depthWrite: false });
  applyWater(mat, ctx);
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  ctx.scene.add(p);
  return {
    update(timeS, dt, cam) {
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        let x = pa.getX(i) + Math.sin(timeS * 0.3 + i) * 0.1 * dt;
        let z = pa.getZ(i) + Math.cos(timeS * 0.25 + i * 1.3) * 0.1 * dt;
        let y = pa.getY(i) + 0.03 * dt;
        if (Math.abs(x - cam.x) > 15) x = cam.x + (Math.random() - 0.5) * 28;
        if (Math.abs(z - cam.z) > 15) z = cam.z + (Math.random() - 0.5) * 28;
        if (y > 0) y = -6;
        pa.setXYZ(i, x, y, z);
      }
      pa.needsUpdate = true;
    },
    dispose() {
      ctx.scene.remove(p);
      g.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
