"""Start-up profile for Pike: what happens on the main thread from clicking "Start a new life" through 10 s of play.

Start a server first: npm run build && npx vite preview --port 5295 --strictPort
Run: ~/.playwright-venv/bin/python3 scripts/startup-profile.py [URL]   (or PIKE_URL; default http://localhost:5295/)
Options (env): PIKE_RUNS="lake:high:640x360,river:low:1280x720"  map:quality:viewport, quality = high (default, auto-drop armed),
high-fixed (player chose High, no auto-drop) or low; an optional 4th field is the "Start as" value (egg, 22, 30...).  PIKE_PLAY_S (default 10).

Headless Chromium renders with SwiftShader (software GL): absolute frame times are far slower than a real GPU, but main-thread
long tasks (shader compiles, generation, buffer uploads) and before/after comparisons are valid.
Uses the performance marks/measures main.ts leaves behind: pike:sim (world + sim), pike:scene (PikeScene build),
pike:prewarm (shader compile before play), pike:save (first save), pike:menu (start screen incl. parsing saves),
pike:firstRender (JS time of the first play frame). PIKE_GL=llvmpipe switches the software GL.
Also prints the triangles and draw calls of the last frame (renderer.info.render), so the triangle budget can be checked per quality.
"""
import os
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PIKE_URL", "http://localhost:5295/")
RUNS = os.environ.get("PIKE_RUNS", "lake:high:640x360,river:high:640x360,lake:low:640x360,river:low:640x360,lake:high:1280x720,lake:low:1280x720")
PLAY_S = float(os.environ.get("PIKE_PLAY_S", "10"))
GL = os.environ.get("PIKE_GL", "swiftshader")  # or llvmpipe (Mesa via ANGLE GL/EGL, multithreaded, has KHR_parallel_shader_compile)
ARGS = ["--use-angle=gl-egl", "--ignore-gpu-blocklist", "--enable-gpu"] if GL == "llvmpipe" else ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

INIT = """
window.__prof = { lt: [], raf: [] };
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __prof.lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
(function loop() { __prof.raf.push(performance.now()); requestAnimationFrame(loop); })();
document.addEventListener("click", (e) => { if (e.target && e.target.textContent === "Start a new life") performance.mark("pike:click"); }, true);
"""

COLLECT = """() => {
  const m = (n) => { const e = performance.getEntriesByName(n); return e.length ? e[e.length - 1] : null; };
  const meas = {};
  for (const n of ["pike:sim", "pike:scene", "pike:prewarm", "pike:save", "pike:menu", "pike:firstRender"]) { const e = m(n); if (e) meas[n] = [e.startTime, e.duration]; }
  return { click: m("pike:click")?.startTime ?? null, enter: m("pike:enter")?.startTime ?? null, meas, lt: __prof.lt, raf: [...__prof.raf, performance.now()],
           quality: window.__pike?.view?.gfx?.quality ?? null,
           progEnter: m("pike:enter")?.detail?.programs ?? null, progNow: window.__pike?.view?.renderer?.info?.programs?.length ?? null,
           tris: window.__pike?.view?.renderer?.info?.render?.triangles ?? null, calls: window.__pike?.view?.renderer?.info?.render?.calls ?? null };
}"""


def gfx_init(quality):
    if quality == "high":
        return ""  # first-time player: High with the automatic drop armed
    q, chosen = ("high", "true") if quality == "high-fixed" else ("low", "true")
    return f'localStorage.setItem("pike.gfx.v1", JSON.stringify({{style:"realistic",quality:"{q}",qualityChosen:{chosen}}}));'


def frames_after(raf, t0, t1):
    """Frame times (ms) for frames whose rAF callback started in [t0, t1)."""
    return [raf[i + 1] - raf[i] for i in range(len(raf) - 1) if t0 <= raf[i] < t1]


def stat(xs):
    if not xs:
        return "-", "-", 0
    return f"{max(xs):.0f}", f"{sum(xs) / len(xs):.0f}", len(xs)


