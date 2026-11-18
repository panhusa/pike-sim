import { calibrate, stickToInput, tiltToRates, type TiltCal } from "./tilt";

export type ControlMode = "tilt" | "joystick";
/** `level`: no pitch control (joystick), the caller steers the pike back to level instead. */
export interface TouchInput { yawRate: number; pitchRate: number; throttle: number; burst: boolean; rest: boolean; level: boolean }
/** What the joystick needs to turn screen directions into a heading. */
export interface StickContext {
  yaw: number;
  pitch: number;
  camYaw: number;
}
export interface TouchControls {
  read(ctx?: StickContext): TouchInput;
  setStrikeReady(on: boolean): void;
  recentre(): void;
  dispose(): void;
}

const KEY = "pike.controls.v2"; // v2: joystick became the default (v1 defaulted to tilt)
const SHORT_PRESS_MS = 250;

export const isTouchDevice = (): boolean => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export function loadControlMode(): ControlMode {
  try {
    return localStorage.getItem(KEY) === "tilt" ? "tilt" : "joystick";
  } catch {
    return "joystick";
  }
}
export function saveControlMode(m: ControlMode): void {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}

// iOS gates deviceorientation behind a prompt that must start inside a tap handler.
export function requestMotionPermission(): Promise<boolean> {
  const D = (typeof DeviceOrientationEvent === "undefined" ? undefined : DeviceOrientationEvent) as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (!D || typeof D.requestPermission !== "function") return Promise.resolve(true);
  return D.requestPermission().then((r) => r === "granted", () => false);
}

const screenAngle = (): number => screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

