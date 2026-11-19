import * as THREE from "three";
import type { RenderCtx } from "./ctx";

const SKY_R = 380;
const LAND_OUT = 300;
/** Outer radius of the land ring: at least LAND_OUT, and 150 m past the water on the game-size river. */
export const landOut = (half: number): number => Math.max(LAND_OUT, half + 150);

/**
 * The world above the water, shown while the camera is in the air (a leap): sky dome with a sun, rolling
 * shore land matching the lake bank, a ring of pines and birches. Splashes (rings and droplets) show
 * wherever a fish breaks the surface, seen from above or below.
 */
export function buildAbove(ctx: RenderCtx): { update(timeS: number, dt: number, cameraY: number): void; dispose(): void } {
  const w = ctx.sim.world;
  const half = w.size / 2;
  const own: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T): T => (own.push(x), x);
  const air = new THREE.Group();
  ctx.scene.add(air);

  // ---- sky dome ----
  const skyGeo = keep(new THREE.SphereGeometry(SKY_R, 32, 16));
  const skyMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { uAirZenith: ctx.water.uAirZenith, uAirHorizon: ctx.water.uAirHorizon, uSunDir: ctx.water.uSunDir, uWaterLight: ctx.water.uWaterLight },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uAirZenith; uniform vec3 uAirHorizon; uniform vec3 uSunDir; uniform float uWaterLight;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = mix(uAirHorizon, uAirZenith, pow(clamp(d.y, 0.0, 1.0), 0.55));
          float s = max(dot(d, uSunDir), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * uWaterLight;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  air.add(sky);

  // ---- land: a ring from the bank outward, same rise as the terrain bank, then hills ----
  const rng = ctx.rng(4242);
  const landY = (x: number, z: number): number => w.bankY(x, z) - 0.03;
  const landGeo = keep(new THREE.RingGeometry(half - 0.5, landOut(half), 128, 24));
  landGeo.rotateX(-Math.PI / 2);
  const lp = landGeo.attributes.position!;
  const lc = new Float32Array(lp.count * 3);
  const grass = new THREE.Color(0x4d6b2f);
  const dry = new THREE.Color(0x7a7a45);
  const mud = new THREE.Color(0x4f5b34);
  const c = new THREE.Color();
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    const z = lp.getZ(i);
    lp.setY(i, landY(x, z));
    const e = -w.edgeDist(x, z);
    c.copy(mud).lerp(grass, THREE.MathUtils.smoothstep(e, 0, 6)).lerp(dry, (Math.sin(x * 0.13) * Math.sin(z * 0.11) + 1) * 0.18);
    lc.set([c.r, c.g, c.b], i * 3);
  }
  landGeo.setAttribute("color", new THREE.BufferAttribute(lc, 3));
  landGeo.computeVertexNormals();
  const landMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  air.add(new THREE.Mesh(landGeo, landMat));

  // ---- trees: instanced pines (three cones) and birches (trunk + crown) ----
  const shoreK = w.size / (w.shape === "river" ? 144 : 90); // more shore on the game-size water, same tree density
  const pineN = Math.round(220 * Math.max(1, shoreK));
  const birchN = Math.round(90 * Math.max(1, shoreK));
  const trunkGeo = keep(new THREE.CylinderGeometry(0.12, 0.2, 1, 6));
  trunkGeo.translate(0, 0.5, 0);
  const pineTrunkMat = keep(new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }));
  const birchTrunkMat = keep(new THREE.MeshStandardMaterial({ color: 0xe6e2d6, roughness: 0.8 }));
  const coneGeo = keep(new THREE.ConeGeometry(1, 1, 8));
  coneGeo.translate(0, 0.5, 0);
  const needleMat = keep(new THREE.MeshStandardMaterial({ color: 0x23402a, roughness: 0.9, flatShading: true }));
  const crownGeo = keep(new THREE.IcosahedronGeometry(1, 1));
  const leafMat = keep(new THREE.MeshStandardMaterial({ color: 0x6f8f3a, roughness: 0.85, flatShading: true }));
  const pineTrunks = new THREE.InstancedMesh(trunkGeo, pineTrunkMat, pineN);
  const pineCones = new THREE.InstancedMesh(coneGeo, needleMat, pineN * 3);
  const birchTrunks = new THREE.InstancedMesh(trunkGeo, birchTrunkMat, birchN);
  const birchCrowns = new THREE.InstancedMesh(crownGeo, leafMat, birchN);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const place = (): [number, number, number] => {
    // dense near the shore, thinning outward; never in the water
    for (let k = 0; k < 60; k++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * (half + 75);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const e = -w.edgeDist(x, z);
      if (e < 2.5 || e > 75 || rng() > Math.exp(-e / 28)) continue;
      return [x, landY(x, z) - 0.1, z];
    }
    return [0, -50, 0]; // (never in practice) hidden under the lakebed
  };
  for (let i = 0; i < pineN; i++) {
    const [x, y, z] = place();
    const h = 7 + rng() * 9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    pineTrunks.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(1 + h * 0.03, h * 0.45, 1 + h * 0.03)));
    for (let k = 0; k < 3; k++) {
      const r = (h * 0.24) * (1 - k * 0.24);
      pineCones.setMatrixAt(i * 3 + k, m.compose(p.set(x, y + h * (0.22 + k * 0.22), z), q, s.set(r, h * 0.42, r)));
    }
  }
  for (let i = 0; i < birchN; i++) {
    const [x, y, z] = place();
    const h = 6 + rng() * 6;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    birchTrunks.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(0.7, h * 0.75, 0.7)));
    const r = h * 0.28;
    birchCrowns.setMatrixAt(i, m.compose(p.set(x, y + h * 0.75, z), q, s.set(r, r * 1.3, r)));
  }
  air.add(pineTrunks, pineCones, birchTrunks, birchCrowns);

  // ---- splashes: an expanding ring and a burst of droplets where a fish crosses the surface ----
  const SPLASHES = 6;
  const DROPS = 28;
  const splashGroup = new THREE.Group();
  ctx.scene.add(splashGroup);
  const ringGeo = keep(new THREE.RingGeometry(0.8, 1, 32));
  ringGeo.rotateX(-Math.PI / 2);
  const dropGeo = keep(new THREE.BufferGeometry());
  const dropPos = new Float32Array(SPLASHES * DROPS * 3);
  dropGeo.setAttribute("position", new THREE.BufferAttribute(dropPos, 3));
  const dot = document.createElement("canvas");
  dot.width = dot.height = 32;
  const dctx = dot.getContext("2d")!;
  const grad = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.8)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, 32, 32);
  const dotTex = keep(new THREE.CanvasTexture(dot));
  const dropMat = keep(new THREE.PointsMaterial({ color: 0xeef7ff, size: 0.025, map: dotTex, transparent: true, opacity: 0.9, depthWrite: false }));
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.frustumCulled = false;
  splashGroup.add(drops);
  interface Splash { ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; x: number; z: number; size: number; vel: Float32Array; pos: Float32Array }
  const splashes: Splash[] = [];
  for (let i = 0; i < SPLASHES; i++) {
    const mat = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.visible = false;
    splashGroup.add(ring);
    splashes.push({ ring, mat, t: 99, x: 0, z: 0, size: 1, vel: new Float32Array(DROPS * 3), pos: dropPos.subarray(i * DROPS * 3, (i + 1) * DROPS * 3) });
  }
  let next = 0;
  const splashAt = (x: number, z: number, size: number): void => {
    const sp = splashes[next++ % SPLASHES]!;
    sp.t = 0;
    sp.x = x;
    sp.z = z;
    sp.size = size;
    for (let k = 0; k < DROPS; k++) {
      const a = Math.random() * Math.PI * 2;
      const out = (0.4 + Math.random() * 1.2) * size;
      sp.vel.set([Math.cos(a) * out, (1.5 + Math.random() * 2.5) * size, Math.sin(a) * out], k * 3);
      sp.pos.set([x, 0.02, z], k * 3);
    }
  };
  const prevY = new Map<number, number>();

  return {
    update(timeS, dt, cameraY) {
      air.visible = cameraY > 0;
      sky.position.copy(ctx.camera.position);
      // fish crossing the surface either way make a splash
      for (const pk of ctx.sim.pikes) {
        if (!pk.alive) continue;
        const was = prevY.get(pk.id);
        prevY.set(pk.id, pk.pos.y);
        if (was !== undefined && (was <= 0) !== (pk.pos.y <= 0)) splashAt(pk.pos.x, pk.pos.z, Math.max(0.6, pk.lengthCm / 40));
      }
      let live = false;
      for (const sp of splashes) {
        sp.t += dt;
        const on = sp.t < 1.4;
        sp.ring.visible = on;
        if (!on) {
          sp.pos.fill(-999);
          continue;
        }
        live = true;
        const k = sp.t / 1.4;
        sp.ring.position.set(sp.x, 0.01, sp.z);
        sp.ring.scale.setScalar((0.15 + k * 1.4) * sp.size);
        sp.mat.opacity = 0.6 * (1 - k);
        for (let i = 0; i < DROPS; i++) {
          const o = i * 3;
          if (sp.pos[o + 1]! < -0.05) continue;
          sp.vel[o + 1]! -= 9.81 * dt;
          sp.pos[o] = sp.pos[o]! + sp.vel[o]! * dt;
          sp.pos[o + 1] = sp.pos[o + 1]! + sp.vel[o + 1]! * dt;
          sp.pos[o + 2] = sp.pos[o + 2]! + sp.vel[o + 2]! * dt;
        }
      }
      drops.visible = live;
      if (live) dropGeo.attributes.position!.needsUpdate = true;
      void timeS;
    },
    dispose() {
      ctx.scene.remove(air, splashGroup);
      for (const im of [pineTrunks, pineCones, birchTrunks, birchCrowns]) im.dispose();
      for (const d of own) d.dispose();
    },
  };
}
