import { MILESTONE_TEXT, type MilestoneId } from "../sim/milestones";
import type { LifeSummary } from "../sim/lifecycle";
import type { DangerPreset, DeathMode } from "../sim/settings";
import type { MapShape } from "../sim/world";
import type { Simulation } from "../sim/simulation";

const SEASONS = { winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Autumn" } as const;
const MODE_LABEL: Record<DeathMode, string> = {
  permadeath: "Permadeath: one life, then the save is erased",
  lineage: "Lineage: continue as your offspring",
  rewind: "Rewind: return to the last daily snapshot",
};

export interface NewLifeConfig {
  deathMode: DeathMode;
  preset: DangerPreset | "custom";
  rivalCount: number;
  rivalSizeScale: number;
  aggression: number;
  seed: number;
  map: MapShape;
  /** nothing can kill you: just swim and hunt */
  chill: boolean;
  /** growth speed multiplier (the Growth option) */
  growthMul: number;
}

function growthSelect(): HTMLSelectElement {
  const sel = h("select", {});
  sel.append(h("option", { value: "1", textContent: "Normal" }), h("option", { value: "3", textContent: "Fast (x3)" }), h("option", { value: "8", textContent: "Very fast (x8)" }));
  return sel;
}

function playSelect(): HTMLSelectElement {
  const sel = h("select", {});
  sel.append(h("option", { value: "chill", textContent: "Chill: just swim and hunt, nothing can kill you" }), h("option", { value: "challenge", textContent: "Challenge: hunters, bites, anglers, starving" }));
  return sel;
}

function mapSelect(): HTMLSelectElement {
  const sel = h("select", {});
  sel.append(h("option", { value: "lake", textContent: "Lake: still water, reed beds, deep middle" }), h("option", { value: "river", textContent: "River: current, deep pools and fast riffles" }));
  return sel;
}

export interface ControlsPref {
  mode: "tilt" | "joystick";
  onChange(m: "tilt" | "joystick"): void;
}
function controlsRow(c: ControlsPref): HTMLElement {
  const sel = h("select", {});
  sel.append(h("option", { value: "tilt", textContent: "Tilt (motion sensor)" }), h("option", { value: "joystick", textContent: "Joystick" }));
  sel.value = c.mode;
  sel.addEventListener("change", () => c.onChange(sel.value as ControlsPref["mode"]));
  return h("label", {}, "Controls ", sel);
}

/** Graphics settings row (start screen and pause menu). */
export interface GfxPref {
  style: "realistic" | "stylised";
  quality: "high" | "low";
  onStyle(s: "realistic" | "stylised"): void;
  onQuality(q: "high" | "low"): void;
}
function graphicsRow(g: GfxPref): HTMLElement {
  const style = h("select", { id: "gfxStyle" });
  style.append(h("option", { value: "realistic", textContent: "Realistic" }), h("option", { value: "stylised", textContent: "Stylised" }));
  style.value = g.style;
  style.addEventListener("change", () => g.onStyle(style.value as GfxPref["style"]));
  const quality = h("select", { id: "gfxQuality" });
  quality.append(h("option", { value: "high", textContent: "High" }), h("option", { value: "low", textContent: "Low (faster)" }));
  quality.value = g.quality;
  quality.addEventListener("change", () => g.onQuality(quality.value as GfxPref["quality"]));
  return h("div", { className: "gfxRow" }, h("label", {}, "Graphics ", style), h("label", {}, " Quality ", quality));
}

/** Desktop mouse preference: inverted = flight style (push the mouse forward to dive). */
export interface MousePref {
  invertY: boolean;
  onChange(invertY: boolean): void;
  sens: number;
  onSens(v: number): void;
}
function mouseRow(m: MousePref): HTMLElement {
  const box = h("input", { type: "checkbox", checked: m.invertY });
  box.addEventListener("change", () => m.onChange(box.checked));
  const sens = h("input", { type: "range", min: "0.2", max: "2", step: "0.1", value: String(m.sens), id: "mouseSens" });
  const val = h("span", { textContent: m.sens.toFixed(1) });
  sens.addEventListener("input", () => {
    val.textContent = Number(sens.value).toFixed(1);
    m.onSens(Number(sens.value));
  });
  return h("div", {}, h("label", {}, box, " Invert mouse (push forward to dive, pull back to rise)"), h("label", {}, "Mouse sensitivity ", sens, " ", val));
}

export type SaveSlot = { kind: "none" } | { kind: "ok"; sim: Simulation } | { kind: "bad"; text: string };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}
const button = (label: string, onClick: () => void, cls = ""): HTMLButtonElement => {
  const b = h("button", { textContent: label, className: cls });
  b.addEventListener("click", onClick);
  return b;
};
const p = (text: string, cls = ""): HTMLParagraphElement => h("p", { textContent: text, className: cls });

