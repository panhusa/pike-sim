import * as THREE from "three";
import type { RenderCtx } from "./ctx";
import { applyWater } from "./water";

const MAX_BUGS = 48;
const COLORS = { fly: 0x1d1f1a, beetle: 0x3a2a12, mayfly: 0xc9b47a };
/** drawn larger than life so a bug on the film reads on a phone screen */
const BUG_SCALE = 2.4;

/**
 * Game extras drawn from `sim.extras`: insects (bodies, flapping wings, rings on the surface film),
 * the fisherman's boat with an angler and rod, the wobbler lure and its line.
 */
export function buildExtras(ctx: RenderCtx): { update(timeS: number): void; dispose(): void } {
  const disposables: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);
  const group = new THREE.Group();
  ctx.scene.add(group);

  // ---- insects ----
  const bodyGeo = own(new THREE.SphereGeometry(1, 8, 6));
  bodyGeo.scale(0.012, 0.005, 0.005);
  const bodyMat = own(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 }));
  applyWater(bodyMat, ctx);
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, MAX_BUGS);
  bodies.frustumCulled = false;
  const wingGeo = own(new THREE.PlaneGeometry(0.014, 0.022));
  wingGeo.rotateX(-Math.PI / 2);
  wingGeo.translate(0, 0, 0.011);
  const wingMat = own(new THREE.MeshBasicMaterial({ color: 0xe8f0f0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
  const wings = new THREE.InstancedMesh(wingGeo, wingMat, MAX_BUGS * 2);
  wings.frustumCulled = false;
  const ringGeo = own(new THREE.RingGeometry(0.85, 1, 24));
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, MAX_BUGS);
  rings.frustumCulled = false;
  group.add(bodies, wings, rings);

  // ---- boat: an extruded rowing-boat outline, open on top, with an angler and a rod ----
  const boat = new THREE.Group();
  const outline = new THREE.Shape();
  outline.moveTo(-1.7, -0.55);
  outline.lineTo(0.9, -0.62);
  outline.quadraticCurveTo(1.7, -0.4, 1.95, 0);
  outline.quadraticCurveTo(1.7, 0.4, 0.9, 0.62);
  outline.lineTo(-1.7, 0.55);
  outline.lineTo(-1.7, -0.55);
  const hullGeo = own(new THREE.ExtrudeGeometry(outline, { depth: 0.5, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 10 }));
  hullGeo.rotateX(-Math.PI / 2); // outline in x/z, extruded upward
  const hullMat = own(new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.8 }));
  applyWater(hullMat, ctx);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = -0.22;
  const keelGeo = own(new THREE.BoxGeometry(3.4, 0.08, 0.06));
  const keel = new THREE.Mesh(keelGeo, hullMat);
  keel.position.y = -0.3;
  const personMat = own(new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.9 }));
  applyWater(personMat, ctx);
  const torsoGeo = own(new THREE.CylinderGeometry(0.2, 0.26, 0.75, 10));
  const torso = new THREE.Mesh(torsoGeo, personMat);
  torso.position.set(-0.9, 0.62, 0);
  const headGeo = own(new THREE.SphereGeometry(0.14, 12, 10));
  const skinMat = own(new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.7 }));
  applyWater(skinMat, ctx);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(-0.9, 1.12, 0);
  const hatGeo = own(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14));
  const hat = new THREE.Mesh(hatGeo, personMat);
  hat.position.set(-0.9, 1.24, 0);
  boat.add(hull, keel, torso, head, hat);
  const rodGeo = own(new THREE.CylinderGeometry(0.006, 0.015, 2.4, 6));
  rodGeo.translate(0, 1.2, 0);
  const rodMat = own(new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 }));
  const rod = new THREE.Mesh(rodGeo, rodMat);
  group.add(boat, rod);

  // ---- lure: a jointless wobbler with a lip and two trebles ----
  const lure = new THREE.Group();
  const lureGeo = own(new THREE.SphereGeometry(1, 16, 10));
  lureGeo.scale(0.055, 0.016, 0.012);
  const lureMat = own(new THREE.MeshStandardMaterial({ color: 0xd9b84a, metalness: 0.85, roughness: 0.25, emissive: 0x2a1f00 }));
  applyWater(lureMat, ctx);
  const lureBody = new THREE.Mesh(lureGeo, lureMat);
  const backGeo = own(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6));
  backGeo.scale(0.053, 0.017, 0.0125);
  const backMat = own(new THREE.MeshStandardMaterial({ color: 0x2c5a2a, roughness: 0.4, metalness: 0.3 }));
  applyWater(backMat, ctx);
  const back = new THREE.Mesh(backGeo, backMat);
  const lipGeo = own(new THREE.PlaneGeometry(0.022, 0.016));
  const lipMat = own(new THREE.MeshBasicMaterial({ color: 0xcfe3ea, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  const lip = new THREE.Mesh(lipGeo, lipMat);
  lip.position.set(0.06, -0.008, 0);
  lip.rotation.set(Math.PI / 2, 0.9, 0);
  const hookGeo = own(new THREE.TorusGeometry(0.007, 0.0012, 4, 10, Math.PI * 1.4));
  const hookMat = own(new THREE.MeshStandardMaterial({ color: 0x9a1a1a, metalness: 0.7, roughness: 0.3 }));
  for (const x of [0.02, -0.035]) {
    for (let k = 0; k < 3; k++) {
      const h = new THREE.Mesh(hookGeo, hookMat);
      h.position.set(x, -0.022, 0);
      h.rotation.set(0, (k * Math.PI * 2) / 3, Math.PI / 2);
      lure.add(h);
    }
  }
  lure.add(lureBody, back, lip);
  group.add(lure);

  // ---- line from the rod tip to the lure ----
  const lineGeo = own(new THREE.BufferGeometry());
  const linePos = new Float32Array(3 * 12);
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = own(new THREE.LineBasicMaterial({ color: 0xf2f2e6, transparent: true, opacity: 0.55 }));
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  group.add(line);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const tip = new THREE.Vector3();

  return {
    update(timeS) {
      const ex = ctx.sim.extras;
      // insects
      const bugs = ctx.sim.arcade ? ex.insects : [];
      let n = 0;
      let r = 0;
      for (const f of bugs) {
        if (n >= MAX_BUGS) break;
        const heading = Math.atan2(f.vel.z, f.vel.x) || f.id;
        const big = BUG_SCALE * (f.kind === "beetle" ? 1.5 : f.kind === "mayfly" ? 1.25 : 1);
        e.set(0, -heading, 0);
        q.setFromEuler(e);
        p.set(f.pos.x, f.pos.y + 0.004, f.pos.z);
        s.setScalar(big);
        bodies.setMatrixAt(n, m.compose(p, q, s));
        bodies.setColorAt(n, col.setHex(COLORS[f.kind]));
        // wings: fast flap aloft, still and folded on the film
        const flap = f.aloft ? Math.sin(timeS * 45 + f.id) * 0.9 : 0.15;
        for (const side of [1, -1]) {
          e.set(side * flap, -heading, 0, "YXZ");
          q.setFromEuler(e);
          s.set(big, 1, side * big);
          wings.setMatrixAt(n * 2 + (side > 0 ? 0 : 1), m.compose(p, q, s));
        }
        if (!f.aloft) {
          const k = ((timeS * 0.7 + f.id * 0.37) % 1 + 1) % 1; // a ring spreading out and fading
          p.set(f.pos.x, -0.003, f.pos.z);
          s.setScalar(0.05 + k * 0.3);
          rings.setMatrixAt(r, m.compose(p, q.identity(), s));
          rings.setColorAt(r, col.setScalar(1 - k));
          r++;
        }
        n++;
      }
      bodies.count = n;
      wings.count = n * 2;
      rings.count = r;
      for (const im of [bodies, wings, rings]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }

      // boat, rod, lure, line
      const a = ctx.sim.arcade ? ex.angler : null;
      boat.visible = rod.visible = !!a;
      lure.visible = line.visible = !!a && a.lure.state !== "gone";
      if (!a) return;
      boat.position.set(a.boat.x, Math.sin(timeS * 1.3) * 0.03, a.boat.z);
      boat.rotation.set(Math.sin(timeS * 0.9) * 0.025, -a.boatYaw, Math.sin(timeS * 1.1) * 0.02);
      const L = a.lure;
      // rod: from the angler's hands toward the lure, bending up when a fish pulls
      const hx = a.boat.x - Math.cos(a.boatYaw) * 0.9;
      const hz = a.boat.z - Math.sin(a.boatYaw) * 0.9;
      const toLure = Math.atan2(L.pos.z - hz, L.pos.x - hx);
      const bend = L.state === "hooked" ? 0.35 + Math.sin(timeS * 9) * 0.08 : 0.9;
      rod.position.set(hx, 0.75, hz);
      e.set(0, -toLure, -bend, "YXZ");
      rod.quaternion.setFromEuler(e);
      rod.rotateZ(-Math.PI / 2 + bend * 2 - bend); // lay the rod out toward the lure
      tip.set(0, 2.4, 0).applyQuaternion(rod.quaternion).add(rod.position);
      if (!lure.visible) return;
      // lure pose: along its swimming direction, rolling as it wobbles
      lure.position.set(L.pos.x, L.pos.y, L.pos.z);
      const dir = Math.hypot(L.vel.x, L.vel.z) > 0.05 ? Math.atan2(-L.vel.z, -L.vel.x) : toLure;
      lure.rotation.set(Math.sin(timeS * 14) * 0.5, -dir, 0, "YXZ");
      lure.rotateY(Math.PI); // nose first toward the boat
      // line: rod tip down to the water entry, then straight-ish to the lure with a little sag
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const x = tip.x + (L.pos.x - tip.x) * t;
        const z = tip.z + (L.pos.z - tip.z) * t;
        const y = tip.y + (L.pos.y - tip.y) * t - Math.sin(t * Math.PI) * (L.state === "hooked" ? 0.05 : 0.3);
        linePos.set([x, y, z], i * 3);
      }
      lineGeo.attributes.position!.needsUpdate = true;
    },
    dispose() {
      ctx.scene.remove(group);
      bodies.dispose();
      wings.dispose();
      rings.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
