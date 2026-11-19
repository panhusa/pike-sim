import { autoQuality, initialGfx, loadGfx, saveGfx, type GfxSettings } from "./render/gfxSettings";
import { PikeScene } from "./render/scene";
import { CAMERA_LABEL, CAMERA_MODES, type CameraMode } from "./render/camera";
import { defaultParams } from "./sim/params";
import { angleDiff, clamp } from "./sim/math";
import { continueAsOffspring, lifeSummary, offspringOptions } from "./sim/lifecycle";
import { MILESTONE_TEXT } from "./sim/milestones";
import { condition, hunger, tooFullFor, type PikeInput, type PikeState } from "./sim/pike";
import { restBlockers, restFor, type RestBlocker } from "./sim/rest";
import { parseSave, toSaveFile } from "./sim/save";
import { Minimap } from "./ui/minimap";
import { presetSettings, type SimSettings } from "./sim/settings";
import type { MapShape } from "./sim/world";
import { placePlayerNearPrey, Simulation, type MissReason, type SimEvent } from "./sim/simulation";
import { lungeTargets, type LungeTarget } from "./sim/lunge";
import { AdaptiveResolution, stepPlan } from "./ui/frameBudget";
import { GameSession } from "./ui/gameSession";
import { nextHint, HINT_TEXT, TOUCH_HINT_TEXT } from "./ui/hints";
import { computeMarks, renderMarks } from "./ui/markers";
import { BurstOutcomes } from "./ui/outcome";
import { hideOverlay, showDeath, showOnlineDeath, showPause, showStart, type NewLifeConfig, type SaveSlot } from "./ui/screens";
import { NetHost } from "./net/host";
import { awaitWelcome, NetGuest } from "./net/guest";
import { cleanName, makeRoomCode, normaliseRoomCode, PROTOCOL_VERSION } from "./net/protocol";
import { hostRoom, joinRoom } from "./net/transport";
import { isTouchDevice, loadControlMode, mountTouchControls, requestMotionPermission, saveControlMode, type ControlMode, type TouchControls, type TouchInput } from "./ui/touch";
import { persistDeath, persistNewLife } from "./ui/policy";
import { browserStorage, createSaveStore } from "./ui/storage";
import { GamepadInput, type PadState } from "./ui/gamepad";
import { openPadSetup, padSetupOpen } from "./ui/padSetup";
import { SessionRecorder } from "./ui/recorder";
import { EGG_LENGTH_CM, placeInWeedBed, startLengthCm } from "./sim/nursery";

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("c") as HTMLCanvasElement;
const overlay = $("overlay");
const query = new URLSearchParams(location.search);

// --- session recorder: F9 (or ?rec=1) records video + a JSON log of inputs and play, F9 again saves both ---
const rec = new SessionRecorder();
const recMouse = { dx: 0, dy: 0 };
let recMode = "";
let recLastInput: PikeInput = { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
const recBadge = Object.assign(document.createElement("div"), { textContent: "● REC  (F9 to stop and save)" });
recBadge.style.cssText = "position:fixed;left:50%;bottom:8px;transform:translateX(-50%);color:#ff5b4f;font:600 12px system-ui;text-shadow:0 1px 3px #000;pointer-events:none;display:none;z-index:25";
document.body.append(recBadge);
function recStart(): void {
  if (rec.active) return;
  const s = sim;
  rec.start(canvas, {
    url: location.href,
    userAgent: navigator.userAgent,
    screen: [innerWidth, innerHeight, devicePixelRatio],
    touch: touchOn,
    pad: GamepadInput.first()?.id ?? null,
    gfx: { ...gfx },
    settings: s ? { ...s.settings } : null,
    mouseSens,
    invertMouse,
  });
  recBadge.style.display = "block";
  say("Recording: F9 to stop and save", 2500);
}
async function recStop(): Promise<void> {
  if (!rec.active) return;
  recBadge.style.display = "none";
  const r = await rec.stop();
  if (r) say(r.video ? "Saved pike-….json and .webm to Downloads" : "Saved pike-….json to Downloads (no video in this browser)", 4000);
}
addEventListener("error", (e) => rec.event("error", { message: e.message, at: `${e.filename}:${e.lineno}` }));
addEventListener("unhandledrejection", (e) => rec.event("error", { message: String(e.reason) }));
const debug = query.get("debug") === "1";
const store = createSaveStore(browserStorage());
// --- camera: C cycles modes, wheel zooms, Q/E orbit, V resets; the mode is remembered ---
const CAM_KEY = "pike.camera.v1";
function loadCameraMode(): CameraMode {
  try {
    const m = localStorage.getItem(CAM_KEY) as CameraMode | null;
    return m && CAMERA_MODES.includes(m) ? m : "chase";
  } catch {
    return "chase";
  }
}
function showCameraLabel(): void {
  if (view) $("cam").textContent = `Camera: ${CAMERA_LABEL[view.rig.mode]}  (C)`;
}
function nextCamera(): void {
  if (!view) return;
  const m = view.rig.next();
  try {
    localStorage.setItem(CAM_KEY, m);
  } catch {
    /* storage blocked */
  }
  showCameraLabel();
  say(`Camera: ${CAMERA_LABEL[m]}`, 1500);
  rec.event("camera", { mode: m });
}
addEventListener(
  "wheel",
  (e) => {
    if (!view || mode !== "playing") return;
    view.rig.zoom = clamp(view.rig.zoom * Math.exp(e.deltaY * 0.0012), 0.45, 2.8);
  },
  { passive: true },
);
const storedGfx = loadGfx(browserStorage());
let gfx = initialGfx(storedGfx, window.matchMedia?.("(pointer: coarse)").matches ?? false);
/** Apply and remember a graphics change. An automatic quality (touch default, fps drop) is never saved as a choice. */
function changeGfx(next: GfxSettings): void {
  gfx = next;
  saveGfx(browserStorage(), next.qualityChosen ? next : { ...next, quality: storedGfx.quality });
  view?.setGfx(next);
  if (view) adaptiveRes = new AdaptiveResolution(view.renderer.getPixelRatio());
}
const gfxPref = {
  get style() {
    return gfx.style;
  },
  get quality() {
    return gfx.quality;
  },
  onStyle: (style: GfxSettings["style"]) => changeGfx({ ...gfx, style }),
  onQuality: (quality: GfxSettings["quality"]) => changeGfx({ ...gfx, quality, qualityChosen: true }),
};
const game = new GameSession(canvas);
addEventListener("pointerdown", () => game.audio.unlock());
addEventListener("touchstart", () => game.audio.unlock(), { passive: true });

// --- multiplayer: null in single player ---
type Net = { kind: "host"; host: NetHost } | { kind: "guest"; guest: NetGuest };
let net: Net | null = null;
const NAME_KEY = "pike.name.v1";
function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? `Pike${Math.floor(100 + Math.random() * 900)}`;
  } catch {
    return "Pike";
  }
}
let myName = loadName();
function saveName(n: string): void {
  myName = cleanName(n);
  try {
    localStorage.setItem(NAME_KEY, myName);
  } catch {
    /* storage blocked */
  }
}

