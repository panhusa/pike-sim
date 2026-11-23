import * as THREE from "three";

const COUNT = 40;
/** Seconds the egg cluster takes to pop outward and fade. */
export const HATCH_S = 2.5;
const EGG_R = 0.0012;

/** The egg cluster a larva hatches from: ~40 small translucent amber eggs that pop outward and fade. */
export class HatchBurst {
  private mesh: THREE.InstancedMesh;
  private mat = new THREE.MeshStandardMaterial({ color: 0xe8c86a, emissive: 0x4a3510, roughness: 0.25, transparent: true, opacity: 0.6, depthWrite: false });
  private origin = new THREE.Vector3();
  private dirs: THREE.Vector3[] = [];
  private offs: THREE.Vector3[] = [];
  private t0 = 0;
  private active = false;
  private tmp = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(EGG_R, 10, 8), this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    for (let i = 0; i < COUNT; i++) {
      this.offs.push(new THREE.Vector3());
      this.dirs.push(new THREE.Vector3());
    }
  }

  start(pos: { x: number; y: number; z: number }, timeS: number): void {
    this.origin.set(pos.x, pos.y, pos.z);
    this.t0 = timeS;
    this.active = true;
    for (let i = 0; i < COUNT; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      this.dirs[i]!.copy(d).multiplyScalar(0.03 + Math.random() * 0.05); // pop distance (m)
      this.offs[i]!.copy(d).multiplyScalar(0.004 + Math.random() * 0.012); // packed cluster
    }
  }

  update(timeS: number): void {
    const k = (timeS - this.t0) / HATCH_S;
    if (!this.active || k < 0 || k >= 1) {
      this.active = this.active && k < 1;
      this.mesh.visible = this.active;
      return;
    }
    this.mesh.visible = true;
    const pop = 1 - (1 - Math.min(1, k * 2.2)) ** 3; // fast out, then drift
    this.mat.opacity = 0.6 * Math.min(1, (1 - k) * 2.5);
    for (let i = 0; i < COUNT; i++) {
      const o = this.offs[i]!, d = this.dirs[i]!;
      this.tmp.position.set(this.origin.x + o.x + d.x * pop, this.origin.y + o.y + d.y * pop + k * 0.01, this.origin.z + o.z + d.z * pop);
      this.tmp.scale.setScalar(1 + 0.4 * pop);
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
