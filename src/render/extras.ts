import * as THREE from "three";
import type { RenderCtx } from "./ctx";
import { HERON } from "../sim/extras";
import { applyWater } from "./water";

const MAX_BUGS = 48;
const MAX_FROGS = 16;
/** frogs are drawn bigger than life too (7 cm in the sim) so they read from a pike's eye level */
const FROG_SCALE = 1.5;
const COLORS = { fly: 0x1d1f1a, beetle: 0x3a2a12, mayfly: 0xc9b47a };
/** drawn larger than life so a bug on the film reads on a phone screen */
const BUG_SCALE = 2.4;

/**
 * Game extras drawn from `sim.extras`: insects (bodies, flapping wings, rings on the surface film),
 * the fisherman's boat with an angler and rod, the wobbler lure and its line, the heron (shadow,
 * legs and beak, stab splash) and the otter (sleek body, paddling legs, tail, bubble trail).
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

  // ---- frogs: a squat green body, two eye bumps, two hind legs that kick out when it hops ----
  const frogMat = own(new THREE.MeshStandardMaterial({ color: 0x5a8a2e, roughness: 0.55 }));
  applyWater(frogMat, ctx);
  const frogBellyMat = own(new THREE.MeshStandardMaterial({ color: 0x3f6a22, roughness: 0.6 }));
  applyWater(frogBellyMat, ctx);
  const frogBodyGeo = own(new THREE.SphereGeometry(1, 10, 8));
  frogBodyGeo.scale(0.035, 0.02, 0.026);
  const frogEyeGeo = own(new THREE.SphereGeometry(0.008, 6, 5));
  const frogLegGeo = own(new THREE.SphereGeometry(1, 6, 5));
  frogLegGeo.scale(0.026, 0.007, 0.01);
  frogLegGeo.translate(-0.022, 0, 0); // pivot at the hip
  const frogBodies = new THREE.InstancedMesh(frogBodyGeo, frogMat, MAX_FROGS);
  const frogEyes = new THREE.InstancedMesh(frogEyeGeo, frogMat, MAX_FROGS * 2);
  const frogLegs = new THREE.InstancedMesh(frogLegGeo, frogBellyMat, MAX_FROGS * 2);
  for (const im of [frogBodies, frogEyes, frogLegs]) im.frustumCulled = false;
  group.add(frogBodies, frogEyes, frogLegs);
  const frogRings = new THREE.InstancedMesh(ringGeo, ringMat, MAX_FROGS);
  frogRings.frustumCulled = false;
  group.add(frogRings);

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

  // ---- heron: a shadow on the surface, two grey legs and a neck/beak above it, a splash ring after the stab ----
  const low = ctx.gfx.quality !== "high";
  const heron = new THREE.Group();
  const shadowGeo = own(new THREE.CircleGeometry(1, low ? 12 : 20));
  shadowGeo.rotateX(-Math.PI / 2);
  shadowGeo.scale(0.9, 1, 0.45); // a long bird shape from below
  const shadowMat = own(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  const greyMat = own(new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.8 }));
  applyWater(greyMat, ctx);
  const legGeo = own(new THREE.CylinderGeometry(0.012, 0.015, 1.1, 5));
  legGeo.translate(0, 0.35, 0); // bottom 0.2 m under the surface
  const legs = [new THREE.Mesh(legGeo, greyMat), new THREE.Mesh(legGeo, greyMat)];
  const bodyGeoH = own(new THREE.SphereGeometry(1, low ? 8 : 12, low ? 6 : 8));
  bodyGeoH.scale(0.38, 0.2, 0.18);
  const heronBody = new THREE.Mesh(bodyGeoH, greyMat);
  heronBody.position.y = 1.0;
  const neckGeo = own(new THREE.CylinderGeometry(0.03, 0.045, 0.7, 6));
  neckGeo.translate(0, 0.35, 0); // pivot at its base
  const neck = new THREE.Mesh(neckGeo, greyMat);
  const beakGeo = own(new THREE.ConeGeometry(0.025, 0.22, 6));
  beakGeo.rotateX(Math.PI); // tip down
  beakGeo.translate(0, -0.11, 0);
  const beakMat = own(new THREE.MeshStandardMaterial({ color: 0xd8a640, roughness: 0.5 }));
  applyWater(beakMat, ctx);
  const beak = new THREE.Mesh(beakGeo, beakMat);
  heron.add(...legs, heronBody);
  const splash = new THREE.Mesh(ringGeo, own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })));
  group.add(shadow, heron, neck, beak, splash); // neck and beak are placed in world space

  // ---- otter: dark brown sleek body, head, tapering tail, four paddling legs, a trail of bubbles ----
  const otter = new THREE.Group();
  const furMat = own(new THREE.MeshStandardMaterial({ color: 0x3b2716, roughness: 0.55 }));
  applyWater(furMat, ctx);
  const otterBodyGeo = own(new THREE.SphereGeometry(1, low ? 10 : 14, low ? 6 : 10));
  otterBodyGeo.scale(0.36, 0.1, 0.11);
  const otterHeadGeo = own(new THREE.SphereGeometry(1, 8, 6));
  otterHeadGeo.scale(0.1, 0.075, 0.08);
  const otterHead = new THREE.Mesh(otterHeadGeo, furMat);
  otterHead.position.set(0.38, 0.02, 0);
  const tailGeo = own(new THREE.ConeGeometry(0.06, 0.4, 6));
  tailGeo.rotateZ(Math.PI / 2); // along -x, tip backward
  tailGeo.translate(-0.5, 0, 0);
  const tail = new THREE.Mesh(tailGeo, furMat);
  const pawGeo = own(new THREE.SphereGeometry(1, 6, 4));
  pawGeo.scale(0.06, 0.02, 0.03);
  pawGeo.translate(0, -0.06, 0);
  const paws = [0.2, -0.2].flatMap((x) => [1, -1].map((side) => {
    const m = new THREE.Mesh(pawGeo, furMat);
    m.position.set(x, -0.04, side * 0.09);
    return m;
  }));
  otter.add(new THREE.Mesh(otterBodyGeo, furMat), otterHead, tail, ...paws);
  group.add(otter);
  const BUBBLES = low ? 6 : 12;
  const bubbleGeo = own(new THREE.SphereGeometry(1, 6, 4));
  const bubbleMat = own(new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.55, depthWrite: false }));
  const bubbles = new THREE.InstancedMesh(bubbleGeo, bubbleMat, BUBBLES);
  bubbles.frustumCulled = false;
  group.add(bubbles);
  /** where the otter was, a bubble released from each (render-side only) */
  const trail: { x: number; y: number; z: number; born: number }[] = [];
  let lastBubble = 0;
  let heronLegX = 0;
  let heronLegZ = 0;
  let heronSeen = -1;
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const neckBase = new THREE.Vector3();
  const neckDir = new THREE.Vector3();

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const col = new THREE.Color();
  const tip = new THREE.Vector3();

  function updateHeron(timeS: number): void {
    const h = ctx.sim.arcade ? ctx.sim.extras.heron : null;
    shadow.visible = heron.visible = neck.visible = beak.visible = splash.visible = !!h;
    if (!h) return;
    if (heronSeen !== h.id) {
      heronSeen = h.id;
      heronLegX = h.x - 0.9;
      heronLegZ = h.z - 0.3;
    }
    // the shadow slides over the fish while the bird wades after it
    shadow.position.set(h.x, -0.01, h.z);
    shadow.rotation.y = Math.sin(timeS * 0.7) * 0.3;
    (shadow.material as THREE.MeshBasicMaterial).opacity = Math.min(0.45, 0.15 + h.t * 0.2);
    const tx = h.aimX - 0.75;
    const tz = h.aimZ - 0.25;
    heronLegX += (tx - heronLegX) * 0.05;
    heronLegZ += (tz - heronLegZ) * 0.05;
    heron.position.set(heronLegX, 0, heronLegZ);
    const step = h.struck ? 0 : Math.sin(timeS * 4) * 0.12;
    legs[0]!.position.set(step, -0.1, 0.08);
    legs[1]!.position.set(-step, -0.1, -0.08);
    // neck from the body's front toward the beak
    neckBase.set(heronLegX + 0.3, 1.05, heronLegZ);
    const sinceStab = h.t - HERON.warnS;
    const plunge = h.struck ? Math.max(0, 1 - Math.abs(sinceStab - 0.12) / 0.35) : Math.max(0, (h.t - HERON.warnS + 0.4) / 0.4) * 0.15;
    const tipY = 0.55 - plunge * 0.85; // dips under the surface at the stab
    tip.set(h.aimX, tipY, h.aimZ);
    neck.position.copy(neckBase);
    neckDir.copy(tip).sub(neckBase);
    const len = neckDir.length();
    neckDir.normalize();
    neck.scale.set(1, Math.max(0.2, (len - 0.22) / 0.7), 1);
    neck.quaternion.setFromUnitVectors(UP, neckDir);
    // the beak's tip lands on the aim point
    beak.position.copy(tip).addScaledVector(neckDir, -0.22);
    beak.quaternion.setFromUnitVectors(DOWN, neckDir);
    // splash: a ring spreading from where it struck
    splash.visible = h.struck;
    if (h.struck) {
      const k = Math.min(1, Math.max(0, sinceStab) / 0.6);
      splash.position.set(h.aimX, -0.004, h.aimZ);
      splash.scale.setScalar(0.1 + k * (h.hit ? 0.9 : 0.6));
      (splash.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
    }
  }

  function updateOtter(timeS: number): void {
    const o = ctx.sim.arcade ? ctx.sim.extras.otter : null;
    otter.visible = !!o;
    if (o) {
      otter.position.set(o.pos.x, o.pos.y, o.pos.z);
      // a sinuous swim: body rolls and the tail sweeps
      otter.rotation.set(Math.sin(timeS * 7) * 0.12, -o.yaw, 0, "YXZ");
      tail.rotation.y = Math.sin(timeS * 9) * 0.35;
      paws.forEach((p, i) => (p.rotation.z = Math.sin(timeS * 10 + i * 1.6) * 0.7));
      if (timeS - lastBubble > 0.15) {
        lastBubble = timeS;
        trail.push({ x: o.pos.x - Math.cos(o.yaw) * 0.3, y: o.pos.y, z: o.pos.z - Math.sin(o.yaw) * 0.3, born: timeS });
        if (trail.length > BUBBLES) trail.shift();
      }
    }
    let n = 0;
    for (const b of trail) {
      const age = timeS - b.born;
      if (age > 2) continue;
      p.set(b.x + Math.sin(b.born * 13) * 0.05, Math.min(-0.01, b.y + age * 0.35), b.z + Math.cos(b.born * 11) * 0.05);
      s.setScalar(0.012 + age * 0.006);
      bubbles.setMatrixAt(n++, m.compose(p, q.identity(), s));
    }
    bubbles.count = n;
    bubbles.instanceMatrix.needsUpdate = true;
  }

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

      // frogs: bodies float at the film; legs thrash while it glides after a kick
      let fn = 0;
      let fr = 0;
      for (const f of ctx.sim.arcade ? ex.frogs : []) {
        if (fn >= MAX_FROGS) break;
        const sp = Math.min(1, Math.hypot(f.vel.x, f.vel.z) / 0.3);
        const heading = sp > 0.02 ? Math.atan2(f.vel.z, f.vel.x) : f.id * 1.7;
        const bob = f.diveT > 0 ? 0 : Math.sin(timeS * 2 + f.id) * 0.003;
        e.set(0, -heading, 0);
        q.setFromEuler(e);
        p.set(f.pos.x, f.pos.y + 0.012 + bob, f.pos.z);
        s.setScalar(FROG_SCALE);
        frogBodies.setMatrixAt(fn, m.compose(p, q, s));
        for (const side of [1, -1]) {
          // eyes: two bumps on the head
          e.set(0, -heading, 0);
          q.setFromEuler(e);
          const eyeAt = new THREE.Vector3(0.018, 0.016, side * 0.011).multiplyScalar(FROG_SCALE).applyQuaternion(q).add(p);
          frogEyes.setMatrixAt(fn * 2 + (side > 0 ? 0 : 1), m.compose(eyeAt, q, s));
          // hind legs: folded at rest, swept back and out while kicking
          const swing = 0.35 + sp * (0.7 + 0.4 * Math.sin(timeS * 22 + f.id));
          e.set(0, -heading + side * swing, 0, "YXZ");
          q.setFromEuler(e);
          const hip = new THREE.Vector3(-0.022, -0.002, side * 0.02).multiplyScalar(FROG_SCALE);
          e.set(0, -heading, 0);
          const hq = new THREE.Quaternion().setFromEuler(e);
          hip.applyQuaternion(hq).add(p);
          frogLegs.setMatrixAt(fn * 2 + (side > 0 ? 0 : 1), m.compose(hip, q, s));
        }
        if (f.diveT <= 0) {
          const k = ((timeS * 0.6 + f.id * 0.37) % 1 + 1) % 1;
          p.set(f.pos.x, -0.003, f.pos.z);
          s.setScalar(0.05 + k * 0.25);
          frogRings.setMatrixAt(fr, m.compose(p, q.identity(), s));
          frogRings.setColorAt(fr, col.setScalar(sp > 0.05 ? 1 - k : (1 - k) * 0.4));
          fr++;
        }
        fn++;
      }
      frogBodies.count = fn;
      frogEyes.count = fn * 2;
      frogLegs.count = fn * 2;
      frogRings.count = fr;
      for (const im of [frogBodies, frogEyes, frogLegs, frogRings]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }

      updateHeron(timeS);
      updateOtter(timeS);

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
      frogBodies.dispose();
      frogEyes.dispose();
      frogLegs.dispose();
      frogRings.dispose();
      bubbles.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
