"""Browser check for Pike. Start a server first: npx vite --port 5199 (or npx vite build && npx vite preview --port 5199)
Run: ~/.playwright-venv/bin/python3 scripts/browser-check.py   (PIKE_URL / PIKE_SHOTS override the server and shot dir)"""
import os
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("PIKE_URL", "http://localhost:5199/")
SHOTS = os.environ.get("PIKE_SHOTS", "/tmp/pike-shots/")
os.makedirs(SHOTS, exist_ok=True)
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        fails.append(name)


def start_new_life(page):
    page.wait_for_selector("#overlay button", timeout=60000)
    page.get_by_role("button", name="Start a new life").click()
    page.wait_for_function("window.__pike && window.__pike.sim", timeout=120000)


with sync_playwright() as pw:
    browser = pw.chromium.launch(args=ARGS)
    ctx = browser.new_context(viewport={"width": 800, "height": 450})  # High (bloom, MSAA) is too slow in SwiftShader at 720p
    page = ctx.new_page()
    page.set_default_timeout(180000)  # SwiftShader frames take 0.1-2 s on a loaded host; screenshots wait for a frame
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" or (m.type == "warning" and ("WebGL" in m.text or "THREE" in m.text) and "GPU stall" not in m.text) else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1. new life
    page.goto(URL)
    page.wait_for_selector("#overlay button", timeout=60000)
    page.screenshot(path=SHOTS + "pike-start.png")
    start_new_life(page)
    page.wait_for_timeout(2000)
    page.screenshot(path=SHOTS + "pike-playing.png")
    check("1 new life starts, no console errors", not errors, "; ".join(errors[:3]))

    check("1b #marks exists", page.query_selector("#marks") is not None)
    try:
        page.wait_for_function("document.getElementById('hint').innerText.trim().length > 0", timeout=15000)
    except Exception:
        pass
    hint = page.inner_text("#hint").strip()
    check("1c hint box shows text after start", len(hint) > 0, hint[:60])

    # 2. swim, pause, save exists
    page.keyboard.down("KeyW")
    page.wait_for_timeout(3000)
    page.keyboard.up("KeyW")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    ov = page.inner_text("#overlay")
    check("2a pause screen visible", "Paused" in ov and page.is_visible("#overlay"))
    page.screenshot(path=SHOTS + "pike-paused.png")
    saved = page.evaluate("localStorage.getItem('pike.save.v1')")
    check("2b save exists", bool(saved))

    # 3. reload, continue
    before = page.evaluate("({d: __pike.sim.env.dayOfYear, l: __pike.sim.player().lengthCm})")
    page.reload()
    page.wait_for_selector("#overlay button", timeout=60000)
    txt = page.inner_text("#overlay")
    check("3a continue offered with same day", "Continue" in txt and f"day {before['d']}" in txt, txt[:120].replace("\n", " "))
    page.screenshot(path=SHOTS + "pike-continue.png")
    page.get_by_role("button", name="Continue").click()
    page.wait_for_function("window.__pike && window.__pike.sim", timeout=120000)
    after = page.evaluate("__pike.sim.player().lengthCm")
    check("3b length restored", abs(after - before["l"]) < 0.5, f"{before['l']:.2f} -> {after:.2f}")

    # 3c-3e water look: daytime prey at 3-4 m, night prey within 2 m, looking up at Snell's window.
    # SwiftShader frames take ~1-2 s here, hence the long waits.
    # A render hook re-places chosen prey (broadside) in front of the player each frame and can force the camera pitch.
    page.evaluate("""() => {
      const s = __pike.sim, pl = s.player(), L = s.p.environment.dayLengthS;
      window.__shotTime0 = s.time;
      for (const k of s.pikes) if (k !== pl) k.alive = false;
      pl.pos.x = 0; pl.pos.z = 0; pl.pos.y = -2.5; pl.speed = 0; pl.pitch = 0;
      window.__shot = (hour, preyAt, pitch) => {
        s.time = Math.floor(s.time / L) * L + hour / 24 * L;
        const v = __pike.view;
        if (!v.__origRender) v.__origRender = v.render.bind(v);
        const used = new Set();
        const picked = preyAt.map((a) => { const f = s.prey.find((p) => p.alive && !used.has(p) && (!a[3] || p.kind === a[3])); if (f) used.add(f); return f; }).filter(Boolean);
        v.render = (p0, t, env, dt, look) => {
          if (pitch === 0) p0.pitch = 0;
          const fx = Math.cos(p0.yaw), fz = Math.sin(p0.yaw);
          picked.forEach((p, i) => {
            const [d, side, dy] = preyAt[i];
            p.pos.x = p0.pos.x + fx * d - fz * side; p.pos.z = p0.pos.z + fz * d + fx * side; p.pos.y = p0.pos.y + dy;
            p.vel.x = -fz * 0.1; p.vel.z = fx * 0.1; p.vel.y = 0;
          });
          return v.__origRender(p0, t, env, dt, pitch === null ? look : { yaw: look.yaw, pitch });
        };
      };
      window.__shotOff = () => { const v = __pike.view; if (v.__origRender) v.render = v.__origRender; s.time = window.__shotTime0; };
    }""")
    page.evaluate("__shot(12, [[2.6, 0.3, 0], [3.0, -0.5, 0.15], [3.4, 0.1, -0.2]], null)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-day-prey.png")
    # 3c2 perch school next to the player: perch bars, silver roach, red rudd fins, spotted pike (the player, chase camera)
    page.evaluate("__shot(12, [[1.2, -0.45, 0.05, 'perch'], [1.4, -0.15, -0.05, 'perch'], [1.6, 0.15, 0.08, 'perch'], [1.3, 0.45, -0.08, 'roach'], [1.7, 0.75, 0.04, 'roach'], [1.9, -0.8, -0.1, 'rudd'], [1.1, 0.9, 0.12, 'rudd']], 0)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-perch-school.png")
    page.evaluate("__shot(12, [[0.55, -0.12, 0, 'perch'], [0.75, 0.2, 0.04, 'roach']], 0)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-fins-close.png")
    # 3c3 rival pike alive beside the player (tint check): revive one rival, hold it broadside at chase range, then kill it again
    riv = page.evaluate("""() => {
      const s = __pike.sim, pl = s.player(), v = __pike.view;
      const k = s.pikes.find((x) => x !== pl);
      if (!k) return null;
      k.alive = true;
      const orig = v.render;
      window.__rivalOff = () => { v.render = orig; k.alive = false; };
      v.render = (p0, t, env, dt, look) => {
        const fx = Math.cos(p0.yaw), fz = Math.sin(p0.yaw);
        k.pos.x = p0.pos.x + fx * 1.4 - fz * 0.9; k.pos.z = p0.pos.z + fz * 1.4 + fx * 0.9; k.pos.y = p0.pos.y + 0.05;
        k.yaw = p0.yaw; k.pitch = 0; k.speed = 0; k.vel && (k.vel.x = 0, k.vel.y = 0, k.vel.z = 0);
        p0.pitch = 0;
        return orig.call(v, p0, t, env, dt, { yaw: look.yaw, pitch: 0 });
      };
      return {len: k.lengthCm, player: pl.lengthCm};
    }""")
    check("3c3 a rival pike exists for the tint shot", riv is not None, str(riv))
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-rival.png")
    page.evaluate("window.__rivalOff && window.__rivalOff()")
    page.evaluate("__shot(0.5, [[1.0, 0.2, 0], [1.4, -0.35, 0.1]], null)")
    page.wait_for_timeout(5000)
    night_light = page.evaluate("__pike.sim.env.light")
    page.screenshot(path=SHOTS + "pike-night.png")
    check("3c night shot has light near 0", night_light < 0.1, f"light={night_light:.3f}")
    page.evaluate("__shot(12, [], 1.1)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-lookup.png")
    # 3f noon shallows near a reed patch, camera pitched down at the bottom (caustics, stones, litter)
    spot = page.evaluate("""() => {
      const s = __pike.sim, pl = s.player(), w = s.world;
      // Shallowest-enough spot (about 0.9 m) on the inward line from a reed patch.
      let best = null;
      for (const r of w.reeds) {
        const L = Math.hypot(r.x, r.z), ux = r.x / L, uz = r.z / L;
        for (let t = 0; t <= 8; t += 0.5) {
          const x = r.x - ux * t, z = r.z - uz * t, d = w.depthAt(x, z);
          const err = Math.abs(d - 0.9) + t * 0.02;
          if (!best || err < best.err) best = {err, x, z, ux, uz, d};
        }
      }
      const px = best.x, pz = best.z, d = best.d, ux = best.ux, uz = best.uz;
      pl.pos.x = px; pl.pos.z = pz; pl.pos.y = -Math.max(0.3, d - 0.5); pl.speed = 0; pl.yaw = Math.atan2(uz, ux);
      return {d, x: px, z: pz};
    }""")
    page.evaluate("__shot(12, [], -0.65)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-shallow-bottom.png")
    page.wait_for_timeout(1500)
    page.screenshot(path=SHOTS + "pike-shallow-bottom-b.png")
    page.evaluate("__shot(12, [], 1.0)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-shallow-lookup.png")
    print("shallow spot", spot)
    # quality switch must not leak GPU resources. Geometry/texture uploads are lazy (only what a frame draws), so each state is
    # rendered from four looks before counting; the scene-graph geometry count (by object type) is deterministic and checked too.
    mem = page.evaluate("""() => {
      const v = __pike.view, pl = __pike.sim.player();
      const m = (label) => {
        for (const yaw of [0, 1.57, 3.14, 4.71]) v.render(pl, 1, __pike.sim.env, 0.016, {yaw, pitch: 0});
        const geos = new Map();
        v.scene.traverse((o) => { if (o.geometry) geos.set(o.geometry.uuid, o.type); });
        const by = {}; for (const t of geos.values()) by[t] = (by[t] || 0) + 1;
        return {label, g: v.renderer.info.memory.geometries, t: v.renderer.info.memory.textures, scene: geos.size, by};
      };
      // the fps probe may already have dropped SwiftShader to Low: start from an explicit High so 'a' is High
      const g0 = {...v.gfx, quality: 'high', qualityChosen: true};
      v.setGfx(g0);
      const out = [m('a')];
      for (const q of ['low', 'high', 'low', 'high']) { v.setGfx({...g0, quality: q}); out.push(m(q)); }
      return out;
    }""")
    key = lambda r: (r["g"], r["t"], r["scene"])
    # out = [a(high), b(low), c(high), d(low), e(high)]
    # uploads are lazy, so a count can dip by one when a frame skips an object; a leak shows as growth, so check for none
    ok = all(mem[i + 2]["g"] <= mem[i]["g"] and mem[i + 2]["t"] <= mem[i]["t"] and mem[i + 2]["scene"] == mem[i]["scene"] for i in range(3))
    check("3g quality switch never grows geometry/texture counts", ok, str([(r["label"], r["g"], r["t"], r["scene"]) for r in mem]))
    # 3h look up from under a lily pad cluster (pads should read against the Snell window)
    pad = page.evaluate("""() => {
      const s = __pike.sim, pl = s.player(), w = s.world, sp = __pike.view.padSpots;
      if (!sp.length) return null;
      let best = sp[0], bd = 1e9;
      for (const [x, z] of sp) { const d = Math.abs(w.depthAt(x, z) - 0.8); if (d < bd) { bd = d; best = [x, z]; } }
      pl.pos.x = best[0] - 0.4; pl.pos.z = best[1]; pl.pos.y = -0.5; pl.speed = 0; pl.yaw = 0;
      return {n: sp.length, x: best[0], z: best[1], d: w.depthAt(best[0], best[1])};
    }""")
    check("3h lily pads exist", pad is not None and pad["n"] > 20, str(pad))
    page.evaluate("__shot(12, [], 1.0)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-lilypads-up.png")
    page.evaluate("""() => { const pl = __pike.sim.player(); pl.pos.x = 0; pl.pos.z = 0; pl.pos.y = -2.5; pl.yaw = 0; }""")

    # 3i graphics set: style x quality x time of day, same spot and prey (post chain, shafts, stylised bands/outlines)
    gfx = lambda st, q: page.evaluate(f"__pike.view.setGfx({{style:'{st}', quality:'{q}', qualityChosen:true}})")
    prey_row = "[[2.0, 0.3, 0.1], [2.6, -0.5, 0.25], [3.2, 0.1, -0.1]]"
    for name, st, q, hour in [("realistic-high-noon", "realistic", "high", 12), ("realistic-high-dusk", "realistic", "high", 19.5),
                              ("realistic-low-noon", "realistic", "low", 12), ("stylised-noon", "stylised", "high", 12),
                              ("realistic-high-night", "realistic", "high", 0.5)]:
        gfx(st, q)
        page.evaluate(f"__shot({hour}, {prey_row}, 0.45)")
        page.wait_for_timeout(5000)
        page.screenshot(path=SHOTS + f"pike-gfx-{name}.png")
    page.evaluate("__shot(12, [[0.6, -0.1, 0, 'perch'], [0.8, 0.2, 0.04, 'perch']], 0)")
    page.wait_for_timeout(5000)
    page.screenshot(path=SHOTS + "pike-gfx-perch-close.png")
    calls = page.evaluate("__pike.view.drawCalls")
    check("3i draw calls on High under 150", calls < 150, f"calls={calls}")
    gfx("realistic", "high")
    page.evaluate("__shotOff()")
    check("3d no console errors after water shots", not errors, "; ".join(errors[:3]))

    # 4. rest in cover. SwiftShader is slow: shrink the viewport and drop to Low so the day tick arrives quickly.
    page.set_viewport_size({"width": 320, "height": 180})
    page.evaluate("__pike.view.setGfx({...__pike.view.gfx, quality: 'low'})")
    page.wait_for_timeout(1000)
    info = page.evaluate("""() => {
      const s = __pike.sim, pl = s.player();
      const r = s.world.reeds[0];
      pl.pos.x = r.x; pl.pos.z = r.z; pl.pos.y = -0.5; pl.speed = 0; pl.stillTime = 5;
      for (const k of s.pikes) if (k !== pl) { k.alive = false; }
      return {cover: s.world.coverAt(pl.pos)};
    }""")
    page.wait_for_timeout(1500)
    page.evaluate("(() => { const p = __pike.sim.player(); p.stillTime = Math.max(p.stillTime, 5); })()")
    day0 = page.evaluate("__pike.sim.env.dayOfYear")
    page.keyboard.down("KeyR")
    page.wait_for_timeout(1500)
    rest_txt = page.inner_text("#rest")
    page.screenshot(path=SHOTS + "pike-resting.png")
    # SwiftShader frames are slow and each rest frame is 1200 bio-s (1/72 day): hold until the day ticks (max 90 s at 320x180 Low)
    try:
        page.wait_for_function("(d) => __pike.sim.env.dayOfYear > d", arg=day0, timeout=90000)
    except Exception:
        pass
    page.keyboard.up("KeyR")
    day1 = page.evaluate("__pike.sim.env.dayOfYear")
    page.set_viewport_size({"width": 1280, "height": 720})
    page.evaluate("__pike.view.setGfx({...__pike.view.gfx, quality: 'high'})")
    check("4 rest advances dayOfYear", day1 > day0 and "Resting" in rest_txt, f"cover={info['cover']:.2f} day {day0}->{day1} text='{rest_txt}'")

    # 5. death
    page.evaluate("""() => { const p = __pike.sim.player(); p.health = 0; p.weight = 1; p.alive = false; p.deathCause = 'starvation'; }""")
    try:
        page.wait_for_function("document.getElementById('overlay').innerText.includes('Start a new life')", timeout=30000)
    except Exception:
        pass
    ov = page.inner_text("#overlay")
    check("5 death screen shows Start a new life", "Start a new life" in ov, ov[:100].replace("\n", " "))
    page.screenshot(path=SHOTS + "pike-death.png")

    # 6. mobile
    mctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    mp = mctx.new_page()
    mp.set_default_timeout(180000)
    merrors = []
    mp.on("console", lambda m: merrors.append(m.text) if m.type == "error" else None)
    mp.on("pageerror", lambda e: merrors.append(str(e)))
    mp.goto(URL)
    mp.wait_for_selector("#overlay button", timeout=60000)
    sw = mp.evaluate("document.documentElement.scrollWidth")
    mp.screenshot(path=SHOTS + "pike-mobile.png")
    check("6 mobile no horizontal scroll", sw <= 390, f"scrollWidth={sw}")
    mp.get_by_role("button", name="Start a new life").click(timeout=120000)
    mp.wait_for_function("window.__pike && window.__pike.sim", timeout=120000)
    mp.wait_for_timeout(1500)
    mp.screenshot(path=SHOTS + "pike-mobile-playing.png")
    check("6b touch layer visible", mp.is_visible("#touch .touch-layer") and mp.is_visible("#touch .touch-strike"))
    check("6c mobile no console errors", not merrors, "; ".join(merrors[:3]))

    browser.close()

print("FAILED: " + ", ".join(fails) if fails else "ALL PASS")
sys.exit(1 if fails else 0)