type Mode = "menu" | "playing" | "paused" | "dead";
let mode: Mode = "menu";
let sim: Simulation | null = null;
let view: PikeScene | null = null;
let pendingPermission: Promise<boolean> | undefined;
let eventCursor = 0;
let lastDay = 0;

// --- input: the mouse sets a desired heading, the body turns toward it at its own rate ---
const INVERT_KEY = "pike.invertMouse.v1";
let invertMouse = (() => {
  try {
    return localStorage.getItem(INVERT_KEY) === "1";
  } catch {
    return false;
  }
})();
/** Mouse sensitivity, relative to the original 0.0025 rad/px (playtest: too twitchy, so the default is lower). */
const SENS_KEY = "pike.mouseSens.v1";
const MOUSE_RAD_PER_PX = 0.0025;
let mouseSens = (() => {
  try {
    const v = Number(localStorage.getItem(SENS_KEY));
    return v >= 0.2 && v <= 2 ? v : 0.6;
  } catch {
    return 0.6;
  }
})();
/** How far the wanted heading may run ahead of the body (rad): a big flick no longer queues a long spin. */
const MAX_LEAD = 0.8;
/** Turn command per radian of heading error (was 3: snappy but jerky). */
const STEER_GAIN = 2.2;
/** A/D or Left/Right arrow turn speed of the wanted heading (rad/s). */
const KB_TURN_RAD_S = 1.6;
/** Within this height over the lakebed (m) a dive flattens out, so the pike glides along the bottom instead of ploughing into it. */
const BOTTOM_ASSIST_M = 0.6;
/** Body attitude at the last input step: a lunge turns the body, and the wanted heading turns with it (mouse input kept). */
/** Egg start: the pike waits in its egg until the player wriggles (strike / swim presses) or time runs out. */
const EGG_TAPS = 6;
const EGG_MAX_S = 20;
let egg: { taps: number; t: number } | null = null;
let lastBodyYaw = 0;
let lastBodyPitch = 0;
/** Keyboard / gamepad pitch: hold to dive or rise (up to this angle), the pike levels out again on release. */
const HOLD_PITCH = 0.75;
const HOLD_PITCH_RATE = 2;
const LEVEL_RATE = 1.5;
/** true while the pitch comes from keys or a stick (it then levels out on release); mouse movement clears it */
let pitchHeld = false;
const gamepad = new GamepadInput();
let pad: PadState = gamepad.read([]);
const mousePref = {
  get invertY() {
    return invertMouse;
  },
  get sens() {
    return mouseSens;
  },
  onSens(v: number) {
    mouseSens = v;
    try {
      localStorage.setItem(SENS_KEY, String(v));
    } catch {
      /* storage blocked: applies for this visit only */
    }
  },
  onChange(v: boolean) {
    invertMouse = v;
    try {
      localStorage.setItem(INVERT_KEY, v ? "1" : "0");
    } catch {
      /* storage blocked: applies for this visit only */
    }
  },
};
const keys = new Set<string>();
let wantYaw = 0;
let wantPitch = 0;
let burstQueued = false;
let restLatch = false; // after a rest stop, R must be released before resting again
const TIME_SCALES = [1, 10, 60];
let timeScaleIdx = 0;

// --- minimap and controls help ---
const minimap = new Minimap(document.getElementById("minimap") as HTMLCanvasElement);
const keysPanel = document.getElementById("keys")!;
function toggleKeys(show = !keysPanel.classList.contains("show")): void {
  keysPanel.classList.toggle("show", show); // an overlay over the running game; H or a tap closes it
}
document.getElementById("helpBtn")!.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleKeys();
});
keysPanel.addEventListener("click", () => toggleKeys(false));
let shownMode = "";