export function mountTouchControls(
  root: HTMLElement,
  opts: { mode: ControlMode; onPause(): void; onCamera?(): void; permission?: Promise<boolean> },
): TouchControls {
  let mode = opts.mode;
  const layer = el("div", "touch-layer");
  const note = el("div", "touch-note");
  layer.append(note);

  // --- tilt state ---
  let cal: TiltCal | null = null;
  let lastBeta = 0;
  let lastGamma = 0;
  let gotEvent = false;
  let tilt = { yawRate: 0, pitchRate: 0 };
  const retilt = (): void => {
    if (cal) tilt = tiltToRates(lastBeta, lastGamma, cal);
  };
  const onOrient = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;
    gotEvent = true;
    lastBeta = e.beta;
    lastGamma = e.gamma;
    cal ??= calibrate(lastBeta, lastGamma, screenAngle());
    retilt();
  };
  const recentre = (): void => {
    cal = gotEvent ? calibrate(lastBeta, lastGamma, screenAngle()) : null;
    tilt = { yawRate: 0, pitchRate: 0 };
  };

  // --- joystick state ---
  const stick = el("div", "touch-stick");
  const knob = el("div", "touch-knob");
  stick.append(knob);
  let stickPointer = -1;
  let stickVec = { x: 0, y: 0 };
  const moveStick = (e: PointerEvent): void => {
    const r = stick.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - (r.left + R)) / R;
    let y = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    stickVec = { x, y };
    knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
  };
  const endStick = (): void => {
    stickPointer = -1;
    stickVec = { x: 0, y: 0 };
    knob.style.transform = "";
  };
  stick.addEventListener("pointerdown", (e) => {
    stickPointer = e.pointerId;
    stick.setPointerCapture?.(e.pointerId);
    moveStick(e);
  });
  stick.addEventListener("pointermove", (e) => {
    if (e.pointerId === stickPointer) moveStick(e);
  });
  for (const t of ["pointerup", "pointercancel"] as const) stick.addEventListener(t, (e) => e.pointerId === stickPointer && endStick());

  // --- buttons ---
  const hold = (b: HTMLElement, on: (e: PointerEvent) => void, off: () => void): void => {
    let id = -1;
    b.addEventListener("pointerdown", (e) => {
      id = e.pointerId;
      b.setPointerCapture?.(e.pointerId);
      b.classList.add("down");
      on(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      b.classList.remove("down");
      off();
    };
    b.addEventListener("pointerup", end);
    b.addEventListener("pointercancel", end);
  };
  const swim = el("div", "touch-btn touch-swim", "Swim");
  let swimSince = -1;
  let swimLow = false;
  hold(swim, (e) => {
    const r = swim.getBoundingClientRect();
    swimLow = e.clientY > r.top + r.height / 2;
    swimSince = performance.now();
  }, () => (swimSince = -1));
  const strike = el("div", "touch-btn touch-strike", "Strike");
  let burst = false;
  hold(strike, () => (burst = true), () => undefined);
  const rest = el("div", "touch-btn touch-rest", "Rest");
  let restHeld = false;
  hold(rest, () => (restHeld = true), () => (restHeld = false));
  // depth buttons (joystick mode): hold to rise or dive, let go to level out
  let vertical: -1 | 0 | 1 = 0;
  const rise = el("div", "touch-btn touch-rise", "\u25B2");
  const dive = el("div", "touch-btn touch-dive", "\u25BC");
  hold(rise, () => (vertical = 1), () => vertical === 1 && (vertical = 0));
  hold(dive, () => (vertical = -1), () => vertical === -1 && (vertical = 0));
  const recentreBtn = el("div", "touch-btn touch-recentre", "Recentre");
  recentreBtn.addEventListener("pointerdown", () => recentre());
  const pauseBtn = el("div", "touch-btn touch-pause", "Pause");
  pauseBtn.addEventListener("pointerdown", () => opts.onPause());
  const camBtn = el("div", "touch-btn touch-cam", "Cam");
  camBtn.addEventListener("pointerdown", () => opts.onCamera?.());
  layer.append(swim, strike, rest, recentreBtn, pauseBtn, camBtn, rise, dive, stick);

  const applyMode = (): void => {
    layer.classList.toggle("mode-joystick", mode === "joystick");
    layer.classList.toggle("mode-tilt", mode === "tilt");
  };
  const timers: number[] = [];
  let disposed = false;
  const toJoystick = (msg: string): void => {
    if (disposed) return;
    mode = "joystick";
    note.textContent = msg;
    applyMode();
    timers.push(window.setTimeout(() => (note.textContent = ""), 6000));
  };
  const armSensorTimeout = (): void => {
    timers.push(window.setTimeout(() => !gotEvent && mode === "tilt" && toJoystick("No motion sensor detected: using the joystick."), 1000));
  };
  applyMode();

  const onRotate = (): void => {
    cal = null; // next orientation event calibrates in the new screen frame
    tilt = { yawRate: 0, pitchRate: 0 };
  };
  if (mode === "tilt") {
    addEventListener("deviceorientation", onOrient);
    addEventListener("orientationchange", onRotate);
    if (opts.permission) {
      // the sensor timeout only starts once the user has answered the permission prompt
      opts.permission.then((ok) => (disposed ? undefined : ok ? armSensorTimeout() : toJoystick("Motion access denied: using the joystick.")));
    } else armSensorTimeout();
  }
  root.append(layer);

  return {
    read(ctx?: StickContext): TouchInput {
      let yawRate = 0;
      let pitchRate = 0;
      let throttle = 0;
      if (mode === "tilt") {
        ({ yawRate, pitchRate } = tilt);
        if (swimSince >= 0) throttle = swimLow || performance.now() - swimSince < SHORT_PRESS_MS ? 0.25 : 1;
      } else if (ctx) ({ yawRate, pitchRate, throttle } = stickToInput(stickVec.x, stickVec.y, ctx, ctx.camYaw, vertical));
      const out = { yawRate, pitchRate, throttle, burst, rest: restHeld, level: mode === "joystick" && !ctx };
      burst = false;
      return out;
    },
    setStrikeReady: (on) => strike.classList.toggle("ready", on),
    recentre,
    dispose(): void {
      removeEventListener("deviceorientation", onOrient);
      removeEventListener("orientationchange", onRotate);
      disposed = true;
      timers.forEach(clearTimeout);
      layer.remove();
    },
  };
}
