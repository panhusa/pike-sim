const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * "Up" (minus gravity) as a unit vector in the screen frame: x to the screen's right, y to its top,
 * z out of the screen. From the W3C device rotation R = Rz(alpha)·Rx(beta)·Ry(gamma), up in device
 * coordinates is the third row of R: (-cos b·sin g, sin b, cos b·cos g). Alpha (compass heading)
 * drops out, so only beta and gamma are needed. The screen frame is the device frame turned by the
 * screen angle (counter-clockwise device rotation, screen.orientation.angle).
 */
export function screenUp(beta: number, gamma: number, screenAngle: number): { x: number; y: number; z: number } {
  const b = beta * RAD;
  const g = gamma * RAD;
  const a = screenAngle * RAD;
  const ux = -Math.cos(b) * Math.sin(g);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  return { x: ux * Math.cos(a) - uy * Math.sin(a), y: ux * Math.sin(a) + uy * Math.cos(a), z: uz };
}

/**
 * Pose angles from the up vector, continuous through vertical in every screen orientation:
 * roll = how far the screen's right edge is below horizontal (asin of up.x, never wraps),
 * pitch = how far the screen top is tilted back from flat (0 flat, 90 upright, >90 leaning toward you).
 */
function pose(beta: number, gamma: number, screenAngle: number): { roll: number; pitch: number } {
  const u = screenUp(beta, gamma, screenAngle);
  return { roll: Math.asin(Math.max(-1, Math.min(1, -u.x))) * DEG, pitch: Math.atan2(u.y, u.z) * DEG };
}

export interface TiltCal {
  roll0: number;
  pitch0: number;
  screenAngle: number;
}

/** The current pose becomes neutral for the given screen angle. */
export function calibrate(beta: number, gamma: number, screenAngle: number): TiltCal {
  const a = ((screenAngle % 360) + 360) % 360;
  const p = pose(beta, gamma, a);
  return { roll0: p.roll, pitch0: p.pitch, screenAngle: a };
}

const wrap = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

function rate(deg: number, dead: number, full: number): number {
  const m = Math.abs(deg);
  if (m <= dead) return 0;
  return Math.sign(deg) * Math.min(1, (m - dead) / (full - dead));
}

// Positive yawRate = right (same as mouse-right): the screen's right edge tilted down.
// Negative pitchRate = dive: the top of the screen tilted away from you (toward flat).
export function tiltToRates(beta: number, gamma: number, cal: TiltCal, deadDeg = 4, fullDeg = 25): { yawRate: number; pitchRate: number } {
  const p = pose(beta, gamma, cal.screenAngle);
  return { yawRate: rate(p.roll - cal.roll0, deadDeg, fullDeg), pitchRate: rate(wrap(p.pitch - cal.pitch0), deadDeg, fullDeg) };
}

/**
 * Joystick, camera-relative: the stick points where to swim on screen (up = away from the camera,
 * left/right = that way, down = turn around); distance from centre sets speed smoothly. Depth is
 * separate: `vertical` +1 (Rise held) / -1 (Dive held) / 0 aims the nose up, down or level.
 * Yaw convention: increasing yaw turns right, and atan2(z, x) gives a heading.
 */
export function stickToInput(
  dx: number,
  dy: number,
  pike: { yaw: number; pitch: number },
  camYaw: number,
  vertical: -1 | 0 | 1,
): { yawRate: number; pitchRate: number; throttle: number } {
  const r = Math.min(1, Math.hypot(dx, dy));
  const pitchRate = Math.max(-1, Math.min(1, (vertical * 0.6 - pike.pitch) * 3));
  if (r < STICK_DEAD) return { yawRate: 0, pitchRate, throttle: vertical !== 0 ? 0.35 : 0 }; // rising/diving needs a little way on
  const want = camYaw + Math.atan2(dx, -dy);
  const err = Math.atan2(Math.sin(want - pike.yaw), Math.cos(want - pike.yaw));
  const yawRate = Math.max(-1, Math.min(1, err * 2.5));
  const speed = 0.15 + 0.85 * ((r - STICK_DEAD) / (1 - STICK_DEAD));
  return { yawRate, pitchRate, throttle: speed * (Math.abs(err) > 1.8 ? 0.55 : 1) }; // ease off to turn round tightly
}
export const STICK_DEAD = 0.12;