addEventListener("keydown", (e) => {
  keys.add(e.code);
  game.audio.unlock();
  if (e.code === "KeyH") toggleKeys();
  if (e.code === "F9") {
    e.preventDefault();
    if (rec.active) void recStop();
    else recStart();
  }
  if (e.code === "KeyN") say(minimap.toggle() ? "Minimap on (N)" : "Minimap off (N)");
  if (e.code === "KeyM") say(game.audio.toggleMute() ? "Sound off (M)" : "Sound on (M)");
  if (e.code === "KeyC" && mode === "playing") nextCamera();
  if (e.code === "KeyV" && view) {
    view.rig.orbit = 0;
    view.rig.zoom = 1;
  }
  if (egg && mode === "playing" && !e.repeat && (e.code === "KeyW" || e.code === "ArrowUp" || e.code === "Space")) egg.taps++;
  else if (e.code === "Space") burstQueued = true;
  if (e.code === "KeyT" && debug) timeScaleIdx = (timeScaleIdx + 1) % TIME_SCALES.length;
  if (e.code === "Escape") pause();
});
addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "KeyR") restLatch = false;
});
canvas.addEventListener("mousedown", () => {
  if (egg && mode === "playing") egg.taps++;
  else if (mode === "playing" && !touchOn) burstQueued = true;
});
addEventListener("mousemove", (e) => {
  if (mode !== "playing" || document.pointerLockElement !== canvas) return;
  const k = MOUSE_RAD_PER_PX * mouseSens;
  const pl = sim?.player();
  wantYaw += e.movementX * k;
  recMouse.dx += e.movementX;
  recMouse.dy += e.movementY;
  if (e.movementY) pitchHeld = false;
  if (pl) wantYaw = pl.yaw + clamp(angleDiff(wantYaw, pl.yaw), -MAX_LEAD, MAX_LEAD);
  wantPitch = clamp(wantPitch - e.movementY * k * (invertMouse ? -1 : 1), -0.9, 0.9);
});
canvas.addEventListener("click", () => {
  if (mode === "playing" && !touchOn && document.pointerLockElement !== canvas) lockPointer();
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== canvas && !touchOn) pause();
});

// --- phone controls (tilt / joystick); desktop path is untouched when touchOn is false ---
const touchOn = isTouchDevice();
/** Pointer lock needs a user gesture; after an async online join there is none, so a refusal is fine (a click locks). */
function lockPointer(): void {
  try {
    const r = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    r?.catch?.(() => undefined);
  } catch {
    /* refused without a gesture */
  }
}
let controlMode: ControlMode = loadControlMode();
let touch: TouchControls | null = null;
let touchIn: TouchInput | null = null;
const controlsPref = touchOn ? { get mode() { return controlMode; }, onChange: (m: ControlMode) => ((controlMode = m), saveControlMode(m)) } : undefined;
function mountTouch(permission?: Promise<boolean>): void {
  if (!touchOn) return;
  touch?.dispose();
  touch = mountTouchControls($("touch"), { mode: controlMode, onPause: pause, onCamera: () => nextCamera(), permission });
  document.body.classList.add("touch");
}
const motionPermission = (): Promise<boolean> | undefined => (touchOn && controlMode === "tilt" ? requestMotionPermission() : undefined);

/** The pike's attitude and the camera's tracked heading, so the joystick steers relative to the view. */
function stickContext(): { yaw: number; pitch: number; camYaw: number } | undefined {
  const pl = sim?.player();
  if (!pl || !view) return undefined;
  return { yaw: pl.yaw, pitch: pl.pitch, camYaw: view.rig.heading };
}

function playerInput(pl: PikeState): PikeInput {
  return (recLastInput = playerInputRaw(pl));
}

function playerInputRaw(pl: PikeState): PikeInput {
  if (egg) {
    if (touchIn?.burst) egg.taps++; // keys, mouse and pad count on the press itself
    burstQueued = false;
    if (touchIn) touchIn.burst = false;
    return { throttle: 0, yawRate: 0, pitchRate: 0, burst: false };
  }
  const kbThrottle = Math.max(pad.throttle, keys.has("KeyW") || keys.has("ArrowUp") ? (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 0.25 : 1) : 0);
  const burst = burstQueued || !!touchIn?.burst;
  burstQueued = false;
  if (touchIn) touchIn.burst = false; // edge-triggered: one strike per press, not one per sim step
  if (touchIn) {
    // joystick: no pitch axis, so the pike levels out (as the desktop mouse does at wantPitch 0)
    const pitchRate = touchIn.level ? clamp(-pl.pitch * 3, -1, 1) : touchIn.pitchRate;
    // keep the camera lead (render uses wantYaw/wantPitch) consistent with the touch-driven turn
    // tilt: the camera leads into the turn; joystick: the stick is camera-relative, so a leading camera would chase itself
    const lead = controlMode === "joystick" ? 0 : 1 / 3;
    wantYaw = pl.yaw + touchIn.yawRate * lead;
    wantPitch = clamp(pl.pitch + pitchRate * lead, -0.9, 0.9);
    return { throttle: Math.max(kbThrottle, touchIn.throttle), yawRate: touchIn.yawRate, pitchRate, burst };
  }
  if (pl.lockId !== null) {
    // a committed lunge steers the body; the wanted heading turns by the same amount, so the pike does not swing back
    // afterwards and mouse movement during the lunge is kept rather than thrown away
    wantYaw += angleDiff(pl.yaw, lastBodyYaw);
    wantPitch = clamp(wantPitch + pl.pitch - lastBodyPitch, -0.9, 0.9);
  }
  lastBodyYaw = pl.yaw;
  lastBodyPitch = pl.pitch;
  if (sim && wantPitch < 0) {
    const clear = pl.pos.y - sim.world.bottomY(pl.pos.x, pl.pos.z);
    if (clear < BOTTOM_ASSIST_M) wantPitch = Math.max(wantPitch, -0.9 * Math.max(0, clear - 0.15) / (BOTTOM_ASSIST_M - 0.15));
  }
  const throttle = kbThrottle;
  wantYaw = pl.yaw + clamp(angleDiff(wantYaw, pl.yaw), -MAX_LEAD, MAX_LEAD);
  return { throttle, yawRate: clamp(angleDiff(wantYaw, pl.yaw) * STEER_GAIN, -1, 1), pitchRate: clamp((wantPitch - pl.pitch) * STEER_GAIN, -1, 1), burst };
}