function mount(root: HTMLElement, ...kids: Node[]): void {
  root.replaceChildren(h("div", {}, ...kids));
  root.style.display = "flex";
}
export function hideOverlay(root: HTMLElement): void {
  root.style.display = "none";
  root.replaceChildren();
}

function milestoneList(ids: MilestoneId[]): HTMLElement {
  if (ids.length === 0) return p("No milestones yet.");
  return h("ul", {}, ...ids.map((id) => h("li", { textContent: MILESTONE_TEXT[id] })));
}

export function lifeLine(sim: Simulation): string {
  const pk = sim.player();
  if (!pk) return "";
  return `${pk.sex === "male" ? "Male" : "Female"} pike, ${pk.lengthCm.toFixed(1)} cm, ${pk.ageDays.toFixed(0)} days old`;
}

function newLifeForm(onNew: (c: NewLifeConfig) => void, confirmFirst: boolean, defaultSeed?: number): HTMLElement {
  const mode = h("select", {});
  for (const m of Object.keys(MODE_LABEL) as DeathMode[]) mode.append(h("option", { value: m, textContent: MODE_LABEL[m] }));
  const preset = h("select", {});
  for (const [v, l] of [["gentle", "Gentle"], ["natural", "Natural"], ["harsh", "Harsh"], ["custom", "Custom"]] as const) preset.append(h("option", { value: v, textContent: l }));
  preset.value = "natural";
  const slider = (min: number, max: number, step: number, value: number): HTMLInputElement => h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
  const rivals = slider(0, 16, 1, 8);
  const size = slider(0.6, 1.5, 0.05, 1);
  const aggr = slider(0.3, 2, 0.05, 1);
  const seed = h("input", { type: "number", value: String(defaultSeed ?? Math.floor(Math.random() * 1e9)) });
  const custom = h("div", { className: "custom" });
  const row = (label: string, input: HTMLInputElement): HTMLElement => {
    const val = h("span", { textContent: input.value });
    input.addEventListener("input", () => (val.textContent = input.value));
    return h("label", {}, `${label} `, input, " ", val);
  };
  custom.append(row("Rival pikes", rivals), row("Rival size", size), row("Aggression", aggr));
  custom.style.display = "none";
  preset.addEventListener("change", () => (custom.style.display = preset.value === "custom" ? "block" : "none"));
  const map = mapSelect();
  const play = playSelect();
  const growth = growthSelect();
  const danger = h("div", {}, h("label", {}, "Death mode ", mode), h("label", {}, "Danger ", preset), custom);
  danger.style.display = "none";
  play.addEventListener("change", () => (danger.style.display = play.value === "chill" ? "none" : "block"));
  const go = button("Start a new life", () => {
    if (confirmFirst && !confirm("This replaces your saved pike, which could not be loaded. Continue?")) return;
    onNew({
      deathMode: mode.value as DeathMode,
      preset: preset.value as NewLifeConfig["preset"],
      rivalCount: Number(rivals.value),
      rivalSizeScale: Number(size.value),
      aggression: Number(aggr.value),
      seed: Number(seed.value) || 1,
      map: map.value === "river" ? "river" : "lake",
      chill: play.value === "chill",
      growthMul: Number(growth.value) || 1,
    });
  });
  return h("div", { className: "form" }, h("label", {}, "Play ", play), h("label", {}, "Water ", map), h("label", {}, "Growth ", growth), danger, h("label", {}, "Seed ", seed), go);
}

