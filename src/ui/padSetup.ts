/**
 * Controller setup: live view of the first connected controller's axes and buttons, and per-action
 * "Set" buttons that learn a binding from the next stick movement / switch flip / button press.
 * Bindings are saved per controller id (PadMaps); a drone radio starts from RC_PRESET.
 */
import { bindFrom, detectChange, GamepadInput, mapFor, PAD_ACTION_LABEL, PAD_ACTIONS, RC_PRESET, snapshot, type ButtonBind, type PadAction, type PadMap, type PadMaps, type PadSnapshot } from "./gamepad";

const PROMPT: Record<PadAction, string> = {
  turn: "Push the stick you want for turning to the RIGHT",
  pitch: "Push the stick you want for rising (swim up) to its RISE side",
  throttle: "Leave the swim stick at stop, then move it to FULL",
  orbit: "Push the stick you want for orbiting the camera to the RIGHT",
  strike: "Press the button or flip the switch for Strike",
  camera: "Press the button or flip the switch for Next camera",
  rest: "Press the button or flip the switch for Rest",
  pause: "Press the button or flip the switch for Pause",
};
const LEARN_TIMEOUT_MS = 10000;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}

export function describeBind(map: PadMap, a: PadAction): string {
  const b = map[a];
  if (!b) return "-";
  if ("kind" in b) return (b as ButtonBind).kind === "button" ? `button ${(b as { index: number }).index + 1}` : `switch on axis ${(b as { axis: number }).axis + 1} (${(b as { sign: number }).sign > 0 ? "+" : "-"})`;
  const ax = b as { axis: number; invert: boolean; full?: boolean };
  return `axis ${ax.axis + 1}${ax.invert ? " reversed" : ""}${ax.full ? " (full range)" : ""}`;
}

let open = false;
/** true while the setup panel is on screen (the game then ignores the controller) */
export const padSetupOpen = (): boolean => open;