// --- HUD ---
const logEl = $("log");
function say(text: string, ms = 5000): void {
  const d = document.createElement("div");
  d.textContent = text;
  logEl.appendChild(d);
  setTimeout(() => d.remove(), ms);
  while (logEl.children.length > 6) logEl.firstChild?.remove();
}
const MISS_TEXT: Record<MissReason, string> = { evaded: "Missed: it dodged.", "too-big": "Too big to swallow.", full: "Too full to swallow.", "off-axis": "Off target." };
let pulseTimer = 0;
function pulseStomach(): void {
  const bar = $("stomachBar");
  bar.classList.add("pulse");
  clearTimeout(pulseTimer);
  pulseTimer = window.setTimeout(() => bar.classList.remove("pulse"), 400);
}
let outcomes = new BurstOutcomes();
function sayOutcome(e: SimEvent | null, s: Simulation): void {
  if (!e) return;
  if (e.type === "capture") {
    s.playerHintsDone = true;
    if (e.kind === "insect") say(`Snapped up an insect (+${e.grams.toFixed(1)} g)`);
    else say(`Caught a ${e.kind === "pike" ? "pike" : s.p.prey[e.kind].label.toLowerCase()} ${Math.round(e.lengthCm)} cm (+${Math.round(e.grams)} g)`);
    pulseStomach();
  } else if (e.type === "miss") say(MISS_TEXT[e.reason]);
  else if (e.type === "strike-empty") say("Nothing in range.");
}
function handleEvent(e: SimEvent, s: Simulation, pl: PikeState): void {
  if (view) game.event(e, s, pl, view);
  if (e.type === "milestone") return say(MILESTONE_TEXT[e.id]);
  if (!("pikeId" in e) || e.pikeId !== pl.id) return;
  sayOutcome(outcomes.push(e), s); // one line per burst: outcomes are buffered until the burst is over
}
/** Sim events about the player (or the hunter after them) go into the recording. */
function recSimEvent(e: Simulation["events"][number], pl: PikeState): void {
  const r = e as unknown as Record<string, unknown>;
  const mine = r.pikeId === pl.id || r.targetId === pl.id || e.type === "milestone";
  if (!mine) return;
  const { t, type: _type, ...rest } = r;
  rec.event(`sim-${e.type}`, { ...rest, simT: Math.round((t as number) * 100) / 100 });
}

function drainEvents(s: Simulation, pl: PikeState): void {
  for (; eventCursor < s.events.length; eventCursor++) {
    if (rec.active) recSimEvent(s.events[eventCursor]!, pl);
    handleEvent(s.events[eventCursor]!, s, pl);
  }
  if (s.events.length < eventCursor) eventCursor = s.events.length; // buffer was trimmed
  sayOutcome(outcomes.end(pl.alive && pl.burstTimeLeft > 0), s);
}