export interface OnlineHandlers {
  name: string;
  /** resolves when the lake is open; rejects with a readable message */
  onHost(name: string, map: MapShape, chill: boolean, growthMul: number): Promise<void>;
  onJoin(name: string, code: string): Promise<void>;
}

function onlineCard(o: OnlineHandlers): HTMLElement {
  const name = h("input", { value: o.name, maxLength: 16, placeholder: "Your name" });
  const code = h("input", { maxLength: 6, placeholder: "CODE", size: 7, autocapitalize: "characters" } as Partial<HTMLInputElement>);
  code.style.textTransform = "uppercase";
  code.style.letterSpacing = "2px";
  const status = p("");
  const busy = (on: boolean, msg = ""): void => {
    status.textContent = msg;
    status.className = "";
    for (const b of [hostBtn, joinBtn]) b.disabled = on;
  };
  const fail = (e: unknown): void => {
    busy(false);
    status.textContent = e instanceof Error ? e.message : String(e);
    status.className = "warn";
  };
  const hostMap = mapSelect();
  const hostChill = h("input", { type: "checkbox", checked: true });
  const hostGrowth = growthSelect();
  const hostBtn = button("Host", () => {
    busy(true, "Opening a lake…");
    o.onHost(name.value, hostMap.value === "river" ? "river" : "lake", hostChill.checked, Number(hostGrowth.value) || 1).catch(fail);
  });
  const joinBtn = button(
    "Join",
    () => {
      busy(true, "Joining…");
      o.onJoin(name.value, code.value).catch(fail);
    },
    "secondary",
  );
  return h(
    "div",
    { className: "card" },
    h("b", { textContent: "Play with friends" }),
    p("Share a lake with up to 5 friends: hunt the same fish, race for score, and watch out for bigger players. One of you hosts and reads out the code."),
    h("label", {}, "Name ", name),
    h("label", {}, "Water ", hostMap),
    h("label", {}, "Growth ", hostGrowth),
    h("label", {}, hostChill, " Chill (nobody can die) ", hostBtn),
    h("label", {}, "Code ", code, " ", joinBtn),
    status,
  );
}

export function showOnlineDeath(root: HTMLElement, cause: string, score: number, onRespawn: () => void, onLeave: () => void): void {
  mount(root, h("h1", { textContent: "You died" }), p(cause), p(`Score this life: ${score.toLocaleString("en")}`), button("Respawn", onRespawn), button("Leave the lake", onLeave, "secondary"));
}

export interface StartHandlers {
  online?: OnlineHandlers;
  onContinue(sim: Simulation): void;
  onNew(c: NewLifeConfig): void;
  onDownload(text: string): void;
  controls?: ControlsPref; // touch devices only
  mouse?: MousePref; // desktop only
  gfx?: GfxPref;
}