def run(pw, map_, quality, vp, start="egg"):
    w, h = (int(x) for x in vp.split("x"))
    browser = pw.chromium.launch(args=ARGS)
    ctx = browser.new_context(viewport={"width": w, "height": h})
    page = ctx.new_page()
    page.set_default_timeout(180000)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(gfx_init(quality) + INIT)
    page.goto(URL)
    page.wait_for_selector(".form button", timeout=60000)
    page.select_option(".form label:has-text('Water') select", map_)
    page.select_option(".form label:has-text('Start as') select", start)
    page.get_by_role("button", name="Start a new life").click(no_wait_after=True)
    page.wait_for_function("performance.getEntriesByName('pike:enter').length > 0", polling=500, timeout=180000)
    page.wait_for_timeout(int(PLAY_S * 1000) + 600)
    d = page.evaluate(COLLECT)
    # the start screen with all six slots filled (parsing every save)
    save = page.evaluate("localStorage.getItem('pike.save.v2.' + %r + '.1')" % map_)
    menu_ms = None
    if save:
        page.evaluate("(t) => { for (const m of ['lake','river']) for (const n of [1,2,3]) localStorage.setItem(`pike.save.v2.${m}.${n}`, t); }", save)
        page.reload()
        page.wait_for_selector(".form button", timeout=60000)
        page.wait_for_timeout(300)
        menu_ms = page.evaluate("(() => { const e = performance.getEntriesByName('pike:menu'); return e.length ? e[e.length - 1].duration : null; })()")
    browser.close()
    return d, menu_ms, errors


def report(label, d, menu_ms, errors):
    click, enter, raf = d["click"], d["enter"], d["raf"]  # raf ends with the collection time: a frame still running counts
    if click is None or enter is None:
        print(f"{label}: no click/enter marks"); return None
    first = next((t for t in raf if t > enter), None)  # rAF callback that draws the first play frame
    before = [t for t in raf if t <= click]
    gap = first - before[-1] if (first and before) else None  # frozen screen between the last menu frame and the first play frame
    f3 = frames_after(raf, first, first + 3000)
    f10 = frames_after(raf, first, first + PLAY_S * 1000)
    tail = frames_after(raf, first + 5000, first + PLAY_S * 1000)
    meas = d["meas"]
    ph = lambda n: f"{meas[n][1]:.0f}" if n in meas else "-"
    lts = [(s - click, dur) for s, dur in d["lt"] if s >= click - 5]
    row = {
        "run": label, "sim": ph("pike:sim"), "scene": ph("pike:scene"), "prewarm": ph("pike:prewarm"), "save": ph("pike:save"), "render1": ph("pike:firstRender"),
        "to_play": f"{enter - click:.0f}", "gap": f"{gap:.0f}" if gap else "-", "max3": stat(f3)[0], "avg3": stat(f3)[1], ">100ms_3s": sum(1 for x in f3 if x > 100),
        "max10": stat(f10)[0], "avg10": stat(f10)[1], "steady": stat(tail)[1], "menu6": f"{menu_ms:.0f}" if menu_ms is not None else "-",
        "progs": f"{d['progEnter']}->{d['progNow']}", "q_end": d["quality"] or "?",
        "tris": f"{d['tris'] / 1e6:.2f}M" if d["tris"] is not None else "-", "calls": d["calls"] if d["calls"] is not None else "-", "errors": len(errors),
    }
    print(f"\n== {label}  (times in ms, t=0 at the Start click)")
    print("  long tasks > 50 ms: " + ", ".join(f"@{s:.0f}:{dur:.0f}" for s, dur in lts[:25]) + (" ..." if len(lts) > 25 else ""))
    print(f"  first play frame at {first - click:.0f} ms after click; frames in first 3 s > 100 ms: " + ", ".join(f"{x:.0f}" for x in f3 if x > 100))
    if errors:
        print("  console errors: " + "; ".join(errors[:3]))
    return row


def main():
    rows = []
    with sync_playwright() as pw:
        for spec in RUNS.split(","):
            map_, quality, vp, *start = spec.split(":")
            d, menu_ms, errors = run(pw, map_, quality, vp, *start)
            r = report(spec, d, menu_ms, errors)
            if r:
                rows.append(r)
    if not rows:
        return
    cols = list(rows[0].keys())
    width = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in cols}
    print("\nsim/scene/prewarm/save = phase ms; render1 = JS time of the first play frame's render (shader compiles land here); gap = frozen screen from last menu frame to first play frame;")
    print("max3/avg3 = frame ms in the first 3 s of play; max10/avg10 over the first %g s; steady = avg frame from 5 s on;" % PLAY_S)
    print("to_play = click to first play frame; progs = shader programs when play starts -> after the run (new ones mean compiles during play)")
    print("menu6 = start screen build with six filled slots; q_end = quality after the run")
    print("tris/calls = renderer.info.render triangles and draw calls of the last frame (all passes) at the end of the run, in q_end quality\n")
    print("  ".join(c.ljust(width[c]) for c in cols))
    for r in rows:
        print("  ".join(str(r[c]).ljust(width[c]) for c in cols))


if __name__ == "__main__":
    main()