const BLOCKER_TEXT: Record<RestBlocker, string> = { dead: "", moving: "moving", "no-cover": "no cover", "rival-near": "large pike nearby" };
const SEASONS = { winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Autumn" } as const;
let stepMs = 0;
function updateHud(s: Simulation, pl: PikeState, restText: string): void {
  const p = s.paramsFor(pl);
  $("len").textContent = `${pl.lengthCm.toFixed(1)} cm`;
  $("wt").textContent = pl.weight >= 1000 ? `${(pl.weight / 1000).toFixed(2)} kg` : `${Math.round(pl.weight)} g`;
  $("age").textContent = `${pl.ageDays.toFixed(1)} days`;
  $("enTxt").textContent = `${Math.round(pl.energy)}%`;
  ($("enBar").firstElementChild as HTMLElement).style.width = `${(pl.energy / p.pike.energyMax) * 100}%`;
  const h = hunger(pl, p, s.env.tempC);
  $("hgTxt").textContent = condition(pl, p) < 0.8 ? "starving" : h > 0.6 ? "hungry" : h > 0.25 ? "peckish" : "full";
  ($("hungerBar").firstElementChild as HTMLElement).style.width = `${clamp(h, 0, 1) * 100}%`;
  $("stomTxt").textContent = `${Math.round(pl.stomachG)} g`;
  ($("stomachBar").firstElementChild as HTMLElement).style.width = `${clamp(pl.stomachG / (pl.weight * p.pike.stomachMaxFracOfWeight), 0, 1) * 100}%`;
  $("spd").textContent = `${(pl.speed / (pl.lengthCm / 100)).toFixed(1)} BL/s`;
  const hh = Math.floor(s.env.dayFraction * 24);
  const mm = Math.floor((s.env.dayFraction * 24 - hh) * 60);
  const dbg = debug
    ? `  ·  ×${TIME_SCALES[timeScaleIdx]}  ·  step ${stepMs.toFixed(2)} ms  ·  ${fpsShown.toFixed(0)} fps  ·  ${view?.drawCalls ?? 0} calls  ·  ${gfx.quality}`
    : "";
  $("clock").textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${dbg}`;
  $("env").textContent = `${SEASONS[s.env.season]} · day ${s.env.dayOfYear} · ${s.env.tempC.toFixed(1)} °C · vis ${s.env.visibilityM.toFixed(1)} m`;
  $("rest").textContent = restText;
}

// --- saving ---
let lastSaveWarn = -Infinity;
function autosave(daily = false): void {
  if (net || !sim || !sim.player()?.alive) return; // a shared lake is never saved
  const text = toSaveFile(sim, new Date());
  let ok = store.save(text);
  if (daily && sim.settings.deathMode === "rewind") ok = store.saveRewind(text) && ok;
  if (!ok) warnSaveFailed();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") autosave();
});
addEventListener("pagehide", () => autosave());

// --- life flow ---
function settingsFrom(c: NewLifeConfig): SimSettings {
  const base = presetSettings(c.preset === "custom" ? "natural" : c.preset, c.deathMode, defaultParams);
  const s = c.preset === "custom" ? { ...base, rivalCount: c.rivalCount, rivalSizeScale: c.rivalSizeScale, aggression: c.aggression } : base;
  return { ...s, map: c.map, chill: c.chill, big: true, growthMul: c.growthMul, startEgg: c.startEgg };
}

function warnSaveFailed(): void {
  if (!store.available || performance.now() - lastSaveWarn < 60000) return;
  lastSaveWarn = performance.now();
  say("Progress could not be saved");
}

function enter(next: Simulation): void {
  view?.dispose();
  sim = next;
  sim.arcade = true; // game feel for the player; the realistic model stays the default in tests
  view = new PikeScene(canvas, sim, gfx);
  view.rig.setMode(loadCameraMode());
  showCameraLabel();
  adaptiveRes = new AdaptiveResolution(view.renderer.getPixelRatio());
  fpsProbe = { acc: 0, frames: 0, done: false };
  const pl = sim.player()!;
  mountTouch(pendingPermission);
  pendingPermission = undefined;
  wantYaw = lastBodyYaw = pl.yaw;
  wantPitch = 0;
  lastBodyPitch = pl.pitch;
  eventCursor = sim.events.length;
  outcomes = new BurstOutcomes();
  game.authority = net?.kind !== "guest";
  game.enter(sim);
  document.body.classList.toggle("online", net !== null);
  lastDay = Math.floor(sim.time / sim.p.environment.dayLengthS);
  (window as unknown as { __pike: unknown }).__pike = { sim, view, player: pl };
  if (!pl.alive) return die(false, false);
  mode = "playing";
  hideOverlay(overlay);
  if (!touchOn) lockPointer();
  if (query.get("rec") === "1") recStart();
  egg = sim.settings.startEgg && pl.lengthCm <= EGG_LENGTH_CM + 1e-6 ? { taps: 0, t: 0 } : null;
  view.egg = egg ? { wobble: 0 } : null;
  if (egg) say("You are an egg in the weeds. Wriggle out: press Space or W (or ✕) a few times", 6000);
  rec.event("enter", { settings: { ...sim.settings }, lengthCm: pl.lengthCm, online: net?.kind ?? null });
}

/** Where a new human pike starts: an egg in a weed bed, or within sight of food. */
function placeStart(s: Simulation, pl: PikeState): void {
  if (!(s.settings.startEgg && placeInWeedBed(s.world, pl))) placePlayerNearPrey(s, 7, pl);
}

function newLife(settings: SimSettings, seed: number): void {
  const s = new Simulation({ seed, settings });
  const pl = s.addPlayer(startLengthCm(settings, s.p));
  s.arcade = true;
  placeStart(s, pl);
  enter(s);
  say(`You are a ${pl.sex} pike`);
  if (!persistNewLife(store, settings.deathMode, toSaveFile(s, new Date()))) warnSaveFailed();
}

// --- multiplayer flow ---
async function hostGame(name: string, map: MapShape = "lake", chill = true, growthMul = 1, startEgg = false): Promise<void> {
  saveName(name);
  let code = makeRoomCode();
  let t;
  try {
    t = await hostRoom(code);
  } catch {
    code = makeRoomCode(); // the code may be taken: one retry with a fresh one
    t = await hostRoom(code).catch((e: unknown) => {
      throw new Error(`Could not open a lake (${e instanceof Error ? e.message : "no connection"}). Check your internet connection.`);
    });
  }
  const s = new Simulation({ seed: Math.floor(Math.random() * 1e9), settings: { ...presetSettings("gentle", "permadeath", defaultParams), map, chill, big: true, growthMul, startEgg } });
  const hpl = s.addPlayer(startLengthCm(s.settings, s.p));
  s.arcade = true;
  placeStart(s, hpl);
  const host = new NetHost(s, t, code);
  host.hostName = myName;
  net = { kind: "host", host };
  pendingPermission = motionPermission();
  enter(s);
  say(`Your code is ${code}. Friends join with it.`, 12000);
}

async function joinGame(name: string, rawCode: string): Promise<void> {
  saveName(name);
  const code = normaliseRoomCode(rawCode);
  if (!code) throw new Error("A lake code is 5 letters and digits");
  const t = await joinRoom(code).catch((e: unknown) => {
    console.warn("join failed", e);
    throw new Error(e instanceof Error && /code/.test(e.message) ? e.message : "Could not reach that lake. Check the code and your connection.");
  });
  let guest: NetGuest;
  try {
    const w = await awaitWelcome(t, myName, PROTOCOL_VERSION);
    guest = new NetGuest(t, w);
    await waitFor(() => guest.ready, 10000, "The host did not send the lake");
  } catch (e) {
    t.close();
    throw e;
  }
  guest.onClosed = () => {
    if (net?.kind !== "guest") return;
    leaveOnline();
    say("The host closed the lake", 8000);
  };
  net = { kind: "guest", guest };
  pendingPermission = motionPermission();
  enter(guest.sim);
  say(`Joined lake ${code}`);
}

function waitFor(cond: () => boolean, ms: number, msg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = (): void => {
      if (cond()) return resolve();
      if (performance.now() - t0 > ms) return reject(new Error(msg));
      setTimeout(tick, 100);
    };
    tick();
  });
}

function leaveOnline(): void {
  if (net?.kind === "host") net.host.close();
  if (net?.kind === "guest") net.guest.close();
  net = null;
  $("room").textContent = "";
  $("board").replaceChildren();
  $("tags").replaceChildren();
  view?.dispose();
  view = null;
  sim = null;
  openMenu();
}

function respawnOnline(): void {
  if (!sim || !net) return;
  if (net.kind === "host") {
    const old = sim.player();
    const pl = sim.addPlayer(startLengthCm(sim.settings, sim.p));
    if (old) sim.humanIds.delete(old.id);
    placeStart(sim, pl);
    enter(sim);
    return;
  }
  const g = net.guest;
  g.respawn();
  waitFor(() => g.ready, 10000, "The host did not respawn you").then(
    () => enter(g.sim),
    () => leaveOnline(),
  );
}

function openMenu(): void {
  mode = "menu";
  touch?.dispose();
  touch = null;
  touchIn = null;
  if (document.pointerLockElement) document.exitPointerLock?.();
  const text = store.load();
  let slot: SaveSlot = { kind: "none" };
  if (text !== null) {
    const r = parseSave(text);
    slot = r.ok ? { kind: "ok", sim: r.sim } : { kind: "bad", text };
  }
  const seed = query.get("seed");
  showStart(
    overlay,
    slot,
    store.available,
    {
      onContinue: (s) => ((pendingPermission = motionPermission()), enter(s)),
      onNew: (c) => ((pendingPermission = motionPermission()), newLife(settingsFrom(c), c.seed)),
      onDownload(t) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([t], { type: "application/json" }));
        a.download = "pike-save.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      controls: controlsPref,
      online: { name: myName, onHost: hostGame, onJoin: joinGame },
      mouse: touchOn ? undefined : mousePref,
      gfx: gfxPref,
      padSetup: touchOn ? undefined : () => openPadSetup(gamepad.maps),
    },
    seed === null ? undefined : Number(seed),
  );
}

function pause(): void {
  if (mode !== "playing" || !sim) return;
  rec.event("pause");
  mode = "paused";
  keys.clear();
  touchIn = null;
  if (document.pointerLockElement) document.exitPointerLock?.();
  autosave();
  showPause(
    overlay,
    sim.milestones,
    () => {
      mode = "playing";
      hideOverlay(overlay);
      if (touchOn) mountTouch(motionPermission());
      else lockPointer();
    },
    () => {
      if (net) return leaveOnline();
      autosave();
      openMenu();
    },
    controlsPref,
    net ? (net.kind === "host" ? `You are hosting lake ${net.host.code}.` : "You are in a friend's lake.") : undefined,
    touchOn ? undefined : mousePref,
    gfxPref,
    touchOn ? undefined : () => openPadSetup(gamepad.maps),
  );
}

function die(noOffspring = false, persist = true): void {
  if (!sim) return;
  if (net) {
    const pl = sim.player();
    mode = "dead";
    keys.clear();
    game.death();
    if (document.pointerLockElement) document.exitPointerLock?.();
    const killer = pl?.killedBy !== undefined ? playerName(pl.killedBy) : null;
    const cause = pl?.deathCause === "caught" ? "An angler landed you. Into the keep net!" : killer ? `${killer} ate you.` : pl?.deathCause === "starvation" ? "You starved." : "A bigger pike got you.";
    return showOnlineDeath(overlay, cause, game.points, respawnOnline, leaveOnline);
  }
  const s = lifeSummary(sim);
  if (!s) return;
  mode = "dead";
  keys.clear();
  game.death();
  if (document.pointerLockElement) document.exitPointerLock?.();
  const dm = sim.settings.deathMode;
  if (persist && !persistDeath(store, dm, toSaveFile(sim, new Date()))) warnSaveFailed();
  let rewindDay: number | null = null;
  if (dm === "rewind") {
    const t = store.loadRewind();
    const r = t === null ? null : parseSave(t);
    if (r?.ok) rewindDay = r.sim.env.dayOfYear;
  }
  const opts = offspringOptions(sim);
  const lastSettings = sim.settings;
  showDeath(
    overlay,
    s,
    dm,
    { rewindDay, offspringLiving: opts.living, offspringCohorts: opts.cohorts, noOffspring },
    {
      onNew: () => newLife(lastSettings, Math.floor(Math.random() * 1e9)),
      onRewind() {
        const t = store.loadRewind();
        const r = t === null ? null : parseSave(t);
        if (r?.ok) {
          enter(r.sim);
          autosave();
        } else newLife(lastSettings, Math.floor(Math.random() * 1e9));
      },
      onOffspring() {
        const r = continueAsOffspring(sim!);
        if (!r.ok) return die(true, false);
        if (r.fastForwardDays > 0) say(`Time passes: ${Math.round(r.fastForwardDays)} days`);
        enter(sim!);
        autosave();
      },
    },
  );
}

// --- main loop ---
function simulate(s: Simulation, pl: PikeState, frameDt: number): string {
  let blockedText = "";
  touchIn = touch?.read(stickContext()) ?? null;
  if (touchIn && !touchIn.rest) restLatch = false;
  if (pad.connected && !pad.rest && !keys.has("KeyR")) restLatch = false;
  const restHeld = keys.has("KeyR") || !!touchIn?.rest || pad.rest;
  if (restHeld && !restLatch && net) blockedText = "No resting in a shared lake";
  else if (restHeld && !restLatch) {
    const blockers = restBlockers(s).filter((b) => b !== "dead");
    if (blockers.length === 0) {
      const stop = restFor(s, s.p.rest.bioSecondsPerFrame);
      if (stop.reason === "threat" || stop.reason === "hunger") {
        say(stop.reason === "threat" ? "A large pike is approaching!" : "Hunger wakes you");
        restLatch = true;
        autosave();
      }
      return `Resting… day ${s.env.dayOfYear}`;
    }
    blockedText = `Can't rest: ${blockers.map((b) => BLOCKER_TEXT[b]).join(" / ")}`;
  }
  const scale = TIME_SCALES[debug ? timeScaleIdx : 0]!;
  const { steps, dt } = stepPlan(frameDt, scale);
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    s.setInput(pl.id, mode === "playing" ? playerInput(pl) : { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
    if (net?.kind === "host") net.host.beforeStep();
    s.step(dt);
  }
  stepMs = stepMs * 0.95 + ((performance.now() - t0) / steps) * 0.05;
  return blockedText;
}

const marksEl = $("marks");
const hintEl = $("hint");
function updateHunting(s: Simulation, pl: PikeState, v: PikeScene, playing: boolean): void {
  if (!playing || !pl.alive) {
    renderMarks(marksEl, []);
    touch?.setStrikeReady(false);
    hintEl.textContent = "";
    return;
  }
  const targets = lungeTargets(s, pl);
  const pp = s.paramsFor(pl);
  const tooFull = (t: LungeTarget): boolean => {
    const grams = t.kind === "prey" ? s.prey.find((f) => f.id === t.id)?.weight : t.kind === "pike" ? s.pikes.find((k) => k.id === t.id)?.weight : undefined;
    return grams !== undefined && tooFullFor(pl, grams, pp);
  };
  const marks = computeMarks(targets, (p) => v.project(p), 5, { tooFull });
  renderMarks(marksEl, marks);
  const strikeReady = marks.some((m) => m.tone === "strike"); // the rings, the hint and the Strike glow agree
  touch?.setStrikeReady(strikeReady);
  const hint = nextHint({
    done: s.playerHintsDone,
    stillTime: pl.stillTime,
    inCover: s.world.coverAt(pl.pos) >= s.p.rest.minCover,
    hasStrikeMark: strikeReady,
  });
  hintEl.textContent = hint ? (touchOn ? TOUCH_HINT_TEXT : HINT_TEXT)[hint] : "";
}

// --- multiplayer HUD: lake code, leaderboard, name tags over other players ---
function onlinePlayers(): { pikeId: number; name: string; score: number }[] {
  if (net?.kind === "host") return net.host.players();
  if (net?.kind === "guest") return net.guest.players;
  return [];
}
function playerName(pikeId: number): string | null {
  return onlinePlayers().find((p) => p.pikeId === pikeId)?.name ?? null;
}
let boardAcc = 0;
function updateOnlineHud(s: Simulation, pl: PikeState, v: PikeScene): void {
  const players = onlinePlayers();
  const tags = $("tags");
  const want: HTMLElement[] = [];
  for (const p of players) {
    if (p.pikeId === pl.id) continue;
    const pk = s.pikes.find((k) => k.id === p.pikeId);
    if (!pk || !pk.alive) continue;
    const at = v.project({ x: pk.pos.x, y: pk.pos.y + (pk.lengthCm / 100) * 0.25 + 0.05, z: pk.pos.z });
    if (!at.visible) continue;
    const d = document.createElement("div");
    d.className = "tag";
    d.textContent = `${p.name} · ${Math.round(pk.lengthCm)} cm`;
    d.style.left = `${at.x}px`;
    d.style.top = `${at.y}px`;
    want.push(d);
  }
  tags.replaceChildren(...want);
  boardAcc -= 1;
  if (boardAcc > 0) return;
  boardAcc = 15; // the board text changes slowly: rebuild a few times a second
  $("room").textContent = net?.kind === "host" ? `Lake ${net.host.code} · ${players.length} player${players.length === 1 ? "" : "s"}` : `Online · ${players.length} players`;
  const rows = [...players].sort((a, b) => b.score - a.score).map((p) => {
    const r = document.createElement("div");
    if (p.pikeId === pl.id) r.className = "me";
    const n = document.createElement("span");
    n.textContent = p.pikeId === pl.id ? `${p.name} (you)` : p.name;
    const sc = document.createElement("b");
    sc.textContent = (p.pikeId === pl.id ? game.points : p.score).toLocaleString("en");
    r.append(n, sc);
    return r;
  });
  $("board").replaceChildren(...rows);
}

let adaptiveRes: AdaptiveResolution | null = null;
/** First 3 s of play decide the automatic drop to low quality (only when the player never chose a quality). */
let fpsProbe = { acc: 0, frames: 0, done: false };
let fpsShown = 0;
function probeQuality(dt: number): void {
  if (fpsProbe.done || !view) return;
  fpsProbe.acc += dt;
  fpsProbe.frames++;
  if (fpsProbe.acc < 3) return;
  fpsProbe.done = true;
  const next = autoQuality(gfx, fpsProbe.frames / fpsProbe.acc);
  if (next.quality === gfx.quality) return;
  gfx = next; // not saved: an automatic drop is re-measured next session
  view.setGfx(gfx);
  adaptiveRes = new AdaptiveResolution(view.renderer.getPixelRatio());
}
/** One recorder sample (REC_HZ): the pike, what the player asked for, the camera and the frame rate. */
function recFrame(s: Simulation, pl: PikeState, frameDt: number): void {
  if (mode !== recMode) {
    rec.event("mode", { mode });
    recMode = mode;
  }
  if (!rec.due() || !view) return;
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  const held = [...keys].filter((k) => /^(Key[WASDFRQE]|Arrow|Shift|Space)/.test(k));
  rec.sample({
    mode,
    pos: [r2(pl.pos.x), r2(pl.pos.y), r2(pl.pos.z)],
    floor: r2(s.world.bottomY(pl.pos.x, pl.pos.z)),
    yaw: r3(pl.yaw),
    pitch: r3(pl.pitch),
    wantYaw: r3(wantYaw),
    wantPitch: r3(wantPitch),
    speed: r2(pl.speed),
    lengthCm: r2(pl.lengthCm),
    energy: Math.round(pl.energy),
    burst: pl.burstTimeLeft > 0,
    lock: pl.lockId,
    in: { th: r2(recLastInput.throttle), yr: r2(recLastInput.yawRate), pr: r2(recLastInput.pitchRate), b: recLastInput.burst },
    mouse: [recMouse.dx, recMouse.dy],
    keys: held,
    pad: pad.connected ? { turn: r2(pad.turn), pitch: r2(pad.pitch), th: r2(pad.throttle), rest: pad.rest } : null,
    touch: touchIn ? { yr: r2(touchIn.yawRate), pr: r2(touchIn.pitchRate), th: r2(touchIn.throttle) } : null,
    cam: { mode: view.rig.mode, zoom: r2(view.rig.zoom), orbit: r2(view.rig.orbit), pos: [r2(view.rig.position.x), r2(view.rig.position.y), r2(view.rig.position.z)] },
    fps: frameDt > 0 ? Math.round(1 / frameDt) : 0,
    quality: gfx.quality,
  });
  recMouse.dx = recMouse.dy = 0;
}

let last = performance.now();
/** The overlay's main button (keyboard Enter / gamepad A on a menu): resume, continue, respawn or start. */
function overlayDefault(): HTMLButtonElement | null {
  const btns = [...overlay.querySelectorAll("button")];
  for (const label of ["Resume", "Continue", "Respawn", "Start a new life"]) {
    const b = btns.find((x) => x.textContent === label && !x.disabled);
    if (b) return b;
  }
  return null;
}
addEventListener("keydown", (e) => {
  if (e.code !== "Enter" || mode === "playing" || overlay.style.display === "none" || padSetupOpen()) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "BUTTON")) return; // native Enter there
  overlayDefault()?.click();
});

