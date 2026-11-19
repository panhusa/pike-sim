import * as THREE from "three";
import type { Environment } from "../sim/environment";
import { forward, type Vec3 } from "../sim/math";
import type { SimEvent, Simulation } from "../sim/simulation";
import type { RenderCtx } from "./ctx";
import type { GfxQuality } from "./gfxSettings";
import { applyWater } from "./water";

export interface Burst {
  kind: "silt" | "bubbles" | "scales";
  pos: Vec3;
  t0: number;
}

/** Strike closer than this to the lakebed kicks up silt. */
const SILT_CLEARANCE_M = 0.5;

type SimView = Pick<Simulation, "pikes" | "prey"> & { world: Pick<Simulation["world"], "bottomY"> };

/**
 * Turn new sim events into particle bursts. A strike gives bubbles at the mouth (plus silt when near the
 * bottom); a capture gives scales where the prey was. If the event buffer was trimmed below `fromIndex`,
 * the cursor jumps to the end without replaying anything.
 */
export function burstsFromEvents(events: SimEvent[], fromIndex: number, sim: SimView): { bursts: Burst[]; next: number } {
  const bursts: Burst[] = [];
  if (fromIndex > events.length) return { bursts, next: events.length };
  for (let i = fromIndex; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === "strike") {
      const pk = sim.pikes.find((p) => p.id === e.pikeId);
      if (!pk) continue;
      const f = forward(pk.yaw, pk.pitch);
      const half = (pk.lengthCm / 100) * 0.5;
      const mouth = { x: pk.pos.x + f.x * half, y: pk.pos.y + f.y * half, z: pk.pos.z + f.z * half };
      bursts.push({ kind: "bubbles", pos: mouth, t0: e.t });
      const floor = sim.world.bottomY(mouth.x, mouth.z);
      if (pk.pos.y - floor < SILT_CLEARANCE_M) bursts.push({ kind: "silt", pos: { x: mouth.x, y: floor, z: mouth.z }, t0: e.t });
    } else if (e.type === "capture") {
      const prey = sim.prey.find((p) => p.id === e.preyId);
      const pk = prey ? null : sim.pikes.find((p) => p.id === e.pikeId);
      const at = prey?.pos ?? pk?.pos;
      if (at) bursts.push({ kind: "scales", pos: { x: at.x, y: at.y, z: at.z }, t0: e.t });
    }
  }
  return { bursts, next: events.length };
}

export function particleCounts(q: GfxQuality): { snow: number; glints: number } {
  return q === "high" ? { snow: 1800, glints: 250 } : { snow: 900, glints: 120 };
}

const SNOW_BOX = 30;
const BURST_POOL = 512;
const BURST_LIFE: Record<Burst["kind"], number> = { bubbles: 1.2, silt: 1.5, scales: 1.5 };
const BURST_N: Record<Burst["kind"], number> = { bubbles: 36, silt: 60, scales: 24 };
const BURST_RGB: Record<Burst["kind"], [number, number, number]> = {
  bubbles: [0.92, 0.98, 1.0],
  silt: [0.42, 0.36, 0.24],
  scales: [0.95, 0.95, 0.85],
};

function dotTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 32;
  const cx = cv.getContext("2d")!;
  const grad = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

/**
 * Marine snow around the camera (dimmer and sparser with depth), sun glints just under the surface in
 * daylight, and pooled short-lived strike bursts. Nothing is allocated per frame or per event.
 */