export function showStart(root: HTMLElement, slot: SaveSlot, storageAvailable: boolean, hd: StartHandlers, defaultSeed?: number): void {
  const kids: Node[] = [
    h("h1", { textContent: "Pike" }),
    p("You are a young northern pike in a lake or a river. Hunt, grow, leap after mayflies, and become the apex predator."),
    p("Chase fish until their ring turns green, then strike. Chain catches for combos and grow through the stages. In Chill you just swim; in Challenge big pike and anglers are out to get you."),
  ];
  const keysLine = h("p", {});
  keysLine.innerHTML = "<kbd>Mouse</kbd> steer &nbsp; <kbd>A</kbd>/<kbd>D</kbd> turn &nbsp; <kbd>S</kbd>/<kbd>F</kbd> dive/rise &nbsp; <kbd>W</kbd> swim &nbsp; <kbd>Shift</kbd>+<kbd>W</kbd> stalk slowly &nbsp; <kbd>Space</kbd> / click strike &nbsp; <kbd>R</kbd> rest (in cover, when still) &nbsp; <kbd>M</kbd> sound &nbsp; <kbd>C</kbd> camera &nbsp; <kbd>Wheel</kbd> zoom &nbsp; <kbd>Q</kbd>/<kbd>E</kbd> orbit &nbsp; <kbd>V</kbd> reset view &nbsp; <kbd>N</kbd> minimap &nbsp; <kbd>H</kbd> all controls &nbsp; · &nbsp; no mouse? keyboard alone or a gamepad works too (<kbd>Enter</kbd> starts)";
  if (hd.controls) keysLine.textContent = "Joystick: steer and swim (push further to go faster). Strike to lunge, hold Rest when still in cover, Cam to change the view. Tilt steering can be picked below.";
  kids.push(keysLine);
  if (hd.controls) kids.push(controlsRow(hd.controls));
  if (hd.mouse) kids.push(mouseRow(hd.mouse));
  if (hd.gfx) kids.push(graphicsRow(hd.gfx));
  if (!storageAvailable) kids.push(p("Progress will not be saved in this browser", "warn"));
  if (slot.kind === "ok") {
    const s = slot.sim;
    kids.push(
      h("div", { className: "card" },
        h("b", { textContent: "Saved pike" }),
        p(lifeLine(s)),
        p(`${SEASONS[s.env.season]}, day ${s.env.dayOfYear} · ${s.settings.deathMode}`),
        button("Continue", () => hd.onContinue(s)),
      ),
    );
  } else if (slot.kind === "bad") {
    kids.push(h("div", { className: "card" }, p("Your saved pike could not be loaded", "warn"), button("Download save file", () => hd.onDownload(slot.text), "secondary")));
  }
  if (hd.online) kids.push(onlineCard(hd.online));
  kids.push(h("h2", { textContent: "New life" }), newLifeForm(hd.onNew, slot.kind === "bad", defaultSeed));
  mount(root, ...kids);
}

export interface DeathHandlers {
  onNew(): void;
  onRewind(): void;
  onOffspring(): void;
}

export function showDeath(
  root: HTMLElement,
  s: LifeSummary,
  mode: DeathMode,
  extra: { rewindDay: number | null; offspringLiving: number; offspringCohorts: number; noOffspring: boolean },
  hd: DeathHandlers,
): void {
  const cause = s.cause === "eaten" ? `Eaten by a ${Math.round(s.byLengthCm ?? 0)} cm pike` : s.cause === "caught" ? "Caught by an angler" : "Starved";
  const kids: Node[] = [
    h("h1", { textContent: "Your pike died" }),
    p(cause),
    p(`Lived ${s.ageDays.toFixed(1)} days, reached ${s.lengthCm.toFixed(1)} cm`),
    milestoneList(s.milestones),
  ];
  if (mode === "rewind" && extra.rewindDay !== null) kids.push(button(`Rewind to day ${extra.rewindDay}`, hd.onRewind));
  if (mode === "lineage") {
    if (extra.noOffspring) kids.push(p("No surviving offspring", "warn"));
    else kids.push(button(`Continue as offspring (${extra.offspringLiving + extra.offspringCohorts} available)`, hd.onOffspring));
  }
  kids.push(button("Start a new life", hd.onNew, mode === "permadeath" ? "" : "secondary"));
  mount(root, ...kids);
}

export function showPause(root: HTMLElement, milestones: MilestoneId[], onResume: () => void, onMenu: () => void, controls?: ControlsPref, online?: string, mouse?: MousePref, gfx?: GfxPref): void {
  const title = online ? "Menu" : "Paused";
  const note = online ? [p(`${online} The lake keeps going while this menu is open.`)] : [];
  mount(root, h("h1", { textContent: title }), ...note, ...(controls ? [controlsRow(controls)] : []), ...(mouse ? [mouseRow(mouse)] : []), ...(gfx ? [graphicsRow(gfx)] : []), h("h2", { textContent: "Milestones" }), milestoneList(milestones), button("Resume", onResume), button(online ? "Leave the lake" : "Save and return to menu", onMenu, "secondary"));
}