/** Gamepad buttons and keyboard/stick steering, once per rendered frame. */
function eggFrame(frameDt: number): void {
  if (!egg || mode !== "playing" || !view) return;
  egg.t += frameDt;
  view.egg = { wobble: Math.min(1, egg.taps / EGG_TAPS) };
  if (egg.taps >= EGG_TAPS || egg.t >= EGG_MAX_S) {
    egg = null;
    view.egg = null;
    say("You hatched! Eat the tiny fish around you to grow", 4000);
    rec.event("hatch");
  }
}

function padAndKeys(frameDt: number): void {
  if (padSetupOpen()) {
    pad = gamepad.read([]); // the setup screen owns the controller while it is open
    return;
  }
  pad = gamepad.read();
  if (pad.minimap) say(minimap.toggle() ? "Minimap on" : "Minimap off");
  if (mode !== "playing") {
    if (pad.pause && mode === "paused") overlayDefault()?.click();
    else if (pad.strike) overlayDefault()?.click();
    return;
  }
  if (pad.pause) return pause();
  if (pad.camera) nextCamera();
  if (pad.strike) {
    if (egg) egg.taps++;
    else burstQueued = true;
  }
  const pl = sim?.player();
  if (!pl || !view || touchIn) return;
  view.rig.orbit += pad.orbit * 1.6 * frameDt;
  const kbTurn = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const turn = kbTurn || pad.turn * 1.3;
  if (turn) wantYaw = pl.yaw + clamp(angleDiff(wantYaw + turn * KB_TURN_RAD_S * frameDt, pl.yaw), -MAX_LEAD, MAX_LEAD);
  const kbPitch = (keys.has("KeyF") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  const pitch = kbPitch || pad.pitch * (pad.standard && invertMouse ? -1 : 1);
  const move = (target: number, rate: number): void => {
    wantPitch += clamp(target - wantPitch, -rate * frameDt, rate * frameDt);
  };
  if (pitch) {
    pitchHeld = true;
    move(pitch * HOLD_PITCH, HOLD_PITCH_RATE);
  } else if (pitchHeld) {
    move(0, LEVEL_RATE);
    if (wantPitch === 0) pitchHeld = false;
  }
}

function frame(now: number): void {
  const frameDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  padAndKeys(frameDt);
  eggFrame(frameDt);
  if (sim && view) {
    let restText = "";
    const alive = !!sim.player()?.alive;
    if (net?.kind === "guest") {
      // the host simulates; the guest predicts its own pike and smooths the rest
      touchIn = touch?.read(stickContext()) ?? null;
      const me = sim.player();
      net.guest.frame(frameDt, me && mode === "playing" ? playerInput(me) : { throttle: 0, yawRate: 0, pitchRate: 0, burst: false });
      net.guest.reportScore(game.points, frameDt);
    } else if (alive && (mode === "playing" || (net && mode === "paused"))) restText = simulate(sim, sim.player()!, frameDt * (net ? 1 : game.timeScale()));
    if (net?.kind === "host") {
      net.host.hostScore = game.points;
      net.host.tick(frameDt);
    }
    const pl = sim.player()!;
    const day = Math.floor(sim.time / sim.p.environment.dayLengthS);
    if (mode === "playing" && day !== lastDay) {
      lastDay = day;
      autosave(true);
    }
    drainEvents(sim, pl);
    if (rec.active) recFrame(sim, pl, frameDt);
    if (mode === "playing" && !pl.alive) die();
    view.render(pl, sim.time, sim.env, frameDt, { yaw: angleDiff(wantYaw, pl.yaw), pitch: wantPitch - pl.pitch });
    if (mode === "playing") probeQuality(frameDt);
    if (debug && frameDt > 0) fpsShown += (1 / frameDt - fpsShown) * 0.05;
    const ratio = mode === "playing" ? adaptiveRes?.frame(frameDt) : null;
    if (ratio) view.setPixelRatio(ratio);
    if (mode === "playing") view.rig.orbit += ((keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0)) * 1.6 * frameDt;
    game.frame(frameDt, sim, pl, view, mode === "playing" && !restText.startsWith("Resting")); // no hunter clock during rest
    updateHud(sim, pl, restText);
    updateHunting(sim, pl, view, mode === "playing");
    if (net) updateOnlineHud(sim, pl, view);
    const showing = mode === "playing" || mode === "paused";
    if (showing && minimap.visible) {
      minimap.show();
      minimap.update(frameDt, sim, pl);
    } else minimap.hide();
    if (mode !== shownMode) {
      shownMode = mode;
      document.body.classList.toggle("playing", mode === "playing");
      if (mode === "menu") toggleKeys(false);
    }
    (window as unknown as { __pike: unknown }).__pike = { sim, view, player: pl };
  }
  requestAnimationFrame(frame);
}
openMenu();
requestAnimationFrame(frame);
