import * as THREE from "three";
import type { PikeState } from "../sim/pike";
import type { World } from "../sim/world";

/** Chase distance in metres: 3.5 body lengths, never closer than 0.6 m. */
export const chaseDistance = (lengthCm: number): number => Math.max(0.6, (3.5 * lengthCm) / 100);

export type CameraMode = "chase" | "close" | "wide" | "side" | "cinematic" | "eye";
export const CAMERA_MODES: CameraMode[] = ["chase", "close", "wide", "side", "cinematic", "eye"];
export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: "Chase",
  close: "Close",
  wide: "Wide",
  side: "Side",
  cinematic: "Cinematic",
  eye: "Pike's eye",
};

interface ModeSpec {
  /** distance in body lengths, and the floor in metres */
  distBL: number;
  minM: number;
  /** camera elevation above the body axis, radians (positive = above, looking down) */
  elev: number;
  /** horizontal angle from straight behind, radians (+ = to the fish's left) */
  angle: number;
  /** how fast the camera's heading follows the fish's (1/s); low = the fish swings in frame on turns */
  yawFollow: number;
  /** position smoothing (1/s) */
  posFollow: number;
  /** look-at point ahead of the head, body lengths */
  lead: number;
  /** follows mouse free-look */
  freeLook: boolean;
}

const SPECS: Record<Exclude<CameraMode, "eye">, ModeSpec> = {
  chase: { distBL: 3.2, minM: 0.6, elev: 0.22, angle: 0.6, yawFollow: 2.5, posFollow: 7, lead: 1.2, freeLook: true },
  close: { distBL: 1.5, minM: 0.3, elev: 0.1, angle: 0.5, yawFollow: 4, posFollow: 12, lead: 0.4, freeLook: true },
  wide: { distBL: 6, minM: 1.5, elev: 0.5, angle: 0.15, yawFollow: 1.2, posFollow: 4, lead: 2, freeLook: false },
  side: { distBL: 2.6, minM: 0.5, elev: 0.08, angle: Math.PI / 2, yawFollow: 1.5, posFollow: 4, lead: 0.2, freeLook: false },
  cinematic: { distBL: 3, minM: 0.55, elev: 0.18, angle: 0, yawFollow: 0.8, posFollow: 2.5, lead: 0, freeLook: false },
};

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Multi-mode camera: chase (lagging, so the fish moves in frame), close, wide, side, cinematic orbit, pike's eye. */
export class CameraRig {
  mode: CameraMode = "chase";
  /** distance multiplier (mouse wheel / pinch) */
  zoom = 1;
  /** extra orbit angle around the fish (Q/E) */
  orbit = 0;
  private pos = new THREE.Vector3();
  private want = new THREE.Vector3();
  private target = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private camYaw = 0;
  private cineAngle = 0;
  private init = false;
  private ceil = -0.12;

  constructor(private cam: THREE.PerspectiveCamera) {}

  get position(): THREE.Vector3 {
    return this.pos;
  }

  /**
   * The heading the joystick treats as "up": the pike's smoothed heading, without the camera's side
   * angle or orbit. Using the camera's own forward would make a side-on camera turn the pike, the
   * camera follow, and the pike spiral.
   */
  get heading(): number {
    return this.camYaw;
  }

  /** The player's own mesh is hidden in the eye view. */
  get hidesPlayer(): boolean {
    return this.mode === "eye";
  }

  setMode(m: CameraMode): void {
    this.mode = m;
    this.init = false; // snap, so the switch reads as a cut
  }

  next(): CameraMode {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]!);
    return this.mode;
  }

  update(player: PikeState, look: { yaw: number; pitch: number }, world: World, dt: number): void {
    const L = player.lengthCm / 100;
    const p = player.pos;
    const fx = Math.cos(player.yaw);
    const fz = Math.sin(player.yaw);

    if (this.mode === "eye") {
      const yaw = player.yaw + look.yaw;
      const pitch = Math.max(-1.2, Math.min(1.2, player.pitch + look.pitch));
      this.pos.set(p.x + fx * L * 0.38, p.y + L * 0.03, p.z + fz * L * 0.38);
      this.cam.position.copy(this.pos);
      this.lookAt.set(this.pos.x + Math.cos(yaw) * Math.cos(pitch), this.pos.y + Math.sin(pitch), this.pos.z + Math.sin(yaw) * Math.cos(pitch));
      this.cam.lookAt(this.lookAt);
      this.camYaw = player.yaw;
      this.init = false;
      return;
    }

    const s = SPECS[this.mode];
    const wantYaw = player.yaw + (s.freeLook ? look.yaw : 0);
    if (!this.init) this.camYaw = wantYaw;
    else this.camYaw += wrap(wantYaw - this.camYaw) * (1 - Math.exp(-s.yawFollow * dt));
    if (this.mode === "cinematic") this.cineAngle += dt * 0.18;

    // portrait phones: a narrow screen, so come in closer to keep the fish a decent size
    const portrait = this.cam.aspect < 1 ? 0.65 : 1;
    const dist = Math.max(s.minM * portrait, s.distBL * L) * this.zoom * portrait;
    const angle = s.angle + this.orbit + (this.mode === "cinematic" ? this.cineAngle : 0);
    const heading = this.camYaw + Math.PI + angle; // direction from fish to camera
    const pitchLook = s.freeLook ? Math.max(-0.9, Math.min(0.9, look.pitch * 0.8 + player.pitch * 0.4)) : 0;
    const elev = s.elev - pitchLook;
    const bob = this.mode === "cinematic" ? 0.12 * Math.sin(this.cineAngle * 1.7) : 0;
    this.want.set(
      p.x + Math.cos(heading) * Math.cos(elev + bob) * dist,
      p.y + Math.sin(elev + bob) * dist,
      p.z + Math.sin(heading) * Math.cos(elev + bob) * dist,
    );
    if (!this.init) {
      this.pos.copy(this.want);
      this.target.set(p.x, p.y, p.z);
      this.init = true;
    }
    this.pos.lerp(this.want, 1 - Math.exp(-s.posFollow * dt));
    // keep the camera in the water column and inside the shore
    const bottom = world.bottomY(this.pos.x, this.pos.z) + 0.15;
    // out of the water during a leap the camera may follow it up; back under as soon as it splashes in
    const ceilWant = player.pos.y > -0.05 ? 2.5 : -0.12;
    this.ceil += (ceilWant - this.ceil) * (1 - Math.exp(-(ceilWant > this.ceil ? 6 : 14) * dt));
    this.pos.y = Math.min(this.ceil, Math.max(bottom, this.pos.y));
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = world.size / 2 - 1;
    if (r > maxR) {
      this.pos.x *= maxR / r;
      this.pos.z *= maxR / r;
    }
    this.cam.position.copy(this.pos);
    // look ahead of the head in the swimming direction, smoothed: on turns the fish slides off-centre
    const lead = s.lead * L * Math.min(1.5, 0.4 + player.speed / Math.max(L, 0.05) / 4);
    this.lookAt.set(p.x + fx * lead, p.y, p.z + fz * lead);
    this.target.lerp(this.lookAt, 1 - Math.exp(-4 * dt));
    this.cam.lookAt(this.target);
  }
}

/** Backwards-compatible name used by older code and tests. */
export { CameraRig as ChaseCamera };