/** Open the setup panel over whatever is on screen; `onClose` runs when it is closed. */
export function openPadSetup(maps: PadMaps, onClose: () => void = () => undefined): void {
  const root = h("div", { id: "padSetup" });
  root.style.cssText =
    "position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);";
  const box = h("div");
  box.style.cssText =
    "width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:rgba(6,20,22,.96);border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:16px 18px;color:#e8f2ee;font-size:14px;";
  root.append(box);
  document.body.append(root);
  open = true;

  const title = h("h2", { textContent: "Controller setup" });
  title.style.margin = "0 0 6px";
  const who = h("p", {});
  const note = h("p", { textContent: "PlayStation and Xbox pads work as they are. Any action can be re-bound: click Set and move the stick or press the button you want. Other controllers (for example a drone radio in USB joystick mode) start from a preset: right stick steers, left stick up/down swims." });
  note.style.cssText = "color:#9fb5ad;font-size:12px;margin:4px 0 10px";
  const live = h("div");
  live.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:10px;font-size:11px;color:#9fb5ad";
  const prompt = h("p", {});
  prompt.style.cssText = "min-height:20px;color:#ffe9b8;font-weight:600;margin:6px 0";
  const table = h("table");
  table.style.cssText = "width:100%;border-collapse:collapse";
  const btnRow = h("div");
  btnRow.style.cssText = "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap";
  box.append(title, who, note, live, prompt, table, btnRow);

  let learning: { action: PadAction; base: PadSnapshot; until: number } | null = null;
  let padId = "";
  let lastRows = "";

  const current = (): PadMap => {
    const saved = padId ? maps.get(padId) : null;
    return saved ?? structuredClone(RC_PRESET);
  };
  const save = (m: PadMap): void => {
    if (padId) maps.set(padId, m);
  };

  const rows = (): void => {
    const pad = GamepadInput.first();
    const usingStandard = pad ? mapFor(pad, maps) === "standard" : false;
    const m = current();
    const key = JSON.stringify(m) + padId + usingStandard + (learning?.action ?? "");
    if (key === lastRows) return;
    lastRows = key;
    table.replaceChildren();
    if (usingStandard) {
      table.append(h("tr", {}, h("td", { textContent: "Standard gamepad: console layout (left stick steer, R2/RT swim, ✕/A strike...). Set any action to switch to custom bindings." })));
    }
    for (const a of PAD_ACTIONS) {
      const set = h("button", { textContent: learning?.action === a ? "Waiting…" : "Set", className: "secondary" });
      set.style.cssText = "padding:4px 10px;margin:2px";
      set.disabled = !padId;
      set.addEventListener("click", () => {
        const p = GamepadInput.first();
        if (!p) return;
        learning = { action: a, base: snapshot(p), until: performance.now() + LEARN_TIMEOUT_MS };
        lastRows = "";
      });
      const clear = h("button", { textContent: "Clear", className: "secondary" });
      clear.style.cssText = "padding:4px 10px;margin:2px";
      clear.disabled = !padId;
      clear.addEventListener("click", () => {
        const next = current();
        next[a] = null;
        save(next);
        lastRows = "";
      });
      const tr = h("tr", {}, h("td", { textContent: PAD_ACTION_LABEL[a] }), h("td", { textContent: usingStandard ? "(console layout)" : describeBind(m, a) }), h("td", {}, set, clear));
      for (const td of tr.children) (td as HTMLElement).style.cssText = "padding:3px 4px;border-top:1px solid rgba(255,255,255,.08)";
      table.append(tr);
    }
  };

  const reset = h("button", { textContent: "Reset to preset", className: "secondary" });
  reset.addEventListener("click", () => {
    if (padId) maps.set(padId, structuredClone(RC_PRESET));
    lastRows = "";
  });
  const auto = h("button", { textContent: "Forget my bindings", className: "secondary" });
  auto.addEventListener("click", () => {
    if (padId) maps.set(padId, null);
    lastRows = "";
  });
  const done = h("button", { textContent: "Done" });
  done.addEventListener("click", close);
  btnRow.append(done, reset, auto);

  let raf = 0;
  function tick(): void {
    const pad = GamepadInput.first();
    padId = pad?.id ?? "";
    who.textContent = pad ? `Found: ${pad.id}` : "No controller found. Plug it in and press a button (browsers only report a pad after its first input).";
    live.replaceChildren(
      ...(pad
        ? [
            ...pad.axes.map((v, i) => {
              const bar = h("span", { textContent: `axis ${i + 1} ${v >= 0 ? "+" : ""}${v.toFixed(2)}` });
              bar.style.cssText = `display:inline-block;min-width:96px;background:linear-gradient(90deg,rgba(127,214,176,.35) ${((v + 1) / 2) * 100}%,transparent 0);padding:1px 4px;border-radius:3px`;
              return bar;
            }),
            ...pad.buttons.map((b, i) => {
              const dot = h("span", { textContent: `b${i + 1}` });
              dot.style.cssText = `padding:1px 4px;border-radius:3px;${b.pressed ? "background:#f2b84b;color:#2a1700" : ""}`;
              return dot;
            }),
          ]
        : []),
    );
    if (learning && pad) {
      prompt.textContent = `${PROMPT[learning.action]}…`;
      const c = detectChange(learning.base, pad, learning.action === "throttle" ? 0.8 : 0.5);
      const b = c ? bindFrom(learning.action, c) : null;
      if (b) {
        const next = current();
        (next as unknown as Record<string, unknown>)[learning.action] = b;
        save(next);
        prompt.textContent = `${PAD_ACTION_LABEL[learning.action]}: ${describeBind(next, learning.action)}`;
        learning = null;
        lastRows = "";
      } else if (performance.now() > learning.until) {
        prompt.textContent = "Nothing moved, try again.";
        learning = null;
        lastRows = "";
      }
    } else if (learning && !pad) learning = null;
    rows();
    raf = requestAnimationFrame(tick);
  }
  function close(): void {
    cancelAnimationFrame(raf);
    root.remove();
    open = false;
    onClose();
  }
  tick();
}