export function buildParticles(ctx: RenderCtx): {
  update(timeS: number, dt: number, cam: THREE.Vector3, env: Environment): void;
  dispose(): void;
} {
  const counts = particleCounts(ctx.gfx.quality);
  const rng = ctx.rng(606);
  const maxDepth = ctx.sim.world.maxDepth;
  const tex = dotTexture();
  const river = ctx.sim.world.shape === "river";

  // --- marine snow
  const n = counts.snow;
  const sPos = new Float32Array(n * 3);
  const sCol = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) sPos.set([(rng() - 0.5) * SNOW_BOX, -rng() * maxDepth, (rng() - 0.5) * SNOW_BOX], i * 3);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute("color", new THREE.BufferAttribute(sCol, 3));
  const sMat = new THREE.PointsMaterial({ color: 0xd8efe8, size: 0.028, map: tex, transparent: true, opacity: 0.65, depthWrite: false, vertexColors: true });
  applyWater(sMat, ctx);
  const snow = new THREE.Points(sGeo, sMat);
  snow.frustumCulled = false;

  // --- glints: tiny additive sparkles in the top metre, faded by daylight
  const g = counts.glints;
  const gPos = new Float32Array(g * 3);
  const gPhase = new Float32Array(g);
  for (let i = 0; i < g; i++) {
    gPos.set([(rng() - 0.5) * 16, -0.05 - rng() * 1.2, (rng() - 0.5) * 16], i * 3);
    gPhase[i] = rng() * Math.PI * 2;
  }
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute("position", new THREE.BufferAttribute(gPos, 3));
  const gMat = new THREE.PointsMaterial({ color: 0xfff6d8, size: 0.03, map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glints = new THREE.Points(gGeo, gMat);
  glints.frustumCulled = false;

  // --- burst pool (ring buffer); colour alpha 0 = dead slot
  const bPos = new Float32Array(BURST_POOL * 3);
  const bCol = new Float32Array(BURST_POOL * 4);
  const bVel = new Float32Array(BURST_POOL * 3);
  const bAge = new Float32Array(BURST_POOL).fill(99);
  const bLife = new Float32Array(BURST_POOL).fill(1);
  const bKind = new Uint8Array(BURST_POOL);
  let ring = 0;
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
  bGeo.setAttribute("color", new THREE.BufferAttribute(bCol, 4));
  const bMat = new THREE.PointsMaterial({ size: 0.07, map: tex, transparent: true, depthWrite: false, vertexColors: true });
  const bursts = new THREE.Points(bGeo, bMat);
  bursts.frustumCulled = false;
  const kinds: Burst["kind"][] = ["bubbles", "silt", "scales"];
  let eventCursor = ctx.sim.events.length;

  ctx.scene.add(snow, glints, bursts);

  const spawn = (b: Burst): void => {
    const k = kinds.indexOf(b.kind);
    for (let j = 0; j < BURST_N[b.kind]; j++) {
      const i = ring;
      ring = (ring + 1) % BURST_POOL;
      const a = rng() * Math.PI * 2;
      const r = rng();
      let vx: number, vy: number, vz: number;
      if (b.kind === "bubbles") [vx, vy, vz] = [Math.cos(a) * 0.15 * r, 0.5 + rng() * 0.5, Math.sin(a) * 0.15 * r];
      else if (b.kind === "silt") [vx, vy, vz] = [Math.cos(a) * (0.3 + r * 0.5), 0.05 + rng() * 0.25, Math.sin(a) * (0.3 + r * 0.5)];
      else [vx, vy, vz] = [Math.cos(a) * 0.25 * r, (rng() - 0.6) * 0.2, Math.sin(a) * 0.25 * r];
      bPos.set([b.pos.x + vx * 0.08, b.pos.y + Math.abs(vy) * 0.02, b.pos.z + vz * 0.08], i * 3);
      bVel.set([vx, vy, vz], i * 3);
      bAge[i] = 0;
      bLife[i] = BURST_LIFE[b.kind] * (0.7 + rng() * 0.3);
      bKind[i] = k;
    }
  };

  return {
    update(timeS, dt, cam, env) {
      // snow drifts and wraps around the camera; dimmer with depth
      const half = SNOW_BOX / 2;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        let x = sPos[o]! + Math.sin(timeS * 0.3 + i) * 0.1 * dt;
        let y = sPos[o + 1]! + 0.02 * dt;
        let z = sPos[o + 2]! + Math.cos(timeS * 0.25 + i * 1.3) * 0.1 * dt;
        if (river) {
          // suspended specks ride the current: the clearest cue of which way the river flows
          const c = ctx.sim.world.currentAt(x, y, z);
          x += c.x * dt;
          z += c.z * dt;
        }
        if (x - cam.x > half) x -= SNOW_BOX;
        else if (cam.x - x > half) x += SNOW_BOX;
        if (z - cam.z > half) z -= SNOW_BOX;
        else if (cam.z - z > half) z += SNOW_BOX;
        if (y > 0) y = -maxDepth;
        sPos[o] = x;
        sPos[o + 1] = y;
        sPos[o + 2] = z;
        const b = 0.35 + 0.65 * Math.exp(y * 0.35); // y is negative under water
        sCol[o] = sCol[o + 1] = sCol[o + 2] = b;
      }
      (sGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (sGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

      // glints follow the camera horizontally and only show by day near the surface
      glints.position.set(cam.x, 0, cam.z);
      const near = Math.max(0, 1 - Math.max(0, -cam.y - 1) / 4);
      gMat.opacity = Math.max(0, (env.light - 0.3) / 0.7) * near * 0.9 * (cam.y > 0 ? 0 : 1);
      gMat.size = 0.02 + 0.02 * (0.5 + 0.5 * Math.sin(timeS * 3));
      for (let i = 0; i < g; i++) gPos[i * 3 + 1] = -0.05 - ((i * 0.37) % 1.2) - 0.05 * Math.sin(timeS * 2 + gPhase[i]!);
      (gGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

      // new strike/capture bursts from the sim's event log (own cursor)
      const r = burstsFromEvents(ctx.sim.events, eventCursor, ctx.sim);
      eventCursor = r.next;
      for (const b of r.bursts) spawn(b);

      for (let i = 0; i < BURST_POOL; i++) {
        const o = i * 3;
        const c = i * 4;
        if (bAge[i]! >= bLife[i]!) {
          bCol[c + 3] = 0;
          continue;
        }
        bAge[i]! += dt;
        const k = kinds[bKind[i]!]!;
        if (k === "bubbles") {
          bVel[o + 1] = bVel[o + 1]! + 0.6 * dt; // buoyant, accelerating up
          bPos[o]! += Math.sin(timeS * 9 + i) * 0.05 * dt;
        } else {
          const drag = Math.exp(-(k === "silt" ? 2.2 : 1.2) * dt);
          bVel[o]! *= drag;
          bVel[o + 2]! *= drag;
          bVel[o + 1] = k === "silt" ? bVel[o + 1]! * drag : bVel[o + 1]! * drag - 0.08 * dt;
        }
        bPos[o]! += bVel[o]! * dt;
        bPos[o + 1] = Math.min(-0.02, bPos[o + 1]! + bVel[o + 1]! * dt);
        bPos[o + 2]! += bVel[o + 2]! * dt;
        const life = bAge[i]! / bLife[i]!;
        const rgb = BURST_RGB[k];
        const flicker = k === "scales" ? 0.55 + 0.45 * Math.sin(timeS * 25 + i * 2.1) : 1;
        bCol[c] = rgb[0] * flicker;
        bCol[c + 1] = rgb[1] * flicker;
        bCol[c + 2] = rgb[2] * flicker;
        bCol[c + 3] = (1 - life) * (k === "silt" ? 0.7 : k === "bubbles" ? 0.6 : 0.95);
      }
      (bGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (bGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose() {
      ctx.scene.remove(snow, glints, bursts);
      for (const x of [sGeo, gGeo, bGeo, sMat, gMat, bMat, tex]) x.dispose();
    },
  };
}
